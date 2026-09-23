"""Toolchain adapters: turn a vendor project into a clang compile database.

Each adapter is self-contained (``keil.py`` for µVision + CMSIS Packs + armcc).  Adding a
toolchain means adding one module here plus a fixture test; nothing else in the engine
knows about vendors.
"""
