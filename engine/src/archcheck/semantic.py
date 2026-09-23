from __future__ import annotations

from dataclasses import dataclass, replace
import json
import os
from pathlib import Path
from queue import Empty, Queue
import re
import shutil
import subprocess
from threading import Lock, Thread
import time
from typing import Any
from urllib.parse import unquote, urlparse

from archcheck.ast_facts import (
    extract_function_facts,
    extract_initializer_facts,
    FunctionAstFacts,
    RawTypeUse,
    resolve_ast_facts,
)
from archcheck.compile_commands import (
    load_compile_commands,
    write_local_compilation_database,
)
from archcheck.concurrency import attach_run_modes, derive_run_modes, derive_shared_resources, derive_wake_relations, inherit_run_modes
from archcheck.contracts import find_contract_bypasses, find_type_only_includes
from archcheck.file_metrics import apply_global_metrics
from archcheck.framework_rules import BUILTIN_RULES, FrameworkRules, RegistrationRule, load_framework_rules
from archcheck.parallel import OrderedSink, ShardRouter, merge_first_wins, shard_count, split_round_robin
from archcheck.path_pruning import prune_unreachable_branches
from archcheck.time_base import derive_time_base
from archcheck.yield_locals import derive_yield_locals
from archcheck.indirection import (
    GlobalInitializer,
    attach_callback_details,
    derive_indirection,
    scan_inactive_functions,
)
from archcheck.paths import resolved
from archcheck.paths import resolved as canonical_path  # 函数体内 resolved 被同名局部变量遮蔽
from archcheck.model import (
    AnalysisResult,
    AstFactsSummary,
    DoxygenDocumentation,
    EnumFact,
    ExternalSymbol,
    ExternDeclaration,
    FunctionSymbol,
    GlobalVariable,
    InactiveFunction,
    InactiveRegions,
    MacroUse,
    SemanticEdge,
    SourceLocation,
    TaskControl,
    TypeUse,
    VariableSymbol,
)
from archcheck.data_dependencies import derive_data_dependencies, polling_order
from archcheck.macro_facts import decode_macro_tokens, derive_macro_uses, find_macro_definitions, macro_literal_values
from archcheck.runtime_units import (
    EnableSite,
    VectorTable,
    build_entries,
    build_execution_units,
    attach_task_priorities,
    attach_task_priorities,
    attach_task_priorities,
    attach_hosts,
    compute_reachability,
    dispatch_edges,
    parse_vector_tables,
    resolve_enable_sites,
)


VARIABLE_SYMBOL_KIND = 13
FUNCTION_SYMBOL_KINDS = {6, 9, 12}
HEADER_SUFFIXES = {".h", ".hpp", ".hh", ".hxx", ".inc"}
ASSEMBLY_SUFFIXES = {".s", ".asm"}


@dataclass(frozen=True)
class _VariableCandidate:
    name: str
    type_name: str
    storage: str
    definition: SourceLocation
    uri: str
    position: dict[str, int]


@dataclass(frozen=True)
class _FunctionCandidate:
    symbol: FunctionSymbol
    uri: str
    position: dict[str, int]
    # Full LSP range of the definition; ``textDocument/ast`` is asked for exactly this.
    range: dict[str, Any] | None = None


@dataclass(frozen=True)
class _AggregateCandidate:
    """A file-scope variable whose declaration carries a ``{ ... }`` initializer."""

    symbol: VariableSymbol
    uri: str
    position: dict[str, int]
    range: dict[str, Any]


LIBRARY_SUFFIXES = {".lib", ".a"}
SOURCE_SUFFIXES = {".c", ".cc", ".cpp", ".cxx", ".ino"}


def _union_references(
    router: ShardRouter,
    candidate: "_VariableCandidate",
    project: Path,
) -> tuple[Any, ...]:
    """一个符号的全部引用：问遍所有分片，去重后按位置排序。

    clangd 只报它自己打开过的文件里的引用。串行时所有编译单元都在一个 client 里，
    所以一次就问全了；分片之后引用散在各片，少问一片就少一批边，而且不报错。

    排序是必须的：并集的拼接顺序取决于分片划分，不排序的话换个 --jobs 事实就变了。
    """

    seen: dict[tuple, Any] = {}
    for client in router.clients:
        try:
            found = client.references(candidate, project)
        except (OSError, TimeoutError, RuntimeError):
            continue
        for item in found:
            seen.setdefault((item.path, item.line, getattr(item, "column", 0)), item)
    return tuple(value for _, value in sorted(seen.items(), key=lambda row: row[0]))


def _merge_collectors(
    into: "_AstCollector",
    shards: "list[_AstCollector]",
    warnings: list[str],
) -> None:
    """把各分片的 AST 收集结果并回第 0 片，次序按分片编号。

    映射一律「先到先得」，和串行时一致：一个头文件里的 static inline 函数会被多个编译单元
    触达，串行时第一个见到它的赢。分片之后每片各自见到一次，所以按分片编号重放同一个规则，
    赢家不变。值本身是一样的，会变的是来源位置和计数——那正是不能让它漂的东西。

    计数里 requested 会比串行时大：跨分片重复见到的那些头文件函数，每片各请求了一次。
    这是分片的代价，如实累加，不掩盖。
    """

    if not shards:
        return
    others = shards[1:]
    if not others:
        return
    for shard in others:
        for key, value in shard.raw.items():
            into.raw.setdefault(key, value)
        for key, value in shard.enum_values.items():
            into.enum_values.setdefault(key, value)
        for key, value in shard.global_inits.items():
            into.global_inits.setdefault(key, value)
        for key, value in shard.layouts.items():
            into.layouts.setdefault(key, value)
        for key, value in shard.type_definitions.items():
            if into.type_definitions.get(key) is None:
                into.type_definitions[key] = value
        into.enum_definitions_seen |= shard.enum_definitions_seen
        into.layout_failures |= shard.layout_failures
        into.requested += shard.requested
        into.analyzed += shard.analyzed
        into.failed += shard.failed
        into.elapsed += shard.elapsed
        into.do_while_zero_skipped += shard.do_while_zero_skipped
        into.switches_skipped += shard.switches_skipped
        into.initializers_requested += shard.initializers_requested
        into.initializers_analyzed += shard.initializers_analyzed
        into.type_requests += shard.type_requests
    # 分片各自的告警按分片编号接在后面：内容和串行时一样，只是分组不同
    for shard in shards:
        warnings.extend(shard.warnings)
        shard.warnings.clear()


