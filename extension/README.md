# ArchX VS Code Extension

ArchX 在 VS Code 中统一展示目标架构、ArchCheck 代码事实和受约束 Agent 工作流。

Windows x64 安装包内置 ArchCheck 独立引擎和 Python 运行时，安装 VSIX 后即可扫描，不需要额外配置 Python 或 `enginePath`。

左侧“目标架构”按架构父子关系折叠展开。每个节点还可继续展开“代码绑定”和“负责范围”，代码绑定可直接打开对应文件和行。

代码地图的模块画布默认折叠为分区与边界分组；原文件和函数画布合并为惰性“代码树”，按需展开目录、文件和函数，不截断节点总数。代码地图表达静态事实，不等同于目标架构。

从代码地图选择区域后，“架构分析与优化”会自动创建或复用分析分区并运行 ArchCheck。Agent 提交的当前子架构保存在 `.archx/analyses/`，节点包含职责、架构输入输出、代码证据、置信度和不确定项；用户确认后才可继续生成优化提案。界面按席克定律逐步解锁当前阶段操作。

## 右侧 Agent

插件在 VS Code Secondary Side Bar 注册独立的 ArchX 控制视图，并可安装随 VSIX 发布的 Claude Code 原生插件。原生插件通过 `/archx:design` 与 `/archx:deliver` 两个连续工作流和本地 MCP 读取当前节点、恢复局部现状架构、提交候选架构、读取已批准变更单并交付代码。

所有 Agent 对话都在 Claude Code 原生侧栏进行，由其管理会话、权限、工具过程和 Diff；ArchX 只负责工作流选择、MCP 上下文预览、架构审批和验证门禁，不再内置聊天客户端或启动 Claude CLI 子进程。

原生 `/archx:deliver` 会创建隔离 Git worktree 和执行租约。随插件安装的 Hook 强制 `ownedPaths`、验证命令和 `.archx` 状态保护，并将真实命令证据与 Diff 回写到 ArchX 执行审查。

架构提案先进入候选区，支持节点编辑、关系审批和检查点回滚。实现任务必须绑定已批准变更单，并在隔离 worktree 中运行；右侧“执行审查”展示 Git Diff、范围审计和验证证据，只有 ArchCheck 复检通过后才能合并。

## 开发

在仓库根目录执行：

```bash
npm run build:extension
```

然后在 VS Code 中使用 `Run ArchX Extension` 调试配置启动 Extension Development Host。
