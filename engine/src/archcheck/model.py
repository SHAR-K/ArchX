from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CompileCommand:
    directory: Path
    file: Path
    arguments: tuple[str, ...]
    raw_directory: str
    output: str | None = None


@dataclass(frozen=True)
class PathMapping:
    source: str
    target: Path

    def to_dict(self) -> dict[str, str]:
        return {"source": self.source, "target": str(self.target)}


@dataclass(frozen=True)
class DependencyEdge:
    source: str
    target: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True)
class CouplingHotspot:
    path: str
    fan_in: int
    fan_out: int

    @property
    def total(self) -> int:
        return self.fan_in + self.fan_out

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "total": self.total}


@dataclass(frozen=True)
class SourceLocation:
    path: str
    line: int
    column: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class GlobalVariable:
    name: str
    type_name: str
    storage: str
    definition: SourceLocation
    references: tuple[SourceLocation, ...]

    @property
    def referenced_files(self) -> int:
        return len({location.path for location in self.references})

    @property
    def cross_file(self) -> bool:
        return any(
            location.path != self.definition.path for location in self.references
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "type_name": self.type_name,
            "storage": self.storage,
            "definition": self.definition.to_dict(),
            "references": [location.to_dict() for location in self.references],
            "referenced_files": self.referenced_files,
            "cross_file": self.cross_file,
        }


@dataclass(frozen=True)
class DoxygenDocumentation:
    brief: str = ""
    params: tuple[tuple[str, str], ...] = ()
    returns: str = ""
    notes: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class FunctionSymbol:
    symbol_id: str
    name: str
    detail: str
    location: SourceLocation
    end_line: int
    documentation: DoxygenDocumentation | None = None
    is_definition: bool = True
    compile_branch: str | None = None
    # True for bodies that live in a header (static inline helpers, CMSIS intrinsics);
    # they have no translation unit of their own and are harvested via call targets.
    defined_in_header: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol_id": self.symbol_id,
            "name": self.name,
            "detail": self.detail,
            "location": self.location.to_dict(),
            "end_line": self.end_line,
            "documentation": (
                self.documentation.to_dict() if self.documentation is not None else None
            ),
            "isDefinition": self.is_definition,
            "compileBranch": self.compile_branch,
            "definedInHeader": self.defined_in_header,
        }


@dataclass(frozen=True)
class ExternDeclaration:
    """A function prototype found in a translation unit whose definition lives elsewhere."""

    name: str
    declared_in: SourceLocation
    resolves_to: str | None
    via_header: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "declaredIn": self.declared_in.to_dict(),
            "resolvesTo": self.resolves_to,
            "viaHeader": self.via_header,
        }


@dataclass(frozen=True)
class VariableSymbol:
    symbol_id: str
    name: str
    detail: str
    scope: str
    location: SourceLocation
    parent_function: str | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class SemanticEdge:
    source: str
    target: str
    relation: str
    locations: tuple[SourceLocation, ...] = ()
    # address_of: which argument of which callee carried the function name.
    argument_index: int | None = None
    callee: str | None = None
    # registers_* / enables_isr: the framework rule that interpreted the raw edge.
    rule: str | None = None
    # Schema 4: edges derived through a data-flow step (IRQ number read from a
    # configuration table, callback stored into a struct field) say how sure they are
    # and what they were derived from.  Absent for directly observed edges.
    confidence: str | None = None
    evidence: dict[str, Any] | None = None
    # Set when a constant-argument guard proves the call cannot run in this build: the call
    # is still a fact about the source, but reachability and everything derived from it skip
    # the edge.  Payload is the DeadBranch record (path_pruning).
    dead_branch: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "source": self.source,
            "target": self.target,
            "relation": self.relation,
            "locations": [location.to_dict() for location in self.locations],
        }
        if self.dead_branch is not None:
            payload["deadBranch"] = self.dead_branch
        if self.argument_index is not None:
            payload["argumentIndex"] = self.argument_index
        if self.callee is not None:
            payload["callee"] = self.callee
        if self.rule is not None:
            payload["rule"] = self.rule
        if self.confidence is not None:
            payload["confidence"] = self.confidence
        if self.evidence is not None:
            payload["evidence"] = self.evidence
        return payload


@dataclass(frozen=True)
class EnumFact:
    """An enum type with its enumerators and values (fact: documentSymbol + hover).

    ``name`` is the tag or typedef name when clangd reports one, else ``(anonymous)``;
    consumers match enums to state machines by member names.
    """

    name: str
    location: SourceLocation
    members: tuple[dict[str, Any], ...]

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "location": self.location.to_dict(), "members": list(self.members)}


@dataclass(frozen=True)
class ExternalSymbol:
    """A called function that is declared in the project but defined nowhere in it.

    Closed-source libraries (``.lib`` / ``.a``), code left out of the compilation
    database and vendor blobs show up here.  Calls to it keep their edge (target
    ``external:<name>``) instead of being dropped, so a module's dependency on a
    binary library stays visible.  ``library`` is inferred from library files next to
    the declaring header; ``libraryCandidates`` lists every file considered.
    """

    symbol_id: str
    name: str
    declared_in: tuple[SourceLocation, ...]
    library: str | None
    library_candidates: tuple[str, ...] = ()
    callers: tuple[str, ...] = ()
    kind: str = "function"

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbolId": self.symbol_id,
            "name": self.name,
            "kind": self.kind,
            "declaredIn": [item.to_dict() for item in self.declared_in],
            "library": self.library,
            "libraryCandidates": list(self.library_candidates),
            "callers": list(self.callers),
            "inference": "library from *.lib / *.a files in the declaring header's directory",
        }


@dataclass(frozen=True)
class EnableSiteRecord:
    """A call to an ISR enable API whose IRQ argument is not a constant (schema 4).

    ``resolvedTo`` lists the handler symbol ids found through one data-flow step
    (a parameter traced to its callers' constants, or a struct / array field read from
    the variable's static initializer).  When nothing resolves, ``reason`` says why so
    the enable point is still visible.
    """

    function: str
    location: SourceLocation
    callee: str
    argument_expr: str
    rule: str
    resolved_to: tuple[str, ...] = ()
    reason: str | None = None
    evidence: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "function": self.function,
            "location": self.location.to_dict(),
            "callee": self.callee,
            "argumentExpr": self.argument_expr,
            "rule": self.rule,
            "resolvedTo": list(self.resolved_to),
        }
        if self.reason is not None:
            payload["reason"] = self.reason
        if self.evidence is not None:
            payload["evidence"] = self.evidence
            payload["confidence"] = "medium"
        return payload


