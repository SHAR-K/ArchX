"""Compatibility shim: the Keil adapter moved to ``archcheck.toolchains.keil``."""

from archcheck.toolchains import keil as _keil

__all__ = [name for name in dir(_keil) if not name.startswith("__")]
globals().update({name: getattr(_keil, name) for name in __all__})
