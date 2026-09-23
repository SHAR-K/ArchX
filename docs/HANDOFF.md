# 交接：接手这个仓库要先知道的事

> 更新时间：2026-09-23
> 用途：一个新会话从这里开始，不需要翻聊天记录。方向和待办看 `ARCHX_DIRECTION.md`，
> 这份只记「不写下来就会重新踩一遍」的东西。

## 1. 引擎只有一份源码，打包产物可能跟它不一样

`engine/` 是唯一的源码。`extension/engines/<平台>/archcheck.exe` 是它的 PyInstaller 构建产物
（gitignore），`npm run build:archcheck-engine` 生成。**插件面板默认用这个 exe，不用源码。**

踩过的坑：打包脚本曾经只带 `templates/`，没带 `profiles/*.yaml`。exe 于是一条 RTOS 规则都匹配
不上——`scheduling` 恒为 unknown、`xTaskCreate` 认不出任务、临界区数为 0——而且**不报错**。
从源码跑 CLI 一切正常，所以 CLI 验证过的读数和面板上看到的长期不是同一套事实。同一个
FreeRTOS 工程上两边的 `scheduling`、task 数、timer 数、临界区都对不上。

现在 `tools/archcheck-engine-smoke.mjs` 守着：拿一个两行的 FreeRTOS 程序跑 exe，断言 profile
生效（preemptive、一个 task、优先级、周期）。打包脚本缺 profiles 目录时拒绝构建。

调试面板时想绕过 exe、直接用源码：VS Code 设置 `archx.archcheck.enginePath` 指向本仓库 `engine/`。

任何脚本的默认路径都不许指向仓库外——历史上这样静默用到过另一份引擎，扫出的事实和源码
对不上且不报错。

## 2. 外部验证语料

清单在 `corpus/external.yaml`（只记仓库、提交、怎么产出编译数据库、应该读出什么，
源码一律不入库）。按提交 clone 到 `corpus/external/<id>/`（gitignore），扫描产物写到
`work/corpus-scan/<id>/`（gitignore），静态演示页的数据由后者生成（`docs/SITE.md`）。

几件不在清单里的实情：

- stm32h743 用它自己生成的 `build/compile_commands.json` 就能扫出和基线一致的读数；
  CMake 配置时加 `-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY`，否则交叉编译器的试编译会失败。
  没有 make 时用 Ninja（`-G Ninja`，`pip install ninja` 即可）。
- hoverboard-foc 两条路都能出事实：PlatformIO `pio run -e VARIANT_ADC -t compiledb`，或 Keil
  `MDK-ARM/mainboard-hack.uvprojx` target `VARIANT_ADC`。两者编译单元数不同（多编了 HAL 驱动），
  运行结构读数一致。Keil 路径没装 CMSIS Pack 会警告，不影响读数。
- gd32f30x、hoverboard-sideboard 要 Windows + MDK 的头文件。
- vesc-bldc 和 odrive 还没验证过（清单里标着 `not-yet-verified`）。

## 3. clangd 的那堵墙

这一轮做并行时撞到的，是后面两件大事共同的前提，别再从头查一遍。

**clangd 的跨文件答案是「进程」的属性，不是代码的属性。** 它只对自己 didOpen 过的文档
回答 AST 相关的请求；问一个没打开过该文件的进程，`outgoing_calls` 直接报
"trying to get AST for non-added document"，而 `references` 更坏——它给一个更小的答案，
不报错。

后果有两个，方向相同：

- **并行**分片之后，跨片的引用会漏。问遍所有分片取并集能补回大半（36 单元的工程上
  丢 11 条边变成丢 2 条），补不全，剩下的还取决于每片后台索引跑到哪儿，那是竞态。
- **增量**跳过没改的编译单元，就等于不打开它们，同样看不见。

出路是 C1：这两类跨文件查询和我们已经收上来的 AST 事实高度重复，实测调用 349/351、
引用 137/137 且行号逐个对上，只差 2 条函数指针调用。改成自己推，两件事一起解锁。

## 4. 量过的数，别重新猜

一个中等规模工程（两百来个文件）上的剖面，只记结论：

- 扫描时间里**等 clangd 占一半**，是唯一值得并行的地方；我们这边解 JSON 只占 2%。
- `textDocument/ast` 的字节数与耗时相关系数 0.98——慢在 clangd 吐的 JSON 大，不在调用次数。
- 本机管道裸吞吐 2.4 GB/s，不是瓶颈。
- AST JSON 里没有水分：`arcana` 占一半但它是承重的（引擎用正则从里面抽符号身份和类型），
  `range` 30%，`role`+`kind` 14%，`detail` 5%。