def enrich_with_global_variables(
    result: AnalysisResult,
    cache_directory: Path,
    clangd_path: Path | None = None,
    rules: FrameworkRules | None = None,
    jobs: int | None = None,
) -> AnalysisResult:
    if result.compile_commands is None:
        return replace(
            result,
            semantic_warnings=("全局变量分析需要 compile_commands.json。",),
        )

    executable = clangd_path or find_clangd()
    if executable is None:
        return replace(
            result,
            semantic_warnings=("未找到 clangd，已跳过全局变量分析。",),
        )

    if rules is None:
        rules = load_framework_rules(result.project, result.architecture_config)
    commands = load_compile_commands(result.compile_commands, result.path_mapping)
    write_local_compilation_database(commands, result.path_mapping, cache_directory)
    warnings: list[str] = []
    variables: list[GlobalVariable] = []
    function_candidates: list[_FunctionCandidate] = []
    variable_symbols: list[VariableSymbol] = []
    call_edges: list[SemanticEdge] = []
    # 待分析的编译单元先定下来，分片和顺序都按这个列表走
    units: list[CompileCommand] = []
    seen_units: set[Path] = set()
    for command in commands:
        if command.file.suffix.lower() not in SOURCE_SUFFIXES:
            continue
        if not command.file.is_file() or not _is_within(command.file, result.project):
            continue
        resolved_file = command.file.resolve()  # 不能写 resolved(...)：本函数里有个同名局部变量
        if resolved_file in seen_units:
            continue
        seen_units.add(resolved_file)
        units.append(command)

    shards = shard_count(len(units), jobs)
    buckets = split_round_robin(units, shards)
    clients = [_ClangdClient(executable, cache_directory) for _ in buckets]
    collectors = [_AstCollector(clients[i], rules, []) for i in range(len(buckets))]
    # 谁打开了哪个文件：尾部的追问要送回那一片，clangd 不回答没打开过的文档
    # 键要同时收绝对路径和工程相对路径：尾部那几步拿到的是 _relative() 的产物，
    # 只按绝对路径建索引会全部落到兜底那一片，而那一片没打开过这些文件，
    # clangd 回 "trying to get AST for non-added document"，事实就静默少了一批。
    owner_of: dict[str, int] = {}
    for position, bucket in enumerate(buckets):
        for _, command in bucket:
            absolute = str(command.file).replace("\\", "/")
            owner_of[absolute] = position
            owner_of[str(canonical_path(command.file)).replace("\\", "/")] = position
            owner_of[_relative(command.file, result.project)] = position
    router = ShardRouter(clients, owner_of)
    client = router.primary

    definitions: tuple[_FunctionCandidate, ...] = ()
    declarations: tuple[_FunctionCandidate, ...] = ()
    ast_collector = collectors[0]

    try:
        candidate_sink = OrderedSink()
        function_sink = OrderedSink()
        variable_sink = OrderedSink()
        warning_sink = OrderedSink()
        macro_tokens: dict[str, tuple[str, list[tuple[str, int, int]]]] = {}
        macro_token_order: list[tuple[int, str, tuple]] = []
        macro_uses: tuple[MacroUse, ...] = ()

        def run_bucket(position: int) -> None:
            shard_client = clients[position]
            shard_collector = collectors[position]
            shard_client.start(result.project)
            for unit_index, command in buckets[position]:
                try:
                    document = shard_client.document_symbols(command.file, result.project)
                    candidate_sink.extend(unit_index, document[0])
                    function_sink.extend(unit_index, document[1])
                    variable_sink.extend(unit_index, document[2])
                except (OSError, TimeoutError, RuntimeError) as exc:
                    warning_sink.extend(unit_index, [f"{_relative(command.file, result.project)}: {exc}"])
                    continue
                # The translation unit is hot in clangd right now; ask for every function
                # body's AST (and every aggregate initializer) before moving on so nothing
                # is re-parsed later.
                shard_collector.collect(command.file, document[1])
                shard_collector.collect_initializers(command.file, document[3])
                # 宏用法：这个编译单元里哪些标识符是宏名（clangd 语义 token），趁 TU 还热着问
                try:
                    uri, text = shard_client.open(command.file)
                    macro_token_order.append((
                        unit_index,
                        _relative(command.file, result.project),
                        (uri, decode_macro_tokens(shard_client.semantic_tokens(uri), shard_client.semantic_token_types, text.splitlines())),
                    ))
                except (OSError, TimeoutError, RuntimeError) as exc:
                    warning_sink.extend(unit_index, [f"{_relative(command.file, result.project)}: semantic tokens: {exc}"])

        if len(buckets) == 1:
            run_bucket(0)
        else:
            # 线程而不是进程：每片都阻塞在自己那个 clangd 的管道上，等待时 GIL 是放开的，
            # 而分析结果是一堆互相引用的对象，跨进程搬要序列化，得不偿失
            errors: list[BaseException] = []

            def guarded(position: int) -> None:
                try:
                    run_bucket(position)
                except BaseException as exc:  # noqa: BLE001 - 一片崩了不能悄悄少一批事实
                    errors.append(exc)

            threads = [Thread(target=guarded, args=(position,), daemon=True) for position in range(len(buckets))]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            if errors:
                raise errors[0]

        # 合并：一律按编译单元的原始下标，不按谁先跑完
        candidates: list[_VariableCandidate] = candidate_sink.ordered()
        function_candidates.extend(function_sink.ordered())
        variable_symbols.extend(variable_sink.ordered())
        warnings.extend(warning_sink.ordered())
        for _, relative_path, payload in sorted(macro_token_order, key=lambda row: row[0]):
            macro_tokens.setdefault(relative_path, payload)
        _merge_collectors(ast_collector, collectors, warnings)

        # 宏依赖：全工程的 #define 行给定义位置；一个名字多处定义时问一次 definition
        macro_definitions = find_macro_definitions(
            result.project, [item.path for item in result.file_metrics], _mask_comments_and_strings
        )

        def resolve_macro(file: str, line: int, column: int) -> tuple[str, int] | None:
            uri = macro_tokens[file][0]
            try:
                found = router.for_path(result.project / file).definition_location(uri, {"line": line - 1, "character": column - 1})
            except (OSError, TimeoutError, RuntimeError) as exc:
                warnings.append(f"{file}:{line}: macro definition: {exc}")
                return None
            if found is None or not _is_within(found[0], result.project):
                return None
            return _relative(found[0], result.project), found[1]

        macro_uses = derive_macro_uses(
            {file: tokens for file, (_uri, tokens) in macro_tokens.items()}, macro_definitions, resolve_macro
        )

        for candidate in _deduplicate_candidates(candidates):
            try:
                # references 是跨文件的：一个变量的引用散落在别的编译单元里，而 clangd 只报它
                # 打开过的那些文件。所以问遍每一片再取并集——只问定义所在那一片会静默少边。
                # 串行时全部文件都在同一个 client 里，所以并集正好等于串行的结果。
                references = _union_references(router, candidate, result.project)
            except (OSError, TimeoutError, RuntimeError) as exc:
                warnings.append(f"{candidate.definition.path}:{candidate.definition.line}: {exc}")
                references = ()
            variables.append(
                GlobalVariable(
                    name=candidate.name,
                    type_name=candidate.type_name,
                    storage=candidate.storage,
                    definition=candidate.definition,
                    references=references,
                )
            )

        definitions, declarations = _split_definitions(_deduplicate_functions(function_candidates))
        # Call hierarchy is only meaningful from a body; declarations have no outgoing calls.
        for function in definitions:
            try:
                call_edges.extend(router.for_path(function.symbol.location.path).outgoing_calls(function, result.project))
            except (OSError, TimeoutError, RuntimeError) as exc:
                warnings.append(
                    f"{function.symbol.location.path}:{function.symbol.location.line}: {exc}"
                )
        # Bodies that live in headers (static inline helpers, CMSIS intrinsics) have no
        # translation unit of their own, so open the headers that calls point at.
        header_functions, header_locals, header_edges = _harvest_header_definitions(
            client, result.project, call_edges, definitions, warnings, ast_collector
        )
        function_candidates.extend(header_functions)
        variable_symbols.extend(header_locals)
        call_edges.extend(header_edges)
        definitions, declarations = _split_definitions(_deduplicate_functions(function_candidates))
        # inactiveRegions notifications trail the last didOpen; give them a moment.
        router.each(lambda item: item.drain(1.5))
    except (OSError, TimeoutError, RuntimeError) as exc:
        warnings.append(f"clangd: {exc}")
    finally:
        opened_uris = set()
        inactive_by_uri: dict[str, Any] = {}
        raw_symbols: dict[str, Any] = {}
        symbol_uris: dict[str, str] = {}
        declaration_sites: dict[str, SourceLocation] = {}
        for shard_client in clients:
            opened_uris |= set(shard_client.opened_uris)
            inactive_by_uri.update(shard_client.inactive_regions)
            for uri, symbols in shard_client.raw_symbols.items():
                raw_symbols.setdefault(uri, symbols)
            for key, original in shard_client.symbol_uris.items():
                symbol_uris.setdefault(key, original)
            for key, site in shard_client.declaration_sites.items():
                declaration_sites.setdefault(key, site)
        # 尾部还有别的地方按类型名查符号树，把合并后的挂回主 client
        client.raw_symbols = raw_symbols
        # 枚举必须在 close 之前收：一个从没被代码引用过的成员在 AST 阶段拿不到值，
        # 只能靠 hover 兜底，而关掉 clangd 之后 hover 一律 RuntimeError，
        # 被 _collect_enums 自己的 except 吞成 None，值就静默缺了。
        try:
            enums = _collect_enums(router, raw_symbols, symbol_uris, result.project, ast_collector.enum_values)
        except (OSError, TimeoutError, RuntimeError) as exc:
            warnings.append(f"clangd: enums: {exc}")
            enums = ()
        for shard_client in clients:
            shard_client.close()

    if not definitions and not declarations:
        definitions, declarations = _split_definitions(_deduplicate_functions(function_candidates))

    variables.sort(
        key=lambda item: (
            not item.cross_file,
            -item.referenced_files,
            -len(item.references),
            item.name,
            item.definition.path,
        )
    )
    functions = _attach_doxygen_documentation(
        tuple(item.symbol for item in definitions),
        result.project,
    )
    definitions_by_name = _index_by_name(functions)
    extern_declarations = _extern_declarations(
        tuple(item.symbol for item in declarations), definitions_by_name
    )
    resolved_calls, unresolved = _resolve_call_targets(tuple(call_edges), functions, definitions_by_name)
    external_edges, external_symbols = _external_symbols(
        unresolved, tuple(item.symbol for item in declarations), declaration_sites, result.project
    )
    if unresolved:
        sample = "、".join(sorted(unresolved)[:8])
        warnings.append(
            f"{len(unresolved)} 个被调函数只有声明、没有进入编译数据库的定义，已保留为 externalSymbols"
            f"（调用边 target 为 external:<name>）：{sample}"
        )

    all_variables = _deduplicate_variable_symbols(variable_symbols)
    text_edges, enable_sites = _source_relationship_edges(
        functions, result.project, rules, all_variables
    )
    source_edges = _supplement_source_edges(resolved_calls, text_edges)
    vector_table = parse_vector_tables(
        (
            command.file
            for command in commands
            if command.file.suffix.lower() in ASSEMBLY_SUFFIXES
            and command.file.is_file()
            and _is_within(command.file, result.project)
        ),
        result.project,
    )
    enable_edges = resolve_enable_sites(enable_sites, definitions_by_name, vector_table)
    entries = build_entries(functions, vector_table, rules)
    resolver = lambda name, from_path: _resolve_definition(name, from_path, definitions_by_name)  # noqa: E731

    # Schema 4: callbacks that travel through data (struct fields, initializer tables,
    # registration parameters) and IRQ numbers read from configuration tables.
    handler_names = {entry.name for entry in vector_table.entries}
    excluded_targets = {function.symbol_id for function in functions if function.name in handler_names}
    excluded_targets.update(entry.symbol_id for entry in entries)
    indirection = derive_indirection(
        ast_collector.raw,
        functions,
        all_variables,
        tuple(variables),
        ast_collector.global_inits,
        ast_collector.layouts,
        resolver,
        text_edges,
        rules,
        vector_table,
        definitions_by_name,
        excluded_targets,
    )
    call_like = _strip_calls_displaced_by_address_of(
        (*resolved_calls, *external_edges, *source_edges, *indirection.address_edges)
    )
    variable_edges = _variable_reference_edges(functions, all_variables, variables)
    semantic_edges = _deduplicate_semantic_edges(
        (
            *call_like,
            *enable_edges,
            *indirection.enable_edges,
            *indirection.registration_edges,
            *variable_edges,
        )
    )
    external_symbols = _attach_external_callers(external_symbols, semantic_edges)

    execution_units = build_execution_units(functions, semantic_edges, vector_table, rules)
    execution_units = attach_callback_details(execution_units, indirection.details)
    # 任务优先级：调用点只记了原文，这里对着枚举值和属性结构体的初始化器解出数字
    # 常量表：宏定义 < 枚举定义（documentSymbol + hover）< 函数体里 hover 到的枚举值。属性结构体里的
    # osPriorityHigh 只在初始化器里出现，函数体那份表没有它，所以枚举定义那份必须进来
    enum_members = {str(m.get("name")): str(m.get("value")) for e in enums for m in e.members if m.get("name") and m.get("value") is not None}
    execution_units = attach_task_priorities(
        execution_units, ast_collector.global_inits, {**macro_literal_values(result.project, macro_uses), **enum_members, **ast_collector.enum_values}
    )
    # Schema 4: dispatcher → registered callback may-call edges, so a callback's body is
    # reachable from the task / ISR that calls through the slot (its host context).
    semantic_edges = _deduplicate_semantic_edges((*semantic_edges, *dispatch_edges(execution_units)))
    # Calls behind a constant-argument guard no reachable call site can enable are marked
    # dead: the edge stays (the call is in the source) but reachability does not walk it.
    semantic_edges, dead_branches = prune_unreachable_branches(
        ast_collector.raw, functions, semantic_edges, entries, execution_units, ast_collector.enum_values
    )
    reachability = compute_reachability(functions, semantic_edges, entries, execution_units)
    execution_units = attach_hosts(execution_units, reachability)

    inactive_regions, inactive_functions = _inactive_facts(
        inactive_by_uri, opened_uris, result.project
    )
    # Schema 3: AST facts (loops, state machines, accesses, critical sections) and the
    # derivations built on top of them (run modes, shared resources, conflicts).
    by_id_for_time = {function.symbol_id: function for function in functions}
    resolved = resolve_ast_facts(
        ast_collector.raw,
        functions,
        all_variables,
        tuple(variables),
        resolver,
        ast_collector.enum_values,
    )
    run_modes = derive_run_modes(
        execution_units, entries, resolved.loops, semantic_edges, set(ast_collector.raw), resolved.blocking_by_function, rules.tick_ms
    )
    execution_units = attach_run_modes(execution_units, run_modes)
    execution_units, run_modes = inherit_run_modes(execution_units, run_modes)
    wake_relations = derive_wake_relations(
        resolved.resource_accesses, resolved.control_flow, reachability, execution_units
    )
    shared_resources, conflict_candidates = derive_shared_resources(
        resolved.resource_accesses, reachability, execution_units, resolved.volatile_by_resource,
        {relation.resource for relation in wake_relations},
        type_lookup=resolved.type_by_resource,
        atomic_width_bytes=rules.atomic_width_bytes,
    )
    # 数据依赖：写方单元 -> 读方单元，按轮询顺序分同轮 / 跨轮 / 异步。顺序 = 从 main 深搜、按调用行序遇到的注册
    polling = polling_order(entries, execution_units, semantic_edges)
    data_dependencies = derive_data_dependencies(
        shared_resources, execution_units, polling, rules.scheduling_of_rules([unit.rule for unit in execution_units])
    )
    # 时基：SysTick 重载与主频、计时基准变量、超时循环。都是纯 C 语义的推导，
    # profile 只提供 SysTick 配置 API 的名字。
    systick_calls = []
    for function_id, facts in ast_collector.raw.items():
        function = by_id_for_time.get(function_id)
        for callee, line, column, expression in facts.systick_calls:
            systick_calls.append((
                function_id,
                callee,
                SourceLocation(path=function.location.path if function else "", line=line, column=column),
                expression,
            ))
    # 调度状态迁移：挂起 / 恢复 / 结束 / 重启。实参是普通函数名时就能定位到具体任务，
    # 不带实参的形式（PT_EXIT 这类）指调用者自己所属的任务。
    unit_by_entry = {unit.entry_symbol_id: unit for unit in execution_units}
    definitions_by_name: dict[str, list[str]] = {}
    for item in functions:
        if item.is_definition:
            definitions_by_name.setdefault(item.name, []).append(item.symbol_id)
    task_controls: list[TaskControl] = []
    for function_id, facts in ast_collector.raw.items():
        function = by_id_for_time.get(function_id)
        for callee, line, column, argument, rule_id, kind in facts.task_control_calls:
            target = None
            candidates = definitions_by_name.get(argument, [])
            if len(candidates) == 1:
                target = candidates[0]
            self_target = not argument
            if self_target and function_id in unit_by_entry:
                target = function_id
            unit = unit_by_entry.get(target) if target else None
            task_controls.append(
                TaskControl(
                    function=function_id,
                    location=SourceLocation(
                        path=function.location.path if function else "", line=line, column=column
                    ),
                    callee=callee,
                    kind=kind,
                    rule=rule_id,
                    argument=argument,
                    target=target,
                    target_unit=unit.unit_id if unit else None,
                    self_target=self_target,
                )
            )

    # 无栈协程：让出即 return，栈上的局部不保留。只查任务入口函数（让出只能写在那里）。
    task_entries = {unit.entry_symbol_id for unit in execution_units if unit.kind == "task"}
    yield_local_input = [
        (function_id, by_id_for_time[function_id].location.path, facts)
        for function_id, facts in ast_collector.raw.items()
        if function_id in by_id_for_time
    ]
    yield_locals = derive_yield_locals(
        yield_local_input,
        task_entries,
        rules.scheduling_of_rules([unit.rule for unit in execution_units]),
    )

    # 类型依赖：函数 -> 具名类型 -> 定义文件。工程内的定义给相对路径；工程外（SDK / libc）只标 external
    ast_collector.resolve_remaining_types()
    type_uses: list[TypeUse] = []
    for function_id, facts in ast_collector.raw.items():
        function = by_id_for_time.get(function_id)
        if function is None:
            continue
        for use in facts.type_uses:
            found = ast_collector.type_definitions.get(use.type_name)
            defined_in = None
            resolution = "unresolved"
            if found is not None:
                if _is_within(found[0], result.project):
                    defined_in = SourceLocation(path=_relative(found[0], result.project), line=found[1], column=1)
                    resolution = "project"
                else:
                    resolution = "external"
            type_uses.append(
                TypeUse(
                    function=function_id,
                    type_name=use.type_name,
                    role=use.role,
                    pointer=use.pointer,
                    as_written=use.as_written,
                    count=use.count,
                    location=SourceLocation(path=function.location.path, line=use.line, column=use.column),
                    defined_in=defined_in,
                    resolution=resolution,
                )
            )

    time_base = derive_time_base(
        systick_calls,
        resolved.resource_accesses,
        resolved.loops,
        resolved.control_flow,
        reachability,
        ast_collector.enum_values,
        rules.tick_ms,
    )

    ast_summary = ast_collector.summary(
        resolved.skipped_dispatch_switches,
        len(inactive_regions),
        callbacks_host_unknown=sum(1 for unit in execution_units if unit.kind not in {"isr", "task"} and not unit.hosts),
        callbacks_host_ambiguous=sum(1 for unit in execution_units if unit.kind not in {"isr", "task"} and len(unit.hosts) > 1),
        dead_branch_calls=len(dead_branches),
    )

    contract_bypass = find_contract_bypasses(
        result.project, functions, semantic_edges, result.dependency_edges
    )
    type_only_includes = find_type_only_includes(
        result.project, functions, all_variables, semantic_edges, result.dependency_edges
    )

    file_metrics = apply_global_metrics(result.file_metrics, tuple(variables))
    metrics = replace(
        result.metrics,
        global_variables=len(variables),
        cross_file_global_variables=sum(item.cross_file for item in variables),
        functions=len(functions),
        variables=len(all_variables),
        function_calls=sum(edge.relation == "calls" for edge in semantic_edges),
        variable_references=sum(
            edge.relation == "references" for edge in semantic_edges
        ),
        high_risk_files=sum(item.risk_score >= 60 for item in file_metrics),
    )
    return replace(
        result,
        global_variables=tuple(variables),
        functions=functions,
        variables=all_variables,
        semantic_edges=semantic_edges,
        file_metrics=file_metrics,
        semantic_warnings=tuple(warnings[:100]),
        metrics=metrics,
        extern_declarations=extern_declarations,
        entries=entries,
        execution_units=execution_units,
        reachability=reachability,
        contract_bypass=contract_bypass,
        type_only_includes=type_only_includes,
        loops=resolved.loops,
        state_machines=resolved.state_machines,
        resource_accesses=resolved.resource_accesses,
        critical_sections=resolved.critical_sections,
        control_flow=resolved.control_flow,
        run_modes=run_modes,
        shared_resources=shared_resources,
        conflict_candidates=conflict_candidates,
        wake_relations=wake_relations,
        dead_branches=dead_branches,
        task_controls=tuple(task_controls),
        yield_locals=yield_locals,
        type_uses=tuple(type_uses),
        macro_uses=macro_uses,
        data_dependencies=data_dependencies,
        polling_order=polling,
        # 有效调度模型：只看真正产出执行单元的那些规则，避免"加载了全部 profile"时被最强的盖掉
        scheduling=rules.scheduling_of_rules([unit.rule for unit in execution_units]),
        tick_ms=rules.tick_ms,
        time_base=time_base,
        ast_facts=ast_summary,
        external_symbols=external_symbols,
        enable_sites=indirection.enable_sites,
        inactive_regions=inactive_regions,
        inactive_functions=inactive_functions,
        enums=enums,
    )


