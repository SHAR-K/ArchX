from __future__ import annotations

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from archcheck.literals import parse_c_integer


class ParseCIntegerTests(unittest.TestCase):
    def test_octal_is_read_the_way_c_reads_it(self) -> None:
        # int(s, 0) raises on these -- Python rejects a leading zero, C calls it octal.
        for text, expected in (("01", 1), ("07", 7), ("010", 8), ("0777", 511)):
            with self.subTest(text=text):
                self.assertEqual(expected, parse_c_integer(text))

    def test_decimal_hex_binary_and_suffixes(self) -> None:
        for text, expected in (
            ("0", 0),
            ("42", 42),
            ("42u", 42),
            ("42UL", 42),
            ("0x1F", 31),
            ("0XFFu", 255),
            ("0b1010", 10),
        ):
            with self.subTest(text=text):
                self.assertEqual(expected, parse_c_integer(text))

    def test_signs(self) -> None:
        self.assertEqual(-8, parse_c_integer("-010"))
        self.assertEqual(16, parse_c_integer("+0x10"))

    def test_not_an_integer_returns_none_instead_of_raising(self) -> None:
        for text in ("08", "0x", "abc", "1.5", "1 << 2", "", "   ", None):
            with self.subTest(text=text):
                self.assertIsNone(parse_c_integer(text))


    def test_c_grammar_not_python_grammar(self) -> None:
        # 这几个是 Python 认、C 不认的写法。走 int(body, 0) 兜底就会把它们当成数字，
        # 于是一个不是字面量的东西被报成常量——比崩溃更难发现。
        self.assertIsNone(parse_c_integer("0o17"), "0o 是 Python 的八进制前缀，C 里不合法")
        self.assertIsNone(parse_c_integer("1_000"), "下划线分隔是 Python 的写法")
        self.assertIsNone(parse_c_integer("0x"), "只有前缀没有数字")

    def test_binary_literal(self) -> None:
        # 0b 是 GCC 扩展，嵌入式代码里写位模式常用
        self.assertEqual(parse_c_integer("0b1011"), 11)
        self.assertEqual(parse_c_integer("0B11u"), 3)


class RelativePathTests(unittest.TestCase):
    """A file outside the project must not abort the run.

    PlatformIO keeps frameworks under ~/.platformio/packages, so an ESP-IDF project's
    enums and macros come from paths that are not under the project at all.
    """

    def test_outside_the_project_yields_an_absolute_path(self) -> None:
        from archcheck.semantic import _relative

        project = Path(__file__).resolve().parents[1]
        inside = project / "src" / "archcheck" / "semantic.py"
        self.assertEqual("src/archcheck/semantic.py", _relative(inside, project))

        outside = Path(__file__).resolve().parents[2] / "definitely-not-in-the-project.h"
        result = _relative(outside, project)
        self.assertTrue(result.endswith("definitely-not-in-the-project.h"))
        self.assertNotIn("..", result, "an absolute path, not a walk out of the project")


if __name__ == "__main__":
    unittest.main()


class RelativePathTests(unittest.TestCase):
    """A file outside the project must not abort the run.

    PlatformIO keeps frameworks under ~/.platformio/packages, so an ESP-IDF project's
    enums and macros come from paths that are not under the project at all.
    """

    def test_outside_the_project_yields_an_absolute_path(self) -> None:
        from archcheck.semantic import _relative

        project = Path(__file__).resolve().parents[1]
        inside = project / "src" / "archcheck" / "semantic.py"
        self.assertEqual("src/archcheck/semantic.py", _relative(inside, project))

        outside = Path(__file__).resolve().parents[2] / "definitely-not-in-the-project.h"
        result = _relative(outside, project)
        self.assertTrue(result.endswith("definitely-not-in-the-project.h"))
        self.assertNotIn("..", result, "an absolute path, not a walk out of the project")
