# Archcheck 当前状态、使用说明与路线图

> 文档状态：2026-09-02  
> 当前包版本：0.4.0（architecture.json `schemaVersion: 4`）  
> 适用代码：本文档所在 Git 提交及之后版本

## 1. Archcheck 是什么

Archcheck 是一个面向 C/C++ 遗留工程的离线代码事实提取、架构恢复和交互式
观察工具。

它当前解决的核心问题是：

1. 一个大型工程实际编译了哪些文件。
2. 文件、函数和变量之间存在什么依赖关系。
3. 程序从真实入口出发会调用哪些函数。
4. 哪些全局变量被跨文件访问。
5. 哪些文件高度耦合、形成 include 循环或承担过多职责。
6. 如何从模块、文件、函数、变量等不同层级浏览同一份代码事实。

Archcheck 的长期目标不是成为另一个 AI 代码生成器，而是为以下开发方式建立
可验证的架构基础：

```text
遗留代码
  -> 恢复实际架构
  -> 人工确认目标架构
  -> 锁定模块边界和接口契约
  -> 子 Agent 只在所属架构节点内工作
  -> 自动检查跨节点依赖和状态访问
```

## 2. 当前产品定位

当前 Archcheck 可以定义为：

> 面向 C/C++ 遗留工程的架构恢复工具。事实提取是确定性的——离线、可复现、不调用模型；
> 这些事实的消费者是 Agent，面板是人审核 Agent 的地方。对外表述以仓库根 `CLAUDE.md` 为准。

当前已经能够“看清现状”，但还不能完整地“锁定目标架构”。它不是编译器、
IDE、自动重构器或完整的架构门禁系统。

### 确定性提取的部分

- Keil 和编译数据库解析
- 文件与 include 关系扫描
- clangd 符号、调用和引用关系提取
- 源码级直接调用补偿扫描
- RTOS 任务注册识别
- Doxygen 文档提取
- 指标计算、循环依赖检测和报告生成
- HTML 图形布局、筛选、搜索与源码跳转

正常扫描不需要网络。只有用户主动点击 clangd 获取入口时，才会打开外部安装
页面。

## 3. 当前已实现能力

### 3.1 工程输入

支持以下输入方式：

| 输入 | 状态 | 说明 |
| --- | --- | --- |
| `compile_commands.json` | 已实现 | 适用于 CMake、Make 包装工具及其他可导出编译数据库的工程 |
| Keil `.uvprojx` | 已实现 | 读取 Target、芯片、宏、包含目录和源文件，生成 clangd 中间配置 |
| WSL/Linux 编译路径 | 已实现 | 将编译数据库中的 Linux 路径映射到 Windows 本地仓库 |
| 纯源码目录 | 已实现 | 无编译配置时进行低精度文件扫描 |

Keil 工程本身仍是配置事实来源。Archcheck 生成的
`.keil/compile_commands.json` 只是供 clangd 使用的中间文件，不要求修改原 Keil
工程。

### 3.2 文件与模块事实

- 参与编译的源文件与编译单元统计
- 源文件扩展名和包含目录统计
- 本地 `#include` 依赖边
- 文件 fan-in 和 fan-out
- include 强连通分量与循环依赖组
- 文件总行数、有效代码行和风险分数
- 基于目录的候选架构节点归属
- `architecture.yaml` 草案生成与加载
- 未匹配文件归入 `unassigned`

当前循环依赖指的是文件或模块的 include 闭环，不等同于函数递归调用。

### 3.3 函数与变量事实

- clangd 函数符号提取
- clangd Call Hierarchy 调用关系
- 源码直接调用补偿
- `xTaskCreate`、`xTaskCreateStatic`、`xTaskCreatePinnedToCore` 任务入口识别
- 函数到变量的引用关系
- 全局变量定义和引用位置
- 跨文件全局变量识别
- 局部变量与全局变量符号列表
- `main` 真实定义选择和入口调用树

源码补偿只连接已经识别到的函数定义，不会仅凭同名文本随意创建函数节点。

### 3.3.1 AST 层事实（0.3.0，schema 3）