@dataclass(frozen=True)
class InactiveRegions:
    """Preprocessor-inactive line ranges of one opened file, as reported by clangd."""

    path: str
    regions: tuple[tuple[int, int], ...]  # 1-based inclusive line ranges
    inactive_lines: int
    total_lines: int
    kind: str = "translation-unit"  # or "header"

    @property
    def ratio(self) -> float:
        return round(self.inactive_lines / self.total_lines, 4) if self.total_lines else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "kind": self.kind,
            "regions": [{"startLine": start, "endLine": end} for start, end in self.regions],
            "inactiveLines": self.inactive_lines,
            "totalLines": self.total_lines,
            "ratio": self.ratio,
        }


@dataclass(frozen=True)
class InactiveFunction:
    """A function definition found by text scan inside an inactive region.

    The preprocessor removed it, so it is not in ``functions`` and has no AST facts.
    """

    name: str
    path: str
    line: int
    region: tuple[int, int]

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "path": self.path,
            "line": self.line,
            "region": {"startLine": self.region[0], "endLine": self.region[1]},
            "approximation": "text-scan-in-inactive-region",
        }


@dataclass(frozen=True)
class ExcludedFile:
    path: str
    reason: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True)
class DirectoryCoverage:
    source_files_on_disk: int
    files_analyzed: int
    excluded: int

    def to_dict(self) -> dict[str, int]:
        return {
            "sourceFilesOnDisk": self.source_files_on_disk,
            "filesAnalyzed": self.files_analyzed,
            "excluded": self.excluded,
        }


@dataclass(frozen=True)
class Coverage:
    target: str
    source_files_on_disk: int
    translation_units: int
    files_analyzed: int
    excluded: tuple[ExcludedFile, ...]
    # Schema 4: the same three counters per directory prefix (every depth, cumulative
    # over subdirectories) so a partition can report coverage in its own terms.
    by_directory: dict[str, DirectoryCoverage] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "target": self.target,
            "sourceFilesOnDisk": self.source_files_on_disk,
            "translationUnits": self.translation_units,
            "filesAnalyzed": self.files_analyzed,
            "excluded": [item.to_dict() for item in self.excluded],
        }
        if self.by_directory is not None:
            payload["byDirectory"] = {
                directory: item.to_dict() for directory, item in sorted(self.by_directory.items())
            }
        return payload


@dataclass(frozen=True)
class EntryPoint:
    kind: str
    symbol_id: str

    def to_dict(self) -> dict[str, str]:
        return {"kind": self.kind, "symbolId": self.symbol_id}


@dataclass(frozen=True)
class CodeSite:
    """A function plus the line inside it where something happened.

    ``functionId`` is a ``variable:`` id when the site is a file-scope initializer
    (a callback table outside any function).  ``confidence`` / ``evidence`` are set
    when the site was derived through a data-flow step rather than read directly.
    """

    function_id: str
    path: str
    line: int
    confidence: str | None = None
    evidence: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"functionId": self.function_id, "path": self.path, "line": self.line}
        if self.confidence is not None:
            payload["confidence"] = self.confidence
        if self.evidence is not None:
            payload["evidence"] = self.evidence
        return payload


@dataclass(frozen=True)
class BlockingCall:
    """A call inside a loop body that a blocking rule classified (schema 3)."""

    callee: str
    rule: str
    kind: str
    location: SourceLocation
    # "ast": a CallExpr node named the callee; "text": the name only appears in the
    # source text of the loop body (function-like macro such as ``thread_sleep``).
    via: str = "ast"
    # For delay rules: {"argument": source text, "value": number | None, "unit": ms|us|s|tick}
    duration: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "callee": self.callee,
            "rule": self.rule,
            "kind": self.kind,
            "location": self.location.to_dict(),
            "via": self.via,
        }
        if self.duration is not None:
            payload["duration"] = self.duration
        return payload


@dataclass(frozen=True)
class LoopFact:
    """One loop statement in a function body (schema 3, fact: read from the AST)."""

    function: str
    kind: str  # while | for | do | goto
    location: SourceLocation
    end_line: int
    infinite: bool | None
    depth: int
    calls_in_body: tuple[str, ...] = ()
    blocking_calls: tuple[BlockingCall, ...] = ()
    # Counted-``for`` shape from the header: {shape: counted, variable, start, comparison,
    # limit, step, basis, max}.  ``max`` is None when the limit is not a resolvable number
    # (a variable, a sizeof expression); absent entirely for while / do and non-counted for.
    iterations: dict[str, Any] | None = None
    # Early exits from the body: ({kind: break | return | goto, line}, ...).  The condition
    # becoming false (and, for yield loops, the blocking calls) are the other ways out.
    exits: tuple[dict[str, Any], ...] = ()
    # goto-based or otherwise unrecognised loop shapes; ``infinite`` is None for them.
    unrecognized: bool = False
    # The loop statement comes from a macro expansion (its range is the macro call).
    from_macro: bool = False

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "function": self.function,
            "kind": self.kind,
            "location": self.location.to_dict(),
            "endLine": self.end_line,
            "infinite": self.infinite,
            "depth": self.depth,
            "callsInBody": list(self.calls_in_body),
            "blockingCalls": [item.to_dict() for item in self.blocking_calls],
        }
        if self.iterations is not None:
            payload["iterations"] = self.iterations
        payload["exits"] = list(self.exits)
        if self.unrecognized:
            payload["unrecognized"] = True
        if self.from_macro:
            payload["fromMacro"] = True
        return payload