STM32H743（332 单元 / 4887 函数，公开工程，可复现）：串行约 201 s，jobs=2 约 156 s（快 22%，
事实精确），jobs=4 约 162 s（漏 2 条调用），jobs=8 约 198 s（多出 104 个函数，合并去重有洞）。
**并行天花板就是 22%，两片到顶。**

落盘体积：不缩进 + gzip 大约缩到原来的 3.5%，读还更快。从磁盘到六个主题全派生完不到
120 ms——**所以不要做数据库**，理由写在 `ARCHX_DIRECTION.md` §8。

## 5. HTML 原型：唯一能对照「原来那个表达长什么样」的东西

插件面板的每个主题都是从它借鉴来的，搬的是表达方式不是代码。它整套在
`packages/facts-view/` 下：

| 文件 | 是什么 |
| --- | --- |
| `facts-preview.template.html` | 模板 + 骨架，本身带着入口 / 运行图 / 执行树 / 双根对比 / 并发 / 状态机 / 时序 / 中断八个页签 |
| `preview/10-beat.{js,css}` | 节拍：毫秒横轴的一页画布 |
| `preview/20-memory.{js,css}` | 内存 |
| `preview/30-seq-tree.{js,css}` | 一轮的列式展开 |
| `preview/40-deps.{js,css}` | 分层 DSM |
| `facts-preview.mjs` | 生成器：读 partition.json → 投影 → 把片拼进模板 → 一个自包含 HTML |

```
node packages/facts-view/facts-preview.mjs <partition.json> --region src/ --out work/x.html
```

投影层是和插件共用的（都调 `src/projection.mjs`），往下才分叉：原型直接拼 DOM，
插件走 `src/<主题>/` 的派生加 React。拼接而不是 ES module 是有原因的，写在
`preview/README.md` 里：预览是 `file://` 打开的，import 会被 CORS 拒。

已搬过来的表达：依赖的排序回放、切割集、一轮的列式展开、状态机 UML。
没搬的：节拍那张画布（B7），双根对比（归并主题时并掉了，表达方式没跟过去）。
不打算搬的：原型的三栏外壳和它自己那套配色——插件面板窄，且要遵守 VS Code 主题。
理由记在 `ARCHX_DIRECTION.md` §7。

## 6. 改事实的产生方式时，怎么验

1. `npm test` —— 自建样例 `corpus/blinky` 的金样逐字节比，加六个主题的结构断言。
2. 样例源码或引擎改了：`node --experimental-strip-types tools/corpus-record.mjs`
   一条命令重扫、归一 `project` 为相对路径、写明文缩进的夹具、刷新金样。
   **不要手工做这两步**，各踩过一次坑。
3. 真实规模：在 `corpus/external/` 的公开工程上扫，和 `corpus/external.yaml` 的基线逐项比。
   **产物一律写到仓库外或 gitignore 的目录**。
4. 判据是「同一份输入，产物逐字段一致」。允许不同的只有 `astFacts.elapsedSeconds`
   和 `compile_commands`（`--out` 路径）。
5. 动了打包：跑 `tools/archcheck-engine-smoke.mjs`，确认 exe 和源码读出同一套事实（§1）。

金样比对是行尾归一之后再比的：Windows 上任何一次 git 操作都可能把工作区那份写成 CRLF，
逐字节比会假失败，为这个排查过两次。

## 7. 从外部驱动面板（截图、复验）

- 开发主机：`code -n --extensionDevelopmentPath=<仓库>/extension <目标工程目录>`，
  直接跑 `extension/` 目录，不用打包安装。
- 命令 `ArchX: Analyze Folder and Open Code Facts` 不带参数会弹系统目录对话框；对话框里回车
  是导航不是确认，要点确认按钮。
- 扫描完成后要等几秒再切主题，否则点击会落到相邻项。
- 只想看页面效果，用静态演示页更省事：`npm run build:site` 后起个静态服务（`docs/SITE.md`）。
- 还没有从命令行 / URI 直接触发「分析某个目录」的入口；有了之后这一节可以删一半。

## 8. 装机注意

`npm run package:extension` 产出 `extension/archx-win32-x64-<版本>.vsix`。

VS Code 对同一个扩展 id 只加载**最高版本**。机器上装过更高版本号的旧包，新装的低版本
不会生效，看起来就像「改了没用」——验证前先 `code --list-extensions --show-versions` 看一眼。

## 9. 不进仓库的东西

任何非公开工程（包括维护者手上的私有工程）只做只读验收：它的源码、事实、符号、目录、
参数、规模不得进入本仓库、提交、VSIX、文档、注释或测试夹具，**改名脱敏也不算数**——
结构上仿一个私有工程写夹具，同样算。发现的问题记为「失败 / 不支持 / 数据不足」，
修复要另建独立的通用样例复现。所有分析产物写到仓库外。