0.3.0 复用同一个 clangd 会话，在每个编译单元的 `documentSymbol` 之后立即对该文件里
**每个函数定义的范围**请求 `textDocument/ast`（从不请求整文件），在同一次遍历里读出
下面四类事实，再用图运算推导三类结果。clangd 20 的语义 token 没有 `modification`
修饰符，因此读 / 写分类完全靠树形：

| 输出 | 类别 | 判定规则 |
| --- | --- | --- |
| `loops[]` | 事实 | `While` / `For` / `Do` 节点；`infinite` = 条件为字面非零（`while(1)`、`while(true)`）或 `for(;;)` 缺条件；`do{}while(0)` 语句宏不计入；宏展开产生的循环记 `fromMacro`；回跳 `goto` 记 `kind: "goto", unrecognized: true`。`callsInBody` 来自循环体内 `Call` 节点并解析为 symbolId；`blockingCalls` 同时匹配 `Call` 节点的被调名（`via: "ast"`）和循环体源码文本里的函数式宏名（`via: "text"`，`thread_sleep` 这类宏只能这样看到） |
| `resourceAccesses[]` | 事实 | 只针对文件级 `static` 与全局变量（`DeclRef` 的 arcana 是 `Var` 且不是函数内声明的 `VarDecl` / `ParmVarDecl`）。读 = `ImplicitCast[LValueToRValue]` 的操作数；写 = `BinaryOperator[=]` 左操作数；读写 = `CompoundAssignOperator`、`UnaryOperator[++/--]`；取地址 = `UnaryOperator[&]` 或数组退化为指针（`array-decay`）。中间经过 `Member` / `ArraySubscript` 时访问仍记在变量上，`via` 给出由变量向外的路径（`field`、`index`、`field+index`、`pointer-field`、`pointer-index`、`pointer-deref`）；`p->x = 1` 记为对 `p` 的 `read` 加一条 `write via pointer-field`，表示写的是指向对象 |
| `stateMachines[]` | 事实 + 近似 | 每条 `switch`：分派表达式剥掉 Paren / 隐式转换后必须是 `DeclRef` 或 `Member` / `ArraySubscript` 路径；`states` 取 `Case` 标签（`EnumConstant` 名或字面量，连续 `case A: case B:` 自动展开），数值用一次 `hover` 取 `Value = …`；`transitions` = switch 体内对分派变量的 `=` 赋值（`from` 按语句在 `Compound` 中的顺序归到最近的 case 标签组，`condition` 是包围 `if` 的条件文本，else 分支写成 `!(…)`）加上把本机枚举常量传给"已知会写分派变量的函数"的调用（`via: "call:<fn>"`），以及同函数 switch 之外的赋值（`via: "outside-switch"`）；`writersElsewhere` 列出其他写该变量的函数。置信度：全局枚举分派 + switch 内直接赋值 = high；枚举标签但无 switch 内转换 = medium；非枚举 / 宏生成 = low。分派对象是参数 / 局部变量、只有整数标签且没有转换的纯分发表不输出（计入 `astFacts.switchesSkipped`），protothreads 的 `PT_BEGIN` 续行 switch 也因此被排除 |
| `criticalSections[]` | 事实 + 近似 | 在每个 `Compound` 的直接子语句序列里找匹配 begin 规则的调用（AST 被调名或语句开头的宏名），向后找同一序列里匹配 end 规则的语句（`match_argument` 规则要求首个实参文本一致）；`accessesInside` 是位置落在两者之间的访问。找不到 end 记 `unterminated: true` 并覆盖到块尾。schema 里标 `approximation: "same-block-sequence"` |
| `controlFlow[]` | 事实 + 近似 | 遍历函数 AST 里的 If/While/For/Do/Switch 节点取 range；else 分支取 If 第三个孩子的 range；case/default 在 `_on_switch` 里按兄弟顺序算体的结束行（下一个标签前一行或 switch 末行），同一结束行也写进 `stateMachines[].states[].endLine`。嵌套按行区间包含关系求 `depth` / `parent`。schema 里 `astFacts.approximations.controlFlow` 声明：宏展开语句缺失、fall-through 不建模（0.4.1） |
| `wakeRelations[]` · `runModes[].periodMs` | 推导 | `concurrency.derive_wake_relations`：按 `reachability.byUnit` 把访问归到单元，ISR 侧 write / read_write 且 `via` 为空 + task/callback 侧 read 且访问行是某个 if/while/do 块的起始行（`controlFlow`）→ `flag-poll`；`derive_shared_resources` 据此给候选加 `role`。周期：`BlockingRule.duration_argument/duration_unit`，实参从源码行文本切出，字面数字直接用，标识符记进 `macro_constants` 由收集器 hover（`macro_value`，取 `Expands to` 代码块或 `#define` 体），`FrameworkRules.tick_ms` 换算 tick（0.4.3） |
| `runModes[]` / `executionUnits[].runMode` | 推导 | 取入口函数深度最小的无限循环：体内有 wait 类阻塞 → `event-driven`，有 delay 类 → `periodic`，都没有（含只 `yield`）→ `busy-poll`；没有无限循环 → 沿 `calls` 边最多下钻 3 层找（`evidence.viaCallees`），仍没有则按有界循环 / 无循环给 `one-shot`，`goto` 循环或条件无法判定给 `unknown`。阻塞证据只来自文本宏名时置信度 medium |
| `sharedResources[]` | 推导 | 用 `reachability.byUnit` 把每条访问归到能到达该函数的运行单元根；被 ≥ 2 个根触达的变量输出各根的 `kinds` / `unprotectedKinds` |
| `conflictCandidates[]` | 推导 | 中断侧有 write / read_write，且 task / callback / timer 侧有临界区外的任意访问；或反向（任务侧临界区外写、中断侧任意访问）。`main` 侧（初始化）不参与冲突判定但出现在 `sharedResources`。`confidence`：双侧都写 = high；一写一读 = medium；任一侧只经指针 / 取地址或来自低置信回调注册 = low |

