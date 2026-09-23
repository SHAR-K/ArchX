# Contributing to ArchCheck

[中文版](CONTRIBUTING.md)

ArchCheck is a **deterministic** fact engine for embedded C — extraction calls no model: clangd reads the code, rule tables recognise framework and hardware APIs, and deterministic algorithms derive execution units, reachability, run modes, state machines, shared resources and conflict candidates. The output is versioned JSON (`architecture.json` / `partition.json`); downstream tools (ArchX and others) consume fields, they never re-analyse code.

This document covers the repository layout, the three ways to contribute (rule profiles, toolchain adapters, engine capabilities), testing and commit conventions.

## 1. Three layers

| Layer | Directory | What lives there | Who changes it |
|---|---|---|---|
| Engine | `engine/src/archcheck/*.py` | clangd driver, AST extraction, derivations, schema | Needs clangd LSP / AST knowledge; changes come with fixture tests and a note on schema impact |
| Toolchain adapters | `engine/src/archcheck/toolchains/` | Turn a vendor project (Keil µVision, …) into a clang compile database | Anyone who knows a particular IDE / compiler |
| Rule profiles | `engine/src/archcheck/profiles/<kind>/<name>.yaml` | API names of an RTOS / MCU library / platform SDK: task registration, ISR enable, blocking points, critical sections | **Anyone who has used the framework — no Python required** |

Design principles (also the review checklist):

1. **Facts, derivations and interpretation stay apart.** What is read from the AST or the compile database is a fact; what is computed from facts is a derivation and must carry `confidence` and `evidence`; interpretation (what the code *should* look like) does not belong in this repository.
2. **Approximations are declared.** Wherever a result can be wrong, the field carries `approximation` or an entry in `astFacts.approximations`, so downstream can show the caveat. Prefer "unknown" over a guess.
3. **The engine knows no API name.** Function names live only in profile YAML. A hard-coded RTOS function name in Python is a bug.
4. **One scan, one configuration.** Inactive `#if` branches go to `inactiveRegions`, never into the facts.
5. **Interface identifiers are never localised.** Field names in `architecture.json`, execution-unit kind values (`isr` / `task` / `callback` / `timer`), profile rule ids, CLI flags, MCP tool names and stable ids are an interface, not copy. Once they can be localised, facts produced in one locale stop matching another and agents and downstream tools can no longer line up. Everything outward-facing — README, CLI output and help, report artefacts, issue templates, extension copy — is English; code comments and the internal records under `docs/` stay in Chinese and are not promised a translation.

## 2. Adding a profile (the most common contribution)

Your RTOS / MCU library has no profile yet, or an existing profile misses an API.

1. Create `engine/src/archcheck/profiles/<kind>/<name>.yaml`. `kind` is one of `rtos` / `mcu` / `platform` / `generic` / `toolchain`; **the directory name must equal `kind`**.
2. File format:

```yaml
name: my-rtos              # projects select it with profiles: [my-rtos] in architecture.yaml
kind: rtos
description: one sentence on the API surface covered
task_create:               # task registration: entry_argument = index of the entry function argument (0-based)
  - rule: my_rtos.task_spawn
    function: task_spawn
    entry_argument: 0
callback_register:         # callback registration; function accepts * wildcards
  - rule: my_rtos.on_event
    function: "*_on_event"
    entry_argument: 1
    confidence: medium     # high | medium | low — lower it for wildcard rules
timer_create: []
isr_enable:                # ISR enable: irq_argument = index of the IRQ number argument
  - rule: my_mcu.irq_enable
    function: irq_enable
    irq_argument: 0
blocking:                  # blocking points: kind = delay (timed sleep) | wait (event / queue / semaphore) | yield
  - rule: my_rtos.sleep_ms
    function: sleep_ms
    kind: delay
    duration_argument: 0   # optional: index of the duration argument
    duration_unit: ms      # ms | us | s | tick (tick is converted with tick_ms)
critical_section:          # begin / end API pairs; match_argument requires identical first arguments
  - rule: my_rtos.lock
    begin: my_lock
    end: my_unlock
    kind: mutex            # irq | scheduler | mutex
    match_argument: true
tick_ms: 1                 # optional scheduler tick, default 1 ms
```

   `rule` is a stable identifier of the form `<family>.<api>`; it appears verbatim in the facts and downstream shows it as the source. Never rename an existing rule id.