@dataclass(frozen=True)
class RunMode:
    """Derived (not read) operating mode of an execution unit root (schema 3)."""

    unit_id: str
    function: str
    mode: str  # periodic | event-driven | busy-poll | one-shot | unknown
    confidence: str
    evidence: dict[str, Any]
    # Derived for periodic units from literal delay arguments × rule unit (× tick_ms);
    # None when the argument is not a literal.  The basis is spelled out in evidence["period"].
    period_ms: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "unitId": self.unit_id,
            "function": self.function,
            "mode": self.mode,
            "confidence": self.confidence,
            "periodMs": self.period_ms,
            "evidence": self.evidence,
        }


@dataclass(frozen=True)
class StateLabel:
    name: str
    value: str | None
    is_enum: bool
    location: SourceLocation | None
    # Last line of this case's body: the slice of the function a sequence view shows
    # for "one iteration in this state".  None when the label position is unknown.
    end_line: int | None = None
    # ``if (c) break;`` guards at the top level of the case body: when c holds the state stays
    guards: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "isEnum": self.is_enum,
            "location": self.location.to_dict() if self.location is not None else None,
            "endLine": self.end_line,
            "guards": list(self.guards),
        }


@dataclass(frozen=True)
class ControlBlock:
    """One control-flow statement of a function body (schema 4.1, fact: read from the AST).

    Calls, accesses and blocking points carry line numbers; intersecting them with these
    ranges tells whether they sit inside a branch, a loop or a case.  ``parent`` indexes
    the enclosing block within the same function's list (sorted by position).
    """

    function: str
    kind: str  # if | else | switch | case | default | while | for | do
    location: SourceLocation
    end_line: int
    condition: str | None
    labels: tuple[str, ...] = ()
    depth: int = 0
    parent: int | None = None
    # condition atoms: ``parts`` when the branch is taken (split on &&), ``partsNegated`` when
    # it is not (split on ||); only for if / while
    parts: tuple[dict[str, Any], ...] = ()
    parts_negated: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "function": self.function,
            "kind": self.kind,
            "location": self.location.to_dict(),
            "endLine": self.end_line,
            "condition": self.condition,
            "depth": self.depth,
            "parent": self.parent,
        }
        if self.labels:
            payload["labels"] = list(self.labels)
        if self.parts:
            payload["parts"] = list(self.parts)
            payload["partsNegated"] = list(self.parts_negated)
        return payload


@dataclass(frozen=True)
class StateTransition:
    from_states: tuple[str, ...]
    to: str
    to_is_enum: bool
    location: SourceLocation
    condition: str | None
    # "assignment": ``state = X`` inside the switch; "call:<callee>": an enum argument
    # passed to a function that writes the dispatch variable; "outside-switch": an
    # assignment elsewhere in the same function.
    via: str = "assignment"
    to_text: str | None = None
    # Source-ordered steps: {"text", "kind": if | else | guard-break | guard-return | guard-continue, "line"}.
    # if / else are the enclosing branches (else means the text must be false); guards are earlier
    # ``if (text) break;`` statements in the same sequences (the text must be false to get here).
    condition_steps: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "from": list(self.from_states),
            "to": self.to,
            "toIsEnum": self.to_is_enum,
            "location": self.location.to_dict(),
            "condition": self.condition,
            "conditionSteps": list(self.condition_steps),
            "via": self.via,
        }
        if self.to_text is not None:
            payload["toText"] = self.to_text
        return payload


@dataclass(frozen=True)
class StateMachine:
    """A ``switch`` over a variable, read as a state-machine candidate (schema 3)."""

    machine_id: str
    function: str
    location: SourceLocation
    dispatch: str
    dispatch_variable: str | None
    dispatch_scope: str  # global | local | param | unknown
    dispatch_type: str | None
    enum_type: str | None
    states: tuple[StateLabel, ...]
    has_default: bool
    transitions: tuple[StateTransition, ...]
    confidence: str
    writers_elsewhere: tuple[str, ...] = ()
    from_macro: bool = False
    # What functions outside the switch assign to the dispatch variable (target, condition,
    # location); calls to them from case bodies appear as ``via: call:<fn>`` transitions.
    external_writes: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.machine_id,
            "function": self.function,
            "location": self.location.to_dict(),
            "dispatch": self.dispatch,
            "dispatchVariable": self.dispatch_variable,
            "dispatchScope": self.dispatch_scope,
            "dispatchType": self.dispatch_type,
            "enumType": self.enum_type,
            "states": [item.to_dict() for item in self.states],
            "hasDefault": self.has_default,
            "transitions": [item.to_dict() for item in self.transitions],
            "writersElsewhere": list(self.writers_elsewhere),
            "externalWrites": list(self.external_writes),
            "fromMacro": self.from_macro,
            "confidence": self.confidence,
        }


@dataclass(frozen=True)
class ResourceAccess:
    """Function × file-level variable × access kind, read from the AST (schema 3)."""

    function: str
    variable: str | None
    name: str
    kind: str  # read | write | read_write | address_taken
    location: SourceLocation
    # None for a plain identifier; otherwise how the lvalue was formed: field | index |
    # field+index | pointer-field | pointer-index | pointer-deref | array-decay.
    via: str | None = None
    in_critical_section: bool = False
    # 推导出来的访问（不是这一行源码直接写的）：``foo(&g)`` 且 foo 体内经那个形参指针写 → 调用方对 g 的写。
    # 只走一步、不跟别名；``{callee, calleeName, param, calleeAccess, basis}``。为 None 时是 AST 直接读到的。
    derived: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "function": self.function,
            "variable": self.variable,
            "name": self.name,
            "kind": self.kind,
            "location": self.location.to_dict(),
        }
        if self.via is not None:
            payload["via"] = self.via
        if self.in_critical_section:
            payload["inCriticalSection"] = True
        if self.derived is not None:
            payload["derived"] = self.derived
        return payload

    def to_site_dict(self) -> dict[str, Any]:
        """Compact form used where the variable is already known from the parent."""

        payload = self.to_dict()
        payload.pop("variable", None)
        payload.pop("name", None)
        return payload


