"""CLI output and --help are English (CLAUDE.md: outward-facing surfaces are English; comments may stay Chinese)."""

from __future__ import annotations

from pathlib import Path
import re
import unittest


class CliLanguageTest(unittest.TestCase):
    def test_no_chinese_outside_comments(self) -> None:
        source = (Path(__file__).resolve().parents[1] / "src" / "archcheck" / "cli.py").read_text(encoding="utf-8")
        offending = [
            f"{number}: {line.strip()}"
            for number, line in enumerate(source.splitlines(), start=1)
            if re.search("[一-鿿]", line) and not line.strip().startswith("#")
        ]
        self.assertEqual([], offending, "cli.py prints or declares Chinese text")


if __name__ == "__main__":
    unittest.main()
