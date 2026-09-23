"""Macro dependencies: which file uses which macro, and which file defines it.

A ``#include`` says "I want your declarations"; a macro use says "my code is *written* partly
by you": the value of ``SYSTICK_PERIOD_MS`` or the body of ``thread_begin`` is text the
preprocessor pastes into my translation unit.  Configuration headers (``*_libopt.h``,
``config.h``) are depended on almost exclusively this way, so without this fact they look
like leaves nobody touches.

The uses come from clangd's semantic tokens (token type ``macro``): that is the compiler's
own record of which identifiers were macro names in this translation unit, after all
conditional compilation.  The definitions come from the ``#define`` lines of every file in
the scan; a name defined once resolves directly, a name defined in several files is
resolved with one ``textDocument/definition`` at its first use.
"""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any, Callable, Iterable, Sequence

from archcheck.model import MacroUse, SourceLocation

_DEFINE_PATTERN = re.compile(r"^\s*#\s*define\s+([A-Za-z_]\w*)")

MacroToken = tuple[str, int, int]  # (name, 1-based line, 1-based column)


def decode_macro_tokens(data: Sequence[int], token_types: Sequence[str], lines: Sequence[str]) -> list[MacroToken]:
    """Macro-name tokens from an LSP ``semanticTokens/full`` result (relative encoding, 5 ints each).

    The token on a ``#define NAME`` line that *is* NAME is the definition, not a use; skipped.
    """

    if "macro" not in token_types:
        return []
    macro_index = list(token_types).index("macro")
    out: list[MacroToken] = []
    line = 0
    character = 0
    for i in range(0, len(data) - 4, 5):
        delta_line, delta_char, length, token_type, _modifiers = data[i:i + 5]
        line += int(delta_line)
        character = int(delta_char) if delta_line else character + int(delta_char)
        if int(token_type) != macro_index or line >= len(lines):
            continue
        text = lines[line][character:character + int(length)]
        if not text:
            continue
        match = _DEFINE_PATTERN.match(lines[line])
        if match is not None and match.group(1) == text:
            continue
        out.append((text, line + 1, character + 1))
    return out


def find_macro_definitions(
    project: Path, paths: Iterable[str], mask: Callable[[str], str] | None = None
) -> dict[str, list[tuple[str, int]]]:
    """``#define`` lines of every listed file: macro name -> [(relative path, 1-based line)]."""

    definitions: dict[str, list[tuple[str, int]]] = {}
    for relative in paths:
        try:
            text = (project / relative).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if mask is not None:
            text = mask(text)
        for number, line in enumerate(text.splitlines(), start=1):
            match = _DEFINE_PATTERN.match(line)
            if match is not None:
                definitions.setdefault(match.group(1), []).append((relative, number))
    return definitions


_DEFINE_VALUE = re.compile(r"^\s*#\s*define\s+([A-Za-z_]\w*)(?![\w(])\s*(.*?)\s*$")


def macro_literal_values(project: Path, uses: Iterable[MacroUse]) -> dict[str, str]:
    """Object-like macros the scan resolved to one ``#define`` -> the replacement text.

    Only definitions inside the project are read (``resolution == "project"``); the text is
    taken as written after the name, comments stripped, outer parentheses kept.  Consumers
    that need a number fold it themselves (``resolve_priority_text``); anything that is not a
    plain constant stays text and simply fails to fold.
    """

    values: dict[str, str] = {}
    cache: dict[str, list[str]] = {}
    for use in uses:
        if use.defined_in is None or use.resolution != "project" or use.macro in values:
            continue
        path = use.defined_in.path
        if path not in cache:
            try:
                cache[path] = (project / path).read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                cache[path] = []
        lines = cache[path]
        index = use.defined_in.line - 1
        if not 0 <= index < len(lines):
            continue
        match = _DEFINE_VALUE.match(lines[index])
        if match is None or match.group(1) != use.macro:
            continue
        text = re.sub(r"/\*.*?\*/", "", match.group(2)).split("//")[0].strip()
        if text:
            values[use.macro] = text
    return values


def derive_macro_uses(
    tokens_by_file: dict[str, Sequence[MacroToken]],
    definitions: dict[str, list[tuple[str, int]]],
    resolve: Callable[[str, int, int], tuple[str, int] | None] | None = None,
) -> tuple[MacroUse, ...]:
    """One record per (file, macro): count, first use, defining file.

    ``resolve(file, line, column)`` is asked only for names with several ``#define`` sites
    in the project; it returns (relative path, line) of the definition clangd picked, or None.
    Names with no definition in the project are ``external`` (SDK / libc / compiler builtins).
    """

    uses: list[MacroUse] = []
    for file, tokens in sorted(tokens_by_file.items()):
        first: dict[str, MacroToken] = {}
        counts: dict[str, int] = {}
        for token in tokens:
            name = token[0]
            counts[name] = counts.get(name, 0) + 1
            first.setdefault(name, token)
        for name in sorted(counts):
            _name, line, column = first[name]
            sites = definitions.get(name, [])
            defined_in: SourceLocation | None = None
            resolution = "external"
            if len(sites) == 1:
                defined_in = SourceLocation(path=sites[0][0], line=sites[0][1], column=1)
                resolution = "project"
            elif len(sites) > 1:
                resolution = "ambiguous"
                picked = resolve(file, line, column) if resolve is not None else None
                if picked is not None:
                    defined_in = SourceLocation(path=picked[0], line=picked[1], column=1)
                    resolution = "project"
            uses.append(
                MacroUse(
                    file=file,
                    macro=name,
                    count=counts[name],
                    location=SourceLocation(path=file, line=line, column=column),
                    defined_in=defined_in,
                    resolution=resolution,
                    definitions=len(sites),
                )
            )
    return tuple(uses)
