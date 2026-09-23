"""Task priority: rule fields, operand resolution, attribute-struct initializers."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from archcheck.ast_facts import RawInitEntry
from archcheck.framework_rules import FrameworkRulesError, parse_framework_rules
from archcheck.indirection import GlobalInitializer
from archcheck.model import CodeSite, ExecutionUnit
from archcheck.runtime_units import attach_task_priorities, resolve_priority_text


def task(name: str, priority: dict | None) -> ExecutionUnit:
    return ExecutionUnit(
        unit_id=f"task:{name}", kind="task", entry_symbol_id=f"function:app/app.c:{name}", confidence="high",
        registered_at=CodeSite(function_id="function:app/app.c:main", path="app/app.c", line=10), priority=priority,
    )


class TaskPriorityTest(unittest.TestCase):
    def test_rule_fields_parse_and_validate(self) -> None:
        rules = parse_framework_rules({"task_create": [
            {"rule": "t.create", "function": "xTaskCreate", "entry_argument": 0, "priority_argument": 4},
            {"rule": "t.new", "function": "osThreadNew", "entry_argument": 0, "attr_argument": 2, "priority_field": "priority"},
        ]})
        by_id = {rule.rule_id: rule for rule in rules.registrations}
        self.assertEqual(4, by_id["t.create"].priority_argument)
        self.assertEqual((2, "priority"), (by_id["t.new"].attr_argument, by_id["t.new"].priority_field))
        with self.assertRaises(FrameworkRulesError):
            parse_framework_rules({"task_create": [{"function": "f", "attr_argument": 2}]})
        with self.assertRaises(FrameworkRulesError):
            parse_framework_rules({"task_create": [{"function": "f", "priority_argument": "4"}]})

    def test_resolve_priority_text(self) -> None:
        constants = {"tskIDLE_PRIORITY": "0", "osPriorityNormal": "24", "configMAX_PRIORITIES": "7"}
        self.assertEqual((3, None, "literal"), resolve_priority_text("3", constants))
        self.assertEqual((2, "tskIDLE_PRIORITY", "expression"), resolve_priority_text("tskIDLE_PRIORITY + 2", constants))
        self.assertEqual((6, "configMAX_PRIORITIES", "expression"), resolve_priority_text("(configMAX_PRIORITIES - 1)", constants))
        self.assertEqual((24, "osPriorityNormal", "enum"), resolve_priority_text("(osPriority_t) osPriorityNormal", constants))
        # 不认识的名字：不猜，只记原文
        self.assertEqual((None, "MY_PRIO", "unresolved"), resolve_priority_text("MY_PRIO", {}))
        self.assertEqual((None, None, "unresolved"), resolve_priority_text("prio_of(x)", {}))

    def test_attach_from_argument_and_from_attr_initializer(self) -> None:
        entry = RawInitEntry(variable="mainTask_attributes", variable_type="osThreadAttr_t", row=None, field_index=None,
                             designator="priority", element_type="osThreadAttr_t", value_kind="enum", value="osPriorityHigh", line=42, column=5)
        inits = {"variable:Core/Src/freertos.c:mainTask_attributes": GlobalInitializer(
            variable_id="variable:Core/Src/freertos.c:mainTask_attributes", name="mainTask_attributes", type_name="osThreadAttr_t",
            path="Core/Src/freertos.c", line=40, entries=(entry,))}
        units = (
            task("console", {"argument": "tskIDLE_PRIORITY + 1", "at": {"path": "app/app.c", "line": 10}}),
            task("lvgl", {"argument": "&mainTask_attributes", "attr": "mainTask_attributes", "field": "priority", "at": {"path": "Core/Src/freertos.c", "line": 130}}),
            task("orphan", {"argument": "&nowhere_attributes", "attr": "nowhere_attributes", "field": "priority", "at": {"path": "x.c", "line": 1}}),
            task("bare", None),
        )
        out = {unit.unit_id: unit for unit in attach_task_priorities(units, inits, {"tskIDLE_PRIORITY": "0", "osPriorityHigh": "40"})}
        self.assertEqual((1, "expression"), (out["task:console"].priority["value"], out["task:console"].priority["basis"]))
        lvgl = out["task:lvgl"].priority
        self.assertEqual((40, "osPriorityHigh", "attr-initializer"), (lvgl["value"], lvgl["symbol"], lvgl["basis"]))
        self.assertEqual({"path": "Core/Src/freertos.c", "line": 42}, lvgl["at"])  # 出处指到初始化器那一行
        self.assertEqual("unresolved", out["task:orphan"].priority["basis"])
        self.assertIn("no file-scope initializer", out["task:orphan"].priority["note"])
        self.assertIsNone(out["task:bare"].priority)
        self.assertEqual(40, out["task:lvgl"].to_dict()["priority"]["value"])


if __name__ == "__main__":
    unittest.main()


class PriorityPlumbingTest(unittest.TestCase):
    def test_unwrap_skips_the_written_type_of_a_cast(self) -> None:
        from archcheck.ast_facts import _unwrap
        cast = {"kind": "CStyleCast", "role": "expression", "children": [
            {"kind": "Elaborated", "role": "type", "children": [{"kind": "Typedef", "role": "type", "detail": "osPriority_t"}]},
            {"kind": "DeclRef", "role": "expression", "detail": "osPriorityNormal"},
        ]}
        self.assertEqual("DeclRef", _unwrap(cast)["kind"])
        self.assertEqual("DeclRef", _unwrap({"kind": "Paren", "role": "expression", "children": [cast]})["kind"])

    def test_macro_literal_values_reads_the_define_line(self) -> None:
        import tempfile
        from pathlib import Path
        from archcheck.macro_facts import macro_literal_values
        from archcheck.model import MacroUse, SourceLocation
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "cfg.h").write_text("#define tskIDLE_PRIORITY ( ( UBaseType_t ) 0U )\n#define FN(x) x\n#define ALIAS tskIDLE_PRIORITY  /* same */\n", encoding="utf-8")
            use = lambda name, line: MacroUse(file="a.c", macro=name, count=1, location=SourceLocation("a.c", 1, 1), defined_in=SourceLocation("cfg.h", line, 1), resolution="project", definitions=1)
            values = macro_literal_values(root, [use("tskIDLE_PRIORITY", 1), use("FN", 2), use("ALIAS", 3), use("EXTERNAL", 9)])
            self.assertEqual({"tskIDLE_PRIORITY": "( ( UBaseType_t ) 0U )", "ALIAS": "tskIDLE_PRIORITY"}, values)
            # 折叠：去 cast、去括号、去 U 后缀，别名再跳一层
            self.assertEqual((3, "ALIAS", "expression"), resolve_priority_text("ALIAS + 3", values))
