# CLAUDE.md

Project rules for any agent working in this repository. These are decisions already
made — follow them, do not re-derive them, and do not invent alternatives.

## What this project is

ArchCheck reads C/C++ source and extracts code facts: what actually compiles, what calls
what, which units touch the same state, where execution starts and what it reaches.
ArchX is the constrained-development end that consumes those facts.

**Positioning — use this framing, not another one.** ArchCheck sits in *architecture
recovery* (alongside Understand, Lattix, Structure101), not in *static analysis*
(cppcheck, clang-tidy, Coverity). The distinction is load-bearing: static-analysis tools
are bug finders expected to run on every commit. Architecture recovery is scanned once
when you inherit a project, and again before a large refactor.

**Snapshot semantics.** A fact set describes one commit and carries the commit it came
from. Change the code, scan again. State this openly wherever it matters — it is a stated
boundary, not a gap to hide. It is also the contrast with runtime tracing (Tracealyzer,
SystemView), which needs instrumentation and a running system before it has any data at
all.

**How to say it: the scan needs no model, reading what it produces does.** Both halves are
selling points and they must be stated in that order.

Extraction is deterministic or the facts are not trustworthy — offline, reproducible, no
model call, the same commit scanned twice yields the same answer. Consumption goes through
an agent or the facts cannot be read at all: four directories of a public 332-file STM32H743
project (`stm32h743` in `corpus/external.yaml`) project to 15 MB of facts (0.54 MB gzipped),
and nobody reads 15 MB in a panel. The MCP layer exists so facts can be sliced
by theme, by object, by field path — that is the only way a human ever reaches this data.

The MCP layer is justified by slicing, not by MCP being a popular thing to build.

Do not describe ArchCheck as "an AI-free scanner" — it says something the project does
not mean. The extraction takes no model; the analysis exists to be consumed by an agent.
See `docs/ARCHX_DIRECTION.md` §1.

Do not restate this framing in other documents — reference this file. Five documents
once drifted into five different versions of it.

## Language

Outward-facing surfaces are **English**: README, CLI output and help, generated reports,
issue templates, extension marketplace copy and notifications.

Chinese stays where it belongs: **code comments** (only maintainers read them; translating
loses information) and **internal records under `docs/`** (no translation promised).

Where the catalogs live (both machine-checked, see below):

- `packages/facts-view/src/i18n.mjs` — `t("English sentence", vars)`. The English sentence is the
  key; `locales/zh-CN.json` maps it to Chinese. Used by the webview, the extension host and the
  derived layer; the host sets the locale from `vscode.env.language` before deriving, the webview
  reads it from `body[data-lang]`, the MCP server is pinned to English. `tools/i18n-guard.mjs`
  (in `npm test`) fails on any Chinese literal left in those directories, any `t()` sentence
  missing from the catalog, and any catalog entry no source file uses.
- `extension/package.nls.json` / `package.nls.zh-cn.json` — VS Code's own mechanism for
  `package.json` command titles, view names and setting descriptions.

Do not add gettext, `.po` files, or babel. `--json` is the engine's real interface; the
human-readable summary is a convenience path. Only build a message catalog where key
consistency is machine-checked (VS Code nls has tooling; anything hand-rolled needs a
smoke assertion). A second catalog nobody maintains drifts into half-translated output.

### Hard rule: interface identifiers are never localized

ASCII only, no exceptions:

- `architecture.json` field names
- execution unit kind values (`isr`, `task`, `callback`, `timer`)
- profile rule ids
- CLI flag names
- MCP tool names
- stable IDs

Break this and facts produced in a Chinese locale stop matching facts produced in an
English one, so agents and downstream tooling can no longer align on the same object.
This is a correctness rule, not a style preference — it belongs in CI, not in memory.