@dataclass(frozen=True)
class CriticalSection:
    function: str
    begin: SourceLocation
    end: SourceLocation | None
    api: str
    end_api: str | None
    rule: str
    kind: str
    accesses_inside: tuple[ResourceAccess, ...]
    unterminated: bool = False
    # True when begin / end are project wrappers (``lock()`` whose body disables interrupts
    # without re-enabling them, ``unlock()`` the reverse) rather than the rule's own APIs.
    via_wrapper: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "function": self.function,
            "begin": self.begin.to_dict(),
            "end": self.end.to_dict() if self.end is not None else None,
            "api": self.api,
            "endApi": self.end_api,
            "rule": self.rule,
            "kind": self.kind,
            "accessesInside": [item.to_dict() for item in self.accesses_inside],
            "unterminated": self.unterminated,
            "viaWrapper": self.via_wrapper,
            # Direct: begin and end were found in one statement sequence.  Wrapper: begin and
            # end wrappers were paired by source order inside one function.  Protection along
            # other paths or in callees is not proven either way.
            "approximation": "wrapper-call-sequence" if self.via_wrapper else "same-block-sequence",
        }


# 序列化上限。判定始终读全量（_conflict 走 accesses 判断保护与方向），这里只收敛
# 输出体积：一个被 218 个执行单元碰过的全局单例列出 98,129 个访问点，对人和模型都只是
# 噪声，而资源级的结论——多少单元、哪些读写、有没有未保护的写——一条都不会丢。
MAX_ACCESS_SITES_PER_UNIT = 10
MAX_UNITS_PER_RESOURCE = 20
MAX_RESOURCES_PER_DEPENDENCY = 20
# 超过这么多执行单元访问的变量，性质上已经不是"共享变量"而是全局基础设施
WIDELY_SHARED_UNIT_THRESHOLD = 20


@dataclass(frozen=True)
class UnitAccessSummary:
    unit_id: str
    unit_kind: str
    kinds: tuple[str, ...]
    unprotected_kinds: tuple[str, ...]
    accesses: tuple[ResourceAccess, ...]

    def to_dict(self) -> dict[str, Any]:
        shown = self.accesses[:MAX_ACCESS_SITES_PER_UNIT]
        out: dict[str, Any] = {
            "unit": self.unit_id,
            "unitKind": self.unit_kind,
            "kinds": list(self.kinds),
            "unprotectedKinds": list(self.unprotected_kinds),
            "accessCount": len(self.accesses),
            "accesses": [item.to_site_dict() for item in shown],
        }
        if len(self.accesses) > len(shown):
            out["accessesOmitted"] = len(self.accesses) - len(shown)
        return out


@dataclass(frozen=True)
class SharedResource:
    """Derived: a variable reached from more than one execution unit (schema 3)."""

    resource: str
    name: str
    variable: str | None
    volatile: bool
    units: tuple[UnitAccessSummary, ...]
    # Declared type (qualifiers kept) and its estimated width; ``atomicity`` says whether a
    # single load / store of the whole object is atomic on the target:
    # ``single-word`` (width <= profile atomic_width_bytes), ``wide`` (scalar wider than a
    # word), ``composite`` (struct / union / array: never atomic as a whole), ``unknown``.
    type_name: str | None = None
    width_bytes: int | None = None
    atomicity: str = "unknown"

    def to_dict(self) -> dict[str, Any]:
        # When the list has to be cut, interrupts, tasks, main and timers go first: a variable
        # reached by 100 callbacks through a function-pointer table must not lose the one ISR
        # that writes it, or the panel says "no interrupt touches this" while conflictCandidates
        # says otherwise (grblHAL-ESP32: 244 resources, every ISR side cut off).  Below the cap
        # the engine's own order is kept, so small projects' facts do not move around.
        if len(self.units) > MAX_UNITS_PER_RESOURCE:
            rank = {"isr": 0, "task": 1, "main": 2, "timer": 3}
            shown = sorted(self.units, key=lambda item: (rank.get(item.unit_kind, 9), item.unit_id))[:MAX_UNITS_PER_RESOURCE]
        else:
            shown = self.units
        out: dict[str, Any] = {
            "resource": self.resource,
            "name": self.name,
            "variable": self.variable,
            "volatile": self.volatile,
            "typeName": self.type_name,
            "widthBytes": self.width_bytes,
            "atomicity": self.atomicity,
            "unitCount": len(self.units),
            "accessCount": sum(len(item.accesses) for item in self.units),
            "units": [item.to_dict() for item in shown],
        }
        if len(self.units) > len(shown):
            out["unitsOmitted"] = len(self.units) - len(shown)
        if len(self.units) >= WIDELY_SHARED_UNIT_THRESHOLD:
            out["widelyShared"] = True
        return out


@dataclass(frozen=True)
class ConflictCandidate:
    """Derived: an ISR-side write meets an unprotected task/callback-side access."""

    resource: str
    name: str
    variable: str | None
    volatile: bool
    isr_side: tuple[UnitAccessSummary, ...]
    other_side: tuple[UnitAccessSummary, ...]
    pattern: str
    confidence: str
    reason: str
    # "notification-flag" when the same variable is also a wake relation (ISR sets, task polls
    # it in a condition): the sharing is a design intent, not necessarily a race.
    role: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "resource": self.resource,
            "name": self.name,
            "variable": self.variable,
            "volatile": self.volatile,
            "isrSide": [item.to_dict() for item in self.isr_side],
            "otherSide": [item.to_dict() for item in self.other_side],
            "pattern": self.pattern,
            "confidence": self.confidence,
            "reason": self.reason,
            "approximation": "reachability-and-same-block-critical-sections; not a path proof",
        }
        if self.role is not None:
            payload["role"] = self.role
        return payload


@dataclass(frozen=True)
class WakeRelation:
    """Derived: an ISR-side unit writes a variable that a task/callback polls in a condition.

    ``kind`` is ``flag-poll`` (write in ISR context, read inside an if/while/do condition
    in task or callback context).  Producers and consumers are execution units with the
    function and line of the write / the polling read.  Not a proof of a handshake.
    """

    resource: str
    name: str
    variable: str | None
    kind: str
    producers: tuple[dict[str, Any], ...]
    consumers: tuple[dict[str, Any], ...]
    confidence: str = "medium"

    def to_dict(self) -> dict[str, Any]:
        return {
            "resource": self.resource,
            "name": self.name,
            "variable": self.variable,
            "kind": self.kind,
            "producers": list(self.producers),
            "consumers": list(self.consumers),
            "confidence": self.confidence,
            "approximation": "write in ISR context + read inside a condition in task/callback context; no value or ordering analysis",
        }


