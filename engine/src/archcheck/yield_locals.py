"""Locals that do not survive a yield (stackless coroutines).

A protothread is one function whose body is a ``switch (pt->lc)``: a yield records
``__LINE__`` and **returns**, and the next invocation jumps back into the middle of the
function.  There is no per-task stack, so an ordinary local is re-created on whatever the
shared stack looks like at that moment: a value written before the yield is simply gone
after it.  That is why implementations declare their own bookkeeping ``static`` (this
project's ``thread_begin`` does exactly that with ``dly``).

So: for a task function in a *cooperative* system, a non-static local that is written
before a yield and read after it, with no write in between, is a defect.  This module
reports those, with all three lines so the claim can be checked in one look.

It is a line-order approximation, not a CFG: the write, the yield and the read are compared
by source line inside the task function.  Locals whose address is taken are skipped (the
write may happen through the pointer).  A read that a later write dominates on every path
is not something line order can see, so a write anywhere between the yield and the read
clears the pair.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from archcheck.model import SourceLocation


@dataclass(frozen=True)
class YieldLocal:
    """One local whose value is read after a yield that discarded it."""

    function: str
    variable: str
    declared_at: SourceLocation
    written_at: SourceLocation
    yielded_at: SourceLocation
    read_at: SourceLocation
    callee: str
    confidence: str = "medium"

    def to_dict(self) -> dict[str, Any]:
        return {
            "function": self.function,
            "variable": self.variable,
            "declaredAt": self.declared_at.to_dict(),
            "writtenAt": self.written_at.to_dict(),
            "yieldedAt": self.yielded_at.to_dict(),
            "readAt": self.read_at.to_dict(),
            "callee": self.callee,
            "confidence": self.confidence,
        }


def derive_yield_locals(
    functions: Iterable[tuple[str, str, Any]],
    task_functions: set[str],
    scheduling: str,
) -> tuple[YieldLocal, ...]:
    """Find locals read after a yield in cooperative task functions.

    ``functions`` yields (function id, source path, per-function AST facts).  Only task
    entry functions are examined: a yield in a callee cannot suspend a stackless coroutine
    (the macros need the task's own ``pt``), so no other function has the hazard.
    """

    if scheduling != "cooperative":
        return ()
    out: list[YieldLocal] = []
    for function_id, path, facts in functions:
        if function_id not in task_functions:
            continue
        yields = sorted(
            {(call.line, call.name) for call, _rule, _kind, _duration in facts.blocking_anywhere}
        )
        if not yields:
            continue
        by_pointer: dict[str, list[Any]] = {}
        for access in facts.local_accesses:
            by_pointer.setdefault(access.decl_pointer, []).append(access)
        for pointer, accesses in by_pointer.items():
            declaration = facts.local_decls.get(pointer)
            if declaration is None:
                continue
            name, declared_line, is_static = declaration
            if is_static:
                continue  # static 局部跨让出保留，实现里正是靠这个存定时器
            if any(access.kind == "address_taken" for access in accesses):
                continue  # 取过地址：写可能经指针发生，行序看不出来
            writes = sorted(a.line for a in accesses if a.kind in {"write", "read_write"})
            reads = sorted(a.line for a in accesses if a.kind in {"read", "read_write"})
            if not writes or not reads:
                continue
            for yield_line, callee in yields:
                before = [line for line in writes if line < yield_line]
                after = [line for line in reads if line > yield_line]
                if not before or not after:
                    continue
                first_read = after[0]
                if any(yield_line < line < first_read for line in writes):
                    continue  # 让出之后又写过，读到的是新值
                out.append(
                    YieldLocal(
                        function=function_id,
                        variable=name,
                        declared_at=SourceLocation(path=path, line=declared_line, column=1),
                        written_at=SourceLocation(path=path, line=before[-1], column=1),
                        yielded_at=SourceLocation(path=path, line=yield_line, column=1),
                        read_at=SourceLocation(path=path, line=first_read, column=1),
                        callee=callee,
                    )
                )
                break  # 一个变量报一次就够，第一处足以说明问题
    return tuple(out)
