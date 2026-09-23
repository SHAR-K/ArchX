"""Canonical path resolution, memoised.

``Path.resolve()`` is a syscall on Windows (``nt._getfinalpathname``) and it is not cheap.
A scan of a 222-file project made 54 317 of them across at most a few hundred distinct paths:
``_relative`` alone re-resolved the *same* project root 13 564 times.  In the profile that was
4.1 s of pure repetition, the second largest item after waiting on clangd.

The filesystem does not change during a scan, so resolution is a pure function and caching it
cannot change any fact.  The cache is process-wide and unbounded on purpose: the key space is
the set of paths a scan touches, which is bounded by the project, and a scan is a short-lived
process.
"""

from __future__ import annotations

from pathlib import Path

_resolved: dict[str, Path] = {}


def resolved(path: Path) -> Path:
    """``path.resolve()``, remembered.  Same value, same type, one syscall per distinct path."""
    key = str(path)
    hit = _resolved.get(key)
    if hit is None:
        hit = path.resolve()
        _resolved[key] = hit
    return hit


def clear_cache() -> None:
    """Only for tests that create and delete paths inside one process."""
    _resolved.clear()
