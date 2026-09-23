"""Time base: every number in the firmware that defines time, with where it came from.

Static analysis can read the *declarations* of time, never the execution time of code.
What it can read, and this module derives, is:

* the SysTick reload expression and the core clock it divides, so the scheduler tick is a
  code fact instead of a profile assumption (``systick`` / ``core-clock``);
* the variable a timer interrupt increments and that thread code compares against — the
  tick counter every ``sleep`` and timeout is measured in (``tick-counter``);
* loops whose condition compares that counter, i.e. timeout waits, with the bound when it
  folds to a constant (``timeout-loop``).

Every entry carries the expression as written, where it is, how the value was obtained
(``literal`` / ``macro`` / ``initializer`` / ``expression`` / ``runtime``) and a confidence,
because a mutable global's initializer is not the same kind of fact as a ``#define``.

What this module deliberately does not do: turn a hardware timer's prescaler and reload
into a frequency.  That needs the family's clock tree (which bus the timer sits on, the APB
prescaler, the times-two rule), which is a large per-family model that fails silently when
wrong.  The raw prescaler / period values belong here; the hertz do not.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Iterable

from archcheck.literals import parse_c_integer
from archcheck.model import ControlBlock, LoopFact, Reachability, ResourceAccess, SourceLocation

_INT = re.compile(r"^\s*[+-]?(?:0[xX][0-9a-fA-F]+|\d+)[uUlL]*\s*$")
_IDENT = re.compile(r"[A-Za-z_]\w*")
_TERM = re.compile(r"^\s*([^*/+\-]+?)\s*([*/+\-])\s*(.+?)\s*$")


@dataclass(frozen=True)
class TimeConstant:
    """One number that defines time, plus how it was obtained."""

    kind: str  # systick | core-clock | tick-counter | timeout-loop
    name: str
    value: float | None
    unit: str | None  # ms | hz | count | None
    expression: str
    location: SourceLocation | None
    function: str | None
    basis: str  # literal | macro | initializer | expression | runtime | derived
    confidence: str
    note: str | None = None
    evidence: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "name": self.name,
            "value": self.value,
            "unit": self.unit,
            "expression": self.expression,
            "location": self.location.to_dict() if self.location is not None else None,
            "function": self.function,
            "basis": self.basis,
            "confidence": self.confidence,
            "note": self.note,
            "evidence": self.evidence,
        }


def _as_int(text: str) -> int | None:
    return parse_c_integer(text)


def fold(expression: str, values: dict[str, str]) -> tuple[float | None, str]:
    """Fold a constant expression of literals and resolved identifiers.

    Returns (value, basis).  Only ``+ - * /`` over integers are folded; anything else keeps
    the text and reports ``expression``, so a number is never invented.
    """

    text = (expression or "").strip()
    while text.startswith("(") and text.endswith(")"):
        text = text[1:-1].strip()
    if not text:
        return None, "expression"
    direct = _as_int(text)
    if direct is not None:
        return float(direct), "literal"
    if _IDENT.fullmatch(text):
        resolved = (values.get(text) or "").strip().strip("()")
        number = _as_int(resolved)
        if number is not None:
            return float(number), "macro"
        # hover 有时给的是 `120000000 (0x7270e00)` 或 `= 120000000` 这类带饰词的文本，
        # 只在整段里恰好只有一个整数时才接受，避免把类型宽度之类的数字当成值。
        digits = re.findall(r"(?<![\w.])[+-]?(?:0[xX][0-9a-fA-F]+|\d+)(?![\w.])", resolved)
        if len(set(digits)) == 1:
            return float(int(digits[0], 0)), "macro"
        if len(digits) == 2 and digits[1].lower().startswith("0x") and int(digits[0], 0) == int(digits[1], 16):
            return float(int(digits[0], 0)), "macro"
        return None, "runtime"
    match = _TERM.match(text)
    if match is None:
        return None, "expression"
    left, operator, right = match.group(1), match.group(2), match.group(3)
    left_value, left_basis = fold(left, values)
    right_value, right_basis = fold(right, values)
    if left_value is None or right_value is None:
        return None, "expression"
    try:
        if operator == "/":
            result = left_value / right_value if right_value else None
        elif operator == "*":
            result = left_value * right_value
        elif operator == "+":
            result = left_value + right_value
        else:
            result = left_value - right_value
    except ZeroDivisionError:
        return None, "expression"
    if result is None:
        return None, "expression"
    basis = "literal" if {left_basis, right_basis} == {"literal"} else "macro"
    return result, basis


def derive_time_base(
    systick_calls: Iterable[tuple[str, str, SourceLocation, str]],
    accesses: tuple[ResourceAccess, ...],
    loops: tuple[LoopFact, ...],
    control_flow: tuple[ControlBlock, ...],
    reachability: Reachability | None,
    constants: dict[str, str],
    declared_tick_ms: float | None,
) -> tuple[TimeConstant, ...]:
    """Derive the time-base facts.

    ``systick_calls`` are (function id, callee, location, reload expression) tuples found by
    a profile ``systick_config`` rule.  ``constants`` maps an identifier to the text a hover
    resolved it to (macros, enum constants and — flagged as such — globals' initializers).
    """

    out: list[TimeConstant] = []

    # -- core clock ------------------------------------------------------------------
    clock_names = [name for name in ("SystemCoreClock", "SystemCoreClockUpdate") if name in constants]
    clock_hz: float | None = None
    for name in clock_names[:1]:
        value, basis = fold(name, constants)
        clock_hz = value
        out.append(
            TimeConstant(
                kind="core-clock",
                name=name,
                value=value,
                unit="hz",
                expression=f"{name} = {constants.get(name, '')}".strip(),
                location=None,
                function=None,
                # A CMSIS core-clock global is written by SystemInit at reset; its
                # initializer reflects the configured PLL branch but is not a constant.
                basis="initializer",
                confidence="medium",
                note="CMSIS 约定的全局变量，值取自它的初始化式；SystemInit 在复位时可能改写它，所以不是常量",
            )
        )

    # -- SysTick reload --------------------------------------------------------------
    for function_id, callee, location, expression in systick_calls:
        reload_value, basis = fold(expression, constants)
        tick_ms = None
        note = None
        if reload_value is not None and clock_hz:
            tick_ms = (reload_value / clock_hz) * 1000.0
            note = f"tick = 重载值 {reload_value:g} ÷ 主频 {clock_hz:g} Hz"
        elif reload_value is not None:
            note = "重载值已解析，但主频未知，算不出 tick 周期"
        else:
            note = "重载实参不是常量表达式，tick 周期未知"
        out.append(
            TimeConstant(
                kind="systick",
                name=callee,
                value=round(tick_ms, 6) if tick_ms is not None else None,
                unit="ms" if tick_ms is not None else None,
                expression=expression,
                location=location,
                function=function_id,
                basis=basis if tick_ms is None else "expression",
                confidence="medium" if tick_ms is not None else "low",
                note=note,
                evidence={"reload": reload_value, "coreClockHz": clock_hz},
            )
        )
    if not out or all(item.kind != "systick" for item in out):
        if declared_tick_ms is not None:
            out.append(
                TimeConstant(
                    kind="systick", name="tick_ms", value=declared_tick_ms, unit="ms",
                    expression=f"tick_ms: {declared_tick_ms}", location=None, function=None,
                    basis="declared", confidence="low",
                    note="没有匹配到 SysTick 配置 API，这是 profile 声明的假设值",
                )
            )

    # -- tick counter ----------------------------------------------------------------
    isr_functions: set[str] = set()
    thread_functions: set[str] = set()
    if reachability is not None:
        for unit_id, members in reachability.by_unit.items():
            target = isr_functions if unit_id.startswith("isr:") else thread_functions
            target.update(members)
    by_name: dict[str, list[ResourceAccess]] = {}
    by_name_by_function: dict[str, set[str]] = {}
    for access in accesses:
        by_name.setdefault(access.name, []).append(access)
        by_name_by_function.setdefault(access.function, set()).add(access.name)
    counters: dict[str, TimeConstant] = {}
    for name, items in by_name.items():
        writes = [item for item in items if item.kind in {"write", "read_write"}]
        reads = [item for item in items if item.kind in {"read", "read_write"}]
        if not writes or not reads or len(writes) > 3:
            continue
        # 自增式写：`x++` 读改写，via 为空（不是字段 / 下标）
        if any(item.kind != "read_write" or item.via for item in writes):
            continue
        if not all(item.function in isr_functions for item in writes):
            continue
        if not any(item.function in thread_functions and item.function not in isr_functions for item in reads):
            continue
        counters[name] = TimeConstant(
            kind="tick-counter",
            name=name,
            value=float(len(reads)),
            unit="count",
            expression=f"{name}++",
            location=writes[0].location,
            function=writes[0].function,
            basis="derived",
            confidence="medium",
            note="中断上下文里只做自增、线程上下文里被读：这是 sleep 与超时的计时基准",
            evidence={
                "writtenIn": sorted({item.function for item in writes}),
                "readBy": sorted({item.function for item in reads})[:12],
                "readCount": len(reads),
                "volatile": None,
            },
        )
    out.extend(counters.values())

    # -- timeout loops ---------------------------------------------------------------
    if counters:
        # 计时基准通常经一个取值函数读出（`thread_get_systick()`），条件里出现的是函数名而不是变量名。
        # 判据：这个函数体内对共享变量的访问只有「读这个计数器」这一种。
        accessor_of: dict[str, str] = {}
        for name in counters:
            for function_id in {item.function for item in by_name[name] if item.kind == "read"}:
                touched = by_name_by_function.get(function_id, set())
                if touched == {name}:
                    accessor_of[function_id.split(":")[-1]] = name
        condition_of = {(block.function, block.location.line): block.condition or "" for block in control_flow}
        for loop in loops:
            condition = condition_of.get((loop.function, loop.location.line), "")
            if not condition:
                continue
            names = set(_IDENT.findall(condition))
            hit = sorted(names & set(counters))
            via_accessor = sorted({accessor_of[name] for name in names & set(accessor_of)})
            if not hit and not via_accessor:
                continue
            through = None if hit else sorted(names & set(accessor_of))[0]
            hit = hit or via_accessor
            # 比较的右侧若能折成常量，就是超时值（单位是 tick）
            bound = None
            comparison = re.search(r"(?:<=|<|>=|>)\s*([A-Za-z_]\w*|\d+)", condition)
            if comparison is not None:
                bound, _ = fold(comparison.group(1), constants)
            out.append(
                TimeConstant(
                    kind="timeout-loop",
                    name=hit[0],
                    value=bound,
                    unit="count" if bound is not None else None,
                    expression=condition.strip(),
                    location=loop.location,
                    function=loop.function,
                    basis="derived",
                    confidence="medium",
                    note=f"条件里比较了计时基准 {hit[0]}{f'（经 {through}()）' if through else ''}，这是一个超时等待；单位是 tick，乘 tick 周期才是毫秒",
                )
            )
    return tuple(out)
