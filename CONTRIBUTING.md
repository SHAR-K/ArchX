# 参与 ArchCheck

[English version](CONTRIBUTING.en.md)

ArchCheck 是一个**确定性**的嵌入式 C 代码事实引擎，提取过程不调用模型：用 clangd 读代码，用规则表识别框架和硬件 API，用确定性算法推导执行单元、可达性、运行模式、状态机、共享资源与冲突候选。产出是带版本的 JSON（`architecture.json` / `partition.json`），下游工具（ArchX 等）只消费字段，不重新分析代码。

这份文档说明仓库结构、三条贡献路径（规则 profile、工具链适配器、引擎能力）、测试与提交约定。

## 1. 三层分工

| 层 | 目录 | 内容 | 谁来改 |
|---|---|---|---|
| 引擎 | `engine/src/archcheck/*.py` | clangd 驱动、AST 抽取、推导算法、schema | 需要理解 clangd LSP 与 AST；改动要附 fixture 测试并说明对 schema 的影响 |
| 工具链适配器 | `engine/src/archcheck/toolchains/` | 把厂商工程（Keil µVision…）变成 clang 编译数据库 | 熟悉某个 IDE / 编译器的人 |
| 规则 profile | `engine/src/archcheck/profiles/<kind>/<name>.yaml` | RTOS / MCU / 平台 SDK 的 API 名字：任务注册、中断使能、阻塞点、临界区 | **任何用过这个框架的人，不用写 Python** |

设计原则（也是评审标准）：

1. **事实、推导、解释分开。** 直接从 AST 或编译数据库读到的是事实；从事实算出来的是推导，必须带 `confidence` 和 `evidence`；解释（这段代码"应该"怎样）不属于本仓库。
2. **近似必须声明。** 凡是可能不准的地方，字段旁边要有 `approximation` 或在 `astFacts.approximations` 里说明，下游据此展示警示。宁可标"未知"，不可编造。
3. **引擎不认识任何具体 API 名。** 函数名只出现在 profile YAML 里。如果你发现 Python 里写死了某个 RTOS 的函数名，那是 bug。
4. **一次扫描一个配置。** 未激活的 `#if` 分支进 `inactiveRegions`，不进事实。
5. **接口标识符不本地化。** `architecture.json` 的字段名、执行单元 kind 值（`isr` / `task` / `callback` / `timer`）、profile rule id、CLI 参数名、MCP 工具名、稳定 ID——这些是接口，不是文案。一旦可被本地化，中文环境跑出的事实就会和英文环境对不上，Agent 与下游工具无法对齐。对外的面（README、CLI 输出与帮助、报告产物、issue 模板、插件文案）一律英文；代码注释与 `docs/` 下的内部记录保持中文，不承诺翻译。

## 2. 添加一个 profile（最常见的贡献）

场景：你的工程用的 RTOS / MCU 库还没有 profile，或者现有 profile 漏了 API。

1. 在 `engine/src/archcheck/profiles/<kind>/` 新建 `<name>.yaml`。`kind` 取 `rtos` / `mcu` / `platform` / `generic` / `toolchain`，**目录名必须等于 `kind`**。
2. 文件格式：

```yaml
name: my-rtos              # 项目在 architecture.yaml 里用 profiles: [my-rtos] 选中它
kind: rtos
description: 一句话说明覆盖的 API 范围（中英文都可）
task_create:               # 任务注册：entry_argument = 入口函数是第几个实参（从 0 起）
  - rule: my_rtos.task_spawn
    function: task_spawn
    entry_argument: 0
callback_register:         # 回调注册，同上；function 支持 * 通配
  - rule: my_rtos.on_event
    function: "*_on_event"
    entry_argument: 1
    confidence: medium     # high | medium | low，通配规则请降级
timer_create: []
isr_enable:                # 中断使能：irq_argument = IRQ 号是第几个实参
  - rule: my_mcu.irq_enable
    function: irq_enable
    irq_argument: 0
blocking:                  # 阻塞点：kind = delay（定时睡眠）| wait（等事件 / 队列 / 信号量）| yield（让出）
  - rule: my_rtos.sleep_ms
    function: sleep_ms
    kind: delay
    duration_argument: 0   # 可选：时长是第几个实参
    duration_unit: ms      # ms | us | s | tick（tick 用 tick_ms 换算）
critical_section:          # 临界区：begin / end 成对 API；match_argument 要求两端首个实参文本一致
  - rule: my_rtos.lock
    begin: my_lock
    end: my_unlock
    kind: mutex            # irq | scheduler | mutex
    match_argument: true
tick_ms: 1                 # 可选：调度 tick，默认 1 ms
```

   `rule` 是稳定标识，格式 `<family>.<api>`，会原样出现在事实里，下游按它显示来源；不要改已有规则的 `rule`。

