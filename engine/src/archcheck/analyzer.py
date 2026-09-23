from __future__ import annotations

from collections import Counter
import os
from pathlib import Path
import re
from typing import Any

from archcheck.architecture_config import ArchitectureConfig, load_architecture_config
from archcheck.compile_commands import (
    find_compile_commands,
    infer_path_mapping,
    load_compile_commands,
    map_compilation_path,
)
from archcheck.dependency import DependencyAnalysis, analyze_include_dependencies
from archcheck.file_metrics import build_file_metrics
from archcheck.model import (
    AnalysisResult,
    ArchitectureMetrics,
    CompileCommand,
    Coverage,
    DirectoryCoverage,
    ExcludedFile,
    PathMapping,
)


INCLUDE_FLAGS = {"-I", "/I", "-isystem", "-iquote", "-idirafter"}
SOURCE_EXTENSIONS = {".c", ".cc", ".cpp", ".cxx", ".ino", ".s", ".asm"}
IGNORED_DIRECTORIES = {".git", ".arch-report", ".venv", "build", "dist"}


def analyze_project(
    project: Path,
    compile_commands_path: Path | None = None,
    architecture_path: Path | None = None,
    target: str | None = None,
) -> AnalysisResult:
    project = project.expanduser().resolve()
    database = (
        compile_commands_path.expanduser().resolve()
        if compile_commands_path is not None
        else find_compile_commands(project)
    )
    path_mapping = infer_path_mapping(database, project)
    architecture = _load_optional_architecture(project, architecture_path)
    commands = load_compile_commands(database, path_mapping)
    coverage = build_coverage(project, commands, target or _default_target(database, project))

    source_files = {command.file for command in commands}
    extension_counts = Counter(path.suffix.lower() or "<none>" for path in source_files)
    include_directories = sorted(
        {
            include_path
            for command in commands
            for include_path in _extract_include_directories(command, path_mapping)
        },
        key=lambda path: str(path).casefold(),
    )
    command_contexts = tuple(
        (
            command,
            tuple(
                sorted(
                    _extract_include_directories(command, path_mapping),
                    key=lambda path: str(path).casefold(),
                )
            ),
        )
        for command in commands
    )
    dependencies = analyze_include_dependencies(project, command_contexts)
    file_metrics = build_file_metrics(project, dependencies, architecture)
    files_by_module = Counter(
        _node_for_source(path, project, architecture) for path in source_files
    )

    metrics = ArchitectureMetrics(
        translation_units=len(commands),
        source_files=len(source_files),
        analyzed_files=dependencies.analyzed_files,
        include_directories=len(include_directories),
        include_edges=len(dependencies.edges),
        dependency_cycle_groups=len(dependencies.cycles),
        global_variables=0,
        cross_file_global_variables=0,
        functions=0,
        variables=0,
        function_calls=0,
        variable_references=0,
        total_lines=sum(item.total_lines for item in file_metrics),
        code_lines=sum(item.code_lines for item in file_metrics),
        high_risk_files=sum(item.risk_score >= 60 for item in file_metrics),
        unassigned_files=sum(item.architecture_node == "unassigned" for item in file_metrics),
        files_by_extension=dict(sorted(extension_counts.items())),
        files_by_module=dict(sorted(files_by_module.items())),
    )
    return AnalysisResult(
        project=project,
        analysis_mode="compilation-database",
        compile_commands=database,
        architecture_config=architecture.path if architecture else None,
        path_mapping=path_mapping,
        include_directories=tuple(include_directories),
        dependency_edges=dependencies.edges,
        dependency_cycles=dependencies.cycles,
        coupling_hotspots=dependencies.hotspots,
        global_variables=(),
        functions=(),
        variables=(),
        semantic_edges=(),
        architecture_modules=architecture.modules if architecture else (),
        file_metrics=file_metrics,
        semantic_warnings=(),
        metrics=metrics,
        coverage=coverage,
    )


