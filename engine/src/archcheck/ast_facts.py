"""AST-level facts from clangd ``textDocument/ast`` (design doc §4.3–§4.5, 阶段四–六).

clangd 20 answers ``textDocument/ast`` for a range with a simplified tree: every node
has ``role`` / ``kind`` (``Function``, ``Compound``, ``While``, ``Switch``, ``Case``,
``Call``, ``DeclRef``, ``Member``, ``ArraySubscript``, ``BinaryOperator`` ...), an
optional ``detail`` (operator spelling, referenced name, literal value), an ``arcana``
line (the ``-ast-dump`` text, which carries the declaration kind and pointer of a
``DeclRef`` and the ``->`` / ``.`` of a ``Member``) and — when the node does not come
from a macro expansion — a ``range``.

The semantic tokens of clangd 20 have no ``modification`` modifier, so read / write
classification is done here from the tree shape:

* read           ``ImplicitCast[LValueToRValue]`` whose operand is the variable
* write          left operand of ``BinaryOperator[=]``
* read_write     operand of ``CompoundAssignOperator`` or ``UnaryOperator[++ / --]``
* address_taken  operand of ``UnaryOperator[&]`` or an array decaying to a pointer

A ``Member`` / ``ArraySubscript`` between the variable and the operator keeps the
access on the variable and records ``via`` (``field``, ``index``, ``pointer-field`` ...).

Only the shape of one function body is read.  Nothing here follows control flow
across statements, so every derived statement is an approximation and says so in
the schema (``approximation`` fields, ``AstFactsSummary.approximations``).
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
import re
from typing import Any, Callable, Iterable

from archcheck.literals import is_int_literal, parse_c_integer
from archcheck.framework_rules import CriticalSectionRule, FrameworkRules
from archcheck.model import (
    ControlBlock,
    BlockingCall,
    CriticalSection,
    FunctionSymbol,
    GlobalVariable,
    LoopFact,
    ResourceAccess,
    SourceLocation,
    StateLabel,
    StateMachine,
    StateTransition,
    VariableSymbol,
)


Node = dict[str, Any]

LOOP_KINDS = {"While": "while", "For": "for", "Do": "do"}
_DECL_REF_PATTERN = re.compile(
    r"\b(Var|ParmVar|Function|EnumConstant|Field|ImplicitParam|Binding)\s+0x([0-9a-fA-F]+)"
    r"\s+'([^']*)'\s+'([^']*)'"
)
_DECL_PATTERN = re.compile(r"^(Var|ParmVar)Decl\s+0x([0-9a-fA-F]+)")
_MEMBER_ARROW_PATTERN = re.compile(r"\s(->|\.)(\w+)\s+0x")
_TYPE_AFTER_RANGE_PATTERN = re.compile(r">\s*'([^']*)'")
_LABEL_PATTERN = re.compile(r"'([^']*)'")
_CALL_NAME_PATTERN = re.compile(r"\b([A-Za-z_]\w*)\s*\(")
_LEADING_CALL_PATTERN = re.compile(r"^\s*(?:\(\s*void\s*\)\s*)?([A-Za-z_]\w*)\s*\(")
_CALL_KEYWORDS = {"if", "for", "while", "switch", "sizeof", "return", "do", "else", "case"}
_QUALIFIERS = ("volatile ", "const ", "_Atomic ", "restrict ")


# --------------------------------------------------------------------------------------
# Raw (unresolved) facts of one function body.  Names are kept as text; the resolver
# below maps them to symbol ids once every translation unit has been read.
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class RawArgument:
    """Shape of one call argument (schema 4; drives IRQ-argument and callback tracing).

    ``kind``: enum | literal | param | var | member | element | function | address | other.
    ``name`` is the identifier (enum constant, parameter, root variable, function);
    ``field`` / ``base_type`` describe ``root.field`` / ``root[i].field`` arguments;
    ``root_kind`` is param | local | global for variables.
    """

    kind: str
    text: str
    name: str | None = None
    field: str | None = None
    root_kind: str | None = None
    base_type: str | None = None


@dataclass(frozen=True)
class RawCall:
    name: str
    line: int
    column: int
    via: str = "ast"
    args: tuple[RawArgument, ...] = ()


@dataclass(frozen=True)
class RawSlot:
    """An lvalue that holds (or is read as) a function pointer: ``cfg.cb``, ``tab[i].fn``, ``fns[i]``."""

    path: str
    root_name: str | None
    root_kind: str  # param | local | global | unknown
    root_type: str | None
    field: str | None
    base_type: str | None  # struct type owning ``field`` (normalised), when known


@dataclass(frozen=True)
class RawFunctionStore:
    """``slot = fn`` (value_kind function) or ``slot = param`` (value_kind param)."""

    slot: RawSlot
    value_kind: str
    value: str
    line: int
    column: int


@dataclass(frozen=True)
class RawInitEntry:
    """One function / enum constant inside an aggregate initializer.

    ``row`` is the element index when the variable is an array of aggregates or
    scalars; ``field_index`` is the position inside the (innermost) struct initializer
    unless a ``designator`` (``.name = ...``) names the field directly.
    ``element_type`` is the struct type of that innermost initializer.
    """

    variable: str
    variable_type: str | None
    row: int | None
    field_index: int | None
    designator: str | None
    element_type: str | None
    value_kind: str  # function | enum
    value: str
    line: int
    column: int


@dataclass(frozen=True)
class RawIndirectCall:
    """A call whose callee is not a plain function name: ``tab[i].fn(...)``, ``cb(...)``."""

    slot: RawSlot
    line: int
    column: int


@dataclass(frozen=True)
class RawLocalAggregate:
    """A function-local variable with an aggregate initializer (for struct layout lookups)."""

    name: str
    type_name: str | None
    line: int
    column: int


@dataclass
class RawTypeUse:
    """One named type (struct / union / enum / typedef) a function body depends on.

    ``role`` says how: ``param`` / ``return`` (signature), ``local`` (a local's declared type),
    ``global`` (the type of a file-level variable it touches), ``member`` (the struct whose
    field it reads or writes), ``cast``.  Builtin scalars are not recorded — depending on
    ``int`` is not an architectural fact.  The same (type, role) pair is recorded once per
    function with a count; ``line`` / ``column`` point at the first use.
    """

    type_name: str
    role: str
    line: int
    column: int
    pointer: bool
    as_written: str
    count: int = 1


@dataclass(frozen=True)
class RawAccess:
    name: str
    kind: str
    line: int
    column: int
    via: str | None
    type_name: str
    decl_pointer: str
    index: int


@dataclass(frozen=True)
class RawLoop:
    kind: str
    line: int
    column: int
    end_line: int
    infinite: bool | None
    depth: int
    calls: tuple[RawCall, ...]
    blocking: tuple[tuple[RawCall, str, str, dict | None], ...]  # (call, rule id, rule kind, duration)
    unrecognized: bool = False
    from_macro: bool = False
    # Counted-``for`` shape read from the header: {variable, start, comparison, limit, step,
    # basis}.  None for while / do and for ``for`` headers that are not a simple counter.
    bound: dict | None = None
    # Statements that leave this loop early: {kind: break | return | goto, line}.  A break
    # whose innermost breakable statement is a switch inside the body is not an exit.
    exits: tuple[dict, ...] = ()


@dataclass(frozen=True)
class RawLabel:
    name: str
    is_enum: bool
    line: int | None
    column: int | None
    # Last line of the case body (up to the next case/default label or the switch end).
    end_line: int | None = None
    # ``if (c) break;`` style early exits at the top of the case body: state unchanged when c holds
    guards: tuple[dict, ...] = ()


@dataclass(frozen=True)
class RawTransition:
    from_labels: tuple[str, ...]
    to: str
    to_is_enum: bool
    to_text: str | None
    line: int
    column: int
    condition: str | None
    via: str
    callee: str | None = None
    # Source-ordered steps on the way to the assignment: {"text", "kind": if|else|guard-break|guard-return|guard-continue, "line"}
    steps: tuple[dict, ...] = ()


@dataclass(frozen=True)
class RawStateWrite:
    """An assignment to a file-level variable anywhere in a function body: ``g_state = X``.

    Resolved later against the state machines that dispatch on the same variable, so a
    helper such as ``w_home_abort()`` that writes ``END_STATE`` turns the calls to it into
    real transitions instead of unknown exits.
    """

    dispatch: str
    root_name: str | None
    to: str
    to_is_enum: bool
    to_text: str | None
    condition: str | None
    line: int
    column: int
    steps: tuple[dict, ...] = ()


@dataclass(frozen=True)
class RawSwitch:
    dispatch: str
    root_name: str | None
    root_pointer: str | None
    scope: str
    dispatch_type: str | None
    line: int
    column: int
    labels: tuple[RawLabel, ...]
    has_default: bool
    transitions: tuple[RawTransition, ...]
    from_macro: bool


@dataclass(frozen=True)
class RawBlock:
    """One control-flow statement: the skeleton a sequence view hangs calls and accesses on."""

    kind: str  # if | else | switch | case | default | while | for | do
    line: int
    column: int
    end_line: int
    condition: str | None
    labels: tuple[str, ...] = ()
    depth: int = 0
    parent: int | None = None
    # if / while / switch conditions split into atoms: along && when the branch is taken
    # (``parts``), along || when it is not (``parts_negated``, De Morgan)
    parts: tuple[dict, ...] = ()
    parts_negated: tuple[dict, ...] = ()


@dataclass(frozen=True)
class RawCriticalSection:
    api: str
    end_api: str | None
    rule: CriticalSectionRule
    begin_line: int
    begin_column: int
    end_line: int | None
    end_column: int | None
    access_indices: tuple[int, ...]
    unterminated: bool


@dataclass
class FunctionAstFacts:
    loops: list[RawLoop] = field(default_factory=list)
    switches: list[RawSwitch] = field(default_factory=list)
    accesses: list[RawAccess] = field(default_factory=list)
    critical_sections: list[RawCriticalSection] = field(default_factory=list)
    # Every begin / end API call seen in the body, whether or not it was paired: used to
    # recognise project wrappers (``lock()`` = begin only, ``unlock()`` = end only).
    critical_begin_calls: list[tuple[str, str, int, int]] = field(default_factory=list)  # (rule_id, api, line, col)
    critical_end_calls: list[tuple[str, str, int, int]] = field(default_factory=list)
    nested_critical_begins: int = 0
    calls: list[RawCall] = field(default_factory=list)
    blocks: list[RawBlock] = field(default_factory=list)
    state_writes: list[RawStateWrite] = field(default_factory=list)
    # Blocking-rule matches anywhere in the body (not only inside loops): a helper such as
    # ``wait_ready()`` that sleeps makes its callers' loops periodic / event-driven.
    blocking_anywhere: list[tuple[RawCall, str, str, dict | None]] = field(default_factory=list)
    do_while_zero_skipped: int = 0
    switches_skipped: int = 0
    # Enum constants used as case labels / assignment targets (name -> label position),
    # so the caller can ask clangd (hover) for their numeric values.
    enum_constants: dict[str, tuple[int, int]] = field(default_factory=dict)
    # Identifiers used as delay arguments (``thread_sleep(PERIOD_MS)``): name -> (line, character)
    # for a hover lookup of the macro / constant value by the collector.
    macro_constants: dict[str, tuple[int, int]] = field(default_factory=dict)
    # SysTick configuration calls: (callee, line, column, reload expression as written).
    systick_calls: list[tuple[str, int, int, str]] = field(default_factory=list)
    # Task-control calls: (callee, line, column, task argument as written, rule id, kind).
    task_control_calls: list[tuple[str, int, int, str, str, str]] = field(default_factory=list)
    # 局部变量：声明（decl pointer -> 名字, 行, 是否 static）与读写。栈上的局部跨让出不保留，
    # 这是无栈协程的固有性质，所以要单独收，和文件级变量的 accesses 分开。
    local_decls: dict[str, tuple[str, int, bool]] = field(default_factory=dict)
    local_accesses: list[RawAccess] = field(default_factory=list)
    # Schema 4: indirection facts.
    params: tuple[str, ...] = ()
    function_stores: list[RawFunctionStore] = field(default_factory=list)
    init_entries: list[RawInitEntry] = field(default_factory=list)
    indirect_calls: list[RawIndirectCall] = field(default_factory=list)
    local_aggregates: list[RawLocalAggregate] = field(default_factory=list)
    # 类型依赖：函数用到的具名类型（结构体 / 枚举 / typedef），按 (类型, 用法) 去重计数。
    # 这是 include 关系背后真正的原因之一：谁的数据结构被谁拿着。
    type_uses: list[RawTypeUse] = field(default_factory=list)


# --------------------------------------------------------------------------------------
# Node helpers
# --------------------------------------------------------------------------------------


def _kind(node: Node | None) -> str:
    return str(node.get("kind", "")) if isinstance(node, dict) else ""


def _detail(node: Node | None) -> str | None:
    if not isinstance(node, dict):
        return None
    value = node.get("detail")
    return str(value) if value is not None else None


def _children(node: Node | None) -> list[Node]:
    if not isinstance(node, dict):
        return []
    return [child for child in node.get("children") or [] if isinstance(child, dict)]


def _first_child(node: Node | None) -> Node | None:
    children = _children(node)
    return children[0] if children else None


def _range(node: Node | None) -> tuple[int, int, int, int] | None:
    if not isinstance(node, dict):
        return None
    value = node.get("range")
    if not isinstance(value, dict):
        return None
    start = value.get("start") or {}
    end = value.get("end") or {}
    try:
        return (
            int(start["line"]),
            int(start["character"]),
            int(end["line"]),
            int(end["character"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _arcana(node: Node | None) -> str:
    return str(node.get("arcana", "")) if isinstance(node, dict) else ""


def _decl_reference(node: Node) -> tuple[str, str, str, str] | None:
    """(decl kind, pointer, name, type) of a DeclRef node, from its arcana."""

    match = _DECL_REF_PATTERN.search(_arcana(node))
    if match is None:
        return None
    return match.group(1), match.group(2), match.group(3), match.group(4)


def _member_is_arrow(node: Node) -> bool:
    match = _MEMBER_ARROW_PATTERN.search(_arcana(node))
    return match is not None and match.group(1) == "->"


def _node_type(node: Node) -> str | None:
    match = _TYPE_AFTER_RANGE_PATTERN.search(_arcana(node))
    return match.group(1) if match else None


def _strip_type_qualifiers(type_name: str | None) -> str | None:
    if type_name is None:
        return None
    result = type_name.strip()
    changed = True
    while changed:
        changed = False
        for qualifier in _QUALIFIERS:
            if result.startswith(qualifier):
                result = result[len(qualifier):].strip()
                changed = True
    return result or None


_ARRAY_SUFFIX_PATTERN = re.compile(r"(\s*\[[^\]]*\])+$")
# 内建标量与标准整数别名：对它们的依赖不是架构事实，不记
_BUILTIN_TYPE_PATTERN = re.compile(
    r"^(void|_?[Bb]ool|char|short|int|long|float|double|signed|unsigned|size_t|ssize_t|ptrdiff_t"
    r"|wchar_t|__int128|__uint128_t|u?int(8|16|32|64|max|ptr)_t|u?int_(least|fast)(8|16|32|64)_t"
    r"|[us](8|16|32|64)|[us]int(8|16|32|64)|[us]char|[us]short|[us]long|__builtin_va_list|va_list)"
    r"( (short|int|long|char|signed|unsigned))*$"
)


def normalise_type(type_name: str | None) -> str | None:
    """``const TS_MODE *`` / ``struct foo[3]`` / ``TS_MODE`` -> ``TS_MODE`` / ``foo`` (the record name)."""

    if type_name is None:
        return None
    result = type_name.strip()
    result = _ARRAY_SUFFIX_PATTERN.sub("", result)
    result = result.replace("*", " ").strip()
    result = re.sub(r"\b(const|volatile|restrict|_Atomic|struct|union|enum)\b", " ", result)
    result = re.sub(r"\s+", " ", result).strip()
    return result or None


def _is_array_type(type_name: str | None) -> bool:
    return bool(type_name) and type_name.rstrip().endswith("]")


_DECL_TYPE_PATTERN = re.compile(r"\s'([^']*)'")
# ``<...> col:17 name`` when the name sits on the range's first line, ``<...> line:45:27 name``
# otherwise (clang's -ast-dump location shorthand).
_DECL_NAME_POSITION_PATTERN = re.compile(r">\s*(?:line:(\d+):(\d+)|col:(\d+))\s")


def _declared_type(node: Node) -> str | None:
    """Type printed in the arcana of a Var / ParmVar / Field declaration node."""

    match = _DECL_TYPE_PATTERN.search(_arcana(node))
    return match.group(1) if match else None


def _declared_name_position(node: Node) -> tuple[int, int] | None:
    """1-based (line, column) of the declared name, from ``<...> col:17 name`` in the arcana."""

    match = _DECL_NAME_POSITION_PATTERN.search(_arcana(node))
    span = _range(node)
    if match is None or span is None:
        return None
    if match.group(1):
        return int(match.group(1)), int(match.group(2))
    return span[0] + 1, int(match.group(3))


def _unwrap(node: Node | None, kinds: Iterable[str] = ("Paren", "ImplicitCast", "Constant", "CStyleCast")) -> Node | None:
    kinds = set(kinds)
    while node is not None and _kind(node) in kinds:
        # A CStyleCast's first child is the written type (``(osPriority_t)``), role "type";
        # the operand is the first expression child.  Taking children[0] here silently turned
        # ``(osPriority_t) osPriorityNormal`` into a type node and lost the enum reference.
        child = next((c for c in _children(node) if isinstance(c, dict) and c.get("role") != "type"), None)
        if child is None:
            break
        node = child
    return node


def _split_top_level(text: str) -> list[str]:
    """Split call arguments on top-level commas; stops at the closing parenthesis."""

    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for char in text:
        if char in "([{":
            depth += 1
        elif char in ")]}":
            if depth == 0:
                break
            depth -= 1
        if char == "," and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    parts.append("".join(current))
    return parts


def _iter_nodes(node: Node, ancestors: list[Node]) -> Iterable[tuple[Node, list[Node]]]:
    yield node, ancestors
    ancestors.append(node)
    for child in _children(node):
        yield from _iter_nodes(child, ancestors)
    ancestors.pop()


def _walk(node: Node) -> Iterable[Node]:
    yield node
    for child in _children(node):
        yield from _walk(child)


def _walk_shallow(node: Node) -> Iterable[Node]:
    """Direct children plus the children of type nodes (parameters sit under FunctionProto)."""

    for child in _children(node):
        yield child
        if str(child.get("role", "")) == "type":
            yield from _children(child)


def _initializer_entries(
    variable: str,
    variable_type: str | None,
    init_list: Node,
    designator_of: Callable[[Node], str | None],
    position_of: Callable[[Node, list[Node]], tuple[int, int]],
    ancestors: list[Node],
) -> list[RawInitEntry]:
    """Function / enum references inside an aggregate initializer, with row and field index."""

    entries: list[RawInitEntry] = []
    normalised_variable_type = normalise_type(variable_type)

    def visit(list_node: Node, row: int | None, path: list[Node]) -> None:
        list_type = _node_type(list_node)
        is_array = _is_array_type(list_type)
        element_type = None if is_array else normalise_type(list_type)
        for index, child in enumerate(_children(list_node)):
            designator: str | None = None
            node: Node | None = child
            if _kind(child) == "DesignatedInit":
                designator = designator_of(child)
                node = _first_child(child)
            node = _unwrap(node, ("Paren", "ImplicitCast", "CStyleCast"))
            if node is None:
                continue
            if _kind(node) == "InitList":
                visit(node, index if is_array else row, path + [list_node, child])
                continue
            if _kind(node) == "UnaryOperator" and _detail(node) == "&":
                node = _unwrap(_first_child(node), ("Paren", "ImplicitCast", "CStyleCast"))
            if node is None or _kind(node) != "DeclRef":
                continue
            reference = _decl_reference(node)
            if reference is None or reference[0] not in {"Function", "EnumConstant"}:
                continue
            line, column = position_of(node, path + [list_node, child])
            entries.append(
                RawInitEntry(
                    variable=variable,
                    variable_type=normalised_variable_type,
                    row=index if is_array else row,
                    field_index=None if (is_array or designator is not None) else index,
                    designator=designator,
                    element_type=element_type,
                    value_kind="function" if reference[0] == "Function" else "enum",
                    value=reference[2],
                    line=line,
                    column=column,
                )
            )

    visit(init_list, None, list(ancestors))
    return entries


# --------------------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------------------


class _Extractor:
    def __init__(
        self,
        ast: Node,
        lines: list[str],
        masked_lines: list[str],
        rules: FrameworkRules,
    ) -> None:
        self.ast = ast
        self.lines = lines
        self.masked = masked_lines
        self.rules = rules
        self.facts = FunctionAstFacts()
        self.local_pointers: set[str] = set()
        self.label_lines: dict[str, int] = {}
        self._loop_index: dict[int, int] = {}  # id(loop node) -> index in facts.loops
        self._loop_exits: dict[int, list[dict]] = {}
        self.skipped_loops: set[int] = set()
        self.function_range = _range(ast)
        # (section index, inclusive start, exclusive stop) — accesses are attached in a
        # second pass because a Compound is visited before the statements it contains.
        self._pending_sections: list[tuple[int, tuple[int, int], tuple[int, int]]] = []

    # -- positions -------------------------------------------------------------------

    def _position(self, node: Node, ancestors: list[Node]) -> tuple[int, int]:
        span = _range(node)
        if span is None:
            for ancestor in reversed(ancestors):
                span = _range(ancestor)
                if span is not None:
                    break
        if span is None:
            span = self.function_range or (0, 0, 0, 0)
        return span[0] + 1, span[1] + 1

    def _text(self, span: tuple[int, int, int, int] | None, masked: bool = False) -> str:
        if span is None:
            return ""
        source = self.masked if masked else self.lines
        start_line, start_column, end_line, end_column = span
        if start_line >= len(source):
            return ""
        if start_line == end_line:
            return source[start_line][start_column:end_column]
        parts = [source[start_line][start_column:]]
        parts.extend(source[start_line + 1 : min(end_line, len(source))])
        if end_line < len(source):
            parts.append(source[end_line][:end_column])
        return "\n".join(parts)

    def _collapsed_text(self, node: Node | None) -> str | None:
        text = self._text(_range(node))
        if not text.strip():
            return None
        return re.sub(r"\s+", " ", text).strip()

    def _starts_with_keyword(self, node: Node, keyword: str) -> bool | None:
        span = _range(node)
        if span is None:
            return None
        text = self._text(span, masked=True)
        return re.match(rf"\s*{keyword}\b", text) is not None

    # -- type uses --------------------------------------------------------------------

    def _record_type_use(self, as_written: str | None, role: str, position: tuple[int, int] | None) -> None:
        """Remember that this function depends on the named type ``as_written`` (once per type & role)."""

        if not as_written or position is None:
            return
        name = normalise_type(as_written)
        # 匿名 / 函数指针类型（带括号）没有名字可依赖；内建标量不算
        if not name or "(" in name or _BUILTIN_TYPE_PATTERN.match(name):
            return
        for use in self.facts.type_uses:
            if use.type_name == name and use.role == role:
                use.count += 1
                return
        self.facts.type_uses.append(
            RawTypeUse(name, role, position[0], position[1], "*" in as_written, as_written.strip())
        )

    def _collect_signature_types(self) -> None:
        # 根节点 arcana 末尾的引号里是函数类型，如 'char (thread_t *)'：括号前是返回类型
        quoted = _LABEL_PATTERN.findall(_arcana(self.ast))
        span = _range(self.ast)
        position = _declared_name_position(self.ast) or ((span[0] + 1, span[1] + 1) if span else None)
        if quoted:
            self._record_type_use(quoted[-1].split("(")[0], "return", position)
        for child in _walk_shallow(self.ast):
            if _kind(child) == "ParmVar":
                self._record_type_use(_declared_type(child), "param", _declared_name_position(child) or position)

    # -- pre-walk ---------------------------------------------------------------------

    def _collect_declarations(self) -> None:
        for node in _walk(self.ast):
            arcana = _arcana(node)
            match = _DECL_PATTERN.match(arcana)
            if match is not None:
                self.local_pointers.add(match.group(2))
                span = _range(node)
                name = _detail(node)
                line = (span[0] + 1) if span else 0  # _range 是 0 起始，事实里的行号是 1 起始
                if match.group(1) == "Var":
                    self._record_type_use(_declared_type(node), "local", _declared_name_position(node) or ((line, span[1] + 1) if span else None))
                # 宏展开出来的局部（protothreads 的 PT_YIELD_FLAG 就是）在源码那一行根本看不到
                # 这个名字，行序推理对它不成立，所以不记；只记源码里真写了的局部。
                source = self.lines[line - 1] if 0 < line <= len(self.lines) else ""
                if match.group(1) == "Var" and name and name in source:
                    self.facts.local_decls[match.group(2)] = (name, line, " static" in arcana)
            if _kind(node) == "Label":
                label = _LABEL_PATTERN.search(_arcana(node))
                span = _range(node)
                if label is not None and span is not None:
                    self.label_lines[label.group(1)] = span[0]

    # -- main walk --------------------------------------------------------------------

    def run(self) -> FunctionAstFacts:
        self._collect_declarations()
        self._collect_signature_types()
        self.facts.params = tuple(
            _detail(child) or "" for child in _walk_shallow(self.ast) if _kind(child) == "ParmVar"
        )
        for node, ancestors in _iter_nodes(self.ast, []):
            kind = _kind(node)
            if kind == "DeclRef":
                self._on_decl_ref(node, ancestors)
            elif kind == "Call":
                self._on_call(node, ancestors)
            elif kind in LOOP_KINDS:
                self._on_loop(node, ancestors)
            elif kind == "Switch":
                self._on_switch(node, ancestors)
            elif kind == "Goto":
                self._on_goto(node, ancestors)
                self._on_exit(node, ancestors)
            elif kind in {"Break", "Return"}:
                self._on_exit(node, ancestors)
            elif kind == "Compound":
                self._on_compound(node, ancestors)
            elif kind == "BinaryOperator" and _detail(node) == "=":
                self._on_assignment(node, ancestors)
                self._on_state_write(node, ancestors)
            elif kind == "Var" and node is not self.ast:
                self._on_local_var(node, ancestors)
            elif kind == "Member":
                # 读写了哪个结构体的字段：基对象的类型就是被依赖的结构体
                self._record_type_use(_node_type(_first_child(node)), "member", self._position(node, ancestors))
            elif kind == "CStyleCast":
                self._record_type_use(_node_type(node), "cast", self._position(node, ancestors))
        self._collect_blocks()
        self._collect_blocking_anywhere()
        self._outside_switch_transitions()
        self._mark_protected_accesses()
        for node_id, index in self._loop_index.items():
            exits = self._loop_exits.get(node_id)
            if exits and index < len(self.facts.loops):
                self.facts.loops[index] = replace(self.facts.loops[index], exits=tuple(sorted(exits, key=lambda e: e["line"])))
        return self.facts

    def _on_exit(self, node: Node, ancestors: list[Node]) -> None:
        """Record a break / return / goto that leaves the innermost enclosing loop.

        ``break`` targets the innermost loop *or switch*: inside a switch inside a loop it only
        leaves the switch.  ``return`` always leaves every loop.  ``goto`` leaves the loop when
        its label lies outside the loop's range (labels are collected in a pre-pass).
        """

        kind = _kind(node)
        span = _range(node)
        if span is None:
            return
        line = span[0] + 1
        loop_node: Node | None = None
        for ancestor in reversed(ancestors):
            ancestor_kind = _kind(ancestor)
            if kind == "Break" and ancestor_kind == "Switch":
                return  # leaves the switch, not the loop
            if ancestor_kind in LOOP_KINDS:
                loop_node = ancestor
                break
        if loop_node is None or id(loop_node) in self.skipped_loops:
            return
        if kind == "Goto":
            label = _LABEL_PATTERN.search(_arcana(node))
            loop_span = _range(loop_node)
            target = self.label_lines.get(label.group(1)) if label is not None else None
            if target is None or loop_span is None or loop_span[0] <= target <= loop_span[2]:
                return  # jump within the loop (or unknown target): not an exit
        self._loop_exits.setdefault(id(loop_node), []).append({"kind": kind.lower(), "line": line})

    def _collect_blocking_anywhere(self) -> None:
        seen: set[tuple[str, int]] = set()
        for call in list(self.facts.calls) + self._text_calls_in(self.function_range):
            rule = self.rules.match_blocking(call.name)
            if rule is None or (call.name, call.line) in seen:
                continue
            seen.add((call.name, call.line))
            self.facts.blocking_anywhere.append((call, rule.rule_id, rule.kind, self._duration_of(call, rule)))

    def _duration_of(self, call: RawCall, rule) -> dict | None:
        """Duration argument of a delay call, read from the source line (works for macros too).

        Only a plain integer / float literal yields ``value``; anything else keeps the text
        and leaves ``value`` None so callers never invent a period.
        """

        if rule.kind != "delay" or rule.duration_argument is None or call.line - 1 >= len(self.lines):
            return None
        text = self.lines[call.line - 1]
        match = re.search(re.escape(call.name) + r"\s*\(([^;]*)", text)
        if match is None:
            return None
        arguments = _split_top_level(match.group(1))
        if rule.duration_argument >= len(arguments):
            return None
        argument = arguments[rule.duration_argument].strip()
        literal = re.fullmatch(r"(\d+(?:\.\d+)?)[uUlLfF]*", argument)
        if literal is None and re.fullmatch(r"[A-Za-z_]\w*", argument):
            character = text.find(argument, match.start())
            if character >= 0:
                self.facts.macro_constants.setdefault(argument, (call.line - 1, character))
        return {"argument": argument, "value": float(literal.group(1)) if literal else None, "unit": rule.duration_unit}

    # -- control-flow skeleton ------------------------------------------------------------

    def _header_text(self, node: Node, span: tuple[int, int, int, int]) -> str:
        """First source line of a statement (``for (...)`` / ``do``), trimmed."""

        if span[0] >= len(self.lines):
            return ""
        return self.lines[span[0]][span[1]:].strip()[:120]

    def _collect_blocks(self) -> None:
        """if / else / loops / switch statements with line ranges and nesting.

        Case bodies are appended by ``_on_switch`` (their end is only known from the
        sibling order).  Macro-expanded statements without a range are skipped.
        """

        for node in _walk(self.ast):
            kind = _kind(node)
            if kind not in {"If", "While", "For", "Do", "Switch"}:
                continue
            span = _range(node)
            if span is None or id(node) in self.skipped_loops:  # macro do { } while (0) statements
                continue
            children = _children(node)
            parts: tuple[dict, ...] = ()
            parts_negated: tuple[dict, ...] = ()
            if kind in {"If", "While", "Switch"}:
                condition = self._collapsed_text(children[0]) if children else None
                if kind in {"If", "While"} and children:
                    parts = tuple(self._condition_parts(children[0], True))
                    parts_negated = tuple(self._condition_parts(children[0], False))
            else:
                condition = self._header_text(node, span) or None
            self.facts.blocks.append(RawBlock(kind.lower(), span[0] + 1, span[1] + 1, span[2] + 1, condition, parts=parts, parts_negated=parts_negated))
            if kind == "If" and len(children) >= 3:
                else_span = _range(children[2])
                if else_span is not None:
                    self.facts.blocks.append(RawBlock("else", else_span[0] + 1, else_span[1] + 1, else_span[2] + 1, None))
        blocks = sorted(self.facts.blocks, key=lambda b: (b.line, b.column, -b.end_line))
        # Nesting by line containment: the nearest enclosing block is the parent.
        finished: list[RawBlock] = []
        stack: list[int] = []
        for block in blocks:
            while stack and not (finished[stack[-1]].line <= block.line and block.end_line <= finished[stack[-1]].end_line):
                stack.pop()
            parent = stack[-1] if stack else None
            finished.append(replace(block, depth=len(stack), parent=parent))
            stack.append(len(finished) - 1)
        self.facts.blocks = finished

    # -- indirection: stores, initializer tables, indirect calls --------------------------

    def _slot_of(self, node: Node | None) -> RawSlot | None:
        """Describe an lvalue used to hold or read a function pointer."""

        unwrapped = _unwrap(node, ("Paren", "ImplicitCast", "CStyleCast"))
        path = self._lvalue_path(unwrapped)
        if path is None or path[0] is None:
            return None
        root, text = path
        reference = _decl_reference(root)
        root_name = reference[2] if reference else None
        root_type = normalise_type(reference[3]) if reference else None
        if reference is None:
            root_kind = "unknown"
        elif reference[0] == "ParmVar":
            root_kind = "param"
        elif reference[0] == "Var":
            root_kind = "local" if reference[1] in self.local_pointers else "global"
        else:
            root_kind = "unknown"
        field_name: str | None = None
        base_type: str | None = None
        if unwrapped is not None and _kind(unwrapped) == "Member":
            field_name = _detail(unwrapped)
            base_type = normalise_type(_node_type(_first_child(unwrapped)))
        return RawSlot(
            path=re.sub(r"\[\]", "[]", text),
            root_name=root_name,
            root_kind=root_kind,
            root_type=root_type,
            field=field_name,
            base_type=base_type,
        )

    def _argument(self, node: Node) -> RawArgument:
        text = self._collapsed_text(node) or ""
        unwrapped = _unwrap(node, ("Paren", "ImplicitCast", "CStyleCast"))
        if unwrapped is None:
            return RawArgument("other", text)
        kind = _kind(unwrapped)
        if kind == "DeclRef":
            reference = _decl_reference(unwrapped)
            if reference is None:
                return RawArgument("other", text)
            decl_kind, pointer, name, _ = reference
            if decl_kind == "EnumConstant":
                return RawArgument("enum", text, name)
            if decl_kind == "Function":
                return RawArgument("function", text, name)
            if decl_kind == "ParmVar":
                return RawArgument("param", text, name, root_kind="param")
            if decl_kind == "Var":
                return RawArgument("var", text, name, root_kind="local" if pointer in self.local_pointers else "global")
            return RawArgument("other", text, name)
        if kind in {"IntegerLiteral", "CharacterLiteral"}:
            return RawArgument("literal", text, _detail(unwrapped))
        if kind in {"Member", "ArraySubscript"}:
            slot = self._slot_of(unwrapped)
            if slot is None:
                return RawArgument("other", text)
            return RawArgument(
                "member" if slot.field else "element",
                text,
                slot.root_name,
                field=slot.field,
                root_kind=slot.root_kind,
                base_type=slot.base_type,
            )
        if kind == "UnaryOperator" and _detail(unwrapped) == "&":
            slot = self._slot_of(_first_child(unwrapped))
            if slot is None:
                inner = _unwrap(_first_child(unwrapped))
                reference = _decl_reference(inner) if inner is not None and _kind(inner) == "DeclRef" else None
                if reference is not None and reference[0] == "Function":
                    return RawArgument("function", text, reference[2])
                return RawArgument("other", text)
            return RawArgument("address", text, slot.root_name, field=slot.field, root_kind=slot.root_kind, base_type=slot.base_type)
        return RawArgument("other", text)

    def _on_assignment(self, node: Node, ancestors: list[Node]) -> None:
        children = _children(node)
        if len(children) != 2:
            return
        value = _unwrap(children[1], ("Paren", "ImplicitCast", "CStyleCast"))
        if value is not None and _kind(value) == "UnaryOperator" and _detail(value) == "&":
            value = _unwrap(_first_child(value), ("Paren", "ImplicitCast", "CStyleCast"))
        if value is None or _kind(value) != "DeclRef":
            return
        reference = _decl_reference(value)
        if reference is None or reference[0] not in {"Function", "ParmVar"}:
            return
        slot = self._slot_of(children[0])
        if slot is None:
            return
        line, column = self._position(node, ancestors)
        self.facts.function_stores.append(
            RawFunctionStore(
                slot=slot,
                value_kind="function" if reference[0] == "Function" else "param",
                value=reference[2],
                line=line,
                column=column,
            )
        )

    def _enclosing_conditions(self, node: Node, ancestors: list[Node]) -> str | None:
        """Text of the ``if`` conditions the node sits under (negated for else branches)."""

        parts = self._enclosing_condition_steps(node, ancestors)
        return " && ".join(parts) or None

    @staticmethod
    def _guard_kind(statement: Node) -> str | None:
        """``if (c) break;`` / ``return`` / ``continue`` with no else: the kind of exit, or None."""

        if _kind(statement) != "If":
            return None
        children = _children(statement)
        if len(children) != 2:  # an else branch means it is a real fork, not a guard
            return None
        body = children[1]
        inner = _children(body)
        target = inner[0] if _kind(body) == "Compound" and len(inner) == 1 else body
        kind = _kind(target)
        if kind in {"Break", "Return", "Continue"}:
            return f"guard-{kind.lower()}"
        return None

    def _guards_before(self, node: Node, ancestors: list[Node]) -> list[dict]:
        """Guard statements that precede ``node`` in every enclosing statement sequence."""

        found: list[dict] = []
        chain = [*ancestors, node]
        switch_at = max((index for index, item in enumerate(ancestors) if _kind(item) == "Switch"), default=-1)
        for index, ancestor in enumerate(ancestors):
            if index <= switch_at or _kind(ancestor) != "Compound":
                continue
            child_on_path = chain[index + 1]
            local: list[dict] = []
            for statement in _children(ancestor):
                if statement is child_on_path:
                    break
                candidate = statement
                if _kind(statement) in {"Case", "Default"}:
                    # a new case label: guards of earlier cases do not apply; the label wraps its
                    # first statement, which may itself be the guard
                    local = []
                    _, _, candidate = self._unwrap_labels(statement)
                    if candidate is None:
                        continue
                kind = self._guard_kind(candidate)
                if kind is None:
                    continue
                span = _range(candidate)
                local.append({"text": self._collapsed_text(_children(candidate)[0]) or "<macro>", "kind": kind, "line": span[0] + 1 if span else None, "mustHold": False, "parts": self._condition_parts(_children(candidate)[0], False)})
            found.extend(local)
        return found

    def _condition_parts(self, condition: Node | None, must_hold: bool) -> list[dict]:
        """Atomic conjuncts of a condition as separate rows.

        A condition that must be true splits along top-level ``&&``; one that must be false
        splits along top-level ``||`` (De Morgan: every operand must be false).  Anything else
        stays one part.  Each part carries its own text and line.
        """

        # Conjunctive split ("all of"): && when the branch is taken, || when it is not.  If the top
        # level is the other operator instead, split along it and mark the parts "any of"
        # (De Morgan: !(a && b) == !a || !b), so every atom still gets its own row.
        primary = "&&" if must_hold else "||"
        top = _unwrap(condition, ("Paren",))
        top_operator = _detail(top) if top is not None and _kind(top) == "BinaryOperator" and _detail(top) in {"&&", "||"} else None
        operator = top_operator or primary
        any_of = operator != primary
        parts: list[dict] = []

        def walk(expr: Node | None) -> None:
            expr = _unwrap(expr, ("Paren",))
            if expr is None:
                return
            if _kind(expr) == "BinaryOperator" and _detail(expr) == operator and len(_children(expr)) == 2:
                walk(_children(expr)[0])
                walk(_children(expr)[1])
                return
            span = _range(expr)
            parts.append({"text": self._collapsed_text(expr) or "<macro>", "line": span[0] + 1 if span else None})

        walk(condition)
        if not parts:
            return [{"text": self._collapsed_text(condition) or "<macro>", "line": None}]
        if any_of and len(parts) > 1:
            for part in parts:
                part["anyOf"] = True
        return parts

    def _condition_steps(self, node: Node, ancestors: list[Node]) -> tuple[dict, ...]:
        """Enclosing if / else steps plus earlier guards, in source order."""

        steps: list[dict] = []
        chain = [*ancestors, node]
        # Inside a switch only the steps within the case matter (an if around the whole switch
        # is common to every transition); helper writes without a switch use the whole chain.
        switch_at = max((index for index, item in enumerate(ancestors) if _kind(item) == "Switch"), default=-1)
        for index, ancestor in enumerate(ancestors):
            if index <= switch_at or _kind(ancestor) != "If":
                continue
            children = _children(ancestor)
            if len(children) < 2:
                continue
            inner = chain[index + 1]
            span = _range(ancestor)
            text = self._collapsed_text(children[0]) or "<macro>"
            if inner is children[1]:
                steps.append({"text": text, "kind": "if", "line": span[0] + 1 if span else None, "mustHold": True, "parts": self._condition_parts(children[0], True)})
            elif len(children) >= 3 and inner is children[2]:
                steps.append({"text": text, "kind": "else", "line": span[0] + 1 if span else None, "mustHold": False, "parts": self._condition_parts(children[0], False)})
        steps.extend(self._guards_before(node, ancestors))
        steps.sort(key=lambda item: (item["line"] is None, item["line"] or 0))
        return tuple(steps)

    def _enclosing_condition_steps(self, node: Node, ancestors: list[Node]) -> list[str]:
        parts: list[str] = []
        chain = [*ancestors, node]
        for index, ancestor in enumerate(ancestors):
            if _kind(ancestor) != "If":
                continue
            children = _children(ancestor)
            if len(children) < 2:
                continue
            inner = chain[index + 1]
            text = self._collapsed_text(children[0]) or "<macro>"
            if inner is children[1]:
                parts.append(text)
            elif len(children) >= 3 and inner is children[2]:
                parts.append(f"!({text})")
        return parts

    def _on_state_write(self, node: Node, ancestors: list[Node]) -> None:
        """Record ``<global or file-level variable> = <value>`` with its enclosing conditions."""

        children = _children(node)
        if len(children) != 2:
            return
        path = self._lvalue_path(children[0])
        if path is None or path[0] is None:
            return
        root, dispatch = path
        reference = _decl_reference(root)
        if reference is None or reference[0] != "Var" or reference[1] in self.local_pointers:
            return
        to, to_is_enum, to_text = self._assignment_target(children[1])
        line, column = self._position(node, ancestors)
        self.facts.state_writes.append(
            RawStateWrite(
                dispatch=dispatch,
                root_name=reference[2],
                to=to,
                to_is_enum=to_is_enum,
                to_text=to_text,
                condition=self._enclosing_conditions(node, ancestors),
                line=line,
                column=column,
                steps=self._condition_steps(node, ancestors),
            )
        )

    def _on_local_var(self, node: Node, ancestors: list[Node]) -> None:
        init_list = next((child for child in _children(node) if _kind(child) == "InitList"), None)
        if init_list is None:
            return
        name = _detail(node) or "?"
        type_name = _declared_type(node)
        entries = _initializer_entries(name, type_name, init_list, self._designator, self._position, ancestors + [node])
        if not entries:
            return
        self.facts.init_entries.extend(entries)
        if any(entry.field_index is not None for entry in entries):
            line, column = _declared_name_position(node) or self._position(node, ancestors)
            for type_name_of_list in {entry.element_type or entry.variable_type for entry in entries if entry.field_index is not None}:
                self.facts.local_aggregates.append(RawLocalAggregate(name, type_name_of_list, line, column))

    def _designator(self, node: Node) -> str | None:
        text = self._text(_range(node), masked=True)
        match = re.match(r"\s*\.\s*([A-Za-z_]\w*)", text)
        return match.group(1) if match else None

    # -- variable accesses -------------------------------------------------------------

    def _on_decl_ref(self, node: Node, ancestors: list[Node]) -> None:
        reference = _decl_reference(node)
        if reference is None:
            return
        decl_kind, pointer, name, type_name = reference
        # 形参也记进 local_accesses：经形参指针的读写是"一步指针形参归属"的依据
        if decl_kind not in {"Var", "ParmVar"}:
            return
        line, column = self._position(node, ancestors)
        if pointer not in self.local_pointers:
            self._record_type_use(type_name, "global", (line, column))
        if pointer in self.local_pointers or decl_kind == "ParmVar":
            for kind, via in self._access_records(node, ancestors):
                self.facts.local_accesses.append(
                    RawAccess(
                        name=name, kind=kind, line=line, column=column, via=via,
                        type_name=type_name, decl_pointer=pointer, index=len(self.facts.local_accesses),
                    )
                )
            return
        for kind, via in self._access_records(node, ancestors):
            self.facts.accesses.append(
                RawAccess(
                    name=name,
                    kind=kind,
                    line=line,
                    column=column,
                    via=via,
                    type_name=type_name,
                    decl_pointer=pointer,
                    index=len(self.facts.accesses),
                )
            )

    def _access_records(self, ref: Node, ancestors: list[Node]) -> list[tuple[str, str | None]]:
        records: list[tuple[str, str | None]] = []
        via: list[str] = []
        current: Node = ref
        index = len(ancestors) - 1

        def via_text() -> str | None:
            unique = list(dict.fromkeys(via))
            return "+".join(unique) if unique else None

        while index >= 0:
            parent = ancestors[index]
            parent_kind = _kind(parent)
            parent_detail = _detail(parent)
            is_first = _first_child(parent) is current
            grand = ancestors[index - 1] if index >= 1 else None

            if parent_kind == "Paren":
                current = parent
                index -= 1
                continue
            if parent_kind == "ImplicitCast":
                if parent_detail == "ArrayToPointerDecay":
                    if grand is not None and _kind(grand) == "ArraySubscript" and _first_child(grand) is parent:
                        via.append("index")
                        current = grand
                        index -= 2
                        continue
                    records.append(("address_taken", "+".join(dict.fromkeys(via + ["array-decay"]))))
                    return records
                if parent_detail == "LValueToRValue":
                    if grand is not None and _first_child(grand) is parent:
                        grand_kind = _kind(grand)
                        if grand_kind == "Member" and _member_is_arrow(grand):
                            records.append(("read", via_text()))
                            via.append("pointer-field")
                            current = grand
                            index -= 2
                            continue
                        if grand_kind == "ArraySubscript":
                            records.append(("read", via_text()))
                            via.append("pointer-index")
                            current = grand
                            index -= 2
                            continue
                        if grand_kind == "UnaryOperator" and _detail(grand) == "*":
                            records.append(("read", via_text()))
                            via.append("pointer-deref")
                            current = grand
                            index -= 2
                            continue
                    records.append(("read", via_text()))
                    return records
                current = parent
                index -= 1
                continue
            if parent_kind == "Member" and is_first:
                via.append("pointer-field" if _member_is_arrow(parent) else "field")
                current = parent
                index -= 1
                continue
            if parent_kind == "ArraySubscript" and is_first:
                via.append("pointer-index")
                current = parent
                index -= 1
                continue
            if parent_kind == "BinaryOperator" and parent_detail == "=" and is_first:
                records.append(("write", via_text()))
                return records
            if parent_kind == "CompoundAssignOperator" and is_first:
                records.append(("read_write", via_text()))
                return records
            if parent_kind == "UnaryOperator" and parent_detail in {"++", "--"}:
                records.append(("read_write", via_text()))
                return records
            if parent_kind == "UnaryOperator" and parent_detail == "&":
                records.append(("address_taken", via_text()))
                return records
            if parent_kind == "UnaryExprOrTypeTrait":
                return records
            records.append(("read", via_text()))
            return records
        records.append(("read", via_text()))
        return records

    # -- calls ------------------------------------------------------------------------

    @staticmethod
    def _callee_name(call: Node) -> str | None:
        callee = _unwrap(_first_child(call))
        if callee is None or _kind(callee) != "DeclRef":
            return None
        reference = _decl_reference(callee)
        if reference is None or reference[0] != "Function":
            return None
        return reference[2]

    def _note_systick(self, call: RawCall) -> None:
        """Record a SysTick configuration call and queue its argument's identifiers for hover.

        ``SysTick_Config(SystemCoreClock / 1000U)``: the reload expression only becomes a
        number once ``SystemCoreClock`` is resolved, so it goes through the same pending-hover
        path the delay-argument macros use.
        """

        rule = self.rules.match_systick(call.name)
        if rule is None:
            return
        expression = ""
        if rule.reload_argument is not None and rule.reload_argument < len(call.args):
            expression = call.args[rule.reload_argument].text or ""
        elif call.line - 1 < len(self.lines):
            match = re.search(re.escape(call.name) + r"\s*\(([^;]*)\)", self.lines[call.line - 1])
            expression = (match.group(1) if match else "").strip()
        self.facts.systick_calls.append((call.name, call.line, call.column, expression))
        source_line = self.lines[call.line - 1] if 0 < call.line <= len(self.lines) else ""
        for name in set(re.findall(r"[A-Za-z_]\w*", expression)):
            character = source_line.find(name)
            if character >= 0:
                self.facts.macro_constants.setdefault(name, (call.line - 1, character))

    def _note_task_control(self, call: RawCall) -> None:
        """Record a call that suspends / resumes / ends a task (profile ``task_control``)."""

        rule = self.rules.match_task_control(call.name)
        if rule is None:
            return
        argument = ""
        if rule.task_argument is not None and rule.task_argument < len(call.args):
            argument = (call.args[rule.task_argument].text or "").strip()
        self.facts.task_control_calls.append(
            (call.name, call.line, call.column, argument, rule.rule_id, rule.kind)
        )

    def _on_call(self, node: Node, ancestors: list[Node]) -> None:
        name = self._callee_name(node)
        line, column = self._position(node, ancestors)
        if name is None:
            slot = self._slot_of(_first_child(node))
            if slot is not None:
                self.facts.indirect_calls.append(RawIndirectCall(slot=slot, line=line, column=column))
            return
        args = tuple(self._argument(argument) for argument in _children(node)[1:])
        call = RawCall(name=name, line=line, column=column, args=args)
        self.facts.calls.append(call)
        self._note_systick(call)
        self._note_task_control(call)

    def _calls_in(self, node: Node, ancestors: list[Node]) -> list[RawCall]:
        calls: list[RawCall] = []
        for inner, inner_ancestors in _iter_nodes(node, list(ancestors)):
            if _kind(inner) != "Call":
                continue
            name = self._callee_name(inner)
            if name is None:
                continue
            line, column = self._position(inner, inner_ancestors)
            calls.append(RawCall(name=name, line=line, column=column))
        return calls

    def _text_calls_in(self, span: tuple[int, int, int, int] | None) -> list[RawCall]:
        if span is None:
            return []
        calls: list[RawCall] = []
        start_line, start_column, end_line, end_column = span
        for line_index in range(start_line, min(end_line, len(self.masked) - 1) + 1):
            text = self.masked[line_index]
            lower = start_column if line_index == start_line else 0
            upper = end_column if line_index == end_line else len(text)
            for match in _CALL_NAME_PATTERN.finditer(text, lower, upper):
                name = match.group(1)
                if name in _CALL_KEYWORDS:
                    continue
                calls.append(RawCall(name=name, line=line_index + 1, column=match.start(1) + 1, via="text"))
        return calls

    # -- loops ------------------------------------------------------------------------

    def _loop_depth(self, ancestors: list[Node]) -> int:
        return sum(1 for item in ancestors if _kind(item) in LOOP_KINDS and id(item) not in self.skipped_loops)

    @staticmethod
    def _literal_truth(node: Node | None) -> bool | None:
        node = _unwrap(node)
        if node is None:
            return None
        kind = _kind(node)
        detail = _detail(node) or ""
        if kind == "IntegerLiteral":
            value = parse_c_integer(detail)
            return None if value is None else value != 0
        if kind == "CXXBoolLiteral":
            return detail == "true"
        return None

    def _for_parts(self, node: Node) -> list[str] | None:
        """The three clauses of a ``for`` header, or None when it is not written as one."""

        text = self._text(_range(node), masked=True)
        match = re.match(r"\s*for\s*\(", text)
        if match is None:
            return None
        depth = 0
        parts: list[str] = []
        current: list[str] = []
        for char in text[match.end():]:
            if char in "([{":
                depth += 1
            elif char in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif char == ";" and depth == 0:
                parts.append("".join(current))
                current = []
                continue
            current.append(char)
        parts.append("".join(current))
        return parts if len(parts) >= 3 else None

    def _for_is_infinite(self, node: Node) -> bool | None:
        parts = self._for_parts(node)
        if parts is None:
            children = _children(node)
            return True if len(children) == 1 else None
        return not parts[1].strip()

    def _queue_condition_constants(self, node: Node, line: int) -> None:
        """Queue identifiers that a loop condition compares against, for a hover lookup.

        ``while ((ticks - start) < SCAN_TIMEOUT)``: the bound only becomes a number once the
        macro is resolved, and the same pending-hover path already serves for-loop limits and
        delay arguments.
        """

        text = self._text(_range(node), masked=True)
        if not text:
            return
        source_line = self.lines[line - 1] if 0 < line <= len(self.lines) else ""
        for name in set(re.findall(r"(?:<=|>=|<|>|==|!=)\s*([A-Za-z_]\w*)", text)):
            character = source_line.find(name)
            if character >= 0:
                self.facts.macro_constants.setdefault(name, (line - 1, character))

    def _for_bound(self, node: Node, line: int) -> dict | None:
        """``for (i = START; i < LIMIT; i += STEP)`` -> the counter shape, else None.

        Only the header is read.  Whether the body also moves the counter or the limit is
        not checked, so ``max`` is an upper bound on a normally-written counted loop, not a
        proof.  A ``limit`` that is a bare identifier is queued for a hover lookup so the
        collector can turn ``FILTER_LEN`` into a number.
        """

        parts = self._for_parts(node)
        if parts is None:
            return None
        init, condition, step_text = (part.strip() for part in parts[:3])
        start_match = re.fullmatch(r"(?:[A-Za-z_][\w\s*]*?\s+)?([A-Za-z_]\w*)\s*=\s*(.+)", init)
        condition_match = re.fullmatch(r"([A-Za-z_]\w*)\s*(<=|<|!=)\s*(.+)", condition)
        if start_match is None or condition_match is None:
            return None
        variable = start_match.group(1)
        if condition_match.group(1) != variable:
            return None
        step = None
        if re.fullmatch(re.escape(variable) + r"\+\+", step_text) or re.fullmatch(r"\+\+" + re.escape(variable), step_text):
            step = 1
        else:
            increment = re.fullmatch(re.escape(variable) + r"\s*\+=\s*(\d+)", step_text)
            if increment is not None:
                step = int(increment.group(1))
        if step is None:
            return None
        limit = condition_match.group(3).strip()
        start_text = start_match.group(2).strip()
        start = parse_c_integer(start_text)
        if is_int_literal(limit):
            basis = "literal"
        elif "sizeof" in limit:
            basis = "sizeof"
        elif re.fullmatch(r"[A-Za-z_]\w*", limit):
            basis = "constant"
            source_line = self.lines[line - 1] if 0 < line <= len(self.lines) else ""
            character = source_line.find(limit)
            if character >= 0:
                self.facts.macro_constants.setdefault(limit, (line - 1, character))
        else:
            basis = "expression"
        return {
            "variable": variable,
            "start": start,
            "comparison": condition_match.group(2),
            "limit": limit,
            "step": step,
            "basis": basis,
        }

    def _on_loop(self, node: Node, ancestors: list[Node]) -> None:
        kind = _kind(node)
        children = _children(node)
        infinite: bool | None
        if kind == "While":
            condition = children[0] if children else None
            truth = self._literal_truth(condition)
            infinite = True if truth else (False if truth is False or condition is not None else None)
        elif kind == "Do":
            condition = children[-1] if len(children) >= 2 else None
            truth = self._literal_truth(condition)
            if truth is False:
                # ``do { ... } while (0)`` is the statement-macro idiom, not a loop.
                self.skipped_loops.add(id(node))
                self.facts.do_while_zero_skipped += 1
                return
            infinite = True if truth else (False if condition is not None else None)
        else:
            infinite = self._for_is_infinite(node)
        keyword = LOOP_KINDS[kind]
        starts = self._starts_with_keyword(node, keyword)
        from_macro = starts is False or _range(node) is None
        span = _range(node)
        line, column = self._position(node, ancestors)
        end_line = span[2] + 1 if span is not None else line
        calls = self._calls_in(node, ancestors)
        blocking: list[tuple[RawCall, str, str, dict | None]] = []
        seen: set[tuple[str, int]] = set()
        for call in calls + self._text_calls_in(span):
            rule = self.rules.match_blocking(call.name)
            if rule is None or (call.name, call.line) in seen:
                continue
            seen.add((call.name, call.line))
            blocking.append((call, rule.rule_id, rule.kind, self._duration_of(call, rule)))
        self._queue_condition_constants(node, line)
        self._loop_index[id(node)] = len(self.facts.loops)
        self.facts.loops.append(
            RawLoop(
                kind=keyword,
                line=line,
                column=column,
                end_line=end_line,
                infinite=infinite,
                depth=self._loop_depth(ancestors),
                calls=tuple(calls),
                blocking=tuple(blocking),
                from_macro=from_macro,
                bound=self._for_bound(node, line) if keyword == "for" and infinite is not True else None,
            )
        )

    def _on_goto(self, node: Node, ancestors: list[Node]) -> None:
        label = _LABEL_PATTERN.search(_arcana(node))
        span = _range(node)
        if label is None or span is None:
            return
        target_line = self.label_lines.get(label.group(1))
        if target_line is None or target_line > span[0]:
            return  # forward jump: not a loop shape
        self.facts.loops.append(
            RawLoop(
                kind="goto",
                line=span[0] + 1,
                column=span[1] + 1,
                end_line=span[0] + 1,
                infinite=None,
                depth=self._loop_depth(ancestors),
                calls=(),
                blocking=(),
                unrecognized=True,
            )
        )

    # -- switch / state machine ---------------------------------------------------------

    def _lvalue_path(self, node: Node | None) -> tuple[Node | None, str] | None:
        """(root DeclRef, normalised path text) for ``a``, ``a.b``, ``p->c``, ``a[i].b``."""

        node = _unwrap(node)
        parts: list[str] = []
        while node is not None:
            kind = _kind(node)
            if kind == "DeclRef":
                reference = _decl_reference(node)
                name = reference[2] if reference else (_detail(node) or "?")
                return node, name + "".join(reversed(parts))
            if kind == "Member":
                parts.append(("->" if _member_is_arrow(node) else ".") + (_detail(node) or "?"))
                node = _unwrap(_first_child(node))
                continue
            if kind == "ArraySubscript":
                parts.append("[]")
                node = _unwrap(_first_child(node))
                continue
            return None
        return None

    def _label_of(self, case: Node) -> RawLabel:
        expression = _unwrap(_first_child(case))
        span = _range(expression) if expression is not None else None
        line = span[0] + 1 if span else None
        column = span[1] + 1 if span else None
        if expression is not None:
            kind = _kind(expression)
            if kind == "DeclRef":
                reference = _decl_reference(expression)
                if reference is not None and reference[0] == "EnumConstant":
                    self._remember_enum_constant(reference[2], expression)
                    return RawLabel(reference[2], True, line, column)
                return RawLabel(_detail(expression) or "?", False, line, column)
            if kind in {"IntegerLiteral", "CharacterLiteral"}:
                return RawLabel(_detail(expression) or "?", False, line, column)
        return RawLabel(self._collapsed_text(expression) or "<expr>", False, line, column)

    def _unwrap_labels(self, node: Node) -> tuple[list[RawLabel], bool, Node | None]:
        """Follow ``case A: case B: default: stmt`` chains; return labels, has-default, stmt."""

        labels: list[RawLabel] = []
        has_default = False
        current: Node | None = node
        while current is not None and _kind(current) in {"Case", "Default"}:
            children = _children(current)
            if _kind(current) == "Case":
                labels.append(self._label_of(current))
                current = children[-1] if len(children) >= 2 else None
            else:
                has_default = True
                current = children[-1] if children else None
        return labels, has_default, current

    def _on_switch(self, node: Node, ancestors: list[Node]) -> None:
        children = _children(node)
        if len(children) < 2:
            self.facts.switches_skipped += 1
            return
        condition, body = children[-2], children[-1]
        path = self._lvalue_path(condition)
        if path is None or path[0] is None:
            self.facts.switches_skipped += 1
            return
        root, dispatch = path
        reference = _decl_reference(root)
        root_name = reference[2] if reference else None
        root_pointer = reference[1] if reference else None
        if reference is None:
            scope = "unknown"
        elif reference[0] == "ParmVar":
            scope = "param"
        elif reference[0] == "Var":
            scope = "local" if reference[1] in self.local_pointers else "global"
        else:
            scope = "unknown"
        dispatch_type = _node_type(_unwrap(condition, ("Paren", "ImplicitCast")))
        starts = self._starts_with_keyword(node, "switch")
        from_macro = starts is False or _range(node) is None

        labels: list[RawLabel] = []
        has_default = False
        transitions: list[RawTransition] = []
        statements = _children(body) if _kind(body) == "Compound" else [body]
        current_labels: tuple[str, ...] = ()
        switch_span = _range(node)
        switch_end = switch_span[2] + 1 if switch_span is not None else None
        label_starts = [
            (_range(statement)[0] + 1 if _range(statement) is not None else None)
            for statement in statements
        ]
        for index, statement in enumerate(statements):
            if _kind(statement) in {"Case", "Default"}:
                found, default_here, inner = self._unwrap_labels(statement)
                # The case body runs to the line before the next label (or the switch end).
                next_start = next(
                    (
                        start
                        for start, later in zip(label_starts[index + 1 :], statements[index + 1 :])
                        if start is not None and _kind(later) in {"Case", "Default"}
                    ),
                    None,
                )
                body_end = (next_start - 1) if next_start is not None else switch_end
                # guards = `if (c) break;` at the top level of this case: the label's own statement
                # (a brace block's direct children when it is a compound) plus the sibling
                # statements up to the next label
                guards: list[dict] = []
                body_statements: list[Node] = []
                if inner is not None:
                    body_statements.extend(_children(inner) if _kind(inner) == "Compound" else [inner])
                for later in statements[index + 1 :]:
                    if _kind(later) in {"Case", "Default"}:
                        break
                    body_statements.append(later)
                for guard_statement in body_statements:  # do not shadow ``statement`` (used below)
                    kind = self._guard_kind(guard_statement)
                    if kind is None:
                        continue
                    span = _range(guard_statement)
                    guards.append({"text": self._collapsed_text(_children(guard_statement)[0]) or "<macro>", "kind": kind, "line": span[0] + 1 if span else None, "mustHold": False, "parts": self._condition_parts(_children(guard_statement)[0], False)})
                found = [replace(label, end_line=body_end, guards=tuple(guards)) for label in found]
                own_span = _range(statement)
                if own_span is not None and body_end is not None:
                    self.facts.blocks.append(
                        RawBlock(
                            "case" if found else "default",
                            own_span[0] + 1,
                            own_span[1] + 1,
                            body_end,
                            None,
                            tuple(label.name for label in found) or ("default",),
                        )
                    )
                labels.extend(found)
                has_default = has_default or default_here
                current_labels = tuple(label.name for label in found) or (("default",) if default_here else ())
                if inner is not None:
                    self._scan_region(inner, current_labels, [], dispatch, root_pointer, transitions, ancestors + [node, body, statement])
            else:
                self._scan_region(statement, current_labels, [], dispatch, root_pointer, transitions, ancestors + [node, body])
        if from_macro and not any(label.is_enum for label in labels):
            # ``PT_BEGIN`` / ``LC_RESUME`` continuation switches and similar macro machinery.
            self.facts.switches_skipped += 1
            return
        line, column = self._position(node, ancestors)
        self.facts.switches.append(
            RawSwitch(
                dispatch=dispatch,
                root_name=root_name,
                root_pointer=root_pointer,
                scope=scope,
                dispatch_type=dispatch_type,
                line=line,
                column=column,
                labels=tuple(labels),
                has_default=has_default,
                transitions=tuple(transitions),
                from_macro=from_macro,
            )
        )

    def _scan_region(
        self,
        node: Node,
        from_labels: tuple[str, ...],
        conditions: list[str],
        dispatch: str,
        root_pointer: str | None,
        transitions: list[RawTransition],
        ancestors: list[Node],
        exclude: Node | None = None,
        via: str = "assignment",
        with_calls: bool = True,
    ) -> None:
        if node is exclude:
            return
        kind = _kind(node)
        children = _children(node)
        if kind == "BinaryOperator" and _detail(node) == "=" and len(children) == 2:
            target = self._lvalue_path(children[0])
            if target is not None and target[1] == dispatch and self._same_root(target[0], root_pointer):
                to, to_is_enum, to_text = self._assignment_target(children[1])
                line, column = self._position(node, ancestors)
                transitions.append(
                    RawTransition(from_labels, to, to_is_enum, to_text, line, column, " && ".join(conditions) or None, via, steps=self._condition_steps(node, ancestors))
                )
                return
        if kind == "If" and len(children) >= 2:
            condition_text = self._collapsed_text(children[0]) or "<macro>"
            self._scan_region(children[1], from_labels, conditions + [condition_text], dispatch, root_pointer, transitions, ancestors + [node], exclude, via, with_calls)
            if len(children) >= 3:
                self._scan_region(children[2], from_labels, conditions + [f"!({condition_text})"], dispatch, root_pointer, transitions, ancestors + [node], exclude, via, with_calls)
            return
        if kind in {"Case", "Default"}:
            found, default_here, inner = self._unwrap_labels(node)
            labels = tuple(label.name for label in found) or (("default",) if default_here else from_labels)
            if inner is not None:
                self._scan_region(inner, labels, conditions, dispatch, root_pointer, transitions, ancestors + [node], exclude, via, with_calls)
            return
        if kind == "Call" and with_calls:
            callee = self._callee_name(node)
            if callee is not None:
                for argument in children[1:]:
                    unwrapped = _unwrap(argument)
                    reference = _decl_reference(unwrapped) if unwrapped is not None and _kind(unwrapped) == "DeclRef" else None
                    if reference is not None and reference[0] == "EnumConstant":
                        assert unwrapped is not None
                        self._remember_enum_constant(reference[2], unwrapped)
                        line, column = self._position(node, ancestors)
                        transitions.append(
                            RawTransition(
                                from_labels,
                                reference[2],
                                True,
                                None,
                                line,
                                column,
                                " && ".join(conditions) or None,
                                f"call:{callee}",
                                callee,
                                steps=self._condition_steps(node, ancestors),
                            )
                        )
        for child in children:
            self._scan_region(child, from_labels, conditions, dispatch, root_pointer, transitions, ancestors + [node], exclude, via, with_calls)

    @staticmethod
    def _same_root(root: Node | None, pointer: str | None) -> bool:
        if root is None or pointer is None:
            return root is None and pointer is None
        reference = _decl_reference(root)
        return reference is not None and reference[1] == pointer

    def _remember_enum_constant(self, name: str, node: Node) -> None:
        span = _range(node)
        if span is not None and name not in self.facts.enum_constants:
            self.facts.enum_constants[name] = (span[0], span[1])

    def _assignment_target(self, node: Node) -> tuple[str, bool, str | None]:
        unwrapped = _unwrap(node)
        if unwrapped is not None:
            kind = _kind(unwrapped)
            if kind == "DeclRef":
                reference = _decl_reference(unwrapped)
                if reference is not None and reference[0] == "EnumConstant":
                    self._remember_enum_constant(reference[2], unwrapped)
                    return reference[2], True, None
                return _detail(unwrapped) or "<expr>", False, self._collapsed_text(node)
            if kind in {"IntegerLiteral", "CharacterLiteral"}:
                return _detail(unwrapped) or "<expr>", False, None
        return "<expr>", False, self._collapsed_text(node)

    def _outside_switch_transitions(self) -> None:
        if not self.facts.switches:
            return
        body = next((child for child in _children(self.ast) if _kind(child) == "Compound"), None)
        if body is None:
            return
        switch_nodes = [node for node in _walk(self.ast) if _kind(node) == "Switch"]
        for index, switch in enumerate(self.facts.switches):
            matching = [
                node for node in switch_nodes
                if self._position(node, []) == (switch.line, switch.column)
            ]
            transitions: list[RawTransition] = []
            self._scan_region(
                body, (), [], switch.dispatch, switch.root_pointer, transitions, [self.ast],
                exclude=matching[0] if matching else None, via="outside-switch", with_calls=False,
            )
            inside = {(item.line, item.column) for item in switch.transitions}
            extra = tuple(item for item in transitions if (item.line, item.column) not in inside)
            if extra:
                self.facts.switches[index] = RawSwitch(
                    dispatch=switch.dispatch,
                    root_name=switch.root_name,
                    root_pointer=switch.root_pointer,
                    scope=switch.scope,
                    dispatch_type=switch.dispatch_type,
                    line=switch.line,
                    column=switch.column,
                    labels=switch.labels,
                    has_default=switch.has_default,
                    transitions=switch.transitions + extra,
                    from_macro=switch.from_macro,
                )

    # -- critical sections ---------------------------------------------------------------

    def _statement_call_names(self, statement: Node) -> list[str]:
        names: list[str] = []
        text = self._text(_range(statement), masked=True)
        leading = _LEADING_CALL_PATTERN.match(text)
        if leading is not None:
            names.append(leading.group(1))
        unwrapped = _unwrap(statement, ("Paren", "ImplicitCast", "CStyleCast"))
        if unwrapped is not None and _kind(unwrapped) == "Call":
            name = self._callee_name(unwrapped)
            if name is not None and name not in names:
                names.append(name)
        return names

    def _first_argument(self, statement: Node) -> str:
        text = self._text(_range(statement), masked=True)
        opening = text.find("(")
        if opening < 0:
            return ""
        depth = 0
        argument: list[str] = []
        for char in text[opening + 1:]:
            if char in "([{":
                depth += 1
            elif char in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif char == "," and depth == 0:
                break
            argument.append(char)
        return re.sub(r"\s+", "", "".join(argument))

    def _on_compound(self, node: Node, ancestors: list[Node]) -> None:
        statements = _children(node)
        for index, statement in enumerate(statements):
            names = self._statement_call_names(statement)
            span_here = _range(statement)
            here = (span_here[0] + 1, span_here[1] + 1) if span_here else None
            for name in names:
                for end_rule in self.rules.critical_sections:
                    if end_rule.matches_end(name) and here is not None:
                        self.facts.critical_end_calls.append((end_rule.rule_id, name, here[0], here[1]))
            rule: CriticalSectionRule | None = None
            api = ""
            for name in names:
                rule = self.rules.match_critical_begin(name)
                if rule is not None:
                    api = name
                    break
            if rule is None:
                continue
            if here is not None:
                self.facts.critical_begin_calls.append((rule.rule_id, api, here[0], here[1]))
                # Nested begin inside an already open section of this function: the outer
                # section already covers it; count it instead of opening a second one.
                if any(start <= here < stop for _, start, stop in self._pending_sections):
                    self.facts.nested_critical_begins += 1
                    continue
            begin_argument = self._first_argument(statement) if rule.match_argument else None
            end_statement: Node | None = None
            end_api: str | None = None
            for candidate in statements[index + 1:]:
                candidate_names = self._statement_call_names(candidate)
                matched = next((name for name in candidate_names if rule.matches_end(name)), None)
                if matched is None:
                    continue
                if rule.match_argument and self._first_argument(candidate) != begin_argument:
                    continue
                end_statement, end_api = candidate, matched
                break
            begin_span = _range(statement)
            if begin_span is None:
                continue
            if end_statement is not None and _range(end_statement) is not None:
                end_span = _range(end_statement)
                assert end_span is not None
                stop = (end_span[0] + 1, end_span[1] + 1)
                end_position: tuple[int, int] | None = stop
            else:
                block_span = _range(node) or begin_span
                stop = (block_span[2] + 1, block_span[3] + 1)
                end_position = None
            start = (begin_span[2] + 1, begin_span[3] + 1)
            self.facts.critical_sections.append(
                RawCriticalSection(
                    api=api,
                    end_api=end_api,
                    rule=rule,
                    begin_line=begin_span[0] + 1,
                    begin_column=begin_span[1] + 1,
                    end_line=end_position[0] if end_position else None,
                    end_column=end_position[1] if end_position else None,
                    access_indices=(),
                    unterminated=end_statement is None,
                )
            )
            self._pending_sections.append((len(self.facts.critical_sections) - 1, start, stop))

    def _mark_protected_accesses(self) -> None:
        for section_index, start, stop in self._pending_sections:
            section = self.facts.critical_sections[section_index]
            inside = tuple(
                access.index
                for access in self.facts.accesses
                if start <= (access.line, access.column) < stop
            )
            self.facts.critical_sections[section_index] = RawCriticalSection(
                api=section.api,
                end_api=section.end_api,
                rule=section.rule,
                begin_line=section.begin_line,
                begin_column=section.begin_column,
                end_line=section.end_line,
                end_column=section.end_column,
                access_indices=inside,
                unterminated=section.unterminated,
            )


def extract_function_facts(
    ast: Node,
    lines: list[str],
    masked_lines: list[str],
    rules: FrameworkRules,
) -> FunctionAstFacts:
    """Read loops, switches, variable accesses and critical sections from one function AST."""

    return _Extractor(ast, lines, masked_lines, rules).run()


@dataclass(frozen=True)
class InitializerFacts:
    """Result of reading a file-scope variable's ``textDocument/ast`` (schema 4)."""

    name: str
    type_name: str | None
    entries: tuple[RawInitEntry, ...]


def extract_initializer_facts(ast: Node, lines: list[str], masked_lines: list[str]) -> InitializerFacts | None:
    """Function / enum references in a file-scope aggregate initializer.

    ``ast`` is the ``Var`` node clangd returns for the declaration's range.
    """

    if _kind(ast) != "Var":
        for node in _walk(ast):
            if _kind(node) == "Var":
                ast = node
                break
        else:
            return None
    init_list = next((child for child in _children(ast) if _kind(child) == "InitList"), None)
    name = _detail(ast) or "?"
    type_name = _declared_type(ast)
    if init_list is None:
        return InitializerFacts(name, normalise_type(type_name), ())
    extractor = _Extractor(ast, lines, masked_lines, FrameworkRules())
    entries = _initializer_entries(name, type_name, init_list, extractor._designator, extractor._position, [ast])
    return InitializerFacts(name, normalise_type(type_name), tuple(entries))


# --------------------------------------------------------------------------------------
# Resolution: names -> symbol ids, raw facts -> model objects
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ResolvedAstFacts:
    loops: tuple[LoopFact, ...]
    state_machines: tuple[StateMachine, ...]
    resource_accesses: tuple[ResourceAccess, ...]
    critical_sections: tuple[CriticalSection, ...]
    control_flow: tuple[ControlBlock, ...]
    # function id -> blocking calls anywhere in its body (for run-mode propagation)
    blocking_by_function: dict[str, tuple[BlockingCall, ...]]
    volatile_by_resource: dict[str, bool]
    skipped_dispatch_switches: int
    # resource -> declared type text (qualifiers kept) when the definition was seen
    type_by_resource: dict[str, str | None] = field(default_factory=dict)
    # functions recognised as critical-section wrappers: id -> (rule_id, kind, role begin|end)
    critical_wrappers: dict[str, tuple[str, str, str]] = field(default_factory=dict)


class VariableIndex:
    """Maps a variable name seen in a function body to the file-level symbol it denotes."""

    def __init__(
        self,
        variables: Iterable[VariableSymbol],
        globals_: Iterable[GlobalVariable],
    ) -> None:
        self.file_level: dict[tuple[str, str], tuple[str, str]] = {}
        self.by_name: dict[str, list[tuple[str, str]]] = {}
        for variable in variables:
            if variable.parent_function is not None or variable.scope == "extern":
                continue
            key = (variable.location.path, variable.name)
            self.file_level[key] = (variable.symbol_id, variable.detail)
        for item in globals_:
            symbol_id = f"variable:{item.definition.path}:{item.name}"
            self.file_level.setdefault((item.definition.path, item.name), (symbol_id, item.type_name))
            if item.storage != "static":
                self.by_name.setdefault(item.name, []).append((symbol_id, item.type_name))

    def resolve(self, path: str, name: str) -> tuple[str | None, str | None]:
        found = self.file_level.get((path, name))
        if found is not None:
            return found
        candidates = self.by_name.get(name, [])
        if len(candidates) == 1:
            return candidates[0]
        if candidates:
            return candidates[0]
        return None, None

    def is_volatile(self, path: str, name: str, fallback_type: str) -> bool:
        _, type_name = self.resolve(path, name)
        return "volatile" in (type_name or fallback_type)


def resolve_ast_facts(
    raw_by_function: dict[str, FunctionAstFacts],
    functions: tuple[FunctionSymbol, ...],
    variables: tuple[VariableSymbol, ...],
    globals_: tuple[GlobalVariable, ...],
    resolve_call: Callable[[str, str], FunctionSymbol | None],
    enum_values: dict[str, str] | None = None,
) -> ResolvedAstFacts:
    """Map raw facts to symbol ids.

    ``volatile_by_resource`` is keyed by resource: the variable symbol id, or
    ``extern:<name>`` when the definition is not in the compilation database.
    """

    enum_values = enum_values or {}
    by_id = {function.symbol_id: function for function in functions}
    type_by_resource: dict[str, str | None] = {}

    # Wrapper detection: a function whose body calls a begin API of some rule and never the
    # matching end (its own section is unterminated) is a begin wrapper for that rule; the
    # reverse is an end wrapper.  Callers pairing ``lock(); ...; unlock();`` get a section.
    critical_wrappers: dict[str, tuple[str, str, str]] = {}
    rule_kind_by_id: dict[str, str] = {}
    for function_id, facts in raw_by_function.items():
        for section in facts.critical_sections:
            rule_kind_by_id[section.rule.rule_id] = section.rule.kind
        begin_rules = {rule_id for rule_id, _, _, _ in facts.critical_begin_calls}
        end_rules = {rule_id for rule_id, _, _, _ in facts.critical_end_calls}
        only_begin = begin_rules - end_rules
        only_end = end_rules - begin_rules
        if len(only_begin) == 1 and not only_end:
            rule_id = next(iter(only_begin))
            critical_wrappers[function_id] = (rule_id, rule_kind_by_id.get(rule_id, "irq"), "begin")
        elif len(only_end) == 1 and not only_begin:
            rule_id = next(iter(only_end))
            critical_wrappers[function_id] = (rule_id, rule_kind_by_id.get(rule_id, "irq"), "end")

    def with_constant(duration: dict | None) -> dict | None:
        """Fill ``value`` from a hovered macro / enum constant when the argument was an identifier."""

        if not duration or duration.get("value") is not None:
            return duration
        resolved = enum_values.get(duration.get("argument", ""))
        if resolved is None:
            return duration
        match = re.fullmatch(r"\(?\s*(\d+(?:\.\d+)?)[uUlLfF]*\s*\)?", str(resolved).strip())
        if match is None:
            return {**duration, "resolvedText": str(resolved)}
        return {**duration, "value": float(match.group(1)), "resolvedFrom": str(resolved)}
    index = VariableIndex(variables, globals_)

    def iterations_of(bound: dict | None, path: str) -> dict | None:
        """Fill ``max`` when start, limit and step are all known numbers.

        A limit that names a file-level variable is never treated as a constant, even when
        clangd's hover reports its initializer: the body or another unit can change it.
        """

        if not bound:
            return None
        limit_text = str(bound.get("limit") or "")
        limit: int | None = None
        resolved_from = None
        if is_int_literal(limit_text):
            limit = parse_c_integer(limit_text)
        elif index.resolve(path, limit_text)[0] is not None:
            bound = {**bound, "basis": "variable"}
        else:
            resolved = enum_values.get(limit_text)
            match = re.fullmatch(r"\(?\s*(\d+)[uUlL]*\s*\)?", str(resolved).strip()) if resolved is not None else None
            if match is not None:
                limit = int(match.group(1))
                resolved_from = str(resolved)
        start, step = bound.get("start"), bound.get("step")
        maximum = None
        if limit is not None and start is not None and isinstance(step, int) and step > 0:
            span = limit - start
            if span <= 0:
                maximum = 0
            elif bound["comparison"] == "<=":
                maximum = span // step + 1
            elif bound["comparison"] == "<":
                maximum = -(-span // step)
            elif span % step == 0:
                maximum = span // step
        payload = {**bound, "shape": "counted", "max": maximum}
        if resolved_from is not None:
            payload["resolvedFrom"] = resolved_from
        return payload

    loops: list[LoopFact] = []
    accesses: list[ResourceAccess] = []
    sections: list[CriticalSection] = []
    machines: list[StateMachine] = []
    control_flow: list[ControlBlock] = []
    blocking_by_function: dict[str, tuple[BlockingCall, ...]] = {}
    resolved_accesses: dict[str, list[ResourceAccess]] = {}
    writers_by_variable: dict[str, set[str]] = {}
    # resource -> [(function id, raw write)] for every ``var = value`` in any function
    state_writes_by_resource: dict[str, list[tuple[str, RawStateWrite]]] = {}
    volatile_by_resource: dict[str, bool] = {}
    skipped_dispatch_switches = [0]

    def location(function: FunctionSymbol, line: int, column: int) -> SourceLocation:
        return SourceLocation(path=function.location.path, line=line, column=column)

    for function_id, facts in raw_by_function.items():
        function = by_id.get(function_id)
        if function is None:
            continue
        path = function.location.path
        protected = {
            access_index
            for section in facts.critical_sections
            for access_index in section.access_indices
        }
        # Sections formed by wrapper calls (``lock(); ... unlock();``), paired in source order.
        wrapper_sections: list[tuple[RawCall, RawCall | None, str, str]] = []
        if critical_wrappers and function_id not in critical_wrappers:
            ordered_calls = sorted(facts.calls, key=lambda call: (call.line, call.column))
            open_begin: list[tuple[RawCall, str, str]] = []
            for call in ordered_calls:
                target = resolve_call(call.name, path)
                wrapper = critical_wrappers.get(target.symbol_id) if target is not None else None
                if wrapper is None:
                    continue
                rule_id, kind, role = wrapper
                if role == "begin":
                    if any(open_rule == rule_id for _, open_rule, _ in open_begin):
                        facts.nested_critical_begins += 1
                        continue
                    open_begin.append((call, rule_id, kind))
                else:
                    match_index = next((i for i, (_, open_rule, _) in enumerate(open_begin) if open_rule == rule_id), None)
                    if match_index is None:
                        continue
                    begin_call, _, kind = open_begin.pop(match_index)
                    wrapper_sections.append((begin_call, call, rule_id, kind))
            for begin_call, rule_id, kind in open_begin:
                wrapper_sections.append((begin_call, None, rule_id, kind))
            for begin_call, end_call, _, _ in wrapper_sections:
                start = (begin_call.line, begin_call.column)
                stop = (end_call.line, end_call.column) if end_call is not None else (10**9, 0)
                for raw_index, raw in enumerate(facts.accesses):
                    if start <= (raw.line, raw.column) < stop:
                        protected.add(raw.index if hasattr(raw, "index") else raw_index)
        function_accesses: list[ResourceAccess] = []
        for raw in facts.accesses:
            variable_id, declared_type = index.resolve(path, raw.name)
            resource_key = variable_id or f"extern:{raw.name}"
            if declared_type or raw.type_name:
                type_by_resource.setdefault(resource_key, declared_type or raw.type_name)
            if index.is_volatile(path, raw.name, raw.type_name):
                volatile_by_resource[resource_key] = True
            else:
                volatile_by_resource.setdefault(resource_key, False)
            access = ResourceAccess(
                function=function_id,
                variable=variable_id,
                name=raw.name,
                kind=raw.kind,
                location=location(function, raw.line, raw.column),
                via=raw.via,
                in_critical_section=raw.index in protected,
            )
            function_accesses.append(access)
            if raw.kind in {"write", "read_write"}:
                writers_by_variable.setdefault(variable_id or f"extern:{raw.name}", set()).add(function_id)
        resolved_accesses[function_id] = function_accesses
        accesses.extend(function_accesses)
        for write in facts.state_writes:
            if write.root_name is None:
                continue
            variable_id, _ = index.resolve(path, write.root_name)
            state_writes_by_resource.setdefault(variable_id or f"extern:{write.root_name}", []).append((function_id, write))

        for section in facts.critical_sections:
            if function_id in critical_wrappers:
                continue  # the wrapper's own begin-only / end-only body is not a section
            sections.append(
                CriticalSection(
                    function=function_id,
                    begin=location(function, section.begin_line, section.begin_column),
                    end=(
                        location(function, section.end_line, section.end_column)
                        if section.end_line is not None and section.end_column is not None
                        else None
                    ),
                    api=section.api,
                    end_api=section.end_api,
                    rule=section.rule.rule_id,
                    kind=section.rule.kind,
                    accesses_inside=tuple(function_accesses[i] for i in section.access_indices if i < len(function_accesses)),
                    unterminated=section.unterminated,
                )
            )
        for begin_call, end_call, rule_id, kind in wrapper_sections:
            start = (begin_call.line, begin_call.column)
            stop = (end_call.line, end_call.column) if end_call is not None else (10**9, 0)
            sections.append(
                CriticalSection(
                    function=function_id,
                    begin=location(function, begin_call.line, begin_call.column),
                    end=location(function, end_call.line, end_call.column) if end_call is not None else None,
                    api=begin_call.name,
                    end_api=end_call.name if end_call is not None else None,
                    rule=rule_id,
                    kind=kind,
                    accesses_inside=tuple(
                        access for raw, access in zip(facts.accesses, function_accesses)
                        if start <= (raw.line, raw.column) < stop
                    ),
                    unterminated=end_call is None,
                    via_wrapper=True,
                )
            )

        if facts.blocking_anywhere:
            blocking_by_function[function_id] = tuple(
                BlockingCall(
                    callee=call.name,
                    rule=rule_id,
                    kind=rule_kind,
                    location=location(function, call.line, call.column),
                    via=call.via,
                    duration=with_constant(duration),
                )
                for call, rule_id, rule_kind, duration in facts.blocking_anywhere
            )

        for raw_block in facts.blocks:
            control_flow.append(
                ControlBlock(
                    function=function_id,
                    kind=raw_block.kind,
                    location=location(function, raw_block.line, raw_block.column),
                    end_line=raw_block.end_line,
                    condition=raw_block.condition,
                    labels=raw_block.labels,
                    depth=raw_block.depth,
                    parent=raw_block.parent,
                    parts=raw_block.parts,
                    parts_negated=raw_block.parts_negated,
                )
            )

        for raw_loop in facts.loops:
            calls_in_body: list[str] = []
            for call in raw_loop.calls:
                target = resolve_call(call.name, path)
                if target is not None and target.symbol_id not in calls_in_body:
                    calls_in_body.append(target.symbol_id)
            loops.append(
                LoopFact(
                    function=function_id,
                    kind=raw_loop.kind,
                    location=location(function, raw_loop.line, raw_loop.column),
                    end_line=raw_loop.end_line,
                    infinite=raw_loop.infinite,
                    depth=raw_loop.depth,
                    calls_in_body=tuple(calls_in_body),
                    iterations=iterations_of(raw_loop.bound, path),
                    exits=raw_loop.exits,
                    blocking_calls=tuple(
                        BlockingCall(
                            callee=call.name,
                            rule=rule_id,
                            kind=rule_kind,
                            location=location(function, call.line, call.column),
                            via=call.via,
                            duration=with_constant(duration),
                        )
                        for call, rule_id, rule_kind, duration in raw_loop.blocking
                    ),
                    unrecognized=raw_loop.unrecognized,
                    from_macro=raw_loop.from_macro,
                )
            )

    # State machines need the write sets of other functions (indirect transitions and
    # writersElsewhere), so they are built after every function has been resolved.
    for function_id, facts in raw_by_function.items():
        function = by_id.get(function_id)
        if function is None:
            continue
        path = function.location.path
        for order, raw in enumerate(facts.switches, start=1):
            variable_id: str | None = None
            if raw.scope == "global" and raw.root_name is not None:
                variable_id, _ = index.resolve(path, raw.root_name)
            resource = variable_id or (f"extern:{raw.root_name}" if raw.scope == "global" and raw.root_name else None)
            enum_labels = [label for label in raw.labels if label.is_enum]
            states = tuple(
                StateLabel(
                    name=label.name,
                    value=enum_values.get(label.name) if label.is_enum else label.name,
                    is_enum=label.is_enum,
                    location=(
                        location(function, label.line, label.column)
                        if label.line is not None and label.column is not None
                        else None
                    ),
                    end_line=label.end_line,
                    guards=label.guards,
                )
                for label in raw.labels
            )
            transitions: list[StateTransition] = []
            known_states = {label.name for label in enum_labels} | {
                item.to for item in raw.transitions if item.callee is None and item.to_is_enum
            }
            for raw_transition in raw.transitions:
                if raw_transition.callee is not None:
                    # Keep an enum argument only when the callee is known to write the
                    # dispatch variable (``axis_reset_set_state(NEXT)``) and the constant
                    # is one of this machine's states (C enum constants are plain ints in
                    # the AST, so the label set stands in for the enum type).
                    target = resolve_call(raw_transition.callee, path)
                    if target is None or resource is None or raw_transition.to not in known_states:
                        continue
                    if target.symbol_id not in writers_by_variable.get(resource, set()):
                        continue
                    if not any(
                        access.name == raw.root_name and access.kind in {"write", "read_write"}
                        for access in resolved_accesses.get(target.symbol_id, [])
                    ):
                        continue
                transitions.append(
                    StateTransition(
                        from_states=raw_transition.from_labels,
                        to=raw_transition.to,
                        to_is_enum=raw_transition.to_is_enum,
                        location=location(function, raw_transition.line, raw_transition.column),
                        condition=raw_transition.condition,
                        via=raw_transition.via,
                        to_text=raw_transition.to_text,
                        condition_steps=raw_transition.steps,
                    )
                )
            # Writers outside this function: what they assign, under which conditions.  Calls to
            # them from a case body become transitions to those targets (via call:<helper>).
            external_writes: list[dict] = []
            targets_by_writer: dict[str, list[RawStateWrite]] = {}
            if resource is not None:
                for writer_id, write in state_writes_by_resource.get(resource, []):
                    if writer_id == function_id or write.dispatch != raw.dispatch:
                        continue
                    writer = by_id.get(writer_id)
                    if writer is None:
                        continue
                    targets_by_writer.setdefault(writer_id, []).append(write)
                    external_writes.append({
                        "function": writer_id,
                        "to": write.to,
                        "toIsEnum": write.to_is_enum,
                        "toText": write.to_text,
                        "condition": write.condition,
                        "conditionSteps": list(write.steps),
                        "location": location(writer, write.line, write.column).to_dict(),
                    })
            seen_calls = {(tuple(item.from_states), item.to, item.via, item.location.line) for item in transitions}
            for label in raw.labels:
                if label.line is None or label.end_line is None:
                    continue
                for call in facts.calls:
                    if call.line < label.line or call.line > label.end_line:
                        continue
                    target = resolve_call(call.name, path)
                    if target is None or target.symbol_id not in targets_by_writer:
                        continue
                    for write in targets_by_writer[target.symbol_id]:
                        if not write.to_is_enum:
                            # ``set_state(next)`` writes its parameter: the real target is the
                            # call argument, which the enum-argument rule above already handles.
                            continue
                        key = ((label.name,), write.to, f"call:{call.name}", call.line)
                        if key in seen_calls:
                            continue
                        seen_calls.add(key)
                        transitions.append(
                            StateTransition(
                                from_states=(label.name,),
                                to=write.to,
                                to_is_enum=write.to_is_enum,
                                location=location(function, call.line, call.column),
                                condition=write.condition,
                                via=f"call:{call.name}",
                                to_text=write.to_text,
                                condition_steps=write.steps,
                            )
                        )
            direct = [item for item in transitions if item.via == "assignment"]
            in_switch = [item for item in transitions if item.via != "outside-switch"]
            if raw.scope != "global" and not enum_labels and not in_switch:
                # ``switch (argument) { case 0: ... }`` dispatch tables: nothing state-like.
                skipped_dispatch_switches[0] += 1
                continue
            if raw.from_macro or len(enum_labels) < 2:
                confidence = "low"
            elif direct and raw.scope == "global":
                confidence = "high"
            else:
                confidence = "medium"
            writers = sorted(
                writer
                for writer in writers_by_variable.get(resource or "", set())
                if writer != function_id
            )
            machines.append(
                StateMachine(
                    machine_id=f"state-machine:{function.location.path}:{raw.line}:{raw.dispatch}",
                    function=function_id,
                    location=location(function, raw.line, raw.column),
                    dispatch=raw.dispatch,
                    dispatch_variable=variable_id,
                    dispatch_scope=raw.scope,
                    dispatch_type=raw.dispatch_type,
                    enum_type=_strip_type_qualifiers(raw.dispatch_type) if enum_labels else None,
                    states=states,
                    has_default=raw.has_default,
                    transitions=tuple(transitions),
                    confidence=confidence,
                    writers_elsewhere=tuple(writers),
                    from_macro=raw.from_macro,
                    external_writes=tuple(external_writes),
                )
            )

    # 一步指针形参归属：``foo(&g)``（或数组退化 ``foo(buf)``）且 foo 体内经那个形参指针读 / 写 →
    # 调用方在调用行对 g 的读 / 写。只走一步、不跟别名、不看 foo 再把指针传给谁；每条都带 derived 标注。
    # 取地址那一行 AST 已经记了 address_taken，这里就在同一行、同一名字上配对，不另起名字解析。
    param_effects: dict[str, dict[int, list[RawAccess]]] = {}
    for callee_id, callee_facts in raw_by_function.items():
        params = list(callee_facts.params)
        for raw in callee_facts.local_accesses:
            if raw.name in params and raw.via and raw.via.startswith("pointer-") and raw.kind in {"read", "write", "read_write"}:
                param_effects.setdefault(callee_id, {}).setdefault(params.index(raw.name), []).append(raw)
    derived_accesses: list[ResourceAccess] = []
    for function_id, facts in raw_by_function.items():
        function = by_id.get(function_id)
        if function is None or not param_effects:
            continue
        taken = [item for item in resolved_accesses.get(function_id, []) if item.kind == "address_taken"]
        if not taken:
            continue
        for call in facts.calls:
            target = resolve_call(call.name, function.location.path)
            effects = param_effects.get(target.symbol_id) if target is not None else None
            if not effects:
                continue
            for position, argument in enumerate(call.args):
                if position not in effects or argument.name is None or argument.root_kind != "global":
                    continue
                site = next((item for item in taken if item.name == argument.name and item.location.line == call.line), None)
                if site is None:
                    continue
                for kind in ("read", "write"):
                    matching = [raw for raw in effects[position] if (raw.kind in {"write", "read_write"}) == (kind == "write")]
                    if not matching:
                        continue
                    first = min(matching, key=lambda raw: (raw.line, raw.column))
                    derived_accesses.append(
                        ResourceAccess(
                            function=function_id,
                            variable=site.variable,
                            name=site.name,
                            kind=kind,
                            location=site.location,
                            via="by-callee",
                            in_critical_section=site.in_critical_section,
                            derived={
                                "callee": target.symbol_id,
                                "calleeName": call.name,
                                "param": position,
                                "paramName": list(raw_by_function[target.symbol_id].params)[position],
                                "calleeAccess": location(target, first.line, first.column).to_dict(),
                                "calleeVia": first.via,
                                "basis": "pointer-param-one-step",
                            },
                        )
                    )
    accesses.extend(derived_accesses)

    loops.sort(key=lambda item: (item.location.path, item.location.line, item.location.column))
    # 同一个函数同一处的循环偶尔会被收两遍（完全相同的一条记录出现两次）。稳定 ID 按
    # 「函数 + 函数内第几个循环」构造，重复记录会撞 ID，所以在这里按身份去重。
    seen_loops: set[tuple] = set()
    deduplicated: list[LoopFact] = []
    for item in loops:
        key = (item.function, item.kind, item.location.path, item.location.line, item.location.column, item.end_line, item.depth)
        if key in seen_loops:
            continue
        seen_loops.add(key)
        deduplicated.append(item)
    loops = deduplicated
    accesses.sort(key=lambda item: (item.location.path, item.location.line, item.location.column, item.kind))
    sections.sort(key=lambda item: (item.begin.path, item.begin.line, item.begin.column))
    machines.sort(key=lambda item: (item.location.path, item.location.line))
    control_flow.sort(key=lambda item: (item.location.path, item.location.line, item.location.column))
    return ResolvedAstFacts(
        loops=tuple(loops),
        state_machines=tuple(machines),
        resource_accesses=tuple(accesses),
        critical_sections=tuple(sections),
        control_flow=tuple(control_flow),
        blocking_by_function=blocking_by_function,
        volatile_by_resource=volatile_by_resource,
        skipped_dispatch_switches=skipped_dispatch_switches[0],
        type_by_resource=type_by_resource,
        critical_wrappers=critical_wrappers,
    )
