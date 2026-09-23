# 静态演示页：插件的面板挂在 GitHub Pages 上

> 2026-09-23。对外地址 https://shar-k.github.io/ArchX/ 。定位见 `CLAUDE.md`，不在这里复述。

## 是什么

插件 webview 的同一份代码（`extension/webview/facts/`），在浏览器里跑，宿主那一半由 `site/main.tsx`
顶替：`acquireVsCodeApi` 换成一个本地 shim，面板问什么就用 `packages/facts-view/src/payload.mjs` 里的
`answer()` 答——和 VS Code 扩展宿主调的是同一个函数，所以演示页和插件不会各说各话。
「打开文件」变成跳到 GitHub 上那个 commit 的那一行。

它是**样品间**，不是产品形态：一个 commit 的快照，两个公开工程，看完想看自己的就装插件。
页面顶栏第一屏就写着这句。

## 数据从哪来

| 工程 | 分区 | 体积 |
| --- | --- | --- |
| hoverboard-foc（裸机） | 整仓库 | 3.7 MB → 0.23 MB gz |
| stm32h743（FreeRTOS） | `Core/** Applications/** Libraries/FreeRTOS-Plus-CLI/** Middlewares/Third_Party/**` | 17 MB → 0.58 MB gz |

`tools/build-site.mts` 读 `work/corpus-scan/<id>/architecture.json`（本机扫描产物，gitignore），切分区、投影，
gzip 写到 `site/public/data/`。**只存投影不存主题**：主题在页面里由 `derivePayload` 现算，主题一改重新
build 页面即可，数据文件不动。数据文件入库（合计 0.8 MB），CI 的 `site.yml` 只构建页面不扫代码。
源码不入库，理由见 `corpus/external.yaml` 开头。

重新生成数据：先按 `corpus/external.yaml` 里两个工程的 `compile_db` 扫一遍（产物写到 `work/corpus-scan/<id>/`），再 `npm run site:data`。
换引擎后要重扫，然后 manifest 里的 `engineCommit` 会跟着变。

## 检查

`npm test` 末尾：`npm run build:site && node --experimental-strip-types tools/site-smoke.ts`。起本地静态服务，
无头 Chromium 打开两个工程的英文页，断言六个主题、文件数函数数、快照 ID 都在，左栏有对象。
没浏览器就跳过，和 `facts-panel-smoke` 一样。

坑：浏览器要向本进程的服务要文件，`spawnSync` 会把事件循环一起卡住，两边互等，必须异步 spawn。

## 做的过程中反推出来的

按「改了 / 没改」分：

**改了**

- 分区投影原样透传 `dataDependencies`（单元两两之间、O(n²)），stm32h743 是 40383 对 169 MB，切成四个
  目录还是 169 MB。现在只留一端在分区里的对 → 6.4 MB。见 `ARCHX_DIRECTION.md` §8。
- 宿主的 payload 派生和按需应答原来长在 `facts-panel.ts` 里，和 vscode 绑在一起；抽成 `payload.mjs`
  之后演示页、宿主、以后的任何消费方都是一份代码。

- 抢占式工程的时间页原来是空的（Linker 文档 2.2）。做 stm32 那一页时发现是三件事叠在一起：应用线程没认出来、
  延时规则没有时长、没有任务优先级。三件都修在引擎侧，加了 `corpus/rtos-mini` 样例进 CI（引擎端到端 + 投影两层）。
- 初始化器里的 C 风格转换 `(osPriority_t) osPriorityNormal`：AST 解包取了第一个孩子，是类型节点不是表达式，
  枚举引用被静默丢掉。这个 bug 影响所有带 cast 的聚合初始化器，不只优先级。

**没改，记着**

- `dataDependencies` 每对平均 20 条 `resources`，每条约 200 字节；节拍页只用 `order` 和变量名。引擎侧瘦身。
- `dependencyOrder` 2.4 MB 是整工程的目录序，分区后不裁。
- 引擎产出里还有中文（`timeBase[].note` 等），英文页面上会露出来；这是待办里「引擎 97 句」那一项。
- 演示页的快照 ID 是分区后事实的 sha256 前 12 位，和插件打开同一份 `partition.json` 得到的一致；
  但和 CLI 直接报的整工程快照不同——它们本来就不是同一份事实。
- `main` 有自带 while(1) 的最小语料还是没有，裸机主循环那条路径只在 hoverboard 上手工验过。