def analyze_source_tree(project: Path) -> AnalysisResult:
    project = project.expanduser().resolve()
    source_files = _source_files_on_disk(project)

    extension_counts = Counter(path.suffix.lower() for path in source_files)
    files_by_module = Counter(_module_name(path, project) for path in source_files)
    relative_files = tuple(sorted(path.resolve().relative_to(project).as_posix() for path in source_files))
    dependencies = DependencyAnalysis(
        analyzed_files=len(relative_files),
        files=relative_files,
        edges=(),
        cycles=(),
        hotspots=(),
    )
    file_metrics = build_file_metrics(project, dependencies, None)
    metrics = ArchitectureMetrics(
        translation_units=len(source_files),
        source_files=len(source_files),
        analyzed_files=len(source_files),
        include_directories=0,
        include_edges=0,
        dependency_cycle_groups=0,
        global_variables=0,
        cross_file_global_variables=0,
        functions=0,
        variables=0,
        function_calls=0,
        variable_references=0,
        total_lines=sum(item.total_lines for item in file_metrics),
        code_lines=sum(item.code_lines for item in file_metrics),
        high_risk_files=0,
        unassigned_files=0,
        files_by_extension=dict(sorted(extension_counts.items())),
        files_by_module=dict(sorted(files_by_module.items())),
    )
    return AnalysisResult(
        project=project,
        analysis_mode="source-tree",
        compile_commands=None,
        architecture_config=None,
        path_mapping=None,
        include_directories=(),
        dependency_edges=(),
        dependency_cycles=(),
        coupling_hotspots=(),
        global_variables=(),
        functions=(),
        variables=(),
        semantic_edges=(),
        architecture_modules=(),
        file_metrics=file_metrics,
        semantic_warnings=(),
        metrics=metrics,
        coverage=Coverage(
            target="source-tree",
            source_files_on_disk=len(source_files),
            translation_units=len(source_files),
            files_analyzed=len(source_files),
            excluded=(),
        ),
    )


def build_coverage(
    project: Path,
    commands: list[CompileCommand],
    target: str,
) -> Coverage:
    """Compare the compilation database against the source files present on disk."""

    on_disk = {
        path.resolve().relative_to(project).as_posix()
        for path in _source_files_on_disk(project)
    }
    analyzed: set[str] = set()
    excluded: list[ExcludedFile] = []
    seen_outside: set[str] = set()
    for command in commands:
        try:
            relative = command.file.resolve().relative_to(project).as_posix()
        except ValueError:
            key = command.file.as_posix()
            if key not in seen_outside:
                seen_outside.add(key)
                excluded.append(ExcludedFile(path=key, reason="outside-project-root"))
            continue
        if not command.file.is_file():
            if relative not in {item.path for item in excluded}:
                excluded.append(ExcludedFile(path=relative, reason="missing-on-disk"))
            continue
        analyzed.add(relative)
    excluded.extend(
        ExcludedFile(path=path, reason="not-in-compile-database")
        for path in sorted(on_disk - analyzed)
    )
    return Coverage(
        target=target,
        source_files_on_disk=len(on_disk),
        translation_units=len(commands),
        files_analyzed=len(analyzed),
        excluded=tuple(excluded),
        by_directory=_coverage_by_directory(on_disk, analyzed),
    )


def _coverage_by_directory(on_disk: set[str], analyzed: set[str]) -> dict[str, DirectoryCoverage]:
    """Cumulative on-disk / analyzed / excluded counts for every directory prefix."""

    counters: dict[str, list[int]] = {}
    for path in on_disk:
        parts = path.split("/")[:-1]
        prefixes = ["."] + ["/".join(parts[: index + 1]) for index in range(len(parts))]
        is_analyzed = path in analyzed
        for prefix in prefixes:
            counter = counters.setdefault(prefix, [0, 0, 0])
            counter[0] += 1
            counter[1 if is_analyzed else 2] += 1
    return {
        prefix: DirectoryCoverage(source_files_on_disk=total, files_analyzed=done, excluded=missing)
        for prefix, (total, done, missing) in counters.items()
    }