3. 加一个 fixture 测试：在 `tests/` 里用几十行 C 代码写出这个框架最小的用法（一个任务、一个阻塞点、一个临界区），断言 `executionUnits` / `runModes` / `criticalSections` 的结果。参考 `tests/test_ast_facts.py` 里的 `APP_C`。本机没有 clangd 时测试自动 skip，CI 有。
4. `node tools/corpus-smoke.mjs` 与 `npm test` 全绿后提交。提交信息写清覆盖的 API 和依据（官方文档链接）。

profile 的字段含义详见 [`engine/src/archcheck/profiles/README.md`](engine/src/archcheck/profiles/README.md)。

## 3. 添加一个工具链适配器

场景：工程不是 CMake，也没有 `compile_commands.json`（IAR、CCS、MPLAB、老版本 Keil…）。

- 在 `engine/src/archcheck/toolchains/` 加一个模块，职责只有一件事：**产出 clang 能用的 `compile_commands.json`**——源文件、包含路径、宏、目标三元组、系统头路径、编译器特有关键字的 `-D` 映射或 `-include` shim。
- 参考 `toolchains/keil.py`：它读 `.uvprojx`，从 CMSIS Pack 的 pdsc 补器件宏，找 ARM 工具链的系统头，把 armcc 的 `__packed` 等关键字映射成 clang 属性。
- 验收标准是**诊断数**：用 clangd 打开几个典型文件，错误应接近 0。错误多说明参数没补齐，AST 层的事实会在错误恢复下产生噪声。
- 在 `cli.py` 加命令行入口，在 `tests/` 加一个伪造工程文件的测试。

## 4. 改引擎能力

改 `semantic.py` / `ast_facts.py` / `concurrency.py` / `indirection.py` 之前，先读 `docs/ARCHCHECK_STATUS.md` 里对应字段的判定规则。要求：

- 新字段进 `model.py` 的 dataclass，带 `to_dict`，并在 `README.md` 的 schema 表和 `ARCHCHECK_STATUS.md` 里加一行：含义、来源（事实 / 推导）、近似性。
- `astFacts.approximations` 里加一句近似声明。
- schema 有不兼容变化时升 `schemaVersion`，并在提交信息里说明。
- 用真实工程验证一次并给出数字（耗时、字段计数、抽样核对），放进 PR 描述。记录格式见 `docs/ARCHCHECK_STATUS.md` 第 4 章的参考工程。
- 只用 clangd LSP；不要引入 LibTooling / libclang / tree-sitter。需要 CFG 的能力（跨函数临界区证明、路径条件）请先开 issue 讨论。

## 5. 运行与测试

```bash
pip install ./engine                 # 装引擎，提供 archcheck 命令
node tools/corpus-smoke.mjs          # 唯一真跑引擎的测试：需要 clangd
npm run check                        # tsc ×2：node / extension
npm test                             # 派生、投影、面板与打包的冒烟
archcheck <project> --out out/        # 也可加 --keil-project path/to.uvprojx
```

`npm test` 里已经包含引擎的单元测试（`engine/tests/`，14 个）；只想跑它们就
`cd engine && python -m unittest discover -s tests -p "test_*.py"`。

`tools/corpus-smoke.mjs` 是唯一**真跑一遍引擎**的测试：拿仓库内的 `corpus/blinky`（97 行 C）
扫一遍，断言覆盖率、函数数、以及 isr 和 task 都被认出来。它守的是那种沉默的失效——引擎不
报错，只是什么都没读到（曾经 clang 的 target 被写死成 riscv32，于是每个 CMake 工程都报
「函数 0」，退出码还是 0）。

外部真实工程的清单在 [`corpus/external.yaml`](corpus/external.yaml)：锁到 commit，
源码不入库，按 commit clone 到已 gitignore 的 `corpus/external/`。

clangd 用 `--clangd` 指定，或放在 PATH 里；Windows 下也会自动找 `D:\clangd_*` 这类常见位置。

## 6. 提交约定

- Conventional Commits：`feat: …` / `fix: …` / `docs: …` / `refactor: …`。
- 一个 PR 只做一件事：一个 profile、一个适配器、一个能力。
- 不提交生成物（`reports/`、`work/`、`__pycache__`）。
- 讨论用 issue；设计层面的取舍先写清"事实来源是什么、哪里是近似"再谈实现。