@dataclass(frozen=True)
class AstFactsSummary:
    """How much of the AST layer ran (schema 3 metadata)."""

    functions_requested: int = 0
    functions_analyzed: int = 0
    functions_failed: int = 0
    elapsed_seconds: float = 0.0
    do_while_zero_skipped: int = 0
    switches_skipped: int = 0
    enum_values_resolved: int = 0
    # Schema 4
    initializers_requested: int = 0
    initializers_analyzed: int = 0
    struct_layouts_resolved: int = 0
    struct_layouts_failed: int = 0
    inactive_region_files: int = 0
    # Callbacks whose dispatcher no ISR / task / main can reach (host unknown).
    callbacks_host_unknown: int = 0
    callbacks_host_ambiguous: int = 0
    # Calls a constant-argument guard proved unreachable in this build.
    dead_branch_calls: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "functionsRequested": self.functions_requested,
            "functionsAnalyzed": self.functions_analyzed,
            "functionsFailed": self.functions_failed,
            "elapsedSeconds": round(self.elapsed_seconds, 3),
            "doWhileZeroSkipped": self.do_while_zero_skipped,
            "switchesSkipped": self.switches_skipped,
            "enumValuesResolved": self.enum_values_resolved,
            "initializersRequested": self.initializers_requested,
            "initializersAnalyzed": self.initializers_analyzed,
            "structLayoutsResolved": self.struct_layouts_resolved,
            "structLayoutsFailed": self.struct_layouts_failed,
            "inactiveRegionFiles": self.inactive_region_files,
            "callbacksHostUnknown": self.callbacks_host_unknown,
            "callbacksHostAmbiguous": self.callbacks_host_ambiguous,
            "deadBranchCalls": self.dead_branch_calls,
            "approximations": {
                "loops.infinite": "literal condition or missing for-condition only; flag/goto loops are unrecognized",
                "timeBase.core-clock": "the CMSIS core-clock global's initializer; SystemInit may rewrite it at reset, so it is not a constant",
                "timeBase.systick": "reload expression folded over literals and hovered constants; the tick period needs the core clock too",
                "timeBase.tick-counter": "a file-level variable whose only writes are `++` in ISR-reachable functions and that thread code reads; a naming-free pattern, not a proof",
                "timeBase.timeout-loop": "a loop whose condition compares the tick counter; the bound is in ticks, multiply by the tick period for milliseconds",
                "loops.exits": "break / return / goto statements lexically inside the body that leave this loop (a break aimed at an inner switch is not one); whether they are reached is not decided",
                "loops.iterations": "read from the `for` header alone (counter = start, comparison, step); the body may move the counter or the limit, so `max` is the header's upper bound, not a proof",
                "reachability.dispatches": "may-call: every callback registered into a slot counts as reachable from every function that calls through that slot; which one fires is a runtime fact",
                "deadBranches": "a call guarded by `param == CONST` that no reachable call site can enable; whole-program constant sets per parameter, not path- or context-sensitive, and only exact constants (literals and resolved enums) count",
                "executionUnits.hosts": "contexts whose reachable set contains the callback (through dispatches edges); several hosts = ambiguous, none = the dispatcher is not reached from any unit",
                "runModes.inherited": "a callback with exactly one host inherits that host's mode / period at medium confidence",
                "runModes": "derived from the entry function's infinite loop and direct blocking calls (macro names matched by text); not a path proof",
                "stateMachines.transitions.condition": "text of enclosing if conditions; not a path condition",
                "stateMachines.transitions.conditionSteps": "enclosing if / else branches plus preceding `if (c) break|return|continue;` guards in the same statement sequences, in source order; guards inside called helpers are not seen",
                "stateMachines.transitions.conditionSteps.parts": "atoms read from the AST: split along the top-level operator; parts carry anyOf: true when they are alternatives (else branch of a && condition, taken branch of a || condition), otherwise all of them must hold; macro-expanded conditions have no range and stay whole",
                "stateMachines.externalWrites": "assignments to the dispatch variable in other functions with their enclosing if conditions; a call to such a helper from a case body is drawn as a transition to every value the helper may assign",
                "criticalSections": "same-block-sequence: begin and end API in one statement sequence; cross-function or conditional protection is not seen",
                "conflictCandidates": "reachability-based; a candidate is not a proven race and an absent candidate is not a proof of safety",
                "executionUnits[form]": "callbacks found through a function pointer stored in a struct field / initializer table / registration parameter; dispatchers are matched by (struct type, field) or by the table variable, not by pointer analysis",
                "enableSites": "one data-flow step: parameter -> callers' constants, struct/array field -> the variable's static initializer; runtime writes to the table are not followed",
                "inactiveFunctions": "text scan of clangd inactive regions for `type name(...) {`; macros and K&R definitions can be missed",
                "compileBranch": "textual conjunction of the enclosing #if conditions (a fact about the source text); whether it is active is proven by the function being present at all — inactive code is listed under inactiveRegions / inactiveFunctions instead",
                "externalSymbols.library": "nearest *.lib / *.a in the declaring header's directory; several versions side by side are listed as candidates",
                "wakeRelations": "ISR-context write + task/callback read inside an if/while/do condition; a polling handshake candidate, not a proof",
                "runModes.periodMs": "literal delay argument × rule unit (× tick_ms for tick units); None when the argument is not a literal",
                "controlFlow": "statement skeleton by source ranges (if/else/loops/switch/case); macro-expanded statements without a range are missing, and a case body ends at the next label (fall-through is not modelled)",
            },
        }


