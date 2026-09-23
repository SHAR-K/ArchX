# 使用说明

> **状态：部分作废（2026-09-09）。** 图形界面那部分（`npm run dev` 的浏览器原型）
> 连同 `web/` 目录一起删了。Keil 工程、扫描、事实这几节仍然有效。

> 从 README 拆出：图形界面、Keil 工程、架构草案、文件风险分数、测试。

## 使用

项目需要 Python 3.10 或更高版本。

### 图形界面（推荐）

Windows 下双击项目根目录的 `启动ArchCheck.vbs`。在界面中只需要：

1. 选择项目目录
2. 确认自动识别的 Keil 工程或编译数据库
3. 点击“开始分析”

界面会自动选择报告目录并在完成后打开 HTML。未检测到 `clangd` 时会明确
提示，并可直接打开 LLVM 下载页面；仍可选择继续生成低精度基础报告。

以下命令行方式继续保留，主要用于自动化和持续集成。

```powershell
python -m pip install -e .
archcheck C:\path\to\cpp-project
```

默认查找以下位置：

```text
<project>/compile_commands.json
<project>/build/compile_commands.json
```

也可以明确指定编译数据库和输出目录：

```powershell
archcheck C:\path\to\cpp-project `
  --compile-commands C:\path\to\compile_commands.json `
  --out C:\path\to\report
```

默认报告写入项目下的 `.arch-report`。

生成后直接打开 `report.html`。变量定义、引用位置和文件节点均可跳转到
VS Code；系统需要已注册 `vscode://` URL 协议。

### Keil 工程

Keil 工程可以直接使用 `.uvprojx`，不需要联网，也不需要 AI：

```powershell
archcheck C:\path\to\keil-project `
  --keil-project C:\path\to\keil-project\project\application.uvprojx `
  --keil-target application `
  --out C:\path\to\report
```

解析器从 `.uvprojx` 读取目标芯片、宏、包含目录和参与编译的源文件，并在输出
目录的 `.keil` 子目录生成供 clangd 使用的中间编译数据库。Keil 配置仍是事实
来源，不需要修改原工程。

除 `.uvprojx` 自身的 `<Define>` / `<IncludePath>` 外，生成的命令行还会补上
µVision 在编译时隐式注入、但不写进工程文件的内容：

- 器件宏（如 `GD32F30X_XD`）：从 `<PackID>` 对应的 CMSIS Pack `.pdsc` 中按
  `<Device>` 查 `<compile define>`；Pack 目录来自 Keil `TOOLS.INI` 的 `RTEPATH`、
  `ARM\PACK` 和 `%LOCALAPPDATA%\Arm\Packs`。
- ARM 编译器系统头目录（`string.h`、`stdio.h` 等）：自动从注册表或
  `C:\Keil_v5` 之类的常见位置找到 Keil 安装，以 `-isystem` 加入。优先使用
  `ARM\ARMCLANG\include`（为 clang 系编译器编写，clang 可直接解析），没有时退回
  `ARM\ARMCC\include`。也可以用 `--keil-toolchain-include <目录>` 或环境变量
  `ARCHCHECK_KEIL_TOOLCHAIN_INCLUDE` 显式指定。
- armcc 私有关键字（`__packed`、`__weak`、`__align`、`__irq` 等）映射为 clang
  等价写法，`__declspec` 通过 `-fdeclspec` 启用；ARM Compiler 5 工程还会通过
  `-include` 注入一个声明 `__disable_irq`、`__nop` 等免头文件内建函数的 shim。
  clang 不冒充 `__CC_ARM` / `__ARMCC_VERSION`，CMSIS 等库走 GCC 分支。

找不到 Keil 安装或 Pack 时不会中断分析，而是在报告的 warnings 中明确提示，并只
剩 clang 内建头可用；此时可用 `--keil-define MACRO` 手工补齐器件宏。

HTML 中的“架构节点”按文件归属展示静态结构；“执行入口”从实际 `main` 定义
开始，沿函数调用及 RTOS 任务注册关系逐层展开。两种视图不会互相替代。

## 架构草案

从实际参与构建和 include 触达的文件生成候选节点：

```powershell
archcheck init-architecture C:\path\to\cpp-project `
  --compile-commands C:\path\to\compile_commands.json
```

生成的 `architecture.yaml` 状态为 `draft`，不会自动批准现有依赖。普通扫描会
自动读取项目根目录下的该文件；未匹配文件进入 `unassigned`。

## 文件风险分数

风险分数范围为 0 到 100，由可复算的静态事实组成：

- fan-in 与 fan-out：最多 40 分
- 文件级全局变量：最多 20 分
- 跨文件全局变量：最多 20 分
- include 循环依赖：15 分
- 有效代码行规模：最多 5 分

Treemap 面积与颜色可以独立切换，避免把代码规模误当成风险。

如果本机暂时无法生成编译数据库，可以先做低精度源码清单扫描：

```powershell
archcheck C:\path\to\cpp-project --source-scan
```

这种模式只统计源文件，不提供包含目录和后续语义依赖信息，报告会明确记录分析模式。

## 测试

```powershell
python -m unittest discover -s tests -v
```

## 下一阶段

1. 跨函数 / 跨路径的保护证明（需要 CFG 与 Lockset），替代 same-block 临界区近似
2. 检测无调用入口函数与疑似孤立代码
3. 对比实际依赖与 `architecture.yaml` 目标依赖
4. 建立遗留违规基线和新增违规门禁
5. 为架构节点生成 Agent 上下文包

## 参与贡献 / Contributing

规则是数据：RTOS / MCU / 平台 SDK 的 API 名字全部在 `src/archcheck/profiles/<kind>/*.yaml`，加一个框架不用写 Python。工具链适配器在 `src/archcheck/toolchains/`。见 [CONTRIBUTING.md](CONTRIBUTING.md)（中文）/ [CONTRIBUTING.en.md](CONTRIBUTING.en.md)（English）与 [profiles/README.md](src/archcheck/profiles/README.md)。

Rules are data: every RTOS / MCU / platform API name lives in `src/archcheck/profiles/<kind>/*.yaml`; adding a framework needs no Python. Toolchain adapters live in `src/archcheck/toolchains/`. See CONTRIBUTING.md / CONTRIBUTING.en.md and profiles/README.md.