_HOVER_VALUE_PATTERN = re.compile(r"Value\s*=\s*([^\n]+)")


class _AstCollector:
    """Requests ``textDocument/ast`` per function definition and keeps the raw facts.

    Only function ranges are requested (never whole files).  Enumerator values used as
    case labels or assignment targets are resolved with one ``hover`` per distinct name
    while the translation unit is still current in clangd.
    """

    def __init__(self, client: _ClangdClient, rules: FrameworkRules, warnings: list[str]) -> None:
        self.client = client
        self.enum_definitions_seen: set[str] = set()
        self.rules = rules
        self.warnings = warnings
        self.raw: dict[str, FunctionAstFacts] = {}
        self.enum_values: dict[str, str] = {}
        self.requested = 0
        self.analyzed = 0
        self.failed = 0
        self.elapsed = 0.0
        self.do_while_zero_skipped = 0
        self.switches_skipped = 0
        # Schema 4: file-scope aggregate initializers and struct field layouts.
        self.global_inits: dict[str, GlobalInitializer] = {}
        self.layouts: dict[str, tuple[str, ...]] = {}
        self.layout_failures: set[str] = set()
        self.initializers_requested = 0
        self.initializers_analyzed = 0
        # 类型名 -> 定义位置（绝对路径, 1 起始行）；None = clangd 没给出定义
        self.type_definitions: dict[str, tuple[Path, int] | None] = {}
        self.type_requests = 0

    def _ensure_type_definition(self, use: RawTypeUse, uri: str) -> None:
        """Where is ``use.type_name`` defined?  Cached symbol trees first, then one typeDefinition."""

        if use.type_name in self.type_definitions and (self.type_definitions[use.type_name] is not None or use.role != "return"):
            return
        found = _type_symbol_location(self.client.raw_symbols, use.type_name)
        if found is None:
            self.type_requests += 1
            try:
                locations = self.client.type_definition(uri, {"line": use.line - 1, "character": use.column - 1})
            except (OSError, TimeoutError, RuntimeError) as exc:
                self.warnings.append(f"type definition of {use.type_name}: {exc}")
                locations = []
            for location in locations:
                path = _uri_to_path(str(location.get("uri", "")))
                if path is None:
                    continue
                start = (location.get("range") or {}).get("start") or {}
                found = (path, int(start.get("line", 0)) + 1)
                break
        # 返回类型那个位置（函数名）问 typeDefinition 问不到，留着让别的用法再试
        if found is not None or use.role != "return":
            self.type_definitions[use.type_name] = found

    def resolve_remaining_types(self) -> None:
        """Names typeDefinition never answered (array-typed uses of an anonymous-struct typedef,
        return types): one ``workspace/symbol`` lookup each, exact name, type kinds only."""

        for name, found in list(self.type_definitions.items()):
            if found is not None:
                continue
            found = _type_symbol_location(self.client.raw_symbols, name)
            if found is None:
                self.type_requests += 1
                try:
                    found = self.client.workspace_type_symbol(name)
                except (OSError, TimeoutError, RuntimeError) as exc:
                    self.warnings.append(f"workspace symbol {name}: {exc}")
            if found is not None:
                self.type_definitions[name] = found

    def collect_initializers(self, path: Path, candidates: list[_AggregateCandidate]) -> None:
        if not candidates:
            return
        started = time.monotonic()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        lines = text.splitlines()
        masked = _mask_comments_and_strings(text).splitlines()
        for candidate in candidates:
            self.initializers_requested += 1
            try:
                ast = self.client.ast(candidate.uri, candidate.range)
            except (OSError, TimeoutError, RuntimeError) as exc:
                self.warnings.append(f"{candidate.symbol.location.path}:{candidate.symbol.location.line}: ast: {exc}")
                continue
            if not isinstance(ast, dict):
                continue
            try:
                facts = extract_initializer_facts(ast, lines, masked)
            except Exception as exc:  # noqa: BLE001 - one odd initializer must not abort the scan
                self.warnings.append(
                    f"{candidate.symbol.location.path}:{candidate.symbol.location.line}: initializer facts: {exc!r}"
                )
                continue
            if facts is None:
                continue
            self.initializers_analyzed += 1
            if not facts.entries:
                continue
            # 初始化器里的枚举常量（osThreadAttr_t.priority = osPriorityHigh 这种）多半只在这里出现，
            # 函数体那条路收不到它；TU 正热着，顺手 hover 一次把值记下，任务优先级要靠它折成数字
            for entry in facts.entries:
                if entry.value_kind != "enum" or entry.value in self.enum_values:
                    continue
                try:
                    value = self.client.enumerator_value(candidate.uri, entry.line - 1, entry.column - 1)
                except (OSError, TimeoutError, RuntimeError):
                    value = None
                if value is not None:
                    self.enum_values[entry.value] = value
            self.global_inits[candidate.symbol.symbol_id] = GlobalInitializer(
                variable_id=candidate.symbol.symbol_id,
                name=candidate.symbol.name,
                type_name=facts.type_name,
                path=candidate.symbol.location.path,
                line=candidate.symbol.location.line,
                entries=facts.entries,
            )
            if any(entry.field_index is not None for entry in facts.entries):
                types = {entry.element_type or entry.variable_type for entry in facts.entries if entry.field_index is not None}
                for type_name in types:
                    self._ensure_layout(type_name, candidate.uri, candidate.position)
        self.elapsed += time.monotonic() - started

    def _ensure_layout(self, type_name: str | None, uri: str, position: dict[str, int]) -> None:
        if not type_name or type_name in self.layouts or type_name in self.layout_failures:
            return
        try:
            fields = self.client.struct_layout(uri, position)
        except (OSError, TimeoutError, RuntimeError) as exc:
            self.warnings.append(f"struct layout of {type_name}: {exc}")
            fields = None
        if fields:
            self.layouts[type_name] = fields
        else:
            self.layout_failures.add(type_name)

    def collect(self, path: Path, candidates: list[_FunctionCandidate]) -> None:
        definitions = [
            item for item in candidates
            if item.symbol.is_definition and item.range is not None and item.symbol.symbol_id not in self.raw
        ]
        if not definitions:
            return
        started = time.monotonic()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        lines = text.splitlines()
        masked = _mask_comments_and_strings(text).splitlines()
        pending_enums: dict[str, tuple[int, int]] = {}
        pending_macros: dict[str, tuple[int, int]] = {}
        for candidate in definitions:
            self.requested += 1
            try:
                ast = self.client.ast(candidate.uri, candidate.range or {})
            except (OSError, TimeoutError, RuntimeError) as exc:
                self.failed += 1
                self.warnings.append(f"{candidate.symbol.location.path}:{candidate.symbol.location.line}: ast: {exc}")
                continue
            if not isinstance(ast, dict):
                self.failed += 1
                continue
            try:
                facts = extract_function_facts(ast, lines, masked, self.rules)
            except Exception as exc:  # noqa: BLE001 - one odd body must not abort the scan
                self.failed += 1
                self.warnings.append(
                    f"{candidate.symbol.location.path}:{candidate.symbol.location.line}: ast facts: {exc!r}"
                )
                continue
            self.raw[candidate.symbol.symbol_id] = facts
            self.analyzed += 1
            for use in facts.type_uses:
                self._ensure_type_definition(use, candidate.uri)
            self.do_while_zero_skipped += facts.do_while_zero_skipped
            self.switches_skipped += facts.switches_skipped
            for name, position in facts.enum_constants.items():
                if name not in self.enum_values:
                    pending_enums.setdefault(name, position)
            for name, position in facts.macro_constants.items():
                if name not in self.enum_values:
                    pending_macros.setdefault(name, position)
            for aggregate in facts.local_aggregates:
                self._ensure_layout(
                    aggregate.type_name,
                    candidate.uri,
                    {"line": aggregate.line - 1, "character": aggregate.column - 1},
                )
        for name, (line, character) in pending_enums.items():
            try:
                value = self.client.enumerator_value(definitions[0].uri, line, character)
            except (OSError, TimeoutError, RuntimeError):
                value = None
            if value is not None:
                self.enum_values[name] = value
        # Enum types live in headers more often than not: jump to each label's definition once
        # so the header's symbol tree (and therefore the full enumerator list) gets cached.
        for name, (line, character) in pending_enums.items():
            if name in self.enum_definitions_seen:
                continue
            self.enum_definitions_seen.add(name)
            try:
                self.client.cache_symbols_of_definition(definitions[0].uri, {"line": line, "character": character})
            except (OSError, TimeoutError, RuntimeError):
                pass
        for name, (line, character) in pending_macros.items():
            try:
                value = self.client.macro_value(definitions[0].uri, line, character)
            except (OSError, TimeoutError, RuntimeError):
                value = None
            if value is None or not re.search(r"\d", value):
                # 本地 hover 看不到值（extern 声明、跨 TU 的定义）：跟到定义处再问一次
                try:
                    value = self.client.value_at_definition(definitions[0].uri, {"line": line, "character": character}) or value
                except (OSError, TimeoutError, RuntimeError):
                    pass
            if value is not None:
                self.enum_values[name] = value
        self.elapsed += time.monotonic() - started

    def summary(self, skipped_dispatch_switches: int = 0, inactive_region_files: int = 0, callbacks_host_unknown: int = 0, callbacks_host_ambiguous: int = 0, dead_branch_calls: int = 0) -> AstFactsSummary:
        return AstFactsSummary(
            callbacks_host_unknown=callbacks_host_unknown,
            callbacks_host_ambiguous=callbacks_host_ambiguous,
            dead_branch_calls=dead_branch_calls,
            functions_requested=self.requested,
            functions_analyzed=self.analyzed,
            functions_failed=self.failed,
            elapsed_seconds=self.elapsed,
            do_while_zero_skipped=self.do_while_zero_skipped,
            switches_skipped=self.switches_skipped + skipped_dispatch_switches,
            enum_values_resolved=len(self.enum_values),
            initializers_requested=self.initializers_requested,
            initializers_analyzed=self.initializers_analyzed,
            struct_layouts_resolved=len(self.layouts),
            struct_layouts_failed=len(self.layout_failures),
            inactive_region_files=inactive_region_files,
        )


