from __future__ import annotations

import json
from html import escape
from pathlib import Path

from archcheck.model import AnalysisResult


def write_reports(result: AnalysisResult, output_directory: Path) -> tuple[Path, ...]:
    output_directory = output_directory.expanduser().resolve()
    output_directory.mkdir(parents=True, exist_ok=True)

    architecture_path = output_directory / "architecture.json"
    metrics_path = output_directory / "metrics.json"
    report_path = output_directory / "report.md"
    html_path = output_directory / "report.html"

    # 同理不缩进：17 MB 里有 6 MB 是空格，而这份文件是给程序读的
    architecture_path.write_text(
        json.dumps(result.to_dict(), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    metrics_path.write_text(
        json.dumps(result.metrics.to_dict(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    report_path.write_text(_render_markdown(result), encoding="utf-8")
    html_path.write_text(_render_html(result), encoding="utf-8")
    return architecture_path, metrics_path, report_path, html_path


def _render_html(result: AnalysisResult) -> str:
    template_path = Path(__file__).parent / "templates" / "report.html"
    template = template_path.read_text(encoding="utf-8")
    data = json.dumps(result.to_dict(), ensure_ascii=False).replace("<", "\\u003c")
    return (
        template.replace("__ARCHCHECK_DATA__", data)
        .replace("__ARCHCHECK_PROJECT__", escape(result.project.name))
    )


def _render_markdown(result: AnalysisResult) -> str:
    analysis_mode = (
        "编译数据库" if result.analysis_mode == "compilation-database" else "源码树扫描"
    )
    extension_rows = "\n".join(
        f"| `{extension}` | {count} |"
        for extension, count in result.metrics.files_by_extension.items()
    )
    include_rows = "\n".join(f"- `{path}`" for path in result.include_directories)
    if not include_rows:
        include_rows = "- 未发现"
    compilation_database = (
        f"`{result.compile_commands}`"
        if result.compile_commands is not None
        else "未使用（源码树扫描）"
    )
    path_mapping = (
        f"`{result.path_mapping.source}` -> `{result.path_mapping.target}`"
        if result.path_mapping is not None
        else "无"
    )
    architecture_config = (
        f"`{result.architecture_config}`"
        if result.architecture_config is not None
        else "未加载"
    )
    module_rows = "\n".join(
        f"| `{module}` | {count} |"
        for module, count in sorted(
            result.metrics.files_by_module.items(),
            key=lambda item: (-item[1], item[0]),
        )
    ) or "| 无 | 0 |"
    hotspot_rows = "\n".join(
        f"| `{item.path}` | {item.fan_in} | {item.fan_out} | {item.total} |"
        for item in result.coupling_hotspots
    ) or "| 无 | 0 | 0 | 0 |"
    cycle_sections = []
    for index, group in enumerate(result.dependency_cycles[:20], start=1):
        members = "\n".join(f"- `{path}`" for path in group)
        cycle_sections.append(f"### 依赖组 {index}（{len(group)} 个文件）\n\n{members}")
    cycle_text = "\n\n".join(cycle_sections) or "未发现 include 循环依赖。"
    global_rows = "\n".join(
        "| "
        f"`{item.name}` | `{item.type_name}` | {item.storage} | "
        f"`{item.definition.path}:{item.definition.line}` | "
        f"{len(item.references)} | {item.referenced_files} |"
        for item in result.global_variables[:100]
    ) or "| 无 | | | | 0 | 0 |"
    warning_rows = "\n".join(f"- {warning}" for warning in result.semantic_warnings)
    if not warning_rows:
        warning_rows = "- 无"
    coverage_rows = ""
    if result.coverage is not None:
        coverage_rows = (
            f"| 编译目标 | {result.coverage.target} |\n"
            f"| 磁盘源文件 | {result.coverage.source_files_on_disk} |\n"
            f"| 进入分析的源文件 | {result.coverage.files_analyzed} |\n"
            f"| 未进入编译数据库 | {len(result.coverage.excluded)} |\n"
        )
    unit_counts: dict[str, int] = {}
    for unit in result.execution_units:
        unit_counts[unit.kind] = unit_counts.get(unit.kind, 0) + 1
    runtime_rows = (
        f"| 入口 | {len(result.entries)} |\n"
        + "".join(f"| 运行单元（{kind}） | {count} |\n" for kind, count in sorted(unit_counts.items()))
        + f"| extern 声明 | {len(result.extern_declarations)} |\n"
        f"| 契约绕过 | {len(result.contract_bypass)} |\n"
        f"| 仅类型 include | {len(result.type_only_includes)} |\n"
        f"| 未触达函数 | {len(result.reachability.unreached) if result.reachability else 0} |"
    )
    if result.ast_facts is not None:
        run_mode_counts: dict[str, int] = {}
        for mode in result.run_modes:
            run_mode_counts[mode.mode] = run_mode_counts.get(mode.mode, 0) + 1
        runtime_rows += (
            f"\n| AST 已分析函数 | {result.ast_facts.functions_analyzed}/{result.ast_facts.functions_requested} |\n"
            f"| 循环 | {len(result.loops)} |\n"
            f"| 状态机候选 | {len(result.state_machines)} |\n"
            f"| 变量访问（读/写分类） | {len(result.resource_accesses)} |\n"
            f"| 临界区（same-block 近似） | {len(result.critical_sections)} |\n"
            f"| 跨运行单元共享变量 | {len(result.shared_resources)} |\n"
            f"| 中断/任务冲突候选 | {len(result.conflict_candidates)} |"
            + "".join(f"\n| 运行模式（{mode}） | {count} |" for mode, count in sorted(run_mode_counts.items()))
        )
    data_callbacks = sum(1 for unit in result.execution_units if unit.form is not None)
    unresolved_sites = sum(1 for site in result.enable_sites if not site.resolved_to)
    runtime_rows += (
        f"\n| 经结构体字段 / 初始化表 / 注册参数发现的回调 | {data_callbacks} |\n"
        f"| 非常量 IRQ 使能点（已解析 / 未解析） | {len(result.enable_sites) - unresolved_sites} / {unresolved_sites} |\n"
        f"| 外部（闭源 / 未编译）符号 | {len(result.external_symbols)} |\n"
        f"| 含未激活预处理区域的文件 | {sum(1 for item in result.inactive_regions if item.regions)} |\n"
        f"| 未激活区域内的函数定义（文本扫描） | {len(result.inactive_functions)} |"
    )
    conflict_rows = "\n".join(
        f"| `{item.name}` | {item.pattern} | "
        f"{'、'.join(unit.unit_id for unit in item.isr_side)} | "
        f"{'、'.join(unit.unit_id for unit in item.other_side)} | {item.confidence} |"
        for item in result.conflict_candidates[:60]
    ) or "| 无 | | | | |"

    return f"""# 架构分析报告

项目：`{result.project}`

分析模式：`{analysis_mode}`

编译数据库：{compilation_database}

路径映射：{path_mapping}

架构配置：{architecture_config}

## 摘要

| 指标 | 数值 |
| --- | ---: |
| 编译单元 | {result.metrics.translation_units} |
| 唯一源文件 | {result.metrics.source_files} |
| include 递归触达文件 | {result.metrics.analyzed_files} |
| include 目录 | {result.metrics.include_directories} |
| 本地 include 依赖 | {result.metrics.include_edges} |
| 循环依赖组 | {result.metrics.dependency_cycle_groups} |
| 全局变量 | {result.metrics.global_variables} |
| 跨文件全局变量 | {result.metrics.cross_file_global_variables} |
| 函数 | {result.metrics.functions} |
| 变量（含局部变量） | {result.metrics.variables} |
| 函数调用关系 | {result.metrics.function_calls} |
| 函数到变量关系 | {result.metrics.variable_references} |
| 总行数 | {result.metrics.total_lines} |
| 有效代码行 | {result.metrics.code_lines} |
| 高风险文件 | {result.metrics.high_risk_files} |
| 未分配文件 | {result.metrics.unassigned_files} |
{coverage_rows}{runtime_rows}

## 源文件

| 扩展名 | 文件数 |
| --- | ---: |
{extension_rows}

## 编译模块

| 模块 | 编译单元 |
| --- | ---: |
{module_rows}

## 耦合热点

| 文件 | Fan-in | Fan-out | 合计 |
| --- | ---: | ---: | ---: |
{hotspot_rows}

## Include 循环依赖

{cycle_text}

## 全局变量

| 名称 | 类型 | 存储类别 | 定义位置 | 引用数 | 引用文件数 |
| --- | --- | --- | --- | ---: | ---: |
{global_rows}

## 中断 / 任务共享变量冲突候选（推导，非路径证明）

| 变量 | 模式 | 中断侧 | 任务/回调侧 | 置信度 |
| --- | --- | --- | --- | --- |
{conflict_rows}

## 语义分析警告

{warning_rows}

## Include 目录

{include_rows}
"""
