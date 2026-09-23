from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Iterable

from archcheck.model import CompileCommand, CouplingHotspot, DependencyEdge


INCLUDE_PATTERN = re.compile(
    r'^\s*#\s*include\s*(?P<delimiter>[<"])(?P<name>[^>"]+)[>"]',
    re.MULTILINE,
)


@dataclass(frozen=True)
class DependencyAnalysis:
    analyzed_files: int
    files: tuple[str, ...]
    edges: tuple[DependencyEdge, ...]
    cycles: tuple[tuple[str, ...], ...]
    hotspots: tuple[CouplingHotspot, ...]


def analyze_include_dependencies(
    project: Path,
    command_include_directories: Iterable[tuple[CompileCommand, tuple[Path, ...]]],
) -> DependencyAnalysis:
    project = project.resolve()
    edge_paths: set[tuple[Path, Path]] = set()
    analyzed_paths: set[Path] = set()
    directive_cache: dict[Path, tuple[tuple[str, str], ...]] = {}
    # 同一个「从哪儿找 + 找什么 + 搜索路径」组合，在一次扫描里会被问上千遍：一个头文件被多少
    # 文件 include，就重复多少次。实测 8707 次调用只有 382 个不同的组合，96% 是白做的，
    # 而每一次都是几十个 is_file() 加一个 resolve()，在 Windows 上很贵。
    # 扫描期间文件系统不变，所以这是个纯函数，缓存不改变任何结果。
    # 值可以是 None（找不到，或找到了但在工程外），所以要用哨兵区分「没缓存过」。
    resolve_cache: dict[tuple[Path | None, str, tuple[Path, ...]], Path | None] = {}
    missing = object()

    for command, include_directories in command_include_directories:
        if not command.file.is_file() or not _is_within(command.file, project):
            continue

        pending = [command.file]
        visited: set[Path] = set()
        while pending:
            source = pending.pop()
            if source in visited:
                continue
            visited.add(source)
            analyzed_paths.add(source)

            directives = directive_cache.get(source)
            if directives is None:
                directives = _read_include_directives(source)
                directive_cache[source] = directives

            for delimiter, include_name in directives:
                quoted = delimiter == '"'
                # 引号形式先找源文件所在目录，尖括号形式不看源文件——键只带真正影响结果的东西
                key = (source.parent if quoted else None, include_name, include_directories)
                target = resolve_cache.get(key, missing)
                if target is missing:
                    target = _resolve_include(source, include_name, quoted, include_directories)
                    if target is not None and not _is_within(target, project):
                        target = None
                    resolve_cache[key] = target
                if target is None:
                    continue
                edge_paths.add((source, target))
                if target not in visited:
                    pending.append(target)

    relative_edges = tuple(
        DependencyEdge(
            source=_relative(source, project),
            target=_relative(target, project),
        )
        for source, target in sorted(
            edge_paths,
            key=lambda pair: (
                str(pair[0]).casefold(),
                str(pair[1]).casefold(),
            ),
        )
    )
    cycles = _find_cycle_groups(relative_edges)
    hotspots = _calculate_hotspots(relative_edges)
    relative_files = tuple(
        sorted(_relative(path, project) for path in analyzed_paths)
    )
    return DependencyAnalysis(
        analyzed_files=len(analyzed_paths),
        files=relative_files,
        edges=relative_edges,
        cycles=cycles,
        hotspots=hotspots,
    )


def _read_include_directives(path: Path) -> tuple[tuple[str, str], ...]:
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ()
    return tuple(
        (match.group("delimiter"), match.group("name").strip())
        for match in INCLUDE_PATTERN.finditer(content)
    )


def _resolve_include(
    source: Path,
    include_name: str,
    quoted: bool,
    include_directories: tuple[Path, ...],
) -> Path | None:
    include_parts = include_name.replace("\\", "/").split("/")
    search_directories = ((source.parent,) if quoted else ()) + include_directories
    for directory in search_directories:
        candidate = directory.joinpath(*include_parts)
        if candidate.is_file():
            return candidate.resolve()
    return None


def _find_cycle_groups(edges: tuple[DependencyEdge, ...]) -> tuple[tuple[str, ...], ...]:
    adjacency: dict[str, set[str]] = defaultdict(set)
    nodes: set[str] = set()
    for edge in edges:
        adjacency[edge.source].add(edge.target)
        nodes.update((edge.source, edge.target))

    index = 0
    indexes: dict[str, int] = {}
    low_links: dict[str, int] = {}
    stack: list[str] = []
    on_stack: set[str] = set()
    groups: list[tuple[str, ...]] = []

    def visit(node: str) -> None:
        nonlocal index
        indexes[node] = index
        low_links[node] = index
        index += 1
        stack.append(node)
        on_stack.add(node)

        for target in adjacency[node]:
            if target not in indexes:
                visit(target)
                low_links[node] = min(low_links[node], low_links[target])
            elif target in on_stack:
                low_links[node] = min(low_links[node], indexes[target])

        if low_links[node] != indexes[node]:
            return

        component: list[str] = []
        while stack:
            item = stack.pop()
            on_stack.remove(item)
            component.append(item)
            if item == node:
                break
        if len(component) > 1 or node in adjacency[node]:
            groups.append(tuple(sorted(component)))

    for node in sorted(nodes):
        if node not in indexes:
            visit(node)

    return tuple(sorted(groups, key=lambda group: (-len(group), group)))


def _calculate_hotspots(edges: tuple[DependencyEdge, ...]) -> tuple[CouplingHotspot, ...]:
    incoming: dict[str, set[str]] = defaultdict(set)
    outgoing: dict[str, set[str]] = defaultdict(set)
    for edge in edges:
        outgoing[edge.source].add(edge.target)
        incoming[edge.target].add(edge.source)

    paths = set(incoming) | set(outgoing)
    hotspots = [
        CouplingHotspot(
            path=path,
            fan_in=len(incoming[path]),
            fan_out=len(outgoing[path]),
        )
        for path in paths
    ]
    hotspots.sort(key=lambda item: (-item.total, -item.fan_in, -item.fan_out, item.path))
    return tuple(hotspots[:25])


def _relative(path: Path, project: Path) -> str:
    return path.relative_to(project).as_posix()


def _is_within(path: Path, project: Path) -> bool:
    try:
        path.resolve().relative_to(project)
        return True
    except ValueError:
        return False
