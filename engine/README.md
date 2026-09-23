# ArchCheck

Static analysis that recovers the **runtime structure** of C/C++ firmware — entry
points, tasks, ISRs, callbacks, loops, state machines, shared state and concurrency
boundaries — without running the program, attaching a probe, or calling an LLM.

Every finding carries a file, a line and a confidence level. Anything that cannot be
derived from the source and a rule is reported as unknown, never guessed.

[Field contract](docs/SCHEMA.md) · [Usage](docs/USAGE.md) · [Status & known limits](docs/ARCHCHECK_STATUS.md)

## Why

To see how a firmware actually runs, the standard answer is a runtime tracer:
instrument the build, flash it, capture a trace. That tells you what the system
**did**. ArchCheck answers a different question, and it answers it before you have
a working build to trace:

> **What does the code say it will do?**

|  | Requires | Answers |
| --- | --- | --- |
| Percepio Tracealyzer | TraceRecorder instrumentation, a running system | what the system did |
| Segger SystemView | J-Link probe + instrumentation | what the system did |
| **ArchCheck** | **a compilation database** | **what the code says it will do** |

Useful when you inherit firmware nobody can explain any more, when you want the
interrupt/task sharing map before a refactor, or when you want an architecture
check in CI that fails on a new cross-layer call.

## If you can build it, ArchCheck can read it

- `compile_commands.json` (CMake, ESP-IDF, Zephyr, Makefile + bear), **or** a Keil
  `.uvprojx` — ArchCheck generates a compatible database from the Keil project itself
- `clangd` on `PATH` (the AST layer is built on its LSP)
- Python 3.10+

That is the entire prerequisite list. There is no agent to install, no code to
annotate, and nothing is uploaded anywhere.

## Quick start

```bash
git clone https://github.com/SHAR-K/archcheck
cd archcheck && pip install -e .

# a CMake / ESP-IDF / Zephyr project
archcheck /path/to/firmware

# a Keil project (pass --keil-target when the project has several targets)
archcheck /path/to/firmware --keil-project MDK-ARM/app.uvprojx
```

**Point it at your own firmware.** Three minutes later you have your startup chain,
your interrupt vectors, and the variables your ISRs share with your tasks — with
line numbers. That is a better demo than any screenshot here.

Output lands in `<project>/.arch-report`: `architecture.json` (the facts),
`metrics.json`, a Markdown summary, and a single self-contained `report.html`.

## What comes out

- **Entry points and startup chain** — `main`, reset handler, `*_init` call chain
- **Runtime units** — tasks, ISRs, callbacks (including callbacks registered through
  initializer tables, struct fields and function-pointer parameters), each with its
  registration site
- **Run modes** — periodic / busy-poll / event-driven / one-shot, with the blocking
  call and the period that implies it
- **Loops** — bounds where they can be derived, and unbounded busy-waits flagged
- **State machine candidates** — `switch` dispatch variables, states and transitions
- **Shared state and conflict candidates** — which variables are reached by more than
  one runtime unit, which accesses sit outside a recognised critical section
- **Image facts** — code/RO/RW/ZI per module from an `armlink` map, kept as a separate
  evidence source from the source-derived facts
- **Coverage** — which translation units were analysed and which were not, per directory

## Reference projects

Two public repositories. Every number below is reproducible on your machine.

| | [hoverboard-sideboard-hack-GD](https://github.com/EFeru/hoverboard-sideboard-hack-GD) | [gd32f30x](https://github.com/Jerry-yl/gd32f30x) |
| --- | ---: | ---: |
| Model | bare-metal super-loop | FreeRTOS |
| Translation units | 36 | 51 |
| Functions | 689 | 871 |
| ISRs | 13 | 10 |
| Loops | 55 | 242 |
| State machine candidates | 13 | 12 |
| Shared resources | 16 | 25 |
| Conflict candidates | 0 (see below) | 9 |
| Wall clock | 9.6 s | 17.0 s |

`docs/ARCHCHECK_STATUS.md` §4 has the full tables and the exact commands.

## What it does not do

**It does not call an LLM.** Not for facts, not for naming, not for guessing. The
rule set is data (see below); an agent can propose new rules for you to review, but
facts only ever come from source plus a rule.

**Two known defects, both being worked on:**

- **Tasks created through a wrapper are missed.** If your project wraps the RTOS API
  (`OS_TaskCreate` → `xTaskCreate(task, ...)` where the entry arrives as a parameter),
  the task entry is not recovered — on the `gd32f30x` reference project the only task
  reported is FreeRTOS's own idle task. Fix is parameter back-tracking through one
  wrapper hop.
- **A bare-metal `main` is not counted as the other side of an ISR conflict.** On the
  hoverboard project all 14 `ISR + main` shared variables are found correctly, with
  line numbers and access directions — but the conflict rule only pairs an ISR against
  a `task` / `callback` / `timer`, so it reports zero conflicts. This affects every
  super-loop project.

Beyond that: cross-function critical sections need a CFG and are only approximated;
`yieldLocals` compares source line order, not control flow; sizes require a linker map
and only `armlink` maps are parsed today. Every approximation is also declared in
`astFacts.approximations` in the output itself.

## Rules are data

The engine knows no API name of its own. FreeRTOS, Zephyr, CMSIS-RTOS2, POSIX,
protothreads, ESP-IDF, STM32 HAL, GD32 and Cortex-M CMSIS ship as YAML profiles under
`src/archcheck/profiles/`. Built-in profiles only carry API names you can look up in
public framework docs or a vendor SDK.

Your own wrappers go next to your project, no fork required:

```yaml
# <project>/framework_rules.yaml
scheduling: cooperative
task_create:
  - function: os_task_add
    entry_argument: 0
```

Adding support for a kernel ArchCheck has never seen is a YAML file, not a patch.
See [CONTRIBUTING.md](CONTRIBUTING.md) — profile contributions are the most useful
kind and need no Python.

## License

MIT © 2026 SHAR-K