@dataclass(frozen=True)
class ExecutionUnit:
    unit_id: str
    kind: str
    entry_symbol_id: str
    confidence: str
    vector: int | None = None
    vector_table: SourceLocation | None = None
    enabled_at: tuple[CodeSite, ...] = ()
    registered_at: CodeSite | None = None
    also_registered_at: tuple[CodeSite, ...] = ()
    rule: str | None = None
    run_mode: RunMode | None = None
    # Schema 4 (callbacks registered through data rather than a direct API argument):
    # ``form`` is struct-field-assign | init-table | param-store; ``slot`` names the
    # variable / struct type / field holding the pointer; ``dispatchers`` are the
    # functions that call through that slot; ``stored_at`` is where a registration
    # API copied its parameter into the slot.
    form: str | None = None
    slot: dict[str, Any] | None = None
    dispatchers: tuple[str, ...] = ()
    stored_at: CodeSite | None = None
    evidence: dict[str, Any] | None = None
    # Hosts: the ISR / task / main units whose reachable set (through the may-call
    # ``dispatches`` edges) contains this callback's entry — i.e. the contexts it runs in.
    # ``host_confidence``: high = one host and a strong registration, medium = one host,
    # low = several hosts (which one fires is a runtime fact), None = no host found.
    hosts: tuple[str, ...] = ()
    host_confidence: str | None = None
    # Tasks only.  ``value`` is the numeric priority when the source states it plainly
    # (literal, enum constant, ``base + literal``), else None; ``symbol`` the constant name
    # if one was used; ``argument`` the operand as written; ``basis`` literal | enum |
    # expression | attr-initializer | unresolved; ``at`` where it was read from.  Higher
    # number = higher priority in FreeRTOS / CMSIS-RTOS2; Zephyr is the other way round,
    # so consumers read ``order`` (ascending | descending) from the profile, not here.
    priority: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.unit_id,
            "kind": self.kind,
            "entrySymbolId": self.entry_symbol_id,
        }
        if self.kind == "isr":
            payload["vector"] = self.vector
            payload["vectorTable"] = (
                self.vector_table.to_dict() if self.vector_table is not None else None
            )
            payload["enabledAt"] = [site.to_dict() for site in self.enabled_at]
            # Registered through an API (context: isr rule) rather than named in a vector table
            if self.registered_at is not None:
                payload["registeredAt"] = self.registered_at.to_dict()
                if self.also_registered_at:
                    payload["alsoRegisteredAt"] = [site.to_dict() for site in self.also_registered_at]
                payload["rule"] = self.rule
        else:
            payload["registeredAt"] = (
                self.registered_at.to_dict() if self.registered_at is not None else None
            )
            if self.also_registered_at:
                payload["alsoRegisteredAt"] = [
                    site.to_dict() for site in self.also_registered_at
                ]
            payload["rule"] = self.rule
            if self.form is not None:
                payload["form"] = self.form
            if self.slot is not None:
                payload["slot"] = self.slot
            if self.form is not None or self.dispatchers:
                payload["dispatchers"] = list(self.dispatchers)
            if self.stored_at is not None:
                payload["storedAt"] = self.stored_at.to_dict()
            if self.evidence is not None:
                payload["evidence"] = self.evidence
            if self.kind == "task":
                payload["priority"] = self.priority
            if self.kind not in {"task"}:
                payload["hosts"] = list(self.hosts)
                payload["hostConfidence"] = self.host_confidence
        payload["confidence"] = self.confidence
        if self.run_mode is not None:
            payload["runMode"] = {
                "mode": self.run_mode.mode,
                "confidence": self.run_mode.confidence,
                "periodMs": self.run_mode.period_ms,
                "evidence": self.run_mode.evidence,
            }
        return payload


@dataclass(frozen=True)
class TaskControl:
    """Derived: one call that changes whether a task gets scheduled at all.

    A suspended task is skipped by the scheduler loop entirely, so a consumer that assumes
    every registered task runs every round is wrong for it.  ``target`` is filled when the
    argument is a plain function name; ``kind`` is the profile's (suspend / resume / exit /
    restart) and ``self_target`` marks the argument-less form (the caller's own task).
    """

    function: str
    location: SourceLocation
    callee: str
    kind: str
    rule: str
    argument: str
    target: str | None = None
    target_unit: str | None = None
    self_target: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "function": self.function,
            "location": self.location.to_dict(),
            "callee": self.callee,
            "kind": self.kind,
            "rule": self.rule,
            "argument": self.argument,
            "target": self.target,
            "targetUnit": self.target_unit,
            "selfTarget": self.self_target,
        }


# 每条依赖都重复这句话曾让一个 1500 函数的工程多出 30 MB；它对整份报告只需要一份。
DATA_DEPENDENCY_BASIS = (
    "polling order = depth-first walk from main, calls and registrations in call-line order; "
    "same-round when the writer is polled before the reader"
)


@dataclass(frozen=True)
class DataDependencyResource:
    """One shared variable inside a unit-pair dependency: how much each side touches it."""

    resource: str
    name: str
    variable: str | None
    writes: int
    reads: int
    volatile: bool
    atomicity: str
    derived: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "resource": self.resource,
            "name": self.name,
            "variable": self.variable,
            "writes": self.writes,
            "reads": self.reads,
            "volatile": self.volatile,
            "atomicity": self.atomicity,
            "derived": self.derived,
        }


@dataclass(frozen=True)
class DataDependency:
    """Derived: a unit that writes a shared variable is upstream of a unit that reads it.

    ``order`` is how the exchange lands, from the scheduler's polling order: ``same-round``
    (writer polled before reader), ``next-round`` (after: one round of latency), ``async``
    (an ISR on either side), ``preemptive`` (preemptive kernel: no round), ``main`` (the
    main context on either side), ``unknown-order`` (a task whose registration the walk
    from main did not reach, or unknown scheduling).  Positions are indexes into
    ``pollingOrder``; ``derived`` says an access on either side came from pointer-parameter
    attribution.
    """

    from_unit: str
    to_unit: str
    from_kind: str
    to_kind: str
    order: str
    from_position: int | None
    to_position: int | None
    resources: tuple[DataDependencyResource, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "from": self.from_unit,
            "to": self.to_unit,
            "fromKind": self.from_kind,
            "toKind": self.to_kind,
            "order": self.order,
            "fromPosition": self.from_position,
            "toPosition": self.to_position,
            "resourceCount": len(self.resources),
            "resources": [item.to_dict() for item in self.resources[:MAX_RESOURCES_PER_DEPENDENCY]],
            **(
                {"resourcesOmitted": len(self.resources) - MAX_RESOURCES_PER_DEPENDENCY}
                if len(self.resources) > MAX_RESOURCES_PER_DEPENDENCY
                else {}
            ),
        }


