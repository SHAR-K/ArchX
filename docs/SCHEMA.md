# architecture.json 字段契约

> 从 README 拆出。每个小节标注引入该字段的版本；近似性声明见各节正文与
> `astFacts.approximations`。schema 有不兼容变化时升 `schemaVersion`。

## dependencyOrder.units：源文件 + 同名头 = 一个单元（0.15.0）

include 边永远指向头文件，调用边永远指向定义被调函数的源文件。文件级矩阵里 `A.c → B.h` 和 `A.c → B.c` 因此是两个
格子：前者永远"只 include 没调用"，后者永远"有调用没 include"，颜色分类失去意义；更糟的是 `A.c include B.h` +
`B.c include A.h` 在文件图上**不成环**（四个节点），A 与 B 的互相依赖被拆分藏掉了。

| 字段 | 内容 |
| --- | --- |
| `units.unitOf` | 文件 → 单元。同目录、同主名的源文件与头文件合成一个单元（`app/led.c` + `app/led.h` → `app/led`）；没有搭档的文件（纯头、孤立源）自己是一个单元。只认同目录同主名，`xxx_priv.h`、`inc/` 与 `src/` 分目录的约定不合并 |
| `units.members` | 单元 → 成员文件 |
| `units.order / level / steps / feedback / edges` | 和 `files` 同一套算法在单元图上跑一遍：边聚合了成员文件之间的八个量，单元内部（`A.c → A.h`）不成边 |

`sequence()` 撕开时的平局现在按**权重**决定：出度−入度相同时，比（出权 − 入权），权重 = 边上八个量之和；再平按名字。
之前纯按条数，被调用几百次的目录和只被点了一下的分不出高低，平手时字母序把 `components/` 撕到了最上面。每一步的
`weight` 也记在 `steps` 里。

## dataDependencies / pollingOrder：单元间的数据依赖与轮次（0.14.0）

共享变量是一条通道：写它的单元在上游，读它的单元在下游。这条边没有 include、没有调用，却是两个任务之间真正的
耦合——B 的行为取决于 A 存了什么。协作式调度里**轮询顺序**决定读方什么时候看到值：写方排在读方前面，值当轮就到；
排在后面，读方下一轮才拿到。任何一侧是中断，交换就是异步的，与轮询顺序无关。

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `pollingOrder[]` | 推导 | 任务单元 id 的顺序：从 `main` 深度优先走调用图，调用与任务注册按**调用行**排序，遇到注册就记——和调度器建表的顺序一致。走不到的任务不在里面 |
| `dataDependencies[]` | 推导 | 每个 `sharedResources` 条目上，每一对 (写方单元, 读方单元)：`{resource, name, variable, from, to, fromKind, toKind, order, fromPosition, toPosition, writes, reads, volatile, atomicity, derived, basis}`。`order`：`same-round` 写方轮询位置在读方之前 / `next-round` 之后（一轮延迟）/ `async` 任一侧是中断 / `preemptive` 抢占式内核没有轮 / `main` 任一侧是 main 上下文 / `unknown-order` 任务没被从 main 走到或调度模型未知。回调、定时器按它唯一的宿主单元算；同一个执行上下文里的写和读（任务与它自己调的回调）不成边。`derived` = 任一侧有一步指针形参推导出来的访问 |
| `dependencyOrder.*.edges[].reads` / `.writes` | 推导 | 文件 → 定义该变量的文件：读 / 写了对方定义的文件级变量的访问次数（`address_taken` 不算）。矩阵上的第七、八个量 |

`basis` 每条都带：轮询顺序是怎么来的、同轮怎么判。它们是分类不是判断——跨轮不等于错，只是读方拿到的是上一轮的值。

## resourceAccesses.derived：一步指针形参归属（0.13.0）

`ring_buf_write(&s_usart_tx, …)` 这一行，AST 只能看到"取了 `s_usart_tx` 的地址"（`address_taken`）；真正的写在
`ring_buf_write` 体内，写的是形参 `rb->…`，和任何全局都不沾边。于是环形缓冲、句柄、协议上下文这类**经指针传进
去再写**的变量，在并发分析里是隐形的。0.13.0 把这一步补上：

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `resourceAccesses[].derived` | 推导 | 调用方 `f` 在 `g(&x)`（或数组退化 `g(buf)`）那一行对 `x` 的读 / 写，条件是 `g` 体内经那个形参指针读 / 写过（`via` 以 `pointer-` 开头的形参访问）。记录 `via: "by-callee"` 与 `{callee, calleeName, param, paramName, calleeAccess, calleeVia, basis: "pointer-param-one-step"}`；`calleeAccess` 指到 `g` 体内那一行。原来那条 `address_taken` 照旧保留 |

