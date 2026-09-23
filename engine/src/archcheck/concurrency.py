"""Derived runtime facts: run modes and cross-unit shared resources (design doc §4.3, §4.6).

Everything here is *derived* from the AST facts in ``ast_facts`` plus the reachability
sets of ``runtime_units``.  Each result carries ``confidence`` and ``evidence`` and the
schema marks it as an approximation: reachability says a function *may* run in a unit,
a same-block critical section says an access *looks* protected — neither is a path
proof.
"""

from __future__ import annotations

from collections import deque
from dataclasses import replace
import re

from archcheck.model import (
    WakeRelation,
    BlockingCall,
    ConflictCandidate,
    EntryPoint,
    ExecutionUnit,
    LoopFact,
    Reachability,
    ResourceAccess,
    RunMode,
    SemanticEdge,
    SharedResource,
    UnitAccessSummary,
)


WRITE_KINDS = {"write", "read_write"}
INDIRECT_VIA = ("pointer-", "array-decay")
_SYMBOL_ID = re.compile(r"^function:(.+):([^:]+)$")
_CALLEE_SEARCH_DEPTH = 3


def derive_run_modes(
    units: tuple[ExecutionUnit, ...],
    entries: tuple[EntryPoint, ...],
    loops: tuple[LoopFact, ...],
    edges: tuple[SemanticEdge, ...],
    analyzed_functions: set[str],
    blocking_by_function: dict[str, tuple[BlockingCall, ...]] | None = None,
    tick_ms: float = 1.0,
) -> tuple[RunMode, ...]:
    """One RunMode per execution-unit root (ISR, task, callback, timer) and per entry.

    ``blocking_by_function`` lets a loop that only calls helpers inherit the blocking
    kind found inside those helpers (up to ``_CALLEE_SEARCH_DEPTH`` calls deep).
    """

    loops_by_function: dict[str, list[LoopFact]] = {}
    for loop in loops:
        loops_by_function.setdefault(loop.function, []).append(loop)
    callees: dict[str, list[str]] = {}
    for edge in edges:
        if edge.relation == "calls" and edge.dead_branch is None:
            callees.setdefault(edge.source, []).append(edge.target)

    roots: list[tuple[str, str]] = []
    superloops: set[str] = set()
    for entry in entries:
        match = _SYMBOL_ID.match(entry.symbol_id)
        roots.append((f"{entry.kind}:{match.group(2) if match else entry.symbol_id}", entry.symbol_id))
        if getattr(entry, "superloop", False):
            superloops.add(entry.symbol_id)
    roots.extend((unit.unit_id, unit.entry_symbol_id) for unit in units)

    results: list[RunMode] = []
    for unit_id, function_id in roots:
        if function_id in superloops:
            results.append(_superloop_mode(unit_id, function_id, analyzed_functions, blocking_by_function or {}, tick_ms))
            continue
        results.append(_run_mode(unit_id, function_id, loops_by_function, callees, analyzed_functions, blocking_by_function or {}, tick_ms))
    return tuple(results)


def _superloop_mode(
    unit_id: str,
    function_id: str,
    analyzed: set[str],
    blocking_by_function: dict[str, tuple[BlockingCall, ...]],
    tick_ms: float,
) -> RunMode:
    """The framework calls this function forever (Arduino ``loop()``): its body is the loop body."""

    if function_id not in analyzed:
        return RunMode(unit_id, function_id, "unknown", "low", {"reason": "no AST for the entry function"})
    blocking = list(blocking_by_function.get(function_id, ()))
    kinds = {call.kind for call in blocking}
    evidence: dict = {"superloop": True, "blockingCalls": [call.to_dict() for call in blocking],
                      "note": "the framework calls this function in an endless loop; its body is one pass"}
    mode = "event-driven" if "wait" in kinds else "periodic" if "delay" in kinds else "busy-poll"
    period_ms = None
    if mode == "periodic":
        period_ms, period_evidence = _period_ms(blocking, tick_ms)
        if period_evidence is not None:
            evidence["period"] = period_evidence
    return RunMode(unit_id, function_id, mode, "high" if blocking else "medium", evidence, period_ms)


