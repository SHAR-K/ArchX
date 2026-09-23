from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import replace
from pathlib import Path
import re

from archcheck.architecture_config import ArchitectureConfig, default_node_for_path
from archcheck.dependency import DependencyAnalysis
from archcheck.model import FileMetric, GlobalVariable


COMMENT_PATTERN = re.compile(r"/\*.*?\*/|//[^\n]*", re.DOTALL)


def build_file_metrics(
    project: Path,
    dependencies: DependencyAnalysis,
    architecture: ArchitectureConfig | None,
) -> tuple[FileMetric, ...]:
    incoming: dict[str, set[str]] = defaultdict(set)
    outgoing: dict[str, set[str]] = defaultdict(set)
    for edge in dependencies.edges:
        outgoing[edge.source].add(edge.target)
        incoming[edge.target].add(edge.source)
    cycle_files = {path for group in dependencies.cycles for path in group}

    metrics: list[FileMetric] = []
    for relative_path in dependencies.files:
        path = project / Path(relative_path)
        total_lines, code_lines = _line_counts(path)
        node = architecture.match_module(relative_path) if architecture else None
        architecture_node = node or (
            "unassigned" if architecture else default_node_for_path(relative_path)
        )
        metric = FileMetric(
            path=relative_path,
            architecture_node=architecture_node,
            total_lines=total_lines,
            code_lines=code_lines,
            fan_in=len(incoming[relative_path]),
            fan_out=len(outgoing[relative_path]),
            global_variables=0,
            cross_file_globals=0,
            in_dependency_cycle=relative_path in cycle_files,
            risk_score=0,
        )
        metrics.append(replace(metric, risk_score=calculate_risk(metric)))
    return tuple(sorted(metrics, key=lambda item: item.path))


def apply_global_metrics(
    file_metrics: tuple[FileMetric, ...],
    variables: tuple[GlobalVariable, ...],
) -> tuple[FileMetric, ...]:
    globals_by_file = Counter(item.definition.path for item in variables)
    cross_file_by_file = Counter(
        item.definition.path for item in variables if item.cross_file
    )
    updated = []
    for metric in file_metrics:
        item = replace(
            metric,
            global_variables=globals_by_file[metric.path],
            cross_file_globals=cross_file_by_file[metric.path],
        )
        updated.append(replace(item, risk_score=calculate_risk(item)))
    return tuple(updated)


def calculate_risk(metric: FileMetric) -> int:
    coupling = min(40, (metric.fan_in + metric.fan_out) * 2)
    global_state = min(20, metric.global_variables * 2)
    cross_file_state = min(20, metric.cross_file_globals * 8)
    dependency_cycle = 15 if metric.in_dependency_cycle else 0
    size = min(5, metric.code_lines // 400)
    return min(100, coupling + global_state + cross_file_state + dependency_cycle + size)


def _line_counts(path: Path) -> tuple[int, int]:
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0, 0
    total_lines = len(content.splitlines())
    without_comments = COMMENT_PATTERN.sub("", content)
    code_lines = sum(bool(line.strip()) for line in without_comments.splitlines())
    return total_lines, code_lines