class _ClangdClient:
    def __init__(self, executable: Path, compile_commands_directory: Path) -> None:
        self.executable = executable
        self.compile_commands_directory = compile_commands_directory
        self.process: subprocess.Popen[bytes] | None = None
        self.messages: Queue[dict[str, Any]] = Queue()
        self.stderr_lines: list[str] = []
        self.next_id = 1
        self.write_lock = Lock()
        self.opened_uris: set[str] = set()
        # Schema 4: ``textDocument/inactiveRegions`` notifications (uri -> 1-based
        # inclusive line ranges) and raw documentSymbol results for struct layouts.
        self.inactive_regions: dict[str, tuple[tuple[int, int], ...]] = {}
        self.raw_symbols: dict[str, list[dict[str, Any]]] = {}
        # raw_symbols 的键被小写化了（Windows 上同一个文件的 uri 大小写不止一种写法），
        # 但 clangd 只认它自己收到过的那一个。拿小写键去问会得到
        # "trying to get AST for non-added document"，所以原样留一份。
        self.symbol_uris: dict[str, str] = {}
        # 被调函数的声明位置。以前它编在 ID 的行号里，现在 ID 不带行号了，
        # externalSymbols 的 declaredIn 还要用，所以单独记一份。
        self.declaration_sites: dict[str, SourceLocation] = {}
        # 语义 token 的类别表（initialize 应答里的 legend），解码 semanticTokens/full 时用
        self.semantic_token_types: list[str] = []

    def start(self, project: Path) -> None:
        self.process = subprocess.Popen(
            [
                str(self.executable),
                f"--compile-commands-dir={self.compile_commands_directory}",
                "--background-index",
                "--pch-storage=memory",
                "--log=error",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        Thread(target=self._read_stdout, daemon=True).start()
        Thread(target=self._read_stderr, daemon=True).start()
        initialized = self._request(
            "initialize",
            {
                "processId": None,
                "rootUri": project.as_uri(),
                "capabilities": {
                    "textDocument": {
                        "documentSymbol": {"hierarchicalDocumentSymbolSupport": True},
                        "inactiveRegionsCapabilities": {"inactiveRegions": True},
                        "semanticTokens": {
                            "requests": {"full": True},
                            "tokenTypes": ["macro"],
                            "tokenModifiers": [],
                            "formats": ["relative"],
                        },
                    }
                },
            },
            timeout=30,
        )
        legend = (((initialized or {}).get("capabilities") or {}).get("semanticTokensProvider") or {}).get("legend") or {}
        self.semantic_token_types = [str(item) for item in legend.get("tokenTypes") or []]
        self._notify("initialized", {})

    def open(self, path: Path) -> tuple[str, str]:
        """``didOpen`` the file once; returns (uri, text)."""

        uri = path.as_uri()
        text = path.read_text(encoding="utf-8", errors="replace")
        if uri not in self.opened_uris:
            self._notify(
                "textDocument/didOpen",
                {
                    "textDocument": {
                        "uri": uri,
                        "languageId": "cpp" if path.suffix.lower() != ".c" else "c",
                        "version": 1,
                        "text": text,
                    }
                },
            )
            self.opened_uris.add(uri)
        return uri, text

    def document_symbols(
        self,
        path: Path,
        project: Path,
    ) -> tuple[
        list[_VariableCandidate],
        list[_FunctionCandidate],
        list[VariableSymbol],
        list[_AggregateCandidate],
    ]:
        uri, text = self.open(path)
        symbols = self._request(
            "textDocument/documentSymbol",
            {"textDocument": {"uri": uri}},
            timeout=45,
        ) or []
        self.raw_symbols[uri.lower()] = [item for item in symbols if isinstance(item, dict)]
        self.symbol_uris[uri.lower()] = uri
        lines = text.splitlines()
        masked_lines = _mask_comments_and_strings(text).splitlines()
        compile_branches = _compile_branches(masked_lines)
        global_candidates: list[_VariableCandidate] = []
        functions: list[_FunctionCandidate] = []
        variables: list[VariableSymbol] = []
        aggregates: list[_AggregateCandidate] = []
        relative_path = _relative(path, project)

        def visit(symbol: dict[str, Any], parent_function: str | None = None) -> None:
            kind = int(symbol.get("kind", 0))
            selection = symbol.get("selectionRange") or symbol.get("range") or {}
            start = selection.get("start") or {}
            line_index = int(start.get("line", 0))
            column_index = int(start.get("character", 0))
            name = str(symbol.get("name", ""))
            detail = str(symbol.get("detail", ""))
            current_function = parent_function

            if kind in FUNCTION_SYMBOL_KINDS:
                full_range = symbol.get("range") or {}
                range_start = int((full_range.get("start") or {}).get("line", line_index))
                range_end = full_range.get("end") or {}
                end_index = int(range_end.get("line", line_index))
                symbol_id = _symbol_id(relative_path, name)
                function_symbol = FunctionSymbol(
                    symbol_id=symbol_id,
                    name=name,
                    detail=detail,
                    location=SourceLocation(
                        path=relative_path,
                        line=line_index + 1,
                        column=column_index + 1,
                    ),
                    end_line=end_index + 1,
                    is_definition=_has_body(masked_lines, range_start, end_index),
                    compile_branch=(
                        compile_branches[line_index] if line_index < len(compile_branches) else None
                    ),
                )
                functions.append(
                    _FunctionCandidate(
                        symbol=function_symbol,
                        uri=uri,
                        position={"line": line_index, "character": column_index},
                        range=full_range if isinstance(full_range, dict) and full_range else None,
                    )
                )
                current_function = symbol_id

            if kind == VARIABLE_SYMBOL_KIND:
                range_start = int(
                    ((symbol.get("range") or {}).get("start") or {}).get(
                        "line", line_index
                    )
                )
                declaration_text = "\n".join(
                    lines[max(0, range_start) : line_index + 1]
                )
                storage = _storage_from_line(declaration_text)
                variable_id = _variable_id(relative_path, name)
                variables.append(
                    VariableSymbol(
                        symbol_id=variable_id,
                        name=name,
                        detail=detail,
                        scope="local" if current_function else storage,
                        location=SourceLocation(
                            path=relative_path,
                            line=line_index + 1,
                            column=column_index + 1,
                        ),
                        parent_function=current_function,
                    )
                )
                if current_function is None and storage != "extern":
                    global_candidates.append(
                        _VariableCandidate(
                            name=name,
                            type_name=detail,
                            storage=storage,
                            definition=SourceLocation(
                                path=relative_path,
                                line=line_index + 1,
                                column=column_index + 1,
                            ),
                            uri=uri,
                            position={"line": line_index, "character": column_index},
                        )
                    )
                    full_range = symbol.get("range")
                    range_end = int(((full_range or {}).get("end") or {}).get("line", line_index))
                    declaration = "\n".join(masked_lines[max(0, range_start) : range_end + 1])
                    if isinstance(full_range, dict) and "=" in declaration and "{" in declaration:
                        aggregates.append(
                            _AggregateCandidate(
                                symbol=variables[-1],
                                uri=uri,
                                position={"line": line_index, "character": column_index},
                                range=full_range,
                            )
                        )

            for child in symbol.get("children") or []:
                if isinstance(child, dict):
                    visit(child, current_function)

        for symbol in symbols:
            if isinstance(symbol, dict):
                visit(symbol)
        return global_candidates, functions, variables, aggregates

    def workspace_type_symbol(self, name: str) -> tuple[Path, int] | None:
        """Definition of the struct / union / enum / typedef called exactly ``name`` via workspace/symbol."""

        result = self._request("workspace/symbol", {"query": name}, timeout=15)
        for item in result or []:
            if not isinstance(item, dict) or str(item.get("name", "")) != name:
                continue
            if int(item.get("kind", 0)) not in {5, 10, 23}:
                continue
            location = item.get("location") or {}
            path = _uri_to_path(str(location.get("uri", "")))
            if path is None:
                continue
            start = (location.get("range") or {}).get("start") or {}
            return path, int(start.get("line", 0)) + 1
        return None

    def semantic_tokens(self, uri: str) -> list[int]:
        """Raw ``semanticTokens/full`` data of an opened document (relative encoding)."""

        result = self._request(
            "textDocument/semanticTokens/full",
            {"textDocument": {"uri": uri}},
            timeout=60,
        )
        data = (result or {}).get("data") if isinstance(result, dict) else None
        return [int(item) for item in data or []]

    def definition_location(self, uri: str, position: dict[str, int]) -> tuple[Path, int] | None:
        """(path, 1-based line) of the first ``textDocument/definition`` target, or None."""

        result = self._request(
            "textDocument/definition",
            {"textDocument": {"uri": uri}, "position": position},
            timeout=15,
        )
        locations = [result] if isinstance(result, dict) else [item for item in result or [] if isinstance(item, dict)]
        for location in locations:
            path = _uri_to_path(str(location.get("uri", "")))
            if path is None:
                continue
            start = (location.get("range") or {}).get("start") or {}
            return path, int(start.get("line", 0)) + 1
        return None

    def type_definition(self, uri: str, position: dict[str, int]) -> list[dict[str, Any]]:
        result = self._request(
            "textDocument/typeDefinition",
            {"textDocument": {"uri": uri}, "position": position},
            timeout=15,
        )
        if isinstance(result, dict):
            return [result]
        return [item for item in result or [] if isinstance(item, dict)]

    def value_at_definition(self, uri: str, position: dict[str, int]) -> str | None:
        """Hover the *definition* of the symbol at ``position``.

        An ``extern uint32_t SystemCoreClock;`` declaration carries no value; the initializer
        lives in the defining translation unit, so follow the definition first.
        """

        try:
            result = self._request(
                "textDocument/definition",
                {"textDocument": {"uri": uri}, "position": position},
                timeout=15,
            )
        except (OSError, TimeoutError, RuntimeError):
            return None
        locations = [result] if isinstance(result, dict) else [item for item in result or [] if isinstance(item, dict)]
        for location in locations:
            target_uri = str(location.get("uri", ""))
            path = _uri_to_path(target_uri)
            if path is None or not path.is_file():
                continue
            try:
                opened_uri, _ = self.open(path)
            except (OSError, TimeoutError, RuntimeError):
                continue
            start = (location.get("range") or {}).get("start") or {}
            try:
                value = self.macro_value(opened_uri, int(start.get("line", 0)), int(start.get("character", 0)))
            except (OSError, TimeoutError, RuntimeError):
                value = None
            if value is not None:
                return value
        return None

    def cache_symbols_of_definition(self, uri: str, position: dict[str, int]) -> None:
        """Open the file defining the symbol at ``position`` (usually a header) and cache its
        documentSymbol tree, so enums declared in headers are visible to _collect_enums."""

        result = self._request(
            "textDocument/definition",
            {"textDocument": {"uri": uri}, "position": position},
            timeout=15,
        )
        locations = [result] if isinstance(result, dict) else [item for item in result or [] if isinstance(item, dict)]
        for location in locations:
            target_uri = str(location.get("uri", ""))
            if self.raw_symbols.get(target_uri.lower()) is not None:
                continue
            path = _uri_to_path(target_uri)
            if path is None or not path.is_file():
                continue
            opened_uri, _ = self.open(path)
            symbols = self._request(
                "textDocument/documentSymbol",
                {"textDocument": {"uri": opened_uri}},
                timeout=45,
            ) or []
            self.raw_symbols[opened_uri.lower()] = [item for item in symbols if isinstance(item, dict)]
            self.symbol_uris[opened_uri.lower()] = opened_uri

    def struct_layout(self, uri: str, position: dict[str, int]) -> tuple[str, ...] | None:
        """Field names, in declaration order, of the struct type of the variable at ``position``.

        ``typeDefinition`` points at the struct (or its typedef); the ``documentSymbol``
        tree of that file lists the struct's fields as children.
        """

        for location in self.type_definition(uri, position):
            target_uri = str(location.get("uri", ""))
            path = _uri_to_path(target_uri)
            if path is None or not path.is_file():
                continue
            start = (location.get("range") or {}).get("start") or {}
            line = int(start.get("line", 0))
            symbols = self.raw_symbols.get(target_uri.lower())
            if symbols is None:
                opened_uri, _ = self.open(path)
                symbols = self._request(
                    "textDocument/documentSymbol",
                    {"textDocument": {"uri": opened_uri}},
                    timeout=45,
                ) or []
                symbols = [item for item in symbols if isinstance(item, dict)]
                self.raw_symbols[opened_uri.lower()] = symbols
                self.symbol_uris[opened_uri.lower()] = opened_uri
            fields = _struct_fields_at(symbols, line)
            if fields:
                return fields
        return None

    def drain(self, seconds: float) -> None:
        """Process notifications that are still queued (nothing is waiting for a response)."""

        deadline = time.monotonic() + seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            try:
                message = self.messages.get(timeout=remaining)
            except Empty:
                return
            if "id" in message and "method" in message:
                self._send({"jsonrpc": "2.0", "id": message["id"], "result": None})
            elif "method" in message:
                self._on_notification(message)

    def _on_notification(self, message: dict[str, Any]) -> None:
        if message.get("method") != "textDocument/inactiveRegions":
            return
        params = message.get("params") or {}
        uri = str(((params.get("textDocument") or {}).get("uri")) or "")
        regions: list[tuple[int, int]] = []
        for region in params.get("regions") or []:
            if not isinstance(region, dict):
                continue
            start = int(((region.get("start") or {}).get("line")) or 0) + 1
            end = int(((region.get("end") or {}).get("line")) or 0) + 1
            regions.append((start, max(start, end)))
        if uri:
            self.inactive_regions[uri.lower()] = tuple(sorted(regions))

    def outgoing_calls(
        self,
        function: _FunctionCandidate,
        project: Path,
    ) -> tuple[SemanticEdge, ...]:
        prepared = self._request(
            "textDocument/prepareCallHierarchy",
            {
                "textDocument": {"uri": function.uri},
                "position": function.position,
            },
            timeout=15,
        ) or []
        if not prepared:
            return ()
        calls = self._request(
            "callHierarchy/outgoingCalls",
            {"item": prepared[0]},
            timeout=20,
        ) or []
        edges: list[SemanticEdge] = []
        for call in calls:
            target = call.get("to") if isinstance(call, dict) else None
            if not isinstance(target, dict):
                continue
            target_path = _uri_to_path(str(target.get("uri", "")))
            if target_path is None or not _is_within(target_path, project):
                continue
            target_start = (target.get("selectionRange") or target.get("range") or {}).get(
                "start", {}
            )
            target_name = str(target.get("name", ""))
            target_relative = _relative(target_path, project)
            target_id = _symbol_id(target_relative, target_name)
            self.declaration_sites.setdefault(
                target_id,
                SourceLocation(
                    path=target_relative,
                    line=int(target_start.get("line", 0)) + 1,
                    column=int(target_start.get("character", 0)) + 1,
                ),
            )
            source_path = function.symbol.location.path
            locations = tuple(
                SourceLocation(
                    path=source_path,
                    line=int((item.get("start") or {}).get("line", 0)) + 1,
                    column=int((item.get("start") or {}).get("character", 0)) + 1,
                )
                for item in call.get("fromRanges") or []
                if isinstance(item, dict)
            )
            edges.append(
                SemanticEdge(
                    source=function.symbol.symbol_id,
                    target=target_id,
                    relation="calls",
                    locations=locations,
                )
            )
        return tuple(edges)

    def references(
        self,
        candidate: _VariableCandidate,
        project: Path,
    ) -> tuple[SourceLocation, ...]:
        locations = self._request(
            "textDocument/references",
            {
                "textDocument": {"uri": candidate.uri},
                "position": candidate.position,
                "context": {"includeDeclaration": False},
            },
            timeout=30,
        ) or []
        references: set[tuple[str, int, int]] = set()
        for location in locations:
            if not isinstance(location, dict):
                continue
            path = _uri_to_path(str(location.get("uri", "")))
            if path is None or not _is_within(path, project):
                continue
            start = (location.get("range") or {}).get("start") or {}
            references.add(
                (
                    _relative(path, project),
                    int(start.get("line", 0)) + 1,
                    int(start.get("character", 0)) + 1,
                )
            )
        return tuple(
            SourceLocation(path=path, line=line, column=column)
            for path, line, column in sorted(references)
        )

    def ast(self, uri: str, range_: dict[str, Any]) -> Any:
        """Simplified AST of the node covering ``range_`` (clangd extension)."""

        return self._request(
            "textDocument/ast",
            {"textDocument": {"uri": uri}, "range": range_},
            timeout=60,
        )

    def macro_value(self, uri: str, line: int, character: int) -> str | None:
        """Body of an object-like macro (``#define PERIOD_MS 100``) or an enumerator / const value
        from clangd's hover, or None.  Only a single-token body is returned."""

        result = self._request(
            "textDocument/hover",
            {"textDocument": {"uri": uri}, "position": {"line": line, "character": character}},
            timeout=15,
        )
        contents = result.get("contents") if isinstance(result, dict) else None
        if isinstance(contents, dict):
            text = str(contents.get("value", ""))
        elif isinstance(contents, list):
            text = "\n".join(str(item.get("value", item)) if isinstance(item, dict) else str(item) for item in contents)
        else:
            text = str(contents or "")
        value = _HOVER_VALUE_PATTERN.search(text)
        if value is not None:
            return value.group(1).strip()
        expands = re.search(r"Expands to\s*```[a-z]*\s*\n(.*?)\n```", text, re.S)
        if expands is not None:
            body = expands.group(1).strip()
            return body if body else None
        define = re.search(r"#define\s+\w+\s+(.+)", text)
        return define.group(1).strip() if define else None

    def enumerator_value(self, uri: str, line: int, character: int) -> str | None:
        """``Value = ...`` from clangd's hover on an enumerator, or None."""

        result = self._request(
            "textDocument/hover",
            {"textDocument": {"uri": uri}, "position": {"line": line, "character": character}},
            timeout=15,
        )
        contents = result.get("contents") if isinstance(result, dict) else None
        if isinstance(contents, dict):
            text = str(contents.get("value", ""))
        elif isinstance(contents, list):
            text = "\n".join(str(item.get("value", item)) if isinstance(item, dict) else str(item) for item in contents)
        else:
            text = str(contents or "")
        match = _HOVER_VALUE_PATTERN.search(text)
        return match.group(1).strip() if match else None

    def close(self) -> None:
        if self.process is None:
            return
        if self.process.poll() is None:
            try:
                self._request("shutdown", None, timeout=5)
                self._notify("exit", None)
                self.process.wait(timeout=5)
            except (OSError, TimeoutError, subprocess.TimeoutExpired):
                self.process.terminate()
        self.process = None

    def _request(self, method: str, params: Any, timeout: float) -> Any:
        request_id = self.next_id
        self.next_id += 1
        self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"clangd request timed out: {method}")
            try:
                message = self.messages.get(timeout=remaining)
            except Empty as exc:
                raise TimeoutError(f"clangd request timed out: {method}") from exc
            if message.get("id") == request_id and "method" not in message:
                if "error" in message:
                    raise RuntimeError(str(message["error"]))
                return message.get("result")
            if "id" in message and "method" in message:
                self._send({"jsonrpc": "2.0", "id": message["id"], "result": None})
            elif "method" in message:
                self._on_notification(message)

    def _notify(self, method: str, params: Any) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def _send(self, message: dict[str, Any]) -> None:
        if self.process is None or self.process.stdin is None:
            raise RuntimeError("clangd is not running")
        payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
        header = f"Content-Length: {len(payload)}\r\n\r\n".encode("ascii")
        with self.write_lock:
            self.process.stdin.write(header + payload)
            self.process.stdin.flush()

    def _read_stdout(self) -> None:
        if self.process is None or self.process.stdout is None:
            return
        stream = self.process.stdout
        while True:
            headers: dict[str, str] = {}
            while True:
                line = stream.readline()
                if not line:
                    return
                if line in {b"\r\n", b"\n"}:
                    break
                key, _, value = line.decode("ascii", errors="replace").partition(":")
                headers[key.lower()] = value.strip()
            length = int(headers.get("content-length", "0"))
            if length <= 0:
                continue
            payload = stream.read(length)
            try:
                self.messages.put(json.loads(payload.decode("utf-8")))
            except json.JSONDecodeError:
                continue

    def _read_stderr(self) -> None:
        if self.process is None or self.process.stderr is None:
            return
        for line in self.process.stderr:
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                self.stderr_lines.append(text)
                del self.stderr_lines[:-50]


def find_clangd() -> Path | None:
    executable = shutil.which("clangd")
    if executable:
        return Path(executable)
    candidates = [
        Path(os.environ.get("CLANGD_PATH", "")),
        Path(os.environ.get("ProgramFiles", "C:/Program Files"))
        / "LLVM"
        / "bin"
        / "clangd.exe",
        Path(os.environ.get("LOCALAPPDATA", ""))
        / "Programs"
        / "LLVM"
        / "bin"
        / "clangd.exe",
    ]
    return next((item.resolve() for item in candidates if item.is_file()), None)


def _storage_from_line(line: str) -> str:
    if re.search(r"\bextern\b", line):
        return "extern"
    if re.search(r"\bstatic\b", line):
        return "static"
    return "global"


def _deduplicate_candidates(
    candidates: list[_VariableCandidate],
) -> tuple[_VariableCandidate, ...]:
    unique: dict[tuple[str, int, str], _VariableCandidate] = {}
    for candidate in candidates:
        key = (candidate.definition.path, candidate.definition.line, candidate.name)
        unique[key] = candidate
    return tuple(unique[key] for key in sorted(unique))


def _deduplicate_functions(
    candidates: list[_FunctionCandidate],
) -> tuple[_FunctionCandidate, ...]:
    unique: dict[str, _FunctionCandidate] = {}
    for candidate in candidates:
        unique[candidate.symbol.symbol_id] = candidate
    return tuple(unique[key] for key in sorted(unique))


def _deduplicate_variable_symbols(
    variables: list[VariableSymbol],
) -> tuple[VariableSymbol, ...]:
    unique = {variable.symbol_id: variable for variable in variables}
    return tuple(unique[key] for key in sorted(unique))


def _split_definitions(
    candidates: tuple[_FunctionCandidate, ...],
) -> tuple[tuple[_FunctionCandidate, ...], tuple[_FunctionCandidate, ...]]:
    definitions = tuple(item for item in candidates if item.symbol.is_definition)
    declarations = tuple(item for item in candidates if not item.symbol.is_definition)
    return definitions, declarations


def _header_call_targets(
    edges: list[SemanticEdge] | tuple[SemanticEdge, ...],
    known_ids: set[str],
    project: Path,
) -> set[Path]:
    """Headers inside the project that unresolved call targets point at."""

    headers: set[Path] = set()
    for edge in edges:
        if edge.relation != "calls" or edge.target in known_ids:
            continue
        parsed = _split_symbol_id(edge.target)
        if parsed is None:
            continue
        relative = Path(parsed[0])
        if relative.suffix.lower() not in HEADER_SUFFIXES:
            continue
        absolute = project / relative
        if absolute.is_file() and _is_within(absolute, project):
            headers.add(absolute)
    return headers


def _harvest_header_definitions(
    client: _ClangdClient,
    project: Path,
    call_edges: list[SemanticEdge],
    definitions: tuple[_FunctionCandidate, ...],
    warnings: list[str],
    ast_collector: _AstCollector | None = None,
) -> tuple[list[_FunctionCandidate], list[VariableSymbol], list[SemanticEdge]]:
    """Collect function bodies defined in headers that existing calls point at.

    Only definitions are taken from a header (declarations stay with the translation
    units so ``externDeclarations`` keeps one consistent source).  Calls made from the
    harvested bodies are followed so a header helper calling another header helper is
    collected as well.
    """

    known = {item.symbol.symbol_id for item in definitions}
    visited: set[Path] = set()
    harvested: list[_FunctionCandidate] = []
    locals_: list[VariableSymbol] = []
    new_edges: list[SemanticEdge] = []
    pending = list(call_edges)
    while True:
        headers = _header_call_targets(pending, known, project) - visited
        if not headers:
            break
        pending = []
        for header in sorted(headers):
            visited.add(header)
            try:
                _, functions, variables, _ = client.document_symbols(header, project)
            except (OSError, TimeoutError, RuntimeError) as exc:
                warnings.append(f"{_relative(header, project)}: {exc}")
                continue
            harvested_ids: set[str] = set()
            harvested_here: list[_FunctionCandidate] = []
            for candidate in functions:
                if not candidate.symbol.is_definition or candidate.symbol.symbol_id in known:
                    continue
                marked = _FunctionCandidate(
                    symbol=replace(candidate.symbol, defined_in_header=True),
                    uri=candidate.uri,
                    position=candidate.position,
                    range=candidate.range,
                )
                harvested.append(marked)
                harvested_here.append(marked)
                known.add(marked.symbol.symbol_id)
                harvested_ids.add(marked.symbol.symbol_id)
                try:
                    pending.extend(client.outgoing_calls(marked, project))
                except (OSError, TimeoutError, RuntimeError) as exc:
                    warnings.append(
                        f"{marked.symbol.location.path}:{marked.symbol.location.line}: {exc}"
                    )
            if ast_collector is not None:
                ast_collector.collect(header, harvested_here)
            locals_.extend(
                variable for variable in variables if variable.parent_function in harvested_ids
            )
        new_edges.extend(pending)
    return harvested, locals_, new_edges


def _has_body(masked_lines: list[str], start_index: int, end_index: int) -> bool:
    start = max(0, start_index)
    end = min(len(masked_lines), end_index + 1)
    return any("{" in line for line in masked_lines[start:end])


def _index_by_name(functions: tuple[FunctionSymbol, ...]) -> dict[str, list[FunctionSymbol]]:
    by_name: dict[str, list[FunctionSymbol]] = {}
    for function in functions:
        by_name.setdefault(function.name, []).append(function)
    return by_name


def _extern_declarations(
    declarations: tuple[FunctionSymbol, ...],
    definitions_by_name: dict[str, list[FunctionSymbol]],
) -> tuple[ExternDeclaration, ...]:
    """Keep declarations that are not forward declarations of a same-file definition."""

    results: list[ExternDeclaration] = []
    seen: set[tuple[str, int, str]] = set()
    for declaration in declarations:
        same_file = [
            item
            for item in definitions_by_name.get(declaration.name, [])
            if item.location.path == declaration.location.path
        ]
        if same_file:
            continue
        key = (declaration.location.path, declaration.location.line, declaration.name)
        if key in seen:
            continue
        seen.add(key)
        resolved = _resolve_definition(
            declaration.name, declaration.location.path, definitions_by_name
        )
        results.append(
            ExternDeclaration(
                name=declaration.name,
                declared_in=declaration.location,
                resolves_to=resolved.symbol_id if resolved is not None else None,
                via_header=Path(declaration.location.path).suffix.lower() in HEADER_SUFFIXES,
            )
        )
    results.sort(key=lambda item: (item.declared_in.path, item.declared_in.line, item.name))
    return tuple(results)


def _resolve_call_targets(
    edges: tuple[SemanticEdge, ...],
    functions: tuple[FunctionSymbol, ...],
    definitions_by_name: dict[str, list[FunctionSymbol]],
) -> tuple[tuple[SemanticEdge, ...], dict[str, list[SemanticEdge]]]:
    """Point every call at a definition; clangd may report the declaration it saw instead.

    Returns the resolved edges and, keyed by callee name, the edges whose callee has no
    definition anywhere in the compilation database (library code, files left out of
    the database).  Those become ``external:<name>`` calls, see ``_external_symbols``.
    """

    definition_ids = {function.symbol_id for function in functions}
    resolved: list[SemanticEdge] = []
    dropped: dict[str, list[SemanticEdge]] = {}
    for edge in edges:
        if edge.target in definition_ids:
            resolved.append(edge)
            continue
        parsed_target = _split_symbol_id(edge.target)
        parsed_source = _split_symbol_id(edge.source)
        if parsed_target is None or parsed_source is None:
            dropped.setdefault(edge.target, []).append(edge)
            continue
        definition = _resolve_definition(parsed_target[1], parsed_source[0], definitions_by_name)
        if definition is None:
            dropped.setdefault(parsed_target[1], []).append(edge)
            continue
        resolved.append(replace(edge, target=definition.symbol_id))
    return tuple(resolved), dropped


def _external_symbols(
    dropped: dict[str, list[SemanticEdge]],
    declarations: tuple[FunctionSymbol, ...],
    declaration_sites: dict[str, SourceLocation],
    project: Path,
) -> tuple[tuple[SemanticEdge, ...], tuple[ExternalSymbol, ...]]:
    """Keep calls to declared-but-undefined functions as edges to ``external:<name>``."""

    declared: dict[str, list[SourceLocation]] = {}
    for declaration in declarations:
        declared.setdefault(declaration.name, []).append(declaration.location)
    edges: list[SemanticEdge] = []
    symbols: list[ExternalSymbol] = []
    library_cache: dict[str, tuple[str, ...]] = {}
    for name in sorted(dropped):
        symbol_id = f"external:{name}"
        locations = list(declared.get(name, []))
        for edge in dropped[name]:
            location = declaration_sites.get(edge.target)
            if location is not None:
                if not any(item.path == location.path and item.line == location.line for item in locations):
                    locations.append(location)
            edges.append(replace(edge, target=symbol_id))
        locations.sort(key=lambda item: (item.path, item.line))
        candidates: list[str] = []
        for directory in dict.fromkeys(str(Path(item.path).parent.as_posix()) for item in locations):
            if directory not in library_cache:
                library_cache[directory] = _library_files(project, directory)
            candidates.extend(item for item in library_cache[directory] if item not in candidates)
        symbols.append(
            ExternalSymbol(
                symbol_id=symbol_id,
                name=name,
                declared_in=tuple(locations),
                library=_pick_library(candidates),
                library_candidates=tuple(candidates),
            )
        )
    return tuple(edges), tuple(symbols)


def _library_files(project: Path, directory: str) -> tuple[str, ...]:
    folder = project / directory if directory not in {"", "."} else project
    try:
        children = sorted(folder.iterdir(), key=lambda item: _natural_key(item.name))
    except OSError:
        return ()
    return tuple(
        (Path(directory) / child.name).as_posix() if directory not in {"", "."} else child.name
        for child in children
        if child.is_file() and child.suffix.lower() in LIBRARY_SUFFIXES
    )


def _natural_key(text: str) -> tuple:
    return tuple(int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text))