_UNIT_MS = {"ms": 1.0, "us": 0.001, "s": 1000.0}


def _period_ms(blocking: list[BlockingCall], tick_ms: float) -> tuple[float | None, dict | None]:
    """Period from literal delay arguments; None (with the reason) when not literal or ambiguous."""

    delays = [call for call in blocking if call.kind == "delay"]
    if not delays:
        return None, None
    values: list[float] = []
    basis: list[str] = []
    for call in delays:
        duration = call.duration or {}
        value = duration.get("value")
        if value is None:
            return None, {"reason": "delay argument is not a literal", "arguments": [c.duration.get("argument") if c.duration else None for c in delays]}
        unit = duration.get("unit", "ms")
        factor = tick_ms if unit == "tick" else _UNIT_MS.get(unit, 1.0)
        values.append(value * factor)
        basis.append(f"{call.callee}({duration.get('argument')}) × {factor:g} ms/{unit}")
    if len(set(values)) > 1:
        return None, {"reason": "several different delay values in the loop", "candidatesMs": sorted(set(values)), "basis": basis}
    return values[0], {"ms": values[0], "basis": basis}


def _run_mode(
    unit_id: str,
    function_id: str,
    loops_by_function: dict[str, list[LoopFact]],
    callees: dict[str, list[str]],
    analyzed: set[str],
    blocking_by_function: dict[str, tuple[BlockingCall, ...]] | None = None,
    tick_ms: float = 1.0,
) -> RunMode:
    blocking_by_function = blocking_by_function or {}
    if function_id not in analyzed:
        return RunMode(unit_id, function_id, "unknown", "low", {"reason": "no AST for the entry function"})

    own = loops_by_function.get(function_id, [])
    chosen = _pick_infinite_loop(own)
    path: list[str] = []
    if chosen is None:
        chosen, path = _infinite_loop_in_callees(function_id, loops_by_function, callees)

    if chosen is not None:
        blocking = list(chosen.blocking_calls)
        kinds = {call.kind for call in blocking}
        evidence: dict = {
            "loop": {"function": chosen.function, "kind": chosen.kind, "location": chosen.location.to_dict(), "infinite": True},
            "blockingCalls": [call.to_dict() for call in blocking],
        }
        if path:
            evidence["viaCallees"] = path
        inherited: tuple[list[str], BlockingCall] | None = None
        if "wait" not in kinds and "delay" not in kinds:
            # Nothing decisive in the loop body itself: look for a sleep / wait inside the
            # helpers the loop calls (``thread_sleep`` hidden in ``wait_ready()``).
            inherited = _blocking_in_callees(chosen.calls_in_body, callees, blocking_by_function)
            if inherited is not None:
                kinds.add(inherited[1].kind)
                evidence["blockingViaCallee"] = {"path": inherited[0], "call": inherited[1].to_dict()}
        if "wait" in kinds:
            mode, decisive = "event-driven", "wait"
        elif "delay" in kinds:
            mode, decisive = "periodic", "delay"
        else:
            mode, decisive = "busy-poll", ""
            if "yield" in kinds:
                evidence["note"] = "loop only yields; it polls every scheduler pass"
        if mode == "busy-poll":
            confidence = "medium"  # blocking might hide deeper than the callee search
            evidence["note"] = evidence.get("note") or "no blocking rule matched in the loop body or its callees"
        elif inherited is not None:
            confidence = "medium"
            evidence["note"] = f"blocking call inherited from callee {' -> '.join(inherited[0])}"
        elif any(call.via == "ast" for call in blocking if call.kind == decisive):
            confidence = "high"
        else:
            confidence = "medium"
            evidence["note"] = "blocking call matched by macro name in source text"
        if path:
            confidence = "medium" if confidence == "high" else "low"
        if chosen.from_macro:
            confidence = "low"
        period_ms = None
        if mode == "periodic":
            period_ms, period_evidence = _period_ms(blocking + ([inherited[1]] if inherited is not None else []), tick_ms)
            if period_evidence is not None:
                evidence["period"] = period_evidence
        return RunMode(unit_id, function_id, mode, confidence, evidence, period_ms)

    recognised = [loop for loop in own if not loop.unrecognized]
    unrecognized = [loop for loop in own if loop.unrecognized]
    if unrecognized:
        return RunMode(
            unit_id,
            function_id,
            "unknown",
            "low",
            {"reason": "goto-based loop shape", "loops": [loop.to_dict() for loop in unrecognized]},
        )
    if any(loop.infinite is None for loop in recognised):
        return RunMode(
            unit_id,
            function_id,
            "unknown",
            "low",
            {"reason": "loop condition could not be classified", "loops": [loop.to_dict() for loop in recognised if loop.infinite is None]},
        )
    if recognised:
        return RunMode(
            unit_id,
            function_id,
            "one-shot",
            "medium",
            {"reason": "only bounded loops in the entry function", "loops": [loop.location.to_dict() for loop in recognised]},
        )
    return RunMode(unit_id, function_id, "one-shot", "high", {"reason": "no loop in the entry function"})