只走**一步**：`g` 再把指针传给 `h`、存进结构体、或经别名写，都不跟；形参只按位置配对；把指针变量（不是数组、不是取地址）
传进去的不算——那是指针值的读，不是它指向的对象。这些推导出来的访问和 AST 直接读到的一样进 `sharedResources` /
`conflictCandidates`，`derived` 非空就是标注。

## macroUses：宏依赖（0.12.0）

第四种依赖：**我的代码有一部分是你写的**——`SYSTICK_PERIOD_MS` 的值、`thread_begin` 的展开体，都是预处理器
从别的文件粘进我这个编译单元的文本。配置头（`config.h`、`*_conf.h`）几乎只以这种方式被依赖，没有这个事实它们
看起来像谁都不碰的叶子。

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `macroUses[]` | 事实 + 推导 | 每个编译单元用到的每个宏名，按 (文件, 宏) 去重计数：`{file, macro, count, location, definedIn, resolution, definitions}`。用法来自 clangd 的语义 token（类别 `macro`）——编译器自己对"这个标识符在这个 TU 里是宏"的记录，条件编译之后的；定义来自全工程每个文件的 `#define` 行。`resolution`：`project`（工程里恰有一处 `#define`，或多处时 clangd `definition` 选定了一处）/ `ambiguous`（多处、clangd 没答）/ `external`（工程里没有 `#define`：系统头、命令行 `-D`、编译器内建）。`definitions` 是工程里该名字的 `#define` 处数 |
| `dependencyOrder.*.edges[].macros` | 推导 | 这条边上有多少个 (文件, 宏) 用了对方定义的宏。只有 `macros` 没有 `includes` 的边同样是靠传递 include 拿到的隐式依赖 |

只对编译单元（`.c`）问语义 token；头文件里的宏用法（`#if` 条件、inline 函数体）不单独记，它们随包含它的编译单元出现。
`#define NAME` 那一行上的 NAME 是定义不是用法，不记。

## typeUses：类型依赖（0.11.0）

include 说的是"我声明了要用你"，调用说的是"我用了你的函数"；还有第三种依赖藏在两者之下：**我拿着你定义的
数据结构**。一个 `.c` 没 include 某个头、也没调它的函数，却在读写它定义的结构体字段，仍然依赖它——改那个
结构体它就得重编、可能就坏。`typeUses` 把这层依赖单独拿出来，并作为 `dependencyOrder` 边上的第五个量 `types`。

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `typeUses[]` | 事实 + 推导 | 每个函数用到的每个**具名类型**（结构体 / 联合 / 枚举 / typedef），按 (类型, 用法) 去重计数：`{function, type, role, pointer, asWritten, count, location, definedIn, resolution}`。`role`：`param` 形参 / `return` 返回类型 / `local` 局部变量类型 / `global` 触到的文件级变量的类型 / `member` 读写字段时的所属结构体 / `cast` 强制转换的目标类型。`definedIn` 是定义该类型的文件与行（工程内给相对路径）；`resolution`：`project` / `external`（SDK、libc）/ `unresolved` |
| `dependencyOrder.*.edges[].types` | 推导 | 这条边（文件 → 文件，目录 → 目录）上有多少个 (函数, 类型, 用法) 用了对方定义的类型。**只有 `types` 没有 `includes` 的边**就是靠传递 include 拿到的隐式类型依赖 |

内建标量（`int`、`uint32_t`、`size_t`…）不记——依赖 `int` 不是架构事实；匿名与函数指针类型没有名字可依赖，也不记。
类型定义位置先在已缓存的 documentSymbol 树里按名找（kind 5 / 10 / 23），找不到问一次 `textDocument/typeDefinition`
（数组类型的用法 clangd 不答，typedef 到匿名结构体的返回类型也不答），最后对仍未解析的名字各问一次 `workspace/symbol`。

## dependencyOrder：只看图的依赖顺序（0.10.0）