def _pick_library(candidates: list[str]) -> str | None:
    """Several versions of one library side by side: prefer the highest version number."""

    if not candidates:
        return None
    return max(candidates, key=lambda item: _natural_key(Path(item).name))


def _attach_external_callers(
    symbols: tuple[ExternalSymbol, ...],
    edges: tuple[SemanticEdge, ...],
) -> tuple[ExternalSymbol, ...]:
    callers: dict[str, set[str]] = {}
    for edge in edges:
        if edge.relation == "calls" and edge.target.startswith("external:"):
            callers.setdefault(edge.target, set()).add(edge.source)
    return tuple(replace(symbol, callers=tuple(sorted(callers.get(symbol.symbol_id, ())))) for symbol in symbols)


def _type_symbol_location(
    symbol_trees: dict[str, list[dict[str, Any]]], name: str
) -> tuple[Path, int] | None:
    """A struct / union / enum / typedef symbol called ``name`` in any cached documentSymbol tree."""

    for uri, symbols in symbol_trees.items():
        for symbol in symbols:
            if int(symbol.get("kind", 0)) in {5, 10, 23} and str(symbol.get("name", "")) == name:
                path = _uri_to_path(uri)
                if path is None:
                    continue
                start = ((symbol.get("selectionRange") or symbol.get("range") or {}).get("start") or {})
                return path, int(start.get("line", 0)) + 1
    return None