def _pick_infinite_loop(loops: list[LoopFact]) -> LoopFact | None:
    infinite = [loop for loop in loops if loop.infinite]
    if not infinite:
        return None
    infinite.sort(key=lambda loop: (loop.depth, loop.from_macro, loop.location.line))
    return infinite[0]


def _blocking_in_callees(
    start: tuple[str, ...],
    callees: dict[str, list[str]],
    blocking_by_function: dict[str, tuple[BlockingCall, ...]],
) -> tuple[list[str], BlockingCall] | None:
    """Nearest wait / delay call reachable from the loop body's callees (BFS, bounded depth)."""

    visited: set[str] = set()
    pending: deque[tuple[str, list[str]]] = deque((callee, [callee]) for callee in start)
    while pending:
        current, path = pending.popleft()
        if current in visited or len(path) > _CALLEE_SEARCH_DEPTH:
            continue
        visited.add(current)
        decisive = [call for call in blocking_by_function.get(current, ()) if call.kind in {"wait", "delay"}]
        if decisive:
            decisive.sort(key=lambda call: (call.kind != "wait", call.location.line))
            return path, decisive[0]
        for callee in callees.get(current, []):
            pending.append((callee, path + [callee]))
    return None


def _infinite_loop_in_callees(
    function_id: str,
    loops_by_function: dict[str, list[LoopFact]],
    callees: dict[str, list[str]],
) -> tuple[LoopFact | None, list[str]]:
    """``main`` and RTOS tasks often delegate their forever loop to a helper."""

    visited = {function_id}
    pending: deque[tuple[str, list[str]]] = deque((callee, [callee]) for callee in callees.get(function_id, []))
    while pending:
        current, path = pending.popleft()
        if current in visited or len(path) > _CALLEE_SEARCH_DEPTH:
            continue
        visited.add(current)
        chosen = _pick_infinite_loop(loops_by_function.get(current, []))
        if chosen is not None:
            return chosen, path
        for callee in callees.get(current, []):
            pending.append((callee, path + [callee]))
    return None, []


def attach_run_modes(
    units: tuple[ExecutionUnit, ...],
    run_modes: tuple[RunMode, ...],
) -> tuple[ExecutionUnit, ...]:
    by_unit = {mode.unit_id: mode for mode in run_modes}
    return tuple(replace(unit, run_mode=by_unit.get(unit.unit_id)) for unit in units)


def inherit_run_modes(
    units: tuple[ExecutionUnit, ...],
    run_modes: tuple[RunMode, ...],
) -> tuple[tuple[ExecutionUnit, ...], tuple[RunMode, ...]]:
    """A callback with exactly one host runs inside that host's loop: it inherits the
    host's mode and period (medium confidence) unless it has its own infinite loop."""

    by_unit = {unit.unit_id: unit for unit in units}
    modes = {mode.unit_id: mode for mode in run_modes}
    for unit in units:
        if unit.kind in {"isr", "task"} or len(unit.hosts) != 1:
            continue
        host = by_unit.get(unit.hosts[0])
        host_mode = host.run_mode if host is not None else modes.get(unit.hosts[0])
        own = modes.get(unit.unit_id)
        if host_mode is None or own is None or own.mode not in {"one-shot", "unknown"}:
            continue
        inherited = RunMode(
            unit.unit_id,
            unit.entry_symbol_id,
            host_mode.mode,
            "medium",
            {"inheritedFrom": unit.hosts[0], "reason": "callback runs inside its host's loop", "own": own.evidence},
            host_mode.period_ms,
        )
        modes[unit.unit_id] = inherited
    ordered = tuple(modes[mode.unit_id] for mode in run_modes)
    return tuple(replace(unit, run_mode=modes.get(unit.unit_id)) for unit in units), ordered