分层是人定的，工具定不出"驱动层"；工具能定的是**顺序**。`dependencyOrder` 以源文件所在**目录**为节点，
include 边与调用边合成一张图，强连通分量缩点后按最长路径给深度：0 = 不依赖工程内任何目录，n = 依赖了
深度 n−1 的东西。架构良好时它应该是一张干净的往下流的图。

| 字段 | 内容 |
| --- | --- |
| `nodes[]` | `{id: 目录, files, depth, scc}`，按深度从高到低排；`scc` 非空表示它在一个循环组里 |
| `edges[]` | `{source, target, includes, calls, bypassCalls, typeOnlyIncludes, types, macros, reads, writes, inCycle, span}`——同一条边上八个量（`types` 见 typeUses，`macros` 见 macroUses，`reads` / `writes` 见 dataDependencies）：include（头文件声明的依赖）、调用（实际使用）、绕过（有调用没 include 路径，契约为空）、仅类型（include 了但一个函数都没调）；`span` 是两端深度差 |
| `sccs[]` | 循环组：`{id, nodes, edges, depth}`，只列成员多于一个的 |
| `maxDepth` | 最大深度 |

不做的：不给层命名，不判"跳层"（那要先有人规定中间必须经过谁），不把目录合成模块（模块划分是消费方的投影）。

## sharedResources 的收录门槛（0.9.1）

`sharedResources[]` 收两类变量：**≥ 2 个执行单元可达**（并发口径，`units` 多于一个），**或 ≥ 2 个源文件访问**
（耦合口径：跨文件用的文件级变量是隐式接口，哪怕只有一个任务跑到，此时 `units` 只有一个）。单单元、单文件的
不收。`conflictCandidates` 只从多单元的那类里出。

## taskControls / yieldLocals：调度状态与无栈协程的固有缺陷（0.9.0）

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `taskControls[]` | 事实 + 推导 | 每一次挂起 / 恢复 / 结束 / 重启任务的调用：`{function, location, callee, kind, rule, argument, target, targetUnit, selfTarget}`。名字全部来自 profile 的 `task_control`。**为什么重要**：`thread_run` 只在 `status < THREAD_EXITED` 时调用任务，而 `THREAD_SUSPENDED > THREAD_EXITED`，所以被挂起的任务整个从轮询里消失——"每个注册任务每圈都跑"对它不成立。实参是普通函数名时解析到具体任务（`target` / `targetUnit`），不带实参的形式（`PT_EXIT`）标 `selfTarget` 并归给调用者自己的任务 |
| `yieldLocals[]` | 推导 | 让出前写、让出后读、中间没有再写的**非 static 局部**：`{function, variable, declaredAt, writtenAt, yieldedAt, readAt, callee}`。无栈协程的让出就是 `return`，栈上的局部下次进来已经不是原来的值（实现自己把 `dly` 声明成 `static` 正是为此）。只查任务入口函数——让出宏需要任务自己的 `pt`，写在被调函数里不会让出；也只在 `scheduling: cooperative` 时才推 |

限制：`yieldLocals` 是**行序近似**不是 CFG——写 / 让出 / 读三者按源码行号比较；取过地址的局部跳过（写可能经指针发生）；让出与读之间只要有任何一处写就不报。

## imageFacts：链接产物证据源（0.8.0）

尺寸这一类数字**不可能**从源码推出来：结构体的实际占用取决于目标的布局规则，一个对象落在
哪个段取决于链接器怎么处理它，而代码尺寸在 AST 层根本不存在。这些数字精确地存在于链接器
已经写好的 map 文件里，所以引擎把它当成**另一个证据源**读进来，和 AST 事实分开标注。