阻塞 API（`blocking`）与临界区 API 对（`critical_section`）全部在 `framework_rules.py`
的规则表里，内置 protothreads / FreeRTOS / CMSIS-RTOS2 / Zephyr / POSIX / 通用延时与
`__disable_irq`、`taskENTER_CRITICAL`、`portDISABLE_INTERRUPTS`、`NVIC_DisableIRQ`、
`nvic_irq_disable` 等成对 API，项目可在 `architecture.yaml` / `framework_rules.yaml` 追加
（写法见 README）。

**近似性声明。** 这一层只读单个函数体的树形，不跟踪控制流：`infinite` 只认字面条件；
转换 `condition` 是文本而非路径条件；临界区只看同一语句序列；`runMode` 看不到藏在
被调函数里的阻塞；冲突候选建立在"可达即可能并发"之上——有候选不等于确有竞态，没有候选
也不等于安全。所有这些在 JSON 里都以 `approximation` 字段或 `astFacts.approximations`
自述，ArchX 与人工审查应据此解读。

### 3.3.2 间接层事实（0.4.0，schema 4）

0.4.0 在同一次 `textDocument/ast` 遍历里多读四类节点——`BinaryOperator[=]` 右侧的函数 /
形参 `DeclRef`、`Var` 的 `InitList`（含 `DesignatedInit`）、被调者不是函数名的 `Call`、每个
`Call` 的实参形状——并对文件级带 `{ }` 初始化器的变量按声明范围再请求一次 AST；结构体字段
顺序用 `textDocument/typeDefinition` 定位定义、再用该头文件的 `documentSymbol` 子节点读出。
clangd 初始化时声明 `inactiveRegionsCapabilities`，收集 `textDocument/inactiveRegions` 推送。