def derive_shared_resources(
    accesses: tuple[ResourceAccess, ...],
    reachability: Reachability | None,
    units: tuple[ExecutionUnit, ...],
    volatile_lookup: dict[str, bool],
    notification_resources: set[str] | None = None,
    type_lookup: dict[str, str | None] | None = None,
    atomic_width_bytes: int = 4,
) -> tuple[tuple[SharedResource, ...], tuple[ConflictCandidate, ...]]:
    """Group accesses by execution-unit root and flag ISR × task/callback candidates.

    A resource is kept when more than one execution unit reaches it (the concurrency
    reading) **or** when more than one source file touches it (the coupling reading: a
    file-scope variable used across files is an implicit interface even if only one task
    ever runs that code).  Single-unit, single-file variables stay out.

    ``notification_resources`` (from derive_wake_relations) tag a candidate with
    ``role: notification-flag`` so consumers can separate handshakes from data races.
    """

    if reachability is None:
        return (), ()
    notification_resources = notification_resources or set()
    type_lookup = type_lookup or {}
    unit_kind = {unit.unit_id: unit.kind for unit in units}
    unit_confidence = {unit.unit_id: unit.confidence for unit in units}
    for unit_id in reachability.by_unit:
        unit_kind.setdefault(unit_id, unit_id.split(":", 1)[0])
    units_by_function: dict[str, set[str]] = {}
    for unit_id, members in reachability.by_unit.items():
        for member in members:
            units_by_function.setdefault(member, set()).add(unit_id)

    grouped: dict[str, dict[str, list[ResourceAccess]]] = {}
    names: dict[str, str] = {}
    variables: dict[str, str | None] = {}
    files: dict[str, set[str]] = {}  # 访问它的源文件：跨文件即隐式接口，哪怕只有一个单元跑到
    for access in accesses:
        resource = access.variable or f"extern:{access.name}"
        names[resource] = access.name
        variables[resource] = access.variable
        for unit_id in units_by_function.get(access.function, ()):
            grouped.setdefault(resource, {}).setdefault(unit_id, []).append(access)
            files.setdefault(resource, set()).add(access.location.path)

    shared: list[SharedResource] = []
    conflicts: list[ConflictCandidate] = []
    for resource in sorted(grouped, key=lambda item: (names[item], item)):
        per_unit = grouped[resource]
        if len(per_unit) < 2 and len(files.get(resource, ())) < 2:
            continue
        summaries = tuple(
            _summarize(unit_id, unit_kind.get(unit_id, "unknown"), items)
            for unit_id, items in sorted(per_unit.items())
        )
        volatile = volatile_lookup.get(resource, False)
        type_name = type_lookup.get(resource)
        width, atomicity = estimate_atomicity(type_name, atomic_width_bytes)
        shared.append(
            SharedResource(
                resource=resource,
                name=names[resource],
                variable=variables[resource],
                volatile=volatile,
                units=summaries,
                type_name=type_name,
                width_bytes=width,
                atomicity=atomicity,
            )
        )
        conflict = _conflict(resource, names[resource], variables[resource], volatile, summaries, unit_confidence)
        if conflict is not None:
            if resource in notification_resources:
                conflict = replace(conflict, role="notification-flag")
            conflicts.append(conflict)
    return tuple(shared), tuple(conflicts)