`--image-map <path>` 指定产物；不给则在 Keil 工程目录与工程根下找最新的一个 armlink map
（`Image Symbol Table` / `Image component sizes` 为判据）。`--no-image` 完全不读。

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `imageFacts.artifact` | 事实 | `{path, kind: "armlink-map", sha1, modified, sizeBytes}`。消费方**必须**显示它：尺寸的可信度等于产物的新鲜度 |
| `imageFacts.totals` | 事实 | `romBytes` / `roBytes` / `ramBytes`（map 自己的 Total 行）、`codeBytes`、`objectRomBytes` / `objectRamBytes`（只算非库目标文件） |
| `imageFacts.objects[]` | 事实 + 推导 | 每个目标文件的 `codeBytes` / `roDataBytes` / `rwDataBytes` / `ziDataBytes`（来自 Image component sizes），`romBytes = Code + RO + RW`、`ramBytes = RW + ZI`；`sourcePath` 是**推导**——按这个目标文件定义了哪些函数名反查 AST 里的定义文件（`match: "functions"`，`matchEvidence` 给出用到的函数名）。纯数据 / 汇编目标文件退回基名匹配（`match: "basename"`），基名不唯一时不归属 |
| `imageFacts.symbols[]` | 事实 + 推导 | `{name, kind, sizeBytes, address, object, section, scope, sourcePath, symbolId}`。`kind`：`code`（Thumb / ARM Code）、`data`、`ro-data`（`.constdata` / `.conststring` / `.rodata`）、`zero-init`（`.bss`）。`symbolId` 是**推导**：按 (归属源文件, 名字) 连到 `variables` / `functions`；函数内 `static` 不连（armlink 会改名） |
| `imageFacts.staleness` | 事实 | `sourcesNewerThanImage`（分析过的源文件里晚于产物的个数）、`functionsInlinedOrDiscarded`（源文件有目标文件但函数不在镜像里 = 被内联或被 `--gc-sections` 丢弃）、`filesNotInImage`（源文件根本没有目标文件 = 没参与编译）、`objectsUnmatched` |

明确不做：**不**把分频 / 重载之类的原始值换算成频率，也**不**从产物反推架构——模块划分永远
来自源码结构，产物里没有模块这个概念。函数级代码尺寸会因内联偏小（被内联的代码计入调用方
所在目标文件），这一条写在 `approximations` 里。

## architecture.json schema 4：间接层字段

`schemaVersion` 从 3 升到 4。所有 schema 3 字段保持不变；唯一需要消费方注意的变化是
`semantic_edges[]` 里 `relation: "calls"` 的 `target` 现在可能是 `external:<name>`（被调函数只有
声明、没有进入编译数据库的定义），这类 id 不在 `functions` 里，对应条目在 `externalSymbols`。

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `executionUnits[]`（kind = callback / task）新增 `form` / `slot` / `dispatchers` / `storedAt` / `evidence` | 事实 + 推导 | `form`：`struct-field-assign`（`cfg.handler = fn`）、`pointer-assign`（`table[i] = fn`）、`init-table`（`{CMD_A, handle_a}` 或 `.callback = fn`，`registeredAt.functionId` 为 `variable:` id 时表示文件级初始化表）、`param-store`（注册 API 把形参存进字段 / 数组，调用方传函数名，`storedAt` 是存入位置）。`slot` = `{variable, type, field, path}` 说明指针放在哪里；`dispatchers` 是通过同一 (结构体类型, 字段) 或同一表变量间接调用的函数（按类型 + 字段名匹配，不做指针分析）。`ast.*` 规则产生的单元置信度 medium（仅按字段名匹配到分发者时 low）；框架规则单元若被 `param-store` 与分发者佐证则升为 high（`evidence.upgraded`）。`registers_callback` 边带 `rule: "ast.<form>"`；初始化表 / 赋值里的函数名同时产出 `address_of` 边，因此 clangd 把这些引用误报的 `calls` 会被剔除 |
| `executionUnits[kind=isr].enabledAt[]` 新增 `confidence` / `evidence` | 推导 | 使能实参非常量时的一步数据流：`evidence.via = "static-initializer"`（形如 `s_cfg[id].nvic_irq`，从该表变量的静态初始化器按结构体字段布局取出所有行的 `*_IRQn` 枚举，`table` / `tableLocation` / `field` / `rows`）或 `"parameter"`（实参是形参，追到调用方传入的常量，最多两层，`callers`）。直接常量实参的条目没有这两个字段 |
| `enableSites[]` | 事实 + 推导 | 每个非常量实参的 ISR 使能点：`function`、`location`、`callee`、`argumentExpr`、`rule`、`resolvedTo[]`（handler symbolId）；解析不出时 `reason`（`param-field-argument`、`table-without-static-initializer`、`struct-layout-unresolved`、`parameter-without-constant-caller` …），这样使能点仍可见 |
| `externalSymbols[]` | 事实 | `{symbolId: "external:<name>", name, kind, declaredIn[], library, libraryCandidates[], callers[]}`；`library` 取声明头文件所在目录下版本号最高的 `*.lib` / `*.a`，多个版本并存时全部列在 `libraryCandidates`。`reachability` 不把它们算未触达，`functions` 不混入 |
| `coverage.byDirectory` | 事实 | 每个目录前缀（所有深度，含子目录累计）的 `sourceFilesOnDisk` / `filesAnalyzed` / `excluded`（excluded 只含磁盘上存在但未进编译数据库的文件）。分区投影用 `archcheck.analyzer.coverage_for_focus(coverage, ["src/app/**"])` 得到自己口径的 `sourceFilesOnDisk` / `filesAnalyzed` / `excluded` / `ratio`；整仓 `coverage` 其余字段不变 |
| `inactiveRegions[]` | 事实 | clangd `textDocument/inactiveRegions` 推送的未激活预处理区域，按打开过的文件：`path`、`kind`（translation-unit / header）、`regions[]`（1 起始闭区间行号）、`inactiveLines`、`totalLines`、`ratio`。没有未激活区域的 TU 也列出（`regions: []`），表示已测量 |
| `inactiveFunctions[]` | 近似 | 对未激活区域做文本扫描找到的 `type name(...) {` 定义：`name`、`path`、`line`、`region`、`approximation: "text-scan-in-inactive-region"`。它们不在 `functions` 里（预处理已删掉），也没有 AST 事实 |
| `functions[].compileBranch` | 说明 | 保留：它是函数所在位置的 `#if` 条件栈文本（关于源码文本的事实）。函数能出现在 `functions` 里本身就证明该分支在当前宏组合下激活；未激活代码见 `inactiveRegions` / `inactiveFunctions`。clangd 不提供条件文本，故没有"真实条件"可替换它 |
| `astFacts` 新增 | 元数据 | `initializersRequested` / `initializersAnalyzed`（请求过 AST 的文件级聚合初始化器）、`structLayoutsResolved` / `structLayoutsFailed`（`typeDefinition` + 头文件 `documentSymbol` 解析出的结构体字段布局）、`inactiveRegionFiles`；`approximations` 增加对应说明 |