def _struct_fields_at(symbols: list[dict[str, Any]], line: int) -> tuple[str, ...] | None:
    """Fields of the struct / union symbol whose range covers ``line`` (0-based)."""

    best: tuple[int, tuple[str, ...]] | None = None

    def visit(symbol: dict[str, Any]) -> None:
        nonlocal best
        kind = int(symbol.get("kind", 0))
        span = symbol.get("range") or {}
        start = int((span.get("start") or {}).get("line", -1))
        end = int((span.get("end") or {}).get("line", -1))
        children = [child for child in symbol.get("children") or [] if isinstance(child, dict)]
        fields = tuple(str(child.get("name", "")) for child in children if int(child.get("kind", 0)) == 8)
        if kind in {5, 23} and fields and start <= line <= end:
            size = end - start
            if best is None or size < best[0]:
                best = (size, fields)
        for child in children:
            visit(child)

    for symbol in symbols:
        visit(symbol)
    return best[1] if best else None


def _inactive_facts(
    inactive_by_uri: dict[str, tuple[tuple[int, int], ...]],
    opened_uris: set[str],
    project: Path,
) -> tuple[tuple[InactiveRegions, ...], tuple[InactiveFunction, ...]]:
    """Per opened file: clangd's inactive preprocessor regions and the definitions inside them."""

    regions_out: list[InactiveRegions] = []
    functions_out: list[InactiveFunction] = []
    for uri in sorted(opened_uris):
        path = _uri_to_path(uri)
        if path is None or not path.is_file() or not _is_within(path, project):
            continue
        regions = inactive_by_uri.get(uri.lower())
        kind = "translation-unit" if path.suffix.lower() in SOURCE_SUFFIXES else "header"
        if regions is None or (kind == "header" and not regions):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        lines = text.splitlines()
        relative = _relative(path, project)
        regions_out.append(
            InactiveRegions(
                path=relative,
                regions=regions,
                inactive_lines=sum(end - start + 1 for start, end in regions),
                total_lines=len(lines),
                kind=kind,
            )
        )
        if regions:
            masked = _mask_comments_and_strings(text).splitlines()
            for name, line, region in scan_inactive_functions(masked, regions):
                functions_out.append(InactiveFunction(name=name, path=relative, line=line, region=region))
    regions_out.sort(key=lambda item: item.path)
    functions_out.sort(key=lambda item: (item.path, item.line))
    return tuple(regions_out), tuple(functions_out)


def _strip_calls_displaced_by_address_of(
    edges: tuple[SemanticEdge, ...],
) -> tuple[SemanticEdge, ...]:
    """A function name passed as an argument is not a call, even if clangd reported one."""

    address_lines: dict[tuple[str, str], set[tuple[str, int]]] = {}
    for edge in edges:
        if edge.relation == "address_of":
            address_lines.setdefault((edge.source, edge.target), set()).update(
                (location.path, location.line) for location in edge.locations
            )

    kept: list[SemanticEdge] = []
    for edge in edges:
        if edge.relation != "calls":
            kept.append(edge)
            continue
        displaced = address_lines.get((edge.source, edge.target))
        if not displaced:
            kept.append(edge)
            continue
        remaining = tuple(
            location
            for location in edge.locations
            if (location.path, location.line) not in displaced
        )
        if remaining:
            kept.append(replace(edge, locations=remaining))
    return tuple(kept)


_DIRECTIVE_PATTERN = re.compile(r"^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b\s*(.*)$")


def _compile_branches(masked_lines: list[str]) -> list[str | None]:
    """For each line, the conjunction of #if conditions it sits under (text only)."""

    frames: list[tuple[list[str], str | None]] = []
    branches: list[str | None] = []
    for line in masked_lines:
        match = _DIRECTIVE_PATTERN.match(line)
        if match:
            kind = match.group(1)
            expression = match.group(2).strip()
            if kind == "if":
                frames.append(([], expression))
            elif kind == "ifdef":
                frames.append(([], f"defined({expression})"))
            elif kind == "ifndef":
                frames.append(([], f"!defined({expression})"))
            elif kind == "elif" and frames:
                prior, current = frames[-1]
                frames[-1] = (prior + ([current] if current is not None else []), expression)
            elif kind == "else" and frames:
                prior, current = frames[-1]
                frames[-1] = (prior + ([current] if current is not None else []), None)
            elif kind == "endif" and frames:
                frames.pop()
        branches.append(_render_branch(frames))
    return branches


