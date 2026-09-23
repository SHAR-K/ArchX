from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from archcheck.parallel import ShardRouter
from archcheck.semantic import _collect_enums


class _FakeClient:
    """只回答自己「打开过」的那个 uri，其它一律照 clangd 的原话报错。"""

    def __init__(self, known_uri: str, values: dict[int, str]) -> None:
        self.known_uri = known_uri
        self.values = values
        self.asked: list[str] = []

    def enumerator_value(self, uri: str, line: int, character: int) -> str | None:
        self.asked.append(uri)
        if uri != self.known_uri:
            raise RuntimeError({"code": -32602, "message": "trying to get AST for non-added document"})
        return self.values.get(line)


def _symbol_tree(line: int) -> list[dict]:
    members = [
        {"kind": 22, "name": name, "selectionRange": {"start": {"line": line, "character": column}}}
        for name, column in (("A_ZERO", 15), ("A_ONE", 24), ("A_UNUSED", 31))
    ]
    return [
        {
            "kind": 10,
            "name": "alpha_t",
            "selectionRange": {"start": {"line": line, "character": 8}},
            "range": {"start": {"line": line, "character": 0}, "end": {"line": line, "character": 48}},
            "children": members,
        }
    ]


class CollectEnumsTests(unittest.TestCase):
    """一个从没被代码引用过的成员在 AST 阶段拿不到值，只能靠 hover 兜底。"""

    def setUp(self) -> None:
        self.project = Path(__file__).resolve().parents[1]
        self.header = self.project / "src" / "alpha.h"
        # clangd 认得的是 Path.as_uri() 那一个写法；raw_symbols 的键被小写化了
        self.original_uri = self.header.as_uri()
        self.lowered_uri = self.original_uri.lower()
        self.assertNotEqual(self.original_uri, self.lowered_uri, "这条测试要求路径里有大写字母")

    def _collect(self, symbol_uris: dict[str, str]) -> tuple:
        client = _FakeClient(self.original_uri, {2: "2"})
        router = ShardRouter([client], {})
        facts = _collect_enums(
            router,
            {self.lowered_uri: _symbol_tree(2)},
            symbol_uris,
            self.project,
            {"A_ZERO": "0", "A_ONE": "1"},
        )
        return facts, client

    def test_hover_goes_to_the_uri_clangd_knows_not_the_lowercased_key(self) -> None:
        facts, client = self._collect({self.lowered_uri: self.original_uri})
        self.assertEqual(client.asked, [self.original_uri])
        values = {member["name"]: member["value"] for member in facts[0].members}
        self.assertEqual(values, {"A_ZERO": "0", "A_ONE": "1", "A_UNUSED": "2"})

    def test_lowercased_uri_is_what_the_bug_looked_like(self) -> None:
        # 没有这层映射就会拿小写键去问，clangd 不认，值静默变 None
        facts, client = self._collect({})
        self.assertEqual(client.asked, [self.lowered_uri])
        values = {member["name"]: member["value"] for member in facts[0].members}
        self.assertIsNone(values["A_UNUSED"])


if __name__ == "__main__":
    unittest.main()
