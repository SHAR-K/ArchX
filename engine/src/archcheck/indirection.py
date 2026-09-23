"""Indirection facts (schema 4): callbacks stored in data, and IRQ numbers read from tables.

Everything here is derived from the raw AST facts of ``ast_facts`` plus the file-scope
initializers clangd returned for aggregate variables.  Two questions are answered:

* **Which functions run as callbacks although no registration API took their name
  directly?**  A function whose address lands in a struct field (``cfg.handler = fn``),
  an initializer table (``{CMD_A, handle_a}``, ``.init = mode_init``) or a registration
  API's parameter that the API copies into such a slot (``s_tab[id].cb = FunctionCB``)
  becomes a ``callback`` execution unit.  The *dispatcher* is any function that calls
  through the same slot — matched by (struct type, field) or by the table variable,
  never by pointer analysis, hence ``confidence: medium``.

* **Which interrupt does a non-constant ``nvic_irq_enable(x, ...)`` enable?**  One
  data-flow step is followed: a parameter is traced to the constants its callers pass,
  a struct / array field to the enum constants in the variable's static initializer.
  Anything else is reported as an unresolved ``enableSites`` entry with a reason.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import re
from typing import Any, Callable

from archcheck.ast_facts import (
    FunctionAstFacts,
    RawArgument,
    RawInitEntry,
    RawSlot,
    VariableIndex,
)
from archcheck.framework_rules import FrameworkRules
from archcheck.model import (
    CodeSite,
    EnableSiteRecord,
    ExecutionUnit,
    FunctionSymbol,
    GlobalVariable,
    SemanticEdge,
    SourceLocation,
    VariableSymbol,
)
from archcheck.runtime_units import VectorTable, _handler_candidates, _nearest_definition


REGISTRATION_RELATIONS = {"registers_task", "registers_callback"}
AST_RULE_PREFIX = "ast."
_PARAMETER_TRACE_DEPTH = 2


@dataclass(frozen=True)
class GlobalInitializer:
    """A file-scope aggregate variable with the function / enum references in its initializer."""

    variable_id: str
    name: str
    type_name: str | None
    path: str
    line: int
    entries: tuple[RawInitEntry, ...]


@dataclass(frozen=True)
class CallbackDetail:
    form: str
    slot: dict[str, Any]
    dispatchers: tuple[str, ...]
    stored_at: CodeSite | None
    evidence: dict[str, Any]
    weak_match: bool


@dataclass(frozen=True)
class IndirectionResult:
    address_edges: tuple[SemanticEdge, ...]
    registration_edges: tuple[SemanticEdge, ...]
    details: dict[str, CallbackDetail]
    enable_edges: tuple[SemanticEdge, ...]
    enable_sites: tuple[EnableSiteRecord, ...]


def field_name_of(entry: RawInitEntry, layouts: dict[str, tuple[str, ...]]) -> str | None:
    """Designator, or the field at ``field_index`` in the struct layout when known."""

    if entry.designator is not None:
        return entry.designator
    if entry.field_index is None:
        return None
    type_name = entry.element_type or entry.variable_type
    fields = layouts.get(type_name or "")
    if fields is None or entry.field_index >= len(fields):
        return None
    return fields[entry.field_index]


def _slot_dict(slot: RawSlot | None, variable_id: str | None, field: str | None, base_type: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {"variable": variable_id, "type": base_type, "field": field}
    if slot is not None:
        payload["path"] = slot.path
    return payload


def _slot_keys(
    slot: RawSlot | None,
    path: str,
    index: VariableIndex,
    *,
    field: str | None = None,
    base_type: str | None = None,
    variable_id: str | None = None,
) -> tuple[list[tuple], list[tuple]]:
    """(strong keys, weak keys) identifying where a function pointer lives."""

    strong: list[tuple] = []
    weak: list[tuple] = []
    if slot is not None:
        field = field or slot.field
        base_type = base_type or slot.base_type
        if slot.root_kind == "global" and slot.root_name and variable_id is None:
            variable_id, _ = index.resolve(path, slot.root_name)
            variable_id = variable_id or f"name:{slot.root_name}"
        elif slot.root_name and variable_id is None and slot.root_kind == "local":
            variable_id = f"local:{path}:{slot.root_name}"
    if field:
        if base_type:
            strong.append(("field", base_type, field))
        weak.append(("field-name", field))
    elif variable_id:
        strong.append(("var", variable_id))
    return strong, weak


def _location(path: str, line: int, column: int) -> SourceLocation:
    return SourceLocation(path=path, line=line, column=column)


def _merge_details(current: CallbackDetail, new: CallbackDetail) -> CallbackDetail:
    """One function registered through several forms: union the dispatchers, keep every form.

    ``param-store`` becomes the primary form when present because it ties the callback to
    the registration API that stored it.
    """

    if new.form == "param-store" and current.form != "param-store":
        primary, secondary = new, current
    else:
        primary, secondary = current, new
    dispatchers = tuple(sorted(set(primary.dispatchers) | set(secondary.dispatchers)))
    strong_primary = bool(primary.dispatchers) and not primary.weak_match
    strong_secondary = bool(secondary.dispatchers) and not secondary.weak_match
    weak_match = bool(dispatchers) and not (strong_primary or strong_secondary)
    also = [
        form
        for form in [*primary.evidence.get("alsoForms", []), secondary.form, *secondary.evidence.get("alsoForms", [])]
        if form != primary.form
    ]
    evidence = {**primary.evidence, "alsoForms": list(dict.fromkeys(also))}
    if not strong_primary and strong_secondary:
        evidence["matchedBy"] = secondary.evidence.get("matchedBy", evidence.get("matchedBy"))
    return CallbackDetail(
        primary.form,
        primary.slot,
        dispatchers,
        primary.stored_at or secondary.stored_at,
        evidence,
        weak_match,
    )


def derive_indirection(
    raw_by_function: dict[str, FunctionAstFacts],
    functions: tuple[FunctionSymbol, ...],
    variables: tuple[VariableSymbol, ...],
    globals_: tuple[GlobalVariable, ...],
    global_inits: dict[str, GlobalInitializer],
    layouts: dict[str, tuple[str, ...]],
    resolve_definition: Callable[[str, str], FunctionSymbol | None],
    existing_edges: tuple[SemanticEdge, ...],
    rules: FrameworkRules,
    vector_table: VectorTable,
    definitions_by_name: dict[str, list[FunctionSymbol]],
    excluded_targets: set[str] | None = None,
) -> IndirectionResult:
    by_id = {function.symbol_id: function for function in functions}
    index = VariableIndex(variables, globals_)
    excluded = set(excluded_targets or ())
    rule_registered = {
        edge.target
        for edge in existing_edges
        if edge.relation in REGISTRATION_RELATIONS and not (edge.rule or "").startswith(AST_RULE_PREFIX)
    }

    # -- dispatchers: every indirect call, keyed by the slot it reads -------------------
    dispatch_index: dict[tuple, set[str]] = {}
    for function_id, facts in raw_by_function.items():
        function = by_id.get(function_id)
        if function is None:
            continue
        for call in facts.indirect_calls:
            strong, weak = _slot_keys(call.slot, function.location.path, index)
            for key in strong + weak:
                dispatch_index.setdefault(key, set()).add(function_id)

    def dispatchers_for(strong: list[tuple], weak: list[tuple]) -> tuple[tuple[str, ...], bool]:
        found: set[str] = set()
        for key in strong:
            found.update(dispatch_index.get(key, ()))
        if found:
            return tuple(sorted(found)), False
        for key in weak:
            found.update(dispatch_index.get(key, ()))
        return tuple(sorted(found)), bool(found)

    address_edges: list[SemanticEdge] = []
    registration_edges: list[SemanticEdge] = []
    details: dict[str, CallbackDetail] = {}

    def record(
        source: str,
        target: FunctionSymbol,
        location: SourceLocation,
        form: str,
        slot: dict[str, Any],
        strong: list[tuple],
        weak: list[tuple],
        stored_at: CodeSite | None,
        extra_evidence: dict[str, Any],
        emit_address_of: bool,
    ) -> None:
        if target.symbol_id in excluded:
            return
        dispatchers, weak_match = dispatchers_for(strong, weak)
        if emit_address_of:
            address_edges.append(
                SemanticEdge(source=source, target=target.symbol_id, relation="address_of", locations=(location,))
            )
        if target.symbol_id not in rule_registered:
            registration_edges.append(
                SemanticEdge(
                    source=source,
                    target=target.symbol_id,
                    relation="registers_callback",
                    locations=(location,),
                    rule=f"{AST_RULE_PREFIX}{form}",
                )
            )
        if not dispatchers:
            matched_by = "no-dispatcher-found"
        elif weak_match:
            matched_by = "field-name-only"
        elif any(key[0] == "field" for key in strong):
            matched_by = "struct-type+field"
        else:
            matched_by = "table-variable"
        new = CallbackDetail(form, slot, dispatchers, stored_at, {"form": form, "matchedBy": matched_by, **extra_evidence}, weak_match)
        current = details.get(target.symbol_id)
        details[target.symbol_id] = new if current is None else _merge_details(current, new)

    # -- form 1 / 2: direct stores and initializer tables --------------------------------
    storing_apis: dict[str, list[tuple[int, RawSlot, int, int]]] = {}
    for function_id, facts in raw_by_function.items():
        function = by_id.get(function_id)
        if function is None:
            continue
        path = function.location.path
        for store in facts.function_stores:
            if store.value_kind == "param":
                if store.value in facts.params:
                    storing_apis.setdefault(function_id, []).append(
                        (facts.params.index(store.value), store.slot, store.line, store.column)
                    )
                continue
            target = resolve_definition(store.value, path)
            if target is None:
                continue
            strong, weak = _slot_keys(store.slot, path, index)
            variable_id = next((key[1] for key in strong if key[0] == "var"), None)
            if variable_id is None and store.slot.root_kind == "global" and store.slot.root_name:
                variable_id = index.resolve(path, store.slot.root_name)[0]
            form = "struct-field-assign" if store.slot.field else "pointer-assign"
            record(
                function_id,
                target,
                _location(path, store.line, store.column),
                form,
                _slot_dict(store.slot, variable_id, store.slot.field, store.slot.base_type),
                strong,
                weak,
                None,
                {},
                True,
            )
        for entry in facts.init_entries:
            if entry.value_kind != "function":
                continue
            target = resolve_definition(entry.value, path)
            if target is None:
                continue
            field = field_name_of(entry, layouts)
            base_type = entry.element_type if field else None
            variable_id = f"local:{path}:{entry.variable}"
            strong, weak = _slot_keys(None, path, index, field=field, base_type=base_type, variable_id=variable_id)
            record(
                function_id,
                target,
                _location(path, entry.line, entry.column),
                "init-table",
                {"variable": variable_id, "type": entry.element_type or entry.variable_type, "field": field, "row": entry.row, "fieldIndex": entry.field_index},
                strong,
                weak,
                None,
                {"table": entry.variable, "scope": "local"},
                True,
            )

    for initializer in global_inits.values():
        for entry in initializer.entries:
            if entry.value_kind != "function":
                continue
            target = resolve_definition(entry.value, initializer.path)
            if target is None:
                continue
            field = field_name_of(entry, layouts)
            base_type = entry.element_type if field else None
            strong, weak = _slot_keys(None, initializer.path, index, field=field, base_type=base_type, variable_id=initializer.variable_id)
            record(
                initializer.variable_id,
                target,
                _location(initializer.path, entry.line, entry.column),
                "init-table",
                {"variable": initializer.variable_id, "type": entry.element_type or entry.variable_type, "field": field, "row": entry.row, "fieldIndex": entry.field_index},
                strong,
                weak,
                None,
                {"table": initializer.name, "scope": "file"},
                False,
            )

    # -- form 3: registration APIs that copy a parameter into a slot ---------------------
    for caller_id, facts in raw_by_function.items():
        caller = by_id.get(caller_id)
        if caller is None:
            continue
        path = caller.location.path
        for call in facts.calls:
            api = resolve_definition(call.name, path)
            if api is None or api.symbol_id not in storing_apis:
                continue
            for parameter_index, slot, store_line, store_column in storing_apis[api.symbol_id]:
                if parameter_index >= len(call.args):
                    continue
                argument = call.args[parameter_index]
                if argument.kind != "function" or argument.name is None:
                    continue
                target = resolve_definition(argument.name, path)
                if target is None:
                    continue
                strong, weak = _slot_keys(slot, api.location.path, index)
                variable_id = next((key[1] for key in strong if key[0] == "var"), None)
                if variable_id is None and slot.root_kind == "global" and slot.root_name:
                    variable_id = index.resolve(api.location.path, slot.root_name)[0]
                record(
                    caller_id,
                    target,
                    _location(path, call.line, call.column),
                    "param-store",
                    _slot_dict(slot, variable_id, slot.field, slot.base_type),
                    strong,
                    weak,
                    CodeSite(api.symbol_id, api.location.path, store_line),
                    {"registrationApi": api.symbol_id, "parameterIndex": parameter_index},
                    False,
                )

    enable_edges, enable_sites = _resolve_enable_arguments(
        raw_by_function, by_id, index, global_inits, layouts, rules, vector_table, definitions_by_name, resolve_definition
    )
    return IndirectionResult(
        address_edges=tuple(address_edges),
        registration_edges=tuple(registration_edges),
        details=details,
        enable_edges=tuple(enable_edges),
        enable_sites=tuple(enable_sites),
    )


def attach_callback_details(
    units: tuple[ExecutionUnit, ...],
    details: dict[str, CallbackDetail],
) -> tuple[ExecutionUnit, ...]:
    """Add form / slot / dispatchers to callback-like units and adjust their confidence.

    * units created from an ``ast.*`` rule: medium, or low when the dispatcher was only
      matched by field name;
    * units from a framework rule that a param-store corroborates with a dispatcher: high.
    """

    result: list[ExecutionUnit] = []
    for unit in units:
        detail = details.get(unit.entry_symbol_id)
        if unit.kind == "isr" or detail is None:
            result.append(unit)
            continue
        confidence = unit.confidence
        evidence = dict(detail.evidence)
        if (unit.rule or "").startswith(AST_RULE_PREFIX):
            confidence = "low" if detail.weak_match else "medium"
        elif detail.dispatchers and not detail.weak_match:
            confidence = "high"
            evidence["upgraded"] = f"{unit.rule}: registration API stores its parameter into {detail.slot.get('path') or detail.slot.get('field') or 'a table'} which a dispatcher calls"
        result.append(
            replace(
                unit,
                form=detail.form,
                slot=detail.slot,
                dispatchers=detail.dispatchers,
                stored_at=detail.stored_at,
                evidence=evidence,
                confidence=confidence,
            )
        )
    return tuple(result)


# --------------------------------------------------------------------------------------
# IRQ arguments
# --------------------------------------------------------------------------------------


def _resolve_enable_arguments(
    raw_by_function: dict[str, FunctionAstFacts],
    by_id: dict[str, FunctionSymbol],
    index: VariableIndex,
    global_inits: dict[str, GlobalInitializer],
    layouts: dict[str, tuple[str, ...]],
    rules: FrameworkRules,
    vector_table: VectorTable,
    definitions_by_name: dict[str, list[FunctionSymbol]],
    resolve_definition: Callable[[str, str], FunctionSymbol | None],
) -> tuple[list[SemanticEdge], list[EnableSiteRecord]]:
    callers_of: dict[str, list[tuple[str, tuple[RawArgument, ...]]]] = {}
    for function_id, facts in raw_by_function.items():
        function = by_id.get(function_id)
        if function is None:
            continue
        for call in facts.calls:
            target = resolve_definition(call.name, function.location.path)
            if target is not None:
                callers_of.setdefault(target.symbol_id, []).append((function_id, call.args))

    inits_by_name: dict[str, list[GlobalInitializer]] = {}
    for initializer in global_inits.values():
        inits_by_name.setdefault(initializer.name, []).append(initializer)

    def initializer_for(path: str, name: str) -> GlobalInitializer | None:
        candidates = inits_by_name.get(name, [])
        same_file = [item for item in candidates if item.path == path]
        if same_file:
            return same_file[0]
        return candidates[0] if len(candidates) == 1 else None

    def trace_parameter(function_id: str, parameter: str, depth: int) -> tuple[list[dict[str, Any]], str | None]:
        facts = raw_by_function.get(function_id)
        if facts is None or parameter not in facts.params:
            return [], "parameter-not-found"
        position = facts.params.index(parameter)
        found: list[dict[str, Any]] = []
        reason: str | None = None
        for caller_id, args in callers_of.get(function_id, []):
            if position >= len(args):
                continue
            argument = args[position]
            if argument.kind in {"enum", "literal"} and argument.name:
                found.append({"function": caller_id, "value": argument.name})
            elif argument.kind == "param" and argument.name and depth < _PARAMETER_TRACE_DEPTH:
                nested, nested_reason = trace_parameter(caller_id, argument.name, depth + 1)
                found.extend(nested)
                reason = reason or nested_reason
            else:
                reason = reason or f"caller-argument-{argument.kind}"
        if not callers_of.get(function_id):
            reason = "no-caller-found"
        return found, reason

    edges: list[SemanticEdge] = []
    records: list[EnableSiteRecord] = []
    for function_id, facts in raw_by_function.items():
        function = by_id.get(function_id)
        if function is None:
            continue
        path = function.location.path
        for call in facts.calls:
            rule = rules.match_isr_enable(call.name)
            if rule is None or rule.irq_argument >= len(call.args):
                continue
            argument = call.args[rule.irq_argument]
            if argument.kind in {"enum", "literal"}:
                continue  # constant arguments are handled by the text-level scan
            location = _location(path, call.line, call.column)
            values: list[str] = []
            evidence: dict[str, Any] | None = None
            reason: str | None = None
            if argument.kind == "param" and argument.name:
                found, trace_reason = trace_parameter(function_id, argument.name, 1)
                values = [item["value"] for item in found]
                if found:
                    evidence = {"via": "parameter", "parameter": argument.name, "callers": found}
                reason = None if found else (trace_reason or "parameter-without-constant-caller")
            elif argument.kind in {"member", "element"} and argument.root_kind == "global" and argument.name:
                initializer = initializer_for(path, argument.name)
                if initializer is None:
                    reason = "table-without-static-initializer"
                else:
                    rows: list[dict[str, Any]] = []
                    unresolved_layout = False
                    for entry in initializer.entries:
                        if entry.value_kind != "enum":
                            continue
                        if argument.kind == "member":
                            field = field_name_of(entry, layouts)
                            if field is None and entry.field_index is not None:
                                unresolved_layout = True
                            if field != argument.field:
                                continue
                        elif entry.field_index is not None or entry.designator is not None:
                            continue
                        rows.append({"row": entry.row, "value": entry.value, "line": entry.line})
                    values = [row["value"] for row in rows]
                    if rows:
                        evidence = {
                            "via": "static-initializer",
                            "table": initializer.variable_id,
                            "tableLocation": {"path": initializer.path, "line": initializer.line},
                            "field": argument.field,
                            "rows": rows,
                        }
                    else:
                        reason = "struct-layout-unresolved" if unresolved_layout else "field-has-no-constant-in-initializer"
            elif argument.kind in {"member", "element"}:
                reason = f"{argument.root_kind or 'unknown'}-field-argument"
            elif argument.kind == "var":
                reason = f"{argument.root_kind or 'unknown'}-variable-argument"
            else:
                reason = "non-constant-argument"

            resolved: list[str] = []
            for value in dict.fromkeys(values):
                target: FunctionSymbol | None = None
                for handler_name in _handler_candidates(value, vector_table):
                    target = _nearest_definition(handler_name, path, definitions_by_name)
                    if target is not None:
                        break
                if target is None:
                    continue
                resolved.append(target.symbol_id)
                edges.append(
                    SemanticEdge(
                        source=function_id,
                        target=target.symbol_id,
                        relation="enables_isr",
                        locations=(location,),
                        callee=call.name,
                        rule=rule.rule_id,
                        confidence="medium",
                        evidence={**(evidence or {}), "irq": value},
                    )
                )
            if values and not resolved:
                reason = "irq-constant-without-handler-definition"
            records.append(
                EnableSiteRecord(
                    function=function_id,
                    location=location,
                    callee=call.name,
                    argument_expr=argument.text,
                    rule=rule.rule_id,
                    resolved_to=tuple(dict.fromkeys(resolved)),
                    reason=None if resolved else (reason or "non-constant-argument"),
                    evidence=evidence if resolved else None,
                )
            )
    records.sort(key=lambda item: (item.location.path, item.location.line, item.location.column))
    return edges, records


_INACTIVE_FUNCTION_PATTERN = re.compile(
    r"^(?!\s*(?:#|typedef\b|return\b|else\b|case\b|default\b))"
    r"[A-Za-z_][\w\s\*]*?\b([A-Za-z_]\w*)\s*\(([^;{}()]*)\)\s*\{",
    re.MULTILINE,
)
_INACTIVE_KEYWORDS = {"if", "for", "while", "switch", "do", "sizeof", "return", "defined"}


def scan_inactive_functions(masked_lines: list[str], regions: tuple[tuple[int, int], ...]) -> list[tuple[str, int, tuple[int, int]]]:
    """``(name, line, region)`` for every ``type name(...) {`` inside the given 1-based line ranges."""

    found: list[tuple[str, int, tuple[int, int]]] = []
    for start, end in regions:
        start_index = max(0, start - 1)
        end_index = min(len(masked_lines), end)
        if start_index >= end_index:
            continue
        text = "\n".join(masked_lines[start_index:end_index])
        for match in _INACTIVE_FUNCTION_PATTERN.finditer(text):
            name = match.group(1)
            if name in _INACTIVE_KEYWORDS:
                continue
            line = start + text.count("\n", 0, match.start(1))
            found.append((name, line, (start, end)))
    return found