| 输出 | 类别 | 判定规则 |
| --- | --- | --- |
| `executionUnits[]` 的 `form` / `slot` / `dispatchers` / `storedAt` | 事实 + 推导 | 函数地址进入结构体字段（`struct-field-assign`）、数组元素（`pointer-assign`）、聚合初始化器（`init-table`，位置初始化按结构体布局映射字段名，`.name =` 指定初始化直接取名）或注册 API 形参被存入字段 / 数组（`param-store`：调用方传函数名的位置记 `registeredAt`，API 内存入位置记 `storedAt`）。分发者 = 通过同一 (结构体类型, 字段) 或同一表变量做间接调用的函数。产出 `registers_callback` 边（`rule: ast.<form>`）与 `address_of` 边；已由框架规则注册的目标不重复建单元，只补 `dispatchers` 并在有分发者时升 high |
| `enabledAt[].confidence/evidence`、`enableSites[]` | 推导 | `nvic_irq_enable` 类 API 的非常量实参：形参 → 调用方常量（≤ 2 层）；`tab[i].field` → 该表静态初始化器里对应字段的全部 `*_IRQn`；其余记 `enableSites[].reason` |
| `externalSymbols[]` | 事实 | 有声明无定义的被调函数保留为 `external:<name>`，调用边保留；`library` 从声明头所在目录的 `*.lib` / `*.a` 推断 |
| `coverage.byDirectory` | 事实 | 目录前缀累计计数；`analyzer.coverage_for_focus()` 给分区口径 |
| `inactiveRegions[]` / `inactiveFunctions[]` | 事实 / 近似 | clangd 报告的未激活行区间；区间内文本扫描出的函数定义（`approximation: text-scan-in-inactive-region`） |

### 3.4 Doxygen 文档

能够从函数定义前相邻的 Doxygen 注释中提取：

- `@brief` 或 `\brief`
- `@param` 或 `\param`
- `@return`、`@returns`、`@retval`
- `@note`
- `@warning`

函数节点第二行显示 brief。参数、返回值、备注和警告显示在右侧详情面板。数据
以结构化字段保存到 `architecture.json`，后续可以用于接口契约和 Agent 上下文。

### 3.5 HTML 报告

报告包含四个主要视图：

#### 代码地图

- 使用类似磁盘空间分析器的 Treemap
- 面积可表示有效代码行、总行数、耦合数或全局变量数
- 颜色可表示风险、架构归属或跨文件状态
- 支持从模块下钻到文件、函数和变量

#### 依赖架构

- 支持执行入口、架构节点、文件、函数和变量五种层级
- 执行入口从真实 `main` 开始
- 保留从根节点到当前节点的完整父链
- 同时显示当前节点全部直接输入和输出邻居
- 输入边和输出边分别着色
- 节点垂直排列，长名称和 Doxygen brief 分行显示
- 支持搜索、拖动、缩放、顶部返回和节点旁返回

这里的“输入”和“输出”当前表示依赖方向：

- 输入：其他节点调用或依赖当前节点
- 输出：当前节点调用或依赖其他节点

它还不是函数参数值或运行时数据流。

#### 全局变量

- 按模块、存储类型和跨文件状态筛选
- 查看定义位置、引用次数和引用文件
- 跳转到变量定义和引用代码

#### 循环依赖

- 展示 include 循环组
- 列出参与闭环的文件路径

### 3.6 源码跳转

HTML 使用以下协议打开代码：

```text
vscode://file/<absolute-path>:<line>:<column>
```

因此：

- 报告中的已知位置跳转只要求系统注册了 VS Code URL 协议。
- VS Code 内部的“转到定义”由 clangd、Microsoft C/C++ 扩展或其他语言服务提供。
- 没有 clangd 时仍可打开明确文件和行号，但 Archcheck 无法生成完整语义事实。

### 3.7 图形界面

Windows 图形界面已经实现：

- 选择项目目录
- 自动发现 Keil 工程和编译数据库
- 多 Keil Target 下拉选择
- 自动选择默认报告目录
- clangd 检测和安装提示
- 后台分析进度
- 分析完成后自动打开报告

项目根目录提供 `启动ArchCheck.vbs`。当前开发机器桌面还可以使用
`ArchCheck.lnk` 快捷方式。

### 3.8 报告产物

一次完整扫描通常产生：

```text
<report-directory>/
  architecture.json       完整代码事实模型
  metrics.json            汇总指标
  report.md               文本报告
  report.html             单文件交互式报告
  .keil/                  Keil 适配产生的中间编译数据库
  .clangd/                本地化后的 clangd 编译数据库
```

