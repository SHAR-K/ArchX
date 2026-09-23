# facts-view

把 ArchCheck 的分区事实变成页面和 AI 都能用的东西。分三层，互不越界：

| 层 | 位置 | 职责 | 允许依赖 |
| --- | --- | --- | --- |
| 投影 | `src/projection.mjs` | 事实 → 视图模型：目录分组、模块与层序、调用/注册/使能边、入口与执行域、AST 事实按区域过滤 | 无。不用 node 内置模块，浏览器 / webview / 扩展宿主都能跑 |
| 派生 | `src/<主题>/` | 真正的分析：排序、聚簇、布局几何、状态机层级 | 投影的输出 |
| 渲染 | 消费方各自实现 | DOM / React / SVG | 派生的输出 |

派生只出普通数据结构，布局只出坐标，不出 SVG 字符串。这样同一份结果能同时给页面、插件 webview 和 MCP，
"人和 AI 看到同一份分析"才不是一句口号。

## 消费方

- `facts-preview.mjs`：命令行生成自包含 HTML，开发期的快速迭代通道
- VS Code 插件 webview：逐主题迁移中
- MCP：读同一份输出，快照 ID 对齐

## 回归

`tools/facts-view-smoke.ts` 拿自建样例 `corpus/blinky` 的事实跑投影，和 `corpus/blinky/facts/view.json`
金样逐字节比。样例是三文件 C 工程，事实已存成静态夹具，测试不需要 clangd，也不依赖任何真实工程。

样例源码或引擎改了要重记夹具与金样。扫描器要读样例自己的分区定义，而那个目录整个被
gitignore，没进版本库，所以先照下面这份在 `corpus/blinky` 下建出 `<点>archx/project.json`，
`<点>` 就是一个英文句点：

```json
{ "id": "blinky", "name": "blinky",
  "partitions": [{ "id": "application", "name": "application", "focusPaths": ["src/**"] }] }
```

然后一条命令：

```
node --experimental-strip-types tools/corpus-record.mjs
```

它重扫、把事实里的 `project` 归一成相对路径（绝对路径是 clone 位置决定的，签进版本库就只在
一台机器上成立）、写成明文缩进的夹具，再刷新金样。手工做这两步各踩过一次坑，所以固化成脚本。

扫描器落盘的是 `partition.json.gz`（不缩进 + gzip：一个中等规模工程 14 MB 上下变 0.5 MB，
读起来还更快）。夹具反过来存明文，它只有一百来 KB，diff 看得见，值这个体积。读取一律嗅探
gzip magic 不看后缀，所以两种都能直接喂给面板和测试。

投影输出有意改动时同样用 `UPDATE_GOLDEN=1` 重记，并在 diff 里逐条确认改了什么。
