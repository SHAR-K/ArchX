"""Execution units, entries and reachability (design doc §4.7 items 3 and 7).

Two fact sources are combined for interrupts:

* the vector table in the startup ``.s`` file listed in the compilation database
  (``DCD xxx_IRQHandler`` for armasm, ``.word xxx_IRQHandler`` for GNU as);
* calls to ISR enable APIs (``nvic_irq_enable(IRQn, ...)`` etc.) whose first argument
  resolves to an IRQ constant name or a literal vector number.

Tasks, callbacks and timers come from ``registers_*`` edges produced by the framework
rule library.  Reachability walks ``calls`` edges from every entry and unit; a
``registers_*`` edge never extends the registering unit because the registered
function runs in its own unit.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, replace
from pathlib import Path
import re
from typing import Iterable, Any

from archcheck.framework_rules import FrameworkRules
from archcheck.model import (
    CodeSite,
    EntryPoint,
    ExecutionUnit,
    FunctionSymbol,
    Reachability,
    SemanticEdge,
    SourceLocation,
)


CMSIS_EXCEPTION_SLOTS = 16
ENTRY_NAMES = {"main": "main", "app_main": "main", "Reset_Handler": "reset"}
_TABLE_LABELS = {"__vectors", "g_pfnvectors", "__isr_vector", "__vector_table", "vectors"}
_STACK_SYMBOLS = re.compile(r"^(__initial_sp|_estack|__stacktop|__stack_top|__stack_end|image\$\$.*)$", re.I)
_TABLE_END = re.compile(r"__Vectors_End|__isr_vector_end|g_pfnVectors_end|\.size\s", re.I)
_SECTION_BREAK = re.compile(r"^\s*(AREA\b|\.section\b|\.text\b|\.thumb_func\b|\.type\b)", re.I)
_VECTOR_DIRECTIVE = re.compile(r"(?<![\w.])(DCD|\.word|\.long|\.4byte)\b\s*(.*)$", re.I)
_LABEL = re.compile(r"^([A-Za-z_$.][\w$.]*):?(?=\s|$)")
_PROC = re.compile(r"^([A-Za-z_][\w$]*)\s+PROC\b", re.I)
_GAS_LABEL = re.compile(r"^([A-Za-z_][\w$]*):")
_IDENTIFIER = re.compile(r"^[A-Za-z_]\w*$")
_SYMBOL_ID = re.compile(r"^function:(.+):([^:]+)$")


@dataclass(frozen=True)
class VectorEntry:
    name: str
    vector: int
    location: SourceLocation


@dataclass(frozen=True)
class AsmRoutine:
    name: str
    location: SourceLocation


@dataclass(frozen=True)
class VectorTable:
    entries: tuple[VectorEntry, ...] = ()
    routines: tuple[AsmRoutine, ...] = ()

    def entry(self, name: str) -> VectorEntry | None:
        return next((item for item in self.entries if item.name == name), None)

    def by_vector(self, vector: int) -> VectorEntry | None:
        return next((item for item in self.entries if item.vector == vector), None)

    def routine(self, name: str) -> AsmRoutine | None:
        return next((item for item in self.routines if item.name == name), None)


@dataclass(frozen=True)
class EnableSite:
    """A call to an ISR enable API before its IRQ argument is resolved."""

    function: FunctionSymbol
    callee: str
    argument: str
    location: SourceLocation
    rule: str
    # {"preempt": n, "sub": m} when the enable call states literal priorities.
    priority: dict[str, int] | None = None


def parse_vector_tables(paths: Iterable[Path], project: Path) -> VectorTable:
    entries: list[VectorEntry] = []
    routines: list[AsmRoutine] = []
    for path in paths:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        relative = path.resolve().relative_to(project.resolve()).as_posix()
        table, asm_routines = _parse_assembly(text, relative)
        entries.extend(table)
        routines.extend(asm_routines)
    return VectorTable(entries=tuple(entries), routines=tuple(routines))


def _parse_assembly(text: str, relative: str) -> tuple[list[VectorEntry], list[AsmRoutine]]:
    entries: list[VectorEntry] = []
    routines: list[AsmRoutine] = []
    collecting = False
    finished = False
    slot = 0

    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = _strip_asm_comment(raw_line)
        if not line.strip():
            continue

        if collecting and (_TABLE_END.search(line) or _SECTION_BREAK.match(line)):
            collecting = False
            finished = True

        if not collecting and not finished:
            label = _LABEL.match(line)
            if label and label.group(1).lower() in _TABLE_LABELS:
                collecting = True
                line = line[label.end():]
            else:
                directive = _VECTOR_DIRECTIVE.search(line)
                if directive and _STACK_SYMBOLS.match(directive.group(2).split(",")[0].strip()):
                    collecting = True

        if collecting:
            directive = _VECTOR_DIRECTIVE.search(line)
            if directive:
                for operand in directive.group(2).split(","):
                    name = operand.strip()
                    if not name:
                        continue
                    if slot > 0 and _IDENTIFIER.match(name) and not _STACK_SYMBOLS.match(name):
                        entries.append(
                            VectorEntry(
                                name=name,
                                vector=slot - CMSIS_EXCEPTION_SLOTS,
                                location=SourceLocation(path=relative, line=line_number, column=1),
                            )
                        )
                    slot += 1
            continue

        proc = _PROC.match(line)
        if proc:
            routines.append(
                AsmRoutine(proc.group(1), SourceLocation(path=relative, line=line_number, column=1))
            )
            continue
        gas_label = _GAS_LABEL.match(line)
        if gas_label and finished:
            routines.append(
                AsmRoutine(gas_label.group(1), SourceLocation(path=relative, line=line_number, column=1))
            )
    return entries, routines


def _strip_asm_comment(line: str) -> str:
    line = re.sub(r"/\*.*?\*/", " ", line)
    for marker in (";", "@", "//", "/*"):
        index = line.find(marker)
        if index >= 0:
            line = line[:index]
    return line.rstrip()


def resolve_enable_sites(
    sites: Iterable[EnableSite],
    definitions_by_name: dict[str, list[FunctionSymbol]],
    vector_table: VectorTable,
) -> tuple[SemanticEdge, ...]:
    edges: list[SemanticEdge] = []
    for site in sites:
        handler_names = _handler_candidates(site.argument, vector_table)
        target: FunctionSymbol | None = None
        for handler_name in handler_names:
            target = _nearest_definition(handler_name, site.function.location.path, definitions_by_name)
            if target is not None:
                break
        if target is None:
            continue
        edges.append(
            SemanticEdge(
                source=site.function.symbol_id,
                target=target.symbol_id,
                relation="enables_isr",
                locations=(site.location,),
                callee=site.callee,
                rule=site.rule,
                evidence={"priority": site.priority} if site.priority is not None else None,
            )
        )
    return tuple(edges)


def _handler_candidates(argument: str, vector_table: VectorTable) -> tuple[str, ...]:
    argument = argument.strip()
    if argument.isdigit():
        entry = vector_table.by_vector(int(argument))
        return (entry.name,) if entry else ()
    if not _IDENTIFIER.match(argument):
        return ()
    base = argument[:-5] if argument.endswith("_IRQn") else argument
    candidates = [f"{base}_IRQHandler", f"{base}_Handler"]
    if argument.endswith("_IRQn") and vector_table.entry(argument) is not None:
        candidates.insert(0, argument)
    return tuple(dict.fromkeys(candidates))


def build_entries(
    definitions: tuple[FunctionSymbol, ...],
    vector_table: VectorTable,
) -> tuple[EntryPoint, ...]:
    entries: list[EntryPoint] = []
    seen_reset = False
    for function in definitions:
        kind = ENTRY_NAMES.get(function.name)
        if kind is None:
            continue
        entries.append(EntryPoint(kind=kind, symbol_id=function.symbol_id))
        seen_reset = seen_reset or kind == "reset"
    if not seen_reset:
        routine = vector_table.routine("Reset_Handler")
        vector_entry = vector_table.entry("Reset_Handler")
        if routine is not None:
            location = routine.location
        elif vector_entry is not None:
            location = SourceLocation(path=vector_entry.location.path, line=0, column=0)
        else:
            location = None
        if location is not None:
            entries.append(
                EntryPoint(kind="reset", symbol_id=f"function:{location.path}:Reset_Handler")
            )
    return tuple(entries)


def build_execution_units(
    definitions: tuple[FunctionSymbol, ...],
    edges: tuple[SemanticEdge, ...],
    vector_table: VectorTable,
    rules: FrameworkRules,
) -> tuple[ExecutionUnit, ...]:
    by_id = {function.symbol_id: function for function in definitions}
    by_name: dict[str, list[FunctionSymbol]] = {}
    for function in definitions:
        by_name.setdefault(function.name, []).append(function)

    units: list[ExecutionUnit] = []
    used_ids: set[str] = set()

    def edge_sites(edge: SemanticEdge) -> tuple[SourceLocation, ...]:
        if edge.locations:
            return edge.locations
        source = by_id.get(edge.source)
        return (source.location,) if source is not None else ()

    enabled_at: dict[str, list[CodeSite]] = {}
    for edge in edges:
        if edge.relation != "enables_isr":
            continue
        for location in edge_sites(edge):
            enabled_at.setdefault(edge.target, []).append(
                CodeSite(
                    function_id=edge.source,
                    path=location.path,
                    line=location.line,
                    confidence=edge.confidence,
                    evidence=edge.evidence,
                )
            )

    for entry in vector_table.entries:
        for handler in by_name.get(entry.name, []):
            unit_id = _unique_id(f"isr:{entry.name}", used_ids)
            units.append(
                ExecutionUnit(
                    unit_id=unit_id,
                    kind="isr",
                    entry_symbol_id=handler.symbol_id,
                    confidence="high",
                    vector=entry.vector,
                    vector_table=entry.location,
                    enabled_at=tuple(
                        sorted(enabled_at.get(handler.symbol_id, []), key=lambda site: (site.path, site.line))
                    ),
                )
            )

    registrations: dict[tuple[str, str], list[tuple[SemanticEdge, CodeSite]]] = {}
    for edge in edges:
        if edge.relation not in {"registers_task", "registers_callback"} or edge.target not in by_id:
            continue
        kind = "task" if edge.relation == "registers_task" else "callback"
        rule = rules.registration_rule(edge.rule) if edge.rule else None
        if rule is not None:
            kind = rule.kind
        for location in edge_sites(edge):
            registrations.setdefault((kind, edge.target), []).append(
                (edge, CodeSite(function_id=edge.source, path=location.path, line=location.line))
            )

    for (kind, target), items in sorted(registrations.items()):
        # A framework rule that names the API outranks an AST-derived registration
        # (``ast.*``) at the same call site.
        items.sort(
            key=lambda item: (
                (item[0].rule or "").startswith("ast."),
                item[1].path,
                item[1].line,
                item[1].function_id,
            )
        )
        first_edge, first_site = items[0]
        rule = rules.registration_rule(first_edge.rule) if first_edge.rule else None
        function = by_id[target]
        raw_priority = (first_edge.evidence or {}).get("priority") if kind == "task" else None
        units.append(
            ExecutionUnit(
                unit_id=_unique_id(f"{kind}:{function.name}", used_ids),
                kind=kind,
                entry_symbol_id=target,
                confidence=rule.confidence if rule is not None else "medium",
                registered_at=first_site,
                also_registered_at=tuple(site for _, site in items[1:]),
                rule=first_edge.rule,
                priority={**raw_priority, "at": {"path": first_site.path, "line": first_site.line}} if isinstance(raw_priority, dict) else None,
            )
        )
    return tuple(units)


_PRIORITY_SUM = re.compile(r"^\(?\s*([A-Za-z_]\w*|\d+)\s*\)?\s*([+-])\s*\(?\s*([A-Za-z_]\w*|\d+)\s*\)?$")
_PRIORITY_CAST = re.compile(r"^\(\s*[A-Za-z_]\w*\s*\)\s*")


def resolve_priority_text(text: str, constants: dict[str, str]) -> tuple[int | None, str | None, str]:
    """``text`` -> (value, symbol, basis) using known enum / macro constants.

    Handles a literal, one constant (``osPriorityNormal``), and ``a + b`` / ``a - b`` where
    both sides are literals or known constants (``tskIDLE_PRIORITY + 2``).  A leading cast
    like ``(osPriority_t)`` is dropped.  Anything else is ``unresolved`` with value None:
    the evidence never claims a priority the source does not state plainly.
    """

    plain = _PRIORITY_CAST.sub("", text.strip())
    if re.fullmatch(r"\d+", plain):
        return int(plain), None, "literal"

    def value_of(token: str, depth: int = 0) -> int | None:
        if re.fullmatch(r"\d+", token):
            return int(token)
        raw = constants.get(token)
        if raw is None or depth > 4:
            return None
        # ``( ( UBaseType_t ) 0U )``: peel outer parentheses, casts and integer suffixes until stable
        text = str(raw).strip()
        for _ in range(8):
            peeled = re.sub(r"^\(\s*(.*?)\s*\)$", r"\1", text)
            peeled = _PRIORITY_CAST.sub("", peeled).strip()
            peeled = re.sub(r"(?<=\d)[uUlL]+$", "", peeled)
            if peeled == text:
                break
            text = peeled
        if re.fullmatch(r"[A-Za-z_]\w*", text):
            return value_of(text, depth + 1)  # ``#define A B``: one more hop
        try:
            return int(text, 0)
        except ValueError:
            return None

    if re.fullmatch(r"[A-Za-z_]\w*", plain):
        value = value_of(plain)
        return value, plain, "enum" if value is not None else "unresolved"
    match = _PRIORITY_SUM.match(plain)
    if match is not None:
        left, op, right = match.group(1), match.group(2), match.group(3)
        lv, rv = value_of(left), value_of(right)
        symbol = next((tok for tok in (left, right) if not tok.isdigit()), None)
        if lv is not None and rv is not None:
            return (lv + rv if op == "+" else lv - rv), symbol, "expression"
        return None, symbol, "unresolved"
    return None, None, "unresolved"


def attach_task_priorities(
    units: tuple[ExecutionUnit, ...],
    global_inits: dict[str, Any],
    constants: dict[str, str],
) -> tuple[ExecutionUnit, ...]:
    """Turn the raw priority operand recorded at the create call into a number.

    ``priority_argument`` rules give the operand directly.  ``attr_argument`` rules name a
    file-scope attribute struct; its initializer's designated ``.priority = X`` entry (or the
    field named by the rule) is the operand.  ``global_inits`` are the schema-4 aggregate
    initializers keyed by variable id; ``constants`` the enum / macro values clangd resolved.
    """

    inits_by_name: dict[str, list[Any]] = {}
    for initializer in global_inits.values():
        inits_by_name.setdefault(initializer.name, []).append(initializer)

    out: list[ExecutionUnit] = []
    for unit in units:
        raw = unit.priority
        if unit.kind != "task" or not isinstance(raw, dict):
            out.append(unit)
            continue
        resolved: dict[str, Any] = {"argument": raw.get("argument"), "value": None, "symbol": None, "basis": "unresolved", "at": raw.get("at")}
        attr = raw.get("attr")
        if attr:
            field = raw.get("field")
            candidates = inits_by_name.get(attr, [])
            here = (raw.get("at") or {}).get("path")
            same_file = [item for item in candidates if item.path == here]
            initializer = (same_file or candidates)[0] if (same_file or len(candidates) == 1) else None
            resolved["attr"] = attr
            resolved["field"] = field
            if initializer is not None:
                entry = next((e for e in initializer.entries if e.designator == field), None)
                if entry is not None:
                    value, symbol, _ = resolve_priority_text(entry.value, constants)
                    resolved.update({"value": value, "symbol": symbol or entry.value, "basis": "attr-initializer" if value is not None else "unresolved",
                                     "at": {"path": initializer.path, "line": entry.line}})
                else:
                    resolved["note"] = f"initializer of {attr} has no .{field}"
            else:
                resolved["note"] = f"no file-scope initializer found for {attr}"
        elif raw.get("argument"):
            value, symbol, basis = resolve_priority_text(str(raw["argument"]), constants)
            resolved.update({"value": value, "symbol": symbol, "basis": basis})
        out.append(replace(unit, priority=resolved))
    return tuple(out)


def compute_reachability(
    definitions: tuple[FunctionSymbol, ...],
    edges: tuple[SemanticEdge, ...],
    entries: tuple[EntryPoint, ...],
    units: tuple[ExecutionUnit, ...],
) -> Reachability:
    known = {function.symbol_id for function in definitions}
    adjacency: dict[str, set[str]] = {}
    for edge in edges:
        # ``dispatches`` = a function calling through a slot may call every callback
        # registered into it (schema 4 may-call edge); walked like a direct call.  Edges a
        # constant-argument guard proved dead in this build are not walked at all.
        if edge.dead_branch is not None:
            continue
        if edge.relation in _REACHABLE_RELATIONS and edge.source in known and edge.target in known:
            adjacency.setdefault(edge.source, set()).add(edge.target)

    roots: list[tuple[str, str, str]] = []
    for entry in entries:
        if entry.symbol_id in known:
            name = _SYMBOL_ID.match(entry.symbol_id)
            roots.append((f"{entry.kind}:{name.group(2) if name else entry.symbol_id}", entry.kind, entry.symbol_id))
    for unit in units:
        roots.append((unit.unit_id, unit.kind, unit.entry_symbol_id))

    by_unit: dict[str, tuple[str, ...]] = {}
    domains: dict[str, set[str]] = {}
    for unit_id, kind, root in roots:
        if root not in known:
            continue
        visited = _walk(root, adjacency)
        by_unit[unit_id] = tuple(sorted(visited))
        for symbol in visited:
            domains.setdefault(symbol, set()).add(kind)

    unreached = tuple(sorted(known - set(domains)))
    return Reachability(
        by_unit=dict(sorted(by_unit.items())),
        domains={symbol: tuple(sorted(kinds)) for symbol, kinds in sorted(domains.items())},
        unreached=unreached,
    )


_REACHABLE_RELATIONS = {"calls", "dispatches"}
_HOST_KINDS = {"isr", "task", "main", "timer"}


def dispatch_edges(units: tuple[ExecutionUnit, ...]) -> tuple[SemanticEdge, ...]:
    """May-call edges from every dispatcher (a function that calls through a slot) to the
    callback registered into that slot.  Confidence is the callback unit's own."""

    edges: list[SemanticEdge] = []
    seen: set[tuple[str, str]] = set()
    for unit in units:
        for dispatcher in unit.dispatchers:
            key = (dispatcher, unit.entry_symbol_id)
            if key in seen or dispatcher == unit.entry_symbol_id:
                continue
            seen.add(key)
            evidence: dict[str, object] = {"via": "slot", "unit": unit.unit_id}
            if unit.form:
                evidence["form"] = unit.form
            if unit.slot and unit.slot.get("path"):
                evidence["slot"] = unit.slot["path"]
            edges.append(SemanticEdge(dispatcher, unit.entry_symbol_id, "dispatches", (), rule=unit.rule, confidence=unit.confidence, evidence=evidence))
    return tuple(edges)


