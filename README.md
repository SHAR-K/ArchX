# ArchX

**See what firmware actually does — then let an agent change it inside stated bounds.**

[![CI](https://github.com/SHAR-K/archx/actions/workflows/ci.yml/badge.svg)](https://github.com/SHAR-K/archx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](engine/pyproject.toml)
[![Discord](https://img.shields.io/badge/chat-Discord-5865F2.svg?logo=discord&logoColor=white)](https://discord.gg/sCtshjP6N9)

**[▶ Live demo](https://shar-k.github.io/ArchX/)** — the panel on four public firmware repositories. No install, nothing to scan.

Two halves that share one snapshot of facts:

| | What it is | Where |
| --- | --- | --- |
| **ArchCheck** | A static engine that recovers the **runtime structure** of C/C++ firmware — entry points, tasks, ISRs, callbacks, loops, state machines, shared state, concurrency boundaries — without running the program, attaching a probe, or calling an LLM | [`engine/`](engine/) |
| **The extension** | A VS Code panel that shows that same snapshot to a human, organised by question rather than by data type, with every finding linked back to a file and a line | [`extension/`](extension/) |

Every finding carries a file, a line and a confidence level. Anything that cannot be derived
from the source and a rule is reported as unknown, never guessed.

## See it before installing anything

**[shar-k.github.io/ArchX](https://shar-k.github.io/ArchX/)** shows the panel on four public
firmware repositories — bare-metal STM32, FreeRTOS on STM32H7, and two CNC controllers on ESP32 —
at a fixed commit each. It is the same
panel code the extension ships, fed with the facts of that one snapshot; every entry, loop,
shared variable and state links to its line on GitHub. Nothing there is live: change the
code, scan again. To see your own project, install the extension and scan it.

The same panel on a larger production codebase, with identifiers and paths replaced:
**[shar-k.github.io/ArchX/production](https://shar-k.github.io/ArchX/production/)**.

## Why

To see how firmware actually runs, the standard answer is a runtime tracer: instrument the
build, flash it, capture a trace. That tells you what the system **did**. ArchCheck answers a
different question, and answers it before you have a working build to trace:

> **What does the code say it will do?**

It started as a way into one such codebase. A coding agent was no help there: it analysed code
the compiler never sees — `#if 0` blocks, the other board variant, files outside the build — and
re-read the whole tree for every new question. ArchCheck starts from the compile database
instead, and scans once.

That matters most when you inherit firmware nobody can explain any more, when you want the
interrupt/task sharing map before a refactor, or when you want an architecture check in CI
that fails on a new cross-layer call.

It matters a second time when an agent writes the code. An agent that has never read the
call graph will happily touch a variable an ISR also writes. The facts are what make a bound
statable, and the panel is where a human checks the agent against them.

## Getting started

ArchCheck is a tool your coding agent calls. Install the engine and the Claude Code plugin:

```bash
pip install archcheck
claude plugin marketplace add SHAR-K/ArchX && claude plugin install archx@archx
```

Then, in your firmware project, tell the agent:

> scan this project

The agent checks what the scan needs, tells you what is missing and the command for your build
system, scans, and walks you through what it found. It also gives you a link to a local page:
the same views as the [live demo](https://shar-k.github.io/ArchX/), for your project, opened
straight from disk with no server. The facts stay on your machine.

**You need**

1. **Python 3.10+** — the engine is the [`archcheck`](https://pypi.org/project/archcheck/) package on PyPI.
2. **node on `PATH`** — the plugin's MCP server runs on it. Claude Code installed with the native
   installer does not always bring node along.
3. **clangd** — the interrupts, tasks, loops and state machines come from its AST. Without it the
   scan still runs but stops at file dependencies; the agent tells you how to install it.
4. **Build information** — a `compile_commands.json` (CMake, PlatformIO, ESP-IDF, Zephyr,
   Makefile + bear) or a Keil `.uvprojx`, which ArchCheck reads directly. If there is none, the
   agent tells you the one command that makes it; nothing is built behind your back.

**In VS Code** (optional): the extension shows the same facts in a panel and jumps from every
finding to its line.

### Without an agent

The engine is a plain CLI. The repository ships a small sample project:

```bash
node tools/corpus-prepare.mjs      # writes the sample's compile_commands.json at your clone path
archcheck corpus/blinky --out out/
```

`out/architecture.json` is the machine-readable form — see the
[field contract](docs/SCHEMA.md).

## Where it stands

**Works today.** Compilation-database and Keil project parsing; include and call graphs;
reachability from real entry points; AST-level loops, state-machine candidates, variable
access, critical sections, shared resources and conflict candidates; run-mode classification;
callbacks registered through data; profiles for FreeRTOS, Zephyr, CMSIS-RTOS2, POSIX,
protothreads, ESP-IDF, STM32 HAL, GD32 and Cortex-M CMSIS.

**Not there yet.** The extension panel is a display and review surface, not a workbench — the
agent-facing workflow described in [ARCHX_DIRECTION.md](docs/ARCHX_DIRECTION.md) is at its
first stage. Large projects produce large snapshots, and size convergence is an open item.
The full list of limits is kept honest in
[ARCHCHECK_STATUS.md](docs/ARCHCHECK_STATUS.md). Picking the work up in a fresh session
starts at [HANDOFF.md](docs/HANDOFF.md) — what is measured, what is a dead end, and what
will be re-learned the hard way otherwise.

**The engine knows no API name.** Every RTOS or SDK function name lives in a profile YAML, not
in Python. A framework that is not recognised is a missing profile, not a code change — which
is also the easiest way to contribute.

## Layout

```
engine/      ArchCheck — the Python fact engine
extension/   the VS Code extension
packages/    shared projection and per-theme derivation
corpus/      sample projects used by the regression smoke test
docs/        direction, handoff, schema, status
tools/       build and smoke scripts
```

## Contributing

Profiles need no Python. Toolchain adapters need no engine knowledge. Both paths, plus the
engine itself, are described in [CONTRIBUTING.md](CONTRIBUTING.md)
([English](CONTRIBUTING.en.md)).

Questions, scan results from your own firmware, or a profile you want to write:
[join the Discord](https://discord.gg/sCtshjP6N9). Bugs go to issues.

```bash
npm ci && npm run check && npm test   # engine unit tests, tools and extension
node tools/corpus-smoke.mjs           # engine against the sample project
```

## License

[MIT](LICENSE)