限制：分发者按 (结构体类型, 字段名) 或表变量匹配，不跟踪指针拷贝；`param-store` 只看
一层（注册 API 直接存形参）；IRQ 实参只追一步且只读静态初始化器，运行期写表不跟踪；
`inactiveFunctions` 是文本扫描，宏生成或 K&R 风格定义可能漏掉；`library` 是目录推断，
不读链接脚本或 `.uvprojx` 的库文件列表。

## architecture.json schema 3：AST 层字段

`schemaVersion` 从 2 升到 3；所有旧字段保持不变，新增字段全部是增量。事实（直接从
AST 读出）与推导（带 `confidence` / `evidence`）分开存放，近似的地方在 JSON 里用
`approximation` 字段自述，汇总说明见 `astFacts.approximations`。

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `loops[]` | 事实 | 每个函数的循环：`function`、`kind`（while/for/do/goto）、`location`、`endLine`、`infinite`（条件为字面非零、`for(;;)`；无法判断为 `null`）、`depth`、`callsInBody`（已解析为 symbolId 的被调函数）、`blockingCalls[]`（`callee`、`rule`、`kind`=delay/wait/yield、`via`=ast/text）。`goto` 回跳记 `unrecognized: true`；来自宏展开的循环记 `fromMacro: true`；`do { } while (0)` 语句宏不计入 |
| `executionUnits[].runMode` / `runModes[]` | 推导 | `mode`：`periodic`（无限循环 + delay 类阻塞）、`event-driven`（+ wait 类阻塞）、`busy-poll`（无限循环无阻塞，只 yield 也算）、`one-shot`（无无限循环）、`unknown`；`evidence` 给出循环位置、阻塞调用与行号，入口函数没有无限循环时沿 `calls` 最多下钻 3 层（`viaCallees`）；`runModes[]` 额外覆盖 `main` 等入口 |
| `stateMachines[]` | 事实 + 近似 | 每条 `switch`：`dispatch`（DeclRef 或 `a.b` / `p->c` / `x[]` 路径）、`dispatchVariable`、`dispatchScope`（global/local/param）、`dispatchType`、`enumType`、`states[]`（case 标签，`value` 来自 clangd hover）、`hasDefault`、`transitions[]`（`from` = 所在 case 标签列表，`to`，`condition` = 包围的 `if` 条件文本，`via` = assignment / `call:<fn>`（把枚举常量传给会写分派变量的函数）/ outside-switch）、`writersElsewhere`、`confidence`。分派变量不是枚举时仍记录但降级；只有整数标签且分派对象是参数 / 局部变量的纯分发表不输出 |
| `resourceAccesses[]` | 事实 | 函数 × 文件级变量（`static` 与全局；局部变量、形参不出现）× `kind`（read / write / read_write / address_taken）× `location`。经成员 / 下标形成的左值记 `via`：`field`、`index`、`field+index`（由变量向外的路径）、`pointer-field` / `pointer-index` / `pointer-deref`（通过指针间接访问，写的是指向对象而非变量本身）、`array-decay`（数组退化为指针传出）。位于识别出的临界区内标 `inCriticalSection: true`。定义不在编译数据库内的变量 `variable` 为 `null`，仍按 `name` 参与汇总 |
| `criticalSections[]` | 事实 + 近似 | `function`、`begin`、`end`、`api`、`endApi`、`rule`、`kind`（irq/scheduler/mutex）、`accessesInside[]`、`unterminated`、`approximation: "same-block-sequence"`：只识别同一复合语句序列内成对出现的 begin / end API，跨函数、跨分支的保护看不到 |
| `controlFlow[]` | 事实 + 近似 | `function`、`kind`（if/else/switch/case/default/while/for/do）、`location`、`endLine`、`condition`（if/while/switch 的条件文本；for/do 取语句首行）、`labels`（case 标签）、`depth`、`parent`（同函数列表内父块下标）。语句骨架：调用、访问、阻塞点都带行号，与这些区间求交即可知道它们落在哪个分支 / 循环 / case 里。宏展开、无 range 的语句缺失；case 体到下一个标签为止，不建模 fall-through。`stateMachines[].states[].endLine` 同源，给"某状态下的一轮迭代"切片用（0.4.1） |
| `wakeRelations[]` · `runModes[].periodMs` | 推导 | `wakeRelations`：中断上下文写、任务 / 回调在 `if / while / do` 条件里读的**标量**变量（结构体字段、数组元素不算）→ `flag-poll` 通知关系候选，对应的 `conflictCandidates` 加 `role: notification-flag`；`periodMs`：`delay` 规则的 `duration_argument` 字面值（或经 hover 解析的宏 / 常量）× 单位（`tick` 用 `tick_ms`，默认 1，规则文件可覆盖），非字面且解析不到就是 null 并在 `evidence.period.reason` 说明（0.4.3） |
| `sharedResources[]` | 推导 | 被 ≥ 2 个运行单元根（isr / task / callback / main …）触达的变量：每个单元的 `kinds`、`unprotectedKinds` 与访问明细；`volatile` 取自声明 |
| `conflictCandidates[]` | 推导 | 中断侧有写且任务 / 回调侧有临界区外访问（或反向）的变量：`isrSide`、`otherSide`、`pattern`、`confidence`（high：双侧都写；medium：一写一读；low：只经指针 / 取地址或低置信回调）、`reason`；带 `approximation` 声明——基于可达性与 same-block 临界区，不是路径证明，没有候选也不是安全证明 |
| `astFacts` | 元数据 | 请求 / 成功 / 失败的函数数、AST 层耗时、跳过的 `do-while(0)` 与纯分发 `switch` 数、解析出的枚举值数、`approximations` |

阻塞 API 与临界区 API 全部来自 `framework_rules.py` 的规则表，内置 protothreads
（`thread_sleep`、`thread_wait*`、`thread_yield`、`PT_WAIT*`、`PT_YIELD*`）、FreeRTOS
（`vTaskDelay*`、`xQueueReceive`、`xSemaphoreTake`、`ulTaskNotifyTake` …）、通用
（`delay_ms`、`HAL_Delay`、`osDelay`）以及 `__disable_irq/__enable_irq`、
`taskENTER_CRITICAL/taskEXIT_CRITICAL`、`portDISABLE_INTERRUPTS/portENABLE_INTERRUPTS`、
`NVIC_DisableIRQ/NVIC_EnableIRQ`、`nvic_irq_disable/nvic_irq_enable` 等成对 API。项目可在
`architecture.yaml` 的 `framework_rules:` 或 `framework_rules.yaml` 中追加：

```yaml
framework_rules:
  blocking:
    - function: board_wait_event   # 支持 glob
      kind: wait                    # delay | wait | yield
  critical_section:
    - begin: lock_take
      end: lock_give
      kind: mutex                   # irq | scheduler | mutex
      match_argument: true          # 要求首个实参文本一致
```