### 3.9 规则 profile 与工具链适配器（0.5.0）

内置规则从 Python 元组搬到 `src/archcheck/profiles/<kind>/<name>.yaml`（rtos / mcu / platform / generic），`framework_rules.list_profiles()` / `load_profiles(names)` 加载，`BUILTIN_RULES` = 全部 profile 合并（产出与 0.4.3 完全一致，规则 id 不变）。项目在 `architecture.yaml` 用 `profiles: [...]` 只选用到的平台，`framework_rules:` 私有规则追加在后。Keil 适配器移到 `toolchains/keil.py`，`archcheck.keil` 保留为兼容 shim。贡献流程见 `CONTRIBUTING.md` / `CONTRIBUTING.en.md`。仍写死在代码里、待抽成 profile 的：向量表解析假定 ARM 汇编 `DCD xxx_IRQHandler`（RISC-V / C 数组向量表不认）；armcc 关键字映射与 intrinsics shim 在 `keil.py` 内。

## 4. 参考工程验证结果

两个公开仓库，任何人都能 clone 下来复现下面每一个数字。

| 参考工程 | 运行模型 | 工具链 / 芯片 |
| --- | --- | --- |
| [`EFeru/hoverboard-sideboard-hack-GD`](https://github.com/EFeru/hoverboard-sideboard-hack-GD) | 裸机超级循环 + 中断 | Keil，GD32F1x0 |
| [`Jerry-yl/gd32f30x`](https://github.com/Jerry-yl/gd32f30x) | FreeRTOS + GD32 | Keil，GD32F30x |

```bash
archcheck <hoverboard> --keil-project MDK-ARM/sideboard-hack.uvprojx --keil-target VARIANT_HOVERBOARD
archcheck <gd32f30x>   --keil-project Project/test/MDK-ARM/test.uvprojx
```

### 4.1 编译、依赖与符号

| 指标 | hoverboard（裸机） | gd32f30x（FreeRTOS） |
| --- | ---: | ---: |
| 编译单元 | 36 | 51 |
| 覆盖率（编译单元 / 磁盘源文件） | 36 / 41 | 51 / 461 |
| 本地 include 依赖 | 145 | 177 |
| include 循环组 | 1 | 1 |
| 全局变量（跨文件） | 46（11） | 61（2） |
| 函数 | 689 | 871 |
| 函数调用关系 | 381 | 696 |
| 契约绕过 | 22 | 194 |
| 仅类型 include | 0 | 7 |

gd32f30x 的覆盖率低是因为仓库里带了整套外设库示例与另一个模板工程，Keil target 只编 51 个；`coverage.byDirectory` 会如实列出被排除的目录。

### 4.2 AST 层

| 指标 | hoverboard | gd32f30x |
| --- | ---: | ---: |
| 请求成功 / 函数总数 | 689 / 689 | 871 / 871 |
| AST 层耗时 | 2.3 s | 2.9 s |
| 循环 | 55 | 242 |
| 状态机候选 | 13 | 12 |
| 变量访问 | 756 | 524 |
| 临界区 | 0 | 14 |
| 跨运行单元共享资源 | 16 | 25 |
| 冲突候选 | 0（见 4.4） | 9 |
| 整次扫描耗时 | 9.6 s | 17.0 s |

### 4.3 运行结构

| 指标 | hoverboard | gd32f30x |
| --- | ---: | ---: |
| 入口 | 2（`main`、`Reset_Handler`） | 2 |
| ISR | 13 | 10 |
| Task | 0（裸机，符合预期） | 1（见 4.4） |
| Callback | 2 | 0 |
| 运行模式 busy-poll / one-shot / unknown | 7 / 9 / 1 | 8 / 4 / 1 |
| 非常量 IRQ 使能点（未解析） | 0（0） | 1（1） |
| 未激活预处理区域：文件 / 函数 | 26 / 143 | 23 / 114 |

`gd32f30x` profile 的 `nvic_irq_enable` 规则在两个此前未见过的工程上都命中，ISR 识别不依赖单一样本。

### 4.4 已知缺陷（本轮验证发现，尚未修复）

**① 经封装层创建的任务识别不出来**

`gd32f30x` 只报出 1 个 task，而它是 FreeRTOS 内核自己的 `prvIdleTask`。应用层真正的任务经 OSAL 封装创建：

```c
OS_TaskCreate(test_task, "test_task", 256, NULL, OS_TASK_PRIO1, NULL);
    -> osal.c:68   xTaskCreate(task, name, stackSize, param, pri, ...);
                               ^ 实参是形参，规则按函数名匹配不上
```

凡是用 OSAL 层封装 RTOS API 的工程都会命中这个缺陷。修复方向是形参回溯穿透一层封装。

**② 裸机的主循环不参与冲突判定**

hoverboard 的 16 个共享资源里有 14 个是 `ISR + main`（`SysTick_Handler` 与 `main` 共享 `tick_count_ms`、`I2C0_EV_IRQHandler` 与 `main` 共享整套 `i2c_*` 状态），全部带文件行号且方向正确——但冲突候选是 0，因为判定只把 `task` / `callback` / `timer` 当作中断的对手方，`main` 不在其中。

裸机超级循环 + 中断标志位是嵌入式最普遍的竞态形态，这个缺陷影响所有裸机工程。

## 5. 当前版本使用方式

### 5.1 推荐方式：Windows 图形界面

1. 双击桌面的 `ArchCheck` 快捷方式，或项目根目录的 `启动ArchCheck.vbs`。
2. 点击“选择...”并选择 C/C++ 项目根目录。
3. 在“编译配置”中确认自动识别的 Keil 工程或编译数据库。
4. 如果是 Keil 多 Target 工程，选择要分析的 Target。
5. 确认报告输出目录。
6. 点击“开始分析”。
7. 分析完成后报告会自动打开。

如果未找到 clangd：

- 界面会明确提示语义分析不可用。
- 可以打开 LLVM 下载页面并在安装后重新检测。
- 也可以继续生成文件级低精度报告。

### 5.2 已有编译数据库

命令行保留用于自动化和持续集成：

```powershell
archcheck C:\path\to\project `
  --compile-commands C:\path\to\project\build\compile_commands.json `
  --out C:\path\to\report
```

未指定 `--compile-commands` 时，会检查：

```text
<project>/compile_commands.json
<project>/build/compile_commands.json
```

### 5.3 Keil 工程

```powershell
archcheck C:\path\to\project `
  --keil-project C:\path\to\project\application.uvprojx `
  --keil-target application `
  --out C:\path\to\report
```

只有一个 Target 时可以省略 `--keil-target`。

### 5.4 低精度源码扫描

```powershell
archcheck C:\path\to\project --source-scan
```

该模式不应被用于架构门禁，因为它缺少真实编译宏、包含路径和语义关系。

### 5.5 生成架构草案

```powershell
archcheck init-architecture C:\path\to\project `
  --compile-commands C:\path\to\compile_commands.json
```

生成的 `architecture.yaml` 状态为 `draft`，需要人工确认职责、允许依赖和状态
所有权，不能直接视为目标架构。

### 5.6 开发与测试

```powershell
python -m pip install -e .
python -m unittest discover -s tests -v
```

当前自动化测试数量为 50（`python -m pytest -q`）；`tests/test_ast_facts.py` 用一个协程
任务 + `switch` 状态机 + ISR / 任务共享变量带 `__disable_irq` 临界区的小 C fixture 真跑
clangd，`tests/test_indirection.py` 用初始化表 + 指定初始化结构体 + 形参存表 + 配置表
IRQ + 闭源声明 + `#if` 未激活区域的 fixture 覆盖 schema 4，本机没有 clangd 时自动跳过。

## 6. 当前限制

### 6.1 语义准确度

- 变量读 / 写 / 读写 / 取地址已区分（schema 3），但通过指针间接写的对象无法归属到具体
  变量（只记在指针变量上并标 `pointer-*`）；`memcpy` 等库函数对传入地址的写不区分。
- AST 层的近似：`infinite` 只认字面条件；状态机转换条件是 `if` 文本而非路径条件；
  临界区只识别同一语句序列内的成对 API（跨函数的 disable / enable、条件性保护、
  通过锁对象的保护都看不到）；`runMode` 看不到藏在被调函数里的阻塞；冲突候选基于
  可达性，不是路径证明，也不建模中断优先级抢占、协程之间的协作式互斥。
- 由宏展开产生的节点没有源码范围，其位置回退到最近有范围的祖先（宏调用处）。
- 函数指针：已识别存入结构体字段 / 数组 / 初始化表 / 注册 API 形参的函数地址，分发者按
  (结构体类型, 字段名) 或表变量匹配，不做指针别名分析；经多层拷贝、运行期计算下标或
  `memcpy` 搬运的函数指针仍然缺失。
- 非常量 IRQ 实参只追一步（形参 → 调用方常量、表字段 → 静态初始化器），运行期写表不跟踪；
  `p_this->irq` 这类形参字段记入 `enableSites` 但不解析。
- `externalSymbols.library` 是目录推断（声明头所在目录里的 `*.lib` / `*.a`），不读链接脚本。
- `inactiveFunctions` 来自未激活区域的文本扫描，宏生成的定义和 K&R 风格可能漏掉。
- 任务注册只覆盖当前已实现的 FreeRTOS API 模式。
- 同名静态函数和复杂条件编译可能造成无法消歧的关系。
- 当前调用图表示静态可能关系，不表示运行次数、时序或实时执行路径。
- Doxygen 当前读取函数定义前的相邻注释，尚未合并头文件声明文档。

### 6.2 编译配置

- Keil 当前优先读取 Target 级宏和包含目录；器件宏取自 CMSIS Pack，编译器系统头
  取自本机 Keil 安装（可用 `--keil-toolchain-include` 覆盖），二者缺失时只告警。
- Group 级、File 级局部编译覆盖尚未完整建模。
- Keil、GCC 或其他编译器私有扩展可能无法被 clangd 完整解析；armcc 关键字与免头文件
  内建函数已有 clang 兼容映射，但 `__asm { }` 块语法等仍不支持。
- 一次报告只对应一个具体 Target 和一套编译宏，不代表所有产品变体。

### 6.3 架构判断

- 没有 `architecture.yaml` 时，模块候选主要来自文件路径，不代表人工确认的职责。
- 风险分数是可复算的启发式指标，不等同于代码质量结论。
- 当前只报告事实和热点，还没有完整实施允许/禁止依赖规则。
- 当前 include 循环检测不包含函数递归和运行时事件闭环。

### 6.4 产品化

- 当前 GUI 是本地 Python/Tkinter 应用，还不是独立安装包。
- clangd 安装入口目前打开下载页面，还没有内置安装与版本管理。
- 报告是单机 HTML，还没有工程历史、多人协作或集中服务。

## 7. 待办与优先级

### P0：提高代码事实准确度

- [x] 区分变量读取、写入、读写和取地址操作（0.3.0，AST 层）
- [ ] 跨函数 / 跨路径的保护证明：CFG + Lockset，替代 same-block 临界区近似
- [x] 识别函数指针赋值、回调注册和间接调用目标（0.4.0：字段 / 表 / 形参存储 + 按类型字段匹配分发者；指针别名分析未做）
- [ ] 扩展 RTOS 任务、定时器、事件回调和中断入口识别
- [ ] 提取函数参数、返回值与跨模块数据传递关系
- [ ] 识别公开接口、文件内部函数和疑似越界调用
- [ ] 为每条关系记录来源和可信度，例如 clangd、源码补偿、配置声明
- [ ] 检测无入口函数、不可达函数和疑似孤立代码
- [ ] 建模多个 Target 和条件编译变体之间的差异
- [ ] 合并头文件声明与源文件定义上的 Doxygen 文档

P0 完成后，Archcheck 才能更可靠地回答“谁修改了状态”和“节点之间传递了什么”。

### P1：目标架构与门禁

- [ ] 在 GUI 中创建和编辑 `architecture.yaml`
- [ ] 人工确认文件和函数的架构节点归属
- [ ] 定义模块职责和公开 API
- [ ] 定义 `may_depend_on` 和禁止依赖
- [ ] 定义全局状态所有者和允许写入者
- [ ] 对比实际依赖与目标架构
- [ ] 报告跨层调用、私有接口泄漏和非法状态访问
- [ ] 建立遗留违规基线，只阻止新增违规
- [ ] 提供 CI 退出码和机器可读违规结果

P1 是从“架构观察工具”进入“架构锁定工具”的关键阶段。

### P2：重构工作台

- [ ] 当前架构与目标架构对比视图
- [ ] 将违规关系拆成可执行重构任务
- [ ] 追踪每次提交造成的架构变化
- [ ] 评估移动函数、拆文件和提取接口的影响范围
- [ ] 为循环依赖提供接口提取或依赖倒置候选点
- [ ] 保存重构前后指标和关系变化

### P3：面向 Agent 的架构开发

- [ ] 为每个架构节点生成 Agent 上下文包
- [ ] 上下文包包含职责、公开接口、允许依赖、状态所有权、测试和当前违规
- [ ] 限制子 Agent 可修改的目录、文件和接口范围
- [ ] Agent 提交前自动运行架构门禁
- [ ] 跨节点改动要求显式契约变更
- [ ] 将架构规则、测试和历史决策一起交给 Agent

### P4：产品化与分发

- [ ] 构建无 Python 前置要求的 Windows 安装包
- [ ] 内置 clangd 检测、版本信息和安装引导
- [ ] 支持更多 Keil Group/File 级配置
- [ ] 支持更多构建系统和编译数据库导入方式
- [ ] 保存历史扫描并提供趋势对比
- [ ] 大型工程增量扫描和缓存

## 8. 建议的下一开发里程碑

建议下一个里程碑聚焦 P0，不继续扩展装饰性可视化：

```text
变量访问分类
  + 函数指针/回调关系
  + 函数参数和返回值事实
  + 公开接口识别
```

建议验收标准：

1. 全局变量详情能区分读、写和取地址位置。
2. 常见回调注册和 RTOS 入口能显示注册者与实际入口。
3. 函数节点能显示参数和返回类型，并形成初步的数据传递边。
4. 跨文件调用能判断目标是公开声明还是内部实现。
5. 每条新增关系都带来源，无法确认的关系明确标记为不确定。

完成该里程碑后，再进入 `architecture.yaml` 目标架构编辑和违规检测，工程路线会更
稳健。

## 9. 项目主要代码结构

```text
src/archcheck/
  analyzer.py              扫描流程和基础结果组装
  compile_commands.py      编译数据库读取与路径本地化
  keil.py                  Keil uvprojx 适配
  dependency.py            include 依赖与循环检测
  file_metrics.py          文件指标与风险分数
  semantic.py              clangd、调用、变量和 Doxygen 语义事实
  ast_facts.py             textDocument/ast 抽取：循环、switch 状态机、读写分类、临界区、
                           函数指针存储 / 初始化表 / 间接调用 / 实参形状
  concurrency.py           推导：运行模式、跨运行单元共享变量、冲突候选
  indirection.py           推导：经数据注册的回调与分发者、非常量 IRQ 实参、未激活区域函数扫描
  runtime_units.py         向量表、运行单元与可达性
  framework_rules.py       注册 / ISR 使能 / 阻塞 / 临界区规则表
  architecture_config.py   architecture.yaml 草案与加载
  model.py                 结构化事实模型
  report.py                JSON、Markdown、HTML 报告输出
  gui.py                   Windows 图形界面
  templates/report.html    单文件交互式报告
tests/                     自动化测试
```

## 10. 核心原则

后续开发应继续遵守以下原则：

1. 事实优先。AI 可以解释结果，但不能替代静态事实来源。
2. 不确定性可见。无法可靠解析的动态关系必须明确标注。
3. 架构由人确认。目录推断只能生成草案，不能自动成为目标架构。
4. 规则可复算。风险、违规和门禁结果必须能由本地工具重复得到。
5. 遗留工程渐进治理。允许建立现有违规基线，但禁止无意识增加新违规。
6. Agent 服从架构。Agent 只能在明确节点、契约和验证范围内实施代码变更。