@dataclass(frozen=True)
class MacroUse:
    """Derived: a translation unit uses a macro, and which file defines it.

    ``resolution``: ``project`` (one ``#define`` in the scan, or clangd picked one of several),
    ``ambiguous`` (several ``#define`` sites, clangd gave no answer), ``external`` (no
    ``#define`` in the scan: SDK / libc / compiler builtin).  ``definitions`` is how many
    ``#define`` sites the scan has for the name.
    """

    file: str
    macro: str
    count: int
    location: SourceLocation
    defined_in: SourceLocation | None
    resolution: str
    definitions: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "file": self.file,
            "macro": self.macro,
            "count": self.count,
            "location": self.location.to_dict(),
            "definedIn": self.defined_in.to_dict() if self.defined_in is not None else None,
            "resolution": self.resolution,
            "definitions": self.definitions,
        }


@dataclass(frozen=True)
class TypeUse:
    """Derived: a function depends on a named type, and where that type is defined.

    ``role`` is param / return / local / global / member / cast (see ``ast_facts.RawTypeUse``).
    ``resolution`` says how ``defined_in`` was found: ``project`` (a file in the scan),
    ``external`` (outside the project: SDK / libc), ``unresolved`` (clangd gave no
    definition).  ``count`` is how many times this (type, role) pair occurs in the function.
    """

    function: str
    type_name: str
    role: str
    pointer: bool
    as_written: str
    count: int
    location: SourceLocation
    defined_in: SourceLocation | None
    resolution: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "function": self.function,
            "type": self.type_name,
            "role": self.role,
            "pointer": self.pointer,
            "asWritten": self.as_written,
            "count": self.count,
            "location": self.location.to_dict(),
            "definedIn": self.defined_in.to_dict() if self.defined_in is not None else None,
            "resolution": self.resolution,
        }


@dataclass(frozen=True)
class Reachability:
    by_unit: dict[str, tuple[str, ...]]
    domains: dict[str, tuple[str, ...]]
    unreached: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "byUnit": {unit: list(members) for unit, members in self.by_unit.items()},
            "domains": {symbol: list(kinds) for symbol, kinds in self.domains.items()},
            "unreached": list(self.unreached),
        }


@dataclass(frozen=True)
class ContractBypass:
    caller: str
    callee: str
    location: SourceLocation
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "caller": self.caller,
            "callee": self.callee,
            "location": self.location.to_dict(),
            "reason": self.reason,
        }


@dataclass(frozen=True)
class TypeOnlyInclude:
    source: str
    target: str
    calls_between_files: int
    variable_references: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "target": self.target,
            "callsBetweenFiles": self.calls_between_files,
            "variableReferences": self.variable_references,
        }