def attach_hosts(units: tuple[ExecutionUnit, ...], reachability: Reachability) -> tuple[ExecutionUnit, ...]:
    """Record, for every callback-like unit, which ISR / task / main contexts reach it."""

    context_units = {unit_id: members for unit_id, members in reachability.by_unit.items() if unit_id.split(":", 1)[0] in _HOST_KINDS}
    entry_by_unit = {unit.unit_id: unit.entry_symbol_id for unit in units}
    out: list[ExecutionUnit] = []
    for unit in units:
        if unit.kind in {"isr", "task"}:
            out.append(unit)
            continue
        found = [unit_id for unit_id, members in context_units.items() if unit_id != unit.unit_id and unit.entry_symbol_id in members]
        # Keep the innermost context: ``main`` reaches every task through the scheduler's
        # slot, so it hosts the callback only in the sense of hosting the task as well.
        entry_of = {unit_id: entry for unit_id, entry in entry_by_unit.items()}
        hosts = tuple(sorted(
            unit_id for unit_id in found
            if not any(other != unit_id and entry_of.get(other) in reachability.by_unit.get(unit_id, ()) for other in found)
        ))
        if not hosts:
            confidence = None
        elif len(hosts) == 1:
            confidence = "high" if unit.confidence == "high" else "medium"
        else:
            confidence = "low"
        out.append(replace(unit, hosts=hosts, host_confidence=confidence))
    return tuple(out)


def _walk(root: str, adjacency: dict[str, set[str]]) -> set[str]:
    visited = {root}
    pending = deque([root])
    while pending:
        current = pending.popleft()
        for target in adjacency.get(current, ()):
            if target not in visited:
                visited.add(target)
                pending.append(target)
    return visited


def _nearest_definition(
    name: str,
    from_path: str,
    definitions_by_name: dict[str, list[FunctionSymbol]],
) -> FunctionSymbol | None:
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
        parts = item.location.path.split("/")
        count = 0
        for left, right in zip(from_parts, parts):
            if left != right:
                break
            count += 1
        return count

    return max(candidates, key=lambda item: (shared_prefix(item), -len(item.location.path), item.symbol_id))


def _unique_id(base: str, used: set[str]) -> str:
    candidate = base
    counter = 2
    while candidate in used:
        candidate = f"{base}#{counter}"
        counter += 1
    used.add(candidate)
    return candidate
