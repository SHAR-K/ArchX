"""Calls that a constant-argument guard makes unreachable in this build.

A call inside ``if (mode == CONST)`` can only run when a caller passes ``CONST``.  When no
reachable call site of the enclosing function ever passes it, that call cannot run in this
build, and reachability must not walk it: otherwise every caller inherits the whole subtree
behind the guard.  ``protocol_receive`` is the motivating case -- its two unpack
branches are guarded by a parse-mode parameter that every interrupt-side call site sets to
"buffer only", so without pruning the UART interrupts appear to reach the whole protocol
stack and the command handlers behind it.

The analysis is whole-program and context-insensitive: one observed-constant set per
parameter, gathered from reachable call sites and refined to a fixpoint (pruning shrinks
reachability, which can only shrink the observed sets, so the iteration is monotone).  It
never says "the ISR passes A while the task passes B" -- when both constants are observed,
both branches stay live.  Anything it cannot read exactly (a non-constant argument, a
macro-expanded call site, a function whose address is taken or that is reached through a
function pointer) makes the parameter unknown and disables pruning for it.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, replace
import re

from archcheck.literals import parse_c_integer
from typing import Any

from archcheck.ast_facts import FunctionAstFacts, RawBlock
from archcheck.model import EntryPoint, ExecutionUnit, FunctionSymbol, SemanticEdge, SourceLocation

_INT = re.compile(r"^[+-]?(?:0[xX][0-9a-fA-F]+|\d+)[uUlL]*$")
_NAME = re.compile(r"^[A-Za-z_]\w*$")
_EQUALITY = re.compile(r"^\(*\s*([A-Za-z_]\w*)\s*(==|!=)\s*([^=!<>&|?]+?)\s*\)*$")
_EQUALITY_REVERSED = re.compile(r"^\(*\s*([^=!<>&|?]+?)\s*(==|!=)\s*([A-Za-z_]\w*)\s*\)*$")
_CAST = re.compile(r"^\(\s*[A-Za-z_][\w\s*]*\)\s*")
_CONSTANT_KINDS = {"literal", "enum"}
_MAX_ITERATIONS = 8
_MAX_RECORDS = 400


@dataclass(frozen=True)
class DeadBranch:
    """A call the constant-argument analysis proved cannot run in this build."""

    function: str
    callee: str
    location: SourceLocation
    parameter: str
    condition: str
    requires: tuple[str, ...]
    observed: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "function": self.function,
            "callee": self.callee,
            "location": self.location.to_dict(),
            "parameter": self.parameter,
            "condition": self.condition,
            "requires": list(self.requires),
            "observed": list(self.observed),
            # Whole-program constant set over reachable call sites; not path- or
            # context-sensitive, and only exact constants count.
            "approximation": "constant-argument-guard",
        }


def _value(text: str | None, enum_values: dict[str, str]) -> tuple[str, Any] | None:
    """Canonical constant: ("int", n) for a literal or resolved enum, ("name", id) for a
    bare identifier, None for anything that is not a single constant."""

    if not text:
        return None
    stripped = _CAST.sub("", text.strip()).strip()
    while stripped.startswith("(") and stripped.endswith(")"):
        stripped = stripped[1:-1].strip()
    stripped = stripped.replace(" ", "")
    if not stripped:
        return None
    value = parse_c_integer(stripped)
    if value is not None:
        return ("int", value)
    if _NAME.match(stripped):
        resolved = (enum_values.get(stripped) or "").strip().strip("()")
        resolved_value = parse_c_integer(resolved)
        if resolved_value is not None:
            return ("int", resolved_value)
        return ("name", stripped)
    return None


def _equality(text: str | None, params: tuple[str, ...]) -> tuple[str, str, str] | None:
    """``param == CONST`` / ``CONST != param`` -> (parameter, operator, constant text)."""

    if not text:
        return None
    condensed = " ".join(text.split())
    match = _EQUALITY.match(condensed)
    if match is not None and match.group(1) in params:
        return match.group(1), match.group(2), match.group(3)
    match = _EQUALITY_REVERSED.match(condensed)
    if match is not None and match.group(3) in params:
        return match.group(3), match.group(2), match.group(1)
    return None


def _atoms(block: RawBlock) -> tuple[str, ...]:
    if block.parts:
        return tuple(str(part.get("text") or "") for part in block.parts)
    return (block.condition or "",)


@dataclass(frozen=True)
class _Requirement:
    parameter: str
    index: int
    allowed: frozenset[str] | None  # constant texts that let the call run
    forbidden: frozenset[str] | None  # constant texts that stop it
    condition: str


def _requirements(facts: FunctionAstFacts, line: int) -> list[_Requirement]:
    """Constant-guard requirements a call on ``line`` must satisfy inside its function."""

    blocks = facts.blocks
    params = facts.params
    if not params or not blocks:
        return []
    enclosing = [index for index, block in enumerate(blocks) if block.line <= line <= block.end_line]
    # A call in an ``else`` is not in its ``if``: use the negated condition instead.
    negated: set[int] = set()
    for index in enclosing:
        block = blocks[index]
        if block.kind == "else" and block.parent is not None and 0 <= block.parent < len(blocks):
            negated.add(block.parent)

    out: list[_Requirement] = []

    def add(parameter: str, operator: str, constant: str, condition: str, flip: bool) -> None:
        if parameter not in params:
            return
        positive = (operator == "==") != flip
        out.append(
            _Requirement(
                parameter,
                params.index(parameter),
                frozenset({constant}) if positive else None,
                None if positive else frozenset({constant}),
                condition,
            )
        )

    for index in enclosing:
        block = blocks[index]
        if index in negated and block.kind == "if":
            continue
        if block.kind == "if":
            for atom in _atoms(block):
                found = _equality(atom, params)
                if found is not None:
                    add(found[0], found[1], found[2], atom, flip=False)
        elif block.kind == "else" and block.parent is not None and 0 <= block.parent < len(blocks):
            parent = blocks[block.parent]
            if parent.kind != "if":
                continue
            atoms = _atoms(parent)
            if len(atoms) != 1:
                continue  # else of a compound condition: the negation is a disjunction
            found = _equality(atoms[0], params)
            if found is not None:
                add(found[0], found[1], found[2], "else of " + atoms[0], flip=True)
        elif block.kind == "case" and block.labels and block.parent is not None and 0 <= block.parent < len(blocks):
            parent = blocks[block.parent]
            if parent.kind != "switch" or not parent.condition:
                continue
            subject = parent.condition.strip()
            if "(" in subject:
                subject = subject[subject.find("(") + 1: subject.rfind(")")].strip()
            if subject in params:
                out.append(
                    _Requirement(subject, params.index(subject), frozenset(block.labels), None, parent.condition or "")
                )
    return out


def prune_unreachable_branches(
    raw_by_function: dict[str, FunctionAstFacts],
    functions: tuple[FunctionSymbol, ...],
    edges: tuple[SemanticEdge, ...],
    entries: tuple[EntryPoint, ...],
    units: tuple[ExecutionUnit, ...],
    enum_values: dict[str, str] | None = None,
) -> tuple[tuple[SemanticEdge, ...], tuple[DeadBranch, ...]]:
    """Mark the ``calls`` edges a constant-argument guard makes unreachable.

    Returns the edges (dead ones carry ``dead_branch``) and one record per pruned call.
    """

    enum_values = enum_values or {}
    known = {function.symbol_id for function in functions}
    call_sites = {
        function_id: {(call.line, call.column): call for call in facts.calls}
        for function_id, facts in raw_by_function.items()
    }

    # Functions whose arguments cannot be enumerated: roots, and anything reached other
    # than by a direct call (address taken, dispatched through a slot, registered).
    opaque = {entry.symbol_id for entry in entries}
    opaque.update(unit.entry_symbol_id for unit in units)
    for edge in edges:
        if edge.relation != "calls":
            opaque.add(edge.target)

    roots = [entry.symbol_id for entry in entries if entry.symbol_id in known]
    roots.extend(unit.entry_symbol_id for unit in units if unit.entry_symbol_id in known)

    call_edges = [
        edge
        for edge in edges
        if edge.relation in {"calls", "dispatches"} and edge.source in known and edge.target in known
    ]
    dead: set[int] = set()
    records: list[DeadBranch] = []

    for _ in range(_MAX_ITERATIONS):
        adjacency: dict[str, set[str]] = {}
        for position, edge in enumerate(call_edges):
            if position not in dead:
                adjacency.setdefault(edge.source, set()).add(edge.target)
        reachable = set(roots)
        pending = deque(roots)
        while pending:
            current = pending.popleft()
            for target in adjacency.get(current, ()):
                if target not in reachable:
                    reachable.add(target)
                    pending.append(target)

        # observed[(callee, index)] = canonical values seen, or None when unknown
        observed: dict[tuple[str, int], set[tuple[str, Any]] | None] = {}

        def mark_unknown(callee: str, count: int) -> None:
            for index in range(count):
                observed[(callee, index)] = None

        for position, edge in enumerate(call_edges):
            if position in dead or edge.source not in reachable:
                continue
            callee_facts = raw_by_function.get(edge.target)
            if callee_facts is None:
                continue
            count = len(callee_facts.params)
            if not count:
                continue
            if edge.relation != "calls" or edge.target in opaque:
                mark_unknown(edge.target, count)
                continue
            sites = call_sites.get(edge.source, {})
            if not edge.locations:
                mark_unknown(edge.target, count)
                continue
            for location in edge.locations:
                raw_call = sites.get((location.line, location.column))
                if raw_call is None:
                    mark_unknown(edge.target, count)
                    continue
                for index in range(count):
                    key = (edge.target, index)
                    if key in observed and observed[key] is None:
                        continue
                    argument = raw_call.args[index] if index < len(raw_call.args) else None
                    # Only a literal or an enum constant is a value; a parameter or a
                    # variable reference reads as an identifier but is not constant.
                    constant = argument is not None and argument.kind in _CONSTANT_KINDS
                    value = _value(argument.text, enum_values) if constant else None
                    if value is None:
                        observed[key] = None
                    else:
                        bucket = observed.setdefault(key, set())
                        if bucket is not None:
                            bucket.add(value)

        new_dead = set(dead)
        new_records: list[DeadBranch] = []
        for position, edge in enumerate(call_edges):
            if position in dead or edge.relation != "calls" or edge.source not in reachable:
                continue
            facts = raw_by_function.get(edge.source)
            if facts is None or not facts.params or not edge.locations:
                continue
            verdicts = [_verdict(facts, location.line, observed, edge.source, enum_values) for location in edge.locations]
            if not all(verdicts):
                continue
            reason = verdicts[0]
            assert reason is not None
            new_dead.add(position)
            new_records.append(
                DeadBranch(
                    function=edge.source,
                    callee=edge.target,
                    location=edge.locations[0],
                    parameter=reason[0],
                    condition=reason[1],
                    requires=reason[2],
                    observed=reason[3],
                )
            )
        if new_dead == dead:
            break
        dead = new_dead
        records = new_records

    if not dead:
        return edges, ()

    by_key = {(record.function, record.callee): record for record in records}
    marked = tuple(
        replace(edge, dead_branch=by_key[(edge.source, edge.target)].to_dict())
        if edge.relation == "calls" and (edge.source, edge.target) in by_key
        else edge
        for edge in edges
    )
    records.sort(key=lambda record: (record.location.path, record.location.line))
    return marked, tuple(records[:_MAX_RECORDS])


def _verdict(
    facts: FunctionAstFacts,
    line: int,
    observed: dict[tuple[str, int], set[tuple[str, Any]] | None],
    function_id: str,
    enum_values: dict[str, str],
) -> tuple[str, str, tuple[str, ...], tuple[str, ...]] | None:
    """(parameter, condition, required, observed) when a guard proves the call cannot run."""

    for requirement in _requirements(facts, line):
        values = observed.get((function_id, requirement.index))
        if not values:
            continue  # unknown, or never called on a reachable path
        texts = requirement.allowed if requirement.allowed is not None else requirement.forbidden
        required = {_value(text, enum_values) for text in (texts or frozenset())}
        if not required or None in required:
            continue
        kinds = {kind for kind, _ in values} | {kind for kind, _ in required if kind is not None}
        if len(kinds) != 1:
            continue  # mixing resolved integers with bare names proves nothing
        if requirement.allowed is not None:
            if values & required:
                continue
        elif not values <= required:
            continue
        return (
            requirement.parameter,
            requirement.condition,
            tuple(sorted(str(value) for _, value in required)),
            tuple(sorted(str(value) for _, value in values)),
        )
    return None
