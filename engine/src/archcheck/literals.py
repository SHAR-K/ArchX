"""C integer literals, parsed the way C spells them.

Shared by the AST, pruning and time-base layers, so the lowest layers can use one parser
without depending on each other.

``int(text, 0)`` looks like the obvious tool and is wrong for C: Python refuses a leading zero
(``int("01", 0)`` raises) because it reserves ``0o`` for octal, while in C a leading zero *is*
how you write octal.  Embedded code writes ``010`` for a bit pattern without a second thought,
so the guard regex ``\\d+`` let it through and the scan died on a legal source file.

Found by the external corpus (STM32H743-CMake-Template) — the whole scan aborted with
``invalid literal for int() with base 0: '01'``.  Reproduced in ``corpus/blinky`` so the
regression does not depend on that checkout.
"""

from __future__ import annotations

import re

# 前缀二/八/十六进制，或十进制；C 里前导零就是八进制。允许 u/U/l/L 后缀和正负号。
INT_LITERAL = re.compile(r"^[+-]?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[0-7]*|[1-9]\d*)[uUlL]*$")


def parse_c_integer(text: str | None) -> int | None:
    """The value of a C integer literal, or None when it is not one.

    Never raises: callers use it to decide whether a bound is known, and one odd literal
    must not abort a scan.
    """

    if text is None:
        return None
    body = text.strip()
    if not INT_LITERAL.match(body):
        return None
    body = body.rstrip("uUlL")
    sign = 1
    if body[:1] in "+-":
        sign = -1 if body[0] == "-" else 1
        body = body[1:]
    try:
        if body[:2] in {"0x", "0X"}:
            return sign * int(body[2:], 16)
        if body[:2] in {"0b", "0B"}:
            return sign * int(body[2:], 2)
        if len(body) > 1 and body[0] == "0":
            return sign * int(body[1:], 8)  # C 的八进制：前导零
        return sign * int(body, 10)
    except ValueError:
        return None


def is_int_literal(text: str | None) -> bool:
    return parse_c_integer(text) is not None
