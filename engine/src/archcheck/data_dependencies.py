"""Data dependencies between execution units, with the round order they happen in.

A shared variable is a channel: whoever writes it is upstream of whoever reads it.  That
edge is the real coupling between two tasks — no include, no call, but task B behaves
differently depending on what task A stored.  In a cooperative scheduler the *order* of
the polling loop decides when the reader sees the value: if the writer is polled before
the reader, the value lands in the same round; if after, the reader picks it up one round
later.  An ISR on either side makes the exchange asynchronous, whatever the loop order.

Nothing here is a judgement.  ``polling_order`` is what a depth-first walk from ``main``
finds, registrations in call-line order — the same order the scheduler builds its list in;
every dependency carries the two positions it was classified from.
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from archcheck.model import (
    DATA_DEPENDENCY_BASIS,
    DataDependency,
    DataDependencyResource,
    EntryPoint,
    ExecutionUnit,
    SemanticEdge,
    SharedResource,
)

READ_KINDS = {"read", "read_write"}
WRITE_KINDS = {"write", "read_write"}
BASIS = DATA_DEPENDENCY_BASIS  # 兼容旧引用


def polling_order(
    entries: Iterable[EntryPoint],
    units: Iterable[ExecutionUnit],
    edges: Iterable[SemanticEdge],
    max_depth: int = 14,
) -> tuple[str, ...]:
    """Task unit ids in the order their registrations are reached from ``main``."""

    main = next((entry.symbol_id for entry in entries if entry.kind == "main"), None)
    if main is None:
        return ()
    registrations: dict[str, list[tuple[int, str]]] = {}
    for unit in units:
        if unit.kind != "task":
            continue
        for site in (unit.registered_at, *unit.also_registered_at):
            if site is not None:
                registrations.setdefault(site.function_id, []).append((site.line, unit.unit_id))
    calls: dict[str, list[tuple[int, str]]] = {}
    for edge in edges:
        if edge.relation != "calls" or edge.dead_branch:
            continue
        line = min((location.line for location in edge.locations), default=10**9)
        calls.setdefault(edge.source, []).append((line, edge.target))
    order: list[str] = []
    seen: set[str] = set()

    def walk(function_id: str, depth: int) -> None:
        if function_id in seen or depth > max_depth:
            return
        seen.add(function_id)
        items = [(line, 0, unit_id) for line, unit_id in registrations.get(function_id, [])]
        items += [(line, 1, target) for line, target in calls.get(function_id, [])]
        for _line, kind, target in sorted(items):
            if kind == 0:
                if target not in order:
                    order.append(target)
            else:
                walk(target, depth + 1)

    walk(main, 0)
    return tuple(order)


def _effective(unit_id: str, units: dict[str, ExecutionUnit], positions: dict[str, int], depth: int = 0) -> tuple[str, int | None, str]:
    """(kind, polling position, context unit) a unit runs in: callbacks / timers take their single host's."""

    unit = units.get(unit_id)
    kind = unit.kind if unit is not None else unit_id.split(":", 1)[0]
    if kind == "task":
        return "task", positions.get(unit_id), unit_id
    if kind in {"callback", "timer"} and unit is not None and len(unit.hosts) == 1 and depth < 4:
        return _effective(unit.hosts[0], units, positions, depth + 1)
    return kind, None, unit_id


def derive_data_dependencies(
    shared: Sequence[SharedResource],
    units: Sequence[ExecutionUnit],
    order: Sequence[str],
    scheduling: str,
) -> tuple[DataDependency, ...]:
    """Writer unit -> reader unit edges, one per unit pair, listing the variables they share.

    ``order`` / the two kinds / the two polling positions depend only on the pair, never on
    which variable crossed it, so grouping by pair loses nothing -- and it matters: on a
    project with 574 execution units the per-variable form produced 216,821 rows and 111 MB,
    which is neither readable by a person nor loadable by a model.
    """

    by_id = {unit.unit_id: unit for unit in units}
    positions = {unit_id: index for index, unit_id in enumerate(order)}
    pairs: dict[tuple[str, str], dict[str, Any]] = {}
    for resource in shared:
        for writer in resource.units:
            if not WRITE_KINDS & set(writer.kinds):
                continue
            for reader in resource.units:
                if reader.unit_id == writer.unit_id or not READ_KINDS & set(reader.kinds):
                    continue
                w_kind, w_pos, w_context = _effective(writer.unit_id, by_id, positions)
                r_kind, r_pos, r_context = _effective(reader.unit_id, by_id, positions)
                if w_context == r_context:
                    continue  # 同一个执行上下文（任务和它自己调的回调）：顺序执行，不是单元间依赖
                if "isr" in {w_kind, r_kind}:
                    order_kind = "async"
                elif w_kind == "task" and r_kind == "task":
                    if scheduling == "cooperative":
                        if w_pos is None or r_pos is None:
                            order_kind = "unknown-order"
                        else:
                            order_kind = "same-round" if w_pos < r_pos else "next-round"
                    elif scheduling == "preemptive":
                        order_kind = "preemptive"
                    else:
                        order_kind = "unknown-order"
                elif "main" in {w_kind, r_kind}:
                    order_kind = "main"
                else:
                    order_kind = "unknown-order"
                entry = pairs.setdefault(
                    (writer.unit_id, reader.unit_id),
                    {
                        "from_kind": w_kind,
                        "to_kind": r_kind,
                        "order": order_kind,
                        "from_position": w_pos,
                        "to_position": r_pos,
                        "resources": [],
                    },
                )
                entry["resources"].append(
                    DataDependencyResource(
                        resource=resource.resource,
                        name=resource.name,
                        variable=resource.variable,
                        writes=sum(1 for item in writer.accesses if item.kind in WRITE_KINDS),
                        reads=sum(1 for item in reader.accesses if item.kind in READ_KINDS),
                        volatile=resource.volatile,
                        atomicity=resource.atomicity,
                        derived=any(item.derived is not None for item in (*writer.accesses, *reader.accesses)),
                    )
                )
    out = [
        DataDependency(
            from_unit=from_unit,
            to_unit=to_unit,
            from_kind=entry["from_kind"],
            to_kind=entry["to_kind"],
            order=entry["order"],
            from_position=entry["from_position"],
            to_position=entry["to_position"],
            resources=tuple(sorted(entry["resources"], key=lambda item: item.name)),
        )
        for (from_unit, to_unit), entry in pairs.items()
    ]
    out.sort(key=lambda item: (item.from_unit, item.to_unit))
    return tuple(out)