def derive_wake_relations(
    accesses: tuple[ResourceAccess, ...],
    control_flow: tuple,
    reachability: Reachability | None,
    units: tuple[ExecutionUnit, ...],
) -> tuple[WakeRelation, ...]:
    """ISR-context write + task/callback-context read inside an if/while/do condition."""

    if reachability is None:
        return ()
    unit_kind = {unit.unit_id: unit.kind for unit in units}
    for unit_id in reachability.by_unit:
        unit_kind.setdefault(unit_id, unit_id.split(":", 1)[0])
    units_by_function: dict[str, set[str]] = {}
    for unit_id, members in reachability.by_unit.items():
        for member in members:
            units_by_function.setdefault(member, set()).add(unit_id)
    # (function, line) of if / while / do statements: an access on that line is in the condition
    condition_lines: dict[tuple[str, int], str] = {}
    for block in control_flow:
        if block.kind in {"if", "while", "do"}:
            condition_lines[(block.function, block.location.line)] = block.kind
    producers: dict[str, list[dict]] = {}
    consumers: dict[str, list[dict]] = {}
    names: dict[str, tuple[str, str | None]] = {}
    for access in accesses:
        resource = access.variable or f"extern:{access.name}"
        names[resource] = (access.name, access.variable)
        if access.via:  # field / index / pointer accesses are data structures, not flags
            continue
        for unit_id in units_by_function.get(access.function, ()):
            kind = unit_kind.get(unit_id, "unknown")
            if kind == "isr" and access.kind in {"write", "read_write"}:
                producers.setdefault(resource, []).append({"unit": unit_id, "function": access.function, "line": access.location.line, "kind": access.kind})
            elif kind in {"task", "callback"} and access.kind in {"read", "read_write"}:
                construct = condition_lines.get((access.function, access.location.line))
                if construct is not None:
                    consumers.setdefault(resource, []).append({"unit": unit_id, "function": access.function, "line": access.location.line, "construct": construct})
    relations: list[WakeRelation] = []
    for resource in sorted(set(producers) & set(consumers), key=lambda item: names[item][0]):
        dedup = lambda items: tuple({(i["unit"], i["function"], i["line"]): i for i in items}.values())
        relations.append(
            WakeRelation(
                resource=resource,
                name=names[resource][0],
                variable=names[resource][1],
                kind="flag-poll",
                producers=dedup(producers[resource]),
                consumers=dedup(consumers[resource]),
            )
        )
    return tuple(relations)


def _summarize(unit_id: str, kind: str, items: list[ResourceAccess]) -> UnitAccessSummary:
    kinds = tuple(sorted({item.kind for item in items}))
    unprotected = tuple(sorted({item.kind for item in items if not item.in_critical_section}))
    ordered = tuple(sorted(items, key=lambda item: (item.location.path, item.location.line, item.location.column)))
    return UnitAccessSummary(unit_id=unit_id, unit_kind=kind, kinds=kinds, unprotected_kinds=unprotected, accesses=ordered)


def _writes(summary: UnitAccessSummary, unprotected_only: bool = False) -> list[ResourceAccess]:
    return [
        item
        for item in summary.accesses
        if item.kind in WRITE_KINDS and (not unprotected_only or not item.in_critical_section)
    ]


def _direct(items: list[ResourceAccess]) -> list[ResourceAccess]:
    return [item for item in items if not (item.via or "").startswith(INDIRECT_VIA)]


_FIXED_WIDTH = re.compile(r"\b(?:u?int|int)(8|16|32|64)_t\b|\b__(?:u?int)(8|16|32|64)\b")


