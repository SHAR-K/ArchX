import crypto$1 from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
//#endregion
//#region packages/facts-view/src/i18n.mjs
var catalogs = { "zh-CN": {
	"(depends on {out}, depended on by {in}{weight}) → moved to the top": "（依赖 {out} 个、被 {in} 个依赖{weight}）→ 放到块顶",
	"(root-level files)": "(根目录文件)",
	"A do-while expanded from a macro such as protothreads — not a hand-written loop; handled by the macro semantics": "protothreads 这类宏展开出来的 do-while，不是人写的循环，按宏语义处理",
	"A partition with id {id} already exists": "架构分区 ID 已存在：{id}",
	"A while(1) inside a callee: once entered it never returns, so the calling step never ends": "被调函数里的 while(1)：一旦进入就不回来，调用它的那一步不会结束",
	"About {perItem} bytes each; keep limit within {limit}, or use path to drill into just the fields you need": "平均一条 {perItem} 字节，limit 取 {limit} 以内；或者用 path 往里钻，只取需要的字段",
	"All dagre rankers failed on this machine; using a simple layout: rows by depth, back edges routed to the right": "dagre 的三种排序器在这台机器上都失败了，改用按深度分行、回退边往右绕的简单布局",
	"All loops": "全部循环",
	"Also unfold iteration loops": "连遍历循环一起展开",
	"An ordinary counted or iterating loop; for timing it only means repeat a few times": "普通计数或遍历循环，对时序只表示重复若干次",
	"Analysis scope": "分析范围",
	"Analyze this folder": "分析这个目录",
	"ArchCheck exited with status {code}": "ArchCheck 退出，状态码 {code}",
	"ArchCheck is re-checking {name}": "ArchCheck 正在复检 {name}",
	"ArchCheck is scanning {name}": "ArchCheck 正在扫描 {name}",
	"ArchCheck output is not valid JSON": "ArchCheck 输出不是有效 JSON",
	"ArchCheck projected {name}: {n} related files": "ArchCheck 已投影 {name}：{n} 个相关文件",
	"ArchX Code Facts": "ArchX 代码事实",
	"ArchX initialized; only project.json under the project was written": "ArchX 已初始化，只写入项目下的 project.json",
	"ArchX is not initialized in this workspace": "当前工作区尚未初始化 ArchX",
	"Ask the agent to scan this repository, or run the command ArchX: Scan Partition.": "跟 Agent 说扫描这个仓库，或者运行命令 ArchX: 扫描架构分区。",
	"Back edge (click for details)": "反向边（点击看明细）",
	Basis: "依据",
	"Between interrupts": "中断之间",
	"Between threads": "线程之间",
	"Both interrupt and thread write": "中断和线程都写",
	"Build information": "构建信息",
	"Building whole-repository facts and projecting the current partition": "建立全仓事实并投影当前分区",
	"Busy-wait": "忙等",
	"By RAM": "按 RAM",
	"By ROM": "按 ROM",
	Bytes: "字节",
	Calls: "调用",
	"Cannot open {target}": "打不开 {target}",
	"Caused by which file pairs (top 4, by include + calls)": "由哪些文件对造成（前 4，按 include+调用）",
	"Chains to entries": "到入口的链",
	"Checking architecture rules in an isolated worktree": "在隔离 worktree 中检查架构规则",
	"Choose the Keil project for scanning {name}": "选择用于扫描 {name} 的 Keil 工程",
	"Choose the Keil target": "选择 Keil Target",
	"Choose the architecture partition to analyze": "选择要分析的架构分区",
	"Choose the partition folder": "选择架构分区目录",
	Class: "分类",
	Clear: "清空",
	"Click a cell to see what makes up the edge; Alt+click to mark a planned inversion. Click a row or column header to select; click a group name in the column header to collapse. ▶ at the top-left replays the top-level ordering; ▶ on the bar left of a block replays that block.": "点一个格子看这条边由什么构成，Alt+点标记打算反转。点行头或列头选中，列头点组名折叠。左上角 ▶ 回放顶层排序，块左边的竖条上 ▶ 回放块内排序。",
	"Click a state to see its guards and the condition of each transition.": "点一个状态，看它的守卫和每条转换的条件。",
	"Click again to collapse": "再点一次收起",
	"Click an object on the stage; its details show here": "点舞台上的对象，这里显示它的明细",
	Cluster: "聚簇",
	"Code-facts derivation failed": "代码事实派生失败",
	Collapse: "折回",
	"Column {name} has no cells among the remaining elements of the block (nobody depends on it) → moved to the top": "{name} 这一列在块里剩下的元素中没有格子（没人依赖它）→ 放到块顶",
	Concurrency: "并发",
	Condition: "条件",
	Continue: "继续",
	"Cooperative: a task runs until it yields; tasks do not preempt each other, only interrupts cut in": "协作式：任务跑到自己让出为止，之间不抢占，只有中断插进来",
	"Copied {id}": "已复制 {id}",
	"Copy reference": "复制引用",
	"Copy the stable reference; it can be handed straight to the agent": "复制稳定引用，可以直接丢给 Agent",
	"Copy this loop's reference": "复制这个循环的引用",
	Count: "次数",
	"Create an architecture partition": "创建架构分区",
	"Create an architecture partition first": "请先创建架构分区",
	"Critical sections": "临界区",
	"Cut set": "切割集",
	"Cut these edges and what remains is a DAG": "剪掉这些边，剩下的就是 DAG",
	"Data dependencies (between execution units)": "数据依赖（执行单元之间）",
	"Data symbols": "数据符号",
	Declarations: "声明",
	"Deeper loops are not drawn: at most {n} levels": "还有更深的循环没画：最多展开 {n} 层",
	"Defined at": "定义处",
	Dependencies: "依赖",
	"Derivation failed": "派生失败",
	"Direct calls (in region)": "直接调用（区域内）",
	Directory: "目录",
	"Dispatch only, no transitions": "只有分发，没有转换",
	"Dispatch tables": "分发表",
	"Enter to trace": "回车倒推",
	"Entries, execution units and reachability come from the engine; the scheduling hop is inferred from framework rules and marked as such": "入口、执行单元、可达性来自引擎；调度那一跳是框架规则的推导，界面上标出来",
	"Enum overview": "枚举一览",
	"Evidence for this edge: call sites, whether it crosses modules, whether it bypasses the header": "这条边的证据：调用点、跨不跨模块、有没有绕过头文件",
	Execution: "执行关系",
	Exit: "退出",
	Expand: "展开",
	"Expand all": "展开到底",
	"Expand the call tree to here": "在执行树中展开到这里",
	Files: "文件",
	Fit: "适配",
	"Fit view": "适应视图",
	"Group by cluster — computed from the edges; an inference, not a fact": "按聚簇分组，从边算出来的，是推导不是事实",
	"Group by directory — the boxes people drew": "按目录分组，这是人画的框",
	Guards: "守卫",
	"Has case": "有 case",
	"Hidden because they share no function with the other side": "已隐藏与对方没有任何共用函数的",
	"How many functions an interrupt and another entry can both reach. A cell is the starting point of a concurrency review; click it to see the shared functions and variables": "一个中断和一个入口同时能到达的函数数。格子是并发审查的起点，点它看共用的函数与变量",
	"How state changes and where the conditions are": "状态如何变化，条件在哪里",
	In: "入",
	"Initial: alphabetical": "初始：字母序",
	"Initialize ArchX": "初始化 ArchX",
	"Installed. In Claude Code, use /archx:archcheck to scan the repository and read code facts.": "已安装。在 Claude Code 里用 /archx:archcheck 扫描仓库并读代码事实。",
	"Installing the ArchX Claude Code plugin": "安装 ArchX 的 Claude Code 插件",
	"Installing the skill and MCP server": "安装 skill 和 MCP",
	"Interrupt context (by preemption priority)": "中断上下文（按抢占优先级）",
	"Interrupt priority: a smaller number preempts a larger one; unknown stays unknown — no guessing": "中断优先级：数字小的能打断数字大的，未知就是未知，不猜",
	"Interrupt produces → thread consumes": "中断产出 → 线程消费",
	"Interrupt ＼ entry": "中断 ＼ 入口",
	"Interrupts {n} · position not knowable statically": "中断 {n} · 位置静态不可知",
	"Keil project": "Keil 工程",
	"Keil project selection cancelled": "已取消 Keil 工程选择",
	"Keil target selection cancelled": "已取消 Keil Target 选择",
	"Leaves are units: a source file plus the same-named header in its directory. All eight quantities on an edge come from the engine; row and column order is computed by peeling sources and sinks then tearing, with no declared layers": "叶子是单元：源文件 + 同目录同主名的头。边上八个量都来自引擎；行列顺序由源/汇剥离加撕开算出，没有任何声明的层",
	"Loading…": "读取中…",
	"Locals not preserved across a yield": "让出后不保留的局部",
	Location: "位置",
	Macros: "宏",
	Member: "成员",
	"Memory footprint": "内存占用",
	"Mesh: jumps and backs outnumber forward steps — a real state machine": "网状：跳跃与回退多于顺序前进，是真正的状态机",
	"Mixed: neither forward steps nor jumps and backs dominate": "混合：顺序前进和跳跃回退都不占多数",
	Mode: "模式",
	Module: "模块",
	"Mostly sequential: reads like a procedure written with switch; back and jump edges are exception paths": "顺序流程为主：像用 switch 写的过程，回退和跳跃是异常路径",
	"Multiple writers · no owner": "多写方 · 没有 owner",
	"No build information; source scan only": "没有构建信息，只做源码扫描",
	"No bundled ArchCheck engine is available for this platform ({platform}). Install the ArchX build for your platform, or set archx.archcheck.enginePath.": "当前平台没有可用的内置 ArchCheck 引擎（{platform}）。请安装对应平台的 ArchX，或配置 archx.archcheck.enginePath。",
	"No entry reaches it: it is not on main's startup path and no task, callback or interrupt reaches it.": "没有任何入口能到达它：不在 main 的启动路径上，也不被任何任务、回调或中断触达。",
	"No further calls.": "没有再往下的调用。",
	"No interrupt meets another entry at the function level. Variable-level overlap may still exist; pick any pair below.": "没有中断和别的入口在函数级碰头。变量级交叠仍可能存在，用下面的下拉框任选一对。",
	"No matching function": "没有匹配的函数",
	"No runnable Claude Code CLI detected": "未检测到可运行的 Claude Code CLI",
	"No state machine recognized. The engine treats": "没有识别到状态机。引擎把",
	"No states to draw.": "没有可画的状态。",
	"No variable is touched by both an interrupt and another execution unit.": "没有变量同时被中断和别的执行单元触到。",
	"No yield; the condition calls a function for status: the whole schedule stalls here until the return value changes": "不让出，条件里调函数取状态：整个调度卡在这里直到返回值变化",
	"No yield; the condition polls a register or peripheral status: the whole schedule stalls here until the hardware is ready": "不让出，条件轮询寄存器或外设状态：整个调度卡在这里直到硬件就绪",
	"No yield; the condition reads a shared variable written by an interrupt: the whole schedule stalls here until the interrupt changes it": "不让出，条件读的是中断会写的共享变量：整个调度卡在这里直到中断改它",
	"One round of": "一轮：",
	"Only the for header is read; if the body changes the counter or the bound, this number does not hold": "只读 for 头部；体内若改动计数器或上界，这个数不成立",
	"Open artifact": "打开产物",
	"Open code facts": "打开代码事实",
	Order: "顺序",
	"Order & time": "顺序与时间",
	"Ordering, wait points and periods": "先后关系、等待点和周期",
	Out: "出",
	Overview: "全景",
	"Partition name": "分区名称",
	Pause: "暂停",
	Period: "周期",
	"Pick an execution unit to see what one round of it passes through.": "选一个执行单元，看它跑一圈都经过了什么。",
	"Pick any pair": "任选一对",
	"Pin to the bottom of the block (declaration)": "钉到块底（声明）",
	"Pin to the top of the block (declaration)": "钉到块顶（声明）",
	"Point path at a field below; array fields take offset / limit for paging": "用 path 指到下面某个字段；数组字段可以带 offset / limit 分页",
	"Polling order": "轮询顺序",
	"Polling order (depth-first from main, registrations in call-line order)": "轮询顺序（从 main 深搜、按调用行序遇到的注册）",
	"Preemptive: tasks can interrupt each other": "抢占式：任务之间可以互相打断",
	"Project name": "项目名称",
	"Reached by no entry": "没有入口能到达",
	"Read-only for it": "它只读的",
	Reader: "读方",
	Reads: "读",
	"Reads, writes and execution domains come from the engine; a conflict is a candidate, not a verdict — the engine cannot see cross-function or conditional protection": "读写与执行域来自引擎；冲突是候选不是结论，跨函数或条件性的保护引擎看不见",
	"Registering the marketplace": "注册 marketplace",
	"Replay the ordering inside this block: {n} steps": "回放这个块内部的排序：{n} 步",
	"Replay the top-level ordering: {n} steps, {peel} peels · {tear} tears": "回放顶层排序：{n} 步，剥离 {peel} · 撕开 {tear}",
	Reset: "复位",
	"Rewritten inside interrupts": "中断里改写这个变量",
	"Rhythm of execution units": "执行单元的节奏",
	"Rightward is nesting depth, not time. Two boxes in one column do not imply order either; only top-to-bottom inside one box is source order.": "往右是嵌套深度，不是时间。同一列里两个框之间也不表示先后，只有一个框内部自上而下才是源码顺序。",
	Role: "角色",
	"Row {name} has no cells among the remaining elements of the block (depends on nobody) → moved to the bottom": "{name} 这一行在块里剩下的元素中没有格子（不依赖任何人）→ 放到块底",
	"Run map": "运行图",
	"Runs every round; no timer": "每圈都跑，没有定时器",
	"Scan failed": "扫描失败",
	"Scanning {target} failed": "扫描 {target} 失败",
	"Scanning {target}…": "正在扫描 {target}…",
	"Scheduling model unknown": "调度模型未知",
	"Scroll to zoom · drag to pan · click a state for its conditions · numbers on outgoing edges match the transitions in the sidebar": "滚轮缩放 · 拖动平移 · 点状态看条件 · 出边的编号对应侧栏里的转换",
	"Search names": "搜索名字",
	Section: "段",
	"Shared functions": "共用函数",
	"Sharing & concurrency": "共享与并发",
	"Show this pair": "看这一对",
	"Show units that touch no shared variable": "展开没碰共享变量的单元",
	"Sizes come from the link artifact; module attribution comes from source facts: each object file is traced back to its source file by the functions it defines": "尺寸来自链接产物，模块归属来自源码事实：目标文件按它定义的函数名反查源文件",
	"State transitions": "状态转换",
	Stop: "结束",
	Symbol: "符号",
	"The beat cannot be drawn.": "画不出节拍。",
	"The current view has no back edges.": "当前视图没有反向边。",
	"The engine knows what numbers the code wrote and where it yields; it does not know how long any code actually runs. A period is the delay argument times the tick — a lower bound, not a measurement": "引擎知道代码里写了什么数字、哪里会让出；不知道任何一段代码真实跑多久。周期是延时实参乘以 tick，是下界不是实测",
	"The engine treats switch(variable) as a state-machine candidate: case labels are states, assignments to the dispatch variable inside the switch are transitions, and the enclosing if conditions approximate the transition conditions": "引擎把 switch(变量) 当状态机候选：case 标签是状态，switch 内对分派变量的赋值是转换，包围它的 if 条件作为近似转换条件",
	"The facts have no dependencyOrder; rescan with a newer engine.": "事实里没有 dependencyOrder，需要更新的引擎重新扫描。",
	"The facts have no execution units; a schema 2 or newer scan is required.": "事实里没有执行单元，需要 schema 2 以上的扫描。",
	"The facts have no imageFacts. The project needs a link artifact (an armlink / Keil .map) and the scan must have read it.": "事实里没有 imageFacts。需要工程里存在链接产物（armlink / Keil 的 .map），并且扫描时读到了它。",
	"The infinite loop in an execution unit's root function: one round = one pass of its body": "执行单元根函数里的无限循环：一轮 = 它的循环体",
	"The loop body has a blocking point: it waits for a condition and yields once per turn, so this step may span several scheduling periods": "循环体里有阻塞点：等条件成立，每转一圈让出一次，这一步可能跨多个调度周期",
	"The partition must be inside the current VS Code workspace": "架构分区必须位于当前 VS Code 工作区内",
	"The profile's scheduling is preemptive: tasks can interrupt each other, so staggering by polling order does not hold.": "profile 的 scheduling 是抢占式：任务之间可以互相打断，「按轮询顺序错开」的画法不成立。",
	"The routing library failed on this machine; simple rows are used": "走线库在这台机器上失败，用了简单分行",
	"The scan produced no facts file": "扫描没有产出事实文件",
	"There is a call, but three include hops from {file} never reach the callee's module: a contract bypass.": "有调用，但从 {file} 沿 include 走三跳看不见被调方的模块：契约绕过。",
	"There is no function-level concurrency overlap between them.": "它们之间不存在函数级的并发交叠。",
	"These {n} items take {bytes} bytes, over the per-call limit of {max}": "这 {n} 条有 {bytes} 字节，超过单次上限 {max}",
	"This ArchX package does not include the Claude Code plugin": "当前 ArchX 安装包缺少 Claude Code 插件",
	"This block is {bytes} bytes, over the per-call limit of {max}": "这一块有 {bytes} 字节，超过单次上限 {max}",
	"This edge is not in the code: a framework rule says the scheduler polls this task": "代码里没有这条边：框架规则说调度器轮询这个任务",
	"This entry has no round to unfold": "这个入口没有可展开的一轮",
	"This partition has not been scanned yet; scanning…": "这个分区还没扫描过，正在扫…",
	"This scan has no AST-level facts, so loops and yield points are invisible.": "这次扫描没有 AST 层事实，看不到循环与让出点。",
	"This scan has no AST-level facts, so reads, writes and execution domains are invisible. A full scan with build information is required.": "这次扫描没有 AST 层事实，看不到读写与执行域。需要带构建信息的完整扫描。",
	"This scan has no AST-level facts, so state transitions cannot be drawn. Try a full scan with clangd.": "这次扫描没有 AST 层事实，画不出状态转换。用带 clangd 的完整扫描再试。",
	"This scan has no AST-level facts, so the beat cannot be drawn.": "这次扫描没有 AST 层事实，画不出节拍。",
	"This scan has no concurrency facts.": "这次扫描没有并发事实。",
	"This scan has no data for this theme": "这次扫描没有这个主题的数据",
	"This scan has no dependency-order facts.": "这次扫描没有依赖顺序事实。",
	"This scan has no execution-unit facts.": "这次扫描没有执行单元事实。",
	"This scan has no link artifact, so sizes are unavailable.": "这次扫描没有链接产物，尺寸无从谈起。",
	"This scan has no timing facts.": "这次扫描没有时序事实。",
	"This state has no transitions inside the switch.": "这个状态没有 switch 内的转换。",
	"This theme has no field {path}": "这个主题里没有 {path}",
	"Thread context (tasks · each followed by the callbacks it hosts)": "线程上下文（任务 · 其后是它宿主的回调）",
	"Thread produces → interrupt consumes": "线程产出 → 中断消费",
	"To the right of a box is how that loop exits.": "框右边是这个循环怎么出去。",
	Trace: "倒推",
	"Transition conditions query other state machines": "转换条件里查询了别的状态机",
	Transitions: "转换",
	"Two-root comparison": "双根对比",
	"Type a function name to trace back to its entries": "输入函数名，倒推到入口",
	Types: "类型",
	"Unconditional: transitions as soon as the case is entered.": "无条件，case 一进来就转。",
	"Unfolding this round…": "正在把这一轮摊开…",
	Unit: "单元",
	Units: "执行单元",
	"Updating the local marketplace": "更新本地 marketplace",
	"Using the ArchCheck engine bundled in the VSIX": "使用 VSIX 内置 ArchCheck 引擎",
	"Using the development-environment ArchCheck Python engine": "使用开发环境 ArchCheck Python 引擎",
	"Using the user-configured ArchCheck Python engine": "使用用户配置的 ArchCheck Python 引擎",
	"Using the user-configured standalone ArchCheck engine": "使用用户配置的 ArchCheck 独立引擎",
	"Using {project} / {target}": "使用 {project} / {target}",
	Value: "值",
	Variable: "变量",
	"Variables both sides reach · read/write direction, protection and conflict confidence are under Sharing & concurrency": "两边都触达的变量 · 读写方向、保护与冲突置信度在「共享与并发」里",
	Verdict: "判定",
	"Verifying the plugin": "验证插件",
	"Waiting for a scan": "等待扫描",
	"What problem does the product solve?": "产品要解决什么问题？",
	"Where execution starts and what it reaches": "从哪里开始，什么会被触达",
	"Where the space goes, based on which artifact": "空间花在哪，基于哪个产物",
	"Where time comes from": "时间是从哪来的",
	"Which execution units touch the same resource": "哪些执行单元访问同一资源",
	"Who depends on whom, and on what exactly": "谁依赖谁，具体依赖什么",
	Writer: "写方",
	Writes: "写",
	"Written by interrupts (flows down to threads)": "中断写的（往下流给线程）",
	"Written by it and by others": "它和别人都写",
	"Written by threads (flows up to interrupts, or between threads)": "线程写的（往上流给中断，或线程之间）",
	"Written out by {name} (it is the owner)": "{name} 写出去的（它是 owner）",
	"Yield / timeout": "让出 / 超时",
	"Yield-wait": "让出等待",
	"a yield point one level deeper; this step may span several scheduling periods": "再深一层里有让出点，这一步可能跨多个调度周期",
	"access sites": "访问点",
	"accesses that collide with an interrupt with no protection seen": "和中断撞上又没看到保护的访问",
	"address taken": "取地址",
	"all recognized accesses are inside critical sections": "已识别的访问都在临界区内",
	"array · {n} items": "数组 {n} 项",
	"array · {n} items · {bytes} bytes": "数组 {n} 项 · {bytes} 字节",
	artifact: "产物",
	"as a candidate; there is none in this scope.": "当候选，这个范围里没有。",
	async: "异步",
	"at most {n} times": "最多 {n} 次",
	back: "回边",
	"back (the edge that closes a cycle)": "反向（扣环的边）",
	"back edges": "反向边",
	"back to an ancestor": "回到上面",
	blocked: "分块",
	"bounded loops {n} steps": "有界循环 {n} 步",
	boxes: "框",
	"busy-poll": "忙轮询",
	"busy-wait on hardware": "忙等硬件",
	"busy-wait on variable": "忙等变量",
	call: "调用",
	"call without include": "没 include 的调用",
	callback: "回调",
	calls: "调用",
	cast: "强转",
	"checks that bail out right after entering this case": "进入这个 case 之后先跳出的检查",
	"claude {args} exited with code {code}": "claude {args} 退出码 {code}",
	"click for details": "点击看明细",
	"click to collapse": "点击折回",
	"closed-source library": "闭源库",
	"closed-source library {name}": "闭源库 {name}",
	"collides with an interrupt and no protection seen": "和中断撞上、又没看到保护",
	"condition fails": "条件不成立",
	confidence: "置信度",
	"conflict candidate": "冲突候选",
	"critical sections": "临界区",
	"cross-context and non-atomic": "跨上下文且非原子",
	"cross-context non-atomic": "跨上下文非原子",
	"current view": "当前视图",
	"declared by profile": "profile 声明",
	"delay argument × tick, a lower bound": "延时实参 × tick，是下界",
	depends: "依赖",
	"direct access": "直接访问",
	"due time = sleep argument × tick {tick} ms · horizontal offset = polling order · scroll sideways to zoom": "到期时刻 = sleep 实参 × tick {tick} ms · 横向错开 = 轮询顺序 · 左右滚动缩放尺度",
	enables: "使能",
	"event-driven": "事件驱动",
	"every round": "每圈",
	"every round / denser than a cell": "每圈 / 密于一格",
	evidence: "证据",
	exit: "出口",
	"expand · bar = expanded group": "展开 · 竖条 = 展开的组",
	field: "字段",
	flat: "打平",
	forward: "顺序",
	"forward jump": "跳跃前进",
	"forward step": "顺序前进",
	from: "从",
	"function body {from}–{to}; no loop, runs once and returns": "函数体 {from}–{to}，没有循环，跑一遍返回",
	"global variable": "全局变量",
	"high-confidence conflicts": "高置信冲突",
	host: "宿主",
	"host unknown": "宿主未知",
	hyperperiod: "超周期",
	image: "镜像",
	"in": "在",
	"in a stackless coroutine a yield is a return: a non-static local on the stack no longer holds its value next time": "无栈协程的让出就是 return，栈上的非 static 局部下次进来已经不是原来的值",
	"incl. interrupt": "含中断",
	"include without call": "只 include 没调用",
	"includes one-step pointer inference": "含一步指针推导",
	inferred: "推导",
	"inner infinite": "内层无限",
	inside: "内部：",
	"inside critical section": "临界区内",
	"inside the callee": "在被调函数内",
	interrupt: "中断",
	"interrupt and thread both write": "中断和线程都写",
	"interrupt fires": "中断触发",
	"is the selected folder": "就是所选目录",
	iteration: "遍历",
	"judged as paired APIs within one statement block; cross-function or conditional protection is invisible": "判定为同一语句块内成对出现的 API，跨函数或条件性的保护看不到",
	jump: "跳转",
	"kernel exception": "内核异常",
	"lead back to due time": "回连到期时刻",
	line: "行",
	linearity: "线性度",
	"linearity = forward steps ÷ all transitions": "线性度 = 顺序前进 ÷ 全部转换",
	local: "局部",
	"loop level {n}": "第 {n} 层循环",
	loops: "循环",
	"macro expansion": "宏展开",
	macros: "宏",
	"main context": "main 上下文",
	"main loop": "主循环",
	"main writes {n} shared variables during initialization (not counted as runtime data flow)": "main 在初始化时写入 {n} 个共享变量（不算运行期数据流）",
	medium: "中置信",
	"multiple writers": "多写方",
	"next round": "跨轮",
	"next turn": "转下一轮",
	no: "无",
	"no (target only)": "无（只作目标）",
	"no call and loop facts": "没取到调用与循环事实",
	"no calls and no yield points in this segment": "这一段里没有调用，也没有让出点",
	"no condition, no break, no return: no way out visible statically": "没有条件、没有 break、没有 return：静态看不到出去的路",
	"no dependency data": "无依赖信息",
	"no enable seen": "未见使能",
	"no exit: once in, never out": "没有出口，进去就出不来",
	"no incoming edge": "无入弧",
	"no matching end found": "没找到配对的结束",
	"no yield and no timeout seen": "没有让出，也没看到超时",
	"no yield: the whole schedule stalls; for how long depends on external conditions and cannot be seen statically": "不让出，卡住的是整个调度；卡多久取决于外部条件，静态看不出来",
	"non-atomic": "非原子",
	none: "无",
	"not a case: only a transition target": "非 case：只作为转换目标",
	"not a counted loop; how many times it runs depends on when the condition fails": "不是计数循环，跑多少次取决于条件何时不成立",
	"not in the switch": "未在 switch 出现",
	"not located": "未定位",
	"notification flag": "通知标志",
	"notification flag: design intent, not a race": "通知标志：设计意图，不是竞争",
	"notification flags": "通知标志",
	"object · {n} keys": "对象 {n} 键",
	"object · {n} keys · {bytes} bytes": "对象 {n} 键 · {bytes} 字节",
	"one round": "一轮",
	"one-shot": "单次",
	"one-sided protection": "单边保护",
	"order judged by polling position": "顺序按轮询位置判定",
	"order unknown": "顺序未知",
	"out-weight minus in-weight": "出权−入权",
	"outside the region": "区域外",
	parameter: "形参",
	"period unknown": "周期未知",
	"period {p} ms (delay argument × tick, lower bound)": "周期 {p} ms（延时实参 × tick，下界）",
	periodic: "周期",
	"planned inversion (Alt+click)": "打算反转（Alt+点）",
	preempt: "抢占",
	preemptive: "抢占式",
	"priority unknown": "优先级未知",
	"protects {n} accesses": "保护 {n} 处访问",
	"reach {a} / {b} functions": "各自触达 {a} / {b} 个函数",
	reaches: "触达",
	"reaches unbounded busy-wait": "走到无界忙等",
	"reaches {n} functions": "触达 {n} 个函数",
	read: "读",
	"read/write": "读写",
	"read/written directly by the root function": "根函数自己直接读写的",
	reads: "读",
	"reads and writes": "读写",
	"recognized protection is all inside critical sections": "已识别的保护都在临界区内",
	registers: "注册",
	"registration (function pointer)": "注册（函数指针）",
	"registration: the function address is stored into the system, not called here": "注册：把函数地址装进系统，不是在这里调它",
	"return": "返回",
	"rewritten via helper ×{n}": "经 helper 改写 {n}",
	"row = dependent · column = depended on · shade = weight": "行 = 依赖方 · 列 = 被依赖方 · 深浅 = 轻重",
	rule: "规则",
	runs: "会跑",
	"runs every round": "每圈都跑",
	"runs every round · unbounded busy-wait": "每圈必跑 · 无界忙等",
	runtime: "运行期",
	"same module": "同模块",
	"same round": "同轮",
	"scan root": "扫描根",
	schedules: "调度",
	segment: "段",
	self: "自环",
	"self-loop": "自环",
	"share {f} functions and {v} variables": "共用 {f} 个函数、{v} 个变量",
	"shortest period": "最小周期",
	snapshot: "快照",
	"source scan, no build information": "源码扫描，没有构建信息",
	span: "跨度",
	start: "起点",
	step: "步长",
	"step {i} of {n}": "第 {i}/{n} 步",
	steps: "步",
	"steps per round": "一轮步数",
	"sub-machine": "子状态机",
	suspendable: "可被挂起",
	"suspendable tasks": "可被挂起的任务",
	task: "任务",
	terminal: "终态",
	"the bound could not be resolved": "上界没解析出来",
	"the bound is a variable; the count depends on runtime": "上界是变量，次数取决于运行期",
	"the bound is an array length": "上界是数组长度",
	"the condition mentions a timeout or count; there may be a bound": "条件里提到超时或计数，可能有上限",
	"the condition mentions a timeout or count; there may be a bound, the engine does not guarantee it": "条件里提到超时或计数，可能有上限，引擎不保证",
	"the engine gave no enum definition; showing the {n} labels seen in the switch": "引擎未给出枚举定义，按 switch 里出现过的 {n} 个标签",
	"the numbers in the firmware that define time, each with its source": "固件里定义时间的那些数字，每条带出处",
	"this loop already has a box above": "这个循环上面已经开过框了",
	"this region": "本区",
	"time base counter": "计时基准",
	"timeout bound": "超时上界",
	"timeout loops": "超时循环",
	timer: "定时",
	"top level": "顶层",
	"touches {n} shared variables, writes {w}": "碰 {n} 个共享变量，写 {w} 个",
	"transition target only": "只作为转换目标",
	types: "类型",
	"unbounded busy-wait": "无界忙等",
	"unclustered (no edges)": "未聚簇（无边）",
	unconditional: "无条件",
	unknown: "未知",
	unprotected: "无保护",
	"unprotected write conflict": "无保护写冲突",
	"used {n} times in {files} files": "{files} 个文件用了 {n} 次",
	"variables touched by an interrupt and another unit": "中断与其他单元同时触及的变量",
	vector: "向量",
	via: "经",
	"via {callee} parameter {param} (one-step inference)": "经 {callee} 形参 {param}（一步推导）",
	"whole project": "整个工程",
	write: "写",
	writes: "写",
	"written at line {w}, {callee} yields, read again at line {r}": "写在 {w} 行，{callee} 让出，{r} 行又读",
	"written on the interrupt side by": "中断侧会写",
	yes: "有",
	"yield": "让出",
	"yield-wait": "让出等待",
	yields: "让出",
	"yields only when this branch is taken": "走到这个分支才让出",
	zoom: "缩放",
	"{a} and {b} share {n} functions": "{a} 与 {b} 共用 {n} 个函数",
	"{kind} infinite loop {from}–{to}; one round = one turn": "{kind} 无限循环 {from}–{to}，一轮 = 转一圈",
	"{m}/{n} object files traced to a source file by function names": "{m}/{n} 个目标文件由函数名反查到源文件",
	"{name}-side functions": "{name} 侧函数",
	"{n} .c/.h pairs merged": "合并 {n} 对 .c/.h",
	"{n} accesses": "{n} 处访问",
	"{n} call sites": "调用点 {n} 处",
	"{n} calls": "{n} 次调用",
	"{n} cases, dispatch only, no state change": "{n} 个 case，只分发不改状态",
	"{n} early exits": "{n} 个提前退出",
	"{n} entries": "{n} 个入口",
	"{n} file pairs": "{n} 对文件",
	"{n} files": "{n} 文件",
	"{n} functions": "{n} 函数",
	"{n} functions run beneath it": "它下面跑着 {n} 个函数",
	"{n} inner edges": "内 {n} 边",
	"{n} interrupts": "{n} 个中断",
	"{n} left that depend on each other, nothing more to peel → tear off {name}, the one with the largest out-degree minus in-degree": "剩下 {n} 个互相依赖，剥不动了 → 撕开出度−入度最大的 {name}",
	"{n} members": "{n} 个成员",
	"{n} more touch no shared variable": "还有 {n} 个没碰共享变量",
	"{n} not in the switch": "{n} 个未在 switch 出现",
	"{n} possible hosts": "可能的宿主 {n} 个",
	"{n} rows": "{n} 条",
	"{n} sites": "{n} 处",
	"{n} source files are newer than the artifact: these sizes do not match the current code.": "源码新于产物的文件 {n} 个：这些尺寸对不上当前代码。",
	"{n} states": "{n} 状态",
	"{n} tasks are not in the polling order and go last": "{n} 个任务不在轮询顺序里，排到最后",
	"{n} times": "{n} 次",
	"{n} transitions": "{n} 转换",
	"{n} units": "{n} 个单元",
	"{n}, by bytes; {shared} shared by multiple units, {bytes} in total": "{n} 个，按字节；多单元共享的 {shared} 个共 {bytes}",
	"{n}, each the shortest path": "{n} 条，每条是最短路",
	"{period} ms · at this scale due times are denser than one cell": "{period} ms · 这个比例下到期点比一格还密",
	"{source} is not v2 facts (missing executionUnits / reachability / entries); rescan with ArchX 0.25.2 or newer": "{source} 不是 v2 事实（缺 executionUnits / reachability / entries），请用 ArchX ≥ 0.25.2 重新扫描",
	"{type} · {bytes} bytes": "{type} · {bytes} 字节",
	"{n} in the whole scan": "整次扫描 {n} 处",
	"variables are shared by direct access, not through common functions, so the two counts need not match": "变量是直接访问共享的，不经过共用函数，两个数不必一致",
	"The scheduling model is not preemptive; the beat shows the round instead.": "调度模型不是抢占式；一轮的节奏看节拍图。",
	"This scan has no AST-level facts, so the preemption picture cannot be drawn.": "这次扫描没有 AST 层事实，画不出抢占图。",
	"waits for an event; runs when it is signalled and nothing higher is ready": "等事件；被唤醒且没有更高优先级就绪时运行",
	"never blocks; runs whenever nothing higher is ready": "从不阻塞；只要没有更高优先级就绪就在跑",
	"runs once": "只跑一次",
	scheduling: "调度",
	"priority order": "优先级方向",
	"higher number = higher priority": "数字大的优先级高",
	"lower number = higher priority": "数字小的优先级高",
	"priorities known": "已知优先级",
	"event-driven tasks": "事件驱动任务",
	"interrupts with a body": "有函数体的中断",
	"Priority comes from the create call or the attribute struct; period is the delay argument × tick; who wakes whom comes from notification flags. None of this is a measurement: it says who can interrupt whom, not who did.": "优先级来自创建调用或属性结构体；周期是延时实参 × tick；谁叫醒谁来自通知标志。这些都不是测量：它说的是谁能打断谁，不是谁打断了谁。",
	"waits on": "等",
	"woken by": "被唤醒于",
	"{n} interrupts above every task · {m} with a known preempt priority · positions statically unknown": "{n} 个中断高于所有任务 · {m} 个抢占优先级已知 · 位置静态不可知",
	"no interrupt with a body": "没有带函数体的中断",
	"Preemption: rows by priority (highest first); a lower task due at the same instant is pushed right by one cell per higher task": "抢占：按优先级分行（最高在上）；同一刻到期的低优先级任务，每有一个更高的就向右错一格",
	"The preemption picture cannot be drawn.": "画不出抢占图。",
	literal: "字面量",
	"enum constant": "枚举常量",
	"constant ± literal": "常量 ± 字面量",
	"attribute struct initializer": "属性结构体初始化器",
	"not resolved": "未解析",
	"due, runs": "到期，运行",
	"pushed right by a higher task due at the same instant": "被同刻到期的更高任务挤到右边",
	"waits for an event": "等事件",
	"never blocks": "从不阻塞",
	"{n} tasks without a resolved priority go last": "{n} 个任务优先级未解析，排最后",
	priority: "优先级",
	"priority not found at the create call": "创建调用处没找到优先级",
	"{n} higher tasks due at the same instant run first": "同一刻到期的 {n} 个更高任务先跑",
	"Who wakes whom": "谁叫醒谁",
	"event-driven tasks, what they wait on, and which unit writes the flag": "事件驱动的任务、它们等什么、哪个单元写那个标志",
	"Data dependencies between tasks": "任务之间的数据依赖",
	"{n} pairs · a higher task can interrupt a lower one between any two accesses": "{n} 对 · 高优先级任务可以在低优先级任务的任意两次访问之间插进来",
	"shared, no finding": "共享，无发现",
	"Where you are": "当前位置",
	filtered: "已筛选",
	Legend: "图例",
	"writer → variable": "写方 → 变量",
	"variable → reader": "变量 → 读方",
	"{n} touch shared state": "{n} 个碰了共享状态",
	"Back to the overview": "回全景",
	"Show only this unit's page": "只看这个单元的页",
	"Filter variables": "筛选变量",
	"one at a time; click again to clear": "一次一个；再点一次取消",
	conflict: "冲突",
	"both write": "双方都写",
	shared: "共享",
	"no shared state": "没碰共享状态",
	"installed by": "装入于",
	"only what": "只看",
	touches: "碰到的",
	"Show everything again": "恢复全景",
	"Show only it and what it touches; click again for everything": "只留它和它碰到的变量；再点一次恢复全景",
	"click to show only what it touches, double-click for its page": "单击只看它碰到的，双击进它的页",
	"called forever by the framework; one round = one pass of the body {from}–{to}": "框架无限调用；一轮 = 函数体跑一遍 {from}–{to}",
	"busy-wait on a variable": "忙等变量",
	"endless inner loop": "内层死循环",
	"macro loop": "宏循环",
	"if": "if",
	"else": "else",
	"case": "case",
	"switch": "switch",
	loop: "循环",
	"no way out": "没有出口",
	"One round of {name}, in order": "{name} 的一轮，按顺序",
	"{n} steps": "{n} 步",
	"{n} yields": "{n} 处让出",
	"{n} busy-waits": "{n} 处忙等",
	"writes {n} shared variables": "写 {n} 个共享变量",
	"{n} conflict candidates": "{n} 个冲突候选",
	"Open the definition": "打开定义",
	"(its own body)": "（它自己的函数体）",
	"inside a critical section": "在临界区内",
	"something it calls blocks": "它调到的函数里会阻塞",
	"yields inside": "内部会让出",
	"also written by interrupt": "中断也写",
	"Open the call site": "打开调用点",
	"See what one round of it does, in order": "看它一轮里依次做什么",
	"steps in one round": "一轮里的步数",
	"busy-waits reached in one round": "一轮里走到的忙等",
	"yield points in one round": "一轮里的让出点",
	"shared variables it writes": "它写的共享变量",
	"of them conflict candidates": "其中冲突候选",
	Interrupts: "中断",
	Tasks: "任务",
	"Main loop": "主循环",
	Callbacks: "回调",
	"Pick an interrupt, task or the main loop on the left to see what one round of it does, in order.": "在左侧选一个中断、任务或主循环，看它一轮里依次做什么。",
	"period unknown · click the row for the order of one round": "周期未知 · 点这一行看一轮的顺序",
	"Breadth-first from the entry, calls in line order: the first function that enters each module": "从入口广度优先，同层按调用行号：每个模块第一次被走进的那个函数",
	"Modules in the order first reached": "模块首次触及顺序",
	"first reached at depth {d} through {fn}": "在深度 {d} 经 {fn} 首次到达",
	"Right = one call deeper · down = source line order · click a card to unfold or fold it": "向右 = 调用更深一层 · 向下 = 源码行号顺序 · 点卡片展开 / 收起",
	"Root only": "只留根",
	"registered here, runs elsewhere": "在这里注册，在别处运行",
	"scheduler hop inferred from a framework rule": "调度这一跳由框架规则推出",
	"double-click to open the source": "双击打开源码",
	Canvas: "画布",
	List: "列表",
	"{n} functions run below it": "它下面跑着 {n} 个函数"
} };
var current = "en";
/** "zh-cn" / "zh-CN" / "zh-hans" 都算简体中文；其余一律英文 */
function normalizeLocale(language) {
	if (String(language ?? "").toLowerCase().startsWith("zh")) return "zh-CN";
	return "en";
}
function setLocale(language) {
	current = normalizeLocale(language);
	return current;
}
/** 浏览器里按 body[data-lang] 自动定；没有就是英文 */
if (typeof document !== "undefined" && document.body?.dataset?.lang) setLocale(document.body.dataset.lang);
function t(text, vars) {
	const table = catalogs[current];
	let out = table && Object.prototype.hasOwnProperty.call(table, text) ? table[text] : text;
	if (vars) out = out.replace(/\{(\w+)\}/g, (m, key) => key in vars ? String(vars[key]) : m);
	return out;
}
//#endregion
//#region packages/facts-view/src/projection.mjs
function buildFactsView(facts, region, options = {}) {
	const source = options.source ?? "facts";
	const generatedAt = options.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString();
	const norm = (value) => value.replaceAll("\\", "/");
	const depOrder = facts.dependencyOrder ?? null;
	const dirDepth = new Map((depOrder?.nodes ?? []).map((node) => [norm(node.id), node.depth]));
	const maxDepth = depOrder?.maxDepth ?? 0;
	const inRegion = (file) => norm(file).startsWith(region);
	const relative = (file) => norm(file).slice(region.length);
	function moduleOf(file) {
		const normalized = norm(file);
		if (normalized.startsWith("lib:")) {
			const name = normalized.slice(4).split("/").pop();
			return {
				id: `lib:${name}`,
				name: t("closed-source library {name}", { name }),
				dir: normalized,
				external: true,
				library: true
			};
		}
		if (inRegion(normalized)) {
			const parts = relative(normalized).split("/");
			if (parts.length === 1) return {
				id: "(root)",
				name: t("(root-level files)"),
				dir: "(root)",
				external: false
			};
			const id = parts.slice(0, -1).slice(0, 2).join("/");
			return {
				id,
				name: id,
				dir: `${id}/`,
				external: false
			};
		}
		const parts = normalized.split("/");
		return {
			id: `ext:${parts.slice(0, 2).join("/")}`,
			name: parts.slice(0, 2).join("/"),
			dir: `${parts.slice(0, 2).join("/")}/`,
			external: true
		};
	}
	function layerOf(moduleDir, external) {
		const prefix = external ? String(moduleDir).replace(/^(ext:|lib:)/, "").replace(/\/?$/, "/") : `${region}${moduleDir === "(root)" ? "" : moduleDir}`;
		let depth = null;
		for (const [dir, d] of dirDepth) if (moduleDir === "(root)" ? dir === region.replace(/\/$/, "") : `${dir}/`.startsWith(prefix)) depth = depth == null ? d : Math.max(depth, d);
		if (depth == null) return {
			rank: null,
			name: external ? t("outside the region") : t("no dependency data"),
			crosscutting: false,
			depth: null
		};
		return {
			rank: maxDepth - depth,
			name: `D${depth}`,
			crosscutting: false,
			depth
		};
	}
	const files = /* @__PURE__ */ new Map();
	const modules = /* @__PURE__ */ new Map();
	for (const metric of facts.files) {
		const filePath = norm(metric.path);
		const module = moduleOf(filePath);
		if (!modules.has(module.id)) modules.set(module.id, {
			...module,
			layer: layerOf(module.external ? module.id : module.dir, module.external),
			files: []
		});
		modules.get(module.id).files.push(filePath);
		files.set(filePath, {
			path: filePath,
			name: filePath.split("/").pop(),
			module: module.id,
			lines: metric.code_lines ?? 0,
			totalLines: metric.total_lines ?? 0,
			fanIn: metric.fan_in ?? 0,
			fanOut: metric.fan_out ?? 0,
			risk: metric.risk_score ?? 0,
			inCycle: Boolean(metric.in_dependency_cycle),
			functions: [],
			exports: /* @__PURE__ */ new Set()
		});
	}
	const ensureFile = (filePath) => {
		const normalized = norm(filePath);
		if (files.has(normalized)) return files.get(normalized);
		const module = moduleOf(normalized);
		if (!modules.has(module.id)) modules.set(module.id, {
			...module,
			layer: layerOf(module.external ? module.id : module.dir, module.external),
			files: []
		});
		modules.get(module.id).files.push(normalized);
		const record = {
			path: normalized,
			name: normalized.split("/").pop(),
			module: module.id,
			lines: 0,
			totalLines: 0,
			fanIn: 0,
			fanOut: 0,
			risk: 0,
			inCycle: false,
			functions: [],
			exports: /* @__PURE__ */ new Set(),
			unmeasured: true
		};
		files.set(normalized, record);
		return record;
	};
	if (!facts.executionUnits || !facts.reachability || !facts.entries) throw new Error(t("{source} is not v2 facts (missing executionUnits / reachability / entries); rescan with ArchX 0.25.2 or newer", { source }));
	const functions = /* @__PURE__ */ new Map();
	for (const symbol of facts.functions) {
		if (symbol.isDefinition === false) continue;
		const fn = {
			id: symbol.symbol_id,
			name: symbol.name,
			file: norm(symbol.location.path),
			line: symbol.location.line,
			endLine: symbol.end_line ?? null,
			detail: symbol.detail ?? "",
			brief: symbol.documentation?.brief ?? "",
			compileBranch: symbol.compileBranch ?? null,
			definedInHeader: Boolean(symbol.definedInHeader)
		};
		ensureFile(fn.file).functions.push(fn.id);
		functions.set(fn.id, fn);
	}
	for (const symbol of facts.externalSymbols ?? []) {
		const library = symbol.library ? norm(symbol.library).split("/").pop() : "unknown.lib";
		const fn = {
			id: symbol.symbolId,
			name: symbol.name,
			file: `lib:${library}`,
			line: 0,
			endLine: null,
			detail: symbol.signature ?? "",
			brief: "",
			compileBranch: null,
			definedInHeader: false,
			external: true,
			declaredIn: (symbol.declaredIn ?? []).map((site) => ({
				path: norm(site.path),
				line: site.line
			})),
			library: symbol.library ? norm(symbol.library) : null
		};
		ensureFile(fn.file).functions.push(fn.id);
		functions.set(fn.id, fn);
	}
	const callPairs = [];
	const referencePairs = [];
	const seenCalls = /* @__PURE__ */ new Set();
	for (const edge of facts.semanticEdges) {
		const sourceId = edge.source, targetId = edge.target;
		const source = functions.get(sourceId);
		const targetFunction = functions.get(targetId);
		const location = edge.locations?.[0];
		if ((edge.relation === "calls" || edge.relation === "dispatches") && source && targetFunction && sourceId !== targetId) {
			const key = `${sourceId}→${targetId}@${location?.line ?? ""}`;
			if (seenCalls.has(key)) continue;
			seenCalls.add(key);
			callPairs.push({
				s: sourceId,
				t: targetId,
				line: location?.line ?? null,
				...edge.relation === "dispatches" ? {
					kind: "dispatch",
					confidence: edge.confidence ?? null
				} : {}
			});
			if (source.file !== targetFunction.file) ensureFile(targetFunction.file).exports.add(targetId);
		} else if (edge.relation === "references" && source) referencePairs.push({
			s: sourceId,
			t: edge.target,
			line: location?.line ?? null
		});
	}
	const includeEdges = facts.dependencyEdges.map((edge) => ({
		s: norm(edge.source),
		t: norm(edge.target)
	})).filter((edge) => edge.s !== edge.t);
	for (const edge of includeEdges) {
		ensureFile(edge.s);
		ensureFile(edge.t);
	}
	const globals = facts.globalVariables.filter((item) => item.cross_file || new Set((item.references ?? []).map((reference) => norm(reference.path))).size > 1).map((item) => ({
		name: item.name,
		type: item.type_name,
		definition: item.definition ? {
			path: norm(item.definition.path),
			line: item.definition.line
		} : null,
		references: [...new Set((item.references ?? []).map((reference) => norm(reference.path)))].filter((filePath) => filePath !== norm(item.definition?.path ?? ""))
	}));
	const variables = (facts.variables ?? []).filter((item) => item.location).map((item) => ({
		id: item.symbol_id,
		name: item.name,
		file: norm(item.location.path),
		line: item.location.line,
		scope: item.scope ?? null
	}));
	const cycles = facts.dependencyCycles.map((cycle) => cycle.map(norm));
	const callersOf = /* @__PURE__ */ new Map(), calleesOf = /* @__PURE__ */ new Map();
	for (const pair of callPairs) {
		calleesOf.set(pair.s, [...calleesOf.get(pair.s) ?? [], pair]);
		callersOf.set(pair.t, [...callersOf.get(pair.t) ?? [], pair]);
	}
	const isRegionFn = (id) => inRegion(functions.get(id)?.file ?? "");
	const nameOf = (id) => functions.get(id)?.name ?? id.split(":").pop();
	const regionFunctionIds = [...functions.values()].filter((fn) => inRegion(fn.file)).map((fn) => fn.id);
	const mainEntry = facts.entries.find((entry) => entry.kind === "main");
	const mainFn = mainEntry ? functions.get(mainEntry.symbolId) : null;
	const resetEntry = facts.entries.find((entry) => entry.kind === "reset");
	const units = facts.executionUnits.filter((unit) => functions.has(unit.entrySymbolId));
	const unitByEntry = new Map(units.map((unit) => [unit.entrySymbolId, unit]));
	const isrs = units.filter((unit) => unit.kind === "isr" && isRegionFn(unit.entrySymbolId)).map((unit) => ({
		id: unit.entrySymbolId,
		unitId: unit.id,
		kernel: unit.vector < 0,
		vector: unit.vector,
		vectorTable: unit.vectorTable ? {
			path: norm(unit.vectorTable.path),
			line: unit.vectorTable.line
		} : null,
		enablers: [...new Set(unit.enabledAt.map((site) => site.functionId))],
		enabledAt: unit.enabledAt.map((site) => ({
			id: site.functionId,
			line: site.line,
			priority: site.evidence?.priority ?? null
		})),
		priority: unit.enabledAt.map((site) => site.evidence?.priority).find(Boolean) ?? null,
		confidence: unit.confidence,
		registeredAt: unit.registeredAt ? {
			id: unit.registeredAt.functionId,
			line: unit.registeredAt.line
		} : null,
		rule: unit.rule ?? null
	}));
	const domainSetOf = (id) => facts.reachability.domains[id] ?? [];
	const registrations = units.filter((unit) => (unit.kind === "task" || unit.kind === "callback") && isRegionFn(unit.entrySymbolId)).map((unit) => ({
		id: unit.entrySymbolId,
		unitId: unit.id,
		kind: unit.kind === "task" ? "task" : "handler",
		rule: unit.rule,
		confidence: unit.confidence,
		registrars: unit.registeredAt ? [{
			id: unit.registeredAt.functionId,
			line: unit.registeredAt.line,
			runtime: !domainSetOf(unit.registeredAt.functionId).includes("main")
		}] : [],
		dispatchers: unit.dispatchers ?? [],
		hosts: unit.hosts ?? [],
		hostConfidence: unit.hostConfidence ?? null,
		priority: unit.priority ?? null
	}));
	const registerPairs = registrations.flatMap((item) => item.registrars.map((registrar) => ({
		s: registrar.id,
		t: item.id,
		line: registrar.line,
		kind: "register"
	})));
	const irqPairs = isrs.flatMap((isr) => isr.enabledAt.map((site) => ({
		s: site.id,
		t: isr.id,
		line: site.line,
		kind: "irq"
	})));
	const registrationsBy = /* @__PURE__ */ new Map();
	for (const pair of registerPairs) registrationsBy.set(pair.s, [...registrationsBy.get(pair.s) ?? [], pair]);
	const irqEnablesBy = /* @__PURE__ */ new Map();
	for (const pair of irqPairs) irqEnablesBy.set(pair.s, [...irqEnablesBy.get(pair.s) ?? [], pair]);
	const entryIds = new Set(units.map((unit) => unit.entrySymbolId));
	const bootTree = (() => {
		const seen = /* @__PURE__ */ new Set();
		const installsSomething = /* @__PURE__ */ new Map();
		const build = (id, depth) => {
			seen.add(id);
			const kids = (calleesOf.get(id) ?? []).filter((pair) => functions.has(pair.t) && !entryIds.has(pair.t));
			const registrationsHere = (registrationsBy.get(id) ?? []).map((pair) => ({
				id: pair.t,
				kind: unitByEntry.get(pair.t).kind === "task" ? "task" : "handler",
				line: pair.line
			}));
			const irqEnables = (irqEnablesBy.get(id) ?? []).map((pair) => ({
				id: pair.t,
				line: pair.line
			}));
			const libraryInits = kids.filter((pair) => !isRegionFn(pair.t)).length;
			const candidates = kids.filter((pair) => isRegionFn(pair.t) && !seen.has(pair.t));
			const children = depth < 8 ? candidates.map((pair) => build(pair.t, depth + 1)) : [];
			const kept = children.filter((child) => installsSomething.get(child.id));
			installsSomething.set(id, Boolean(registrationsHere.length || irqEnables.length || kept.length));
			return {
				id,
				registrations: registrationsHere,
				irqEnables: irqEnables.length,
				irqTargets: irqEnables,
				libraryInits,
				plainCalls: children.length - kept.length,
				children: kept
			};
		};
		return mainFn ? build(mainFn.id, 0) : null;
	})();
	const byName = /* @__PURE__ */ new Map();
	for (const fn of functions.values()) if (inRegion(fn.file)) byName.set(fn.name, [...byName.get(fn.name) ?? [], fn.id]);
	const duplicates = [...byName.entries()].filter(([, ids]) => ids.length > 1).map(([name, ids]) => ({
		name,
		ids,
		branches: ids.map((id) => functions.get(id).compileBranch)
	}));
	const domainOf = (id) => {
		const set = domainSetOf(id);
		if (!set.length) return "unreached";
		const isr = set.includes("isr");
		const other = set.some((root) => root !== "isr");
		return isr && other ? "mixed" : isr ? "isr" : set.every((root) => root === "main") ? "main" : "task";
	};
	const unreached = facts.reachability.unreached.filter((id) => functions.has(id) && isRegionFn(id));
	const unitsReaching = /* @__PURE__ */ new Map();
	for (const [unitId, reached] of Object.entries(facts.reachability.byUnit)) for (const id of reached) unitsReaching.set(id, [...unitsReaching.get(id) ?? [], unitId]);
	const unitEntry = new Map(units.map((unit) => [unit.id, unit.entrySymbolId]));
	const mixed = regionFunctionIds.filter((id) => domainOf(id) === "mixed").map((id) => {
		const reaching = (unitsReaching.get(id) ?? []).map((unitId) => ({
			unitId,
			entry: unitEntry.get(unitId),
			kind: unitId.split(":")[0]
		}));
		return {
			id,
			isrs: reaching.filter((item) => item.kind === "isr").map((item) => item.entry),
			tasks: reaching.filter((item) => item.kind === "task").map((item) => item.entry),
			callbacks: reaching.filter((item) => item.kind === "callback").map((item) => item.entry),
			roots: domainSetOf(id)
		};
	});
	const uniqueNames = (ids) => new Set(ids.map(nameOf)).size;
	const externDeclarations = (facts.externDeclarations ?? []).map((item) => ({
		name: item.name,
		declaredIn: {
			path: norm(item.declaredIn.path),
			line: item.declaredIn.line
		},
		resolvesTo: item.resolvesTo,
		viaHeader: Boolean(item.viaHeader)
	}));
	const contractBypass = (facts.contractBypass ?? []).filter((item) => functions.has(item.caller) && functions.has(item.callee) && isRegionFn(item.caller)).map((item) => ({
		s: item.caller,
		t: item.callee,
		line: item.location?.line ?? null,
		reason: item.reason
	}));
	const regionSources = (facts.coverage?.excluded ?? []).filter((item) => inRegion(item.path));
	const coverage = facts.coverage ? {
		translationUnits: facts.coverage.translationUnits,
		filesAnalyzed: facts.coverage.filesAnalyzed,
		sourceFilesOnDisk: facts.coverage.sourceFilesOnDisk,
		regionAnalyzed: [...files.values()].filter((file) => inRegion(file.path) && !file.unmeasured && /\.(c|cc|cpp|s)$/i.test(file.path)).length,
		regionExcluded: regionSources.map((item) => ({
			path: norm(item.path),
			reason: item.reason
		}))
	} : null;
	const enableSites = (facts.enableSites ?? []).filter((site) => isRegionFn(site.function)).map((site) => ({
		function: site.function,
		line: site.location?.line ?? null,
		argumentExpr: site.argumentExpr ?? "",
		callee: site.callee ?? "",
		resolvedTo: (site.resolvedTo ?? []).filter((id) => functions.has(id)),
		reason: site.reason ?? null
	}));
	const inactive = {
		functions: (facts.inactiveFunctions ?? []).filter((item) => inRegion(item.path)).map((item) => ({
			name: item.name,
			path: norm(item.path),
			line: item.line,
			region: item.region ?? null
		})),
		files: (facts.inactiveRegions ?? []).filter((item) => inRegion(item.path) && item.inactiveLines > 0).map((item) => ({
			path: norm(item.path),
			inactiveLines: item.inactiveLines,
			totalLines: item.totalLines,
			ratio: item.ratio,
			regions: (item.regions ?? []).length
		})).sort((a, b) => b.ratio - a.ratio)
	};
	const entries = {
		main: mainFn?.id ?? null,
		mainUnit: mainFn ? `main:${mainFn.name}` : null,
		mainSuperloop: Boolean(mainEntry?.superloop),
		enableSites,
		inactive,
		externalSymbols: [...functions.values()].filter((fn) => fn.external).map((fn) => ({
			id: fn.id,
			name: fn.name,
			library: fn.library,
			declaredIn: fn.declaredIn,
			callers: (callersOf.get(fn.id) ?? []).map((pair) => pair.s)
		})),
		reset: resetEntry?.symbolId ?? null,
		bootTree,
		registrations,
		isrs,
		duplicates,
		domains: Object.fromEntries(regionFunctionIds.map((id) => [id, domainOf(id)])),
		domainSets: Object.fromEntries(regionFunctionIds.map((id) => [id, domainSetOf(id)]).filter(([, set]) => set.length)),
		unreached,
		mixed,
		externDeclarations,
		units: units.map((unit) => ({
			id: unit.id,
			kind: unit.kind,
			entry: unit.entrySymbolId,
			rule: unit.rule ?? null,
			confidence: unit.confidence
		})),
		counts: {
			functions: regionFunctionIds.length,
			uniqueFunctions: uniqueNames(regionFunctionIds),
			isrs: isrs.filter((isr) => !isr.kernel).length,
			kernel: isrs.filter((isr) => isr.kernel).length,
			tasks: registrations.filter((item) => item.kind === "task").length,
			handlers: registrations.filter((item) => item.kind === "handler").length,
			unreached: unreached.length,
			isrOnly: regionFunctionIds.filter((id) => domainOf(id) === "isr").length,
			mixed: mixed.length,
			bootOnly: regionFunctionIds.filter((id) => domainOf(id) === "main").length
		}
	};
	const touchesRegion = (sides) => (sides ?? []).some((side) => (side.accesses ?? []).some((access) => isRegionFn(access.function)));
	const ast = {
		present: Boolean(facts.astFacts),
		summary: facts.astFacts ?? null,
		runModes: Object.fromEntries((facts.runModes ?? []).map((item) => [item.unitId, {
			mode: item.mode,
			confidence: item.confidence,
			periodMs: item.periodMs ?? null,
			evidence: item.evidence ?? null
		}])),
		wakeRelations: (facts.wakeRelations ?? []).filter((item) => [...item.producers ?? [], ...item.consumers ?? []].some((site) => isRegionFn(site.function))),
		loops: (facts.loops ?? []).filter((item) => isRegionFn(item.function)),
		stateMachines: (facts.stateMachines ?? []).filter((item) => isRegionFn(item.function)),
		resourceAccesses: (facts.resourceAccesses ?? []).filter((item) => isRegionFn(item.function)),
		criticalSections: (facts.criticalSections ?? []).filter((item) => isRegionFn(item.function)),
		criticalSectionsTotal: facts.scanTotals?.criticalSections ?? (facts.criticalSections ?? []).length,
		controlFlow: (facts.controlFlow ?? []).filter((item) => isRegionFn(item.function)),
		enums: (facts.enums ?? []).map((item) => ({
			name: item.name,
			location: {
				path: norm(item.location.path),
				line: item.location.line
			},
			members: item.members
		})),
		sharedResources: (facts.sharedResources ?? []).filter((item) => touchesRegion(item.units)),
		conflictCandidates: (facts.conflictCandidates ?? []).filter((item) => touchesRegion(item.isrSide) || touchesRegion(item.otherSide))
	};
	for (const unit of entries.units) unit.runMode = ast.runModes[unit.id]?.mode ?? null;
	return {
		entries,
		ast,
		project: facts.project,
		partition: facts.partition,
		scheduling: facts.scheduling ?? "unknown",
		tickMs: facts.tickMs ?? null,
		timeBase: facts.timeBase ?? [],
		imageFacts: facts.imageFacts ?? null,
		taskControls: facts.taskControls ?? [],
		dependencyOrder: depOrder,
		typeOnlyIncludes: (facts.typeOnlyIncludes ?? []).map((item) => ({
			s: norm(item.source),
			t: norm(item.target),
			calls: item.calls_between_files ?? 0,
			refs: item.variable_references ?? 0
		})),
		yieldLocals: facts.yieldLocals ?? [],
		typeUses: (facts.typeUses ?? []).map((item) => ({
			fn: item.function,
			type: item.type,
			role: item.role,
			ptr: item.pointer,
			n: item.count,
			res: item.resolution,
			at: {
				path: norm(item.location.path),
				line: item.location.line
			},
			def: item.definedIn ? {
				path: norm(item.definedIn.path),
				line: item.definedIn.line
			} : null
		})),
		dataDependencies: (facts.dataDependencies ?? []).filter((d) => d.fromKind !== "callback" || d.toKind !== "callback").map((d) => ({
			from: d.from,
			to: d.to,
			fromKind: d.fromKind,
			toKind: d.toKind,
			order: d.order,
			fromPosition: d.fromPosition ?? null,
			toPosition: d.toPosition ?? null,
			resourceCount: d.resourceCount ?? (d.resources ?? []).length,
			resources: (d.resources ?? []).map((r) => ({
				name: r.name,
				variable: r.variable ?? null
			}))
		})),
		dataDependenciesBasis: facts.dataDependenciesBasis ?? null,
		pollingOrder: facts.pollingOrder ?? [],
		macroUses: (facts.macroUses ?? []).map((item) => ({
			file: norm(item.file),
			macro: item.macro,
			n: item.count,
			res: item.resolution,
			defs: item.definitions,
			at: {
				path: norm(item.location.path),
				line: item.location.line
			},
			def: item.definedIn ? {
				path: norm(item.definedIn.path),
				line: item.definedIn.line
			} : null
		})),
		region,
		generatedAt,
		layers: [...new Set([...modules.values()].map((module) => module.layer.depth).filter((d) => d != null))].sort((a, b) => b - a).map((depth) => ({
			name: `D${depth}`,
			rank: maxDepth - depth,
			crosscutting: false,
			patterns: []
		})),
		modules: [...modules.values()].map((module) => ({
			id: module.id,
			name: module.name,
			external: module.external,
			rank: module.layer.rank,
			layerName: module.layer.name,
			crosscutting: Boolean(module.layer.crosscutting),
			boundary: Boolean(module.layer.boundary),
			files: module.files
		})),
		files: [...files.values()].map((file) => ({
			...file,
			exports: [...file.exports]
		})),
		functions: [...functions.values()],
		includeEdges,
		callPairs,
		registerPairs,
		irqPairs,
		referencePairs,
		contractBypass,
		coverage,
		globals,
		variables,
		cycles,
		metrics: facts.metrics,
		engineSchemaVersion: facts.engineSchemaVersion ?? null
	};
}
//#endregion
//#region packages/facts-view/src/graph.mjs
function buildIndex(view) {
	const entries = view.entries;
	const fileById = new Map(view.files.map((f) => [f.path, f]));
	const fnById = new Map(view.functions.map((fn) => [fn.id, fn]));
	const varById = new Map((view.variables ?? []).map((item) => [item.id, item]));
	const calleesOf = /* @__PURE__ */ new Map();
	const callersOf = /* @__PURE__ */ new Map();
	for (const c of [...view.callPairs, ...view.registerPairs]) {
		calleesOf.set(c.s, [...calleesOf.get(c.s) ?? [], c]);
		callersOf.set(c.t, [...callersOf.get(c.t) ?? [], c]);
	}
	const reachCache = /* @__PURE__ */ new Map();
	const reachOf = (id) => {
		if (reachCache.has(id)) return reachCache.get(id);
		const seen = /* @__PURE__ */ new Set([id]);
		const queue = [id];
		while (queue.length) {
			const current = queue.shift();
			for (const c of calleesOf.get(current) ?? []) if (!seen.has(c.t)) {
				seen.add(c.t);
				queue.push(c.t);
			}
		}
		reachCache.set(id, seen);
		return seen;
	};
	const ast = view.ast ?? {};
	const push = (map, key, value) => {
		if (key != null) map.set(key, [...map.get(key) ?? [], value]);
	};
	const blocksByFn = /* @__PURE__ */ new Map();
	for (const b of ast.controlFlow ?? []) push(blocksByFn, b.function, b);
	const loopsByFn = /* @__PURE__ */ new Map();
	for (const l of ast.loops ?? []) push(loopsByFn, l.function, l);
	const loopOrdinal = /* @__PURE__ */ new Map();
	for (const list of loopsByFn.values()) [...list].sort((a, b) => (a.location?.line ?? 0) - (b.location?.line ?? 0)).forEach((l, i) => loopOrdinal.set(`${l.function}@${l.location?.line ?? 0}`, i + 1));
	const accessesByFn = /* @__PURE__ */ new Map();
	for (const a of ast.resourceAccesses ?? []) push(accessesByFn, a.function, a);
	const critByFn = /* @__PURE__ */ new Map();
	for (const c of ast.criticalSections ?? []) push(critByFn, c.function, c);
	return {
		view,
		entries,
		ast,
		fileById,
		fnById,
		calleesOf,
		callersOf,
		reachOf,
		blocksByFn,
		loopsByFn,
		loopId: (loop) => {
			const line = loop?.location?.line ?? loop?.line ?? 0;
			const ordinal = loopOrdinal.get(`${loop?.function}@${line}`) ?? 1;
			return `loop:${String(loop?.function ?? "?").replace(/^function:/, "")}#${ordinal}`;
		},
		accessesByFn,
		critByFn,
		sharedByName: new Map((ast.sharedResources ?? []).map((r) => [r.name, r])),
		conflictByName: new Map((ast.conflictCandidates ?? []).map((c) => [c.name, c])),
		wakeByName: new Map((ast.wakeRelations ?? []).map((w) => [w.name, w])),
		isrIds: new Set((entries.isrs ?? []).map((i) => i.id)),
		regById: new Map((entries.registrations ?? []).map((r) => [r.id, r])),
		domainOf: (id) => entries.domains?.[id] ?? null,
		varById,
		varAt: (id) => {
			const found = varById.get(id);
			if (found) return {
				file: found.file,
				line: found.line,
				name: found.name
			};
			const parts = String(id ?? "").split(":");
			if (parts.length < 3) return {
				file: null,
				line: null,
				name: null
			};
			return {
				file: parts.slice(1, -1).join(":"),
				line: null,
				name: parts[parts.length - 1]
			};
		},
		fileOf: (fnId) => fnById.get(fnId)?.file ?? null,
		nameOf: (fnId) => fnById.get(fnId)?.name ?? String(fnId).split(":").pop(),
		inRegion: (file) => String(file ?? "").startsWith(view.region)
	};
}
var confidenceRank = (c) => ({
	high: 3,
	medium: 2,
	low: 1
})[c] ?? 0;
var idOf = {
	machine: (dispatchVariable, fallbackFile, dispatch) => {
		if (dispatchVariable) {
			const parts = String(dispatchVariable).split(":");
			if (parts.length >= 3) return `fsm:${parts.slice(1).join(":")}`;
			return `fsm:${dispatchVariable}`;
		}
		return `fsm:${fallbackFile ?? "?"}:${dispatch}`;
	},
	state: (machineId, stateName) => `state:${machineId.slice(4)}/${stateName}`,
	resource: (variable, name) => `res:${String(variable ?? "").replace(/^variable:/, "") || name}`,
	memoryModule: (moduleId) => `mem:${moduleId}`,
	memorySymbol: (file, name) => `sym:${file || "?"}:${name}`
};
//#endregion
//#region packages/facts-view/src/fsm/model.mjs
var NEST_MAX_HOPS = 3;
function mergeMachines(raw) {
	const groups = /* @__PURE__ */ new Map();
	for (const m of raw) {
		const key = m.dispatchVariable ?? m.id;
		groups.set(key, [...groups.get(key) ?? [], m]);
	}
	return [...groups.values()].map((list) => {
		const head = list[0];
		const states = /* @__PURE__ */ new Map();
		for (const m of list) for (const st of m.states) {
			const current = states.get(st.name);
			if (!current || !current.endLine && st.endLine) states.set(st.name, {
				...st,
				function: m.function
			});
		}
		const functions = [...new Set(list.map((m) => m.function))];
		return {
			id: idOf.machine(head.dispatchVariable, head.location?.path, head.dispatch),
			members: list.map((m) => m.id),
			function: head.function,
			functions,
			dispatch: head.dispatch,
			dispatchVariable: head.dispatchVariable ?? null,
			dispatchType: head.dispatchType ?? null,
			enumType: list.map((m) => m.enumType).find(Boolean) ?? null,
			location: head.location,
			hasDefault: list.some((m) => m.hasDefault),
			states: [...states.values()],
			transitions: list.flatMap((m) => m.transitions.map((t) => ({
				...t,
				function: m.function
			}))),
			writersElsewhere: [...new Set(list.flatMap((m) => m.writersElsewhere ?? []))].filter((f) => !functions.includes(f)),
			confidence: [
				"high",
				"medium",
				"low"
			].find((c) => list.some((m) => m.confidence === c)) ?? "low"
		};
	});
}
function attachOwners(machines, index) {
	const registrations = index.entries.registrations ?? [];
	const units = [
		...registrations.filter((r) => r.kind === "task"),
		...registrations.filter((r) => r.kind === "callback" || r.kind === "handler"),
		...(index.entries.isrs ?? []).filter((i) => !i.kernel).map((i) => ({
			id: i.id,
			kind: "isr"
		}))
	];
	for (const m of machines) m.owners = units.filter((u) => m.functions.some((f) => f === u.id || index.reachOf(u.id).has(f))).map((u) => ({
		id: u.id,
		kind: u.kind,
		name: index.nameOf(u.id)
	}));
}
function attachNesting(machines, index) {
	const hops = (from, to) => {
		if (from === to) return 0;
		const seen = /* @__PURE__ */ new Set([from]);
		let frontier = [from];
		for (let d = 1; d <= NEST_MAX_HOPS; d += 1) {
			const next = [];
			for (const x of frontier) for (const c of index.calleesOf.get(x) ?? []) {
				if (c.t === to) return d;
				if (!seen.has(c.t)) {
					seen.add(c.t);
					next.push(c.t);
				}
			}
			frontier = next;
		}
		return null;
	};
	for (const b of machines) {
		b.parent = null;
		b.parentState = null;
		b.parentVia = null;
		b.depth = 0;
	}
	const parentDepth = /* @__PURE__ */ new Map();
	for (const a of machines) for (const b of machines) {
		if (a === b || a.functions.some((f) => b.functions.includes(f))) continue;
		let best = null;
		for (const st of a.states) {
			if (!st.location || !st.endLine) continue;
			const inCase = (index.calleesOf.get(st.function) ?? []).filter((c) => c.line >= st.location.line && c.line <= st.endLine);
			for (const c of inCase) for (const bf of b.functions) {
				const h = c.t === bf ? 1 : (() => {
					const n = hops(c.t, bf);
					return n == null ? null : n + 1;
				})();
				if (h != null && (!best || h < best.depth)) best = {
					depth: h,
					state: st.name,
					via: c.t
				};
			}
		}
		if (best && (b.parent == null || best.depth < parentDepth.get(b.id))) {
			b.parent = a.id;
			b.parentState = best.state;
			b.parentVia = best.via;
			parentDepth.set(b.id, best.depth);
		}
	}
	const byId = new Map(machines.map((m) => [m.id, m]));
	for (const m of machines) {
		let d = 0;
		let cur = m;
		while (cur?.parent) {
			d += 1;
			cur = byId.get(cur.parent);
			if (!cur || d > 6) break;
		}
		m.depth = d;
	}
	for (const m of machines) m.children = machines.filter((x) => x.parent === m.id).map((x) => x.id);
}
function attachCoupling(machines, index) {
	const fnByName = /* @__PURE__ */ new Map();
	for (const f of index.view.functions) if (index.inRegion(f.file)) fnByName.set(f.name, f);
	for (const a of machines) {
		a.waitsOn = [];
		const called = new Set(a.transitions.flatMap((t) => [...String(t.condition ?? "").matchAll(/([A-Za-z_]\w*)\s*\(/g)].map((x) => x[1])));
		for (const b of machines) {
			if (a === b) continue;
			const files = new Set(b.functions.map((f) => index.fileOf(f)));
			const via = [...called].filter((name) => files.has(fnByName.get(name)?.file));
			if (via.length) a.waitsOn.push({
				id: b.id,
				dispatch: b.dispatch,
				via
			});
		}
	}
}
function analyzeMachine(machine, index) {
	const byCase = machine.states.slice().sort((a, b) => (a.location?.line ?? 0) - (b.location?.line ?? 0)).map((s) => s.name);
	const succ = new Map(byCase.map((n) => [n, []]));
	const indeg = new Map(byCase.map((n) => [n, 0]));
	for (const t of machine.transitions) for (const f of t.from) if (succ.has(f) && succ.has(t.to) && f !== t.to && !succ.get(f).includes(t.to)) {
		succ.get(f).push(t.to);
		indeg.set(t.to, indeg.get(t.to) + 1);
	}
	const terminalNames = new Set(byCase.filter((n) => !(succ.get(n) ?? []).length));
	const order = [];
	const seen = /* @__PURE__ */ new Set();
	const visit = (n) => {
		if (seen.has(n) || terminalNames.has(n)) return;
		seen.add(n);
		order.push(n);
		for (const x of succ.get(n) ?? []) visit(x);
	};
	for (const n of byCase) if (indeg.get(n) === 0) visit(n);
	for (const n of byCase) visit(n);
	for (const n of byCase) if (terminalNames.has(n)) order.push(n);
	const extra = [...new Set(machine.transitions.map((t) => t.to).filter((n) => n && n !== "<expr>" && !order.includes(n)))];
	const names = [...order, ...extra];
	const idx = new Map(names.map((n, i) => [n, i]));
	const writers = new Set(machine.writersElsewhere ?? []);
	const helperWrites = new Map(machine.states.map((st) => [st.name, (index.calleesOf.get(machine.function) ?? []).filter((c) => writers.has(c.t) && st.location && st.endLine && c.line >= st.location.line && c.line <= st.endLine && !machine.transitions.some((t) => t.location?.line === c.line))]));
	const outDeg = new Map(names.map((n) => [n, 0]));
	const inDeg = new Map(names.map((n) => [n, 0]));
	const edges = [];
	for (const t of machine.transitions) for (const from of t.from) {
		if (!idx.has(from) || !idx.has(t.to)) continue;
		edges.push({
			from,
			to: t.to,
			transition: t
		});
		outDeg.set(from, outDeg.get(from) + 1);
		inDeg.set(t.to, inDeg.get(t.to) + 1);
	}
	const terminal = new Set(names.filter((n) => outDeg.get(n) === 0 && !(helperWrites.get(n) ?? []).length));
	const viaHelper = new Set(names.filter((n) => outDeg.get(n) === 0 && (helperWrites.get(n) ?? []).length));
	for (const e of edges) {
		const a = idx.get(e.from);
		const b = idx.get(e.to);
		e.kind = a === b ? "self" : terminal.has(e.to) ? "exit" : b === a + 1 ? "next" : b > a ? "jump" : "back";
	}
	const count = (kind) => edges.filter((e) => e.kind === kind).length;
	const helperCount = [...helperWrites.values()].reduce((sum, list) => sum + list.length, 0);
	const stats = {
		next: count("next"),
		jump: count("jump"),
		back: count("back"),
		self: count("self"),
		exit: count("exit"),
		helper: helperCount,
		total: edges.length,
		linearity: edges.length ? count("next") / edges.length : 0
	};
	const depth = new Map(names.map((n) => [n, 0]));
	const hasForwardIn = new Set(edges.filter((e) => idx.get(e.to) > idx.get(e.from)).map((e) => e.to));
	names.forEach((n, i) => {
		if (terminal.has(n)) return;
		if (i > 0 && !hasForwardIn.has(n) && !extra.includes(n)) depth.set(n, Math.max(depth.get(n), depth.get(names[i - 1]) + 1));
		for (const e of edges) if (e.from === n && idx.get(e.to) > idx.get(e.from) && !terminal.has(e.to)) depth.set(e.to, Math.max(depth.get(e.to), depth.get(n) + 1));
	});
	const deepest = Math.max(0, ...names.filter((n) => !terminal.has(n)).map((n) => depth.get(n)));
	for (const n of names) if (terminal.has(n)) depth.set(n, deepest + 1);
	const isrWriters = (machine.writersElsewhere ?? []).filter((f) => {
		const domain = index.domainOf(f);
		return index.isrIds.has(f) || domain === "isr" || domain === "mixed";
	});
	return {
		names,
		extra,
		edges,
		stats,
		terminal: [...terminal],
		viaHelper: [...viaHelper],
		helperWrites: Object.fromEntries([...helperWrites].filter(([, v]) => v.length).map(([k, v]) => [k, v])),
		outDeg: Object.fromEntries(outDeg),
		inDeg: Object.fromEntries(inDeg),
		depth: Object.fromEntries(depth),
		maxDepth: deepest + (names.some((n) => terminal.has(n)) ? 1 : 0),
		start: names.filter((n) => (inDeg.get(n) ?? 0) === 0 && !terminal.has(n)),
		noIn: names.filter((n) => (inDeg.get(n) ?? 0) === 0 && !extra.includes(n)),
		isrWriters
	};
}
function buildStateTransitions(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const ast = index.ast;
	if (!ast.present) return {
		theme: "state-transitions",
		available: false,
		reason: "no-ast-facts",
		machines: [],
		dispatchTables: []
	};
	const raw = ast.stateMachines ?? [];
	const dispatchTables = raw.filter((m) => !m.transitions.length).map((m) => ({
		id: idOf.machine(m.dispatchVariable, m.location?.path, m.dispatch),
		dispatch: m.dispatch,
		function: m.function,
		location: m.location,
		cases: m.states.length
	}));
	const machines = mergeMachines(raw.filter((m) => m.transitions.length));
	attachOwners(machines, index);
	attachNesting(machines, index);
	attachCoupling(machines, index);
	for (const m of machines) {
		m.analysis = analyzeMachine(m, index);
		m.states = m.states.map((st) => ({
			...st,
			id: idOf.state(m.id, st.name)
		}));
		m.file = index.fileOf(m.function);
		m.analysis.verdict = linearityVerdict(m.analysis.stats);
		m.enumTable = enumTableFor(m, m.analysis, ast.enums ?? []);
	}
	for (const m of machines.filter((m) => m.analysis.stats.total === 0)) dispatchTables.push({
		id: m.id,
		dispatch: m.dispatch,
		function: m.function,
		location: m.location,
		cases: m.states.length,
		demoted: true
	});
	const kept = machines.filter((m) => m.analysis.stats.total > 0);
	machines.length = 0;
	machines.push(...kept);
	machines.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence) || b.transitions.length - a.transitions.length);
	return {
		theme: "state-transitions",
		available: true,
		basis: t("The engine treats switch(variable) as a state-machine candidate: case labels are states, assignments to the dispatch variable inside the switch are transitions, and the enclosing if conditions approximate the transition conditions"),
		machines,
		dispatchTables
	};
}
/** 线性度的判词。阈值照原型：顺序前进占六成以上是「像用 switch 写的过程」，跳跃加回退多于顺序前进才是「真正的状态机」。 */
function linearityVerdict(stats) {
	if (!stats || stats.total === 0) return t("Dispatch only, no transitions");
	if (Math.round((stats.linearity ?? 0) * 100) >= 60) return t("Mostly sequential: reads like a procedure written with switch; back and jump edges are exception paths");
	if (stats.back + stats.jump > stats.next) return t("Mesh: jumps and backs outnumber forward steps — a real state machine");
	return t("Mixed: neither forward steps nor jumps and backs dominate");
}
/**
* 枚举一览：把这台机器的状态名对到引擎给的枚举定义上，列出每个成员有没有 case、
* 入出度、break 数和角色。「未在 switch 出现」的成员是设计和实现对不上的地方；
* 引擎没给出枚举定义时退回 switch 里出现过的标签。
*/
function enumTableFor(machine, analysis, enums) {
	const names = new Set(analysis.names ?? []);
	const get = (m, k) => (m instanceof Map ? m.get(k) : m?.[k]) ?? 0;
	const candidates = (enums ?? []).filter((e) => (e.members ?? []).some((x) => names.has(x.name)));
	candidates.sort((x, y) => y.members.filter((mm) => names.has(mm.name)).length - x.members.filter((mm) => names.has(mm.name)).length);
	const best = machine.enumType ? candidates.find((e) => e.name === machine.enumType) ?? candidates[0] ?? null : candidates[0] ?? null;
	const members = best ? best.members.map((mm) => ({
		name: mm.name,
		value: mm.value ?? null
	})) : [...names].map((n) => ({
		name: n,
		value: null
	}));
	const terminal = new Set(analysis.terminal ?? []);
	const depthOf = (n) => (analysis.depth instanceof Map ? analysis.depth.get(n) : analysis.depth?.[n]) ?? 0;
	const order = analysis.names ?? [];
	const fallback = order.slice().sort((x, y) => depthOf(x) - depthOf(y) || order.indexOf(x) - order.indexOf(y))[0];
	const start = new Set((analysis.start ?? []).length ? analysis.start : fallback ? [fallback] : []);
	const extra = new Set(analysis.extra ?? []);
	const rows = members.slice().sort((x, y) => (Number(x.value) || 0) - (Number(y.value) || 0) || x.name.localeCompare(y.name)).map((mm) => {
		const inMachine = names.has(mm.name);
		const state = machine.states.find((st) => st.name === mm.name) ?? null;
		const role = !inMachine ? t("not in the switch") : start.has(mm.name) ? t("start") : terminal.has(mm.name) ? t("terminal") : extra.has(mm.name) ? t("transition target only") : "";
		return {
			name: mm.name,
			value: mm.value,
			inMachine,
			isCase: Boolean(state),
			inDeg: inMachine ? get(analysis.inDeg, mm.name) : null,
			outDeg: inMachine ? get(analysis.outDeg, mm.name) : null,
			guards: (state?.guards ?? []).length,
			role
		};
	});
	return {
		enum: best ? {
			name: best.name,
			location: best.location ?? null,
			members: best.members.length
		} : null,
		rows,
		unused: rows.filter((r) => !r.inMachine).length
	};
}
//#endregion
//#region packages/facts-view/src/memory/model.mjs
var bytes = (n) => Number(n ?? 0);
function buildMemory(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const image = view.imageFacts ?? null;
	if (!image) return {
		theme: "memory",
		available: false,
		reason: "no-image-facts",
		hint: t("The facts have no imageFacts. The project needs a link artifact (an armlink / Keil .map) and the scan must have read it."),
		modules: [],
		symbols: [],
		totals: null,
		scoped: null,
		staleness: null,
		artifact: null
	};
	const shared = new Map((index.ast.sharedResources ?? []).map((r) => [r.name, r]));
	const byModule = /* @__PURE__ */ new Map();
	for (const object of image.objects ?? []) {
		const key = index.fileById.get(object.sourcePath)?.module ?? String(object.sourcePath ?? "").split("/").slice(0, 2).join("/") ?? "?";
		const row = byModule.get(key) ?? {
			id: idOf.memoryModule(key),
			module: key,
			files: 0,
			code: 0,
			ro: 0,
			rw: 0,
			zi: 0,
			objects: []
		};
		row.files += 1;
		row.code += bytes(object.codeBytes);
		row.ro += bytes(object.roDataBytes);
		row.rw += bytes(object.rwDataBytes);
		row.zi += bytes(object.ziDataBytes);
		row.objects.push({
			path: object.path,
			sourcePath: object.sourcePath ?? null,
			match: object.match ?? null,
			code: bytes(object.codeBytes),
			ro: bytes(object.roDataBytes),
			rw: bytes(object.rwDataBytes),
			zi: bytes(object.ziDataBytes)
		});
		byModule.set(key, row);
	}
	const modules = [...byModule.values()].map((r) => ({
		...r,
		rom: r.code + r.ro + r.rw,
		ram: r.rw + r.zi
	}));
	modules.sort((a, b) => b.ram - a.ram || b.rom - a.rom);
	const symbols = (image.symbols ?? []).filter((s) => s.kind !== "code").map((s) => {
		const resource = shared.get(s.name);
		return {
			id: idOf.memorySymbol(s.sourcePath ?? "", s.name),
			name: s.name,
			section: s.section ?? null,
			size: bytes(s.sizeBytes),
			scope: s.scope ?? null,
			file: s.sourcePath ?? null,
			line: index.varAt(s.symbolId).line,
			module: index.fileById.get(s.sourcePath)?.module ?? null,
			sharedUnits: resource ? (resource.units ?? []).map((u) => ({
				unit: u.unit,
				kind: u.unitKind
			})) : [],
			touchedByIsr: Boolean(resource?.units?.some((u) => u.unitKind === "isr"))
		};
	});
	symbols.sort((a, b) => b.size - a.size);
	const sharedSymbols = symbols.filter((s) => s.sharedUnits.length > 0);
	const artifact = image.artifact ?? null;
	return {
		theme: "memory",
		available: true,
		basis: t("Sizes come from the link artifact; module attribution comes from source facts: each object file is traced back to its source file by the functions it defines"),
		artifact: artifact ? {
			path: artifact.path,
			kind: artifact.kind ?? null,
			modified: artifact.modified ?? null
		} : null,
		totals: image.totals ?? null,
		scoped: image.scopedTotals ?? null,
		staleness: image.staleness ?? null,
		approximations: image.approximations ?? [],
		matchedByFunctions: (image.objects ?? []).filter((o) => o.match === "functions").length,
		objectCount: (image.objects ?? []).length,
		modules,
		symbols,
		sharedBytes: sharedSymbols.reduce((n, s) => n + s.size, 0),
		sharedCount: sharedSymbols.length
	};
}
//#endregion
//#region packages/facts-view/src/deps/model.mjs
var parentDir = (p) => {
	const i = p.lastIndexOf("/");
	return i < 0 ? "" : p.slice(0, i);
};
function aggregateEdges(edges, mapS, mapT) {
	const out = /* @__PURE__ */ new Map();
	for (const e of edges) {
		const s = mapS(e.s ?? e.source);
		const t = (mapT ?? mapS)(e.t ?? e.target);
		if (!s || !t || s === t) continue;
		const id = `${s}→${t}`;
		const rec = out.get(id) ?? {
			id,
			s,
			t,
			includes: 0,
			calls: 0,
			bypass: 0,
			typeOnly: 0,
			types: 0,
			macros: 0,
			reads: 0,
			writes: 0,
			pairs: [],
			files: {}
		};
		rec.includes += e.includes ?? 0;
		rec.calls += e.calls ?? 0;
		rec.bypass += e.bypass ?? e.bypassCalls ?? 0;
		rec.typeOnly += e.typeOnly ?? e.typeOnlyIncludes ?? 0;
		rec.types += e.types ?? 0;
		rec.macros += e.macros ?? 0;
		rec.reads += e.reads ?? 0;
		rec.writes += e.writes ?? 0;
		if (e.pairs) {
			rec.pairs.push(...e.pairs);
			for (const [k, v] of Object.entries(e.files ?? {})) rec.files[k] = (rec.files[k] ?? 0) + v;
		} else {
			rec.pairs.push({
				s: e.source,
				t: e.target
			});
			const k = `${e.source}→${e.target}`;
			rec.files[k] = (rec.files[k] ?? 0) + ((e.includes ?? 0) + (e.calls ?? 0) || 1);
		}
		out.set(id, rec);
	}
	return [...out.values()];
}
function buildDependencies(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const order = view.dependencyOrder ?? null;
	if (!order?.files) return {
		theme: "dependencies",
		available: false,
		reason: "no-dependency-order",
		hint: t("The facts have no dependencyOrder; rescan with a newer engine."),
		leaves: [],
		edges: []
	};
	const units = order.units ?? null;
	const unitOf = (f) => units?.unitOf?.[f] ?? f;
	const membersOf = (u) => units?.members?.[u] ?? [u];
	const regionFiles = view.files.filter((f) => f.path.startsWith(view.region) && !f.path.startsWith("lib:"));
	const fileEdges = (order.files.edges ?? []).filter((e) => !String(e.source).startsWith("lib:") && !String(e.target).startsWith("lib:"));
	const leafSet = new Set(regionFiles.map((f) => unitOf(f.path)));
	for (const e of fileEdges) {
		leafSet.add(unitOf(e.source));
		leafSet.add(unitOf(e.target));
	}
	const leafEdges = aggregateEdges(fileEdges, unitOf);
	const leaves = [...leafSet].map((u) => {
		const members = membersOf(u);
		const source = members.find((f) => /\.c(c|pp|xx)?$/i.test(f)) ?? members[0];
		const suffixes = members.map((f) => f.split(".").pop()).sort((a, b) => (a.startsWith("c") ? -1 : 1) - (b.startsWith("c") ? -1 : 1));
		return {
			id: `unit:${u}`,
			unit: u,
			members,
			label: members.length === 1 ? members[0].split("/").pop() : `${u.split("/").pop()}.${suffixes.join("/")}`,
			file: source,
			dir: parentDir(u),
			module: index.fileById.get(source)?.module ?? null
		};
	});
	const clusters = order.clusters ?? null;
	return {
		theme: "dependencies",
		available: true,
		basis: t("Leaves are units: a source file plus the same-named header in its directory. All eight quantities on an edge come from the engine; row and column order is computed by peeling sources and sinks then tearing, with no declared layers"),
		region: view.region,
		leaves,
		edges: leafEdges,
		projectFeedback: (order.units?.feedback ?? order.files.feedback ?? []).length,
		fileFeedback: (order.files.feedback ?? []).length,
		fileEdgeCount: fileEdges.length,
		regionFileCount: regionFiles.length,
		pairedUnits: units ? Object.values(units.members).filter((m) => m.length > 1).length : 0,
		clusters: clusters ? {
			of: Object.fromEntries(clusters.clusters.flatMap((members, i) => members.map((f) => [f, i]))),
			stability: clusters.stability ?? {},
			params: clusters.params ?? null,
			count: clusters.clusters.length,
			cost: clusters.cost ?? null,
			initialCost: clusters.initialCost ?? null,
			iterations: clusters.iterations ?? 0
		} : null,
		counts: {
			contractBypass: (view.contractBypass ?? []).length,
			typeOnlyIncludes: (view.typeOnlyIncludes ?? []).length,
			crossFileTypeUses: (view.typeUses ?? []).filter((u) => u.def && index.fnById.get(u.fn)?.file && index.fnById.get(u.fn).file !== u.def.path).length,
			crossFileMacroUses: (view.macroUses ?? []).filter((u) => u.def && u.def.path !== u.file).length
		}
	};
}
//#endregion
//#region packages/facts-view/src/execution/model.mjs
var SCHEDULER_BY_RULE = { "protothreads.thread_create": "thread_run" };
function buildExecution(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const entries = index.entries ?? {};
	if (!entries.units) return {
		theme: "execution",
		available: false,
		reason: "no-entries",
		hint: t("The facts have no execution units; a schema 2 or newer scan is required."),
		roots: []
	};
	const nameOf = (id) => index.nameOf(id);
	const regById = new Map((entries.registrations ?? []).map((r) => [r.id, r]));
	const schedulerNames = new Set((entries.registrations ?? []).map((r) => SCHEDULER_BY_RULE[r.rule]).filter(Boolean));
	const roots = [];
	if (entries.main) roots.push({
		id: `exec:${entries.main}`,
		symbol: entries.main,
		kind: "main",
		name: nameOf(entries.main),
		file: index.fileOf(entries.main)
	});
	for (const isr of entries.isrs ?? []) roots.push({
		id: `exec:${isr.id}`,
		symbol: isr.id,
		kind: "isr",
		name: nameOf(isr.id),
		file: index.fileOf(isr.id),
		vector: isr.vector ?? null,
		kernel: Boolean(isr.kernel),
		enabledAt: isr.enabledAt ?? []
	});
	for (const reg of entries.registrations ?? []) roots.push({
		id: `exec:${reg.id}`,
		symbol: reg.id,
		kind: reg.kind,
		name: nameOf(reg.id),
		file: index.fileOf(reg.id),
		rule: reg.rule ?? null,
		registrars: reg.registrars ?? []
	});
	const reachCount = (id) => Math.max(0, index.reachOf(id).size - 1);
	for (const root of roots) root.reaches = reachCount(root.symbol);
	return {
		theme: "execution",
		available: true,
		basis: t("Entries, execution units and reachability come from the engine; the scheduling hop is inferred from framework rules and marked as such"),
		roots,
		counts: entries.counts ?? null,
		unreached: (entries.unreached ?? []).map((id) => ({
			id,
			name: nameOf(id),
			file: index.fileOf(id)
		})),
		duplicates: entries.duplicates ?? [],
		externDeclarations: entries.externDeclarations ?? [],
		schedulerNames: [...schedulerNames],
		hasScheduleHop: schedulerNames.size > 0,
		regRules: Object.fromEntries([...regById].map(([id, r]) => [id, r.rule ?? null])),
		compare: compareMatrix(view, { index })
	};
}
/** 中断 × 任务的共用函数数。全空的行列不画（席克定律），只在注脚说藏了多少。 */
function compareMatrix(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const entries = index.entries ?? {};
	const nameOf = (id) => index.nameOf(id);
	const isrs = (entries.isrs ?? []).map((i) => i.id);
	const others = [entries.main, ...(entries.registrations ?? []).map((r) => r.id)].filter(Boolean);
	const inRegion = (id) => index.inRegion(index.fileOf(id) ?? "");
	const count = (a, b) => {
		const ra = index.reachOf(a), rb = index.reachOf(b);
		let n = 0;
		for (const id of ra) if (rb.has(id) && inRegion(id)) n += 1;
		return n;
	};
	const cells = {};
	for (const a of isrs) {
		cells[a] = {};
		for (const b of others) cells[a][b] = count(a, b);
	}
	const rows = isrs.filter((a) => others.some((b) => cells[a][b] > 0));
	const cols = others.filter((b) => isrs.some((a) => cells[a][b] > 0));
	const kindOf = (id) => id === entries.main ? "main" : (entries.registrations ?? []).find((r) => r.id === id)?.kind ?? "task";
	return {
		rows: rows.map((id) => ({
			id,
			name: nameOf(id)
		})),
		cols: cols.map((id) => ({
			id,
			name: nameOf(id),
			kind: kindOf(id)
		})),
		cells: Object.fromEntries(rows.map((a) => [a, Object.fromEntries(cols.map((b) => [b, cells[a][b]]))])),
		hiddenIsrs: isrs.length - rows.length,
		hiddenOthers: others.length - cols.length,
		allIsrs: isrs.map((id) => ({
			id,
			name: nameOf(id)
		})),
		allOthers: others.map((id) => ({
			id,
			name: nameOf(id),
			kind: kindOf(id)
		}))
	};
}
//#endregion
//#region packages/facts-view/src/concurrency/runmap.mjs
var WRITE_KINDS$1 = /* @__PURE__ */ new Set(["write", "read_write"]);
var READ_KINDS$1 = /* @__PURE__ */ new Set(["read", "read_write"]);
var writes = (u) => (u.kinds ?? []).some((k) => WRITE_KINDS$1.has(k));
var reads = (u) => (u.kinds ?? []).some((k) => READ_KINDS$1.has(k));
var bareWrite = (u) => (u.unprotectedKinds ?? []).some((k) => WRITE_KINDS$1.has(k));
var bareRead = (u) => (u.unprotectedKinds ?? []).some((k) => READ_KINDS$1.has(k));
var FLOW_LABEL = {
	"isr→thread": "Interrupt produces → thread consumes",
	"thread→isr": "Thread produces → interrupt consumes",
	mixed: "Both interrupt and thread write",
	"isr↔isr": "Between interrupts",
	"thread↔thread": "Between threads"
};
function buildRunMap(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const entries = index.entries ?? {};
	const ast = index.ast ?? {};
	const shortName = (unitId) => String(unitId).split(":").slice(1).join(":");
	const byUnit = /* @__PURE__ */ new Map();
	for (const i of entries.isrs ?? []) byUnit.set(i.unitId, {
		id: i.unitId,
		fn: i.id,
		kind: "isr",
		name: index.nameOf(i.id),
		preempt: i.priority?.preempt ?? null,
		vector: i.vector ?? null,
		kernel: Boolean(i.kernel)
	});
	for (const r of entries.registrations ?? []) {
		const hosts = (r.hosts ?? []).filter((h) => !String(h).startsWith("main:"));
		byUnit.set(r.unitId, {
			id: r.unitId,
			fn: r.id,
			kind: r.kind === "task" ? "task" : "callback",
			name: index.nameOf(r.id),
			hosts,
			host: hosts.length === 1 ? hosts[0] : null,
			hostConfidence: r.hostConfidence ?? null,
			mode: ast.runModes?.[r.unitId]?.mode ?? null,
			periodMs: ast.runModes?.[r.unitId]?.periodMs ?? null
		});
	}
	for (const r of ast.sharedResources ?? []) for (const u of r.units ?? []) {
		if (u.unitKind === "main" || byUnit.has(u.unit)) continue;
		byUnit.set(u.unit, {
			id: u.unit,
			fn: u.accesses?.[0]?.function ?? null,
			kind: u.unitKind,
			name: shortName(u.unit),
			hosts: [],
			host: null
		});
	}
	const mainFn = entries.main ?? null;
	const mainUnit = entries.mainUnit ?? "main:main";
	const mainFnFact = mainFn ? index.fnById.get(mainFn) : null;
	const mainLoop = !mainFn ? null : entries.mainSuperloop && mainFnFact ? {
		location: { line: mainFnFact.line },
		endLine: mainFnFact.endLine ?? Infinity,
		callsInBody: (index.calleesOf.get(mainFn) ?? []).map((c) => c.t)
	} : (index.loopsByFn.get(mainFn) ?? []).filter((l) => l.infinite && !l.depth).sort((a, b) => a.location.line - b.location.line)[0] ?? null;
	const loopReach = mainLoop ? new Set((mainLoop.callsInBody ?? []).flatMap((c) => [...index.reachOf(c)])) : /* @__PURE__ */ new Set();
	const inMainLoop = (acc) => Boolean(mainLoop) && (acc.function === mainFn ? (acc.location?.line ?? 0) >= mainLoop.location.line && (acc.location?.line ?? 0) <= mainLoop.endLine : loopReach.has(acc.function));
	if (mainLoop) {
		const rm = ast.runModes?.[mainUnit] ?? null;
		byUnit.set(mainUnit, {
			id: mainUnit,
			fn: mainFn,
			kind: "main",
			name: index.nameOf(mainFn),
			hosts: [],
			host: null,
			mode: rm?.mode ?? null,
			periodMs: rm?.periodMs ?? null,
			loop: {
				line: mainLoop.location.line,
				endLine: mainLoop.endLine
			}
		});
	}
	const loopPart = (u) => {
		if (u.unitKind !== "main" || !mainLoop || u.unit !== mainUnit) return null;
		const inside = (u.accesses ?? []).filter(inMainLoop);
		if (!inside.length) return null;
		const kinds = [...new Set(inside.map((a) => a.kind))];
		const has = (k) => kinds.some((x) => x === k || x === "read_write");
		const unprotected = (u.unprotectedKinds ?? []).filter((k) => k === "read_write" || has(k));
		return {
			...u,
			kinds,
			unprotectedKinds: unprotected,
			accesses: inside,
			accessCount: inside.length
		};
	};
	const effective = (unitId) => byUnit.get(unitId)?.host ?? unitId;
	const conflictByName = new Map((ast.conflictCandidates ?? []).map((c) => [c.name, c]));
	const wakeByName = new Map((ast.wakeRelations ?? []).map((w) => [w.name, w]));
	const vars = [];
	const mainInit = [];
	for (const r of ast.sharedResources ?? []) {
		const units = (r.units ?? []).map((u) => u.unitKind === "main" ? loopPart(u) : u).filter((u) => u && byUnit.has(u.unit));
		const mainW = (r.units ?? []).some((u) => u.unitKind === "main" && (u.accesses ?? []).some((a) => WRITE_KINDS$1.has(a.kind) && !inMainLoop(a)) || u.unitKind === "main" && !(u.accesses ?? []).length && writes(u));
		if (mainW) mainInit.push(r.name);
		if (units.length < 2) continue;
		const writers = units.filter(writes);
		const readers = units.filter(reads);
		const writerGroups = [...new Set(writers.map((u) => effective(u.unit)))];
		const isrW = writers.some((u) => u.unitKind === "isr"), thW = writers.some((u) => u.unitKind !== "isr");
		const isrR = readers.some((u) => u.unitKind === "isr"), thR = readers.some((u) => u.unitKind !== "isr");
		const isrTouched = units.some((u) => u.unitKind === "isr"), thTouched = units.some((u) => u.unitKind !== "isr");
		const conflict = conflictByName.get(r.name) ?? null;
		const wake = wakeByName.get(r.name) ?? null;
		const multiWriter = writerGroups.length > 1;
		const owner = writerGroups.length === 1 ? writerGroups[0] : writerGroups.length === 0 ? mainW ? mainUnit : "none" : null;
		const flow = isrW && thW ? "mixed" : isrW ? thR ? "isr→thread" : "isr↔isr" : isrR ? "thread→isr" : "thread↔thread";
		const wProt = writers.length > 0 && writers.every((u) => !bareWrite(u));
		const wBare = writers.some(bareWrite);
		const rProt = readers.length > 0 && readers.every((u) => !bareRead(u));
		const rBare = readers.some(bareRead);
		const protectedAll = units.every((u) => !(u.unprotectedKinds ?? []).length);
		const atomicity = r.atomicity ?? "unknown";
		vars.push({
			id: r.variable ?? `name:${r.name}`,
			name: r.name,
			typeName: r.type_name ?? r.typeName ?? null,
			units: units.map((u) => ({
				unit: u.unit,
				kind: u.unitKind,
				write: writes(u),
				read: reads(u),
				bareWrite: bareWrite(u),
				bareRead: bareRead(u),
				accesses: (u.accesses ?? []).length
			})),
			writers: writers.map((u) => u.unit),
			readers: readers.map((u) => u.unit),
			writerGroups,
			owner,
			multiWriter,
			domain: isrW ? "isr" : "thread",
			layer: multiWriter ? 1 : isrW ? 0 : 2,
			flow,
			cross: isrTouched && thTouched,
			pollution: isrW && thW,
			conflict: conflict ? conflict.confidence : null,
			wake: wake ? wake.kind : null,
			protMismatch: isrTouched && thTouched && (wProt && rBare || rProt && wBare),
			protectedAll,
			nonAtomic: isrTouched && thTouched && (atomicity === "composite" || atomicity === "wide") && !protectedAll
		});
	}
	const isrs = [...byUnit.values()].filter((n) => n.kind === "isr").sort((a, b) => (a.preempt ?? 99) - (b.preempt ?? 99) || (a.vector ?? 0) - (b.vector ?? 0));
	const tasks = (entries.registrations ?? []).filter((r) => r.kind === "task").map((r) => byUnit.get(r.unitId)).filter(Boolean);
	const cbs = [...byUnit.values()].filter((n) => n.kind === "callback" || n.kind !== "isr" && n.kind !== "task" && n.kind !== "main");
	const threads = [];
	for (const t of tasks) {
		threads.push(t);
		for (const c of cbs.filter((c) => c.host === t.id)) threads.push(c);
	}
	for (const c of cbs.filter((c) => !c.host || !tasks.some((t) => t.id === c.host))) threads.push(c);
	if (byUnit.has(mainUnit)) threads.push(byUnit.get(mainUnit));
	const used = new Set(vars.flatMap((v) => v.units.map((u) => u.unit)));
	const worst = {};
	for (const n of byUnit.values()) {
		const mine = vars.filter((v) => v.units.some((u) => u.unit === n.id));
		worst[n.id] = mine.some((v) => v.conflict) ? "conflict" : mine.some((v) => v.pollution && v.writers.includes(n.id) && n.kind !== "isr") ? "pollution" : mine.some((v) => v.protMismatch) ? "mismatch" : mine.length ? "shared" : "idle";
	}
	const count = (f) => vars.filter(f).length;
	return {
		isrs,
		threads,
		vars,
		used: [...used],
		mainInit,
		worst,
		flows: Object.fromEntries(Object.keys(FLOW_LABEL).map((k) => [k, count((v) => v.flow === k)])),
		problems: {
			conflict: count((v) => v.conflict),
			pollution: count((v) => v.pollution),
			mismatch: count((v) => v.protMismatch),
			nonAtomic: count((v) => v.nonAtomic),
			wake: count((v) => v.wake)
		}
	};
}
//#endregion
//#region packages/facts-view/src/concurrency/model.mjs
var UNIT_ORDER = {
	isr: 0,
	task: 1,
	callback: 2,
	timer: 3,
	main: 4
};
var WRITE_KINDS = /* @__PURE__ */ new Set(["write", "read_write"]);
var READ_KINDS = /* @__PURE__ */ new Set(["read", "read_write"]);
/** 一个单元对一个变量做了什么，压成一个字形：写 / 读写 / 读 / 取地址。 */
function glyphOf(kinds) {
	const set = new Set(kinds);
	const w = [...set].some((k) => WRITE_KINDS.has(k));
	const r = [...set].some((k) => READ_KINDS.has(k));
	if (w && r) return "rw";
	if (w) return "w";
	if (r) return "r";
	return "addr";
}
function buildConcurrency(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const ast = index.ast;
	if (!ast.present) return {
		theme: "concurrency",
		available: false,
		reason: "no-ast-facts",
		hint: t("This scan has no AST-level facts, so reads, writes and execution domains are invisible. A full scan with build information is required."),
		resources: [],
		units: []
	};
	const conflictByName = new Map((ast.conflictCandidates ?? []).map((c) => [c.name, c]));
	const wakeByName = new Map((ast.wakeRelations ?? []).map((w) => [w.name, w]));
	const rows = (ast.sharedResources ?? []).filter((r) => r.units.length >= 2 && r.units.some((u) => u.unitKind === "isr")).map((r) => {
		const conflict = conflictByName.get(r.name) ?? null;
		const wake = wakeByName.get(r.name) ?? null;
		return {
			id: idOf.resource(r.variable, r.name),
			name: r.name,
			variable: r.variable ?? null,
			file: r.variable ? index.varAt(r.variable).file : null,
			line: r.variable ? index.varAt(r.variable).line : null,
			volatile: Boolean(r.volatile),
			atomicity: r.atomicity ?? "unknown",
			typeName: r.type_name ?? r.typeName ?? null,
			units: (r.units ?? []).map((u) => ({
				unit: u.unit,
				kind: u.unitKind,
				glyph: glyphOf(u.kinds ?? []),
				kinds: u.kinds ?? [],
				protected: Boolean((u.kinds ?? []).length) && !(u.unprotectedKinds ?? []).length,
				accesses: (u.accesses ?? []).length,
				derived: (u.accesses ?? []).some((a) => a.derived)
			})),
			conflict: conflict ? {
				confidence: conflict.confidence,
				pattern: conflict.pattern,
				reason: conflict.reason ?? null,
				role: conflict.role ?? null,
				approximation: conflict.approximation ?? null
			} : null,
			wake: wake ? {
				kind: wake.kind,
				confidence: wake.confidence ?? "medium",
				producers: (wake.producers ?? []).length,
				consumers: (wake.consumers ?? []).length
			} : null
		};
	});
	rows.sort((x, y) => confidenceRank(y.conflict?.confidence) - confidenceRank(x.conflict?.confidence) || (x.wake ? 1 : 0) - (y.wake ? 1 : 0) || y.units.length - x.units.length || x.name.localeCompare(y.name));
	const units = [...new Map(rows.flatMap((r) => r.units.map((u) => [u.unit, u.kind]))).entries()].sort((a, b) => (UNIT_ORDER[a[1]] ?? 9) - (UNIT_ORDER[b[1]] ?? 9) || a[0].localeCompare(b[0])).map(([unit, kind]) => ({
		unit,
		kind,
		label: unit.split(":").slice(1).join(":")
	}));
	const isrs = (index.entries.isrs ?? []).map((i) => ({
		kernel: Boolean(i.kernel),
		id: i.id,
		name: index.nameOf(i.id),
		file: index.fileOf(i.id),
		vector: i.vector ?? null,
		preempt: i.priority?.preempt ?? null,
		sub: i.priority?.sub ?? null,
		registeredAt: i.registeredAt ? {
			id: i.registeredAt.id,
			name: index.nameOf(i.registeredAt.id),
			line: i.registeredAt.line
		} : null,
		rule: i.rule ?? null,
		enabled: Boolean(i.kernel) || (i.enabledAt ?? []).length > 0 || Boolean(i.registeredAt)
	})).sort((a, b) => (a.preempt ?? 99) - (b.preempt ?? 99) || (a.vector ?? 0) - (b.vector ?? 0));
	return {
		theme: "concurrency",
		available: true,
		basis: t("Reads, writes and execution domains come from the engine; a conflict is a candidate, not a verdict — the engine cannot see cross-function or conditional protection"),
		resources: rows,
		units,
		isrs,
		runMap: buildRunMap(view, { index }),
		criticalSections: (ast.criticalSections ?? []).map((c) => ({
			function: c.function,
			name: index.nameOf(c.function),
			file: index.fileOf(c.function),
			begin: c.begin ?? null,
			end: c.end ?? null,
			api: c.api,
			endApi: c.endApi ?? c.end_api ?? null,
			kind: c.kind,
			accesses: (c.accessesInside ?? c.accesses_inside ?? []).length
		})),
		counts: {
			high: (ast.conflictCandidates ?? []).filter((c) => c.confidence === "high").length,
			medium: (ast.conflictCandidates ?? []).filter((c) => c.confidence === "medium").length,
			shared: rows.length,
			wake: (ast.wakeRelations ?? []).length,
			criticalSections: (ast.criticalSections ?? []).length,
			criticalSectionsTotal: ast.criticalSectionsTotal ?? (ast.criticalSections ?? []).length,
			accesses: (ast.resourceAccesses ?? []).length
		}
	};
}
//#endregion
//#region packages/facts-view/src/timing/sequence.mjs
var MAX_CALL_DEPTH = 7;
var MAX_LEVELS = 4;
function sliceOf(index, fnId, from, to) {
	const inRange = (line) => line != null && line >= from && line <= to;
	const events = [];
	for (const c of index.calleesOf.get(fnId) ?? []) if (inRange(c.line) && (index.inRegion(index.fileOf(c.t)) || index.fnById.get(c.t)?.external)) events.push({
		type: "call",
		fn: fnId,
		line: c.line,
		target: c.t,
		kind: c.kind ?? "call"
	});
	for (const a of index.accessesByFn.get(fnId) ?? []) if (inRange(a.location?.line) && (index.sharedByName.has(a.name) || index.conflictByName.has(a.name))) events.push({
		type: "access",
		fn: fnId,
		line: a.location.line,
		name: a.name,
		kind: a.kind,
		inCritical: Boolean(a.inCriticalSection),
		via: a.via ?? null
	});
	for (const l of index.loopsByFn.get(fnId) ?? []) for (const b of l.blockingCalls ?? []) if (inRange(b.location?.line)) events.push({
		type: "wait",
		fn: fnId,
		line: b.location.line,
		callee: b.callee,
		kind: b.kind
	});
	const seen = /* @__PURE__ */ new Set();
	const deduped = events.filter((e) => {
		const key = `${e.type}:${e.line}:${e.target ?? e.name ?? e.callee}:${e.kind}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	deduped.sort((x, y) => x.line - y.line || (x.type === "wait" ? 1 : 0) - (y.type === "wait" ? 1 : 0));
	return {
		events: deduped,
		frames: (index.blocksByFn.get(fnId) ?? []).filter((b) => b.kind !== "do" && !(b.location.line <= from && b.endLine >= to) && b.location.line >= from && b.endLine <= to).map((b) => ({
			fn: fnId,
			kind: b.kind,
			from: b.location.line,
			to: b.endLine,
			condition: b.condition ?? null,
			labels: b.labels ?? [],
			depth: b.depth,
			isLoop: ["while", "for"].includes(b.kind)
		})),
		crits: (index.critByFn.get(fnId) ?? []).filter((c) => inRange(c.begin?.line)).map((c) => ({
			fn: fnId,
			from: c.begin.line,
			to: c.end?.line ?? to,
			api: c.api,
			unterminated: Boolean(c.unterminated)
		}))
	};
}
function nest(index, fnId, from, to) {
	const { events, frames, crits } = sliceOf(index, fnId, from, to);
	const nodes = frames.sort((a, b) => a.from - b.from || b.to - a.to).map((f) => ({
		...f,
		type: "frame",
		children: []
	}));
	const roots = [];
	const stack = [];
	for (const n of nodes) {
		while (stack.length && !(stack[stack.length - 1].from <= n.from && n.to <= stack[stack.length - 1].to)) stack.pop();
		(stack.length ? stack[stack.length - 1].children : roots).push(n);
		stack.push(n);
	}
	const innermost = (line) => nodes.filter((n) => n.from <= line && line <= n.to).sort((a, b) => a.to - a.from - (b.to - b.from))[0] ?? null;
	for (const e of events) {
		const f = innermost(e.line);
		(f ? f.children : roots).push({
			...e,
			children: null
		});
	}
	const sortRec = (list) => {
		list.sort((a, b) => (a.line ?? a.from) - (b.line ?? b.from));
		for (const n of list) if (n.type === "frame") sortRec(n.children);
	};
	sortRec(roots);
	return {
		roots,
		crits
	};
}
function calleeSummary(index, target, chain) {
	const t = index.fnById.get(target);
	if (!t || t.external || !index.inRegion(t.file) || !t.endLine) return {
		accesses: [],
		yields: [],
		deepYield: false,
		loops: 0
	};
	const { events } = sliceOf(index, target, t.line, t.endLine);
	const acc = /* @__PURE__ */ new Map();
	for (const e of events) {
		if (e.type !== "access") continue;
		const cur = acc.get(e.name) ?? {
			name: e.name,
			kinds: /* @__PURE__ */ new Set(),
			inCritical: true,
			line: e.line
		};
		cur.kinds.add(e.kind);
		if (!e.inCritical) cur.inCritical = false;
		acc.set(e.name, cur);
	}
	let deepYield = false;
	for (const e of events) {
		if (e.type !== "call" || chain.includes(e.target)) continue;
		const tt = index.fnById.get(e.target);
		if (tt && index.inRegion(tt.file) && (index.loopsByFn.get(e.target) ?? []).some((l) => (l.blockingCalls ?? []).length)) {
			deepYield = true;
			break;
		}
	}
	return {
		accesses: [...acc.values()].map((a) => ({
			...a,
			kinds: [...a.kinds]
		})),
		yields: events.filter((e) => e.type === "wait").map((e) => ({
			callee: e.callee,
			kind: e.kind,
			line: e.line
		})),
		deepYield,
		loops: (index.loopsByFn.get(target) ?? []).length
	};
}
function roundSteps(view, fnId, from, to, options = {}) {
	const index = options.index ?? buildIndex(view);
	const cls = options.classifier ?? loopClassifier(view, { index });
	const built = nest(index, fnId, from, to);
	const hasCall = (n) => n.type === "call" || n.type === "frame" && n.children.some(hasCall);
	const hasWait = (n) => n.type === "wait" || n.type === "frame" && n.children.some(hasWait);
	const inCrit = (fn, line) => built.crits.some((c) => c.fn === fn && line >= c.from && line <= c.to);
	const frameLabel = (n) => {
		if (n.kind === "case" || n.kind === "default") return n.labels.length ? n.labels.join(" / ") : "default";
		if (n.kind === "else") return "else";
		return n.condition ?? "";
	};
	const frameKind = (n) => n.isLoop ? "loop" : n.kind === "case" || n.kind === "default" ? "case" : n.kind === "else" ? "else" : n.kind === "switch" ? "switch" : "opt";
	const out = [];
	const walk = (nodes, depth) => {
		for (const n of nodes) {
			if (n.type === "access") continue;
			if (n.type === "wait") {
				out.push({
					type: "wait",
					callee: n.callee,
					kind: n.kind,
					line: n.line,
					fn: n.fn,
					depth
				});
				continue;
			}
			if (n.type === "frame") {
				const kind = frameKind(n);
				const ownLoop = kind === "loop" ? cls.loopsOfFn(n.fn, n.from, n.from)[0] ?? null : null;
				const worthShowing = ownLoop && ownLoop.class !== "iter" && ownLoop.class !== "macro";
				if (!hasCall(n) && !hasWait(n) && !worthShowing) continue;
				out.push({
					type: "frame-open",
					kind,
					label: frameLabel(n),
					line: n.from,
					to: n.to,
					fn: n.fn,
					depth,
					loop: ownLoop
				});
				walk(n.children, depth + 1);
				out.push({
					type: "frame-close",
					depth
				});
				continue;
			}
			const t = index.fnById.get(n.target);
			const loops = n.kind !== "register" && t && index.inRegion(t.file) && !t.external ? cls.loopsOfFn(n.target, t.line, t.endLine) : [];
			out.push({
				type: "call",
				target: n.target,
				line: n.line,
				fn: n.fn,
				kind: n.kind,
				depth,
				summary: calleeSummary(index, n.target, [fnId]),
				loops,
				inCritical: inCrit(n.fn, n.line),
				directAccesses: []
			});
		}
	};
	walk(built.roots, 0);
	const direct = [];
	const gather = (nodes) => {
		for (const n of nodes) if (n.type === "frame") gather(n.children);
		else if (n.type === "access") direct.push(n);
	};
	gather(built.roots);
	for (const a of direct.sort((x, y) => x.line - y.line)) {
		const prev = [...out].reverse().find((st) => st.type === "call" && st.line <= a.line);
		const rec = {
			name: a.name,
			kinds: [a.kind],
			inCritical: a.inCritical || inCrit(a.fn, a.line),
			direct: true,
			line: a.line
		};
		if (prev) {
			prev.directAccesses.push(rec);
			continue;
		}
		let self = out.find((st) => st.type === "self");
		if (!self) {
			self = {
				type: "self",
				fn: fnId,
				line: from,
				depth: 0,
				directAccesses: [],
				loops: [],
				summary: null
			};
			out.unshift(self);
		}
		self.directAccesses.push(rec);
	}
	return out;
}
function stepVariables(step, index) {
	const map = /* @__PURE__ */ new Map();
	for (const a of step.summary?.accesses ?? []) map.set(a.name, {
		name: a.name,
		kinds: new Set(a.kinds),
		inCritical: a.inCritical,
		where: t("inside the callee")
	});
	for (const a of step.directAccesses ?? []) {
		const cur = map.get(a.name) ?? {
			name: a.name,
			kinds: /* @__PURE__ */ new Set(),
			inCritical: true,
			where: t("direct access")
		};
		for (const k of a.kinds) cur.kinds.add(k);
		cur.inCritical = cur.inCritical && a.inCritical;
		if (step.inCritical) cur.inCritical = true;
		map.set(a.name, cur);
	}
	return [...map.values()].map((v) => {
		const shared = index.sharedByName.get(v.name);
		return {
			name: v.name,
			kinds: [...v.kinds],
			write: [...v.kinds].some((k) => k !== "read"),
			inCritical: v.inCritical,
			where: v.where,
			conflict: index.conflictByName.has(v.name),
			wake: index.wakeByName.has(v.name),
			isrWriters: (shared?.units ?? []).filter((u) => u.unitKind === "isr" && (u.kinds ?? []).some((k) => k !== "read")).map((u) => String(u.unit).split(":").pop())
		};
	});
}
function exitsOf(loop, rootRangeKind) {
	if (!loop) return [{ type: rootRangeKind === "body" ? "return" : "loopback" }];
	const out = [];
	if (loop.infinite !== true) out.push({
		type: "cond",
		text: loop.condition ?? null
	});
	for (const e of loop.exits ?? []) out.push({
		type: e.kind,
		line: e.line
	});
	if (!out.length) out.push({ type: "none" });
	return out;
}
function topLoops(index, cls, fnId) {
	const t = index.fnById.get(fnId);
	if (!t || t.external || !index.inRegion(t.file) || !t.endLine) return [];
	const all = (index.loopsByFn.get(fnId) ?? []).filter((l) => l.location.line >= t.line && l.location.line <= t.endLine && !l.fromMacro);
	return all.filter((l) => !all.some((o) => o !== l && o.location.line < l.location.line && l.endLine <= o.endLine)).map((l) => ({
		...l,
		class: cls.classify(l),
		condition: cls.conditionOf(l),
		mayTimeOut: cls.mayTimeOut(l)
	}));
}
function chainOf(index, cls, target, chain, budget, showIter) {
	const t = index.fnById.get(target);
	if (!t || t.external || !index.inRegion(t.file) || !t.endLine || chain.includes(target) || budget <= 0) return null;
	const top = topLoops(index, cls, target);
	const mine = top.filter((l) => showIter || l.class !== "iter");
	const insideTop = (line) => top.some((l) => line >= l.location.line && line <= l.endLine);
	const children = [];
	const seen = /* @__PURE__ */ new Set();
	for (const c of [...index.calleesOf.get(target) ?? []].sort((x, y) => (x.line ?? 0) - (y.line ?? 0))) {
		if (c.line == null || c.line < t.line || c.line > t.endLine || insideTop(c.line) || seen.has(c.t)) continue;
		seen.add(c.t);
		const sub = chainOf(index, cls, c.t, [...chain, target], budget - 1, showIter);
		if (sub) children.push({
			...sub,
			line: c.line
		});
	}
	if (!mine.length && !children.length) return null;
	return {
		target,
		loops: mine,
		children
	};
}
/**
* 一轮的范围。有无限循环就是它的循环体，一轮 = 转一圈；框架代为无限调用的入口（Arduino loop）
* 是整个函数体；都没有就是整个函数体，跑一遍返回。buildRound 和 unitOutline 同一个口径。
*/
function roundRange(index, rootId) {
	const fn = index.fnById.get(rootId);
	if (!fn) return null;
	const mainLoop = (index.loopsByFn.get(rootId) ?? []).filter((l) => l.infinite).sort((a, b) => a.depth - b.depth || a.location.line - b.location.line)[0] ?? null;
	if (rootId === index.entries?.main && index.entries?.mainSuperloop) return {
		from: fn.line,
		to: fn.endLine ?? Infinity,
		kind: "loop",
		label: t("called forever by the framework; one round = one pass of the body {from}–{to}", {
			from: fn.line,
			to: fn.endLine ?? "?"
		})
	};
	if (mainLoop) return {
		from: mainLoop.location.line,
		to: mainLoop.endLine,
		kind: "loop",
		label: t("{kind} infinite loop {from}–{to}; one round = one turn", {
			kind: mainLoop.kind,
			from: mainLoop.location.line,
			to: mainLoop.endLine
		})
	};
	return {
		from: fn.line,
		to: fn.endLine ?? Infinity,
		kind: "body",
		label: t("function body {from}–{to}; no loop, runs once and returns", {
			from: fn.line,
			to: fn.endLine ?? "?"
		})
	};
}
var BUSY_CLASSES = /* @__PURE__ */ new Set([
	"busy-var",
	"busy-hw",
	"busy-poll",
	"inner-infinite"
]);
/**
* 一轮里依次做什么：编号的步骤，按源码顺序。分支 / 循环是缩进的框，让出点、被调函数里的循环、
* 碰到的共享变量都挂在所在的那一步上。这是原型「中断」页点开一行看到的东西，也是裸机大循环
* 「先做什么后做什么」的答案——周期不知道不影响顺序是事实。
*/
function unitOutline(view, rootId, options = {}) {
	const index = options.index ?? buildIndex(view);
	const cls = options.classifier ?? loopClassifier(view, { index });
	if (!index.fnById.get(rootId)) return {
		root: rootId,
		available: false,
		steps: [],
		summary: {
			calls: 0,
			waits: 0,
			busy: 0,
			writes: 0,
			conflicts: 0
		}
	};
	const range = roundRange(index, rootId);
	const raw = roundSteps(view, rootId, range.from, range.to, {
		index,
		classifier: cls
	});
	const loopView = (l) => ({
		class: l.class,
		infinite: Boolean(l.infinite),
		busy: BUSY_CLASSES.has(l.class) || Boolean(l.infinite),
		iterations: l.iterations?.max ?? null,
		line: l.location?.line ?? null,
		file: index.fileOf(l.function),
		exits: (l.exits ?? []).length,
		fromMacro: Boolean(l.fromMacro)
	});
	let n = 0;
	const writes = /* @__PURE__ */ new Set(), conflicts = /* @__PURE__ */ new Set();
	let waits = 0, busy = 0;
	const steps = raw.map((st) => {
		if (st.type === "frame-open") {
			const loop = st.loop ? loopView(st.loop) : null;
			if (loop?.busy) busy += 1;
			return {
				type: "frame",
				kind: st.kind,
				label: st.label,
				depth: st.depth,
				line: st.line,
				file: index.fileOf(st.fn),
				loop
			};
		}
		if (st.type === "frame-close") return {
			type: "end",
			depth: st.depth
		};
		if (st.type === "wait") {
			waits += 1;
			return {
				type: "wait",
				depth: st.depth,
				callee: st.callee,
				kind: st.kind,
				line: st.line,
				file: index.fileOf(st.fn)
			};
		}
		const vars = stepVariables(st, index);
		for (const v of vars) {
			if (v.write) writes.add(v.name);
			if (v.conflict) conflicts.add(v.name);
		}
		const loops = (st.loops ?? []).filter((l) => !l.fromMacro).map(loopView);
		busy += loops.filter((l) => l.busy).length;
		n += 1;
		return {
			type: st.type === "self" ? "self" : "call",
			n,
			depth: st.depth,
			target: st.target ?? null,
			name: st.target ? index.nameOf(st.target) : index.nameOf(rootId),
			targetFile: st.target ? index.fileOf(st.target) : null,
			targetLine: st.target ? index.fnById.get(st.target)?.line ?? null : null,
			line: st.line,
			file: index.fileOf(st.fn),
			kind: st.kind ?? null,
			inCritical: Boolean(st.inCritical),
			deepYield: Boolean(st.summary?.deepYield),
			loops,
			vars: vars.map((v) => ({
				name: v.name,
				write: v.write,
				conflict: v.conflict,
				wake: v.wake,
				inCritical: v.inCritical,
				isrWriters: v.isrWriters
			}))
		};
	});
	return {
		root: rootId,
		available: true,
		name: index.nameOf(rootId),
		file: index.fileOf(rootId),
		range,
		steps,
		summary: {
			calls: n,
			waits,
			busy,
			writes: writes.size,
			conflicts: conflicts.size
		}
	};
}
/**
* 一个执行单元的一轮，摊成一列一列的框。
* rootId 是单元的入口函数；range 不给就自己找：有无限循环就取那个循环体，没有就整个函数体。
*/
function buildRound(view, rootId, options = {}) {
	const index = options.index ?? buildIndex(view);
	const cls = options.classifier ?? loopClassifier(view, { index });
	const showIter = Boolean(options.showIterations);
	const maxLevels = options.maxLevels ?? MAX_LEVELS;
	if (!index.fnById.get(rootId)) return {
		id: `round:${rootId}`,
		available: false,
		reason: "no-such-function",
		levels: []
	};
	const range = options.range ?? roundRange(index, rootId);
	const levels = [];
	let badgeSeq = 0;
	const nextBadge = () => {
		const n = badgeSeq++;
		return String.fromCharCode(65 + n % 26) + (n >= 26 ? String(Math.floor(n / 26)) : "");
	};
	const badgeOf = /* @__PURE__ */ new Map();
	let queue = [{
		fnId: options.stateFunction ?? rootId,
		from: range.from,
		to: range.to,
		loop: null,
		chain: [rootId],
		badge: null,
		spawnKey: null
	}];
	for (let depth = 0; depth < maxLevels && queue.length; depth++) {
		const boxes = [];
		const next = [];
		for (const item of queue) {
			const rows = [];
			const scope = `${rootId}|${depth}|${item.badge ?? "root"}`;
			const attach = (loops, rowKey, chain) => loops.map((l) => {
				const key = `${l.function}:${l.location.line}`;
				const known = badgeOf.get(key);
				if (known) return {
					loop: l,
					badge: known,
					repeat: true
				};
				const badge = nextBadge();
				badgeOf.set(key, badge);
				next.push({
					fnId: l.function,
					from: l.location.line,
					to: l.endLine,
					loop: l,
					chain: [...chain, l.function],
					badge,
					spawnKey: rowKey
				});
				return {
					loop: l,
					badge,
					repeat: false
				};
			});
			const walkChain = (node, indent, chain, ancestors) => {
				const key = `${ancestors[ancestors.length - 1] ?? "^"}>${node.target}:${node.line ?? 0}`;
				rows.push({
					type: "chain",
					target: node.target,
					name: index.nameOf(node.target),
					file: index.fileOf(node.target),
					line: node.line,
					indent,
					key,
					badges: attach(node.loops, key, chain)
				});
				for (const c of node.children) walkChain(c, indent + 1, [...chain, node.target], [...ancestors, key]);
			};
			for (const st of roundSteps(view, item.fnId, item.from, item.to, {
				index,
				classifier: cls
			})) {
				if (st.type === "frame-close") {
					rows.push({
						type: "frame-close",
						indent: st.depth,
						key: `close:${rows.length}`
					});
					continue;
				}
				if (st.type === "wait") {
					rows.push({
						type: "yield",
						indent: st.depth,
						callee: st.callee,
						kind: st.kind,
						line: st.line,
						fn: st.fn,
						file: index.fileOf(st.fn),
						key: `yield:${st.fn}:${st.line}`,
						badges: [],
						conditional: st.depth > 0
					});
					continue;
				}
				if (st.type === "frame-open") {
					const own = st.loop && !st.loop.fromMacro && (showIter || st.loop.class !== "iter") ? [st.loop] : [];
					const key = `frame:${st.fn}:${st.line}`;
					rows.push({
						type: "frame",
						indent: st.depth,
						kind: st.kind,
						label: st.label,
						line: st.line,
						to: st.to,
						fn: st.fn,
						file: index.fileOf(st.fn),
						key,
						badges: attach(own, key, item.chain)
					});
					continue;
				}
				if (st.type !== "call" && st.type !== "self") continue;
				const target = st.type === "self" ? item.fnId : st.target;
				const chained = st.type === "call" && st.kind !== "register" ? chainOf(index, cls, target, item.chain, MAX_CALL_DEPTH, showIter) : null;
				const key = `${target}:${st.line}`;
				rows.push({
					type: "step",
					indent: st.depth,
					self: st.type === "self",
					target,
					name: index.nameOf(target),
					file: index.fileOf(target),
					line: st.line,
					kind: st.kind ?? null,
					key,
					variables: stepVariables(st, index),
					yields: st.summary?.yields ?? [],
					deepYield: Boolean(st.summary?.deepYield),
					badges: attach(chained?.loops ?? [], key, item.chain)
				});
				for (const c of chained?.children ?? []) walkChain(c, (st.depth ?? 0) + 1, [...item.chain, target], [key]);
			}
			boxes.push({
				id: `box:${scope}${item.badge ? `#${item.badge}` : ""}`,
				depth,
				scope,
				badge: item.badge,
				spawnKey: item.spawnKey,
				fn: item.fnId,
				name: index.nameOf(item.fnId),
				file: index.fileOf(item.fnId),
				loop: item.loop ? {
					id: index.loopId(item.loop),
					class: item.loop.class,
					kind: item.loop.kind,
					line: item.loop.location.line,
					endLine: item.loop.endLine,
					condition: item.loop.condition,
					mayTimeOut: item.loop.mayTimeOut,
					infinite: Boolean(item.loop.infinite)
				} : null,
				exits: exitsOf(item.loop, depth === 0 ? range.kind : null),
				rows
			});
		}
		levels.push(boxes);
		queue = next;
	}
	const allRows = levels.flat().flatMap((b) => b.rows);
	const truncated = queue.length > 0;
	const outline = unitOutline(view, rootId, {
		index,
		classifier: cls
	});
	return {
		id: `round:${rootId}`,
		outline,
		available: levels.some((boxes) => boxes.length > 0),
		root: rootId,
		name: index.nameOf(rootId),
		file: index.fileOf(rootId),
		range,
		levels: levels.filter((boxes) => boxes.length > 0),
		truncated,
		maxLevels,
		counts: {
			boxes: levels.flat().length,
			steps: allRows.filter((r) => r.type === "step" || r.type === "chain").length,
			yields: allRows.filter((r) => r.type === "yield").length,
			unguarded: allRows.reduce((n, r) => n + (r.variables ?? []).filter((v) => (v.conflict || v.isrWriters.length) && !v.inCritical).length, 0)
		}
	};
}
//#endregion
//#region packages/facts-view/src/timing/beat.mjs
var BUSY = /* @__PURE__ */ new Set([
	"busy-var",
	"busy-hw",
	"busy-poll",
	"inner-infinite"
]);
var gcd$1 = (a, b) => b ? gcd$1(b, a % b) : a;
var ORDER_LABEL = {
	"same-round": "same round",
	"next-round": "next round",
	async: "async",
	preemptive: "preemptive",
	main: "main context",
	"unknown-order": "order unknown"
};
var ORDER_RANK = {
	"next-round": 0,
	"unknown-order": 1,
	async: 2,
	preemptive: 3,
	"same-round": 4,
	main: 5
};
/** tick 周期：代码里读到的优先，读不到才退回 profile 声明值 */
function tickOf(view) {
	const facts = view.timeBase ?? [];
	const fromCode = facts.find((x) => x.kind === "systick" && x.value != null && x.basis !== "declared");
	if (fromCode) return {
		ms: fromCode.value,
		basis: "code",
		fact: fromCode
	};
	return {
		ms: view.tickMs ?? 1,
		basis: "declared",
		fact: facts.find((x) => x.kind === "systick") ?? null
	};
}
function buildBeat(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const ast = index.ast ?? {};
	const entries = index.entries ?? {};
	if (!ast.present) return {
		available: false,
		reason: "no-ast-facts",
		hint: t("This scan has no AST-level facts, so the beat cannot be drawn."),
		rows: [],
		dataDeps: {
			rows: [],
			counts: {}
		}
	};
	const sched = view.scheduling ?? "unknown";
	if (sched === "preemptive") return {
		available: false,
		reason: "preemptive",
		hint: t("The profile's scheduling is preemptive: tasks can interrupt each other, so staggering by polling order does not hold."),
		rows: [],
		dataDeps: {
			rows: [],
			counts: {}
		}
	};
	const tick = tickOf(view);
	const position = new Map((view.pollingOrder ?? []).map((unit, i) => [unit, i + 1]));
	const loopsIn = (fnId) => index.loopsByFn.get(fnId) ?? [];
	const waitMs = (fnId, line) => {
		for (const loop of loopsIn(fnId)) for (const call of loop.blockingCalls ?? []) {
			if (call.line !== line && call.location?.line !== line) continue;
			const d = call.duration;
			if (!d || d.value == null) return null;
			return d.unit === "tick" ? d.value * tick.ms : d.value;
		}
		return null;
	};
	const tasks = (entries.registrations ?? []).filter((r) => r.kind === "task");
	const mainRow = Boolean(entries.main) && (entries.mainSuperloop || loopsIn(entries.main).some((l) => l.infinite && !l.depth)) && !tasks.some((r) => r.id === entries.main) ? {
		unitId: entries.mainUnit ?? "main:main",
		id: entries.main,
		kind: "main"
	} : null;
	const rowFor = (reg) => {
		const fn = index.fnById.get(reg.id);
		const rm = ast.runModes?.[reg.unitId] ?? null;
		const mainLoop = loopsIn(reg.id).filter((l) => l.infinite).sort((a, b) => a.depth - b.depth || a.location.line - b.location.line)[0] ?? null;
		const range = mainLoop ? {
			from: mainLoop.location.line,
			to: mainLoop.endLine
		} : {
			from: fn?.line ?? 0,
			to: fn?.endLine ?? Infinity
		};
		const steps = fn ? roundSteps(view, reg.id, range.from, range.to, { index }) : [];
		const segments = [];
		let current = { steps: [] };
		let alternatives = 0;
		for (const st of steps) {
			if (st.type === "wait") {
				if (!st.depth) {
					current.exit = {
						callee: st.callee,
						kind: st.kind,
						line: st.line,
						fn: st.fn,
						wait: waitMs(st.fn, st.line)
					};
					segments.push(current);
					current = { steps: [] };
				} else alternatives += 1;
				continue;
			}
			if (st.type === "call" || st.type === "self") current.steps.push(st);
		}
		segments.push(current);
		const kept = segments.filter((p) => p.steps.length || p.exit);
		const seq = (kept.length ? kept : [{ steps: [] }]).map((p) => {
			let calls = 0, bounded = 0, unbounded = 0;
			for (const st of p.steps) {
				calls += 1;
				for (const l of st.loops ?? []) {
					if (l.fromMacro || l.class === "main") continue;
					if (BUSY.has(l.class) || l.infinite) {
						unbounded += 1;
						continue;
					}
					bounded += (l.iterations?.max ?? 1) * Math.max(1, (l.callsInBody ?? []).length);
				}
			}
			return {
				calls: Math.max(1, calls + bounded),
				rawCalls: calls,
				bounded,
				unbounded,
				wait: p.exit?.wait ?? null,
				callee: p.exit?.callee ?? null,
				kind: p.exit?.kind ?? null
			};
		});
		const delays = [];
		for (const b of rm?.evidence?.blockingCalls ?? []) {
			if (!b.duration) continue;
			const key = `${b.duration.value}@${b.location?.path}:${b.location?.line}`;
			if (delays.some((d) => d.key === key)) continue;
			delays.push({
				key,
				callee: b.callee,
				value: b.duration.value ?? null,
				unit: b.duration.unit ?? "ms",
				argument: b.duration.argument ?? null,
				resolvedFrom: b.duration.resolvedFrom ?? null,
				path: b.location?.path ?? null,
				line: b.location?.line ?? null
			});
		}
		const mode = rm?.mode ?? "unknown";
		let period = rm?.periodMs ?? null;
		let periodBasis = period != null ? "engine" : null;
		const yields = seq.filter((s) => s.callee);
		if (period == null && yields.length && yields.every((s) => s.wait != null)) {
			period = yields.reduce((n, s) => n + s.wait, 0);
			periodBasis = "sum-of-yields";
		}
		const always = period == null && (mode === "one-shot" || mode === "busy-poll");
		const suspend = (view.taskControls ?? []).find((c) => c.kind === "suspend" && (c.target === reg.id || c.targetUnit === reg.unitId)) ?? null;
		return {
			id: reg.unitId,
			entry: reg.id,
			kind: reg.kind ?? "task",
			name: index.nameOf(reg.id),
			file: index.fileOf(reg.id),
			order: position.get(reg.unitId) ?? null,
			mode,
			period,
			periodBasis,
			always,
			delays,
			seq,
			alternatives,
			unbounded: seq.reduce((n, s) => n + s.unbounded, 0),
			work: seq.reduce((n, s) => n + s.calls, 0),
			suspend: suspend ? {
				callee: suspend.callee ?? null,
				path: suspend.location?.path ?? null,
				line: suspend.location?.line ?? null
			} : null
		};
	};
	const rows = [...tasks.map(rowFor), ...mainRow ? [rowFor(mainRow)] : []].sort((a, b) => (a.kind === "main") - (b.kind === "main") || (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
	const periods = rows.filter((r) => r.period != null).map((r) => r.period);
	const lcm = periods.length ? periods.reduce((p, q) => p * q / gcd$1(p, q), 1) : 0;
	const facts = view.timeBase ?? [];
	const of = (kind) => facts.filter((x) => x.kind === kind);
	const chips = [];
	const chip = (label, value, at, bad = false) => {
		if (value != null) chips.push({
			label,
			value,
			path: at?.path ?? null,
			line: at?.line ?? null,
			bad
		});
	};
	const reg = tasks.find((x) => (x.registrars ?? []).length);
	const regAt = reg ? {
		path: index.fileOf(reg.registrars[0].id),
		line: reg.registrars[0].line ?? null
	} : null;
	chip(`scheduling${reg?.rule ? ` · ${reg.rule}` : ""}`, sched === "unknown" ? null : sched, regAt);
	const clock = of("core-clock")[0];
	const clockDef = clock ? (view.globals ?? []).find((g) => g.name === clock.name)?.definition ?? null : null;
	chip(clock?.name ?? "SystemCoreClock", clock?.value ? clock.value >= 1e6 ? `${+(clock.value / 1e6).toFixed(3)} MHz` : `${clock.value} Hz` : null, clockDef ?? clock?.location ?? null);
	const systick = of("systick")[0];
	chip(systick?.name ?? "tick_ms", tick.ms != null ? `${tick.ms} ms${tick.basis === "declared" ? ` (${t("declared by profile")})` : ""}` : null, systick?.location ?? null);
	const counter = of("tick-counter")[0];
	chip(t("time base counter"), counter?.name ?? null, counter?.location ?? null);
	const waits = of("timeout-loop");
	if (waits.length === 1) chip(t("timeout bound"), waits[0].value != null ? `${waits[0].value} tick` : null, waits[0].location ?? null);
	else if (waits.length > 1) chip(t("timeout loops"), String(waits.length), waits[0].location ?? null);
	const suspends = (view.taskControls ?? []).filter((c) => c.kind === "suspend");
	if (suspends.length) chip(t("suspendable tasks"), String(new Set(suspends.map((c) => c.targetUnit ?? c.target ?? c.argument)).size), suspends[0].location ?? null);
	chip(t("shortest period"), periods.length ? `${Math.min(...periods)} ms` : null, null);
	const works = rows.map((r) => r.work);
	chip(t("steps per round"), works.length ? `${Math.min(...works)}–${Math.max(...works)}` : null, null);
	chip(t("hyperperiod"), lcm ? lcm >= 1e3 ? `${lcm / 1e3} s` : `${lcm} ms` : null, null);
	const busy = rows.filter((r) => r.always).reduce((n, r) => n + r.unbounded, 0);
	if (busy) chip(t("runs every round · unbounded busy-wait"), String(busy), null, true);
	const regionUnits = /* @__PURE__ */ new Set([...(entries.units ?? []).map((u) => u.id), entries.mainUnit ?? "main:main"]);
	const dd = (view.dataDependencies ?? []).filter((d) => regionUnits.has(d.from) || regionUnits.has(d.to));
	const counts = {};
	for (const d of dd) counts[d.order] = (counts[d.order] ?? 0) + 1;
	const dataDeps = {
		counts,
		rows: dd.slice().sort((x, y) => (ORDER_RANK[x.order] ?? 9) - (ORDER_RANK[y.order] ?? 9) || String(x.name ?? "").localeCompare(String(y.name ?? ""))).map((d) => ({
			from: d.from,
			to: d.to,
			fromKind: d.fromKind ?? String(d.from).split(":")[0],
			toKind: d.toKind ?? String(d.to).split(":")[0],
			order: d.order,
			label: t(ORDER_LABEL[d.order] ?? d.order),
			fromPosition: d.fromPosition ?? null,
			toPosition: d.toPosition ?? null,
			resources: (d.resources ?? []).map((r) => ({
				name: r.name,
				variable: r.variable ?? null,
				...index.varAt(r.variable)
			}))
		}))
	};
	const isrs = (entries.isrs ?? []).filter((i) => !i.kernel && (index.calleesOf.get(i.id) ?? []).length > 0).length;
	return {
		available: true,
		scheduling: sched,
		tick,
		rows,
		lcm,
		minPeriod: periods.length ? Math.min(...periods) : null,
		unplaced: rows.filter((r) => r.order == null && r.kind !== "main").length,
		isrs,
		chips,
		dataDeps,
		pollingOrder: (view.pollingOrder ?? []).map((unit, i) => ({
			position: i + 1,
			unit,
			name: String(unit).split(":").slice(1).join(":")
		}))
	};
}
//#endregion
//#region packages/facts-view/src/timing/preemptive.mjs
var gcd = (a, b) => b ? gcd(b, a % b) : a;
var MODE_NOTE = {
	"event-driven": "waits for an event; runs when it is signalled and nothing higher is ready",
	"busy-poll": "never blocks; runs whenever nothing higher is ready",
	"one-shot": "runs once",
	unknown: "period unknown"
};
function buildPreemptive(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const ast = index.ast ?? {};
	const entries = index.entries ?? {};
	const sched = view.scheduling ?? "unknown";
	const off = (reason, hint) => ({
		available: false,
		reason,
		hint,
		rows: [],
		isrs: [],
		dataDeps: []
	});
	if (sched !== "preemptive") return off("not-preemptive", t("The scheduling model is not preemptive; the beat shows the round instead."));
	if (!ast.present) return off("no-ast-facts", t("This scan has no AST-level facts, so the preemption picture cannot be drawn."));
	const tick = tickOf(view);
	const tasks = (entries.registrations ?? []).filter((r) => r.kind === "task");
	const order = tasks.some((r) => String(r.rule ?? "").startsWith("zephyr.")) ? "ascending" : "descending";
	const wakes = ast.wakeRelations ?? [];
	const toMs = (d) => d == null || d.value == null ? null : d.unit === "tick" ? d.value * tick.ms : d.unit === "s" ? d.value * 1e3 : d.unit === "us" ? d.value / 1e3 : d.value;
	const rows = tasks.map((reg) => {
		const rm = ast.runModes?.[reg.unitId] ?? null;
		const evidence = rm?.evidence ?? {};
		const blocking = [...evidence.blockingCalls ?? [], ...evidence.blockingViaCallee?.call ? [evidence.blockingViaCallee.call] : []];
		const site = (b) => ({
			callee: b.callee,
			rule: b.rule ?? null,
			path: b.location?.path ?? null,
			line: b.location?.line ?? null
		});
		const waits = blocking.filter((b) => b.kind === "wait").map(site);
		const delays = blocking.filter((b) => b.kind === "delay").map((b) => ({
			...site(b),
			ms: toMs(b.duration),
			argument: b.duration?.argument ?? null
		}));
		const wakeBy = wakes.filter((w) => (w.consumers ?? []).some((c) => c.unit === reg.unitId)).map((w) => ({
			name: w.name,
			kind: w.kind,
			producers: [...new Set((w.producers ?? []).map((p) => p.unit))]
		}));
		const suspend = (view.taskControls ?? []).find((c) => c.kind === "suspend" && (c.target === reg.id || c.targetUnit === reg.unitId)) ?? null;
		const p = reg.priority ?? null;
		return {
			id: reg.unitId,
			entry: reg.id,
			name: index.nameOf(reg.id),
			file: index.fileOf(reg.id),
			rule: reg.rule ?? null,
			priority: p ? {
				value: p.value ?? null,
				symbol: p.symbol ?? null,
				argument: p.argument ?? null,
				basis: p.basis ?? "unresolved",
				path: p.at?.path ?? null,
				line: p.at?.line ?? null
			} : null,
			mode: rm?.mode ?? "unknown",
			modeNote: MODE_NOTE[rm?.mode] ?? MODE_NOTE.unknown,
			confidence: rm?.confidence ?? null,
			period: rm?.periodMs ?? null,
			waits,
			delays,
			wakeBy,
			suspend: suspend ? {
				callee: suspend.callee ?? null,
				path: suspend.location?.path ?? null,
				line: suspend.location?.line ?? null
			} : null,
			rank: null
		};
	});
	const value = (r) => r.priority?.value;
	rows.sort((a, b) => {
		const av = value(a), bv = value(b);
		if (av == null && bv == null) return a.name.localeCompare(b.name);
		if (av == null) return 1;
		if (bv == null) return -1;
		return (order === "descending" ? bv - av : av - bv) || a.name.localeCompare(b.name);
	});
	let rank = 0, last = null;
	for (const r of rows) {
		if (value(r) == null) {
			r.rank = null;
			continue;
		}
		if (value(r) !== last) {
			rank += 1;
			last = value(r);
		}
		r.rank = rank;
	}
	const isrs = (entries.isrs ?? []).filter((i) => !i.kernel && (index.calleesOf.get(i.id) ?? []).length > 0).map((i) => ({
		id: i.unitId,
		entry: i.id,
		name: index.nameOf(i.id),
		preempt: i.priority?.preempt ?? null,
		vector: i.vector ?? null
	})).sort((a, b) => (a.preempt ?? 99) - (b.preempt ?? 99) || (a.vector ?? 0) - (b.vector ?? 0));
	const periods = rows.filter((r) => r.period != null).map((r) => r.period);
	const lcm = periods.length ? periods.reduce((p, q) => p * q / gcd(p, q), 1) : 0;
	const unitIds = new Set(rows.map((r) => r.id));
	const dataDeps = (view.dataDependencies ?? []).filter((d) => d.order === "preemptive" && unitIds.has(d.from) && unitIds.has(d.to)).map((d) => ({
		from: d.from,
		to: d.to,
		resources: (d.resources ?? []).map((r) => r.name)
	}));
	const known = rows.filter((r) => value(r) != null).length;
	const chips = [];
	const chip = (label, val, at, bad = false) => {
		if (val != null) chips.push({
			label,
			value: val,
			path: at?.path ?? null,
			line: at?.line ?? null,
			bad
		});
	};
	chip(t("scheduling"), t("preemptive"), null);
	chip(t("priority order"), order === "descending" ? t("higher number = higher priority") : t("lower number = higher priority"), null);
	chip(t("priorities known"), `${known} / ${rows.length}`, null, known < rows.length);
	chip(t("shortest period"), periods.length ? `${Math.min(...periods)} ms` : null, null);
	chip(t("hyperperiod"), lcm ? lcm >= 1e3 ? `${lcm / 1e3} s` : `${lcm} ms` : null, null);
	chip(t("event-driven tasks"), String(rows.filter((r) => r.mode === "event-driven").length), null);
	chip(t("interrupts with a body"), String(isrs.length), null);
	return {
		available: true,
		scheduling: sched,
		order,
		tick,
		rows,
		isrs,
		lcm,
		minPeriod: periods.length ? Math.min(...periods) : null,
		chips,
		dataDeps,
		counts: {
			tasks: rows.length,
			known,
			periodic: periods.length,
			eventDriven: rows.filter((r) => r.mode === "event-driven").length,
			unresolved: rows.length - known
		},
		basis: t("Priority comes from the create call or the attribute struct; period is the delay argument × tick; who wakes whom comes from notification flags. None of this is a measurement: it says who can interrupt whom, not who did.")
	};
}
//#endregion
//#region packages/facts-view/src/timing/model.mjs
var LOOP_CLASSES = {
	main: {
		label: "main loop",
		tone: "main",
		hint: "The infinite loop in an execution unit's root function: one round = one pass of its body"
	},
	"inner-infinite": {
		label: "inner infinite",
		tone: "busy",
		hint: "A while(1) inside a callee: once entered it never returns, so the calling step never ends"
	},
	wait: {
		label: "yield-wait",
		tone: "wait",
		hint: "The loop body has a blocking point: it waits for a condition and yields once per turn, so this step may span several scheduling periods"
	},
	"busy-var": {
		label: "busy-wait on variable",
		tone: "busy",
		hint: "No yield; the condition reads a shared variable written by an interrupt: the whole schedule stalls here until the interrupt changes it"
	},
	"busy-hw": {
		label: "busy-wait on hardware",
		tone: "busy",
		hint: "No yield; the condition polls a register or peripheral status: the whole schedule stalls here until the hardware is ready"
	},
	"busy-poll": {
		label: "busy-poll",
		tone: "busy",
		hint: "No yield; the condition calls a function for status: the whole schedule stalls here until the return value changes"
	},
	iter: {
		label: "iteration",
		tone: "iter",
		hint: "An ordinary counted or iterating loop; for timing it only means repeat a few times"
	},
	macro: {
		label: "macro expansion",
		tone: "macro",
		hint: "A do-while expanded from a macro such as protothreads — not a hand-written loop; handled by the macro semantics"
	}
};
var MODE_LABEL = {
	periodic: "periodic",
	"busy-poll": "busy-poll",
	"event-driven": "event-driven",
	"one-shot": "one-shot",
	unknown: "unknown"
};
function loopClassifier(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const ast = index.ast;
	const entries = index.entries ?? {};
	const cfLoopByKey = /* @__PURE__ */ new Map();
	for (const b of ast.controlFlow ?? []) if ([
		"while",
		"for",
		"do"
	].includes(b.kind)) cfLoopByKey.set(`${b.function}:${b.location.line}`, b);
	const rootFns = new Set([
		...(entries.registrations ?? []).filter((r) => r.kind === "task").map((r) => r.id),
		...(entries.isrs ?? []).map((i) => i.id),
		entries.main
	].filter(Boolean));
	const conditionOf = (loop) => cfLoopByKey.get(`${loop.function}:${loop.location.line}`)?.condition ?? null;
	const mayTimeOut = (loop) => /timeout|tick|systick|retry|count/i.test(conditionOf(loop) ?? "");
	const classify = (loop) => {
		if (loop.fromMacro) return "macro";
		if (loop.infinite) return loop.depth === 0 && rootFns.has(loop.function) ? "main" : "inner-infinite";
		if ((loop.blockingCalls ?? []).length) return "wait";
		const body = (conditionOf(loop) ?? "").replace(/^for\s*\(([^;]*);([^;]*);.*$/s, "$2");
		if ((body.match(/[A-Za-z_]\w*/g) ?? []).some((n) => {
			const resource = index.sharedByName.get(n);
			return resource && (resource.units ?? []).some((u) => u.unitKind === "isr" && (u.kinds ?? []).some((k) => k !== "read"));
		})) return "busy-var";
		if (/\b[A-Z][A-Z0-9_]{2,}\s*\(/.test(body) || /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(body) && /[&|]/.test(body)) return "busy-hw";
		const stripped = body.replace(/(sizeof|offsetof|_countof|ARRAY_SIZE)\s*\([^)]*\)/g, "");
		if (/[A-Za-z_]\w*\s*\(/.test(stripped) && !/^\s*(\d+|true|1)\s*$/.test(body)) return "busy-poll";
		return "iter";
	};
	const loopsOfFn = (fnId, from, to) => (index.loopsByFn.get(fnId) ?? []).filter((l) => l.location.line >= (from ?? 0) && l.location.line <= (to ?? Infinity)).map((l) => ({
		...l,
		class: classify(l),
		condition: conditionOf(l),
		mayTimeOut: mayTimeOut(l)
	}));
	return {
		classify,
		conditionOf,
		mayTimeOut,
		loopsOfFn,
		rootFns
	};
}
function buildTiming(view, options = {}) {
	const index = options.index ?? buildIndex(view);
	const ast = index.ast;
	if (!ast.present) return {
		theme: "timing",
		available: false,
		reason: "no-ast-facts",
		hint: t("This scan has no AST-level facts, so loops and yield points are invisible."),
		units: [],
		loops: []
	};
	const entries = index.entries ?? {};
	const { classify, conditionOf, mayTimeOut } = loopClassifier(view, { index });
	const loops = (ast.loops ?? []).filter((l) => index.inRegion(index.fileOf(l.function) ?? "")).map((l) => {
		const kind = classify(l);
		const condition = conditionOf(l);
		return {
			id: index.loopId(l),
			function: l.function,
			name: index.nameOf(l.function),
			file: index.fileOf(l.function),
			line: l.location.line,
			endLine: l.endLine ?? null,
			loopKind: l.kind,
			infinite: Boolean(l.infinite),
			depth: l.depth ?? 0,
			class: kind,
			condition,
			mayTimeOut: mayTimeOut(l),
			blocking: (l.blockingCalls ?? []).map((c) => ({
				callee: c.callee,
				kind: c.kind,
				via: c.via,
				line: c.line ?? null,
				duration: c.duration ?? null
			})),
			iterations: l.iterations ?? null,
			exits: (l.exits ?? []).map((e) => ({
				kind: e.kind,
				line: e.line
			}))
		};
	});
	const unitList = [...entries.units ?? []];
	if (entries.main && !unitList.some((u) => (u.entry ?? u.entrySymbolId) === entries.main)) unitList.push({
		id: entries.mainUnit ?? "main:main",
		kind: "main",
		entry: entries.main
	});
	const units = unitList.map((u) => {
		const mode = ast.runModes?.[u.id] ?? null;
		const rootLoops = loops.filter((l) => index.reachOf(u.entry ?? u.entrySymbolId ?? "").has(l.function));
		return {
			id: `unit:${u.id}`,
			unit: u.id,
			kind: u.kind,
			entry: u.entry ?? u.entrySymbolId ?? null,
			name: index.nameOf(u.entry ?? u.entrySymbolId ?? ""),
			file: index.fileOf(u.entry ?? u.entrySymbolId ?? ""),
			mode: mode?.mode ?? null,
			modeLabel: MODE_LABEL[mode?.mode] ?? null,
			confidence: mode?.confidence ?? null,
			periodMs: mode?.periodMs ?? null,
			busyLoops: rootLoops.filter((l) => LOOP_CLASSES[l.class]?.tone === "busy").length,
			outline: (u.kind === "isr" || u.kind === "task" || u.kind === "main") && (u.entry ?? u.entrySymbolId) ? unitOutline(view, u.entry ?? u.entrySymbolId, { index }).summary : null,
			waitLoops: rootLoops.filter((l) => l.class === "wait").length,
			basis: mode?.evidence ?? null
		};
	}).sort((a, b) => {
		const rank = (k) => k === "isr" ? 0 : k === "main" ? 2 : 1;
		return rank(a.kind) - rank(b.kind);
	});
	const byClass = {};
	for (const l of loops) byClass[l.class] = (byClass[l.class] ?? 0) + 1;
	return {
		theme: "timing",
		available: true,
		basis: t("The engine knows what numbers the code wrote and where it yields; it does not know how long any code actually runs. A period is the delay argument times the tick — a lower bound, not a measurement"),
		scheduling: view.scheduling ?? "unknown",
		tickMs: view.tickMs ?? null,
		timeBase: view.timeBase ?? [],
		pollingOrder: (view.pollingOrder ?? []).map((id, i) => ({
			position: i + 1,
			unit: id,
			name: id.split(":").slice(1).join(":")
		})),
		beat: buildBeat(view, { index }),
		preemptive: buildPreemptive(view, { index }),
		units,
		loops,
		loopClasses: LOOP_CLASSES,
		counts: {
			loops: loops.length,
			byClass,
			yieldLocals: (view.yieldLocals ?? []).length,
			taskControls: (view.taskControls ?? []).length
		},
		yieldLocals: (view.yieldLocals ?? []).map((y) => ({
			function: y.function,
			name: index.nameOf(y.function),
			file: index.fileOf(y.function),
			variable: y.variable,
			writtenAt: y.writtenAt ?? null,
			yieldedAt: y.yieldedAt ?? null,
			readAt: y.readAt ?? null,
			callee: y.callee ?? null
		}))
	};
}
//#endregion
//#region packages/facts-view/src/slice.mjs
var DEFAULT_LIMIT = 50;
var MAX_BYTES = 6e4;
/** 主题里各回答什么问题。列清单时给 Agent 看，省得它逐个试 */
var THEME_QUESTIONS = {
	execution: "Where execution starts and what it reaches",
	dependencies: "Who depends on whom, and on what exactly",
	timing: "Ordering, wait points and periods",
	concurrency: "Which execution units touch the same resource",
	stateTransitions: "How state changes and where the conditions are",
	memory: "Where the space goes, based on which artifact"
};
/** 沿路径取值。`loops`、`loops.3`、`resources.2.units` 都行；取不到返回哨兵 */
var NOT_FOUND = Symbol("not-found");
function atPath(value, fieldPath) {
	if (!fieldPath) return value;
	let current = value;
	for (const segment of String(fieldPath).split(".")) {
		if (current == null) return NOT_FOUND;
		if (Array.isArray(current)) {
			if (!/^\d+$/.test(segment)) return NOT_FOUND;
			current = current[Number(segment)];
			continue;
		}
		if (typeof current !== "object" || !(segment in current)) return NOT_FOUND;
		current = current[segment];
	}
	return current;
}
/** 一个值有多大。用序列化后的字节数，因为那才是真正要过 Agent 上下文的东西 */
function sizeOf(value) {
	try {
		return JSON.stringify(value)?.length ?? 0;
	} catch {
		return Infinity;
	}
}
/** 对象顶层每个键各多大，用来告诉 Agent「往哪个键里钻」 */
function shapeOf(value) {
	if (Array.isArray(value)) return {
		kind: "array",
		length: value.length
	};
	if (value && typeof value === "object") return {
		kind: "object",
		fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? t("array · {n} items · {bytes} bytes", {
			n: item.length,
			bytes: sizeOf(item)
		}) : item && typeof item === "object" ? t("object · {n} keys · {bytes} bytes", {
			n: Object.keys(item).length,
			bytes: sizeOf(item)
		}) : t("{type} · {bytes} bytes", {
			type: typeof item,
			bytes: sizeOf(item)
		})]))
	};
	return { kind: typeof value };
}
/**
* 从一份派生结果里切一块。
* 数组按 offset/limit 分页并带 total；其他值整块给，太大就拒绝并说清楚怎么往下走。
*/
function slice(themeName, theme, options = {}) {
	const fieldPath = options.path ?? "";
	const value = atPath(theme, fieldPath);
	if (value === NOT_FOUND) {
		const parent = atPath(theme, fieldPath.split(".").slice(0, -1).join("."));
		return {
			theme: themeName,
			path: fieldPath,
			error: t("This theme has no field {path}", { path: fieldPath }),
			available: parent === NOT_FOUND ? Object.keys(theme ?? {}) : shapeOf(parent)
		};
	}
	if (Array.isArray(value)) {
		const offset = Math.max(0, Number(options.offset ?? 0));
		const limit = Math.max(1, Math.min(Number(options.limit ?? DEFAULT_LIMIT), 500));
		const items = value.slice(offset, offset + limit);
		const bytes = sizeOf(items);
		if (bytes > MAX_BYTES && items.length > 1) {
			const perItem = Math.ceil(bytes / items.length);
			return {
				theme: themeName,
				path: fieldPath,
				total: value.length,
				offset,
				error: t("These {n} items take {bytes} bytes, over the per-call limit of {max}", {
					n: items.length,
					bytes,
					max: MAX_BYTES
				}),
				hint: t("About {perItem} bytes each; keep limit within {limit}, or use path to drill into just the fields you need", {
					perItem,
					limit: Math.max(1, Math.floor(MAX_BYTES / perItem))
				})
			};
		}
		return {
			theme: themeName,
			path: fieldPath,
			total: value.length,
			offset,
			count: items.length,
			more: offset + items.length < value.length ? {
				offset: offset + items.length,
				remaining: value.length - offset - items.length
			} : null,
			items
		};
	}
	const bytes = sizeOf(value);
	if (bytes > MAX_BYTES) return {
		theme: themeName,
		path: fieldPath,
		bytes,
		error: t("This block is {bytes} bytes, over the per-call limit of {max}", {
			bytes,
			max: MAX_BYTES
		}),
		hint: t("Point path at a field below; array fields take offset / limit for paging"),
		shape: shapeOf(value)
	};
	return {
		theme: themeName,
		path: fieldPath,
		bytes,
		value
	};
}
/** 派生结果里所有带稳定 ID 的对象：ID -> {主题, 路径, 对象} */
function indexById(themes) {
	const found = /* @__PURE__ */ new Map();
	const walk = (value, themeName, trail) => {
		if (Array.isArray(value)) {
			value.forEach((item, i) => walk(item, themeName, `${trail}.${i}`));
			return;
		}
		if (!value || typeof value !== "object") return;
		if (typeof value.id === "string" && value.id.includes(":") && !found.has(value.id)) found.set(value.id, {
			theme: themeName,
			path: trail.replace(/^\./, ""),
			object: value
		});
		for (const [key, item] of Object.entries(value)) if (item && typeof item === "object") walk(item, themeName, `${trail}.${key}`);
	};
	for (const [themeName, theme] of Object.entries(themes)) walk(theme, themeName, "");
	return found;
}
/** 各主题一句话概览：有没有数据、答什么问题、里面有哪些字段能往下钻 */
function overview(themes) {
	return Object.entries(themes).map(([name, theme]) => ({
		theme: name,
		question: THEME_QUESTIONS[name] ? t(THEME_QUESTIONS[name]) : null,
		available: Boolean(theme?.available),
		reason: theme?.available ? null : theme?.reason ?? null,
		hint: theme?.available ? null : theme?.hint ?? null,
		bytes: sizeOf(theme),
		fields: theme && typeof theme === "object" ? Object.fromEntries(Object.entries(theme).filter(([, item]) => Array.isArray(item) || item && typeof item === "object").map(([key, item]) => [key, Array.isArray(item) ? t("array · {n} items", { n: item.length }) : t("object · {n} keys", { n: Object.keys(item).length })])) : {}
	}));
}
//#endregion
//#region packages/core/src/facts-pointer.ts
function archxStateDirectory() {
	if (process.env.ARCHX_STATE_DIR) return path.resolve(process.env.ARCHX_STATE_DIR);
	return process.platform === "win32" && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ArchX") : path.join(os.homedir(), ".local", "state", "archx");
}
function projectKey$1(root) {
	return crypto$1.createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 20);
}
function factsPointerFile$1(root) {
	return path.join(archxStateDirectory(), "facts", `${projectKey$1(root)}.json`);
}
/** 宿主派生完就写一行。写失败不影响面板，只是 Agent 这次得自己找。 */
function publishFactsPointer(root, pointer) {
	const file = factsPointerFile$1(root);
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		let previous = 0;
		try {
			previous = JSON.parse(fs.readFileSync(file, "utf8")).seq ?? 0;
		} catch {
			previous = 0;
		}
		const payload = {
			seq: previous + 1,
			at: (/* @__PURE__ */ new Date()).toISOString(),
			root: path.resolve(root),
			...pointer
		};
		const temporary = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, "utf8");
		fs.renameSync(temporary, file);
	} catch {}
}
//#endregion
//#region extension/mcp/scan.mjs
var exe = (name) => process.platform === "win32" ? `${name}.exe` : name;
var platformDirectory = () => `${process.platform}-${process.arch}`;
function onPath(name) {
	const dirs = String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
	for (const dir of dirs) for (const candidate of process.platform === "win32" ? [
		exe(name),
		`${name}.cmd`,
		`${name}.bat`
	] : [name]) {
		const full = path.join(dir, candidate);
		try {
			if (fs.statSync(full).isFile()) return full;
		} catch {}
	}
	return null;
}
function engineFromSource(dir, python) {
	if (!fs.existsSync(path.join(dir, "src", "archcheck", "__init__.py"))) return null;
	return {
		executable: python,
		prefixArgs: ["-m", "archcheck"],
		env: { PYTHONPATH: [path.join(dir, "src"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
		description: `ArchCheck Python engine at ${dir}`
	};
}
function findEngine(stateDir) {
	const python = process.env.ARCHX_PYTHON || "python";
	const configured = process.env.ARCHX_ENGINE?.trim();
	if (configured) {
		const p = path.resolve(configured);
		if (fs.existsSync(p) && fs.statSync(p).isFile()) return {
			executable: p,
			prefixArgs: [],
			env: {},
			description: `ArchCheck engine from ARCHX_ENGINE (${p})`
		};
		const src = engineFromSource(p, python);
		if (src) return src;
	}
	try {
		const registered = JSON.parse(fs.readFileSync(path.join(stateDir, "engine.json"), "utf8"));
		if (registered?.executable && fs.existsSync(registered.executable)) return {
			executable: registered.executable,
			prefixArgs: registered.prefixArgs ?? [],
			env: registered.env ?? {},
			description: `ArchCheck engine registered by the VS Code extension (${registered.executable})`
		};
	} catch {}
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const bundled = path.resolve(here, "..", "..", "..", "..", "engines", platformDirectory(), exe("archcheck"));
		if (fs.existsSync(bundled)) return {
			executable: bundled,
			prefixArgs: [],
			env: {},
			description: `ArchCheck engine bundled with the extension (${bundled})`
		};
	} catch {}
	const cli = onPath("archcheck");
	if (cli) return {
		executable: cli,
		prefixArgs: [],
		env: {},
		description: `archcheck on PATH (${cli})`
	};
	if (spawnSync(python, ["-c", "import archcheck"], { encoding: "utf8" }).status === 0) return {
		executable: python,
		prefixArgs: ["-m", "archcheck"],
		env: {},
		description: `python -m archcheck (${python})`
	};
	return null;
}
function findClangd() {
	for (const key of ["ARCHX_CLANGD", "CLANGD_PATH"]) {
		const value = process.env[key]?.trim();
		if (value && fs.existsSync(value)) return {
			path: path.resolve(value),
			from: key
		};
	}
	const found = onPath("clangd");
	return found ? {
		path: found,
		from: "PATH"
	} : null;
}
var SKIP = /* @__PURE__ */ new Set([
	".git",
	"node_modules",
	".pio",
	"build",
	"out",
	"Objects",
	"Listings",
	"output",
	".vscode"
]);
function findFiles(root, test, depth = 4) {
	const hits = [];
	const walk = (dir, d) => {
		if (d > depth || hits.length > 20) return;
		let entries = [];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) if (e.isDirectory()) {
			if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), d + 1);
		} else if (test(e.name)) hits.push(path.join(dir, e.name));
	};
	walk(root, 0);
	return hits;
}
/** 这个工程的构建信息在哪；没有的话，按它的构建系统给出生成命令 */
function buildInformation(folder) {
	const dbs = [path.join(folder, "compile_commands.json"), path.join(folder, "build", "compile_commands.json")].filter((p) => fs.existsSync(p));
	if (dbs.length) return {
		kind: "compile-commands",
		path: dbs[0]
	};
	const keil = findFiles(folder, (n) => n.toLowerCase().endsWith(".uvprojx"));
	if (keil.length) return {
		kind: "keil",
		path: keil[0],
		others: keil.slice(1)
	};
	const has = (name) => fs.existsSync(path.join(folder, name));
	const suggestions = [];
	if (has("platformio.ini")) suggestions.push({
		system: "PlatformIO",
		command: "pio run -t compiledb",
		note: "writes compile_commands.json in the project root; add -e <env> to pick an environment"
	});
	if (has("CMakeLists.txt")) suggestions.push({
		system: "CMake",
		command: "cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
		note: "writes build/compile_commands.json; add your usual toolchain / generator options"
	});
	if (has("Makefile") || has("makefile")) suggestions.push({
		system: "Make",
		command: "bear -- make",
		note: "needs bear (https://github.com/rizsotto/Bear); writes compile_commands.json"
	});
	if (has("west.yml") || fs.existsSync(path.join(folder, "prj.conf"))) suggestions.push({
		system: "Zephyr",
		command: "west build -- -DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
		note: "writes build/compile_commands.json"
	});
	if (has("sdkconfig") || has("idf_component.yml")) suggestions.push({
		system: "ESP-IDF",
		command: "idf.py build",
		note: "ESP-IDF writes build/compile_commands.json by default"
	});
	return {
		kind: "missing",
		suggestions
	};
}
var CLANGD_HINTS = {
	win32: "winget install LLVM.LLVM   (then reopen the terminal so clangd is on PATH)",
	darwin: "brew install llvm   (clangd is in $(brew --prefix llvm)/bin)",
	linux: "sudo apt install clangd   (or your distribution's clangd / clang-tools package)"
};
/**
* 跑一次扫描。prereq 缺了返回 { status: "needs-…" }，齐了返回 { status: "scanned", factsFile, … }。
* sourceScanOnly：用户明确接受「没有构建信息、只看文件和依赖」时才传。
*/
function scanProject({ folder, stateDir, outDir, sourceScanOnly = false }) {
	if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return {
		status: "error",
		message: `Not a directory: ${folder}`
	};
	const engine = findEngine(stateDir);
	if (!engine) return {
		status: "needs-engine",
		message: "No ArchCheck engine found.",
		fix: [
			"pip install archcheck   (puts archcheck on PATH; needs Python 3.10+)",
			"or set ARCHX_ENGINE to an archcheck executable / engine source directory",
			"or install the ArchX VS Code extension (it bundles the engine and registers it on activation)"
		]
	};
	const build = buildInformation(folder);
	const clangd = findClangd();
	if (!clangd && !sourceScanOnly) return {
		status: "needs-clangd",
		message: "clangd is not installed or not on PATH. Without it only files and include dependencies can be read — no execution units, loops, state machines or concurrency.",
		install: CLANGD_HINTS[process.platform] ?? CLANGD_HINTS.linux,
		orPoint: "Set ARCHX_CLANGD to an existing clangd executable if it is installed somewhere else.",
		then: "Call scan_project again. Pass sourceScanOnly: true only if the user accepts a files-and-dependencies-only scan."
	};
	if (build.kind === "missing" && !sourceScanOnly) return {
		status: "needs-build-info",
		message: "No compile_commands.json or Keil project found. The engine reads what actually compiles; without build information it can only list files.",
		runInProjectRoot: build.suggestions,
		then: build.suggestions.length ? "Run the matching command in the user's terminal (it uses the project's own build environment), then call scan_project again." : "No known build system detected. Ask the user how the firmware is built, or pass sourceScanOnly: true for a files-and-dependencies-only scan."
	};
	fs.mkdirSync(outDir, { recursive: true });
	const args = [
		...engine.prefixArgs,
		folder,
		"--out",
		outDir
	];
	if (build.kind === "compile-commands") args.push("--compile-commands", build.path);
	else if (build.kind === "keil") args.push("--keil-project", build.path);
	else args.push("--source-scan");
	const env = {
		...process.env,
		...engine.env,
		PYTHONUTF8: "1",
		PYTHONIOENCODING: "utf-8",
		...clangd ? {
			CLANGD_PATH: clangd.path,
			PATH: [path.dirname(clangd.path), process.env.PATH].filter(Boolean).join(path.delimiter)
		} : {}
	};
	const started = Date.now();
	const run = spawnSync(engine.executable, args, {
		env,
		encoding: "utf8",
		maxBuffer: 268435456,
		windowsHide: true
	});
	const factsFile = path.join(outDir, "architecture.json");
	if (run.status !== 0 || !fs.existsSync(factsFile)) return {
		status: "error",
		message: `The engine failed (exit ${run.status}).`,
		engine: engine.description,
		stderr: String(run.stderr ?? "").split(/\r?\n/).filter(Boolean).slice(-15)
	};
	return {
		status: "scanned",
		factsFile,
		seconds: Math.round((Date.now() - started) / 100) / 10,
		engine: engine.description,
		clangd: clangd ? `${clangd.path} (${clangd.from})` : null,
		buildInformation: build.kind === "missing" ? "none (source scan)" : `${build.kind}: ${path.relative(folder, build.path) || build.path}`,
		otherKeilProjects: build.others?.length ? build.others.map((p) => path.relative(folder, p)) : void 0
	};
}
//#endregion
//#region packages/core/src/defaults.ts
function createPartition(input) {
	const generatedId = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	return {
		id: input.id ?? (generatedId || crypto.randomUUID()),
		name: input.name,
		focusPaths: input.focusPaths,
		readContextPaths: input.readContextPaths ?? [],
		ownedPaths: input.ownedPaths ?? [...input.focusPaths],
		boundaryDepth: input.boundaryDepth ?? 1,
		nodeIds: input.nodeIds ?? []
	};
}
//#endregion
//#region packages/core/src/facts.ts
function globToRegExp(pattern) {
	const escaped = pattern.replaceAll("\\", "/").replace(/^\.\//, "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**", "\0").replaceAll("*", "[^/]*").replaceAll("\0", ".*");
	return new RegExp(`^${escaped}$`, "i");
}
function pathMatchesAny(file, patterns) {
	const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
	return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}
function projectFactsToPartition(snapshot, partition) {
	const inFocus = (file) => pathMatchesAny(file, partition.focusPaths);
	const focusedFilePaths = new Set(snapshot.file_metrics.filter((file) => inFocus(file.path)).map((file) => file.path));
	const dependencyEdges = snapshot.dependency_edges.filter((edge) => inFocus(edge.source) || inFocus(edge.target));
	for (const edge of dependencyEdges) {
		focusedFilePaths.add(edge.source);
		focusedFilePaths.add(edge.target);
	}
	const focusedSymbols = /* @__PURE__ */ new Set([...snapshot.functions.filter((symbol) => inFocus(symbol.location.path)).map((symbol) => symbol.symbol_id), ...snapshot.variables.filter((symbol) => inFocus(symbol.location.path)).map((symbol) => symbol.symbol_id)]);
	const semanticEdges = snapshot.semantic_edges.filter((edge) => focusedSymbols.has(edge.source) || focusedSymbols.has(edge.target));
	const boundarySymbols = new Set(semanticEdges.flatMap((edge) => [edge.source, edge.target]));
	const functions = snapshot.functions.filter((symbol) => boundarySymbols.has(symbol.symbol_id) || inFocus(symbol.location.path));
	const scoped = {
		schemaVersion: 1,
		project: snapshot.project,
		partition,
		completeness: "full-scan-projection",
		files: snapshot.file_metrics.filter((file) => focusedFilePaths.has(file.path)),
		dependencyEdges,
		dependencyCycles: snapshot.dependency_cycles.filter((cycle) => cycle.some(inFocus)),
		functions,
		variables: snapshot.variables.filter((symbol) => boundarySymbols.has(symbol.symbol_id) || inFocus(symbol.location.path)),
		semanticEdges,
		globalVariables: snapshot.global_variables.filter((variable) => inFocus(variable.definition.path) || variable.references.some((location) => inFocus(location.path))),
		warnings: snapshot.semantic_warnings,
		metrics: snapshot.metrics
	};
	if (typeof snapshot.schemaVersion === "number") scoped.engineSchemaVersion = snapshot.schemaVersion;
	const scopedFiles = new Set(scoped.files.map((file) => file.path));
	const inScopeFile = (file) => Boolean(file) && (scopedFiles.has(file) || inFocus(file));
	const scopedSymbols = new Set(functions.map((symbol) => symbol.symbol_id));
	const inScopeSymbol = (id) => Boolean(id) && (scopedSymbols.has(id) || boundarySymbols.has(id) || inScopeFile(symbolPath(id)));
	const inScopeSite = (site) => Boolean(site) && (inScopeSymbol(site.functionId) || inScopeFile(site.path));
	if (snapshot.coverage !== void 0) scoped.coverage = snapshot.coverage;
	if (snapshot.entries) scoped.entries = snapshot.entries.filter((entry) => inScopeSymbol(entry.symbolId));
	if (snapshot.executionUnits) scoped.executionUnits = snapshot.executionUnits.filter((unit) => inScopeSymbol(unit.entrySymbolId) || inScopeSite(unit.registeredAt) || (unit.alsoRegisteredAt ?? []).some(inScopeSite) || (unit.enabledAt ?? []).some(inScopeSite));
	if (snapshot.externDeclarations) scoped.externDeclarations = snapshot.externDeclarations.filter((declaration) => inScopeFile(declaration.declaredIn.path) || inScopeSymbol(declaration.resolvesTo));
	if (snapshot.reachability !== void 0) {
		const reachability = snapshot.reachability;
		if (reachability === null) scoped.reachability = null;
		else {
			const unitIds = /* @__PURE__ */ new Set([...(scoped.executionUnits ?? []).map((unit) => unit.id), ...(scoped.entries ?? []).map((entry) => `${entry.kind}:${symbolName(entry.symbolId)}`)]);
			const byUnit = {};
			for (const [unit, members] of Object.entries(reachability.byUnit ?? {})) {
				const kept = members.filter(inScopeSymbol);
				if (unitIds.has(unit) || kept.length > 0) byUnit[unit] = kept;
			}
			const domains = {};
			for (const [symbol, kinds] of Object.entries(reachability.domains ?? {})) if (inScopeSymbol(symbol)) domains[symbol] = kinds;
			scoped.reachability = {
				byUnit,
				domains,
				unreached: (reachability.unreached ?? []).filter(inScopeSymbol)
			};
		}
	}
	if (snapshot.contractBypass) scoped.contractBypass = snapshot.contractBypass.filter((item) => inScopeSymbol(item.caller) || inScopeSymbol(item.callee) || inScopeFile(item.location.path));
	if (snapshot.typeOnlyIncludes) scoped.typeOnlyIncludes = snapshot.typeOnlyIncludes.filter((item) => inScopeFile(item.source) || inScopeFile(item.target));
	const inScopeFunctionFact = (item) => inScopeSymbol(item.function) || inScopeFile(item.location?.path);
	const scopedUnitIds = new Set((scoped.executionUnits ?? []).map((unit) => unit.id));
	const sideInScope = (sides) => (sides ?? []).some((side) => (side.accesses ?? []).some((access) => inScopeSymbol(access.function)));
	const inScopeResourceFact = (item) => inScopeSymbol(item.variable) || sideInScope(item.units) || sideInScope(item.isrSide) || sideInScope(item.otherSide);
	const totals = {};
	for (const key of [
		"loops",
		"stateMachines",
		"resourceAccesses",
		"criticalSections"
	]) if (snapshot[key]) {
		totals[key] = snapshot[key].length;
		scoped[key] = snapshot[key].filter(inScopeFunctionFact);
	}
	for (const key of ["sharedResources", "conflictCandidates"]) if (snapshot[key]) totals[key] = snapshot[key].length;
	scoped.scanTotals = totals;
	const dataDependencies = snapshot.dataDependencies;
	if (Array.isArray(dataDependencies)) {
		const inScopeUnit = (id) => id === "main:main" || scopedUnitIds.has(id);
		scoped.dataDependencies = dataDependencies.filter((d) => inScopeUnit(d.from) || inScopeUnit(d.to));
		totals.dataDependencies = dataDependencies.length;
	}
	if (snapshot.runModes) scoped.runModes = snapshot.runModes.filter((item) => scopedUnitIds.has(item.unitId) || inScopeSymbol(item.function));
	if (snapshot.sharedResources) scoped.sharedResources = snapshot.sharedResources.filter(inScopeResourceFact);
	if (snapshot.conflictCandidates) scoped.conflictCandidates = snapshot.conflictCandidates.filter(inScopeResourceFact);
	if (snapshot.astFacts !== void 0) scoped.astFacts = snapshot.astFacts;
	if (snapshot.imageFacts) {
		const image = snapshot.imageFacts;
		const objects = (image.objects ?? []).filter((item) => inScopeFile(item.sourcePath ?? void 0));
		const symbols = (image.symbols ?? []).filter((item) => inScopeFile(item.sourcePath ?? void 0));
		const sum = (pick) => objects.reduce((total, item) => total + pick(item), 0);
		scoped.imageFacts = {
			...image,
			objects,
			symbols,
			scopedTotals: {
				objects: objects.length,
				symbols: symbols.length,
				codeBytes: sum((item) => item.codeBytes),
				roDataBytes: sum((item) => item.roDataBytes),
				rwDataBytes: sum((item) => item.rwDataBytes),
				ziDataBytes: sum((item) => item.ziDataBytes),
				romBytes: sum((item) => item.romBytes),
				ramBytes: sum((item) => item.ramBytes)
			}
		};
	}
	const anchorInScope = (item) => {
		if (!item || typeof item !== "object") return true;
		const record = item;
		const anchors = [
			typeof record.function === "string" ? inScopeSymbol(record.function) : null,
			typeof record.caller === "string" ? inScopeSymbol(record.caller) : null,
			typeof record.symbolId === "string" ? inScopeSymbol(record.symbolId) : null,
			typeof record.path === "string" ? inScopeFile(record.path) : null,
			typeof record.location?.path === "string" ? inScopeFile(record.location.path) : null,
			Array.isArray(record.declaredIn) ? record.declaredIn.some((site) => inScopeFile(site.path)) : null
		].filter((value) => value !== null);
		return anchors.length === 0 || anchors.some(Boolean);
	};
	for (const [key, value] of Object.entries(snapshot)) {
		if (KNOWN_SNAPSHOT_FIELDS.has(key)) continue;
		scoped[key] = Array.isArray(value) ? value.filter(anchorInScope) : value;
	}
	return scoped;
}
var KNOWN_SNAPSHOT_FIELDS = /* @__PURE__ */ new Set([
	"schemaVersion",
	"project",
	"analysis_mode",
	"dependency_edges",
	"dependency_cycles",
	"global_variables",
	"functions",
	"variables",
	"semantic_edges",
	"file_metrics",
	"semantic_warnings",
	"metrics",
	"coverage",
	"entries",
	"executionUnits",
	"externDeclarations",
	"reachability",
	"contractBypass",
	"typeOnlyIncludes",
	"loops",
	"stateMachines",
	"resourceAccesses",
	"criticalSections",
	"runModes",
	"sharedResources",
	"conflictCandidates",
	"astFacts",
	"imageFacts",
	"dataDependencies",
	"compile_commands",
	"architecture_config",
	"path_mapping",
	"include_directories",
	"coupling_hotspots",
	"architecture_modules"
]);
var SYMBOL_ID_PATTERN = /^(?:function|variable):(.+):([^:]+)$/;
/** File path encoded in an ArchCheck symbol id (`function:<path>:<name>`), if any. */
function symbolPath(symbolId) {
	return SYMBOL_ID_PATTERN.exec(symbolId)?.[1];
}
function symbolName(symbolId) {
	return SYMBOL_ID_PATTERN.exec(symbolId)?.[2] ?? symbolId;
}
//#endregion
//#region extension/mcp/archx-mcp.mjs
setLocale("en");
var root = path.resolve(process.env.ARCHX_PROJECT_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd());
function projectKey() {
	return crypto$1.createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 20);
}
function viewRequestFile() {
	const base = archxStateDirectory();
	return path.join(base, "view-requests", `${projectKey()}.json`);
}
function requestView(request) {
	const file = viewRequestFile();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	let previous = 0;
	try {
		previous = JSON.parse(fs.readFileSync(file, "utf8")).seq ?? 0;
	} catch {
		previous = 0;
	}
	const payload = {
		seq: previous + 1,
		at: (/* @__PURE__ */ new Date()).toISOString(),
		root,
		...request
	};
	fs.writeFileSync(file, `${JSON.stringify(payload)}
`, "utf8");
	return payload;
}
function factsPointerFile() {
	const base = archxStateDirectory();
	return path.join(base, "facts", `${projectKey()}.json`);
}
var factsCache = null;
/** 还没有事实可读：和 needs-engine 那些一样回一个带 status 的结果，agent 按同一个口子处理 */
var NoFacts = class extends Error {
	constructor() {
		super("No code facts to read yet.");
	}
};
var NO_FACTS = {
	status: "no-facts",
	message: "No code facts to read yet.",
	next: "Call scan_project first (it works without VS Code). show_code_facts is the alternative when the ArchX extension is open."
};
/** 当前这份事实的全部派生结果。同一个文件同一个 mtime 就复用，重扫之后自动失效。 */
function facts() {
	let pointer;
	try {
		pointer = JSON.parse(fs.readFileSync(factsPointerFile(), "utf8"));
	} catch {
		throw new NoFacts();
	}
	if (!fs.existsSync(pointer.factsFile)) throw new Error(`The facts file the pointer refers to is gone: ${pointer.factsFile}. Call show_code_facts again.`);
	const stamp = `${pointer.factsFile}:${fs.statSync(pointer.factsFile).mtimeMs}:${pointer.region}`;
	if (factsCache && factsCache.stamp === stamp) return factsCache;
	const raw = fs.readFileSync(pointer.factsFile);
	const text = raw.length >= 2 && raw.readUInt16BE(0) === 8075 ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8");
	const view = buildFactsView(JSON.parse(text), pointer.region, {
		source: pointer.factsFile,
		generatedAt: pointer.at
	});
	const index = buildIndex(view);
	const themes = {
		execution: buildExecution(view, { index }),
		dependencies: buildDependencies(view, { index }),
		timing: buildTiming(view, { index }),
		concurrency: buildConcurrency(view, { index }),
		stateTransitions: buildStateTransitions(view, { index }),
		memory: buildMemory(view, { index })
	};
	factsCache = {
		stamp,
		pointer,
		view,
		index,
		themes,
		byId: indexById(themes)
	};
	return factsCache;
}
function listCodeFacts() {
	const { pointer, view, themes } = facts();
	return {
		snapshot: pointer.snapshot,
		label: pointer.label,
		projectRoot: pointer.projectRoot,
		region: pointer.region || "(whole scan root)",
		derivedAt: pointer.at,
		scale: {
			files: view.files.length,
			functions: view.functions.length
		},
		themes: overview(themes),
		howToRead: [
			"read_code_facts reads by theme; path drills in; arrays take offset / limit; total in the result says how many there are.",
			"Anything over the per-call limit is refused explicitly with instructions on how to split it; nothing is silently dropped — 'this is all' and 'here is part' must never be confused.",
			"read_fact_object fetches one object by stable ID — the same ID the panel lets you copy.",
			"focus_code_fact shows the person, in the panel, which object you are working on."
		]
	};
}
function readCodeFacts(args) {
	const { themes, pointer } = facts();
	const name = String(args?.theme ?? "");
	if (!(name in themes)) throw new Error(`No such theme: ${name}. Available: ${Object.keys(themes).join(", ")}`);
	const theme = themes[name];
	if (!theme.available) return {
		snapshot: pointer.snapshot,
		theme: name,
		available: false,
		reason: theme.reason ?? null,
		hint: theme.hint ?? null
	};
	return {
		snapshot: pointer.snapshot,
		...slice(name, theme, {
			path: args?.path,
			offset: args?.offset,
			limit: args?.limit
		})
	};
}
function readFactObject(args) {
	const { byId, pointer, view, index } = facts();
	const id = String(args?.id ?? "");
	if (!id) throw new Error("read_fact_object needs a stable ID");
	const found = byId.get(id);
	if (!found) {
		const kind = id.split(":")[0];
		const sameKind = [...byId.keys()].filter((key) => key.startsWith(`${kind}:`)).slice(0, 12);
		return {
			snapshot: pointer.snapshot,
			id,
			found: false,
			note: "This ID is not in these facts",
			sameKind
		};
	}
	const extra = id.startsWith("unit:") || id.startsWith("exec:") ? (() => {
		try {
			return buildRound(view, found.object.entry ?? found.object.symbol ?? found.object.root, { index });
		} catch {
			return null;
		}
	})() : null;
	return {
		snapshot: pointer.snapshot,
		id,
		theme: found.theme,
		path: found.path,
		object: found.object,
		round: extra
	};
}
var tools = [
	{
		name: "scan_project",
		description: "Scan a C/C++ firmware project with the ArchCheck engine — works from a terminal, no VS Code needed. Call this when the user asks to scan / analyze a project. folder defaults to the current project. If a prerequisite is missing (engine, clangd, or build information such as compile_commands.json) nothing is run: the result says what is missing and the exact command to run in the user's terminal; run it, then call again. On success the facts are ready for list_code_facts / read_code_facts, and the result carries a first overview",
		inputSchema: {
			type: "object",
			properties: {
				folder: {
					type: "string",
					description: "absolute path; defaults to the current project root"
				},
				sourceScanOnly: {
					type: "boolean",
					description: "only if the user accepts a scan without build information (files and include dependencies only)"
				}
			}
		}
	},
	{
		name: "list_code_facts",
		description: "Call this first: the snapshot ID of the current code facts, their scale, what question each of the six themes answers, whether it has data, and which fields in each theme can be drilled into. Returns no fact content itself; cheap",
		inputSchema: {
			type: "object",
			properties: {}
		}
	},
	{
		name: "read_code_facts",
		description: "Read one slice of the derived results by theme. theme is one of execution / dependencies / timing / concurrency / stateTransitions / memory; path is a dotted field path (e.g. loops, resources.2.units), omitted means the whole theme; arrays page with offset / limit and total in the result is the full count. Anything over the per-call limit is refused with instructions on how to split; never silently truncated",
		inputSchema: {
			type: "object",
			required: ["theme"],
			properties: {
				theme: { type: "string" },
				path: { type: "string" },
				offset: {
					type: "integer",
					minimum: 0
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 500
				}
			}
		}
	},
	{
		name: "read_fact_object",
		description: "Fetch one object by stable ID — the same ID the panel lets you copy (unit: / exec: / res: / loop: / fsm: / state: / mem: / sym:). For unit: or exec: the unfolded round of that execution unit is attached",
		inputSchema: {
			type: "object",
			required: ["id"],
			properties: { id: { type: "string" } }
		}
	},
	{
		name: "show_code_facts",
		description: "Make the ArchX extension show code facts. With folder (an absolute path) that directory is analyzed (the target project needs no ArchX metadata and is not written to); without it the currently selected partition is used. scan: true rescans first",
		inputSchema: {
			type: "object",
			properties: {
				folder: { type: "string" },
				scan: { type: "boolean" }
			}
		}
	},
	{
		name: "focus_code_fact",
		description: "Point the code-facts panel in the extension at one object so the person sees which one you are working on. id is the stable reference the panel gives",
		inputSchema: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"]
		}
	}
];
/**
* 本地网页：演示页的单文件模板 + 这次的事实。双击就能看，所有图和插件面板一样（同一份代码）。
* 页面里带着这个工程的全部事实——它只写在本机的 ArchX 状态目录里，转发这个文件就等于把事实发出去。
*/
function writeLocalViewer({ folder, outDir, scoped, snapshot, raw }) {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const template = path.resolve(here, "..", "viewer", "archx-viewer.html");
	if (!fs.existsSync(template)) return {
		available: false,
		note: "viewer template not found next to the MCP server; rebuild the plugin (npm run build:viewer)"
	};
	const view = buildFactsView(scoped, "", {
		source: folder,
		generatedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
	const units = {};
	for (const u of view.entries?.units ?? []) units[u.kind] = (units[u.kind] ?? 0) + 1;
	const project = {
		id: "local",
		title: path.basename(folder),
		repo: "",
		commit: "",
		license: "",
		kind: "local",
		blurb: `Local scan of ${folder}`,
		build: "",
		focus: ["**"],
		region: "",
		snapshot,
		localRoot: folder,
		counts: {
			files: view.files.length,
			functions: view.functions.length,
			units,
			sharedResources: view.ast?.sharedResources?.length ?? 0,
			conflictCandidates: view.ast?.conflictCandidates?.length ?? 0
		}
	};
	const embed = {
		generatedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
		engineCommit: "",
		project,
		data: zlib.gzipSync(JSON.stringify(view)).toString("base64")
	};
	const html = fs.readFileSync(template, "utf8").replace("window.__ARCHX_EMBED__ = null;", () => `window.__ARCHX_EMBED__ = ${JSON.stringify(embed).replace(/</g, "\\u003c")};`);
	const file = path.join(outDir, "archx-facts.html");
	fs.writeFileSync(file, html, "utf8");
	return {
		available: true,
		file,
		url: pathToFileURL(file).href,
		sizeKB: Math.round(html.length / 1024),
		note: "Contains this project's facts; it lives only on this machine. Forwarding the file shares the facts."
	};
}
function scanProjectTool(args) {
	const folder = path.resolve(String(args?.folder || root));
	const stateDir = archxStateDirectory();
	const outDir = path.join(stateDir, "scans", projectKey$1(folder));
	const result = scanProject({
		folder,
		stateDir,
		outDir,
		sourceScanOnly: Boolean(args?.sourceScanOnly)
	});
	if (result.status !== "scanned") return result;
	const raw = JSON.parse(fs.readFileSync(result.factsFile, "utf8"));
	const scoped = projectFactsToPartition(raw, createPartition({
		name: path.basename(folder),
		focusPaths: ["**"]
	}));
	const partitionFile = path.join(outDir, "partition.json.gz");
	fs.writeFileSync(partitionFile, zlib.gzipSync(JSON.stringify(scoped)));
	const snapshot = crypto$1.createHash("sha256").update(JSON.stringify(scoped)).digest("hex").slice(0, 12);
	publishFactsPointer(root, {
		factsFile: partitionFile,
		region: "",
		projectRoot: folder,
		snapshot,
		label: path.basename(folder)
	});
	factsCache = null;
	const viewer = writeLocalViewer({
		folder,
		outDir,
		scoped,
		snapshot,
		raw
	});
	let firstLook = null;
	try {
		firstLook = listCodeFacts();
	} catch (error) {
		firstLook = { note: error instanceof Error ? error.message : String(error) };
	}
	return {
		...result,
		snapshot,
		viewer,
		next: "Read with list_code_facts / read_code_facts / read_fact_object. Give the user the viewer link (viewer.url): it opens the same facts as pictures in a browser, no server needed. If the VS Code extension is installed, show_code_facts opens them in its panel as well.",
		overview: firstLook
	};
}
async function toolCall(name, args) {
	try {
		return await dispatchTool(name, args);
	} catch (error) {
		if (error instanceof NoFacts) return NO_FACTS;
		throw error;
	}
}
async function dispatchTool(name, args) {
	if (name === "scan_project") return scanProjectTool(args);
	if (name === "list_code_facts") return listCodeFacts();
	if (name === "read_code_facts") return readCodeFacts(args);
	if (name === "read_fact_object") return readFactObject(args);
	if (name === "show_code_facts") return {
		requested: requestView({
			kind: "show",
			folder: args?.folder ?? null,
			scan: Boolean(args?.scan)
		}),
		note: "The extension opens the code-facts panel and shows it. The person sees the same derived results you read; the snapshot ID is in the panel header."
	};
	if (name === "focus_code_fact") {
		const id = String(args?.id ?? "");
		if (!id) throw new Error("focus_code_fact needs a stable reference id");
		return { requested: requestView({
			kind: "focus",
			id
		}) };
	}
	throw new Error(`Unknown ArchX tool: ${name}`);
}
function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}
function respond(id, result) {
	send({
		jsonrpc: "2.0",
		id,
		result
	});
}
function fail(id, error) {
	send({
		jsonrpc: "2.0",
		id,
		error: {
			code: -32e3,
			message: error instanceof Error ? error.message : String(error)
		}
	});
}
readline.createInterface({
	input: process.stdin,
	crlfDelay: Infinity
}).on("line", async (line) => {
	if (!line.trim()) return;
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		return;
	}
	if (request.id === void 0) return;
	try {
		if (request.method === "initialize") respond(request.id, {
			protocolVersion: request.params?.protocolVersion || "2025-06-18",
			capabilities: { tools: {} },
			serverInfo: {
				name: "archx",
				version: "0.25.1"
			}
		});
		else if (request.method === "ping") respond(request.id, {});
		else if (request.method === "tools/list") respond(request.id, { tools });
		else if (request.method === "tools/call") {
			const result = await toolCall(request.params?.name, request.params?.arguments || {});
			respond(request.id, {
				content: [{
					type: "text",
					text: JSON.stringify(result)
				}],
				structuredContent: result
			});
		} else fail(request.id, /* @__PURE__ */ new Error(`Unsupported MCP method: ${request.method}`));
	} catch (error) {
		if (request.method === "tools/call") respond(request.id, {
			isError: true,
			content: [{
				type: "text",
				text: error instanceof Error ? error.message : String(error)
			}]
		});
		else fail(request.id, error);
	}
});
//#endregion
export {};