def coverage_for_focus(coverage: Coverage, focus_patterns: list[str]) -> dict[str, Any]:
    """Coverage counted only over files matching ``focus_patterns`` (``**`` and ``*`` globs).

    This is what a partition should report instead of the whole-project numbers.
    """

    matchers = [_glob_to_regex(pattern) for pattern in focus_patterns]

    def in_focus(path: str) -> bool:
        return any(matcher.match(path) for matcher in matchers)

    excluded = [item for item in coverage.excluded if in_focus(item.path)]
    on_disk_in_focus = 0
    analyzed_in_focus = 0
    if coverage.by_directory:
        # Files are not listed individually; derive from the deepest matching directories.
        roots = _focus_roots(focus_patterns)
        for root in roots:
            item = coverage.by_directory.get(root)
            if item is not None:
                on_disk_in_focus += item.source_files_on_disk
                analyzed_in_focus += item.files_analyzed
    return {
        "target": coverage.target,
        "focus": list(focus_patterns),
        "sourceFilesOnDisk": on_disk_in_focus,
        "filesAnalyzed": analyzed_in_focus,
        "excluded": [item.to_dict() for item in excluded],
        "ratio": round(analyzed_in_focus / on_disk_in_focus, 4) if on_disk_in_focus else None,
    }


def _focus_roots(patterns: list[str]) -> list[str]:
    roots: list[str] = []
    for pattern in patterns:
        normalized = pattern.replace("\\", "/").lstrip("./")
        root = re.sub(r"/\*\*.*$", "", normalized).rstrip("/")
        if root and "*" not in root and root not in roots:
            roots.append(root)
    return roots


def _glob_to_regex(pattern: str) -> re.Pattern[str]:
    normalized = pattern.replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    escaped = re.escape(normalized).replace(r"\*\*", "\0").replace(r"\*", "[^/]*").replace("\0", ".*")
    return re.compile(f"^{escaped}$", re.IGNORECASE)


def _default_target(database: Path, project: Path) -> str:
    try:
        return f"compile-commands:{database.relative_to(project).as_posix()}"
    except ValueError:
        return f"compile-commands:{database.as_posix()}"


def _source_files_on_disk(project: Path) -> list[Path]:
    source_files: list[Path] = []
    for directory, directory_names, file_names in os.walk(project):
        directory_names[:] = [
            name for name in directory_names if name not in IGNORED_DIRECTORIES
        ]
        current_directory = Path(directory)
        for file_name in file_names:
            path = current_directory / file_name
            if path.suffix.lower() in SOURCE_EXTENSIONS:
                source_files.append(path)
    return source_files


def _extract_include_directories(
    command: CompileCommand,
    path_mapping: PathMapping | None,
) -> set[Path]:
    paths: set[Path] = set()
    arguments = command.arguments
    index = 0

    while index < len(arguments):
        argument = arguments[index]
        include_value: str | None = None

        if argument in INCLUDE_FLAGS and index + 1 < len(arguments):
            index += 1
            include_value = arguments[index]
        elif argument.startswith("-I") and len(argument) > 2:
            include_value = argument[2:]
        elif argument.startswith("/I") and len(argument) > 2:
            include_value = argument[2:]
        elif argument.startswith("-isystem") and len(argument) > len("-isystem"):
            include_value = argument[len("-isystem") :]

        if include_value:
            paths.add(
                map_compilation_path(
                    include_value,
                    command.raw_directory,
                    path_mapping,
                )
            )
        index += 1

    return paths


def _module_name(path: Path, project: Path) -> str:
    try:
        parts = path.resolve().relative_to(project).parts
    except ValueError:
        return "external"
    if len(parts) >= 2:
        return "/".join(parts[:2])
    return parts[0] if parts else "."


def _load_optional_architecture(
    project: Path,
    architecture_path: Path | None,
) -> ArchitectureConfig | None:
    candidate = architecture_path or project / "architecture.yaml"
    return load_architecture_config(candidate) if candidate.is_file() else None


def _node_for_source(
    path: Path,
    project: Path,
    architecture: ArchitectureConfig | None,
) -> str:
    try:
        relative = path.resolve().relative_to(project).as_posix()
    except ValueError:
        return "external"
    if architecture is None:
        return _module_name(path, project)
    return architecture.match_module(relative) or "unassigned"
