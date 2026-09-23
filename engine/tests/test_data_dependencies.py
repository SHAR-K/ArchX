"""Data dependencies: polling order from main, same-round / next-round / async classification."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from archcheck.data_dependencies import derive_data_dependencies, polling_order
from archcheck.model import (
    CodeSite,
    EntryPoint,
    ExecutionUnit,
    ResourceAccess,
    SemanticEdge,
    SharedResource,
    SourceLocation,
    UnitAccessSummary,
)


def fn(name: str) -> str:
    return f"function:app/app.c:1:{name}"


def unit(kind: str, name: str, registered: tuple[str, int] | None = None, hosts: tuple[str, ...] = ()) -> ExecutionUnit:
    site = CodeSite(function_id=fn(registered[0]), path="app/app.c", line=registered[1]) if registered else None
    return ExecutionUnit(unit_id=f"{kind}:{name}", kind=kind, entry_symbol_id=fn(name), confidence="high", registered_at=site, hosts=hosts)


def side(unit_id: str, *kinds: str, derived: bool = False) -> UnitAccessSummary:
    accesses = tuple(
        ResourceAccess(function=fn("f"), variable="variable:app/app.c:5:g", name="g", kind=kind, location=SourceLocation("app/app.c", 9, 1), derived={"basis": "x"} if derived else None)
        for kind in kinds
    )
    return UnitAccessSummary(unit_id=unit_id, unit_kind=unit_id.split(":")[0], kinds=tuple(sorted(set(kinds))), unprotected_kinds=(), accesses=accesses)


def call(source: str, target: str, line: int) -> SemanticEdge:
    return SemanticEdge(source=fn(source), target=fn(target), relation="calls", locations=(SourceLocation("app/app.c", line, 1),))


class DataDependencyTest(unittest.TestCase):
    def test_polling_order_follows_call_lines_from_main(self) -> None:
        # main: line 10 calls init (which registers t_b at 30 then t_a at 20 -> a first), line 11 registers t_c
        entries = [EntryPoint(kind="main", symbol_id=fn("main"))]
        units = (unit("task", "t_a", ("init", 20)), unit("task", "t_b", ("init", 30)), unit("task", "t_c", ("main", 11)), unit("isr", "irq"))
        edges = [call("main", "init", 10), call("init", "helper", 25)]
        self.assertEqual(("task:t_a", "task:t_b", "task:t_c"), polling_order(entries, units, edges))
        self.assertEqual((), polling_order([], units, edges))

    def test_classification(self) -> None:
        units = (unit("task", "t_a", ("main", 1)), unit("task", "t_b", ("main", 2)), unit("isr", "irq"), unit("callback", "cb", hosts=("task:t_b",)), unit("task", "t_lost"))
        order = ("task:t_a", "task:t_b")
        shared = (
            SharedResource(resource="v:g", name="g", variable="v:g", volatile=False, units=(side("task:t_a", "write"), side("task:t_b", "read"), side("isr:irq", "read"))),
            SharedResource(resource="v:h", name="h", variable="v:h", volatile=True, units=(side("task:t_b", "write", derived=True), side("task:t_a", "read"), side("callback:cb", "read"), side("task:t_lost", "read_write"))),
        )
        deps = derive_data_dependencies(shared, units, order, "cooperative")
        # 聚合按单元对，明细按变量；展开回去应与逐变量的旧形态等价
        table = {
            (item.name, d.from_unit, d.to_unit): (d.order, d.from_position, d.to_position, item.derived)
            for d in deps
            for item in d.resources
        }
        pairs = [(d.from_unit, d.to_unit) for d in deps]
        self.assertEqual(len(pairs), len(set(pairs)), "一个单元对只应产出一条依赖")
        self.assertEqual(("same-round", 0, 1, False), table[("g", "task:t_a", "task:t_b")])
        self.assertEqual(("async", 0, None, False), table[("g", "task:t_a", "isr:irq")])
        self.assertEqual(("next-round", 1, 0, True), table[("h", "task:t_b", "task:t_a")])
        # 回调跟宿主任务走：cb 的宿主是 t_b，自己写自己读不成边；t_lost 没被 main 走到 -> 顺序未知
        self.assertNotIn(("h", "task:t_b", "callback:cb"), table)
        self.assertEqual(("unknown-order", 1, None, True), table[("h", "task:t_b", "task:t_lost")])
        self.assertEqual(("unknown-order", None, 0, False), table[("h", "task:t_lost", "task:t_a")])  # 两侧都没有推导访问
        # 抢占式内核没有"轮"
        preemptive = {
            (item.name, d.from_unit, d.to_unit): d.order
            for d in derive_data_dependencies(shared[:1], units, order, "preemptive")
            for item in d.resources
        }
        self.assertEqual("preemptive", preemptive[("g", "task:t_a", "task:t_b")])


if __name__ == "__main__":
    unittest.main()