def _render_branch(frames: list[tuple[list[str], str | None]]) -> str | None:
    parts: list[str] = []
    for prior, current in frames:
        parts.extend(f"!({condition})" for condition in prior)
        if current is not None:
            parts.append(current if re.fullmatch(r"!?defined\(\w+\)|\w+", current) else f"({current})")
    return " && ".join(parts) or None


def _variable_reference_edges(
    functions: tuple[FunctionSymbol, ...],
    variables: tuple[VariableSymbol, ...],
    globals_: list[GlobalVariable],
) -> tuple[SemanticEdge, ...]:
    functions_by_path: dict[str, list[FunctionSymbol]] = {}
    for function in functions:
        functions_by_path.setdefault(function.location.path, []).append(function)
    for items in functions_by_path.values():
        items.sort(key=lambda item: (item.end_line - item.location.line, item.location.line))

    edges: list[SemanticEdge] = []
    for variable in variables:
        if variable.parent_function:
            edges.append(
                SemanticEdge(
                    source=variable.parent_function,
                    target=variable.symbol_id,
                    relation="declares",
                )
            )

    variable_ids = {
        (item.location.path, item.location.line, item.name): item.symbol_id
        for item in variables
    }
    for variable in globals_:
        target = variable_ids.get(
            (variable.definition.path, variable.definition.line, variable.name),
            _variable_id(variable.definition.path, variable.name),
        )
        grouped: dict[str, list[SourceLocation]] = {}
        for reference in variable.references:
            owner = next(
                (
                    function
                    for function in functions_by_path.get(reference.path, [])
                    if function.location.line <= reference.line <= function.end_line
                ),
                None,
            )
            if owner is not None:
                grouped.setdefault(owner.symbol_id, []).append(reference)
        for source, locations in grouped.items():
            edges.append(
                SemanticEdge(
                    source=source,
                    target=target,
                    relation="references",
                    locations=tuple(locations),
                )
            )
    return tuple(edges)


def _deduplicate_semantic_edges(
    edges: tuple[SemanticEdge, ...],
) -> tuple[SemanticEdge, ...]:
    grouped: dict[tuple, set[tuple[str, int, int]]] = {}
    extras: dict[tuple, tuple[str | None, dict[str, Any] | None]] = {}
    for edge in edges:
        evidence_key = json.dumps(edge.evidence, sort_keys=True, ensure_ascii=False) if edge.evidence is not None else None
        key = (
            edge.source,
            edge.target,
            edge.relation,
            edge.argument_index,
            edge.callee,
            edge.rule,
            edge.confidence,
            evidence_key,
        )
        locations = grouped.setdefault(key, set())
        locations.update(
            (item.path, item.line, item.column) for item in edge.locations
        )
        extras.setdefault(key, (edge.confidence, edge.evidence))

    def sort_key(key: tuple) -> tuple:
        source, target, relation, argument_index, callee, rule, confidence, evidence_key = key
        return (source, target, relation, argument_index or -1, callee or "", rule or "", confidence or "", evidence_key or "")

    result: list[SemanticEdge] = []
    for key in sorted(grouped, key=sort_key):
        source, target, relation, argument_index, callee, rule, _, _ = key
        confidence, evidence = extras[key]
        result.append(
            SemanticEdge(
                source=source,
                target=target,
                relation=relation,
                locations=tuple(
                    SourceLocation(path=path, line=line, column=column)
                    for path, line, column in sorted(grouped[key])
                ),
                argument_index=argument_index,
                callee=callee,
                rule=rule,
                confidence=confidence,
                evidence=evidence,
            )
        )
    return tuple(result)


def _supplement_source_edges(
    clangd_edges: tuple[SemanticEdge, ...],
    source_edges: tuple[SemanticEdge, ...],
) -> tuple[SemanticEdge, ...]:
    known_calls = {
        (edge.source, edge.target)
        for edge in clangd_edges
        if edge.relation == "calls"
    }
    return tuple(
        edge
        for edge in source_edges
        if edge.relation != "calls" or (edge.source, edge.target) not in known_calls
    )


_DOXYGEN_COMMENT_PATTERN = re.compile(
    r"/\*[*!].*?\*/|(?:^[ \t]*//[/!][^\n]*(?:\n|$))+",
    re.DOTALL | re.MULTILINE,
)
_DOXYGEN_COMMAND_PATTERN = re.compile(
    r"(?:^|\s)[@\\](brief|details|param|return|returns|retval|note|warning)\b",
    re.IGNORECASE,
)


def _attach_doxygen_documentation(
    functions: tuple[FunctionSymbol, ...],
    project: Path,
) -> tuple[FunctionSymbol, ...]:
    source_cache: dict[str, str] = {}
    enriched = []
    for function in functions:
        source = source_cache.get(function.location.path)
        if source is None:
            try:
                source = (project / Path(function.location.path)).read_text(
                    encoding="utf-8", errors="replace"
                )
            except OSError:
                source = ""
            source_cache[function.location.path] = source
        documentation = _doxygen_before_line(source, function.location.line)
        enriched.append(replace(function, documentation=documentation))
    return tuple(enriched)


def _doxygen_before_line(
    source: str, line_number: int
) -> DoxygenDocumentation | None:
    line_starts = [0]
    line_starts.extend(match.end() for match in re.finditer(r"\n", source))
    line_index = max(0, min(len(line_starts) - 1, line_number - 1))
    prefix = source[: line_starts[line_index]]
    matches = list(_DOXYGEN_COMMENT_PATTERN.finditer(prefix))
    if not matches:
        return None
    comment = matches[-1]
    gap = prefix[comment.end() :]
    if gap.count("\n") > 12 or re.search(r"[;}]", gap):
        return None
    return _parse_doxygen_comment(comment.group())


def _parse_doxygen_comment(content: str) -> DoxygenDocumentation | None:
    lines = []
    for raw_line in content.splitlines():
        line = re.sub(r"^\s*/\*[*!]?", "", raw_line)
        line = re.sub(r"\*/\s*$", "", line)
        line = re.sub(r"^\s*\*?\s?", "", line)
        line = re.sub(r"^//[/!]\s?", "", line)
        if line.strip():
            lines.append(line.strip())
    text = " ".join(lines).strip()
    if not text:
        return None

    commands = list(_DOXYGEN_COMMAND_PATTERN.finditer(text))
    brief = text[: commands[0].start()].strip() if commands else text
    params: list[tuple[str, str]] = []
    returns = ""
    notes: list[str] = []
    warnings: list[str] = []
    for index, command in enumerate(commands):
        end = commands[index + 1].start() if index + 1 < len(commands) else len(text)
        value = text[command.end() : end].strip()
        tag = command.group(1).lower()
        if tag == "brief":
            brief = value
        elif tag == "details":
            if value:
                notes.append(value)
        elif tag == "param":
            match = re.match(r"(?:\[[^]]+\]\s*)?([^\s]+)\s*(.*)", value)
            if match:
                params.append((match.group(1), match.group(2).strip()))
        elif tag in {"return", "returns", "retval"}:
            returns = value
        elif tag == "note" and value:
            notes.append(value)
        elif tag == "warning" and value:
            warnings.append(value)

    documentation = DoxygenDocumentation(
        brief=brief,
        params=tuple(params),
        returns=returns,
        notes=tuple(notes),
        warnings=tuple(warnings),
    )
    return documentation if any(
        (brief, params, returns, notes, warnings)
    ) else None


_CALL_PATTERN = re.compile(r"\b([A-Za-z_]\w*)\s*\(")
_FUNCTION_ARGUMENT_PATTERN = re.compile(
    # ``fn`` / ``&fn`` / ``(cast) fn`` / ``Class::fn`` / ``&Class::fn``（C++ 静态成员当入口）
    r"^\s*(?:\(\s*[\w\s\*]+\)\s*)*&?\s*((?:[A-Za-z_]\w*::)*[A-Za-z_]\w*)\s*$"
)
_IRQ_ARGUMENT_PATTERN = re.compile(
    r"^\s*(?:\(\s*[\w\s\*]+\)\s*)*([A-Za-z_]\w*|\d+)\s*$"
)
_CALL_KEYWORDS = {
    "if",
    "for",
    "while",
    "switch",
    "sizeof",
    "return",
    "defined",
    "alignof",
    "_Alignof",
}


def _source_relationship_edges(
    functions: tuple[FunctionSymbol, ...],
    project: Path,
    rules: FrameworkRules | None = None,
    variables: tuple[VariableSymbol, ...] = (),
) -> tuple[tuple[SemanticEdge, ...], tuple[EnableSite, ...]]:
    """Text-level facts clangd does not give us.

    * ``calls`` for call expressions clangd missed (inactive branches, macros);
    * ``address_of`` when a defined function's name is an argument of a call;
    * ``registers_task`` / ``registers_callback`` when a rule interprets that argument;
    * ISR enable sites (resolved against the vector table by the caller).
    """

    rules = rules or BUILTIN_RULES
    source_cache: dict[str, str] = {}
    definitions: list[FunctionSymbol] = []
    for function in functions:
        source = _masked_source(source_cache, project, function.location.path)
        lines = source.splitlines(keepends=True)
        start = max(0, function.location.line - 1)
        end = min(len(lines), function.end_line)
        if "{" in "".join(lines[start:end]):
            definitions.append(function)

    by_name = _index_by_name(tuple(definitions))
    locals_by_function: dict[str, set[str]] = {}
    file_globals: dict[str, set[str]] = {}
    for variable in variables:
        if variable.parent_function:
            locals_by_function.setdefault(variable.parent_function, set()).add(variable.name)
        else:
            file_globals.setdefault(variable.location.path, set()).add(variable.name)

    edges: list[SemanticEdge] = []
    enable_sites: list[EnableSite] = []
    for function in definitions:
        source = _masked_source(source_cache, project, function.location.path)
        if not source:
            continue
        lines = source.splitlines(keepends=True)
        start = max(0, function.location.line - 1)
        end = min(len(lines), function.end_line)
        body = "".join(lines[start:end])
        opening_brace = body.find("{")
        if opening_brace < 0:
            continue
        # Blank the signature but keep its newlines so line arithmetic stays exact.
        signature = "".join("\n" if char == "\n" else " " for char in body[: opening_brace + 1])
        body = signature + body[opening_brace + 1 :]
        shadowed = locals_by_function.get(function.symbol_id, set()) | file_globals.get(
            function.location.path, set()
        )

        for match in _CALL_PATTERN.finditer(body):
            name = match.group(1)
            if name in _CALL_KEYWORDS:
                continue
            arguments = _split_arguments(body, match.end())
            target = _resolve_definition(name, function.location.path, by_name)
            if target is not None:
                edges.append(
                    SemanticEdge(
                        source=function.symbol_id,
                        target=target.symbol_id,
                        relation="calls",
                        locations=(_match_location(function, body, match.start(1)),),
                    )
                )

            for index, (argument, offset) in enumerate(arguments):
                argument_match = _FUNCTION_ARGUMENT_PATTERN.match(argument)
                if argument_match is None:
                    continue
                identifier = argument_match.group(1)
                if identifier in shadowed:
                    continue
                if identifier not in by_name and "::" not in identifier and "::" in function.name:
                    # 类的方法里写 ``xTaskCreate(updateTask, ...)``：名字按类作用域解析成 ``Servo::updateTask``
                    scoped = f"{function.name.rsplit('::', 1)[0]}::{identifier}"
                    if scoped in by_name:
                        identifier = scoped
                if identifier not in by_name:
                    continue
                passed = _resolve_definition(identifier, function.location.path, by_name)
                if passed is None:
                    continue
                location = _match_location(function, body, offset + argument_match.start(1))
                edges.append(
                    SemanticEdge(
                        source=function.symbol_id,
                        target=passed.symbol_id,
                        relation="address_of",
                        locations=(location,),
                        argument_index=index,
                        callee=name,
                    )
                )
                rule = rules.match_registration(name, index)
                if rule is not None:
                    edges.append(
                        SemanticEdge(
                            source=function.symbol_id,
                            target=passed.symbol_id,
                            relation=rule.relation,
                            locations=(location,),
                            rule=rule.rule_id,
                            evidence=_priority_evidence(rule, arguments),
                        )
                    )

            isr_rule = rules.match_isr_enable(name)
            if isr_rule is not None and isr_rule.irq_argument < len(arguments):
                argument, offset = arguments[isr_rule.irq_argument]
                irq_match = _IRQ_ARGUMENT_PATTERN.match(argument)
                if irq_match is not None:
                    enable_sites.append(
                        EnableSite(
                            function=function,
                            callee=name,
                            argument=irq_match.group(1),
                            location=_match_location(function, body, match.start(1)),
                            rule=isr_rule.rule_id,
                            priority=_priority_arguments(arguments, isr_rule.irq_argument),
                        )
                    )
    return tuple(edges), tuple(enable_sites)