@dataclass(frozen=True)
class ArchitectureModule:
    module_id: str
    name: str
    paths: tuple[str, ...]
    public_paths: tuple[str, ...]
    may_depend_on: tuple[str, ...]
    owns_state: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class FileMetric:
    path: str
    architecture_node: str
    total_lines: int
    code_lines: int
    fan_in: int
    fan_out: int
    global_variables: int
    cross_file_globals: int
    in_dependency_cycle: bool
    risk_score: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ArchitectureMetrics:
    translation_units: int
    source_files: int
    analyzed_files: int
    include_directories: int
    include_edges: int
    dependency_cycle_groups: int
    global_variables: int
    cross_file_global_variables: int
    functions: int
    variables: int
    function_calls: int
    variable_references: int
    total_lines: int
    code_lines: int
    high_risk_files: int
    unassigned_files: int
    files_by_extension: dict[str, int]
    files_by_module: dict[str, int]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class AnalysisResult:
    project: Path
    analysis_mode: str
    compile_commands: Path | None
    architecture_config: Path | None
    path_mapping: PathMapping | None
    include_directories: tuple[Path, ...]
    dependency_edges: tuple[DependencyEdge, ...]
    dependency_cycles: tuple[tuple[str, ...], ...]
    coupling_hotspots: tuple[CouplingHotspot, ...]
    global_variables: tuple[GlobalVariable, ...]
    functions: tuple[FunctionSymbol, ...]
    variables: tuple[VariableSymbol, ...]
    semantic_edges: tuple[SemanticEdge, ...]
    architecture_modules: tuple[ArchitectureModule, ...]
    file_metrics: tuple[FileMetric, ...]
    semantic_warnings: tuple[str, ...]
    metrics: ArchitectureMetrics
    # Schema 2 additions (all optional so older call sites keep working).
    coverage: Coverage | None = None
    extern_declarations: tuple[ExternDeclaration, ...] = ()
    entries: tuple[EntryPoint, ...] = ()
    execution_units: tuple[ExecutionUnit, ...] = ()
    reachability: Reachability | None = None
    contract_bypass: tuple[ContractBypass, ...] = ()
    type_only_includes: tuple[TypeOnlyInclude, ...] = ()
    # Schema 3 additions (AST layer).  Facts: loops, state_machines, resource_accesses,
    # critical_sections.  Derived: run_modes, shared_resources, conflict_candidates.
    loops: tuple[LoopFact, ...] = ()
    state_machines: tuple[StateMachine, ...] = ()
    resource_accesses: tuple[ResourceAccess, ...] = ()
    critical_sections: tuple[CriticalSection, ...] = ()
    control_flow: tuple[ControlBlock, ...] = ()
    run_modes: tuple[RunMode, ...] = ()
    shared_resources: tuple[SharedResource, ...] = ()
    conflict_candidates: tuple[ConflictCandidate, ...] = ()
    wake_relations: tuple[WakeRelation, ...] = ()
    ast_facts: AstFactsSummary | None = None
    # Schema 4 additions.  Facts: external_symbols (declared, never defined), inactive
    # regions / functions (from clangd's preprocessor).  Derived: enable_sites (IRQ
    # arguments traced one step) — callbacks found through tables live in execution_units.
    external_symbols: tuple[ExternalSymbol, ...] = ()
    enable_sites: tuple[EnableSiteRecord, ...] = ()
    dead_branches: tuple[Any, ...] = ()
    # 规则声明的调度模型：cooperative | preemptive | unknown（来自 profile 的 scheduling:）
    scheduling: str = "unknown"
    # 调度 tick 的毫秒数，来自 profile / 项目规则的 tick_ms（声明值，默认 1.0）。
    # runModes[].periodMs 里 duration_unit=tick 的换算用的就是它。
    tick_ms: float = 1.0
    # 固件里定义时间的那些数字（SysTick 重载、主频、计时基准变量、超时循环），每条带出处与置信度
    time_base: tuple[Any, ...] = ()
    inactive_regions: tuple[InactiveRegions, ...] = ()
    inactive_functions: tuple[InactiveFunction, ...] = ()
    enums: tuple[EnumFact, ...] = ()
    # 独立证据源：链接产物里的尺寸（每个符号、每个目标文件、镜像总量），带产物哈希与陈旧计数。
    # 和其他事实不同源，所以单独一层，页面上必须标明来源。
    image_facts: Any | None = None
    # 调度状态迁移：谁在哪一行挂起 / 恢复 / 结束了哪个任务（profile 的 task_control 规则）
    task_controls: tuple[TaskControl, ...] = ()
    # 无栈协程的固有缺陷：让出前写、让出后读的非 static 局部，值不保留
    yield_locals: tuple[Any, ...] = ()
    # 类型依赖：函数 -> 具名类型 -> 定义它的文件。include 背后的原因之一，也是矩阵里的一个量
    type_uses: tuple[TypeUse, ...] = ()
    # 宏依赖：编译单元 -> 宏 -> 定义它的文件（clangd 语义 token 里的 macro 类别 + 全工程 #define 行）
    macro_uses: tuple[MacroUse, ...] = ()
    # 数据依赖：写共享变量的单元 -> 读它的单元，带同轮 / 跨轮 / 异步的分类；轮询顺序是分类的依据，一起给
    data_dependencies: tuple[DataDependency, ...] = ()
    polling_order: tuple[str, ...] = ()
    # 目录级依赖顺序：缩点后的最长路径深度、循环组、每条边上 include / 调用 / 绕过 / 仅类型 四个量。
    # 只看图，不含任何分层的名字——名字是人给的，工具只给顺序。
    dependency_order: Any | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": 4,
            "coverage": self.coverage.to_dict() if self.coverage is not None else None,
            "project": str(self.project),
            "analysis_mode": self.analysis_mode,
            "compile_commands": (
                str(self.compile_commands) if self.compile_commands is not None else None
            ),
            "architecture_config": (
                str(self.architecture_config) if self.architecture_config is not None else None
            ),
            "path_mapping": self.path_mapping.to_dict() if self.path_mapping else None,
            "include_directories": [str(path) for path in self.include_directories],
            "dependency_edges": [edge.to_dict() for edge in self.dependency_edges],
            "dependency_cycles": [list(group) for group in self.dependency_cycles],
            "coupling_hotspots": [item.to_dict() for item in self.coupling_hotspots],
            "global_variables": [item.to_dict() for item in self.global_variables],
            "functions": [item.to_dict() for item in self.functions],
            "variables": [item.to_dict() for item in self.variables],
            "semantic_edges": [item.to_dict() for item in self.semantic_edges],
            "architecture_modules": [item.to_dict() for item in self.architecture_modules],
            "file_metrics": [item.to_dict() for item in self.file_metrics],
            "semantic_warnings": list(self.semantic_warnings),
            "metrics": self.metrics.to_dict(),
            "externDeclarations": [item.to_dict() for item in self.extern_declarations],
            "entries": [item.to_dict() for item in self.entries],
            "executionUnits": [item.to_dict() for item in self.execution_units],
            "reachability": (
                self.reachability.to_dict() if self.reachability is not None else None
            ),
            "contractBypass": [item.to_dict() for item in self.contract_bypass],
            "typeOnlyIncludes": [item.to_dict() for item in self.type_only_includes],
            "loops": [item.to_dict() for item in self.loops],
            "stateMachines": [item.to_dict() for item in self.state_machines],
            "resourceAccesses": [item.to_dict() for item in self.resource_accesses],
            "criticalSections": [item.to_dict() for item in self.critical_sections],
            "controlFlow": [item.to_dict() for item in self.control_flow],
            "runModes": [item.to_dict() for item in self.run_modes],
            "sharedResources": [item.to_dict() for item in self.shared_resources],
            "conflictCandidates": [item.to_dict() for item in self.conflict_candidates],
            "wakeRelations": [item.to_dict() for item in self.wake_relations],
            "deadBranches": [item.to_dict() for item in self.dead_branches],
            "scheduling": self.scheduling,
            "tickMs": self.tick_ms,
            "timeBase": [item.to_dict() for item in self.time_base],
            "astFacts": self.ast_facts.to_dict() if self.ast_facts is not None else None,
            "externalSymbols": [item.to_dict() for item in self.external_symbols],
            "enableSites": [item.to_dict() for item in self.enable_sites],
            "inactiveRegions": [item.to_dict() for item in self.inactive_regions],
            "inactiveFunctions": [item.to_dict() for item in self.inactive_functions],
            "enums": [item.to_dict() for item in self.enums],
            "imageFacts": self.image_facts.to_dict() if self.image_facts is not None else None,
            "taskControls": [item.to_dict() for item in self.task_controls],
            "yieldLocals": [item.to_dict() for item in self.yield_locals],
            "typeUses": [item.to_dict() for item in self.type_uses],
            "macroUses": [item.to_dict() for item in self.macro_uses],
            "dataDependencies": [item.to_dict() for item in self.data_dependencies],
            "dataDependenciesBasis": DATA_DEPENDENCY_BASIS,
            "pollingOrder": list(self.polling_order),
            "dependencyOrder": self.dependency_order.to_dict() if self.dependency_order is not None else None,
        }
