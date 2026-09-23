---
name: archcheck
description: Scans a repository or folder with the ArchCheck engine, shows the derived code facts in the ArchX panel, and reads them back by theme with on-demand slicing. Use when the user asks to scan, analyse, or look at the facts of a codebase, or asks about its execution units, dependencies, timing, shared state, state machines, or memory.
argument-hint: "[要分析的目录，留空则用当前分区]"
---

# 扫描代码事实

Reply in the user's language. This step only reads code; it changes no files.

## 做什么

1. Call `scan_project` (works in a plain terminal, no VS Code). Pass `folder` if the user named one.
   If it returns `needs-build-info`, `needs-clangd` or `needs-engine`, nothing was run: tell the user what is
   missing, run the command it gives in the user's terminal (ask first — it uses their build environment),
   then call `scan_project` again. On success the result has `viewer.url`: give it to the user — a local
   page with every picture (run map, timing, execution tree…), no server needed. Mention it holds this
   project's facts and stays on their machine. When VS Code with the ArchX extension is open,
   `show_code_facts` also shows the same facts in the panel.
2. 调用 `list_code_facts`。它便宜，不返回事实内容，只给快照 ID、规模、六个主题各答什么问题、
   有没有数据、每个主题里有哪些字段能往下钻。**先看这个再决定读什么**，不要上来就拉一整个主题。
3. 用 `read_code_facts` 按需取。人在面板上看到的和你读到的是同一份派生结果，快照 ID 就是对齐的凭据。
4. 把读数讲给人听。先讲范围和覆盖，再讲这次能看出什么，最后讲哪些地方数据不足。
5. 之后每处理一个具体对象，调用 `focus_code_fact` 把面板停到那个 ID 上，人就能看到你在看哪一个。

## 怎么取

`read_code_facts` 要 `theme`，可选 `path`、`offset`、`limit`。

- `theme`：`execution` 从哪里开始什么会被触达 · `dependencies` 谁依赖谁 · `timing` 先后与等待 ·
  `concurrency` 谁和谁访问同一资源 · `stateTransitions` 状态怎么变 · `memory` 空间花在哪。
- `path` 是点分字段路径，`loops`、`units`、`resources.2.units` 都行。不给就是整个主题，
  大工程上多半会超上限被拒。
- 数组返回里 `total` 是总条数，`more` 说明还剩多少。**`total` 和你手里的条数不一致就是还没读完**，
  不要拿一页当全部去下结论。
- 超过单次上限会明确拒绝，并告诉你平均一条多大、limit 该取多少、或者往哪个字段钻。
  它不会悄悄少给几条——「就这些」和「给你看了一部分」这个区别不能混。

`read_fact_object` 按稳定 ID 取一个对象，ID 就是面板上能复制的那个：
`unit:` 执行单元 · `exec:` 入口 · `res:` 共享变量 · `loop:` 循环 · `fsm:` 状态机 ·
`state:` 状态 · `mem:` 内存模块 · `sym:` 符号。给 `unit:` 或 `exec:` 时会附带这个执行单元的
一轮展开（它跑一圈都经过什么、在哪停下、循环怎么出去）。

一条常用路线：`list_code_facts` → 哪个主题有数据 → `read_code_facts` 取那个主题的索引类字段
（`units`、`leaves`、`resources`）→ 挑出可疑的那几个 → `read_fact_object` 逐个看细节 →
`focus_code_fact` 让人跟着看。

## 讲读数的规矩

- 只说事实里有的。每条结论都要能指到文件和行，指不到就别说。
- 区分「没有」和「没测到」。引擎认不出的东西要说成数据不足，不能说成不存在。
  返回里的空数组是「查过，没有」，字段缺席才是「没这一项」，两者不要混着讲。
- 状态机是候选，不是断言：引擎把 `switch(变量)` 当候选，case 标签当状态，switch 内对分派变量的赋值当转换，
  包围它的 if 条件当近似转换条件。讲的时候把这个口径带上。
- 时间是下界不是实测：周期来自延时实参乘以 tick，引擎知道代码里写了什么数字，不知道任何一段代码真实跑多久。
- 冲突是候选不是结论；未识别的保护不等于没有保护；通知标志是设计意图，长得像竞争但不是。
- 聚簇是引擎从边算出来的推导，不是事实；参数是旋钮。讲的时候要分清它和目录分组。
- 置信度、来源、近似标记照抄，不要替引擎提高把握。
- 不要给「这个架构好不好」的评价，除非用户问。先把现状讲清楚。

## 覆盖不足时怎么说

- 没有 AST 层事实：说明这次是源码扫描，没有构建信息，只能给文件与依赖，给不了状态机、并发和时序。
  告诉用户构建信息在哪能找到（compile_commands.json 或 Keil 工程）。
- 扫描根比所选目录大：说清扫描根在哪、依据是什么。构建信息决定引擎能看到哪些编译单元，
  所选目录只是显示区域。不要让范围被悄悄扩大而不说。
- 内存主题没有数据：说明工程里没有链接产物（armlink / Keil 的 .map），不是「没有内存问题」。
- 引擎报了警告：挑影响结论的那几条讲，不要整段倒出来。

## 不要用的工具

`get_active_context`、`get_node_contract`、`get_partition_facts`、`get_local_architecture_evidence`
以及提案、变更、执行那几个，都属于旧的「人先画目标架构」流程，和这个 skill 不是一回事。
读代码事实只用上面三个 `*_code_facts` / `*_fact_object`。

本轮用户要求：$ARGUMENTS