def _priority_evidence(rule: RegistrationRule, arguments: list[tuple[str, int]]) -> dict[str, Any] | None:
    """Raw task-priority operand at a ``task_create`` call, as the rule says where to find it.

    Nothing is resolved here: the text is recorded as written (``tskIDLE_PRIORITY + 2``,
    ``osPriorityNormal``, ``&defaultTask_attributes``) and ``attach_task_priorities`` turns it
    into a number once enum values and initializers are known.  Absent when the rule does
    not say where the priority is, or the call has fewer arguments.
    """

    if rule.kind != "task":
        return None
    if rule.priority_argument is not None and rule.priority_argument < len(arguments):
        text = arguments[rule.priority_argument][0].strip()
        return {"priority": {"argument": text}} if text else None
    if rule.attr_argument is not None and rule.priority_field and rule.attr_argument < len(arguments):
        text = arguments[rule.attr_argument][0].strip()
        match = re.fullmatch(r"&?\s*([A-Za-z_]\w*)", text)
        if match is None:
            return {"priority": {"argument": text}}
        return {"priority": {"argument": text, "attr": match.group(1), "field": rule.priority_field}}
    return None


def _priority_evidence(rule: RegistrationRule, arguments: list[tuple[str, int]]) -> dict[str, Any] | None:
    """Raw task-priority operand at a ``task_create`` call, as the rule says where to find it.

    Nothing is resolved here: the text is recorded as written (``tskIDLE_PRIORITY + 2``,
    ``osPriorityNormal``, ``&defaultTask_attributes``) and ``attach_task_priorities`` turns it
    into a number once enum values and initializers are known.  Absent when the rule does
    not say where the priority is, or the call has fewer arguments.
    """

    if rule.kind != "task":
        return None
    if rule.priority_argument is not None and rule.priority_argument < len(arguments):
        text = arguments[rule.priority_argument][0].strip()
        return {"priority": {"argument": text}} if text else None
    if rule.attr_argument is not None and rule.priority_field and rule.attr_argument < len(arguments):
        text = arguments[rule.attr_argument][0].strip()
        match = re.fullmatch(r"&?\s*([A-Za-z_]\w*)", text)
        if match is None:
            return {"priority": {"argument": text}}
        return {"priority": {"argument": text, "attr": match.group(1), "field": rule.priority_field}}
    return None


def _priority_evidence(rule: RegistrationRule, arguments: list[tuple[str, int]]) -> dict[str, Any] | None:
    """Raw task-priority operand at a ``task_create`` call, as the rule says where to find it.

    Nothing is resolved here: the text is recorded as written (``tskIDLE_PRIORITY + 2``,
    ``osPriorityNormal``, ``&defaultTask_attributes``) and ``attach_task_priorities`` turns it
    into a number once enum values and initializers are known.  Absent when the rule does
    not say where the priority is, or the call has fewer arguments.
    """

    if rule.kind != "task":
        return None
    if rule.priority_argument is not None and rule.priority_argument < len(arguments):
        text = arguments[rule.priority_argument][0].strip()
        return {"priority": {"argument": text}} if text else None
    if rule.attr_argument is not None and rule.priority_field and rule.attr_argument < len(arguments):
        text = arguments[rule.attr_argument][0].strip()
        match = re.fullmatch(r"&?\s*([A-Za-z_]\w*)", text)
        if match is None:
            return {"priority": {"argument": text}}
        return {"priority": {"argument": text, "attr": match.group(1), "field": rule.priority_field}}
    return None


def _priority_arguments(arguments: list[tuple[str, int]], irq_index: int) -> dict[str, int] | None:
    """``nvic_irq_enable(IRQn, pre, sub)``: integer literals after the IRQ argument.

    Only literal priorities are recorded; macros and expressions are left out so the
    evidence never claims a priority the source does not state plainly.
    """

    tail = [text.strip() for text, _ in arguments[irq_index + 1 : irq_index + 3]]
    if not tail or not all(re.fullmatch(r"\d+", item) for item in tail):
        return None
    keys = ("preempt", "sub")
    return {key: int(value) for key, value in zip(keys, tail)}


def _collect_enums(
    router: ShardRouter,
    raw_symbols: dict[str, Any],
    symbol_uris: dict[str, str],
    project: Path,
    enum_values: dict[str, str],
) -> tuple[EnumFact, ...]:
    """Enum types from the cached documentSymbol trees (kind 10, members kind 22); values via hover.

    The symbol trees are merged across shards but hover is not: clangd only answers for
    documents its own process opened, so each enumerator's hover goes to the shard that
    owns the file it lives in."""

    from urllib.parse import unquote, urlparse

    facts: list[EnumFact] = []
    seen: set[tuple[str, int]] = set()
    for uri, symbols in raw_symbols.items():
        try:
            file_path = Path(unquote(urlparse(uri).path.lstrip("/")))
        except (ValueError, OSError):
            continue
        if not _is_within(file_path, project):
            continue  # 编译库可以引用扫描根之外的文件；枚举只收根内的
        relative = _relative(file_path, project)
        # ``typedef enum { ... } name;``: clangd reports the enum as "(anonymous enum)" and the
        # alias as a separate kind-5 symbol starting on the enum's last line.
        aliases: dict[int, str] = {}
        for symbol in symbols:
            if int(symbol.get("kind", 0)) == 5 and "alias" in str(symbol.get("detail", "")):
                start = ((symbol.get("selectionRange") or symbol.get("range") or {}).get("start") or {})
                aliases[int(start.get("line", -1))] = str(symbol.get("name", ""))

        def visit(symbol: dict[str, Any]) -> None:
            kind = int(symbol.get("kind", 0))
            if kind == 10 and symbol.get("children"):
                selection = symbol.get("selectionRange") or symbol.get("range") or {}
                start = selection.get("start") or {}
                line = int(start.get("line", 0)) + 1
                if (relative, line) in seen:
                    return
                seen.add((relative, line))
                members: list[dict[str, Any]] = []
                for child in symbol.get("children") or []:
                    if int(child.get("kind", 0)) not in {10, 22}:  # clangd 20 reports enumerators as kind 10
                        continue
                    member_name = str(child.get("name", ""))
                    child_start = ((child.get("selectionRange") or child.get("range") or {}).get("start") or {})
                    value = enum_values.get(member_name)
                    if value is None:
                        try:
                            value = router.for_path(relative).enumerator_value(
                                symbol_uris.get(uri, uri),
                                int(child_start.get("line", 0)),
                                int(child_start.get("character", 0)),
                            )
                        except (OSError, TimeoutError, RuntimeError):
                            value = None
                        if value is not None:
                            enum_values[member_name] = value
                    members.append({"name": member_name, "value": value, "line": int(child_start.get("line", 0)) + 1})
                if members:
                    name = str(symbol.get("name") or "(anonymous)")
                    if "anonymous" in name:
                        end_line = int(((symbol.get("range") or {}).get("end") or {}).get("line", -1))
                        name = aliases.get(end_line) or aliases.get(end_line - 1) or name
                    facts.append(EnumFact(name=name, location=SourceLocation(path=relative, line=line, column=int(start.get("character", 0)) + 1), members=tuple(members)))
            for child in symbol.get("children") or []:
                if int(child.get("kind", 0)) != 10 or child.get("children"):
                    visit(child)

        for symbol in symbols:
            visit(symbol)
    facts.sort(key=lambda item: (item.location.path, item.location.line))
    return tuple(facts)


def _masked_source(cache: dict[str, str], project: Path, relative_path: str) -> str:
    source = cache.get(relative_path)
    if source is None:
        try:
            source = _mask_comments_and_strings(
                (project / Path(relative_path)).read_text(encoding="utf-8", errors="replace")
            )
        except OSError:
            source = ""
        cache[relative_path] = source
    return source


def _split_arguments(body: str, start: int) -> list[tuple[str, int]]:
    """Return (argument text, offset in body) pairs for the call whose '(' ends at start."""

    depth = 0
    arguments: list[tuple[str, int]] = []
    argument_start = start
    index = start
    while index < len(body):
        char = body[index]
        if char in "([{":
            depth += 1
        elif char in ")]}":
            if depth == 0:
                arguments.append((body[argument_start:index], argument_start))
                break
            depth -= 1
        elif char == "," and depth == 0:
            arguments.append((body[argument_start:index], argument_start))
            argument_start = index + 1
        elif char == ";" and depth == 0:
            break
        index += 1
    if len(arguments) == 1 and not arguments[0][0].strip():
        return []
    return arguments


def _resolve_definition(
    name: str,
    from_path: str,
    definitions_by_name: dict[str, list[FunctionSymbol]],
) -> FunctionSymbol | None:
    """Pick the definition a reference from ``from_path`` most plausibly binds to."""

    candidates = definitions_by_name.get(name, [])
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    same_file = [item for item in candidates if item.location.path == from_path]
    if same_file:
        return same_file[0]
    from_parts = from_path.split("/")

    def shared_prefix(item: FunctionSymbol) -> int:
        count = 0
        for left, right in zip(from_parts, item.location.path.split("/")):
            if left != right:
                break
            count += 1
        return count

    return max(
        candidates,
        key=lambda item: (shared_prefix(item), -len(item.location.path), item.symbol_id),
    )


_SYMBOL_ID_PATTERN = re.compile(r"^function:(.+):([^:]+)$")


def _split_symbol_id(symbol_id: str) -> tuple[str, str] | None:
    """``function:<路径>:<名字>`` -> (路径, 名字)。ID 里没有行号，位置去 location 字段查。"""

    match = _SYMBOL_ID_PATTERN.match(symbol_id)
    if match is None:
        return None
    return match.group(1), match.group(2)


def _match_location(
    function: FunctionSymbol,
    body: str,
    offset: int,
) -> SourceLocation:
    prefix = body[:offset]
    line = function.location.line + prefix.count("\n")
    last_newline = prefix.rfind("\n")
    column = offset + 1 if last_newline < 0 else offset - last_newline
    return SourceLocation(path=function.location.path, line=line, column=column)


def _mask_comments_and_strings(content: str) -> str:
    pattern = re.compile(
        r"//[^\n]*|/\*.*?\*/|\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'",
        re.DOTALL,
    )
    return pattern.sub(
        lambda match: "".join("\n" if char == "\n" else " " for char in match.group()),
        content,
    )


def _symbol_id(path: str, name: str) -> str:
    # 稳定 ID 里不放行号：插一行注释就会让整个文件的 ID 全部换身份，跨快照差分和
    # 增量重扫的拼接都靠 ID 对齐。位置另有 location 字段可查，不必编进标识。
    return f"function:{path}:{name}"


def _variable_id(path: str, name: str) -> str:
    return f"variable:{path}:{name}"


def _uri_to_path(uri: str) -> Path | None:
    parsed = urlparse(uri)
    if parsed.scheme != "file":
        return None
    raw_path = unquote(parsed.path)
    if re.match(r"^/[A-Za-z]:/", raw_path):
        raw_path = raw_path[1:]
    return resolved(Path(raw_path))


def _relative(path: Path, project: Path) -> str:
    """Project-relative posix path, or the absolute path for a file outside the project.

    ``relative_to`` raises on an outside file and used to abort the whole scan.  Two ways it
    happens, both normal: the scan root is a subdirectory of a larger tree and the compile
    database names sibling headers, or the SDK simply lives elsewhere -- PlatformIO keeps
    frameworks under ``~/.platformio/packages``, and an ESP-IDF or Zephyr checkout usually
    sits outside the project too.

    Such a file keeps its absolute path, which is the only meaningful way to name it anyway,
    and it stays visibly out of scope.
    """

    target = resolved(path)
    try:
        return target.relative_to(resolved(project)).as_posix()
    except ValueError:
        return target.as_posix()


def _is_within(path: Path, project: Path) -> bool:
    try:
        resolved(path).relative_to(resolved(project))
        return True
    except ValueError:
        return False