3. Add a fixture test: a few dozen lines of C in `tests/` showing the minimal use of the framework (one task, one blocking point, one critical section), asserting `executionUnits` / `runModes` / `criticalSections`. See `APP_C` in `tests/test_ast_facts.py`. Tests skip automatically when clangd is missing locally; CI has it.
4. Commit once `node tools/corpus-smoke.mjs` and `npm test` are green. The message names the APIs covered and the reference (link to the official docs).

Field reference: [`engine/src/archcheck/profiles/README.md`](engine/src/archcheck/profiles/README.md).

## 3. Adding a toolchain adapter

Your project is not CMake and has no `compile_commands.json` (IAR, CCS, MPLAB, older Keil, …).

- Add one module under `engine/src/archcheck/toolchains/`. Its only job: **emit a `compile_commands.json` clang can use** — sources, include paths, defines, target triple, system header paths, and `-D` mappings or an `-include` shim for compiler-specific keywords.
- Study `toolchains/keil.py`: it reads `.uvprojx`, adds device macros from the CMSIS Pack pdsc, locates the ARM toolchain headers and maps armcc keywords such as `__packed` to clang attributes.
- The acceptance criterion is **the diagnostic count**: open a few typical files with clangd, errors should be close to zero. Many errors mean missing flags, and AST facts would then be extracted under error recovery.
- Add a CLI entry in `cli.py` and a test with a fabricated project file under `tests/`.

## 4. Changing engine capabilities

Before touching `semantic.py` / `ast_facts.py` / `concurrency.py` / `indirection.py`, read the decision rules for the affected fields in `docs/ARCHCHECK_STATUS.md`. Requirements:

- New fields are dataclasses in `model.py` with `to_dict`, plus a row in the README schema table and in `ARCHCHECK_STATUS.md`: meaning, origin (fact / derivation), approximation.
- One sentence in `astFacts.approximations`.
- Bump `schemaVersion` on incompatible changes and say so in the commit message.
- Validate on a real project and report numbers (timing, field counts, spot checks) in the PR, following the reference projects in `docs/ARCHCHECK_STATUS.md` §4.
- clangd LSP only; no LibTooling / libclang / tree-sitter. Capabilities that need a CFG (cross-function critical-section proofs, path conditions) start as an issue.

## 5. Running and testing

```bash
pip install ./engine                 # installs the engine and the archcheck command
node tools/corpus-smoke.mjs          # the only test that really runs the engine; needs clangd
npm run check                        # tsc x2: node / extension
npm test                             # smoke over derivations, projection, panel and bundles
archcheck <project> --out out/        # add --keil-project path/to.uvprojx if needed
```

`npm test` already covers the engine's unit tests (`engine/tests/`, 14 of them); to run only
those, `cd engine && python -m unittest discover -s tests -p "test_*.py"`.

`tools/corpus-smoke.mjs` is the only test that **actually runs the engine**: it scans the in-tree
`corpus/blinky` (97 lines of C) and asserts coverage, function count, and that both an isr and a
task are recognised. It guards the silent failure, where the engine reports no error and simply
reads nothing — a hard-coded riscv32 target once made every CMake project report zero functions
and still exit 0.

The external corpus is listed in [`corpus/external.yaml`](corpus/external.yaml): pinned to
commits, sources kept out of the tree and cloned into the ignored `corpus/external/`.

Point at clangd with `--clangd` or put it on PATH; on Windows common locations such as `D:\clangd_*` are probed automatically.

## 6. Commit conventions

- Conventional Commits: `feat: …` / `fix: …` / `docs: …` / `refactor: …`.
- One PR does one thing: one profile, one adapter, one capability.
- No generated artefacts (`reports/`, `work/`, `__pycache__`).
- Discuss in issues; for design trade-offs, state first what the fact source is and where the approximation lies.