def estimate_atomicity(type_name: str | None, atomic_width_bytes: int) -> tuple[int | None, str]:
    """Width in bytes and whether one load / store of the whole object is atomic.

    Purely lexical, from the declared type text: fixed-width typedefs, C keywords, pointers,
    arrays and struct / union.  Project typedefs (``state_t``) are ``unknown`` — resolving them
    needs a type query and is left to the engine's clangd layer later.
    """

    if not type_name:
        return None, "unknown"
    text = re.sub(r"\b(const|volatile|restrict|_Atomic|static|extern)\b", " ", type_name).strip()
    if text.endswith("]") or re.search(r"\[\s*\d*\s*\]", text):
        return None, "composite"
    if re.match(r"^(struct|union)\b", text) or "{" in text:
        return None, "composite"
    if "*" in text or text.endswith(")"):
        width = atomic_width_bytes
        return width, "single-word"
    fixed = _FIXED_WIDTH.search(text)
    if fixed is not None:
        bits = int(fixed.group(1) or fixed.group(2))
        width = bits // 8
    elif re.search(r"\blong\s+long\b|\bdouble\b", text):
        width = 8
    elif re.search(r"\b(char|_Bool|bool|uint8|int8|u8|s8|BYTE|byte)\b", text):
        width = 1
    elif re.search(r"\b(short|u16|s16|WORD)\b", text):
        width = 2
    elif re.search(r"\b(int|unsigned|signed|long|float|size_t|u32|s32|DWORD|enum)\b", text):
        width = 4
    else:
        return None, "unknown"
    return width, "single-word" if width <= atomic_width_bytes else "wide"


# 中断上下文：向量表式 ISR。经 API 注册进中断的回调（ESP-IDF 的 esp_intr_alloc、
# Zephyr 的 IRQ_CONNECT）目前归类为 callback，profile 还没有字段能表达「这个回调
# 跑在中断上下文里」——corpus/external.yaml 里 grblhal-esp32 那条 caveat 说的就是它。
_INTERRUPT_KINDS = frozenset({"isr"})
# 线程上下文。main 在这里是必须的：裸机超级循环就是那个和中断竞争的一方，
# 少了它，「中断置标志 + 主循环轮询」这个嵌入式最常见的竞态一条都报不出来。
_THREAD_KINDS = frozenset({"task", "callback", "timer", "main"})


def _conflict(
    resource: str,
    name: str,
    variable: str | None,
    volatile: bool,
    summaries: tuple[UnitAccessSummary, ...],
    unit_confidence: dict[str, str],
) -> ConflictCandidate | None:
    isr_side = [item for item in summaries if item.unit_kind in _INTERRUPT_KINDS]
    other_side = [item for item in summaries if item.unit_kind in _THREAD_KINDS]
    if not isr_side or not other_side:
        return None

    isr_writers = [item for item in isr_side if _writes(item)]
    other_unprotected = [item for item in other_side if item.unprotected_kinds]
    other_writers = [item for item in other_side if _writes(item, unprotected_only=True)]
    isr_readers = [item for item in isr_side if item.kinds]

    if isr_writers and other_unprotected:
        isr_part, other_part = isr_writers, other_unprotected
        pattern = "isr-write/other-access"
    elif other_writers and isr_readers:
        isr_part, other_part = isr_readers, other_writers
        pattern = "other-write/isr-access"
    else:
        return None

    isr_direct_writes = any(_direct(_writes(item)) for item in isr_part) or pattern == "other-write/isr-access"
    other_direct = any(
        _direct([access for access in item.accesses if not access.in_critical_section])
        for item in other_part
    )
    both_write = bool(isr_writers) and bool(other_writers)
    low_confidence_unit = any(unit_confidence.get(item.unit_id) == "low" for item in other_part)
    only_address = all(
        all(access.kind == "address_taken" for access in item.accesses if not access.in_critical_section)
        for item in other_part
    )

    if only_address or not isr_direct_writes or not other_direct or low_confidence_unit:
        confidence = "low"
        reason = "one side only reaches the variable through a pointer, an address-of or a low-confidence callback registration"
    elif both_write:
        confidence = "high"
        reason = "both the interrupt side and the thread side write outside any recognised critical section"
    else:
        confidence = "medium"
        reason = "one side writes and the other reads outside any recognised critical section (flag hand-off pattern)"
    if volatile and confidence == "medium":
        reason += "; the variable is volatile, which orders the accesses but does not make compound updates atomic"

    return ConflictCandidate(
        resource=resource,
        name=name,
        variable=variable,
        volatile=volatile,
        isr_side=tuple(isr_part),
        other_side=tuple(other_part),
        pattern=pattern,
        confidence=confidence,
        reason=reason,
    )
