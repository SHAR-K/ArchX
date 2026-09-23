"""Dependency order: where each directory sits in the dependency graph, by the graph alone.

No layer names, no declared architecture.  Directories are the nodes; an edge is "some file
here includes or calls some file there".  Strongly connected components are collapsed, the
resulting DAG is ranked by longest path from the sinks, and every node gets that depth:
depth 0 depends on nothing in the project, depth *n* depends on something at *n − 1*.

That is all a static analysis can say about layering.  Whether depth 4 is "the driver
layer" is a name a person gives it; whether ``app`` talking straight to ``hal`` is a
skipped layer presupposes someone decided ``drivers`` must sit in between.  What the graph
does say, and this module reports, is:

* the order itself (``depth``), so a well-layered codebase reads as a clean flow downwards;
* cycles (``sccs`` / ``inCycle`` edges) — the one thing that is wrong regardless of names;
* per edge, how the two measurements of dependency disagree: ``includes`` (declared, via
  headers), ``calls`` (actual), ``bypassCalls`` (calls with no include path — the header
  contract is void there) and ``typeOnlyIncludes`` (headers pulled in for a type only).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import PurePosixPath
import re
from typing import Any, Iterable, Sequence

from archcheck.dsm_cluster import ClusterParams, cluster

_SYMBOL = re.compile(r"^(?:function|variable):(.+):([^:]+)$")
_SOURCE_SUFFIXES = {".c", ".cc", ".cpp", ".cxx", ".ino"}
_HEADER_SUFFIXES = {".h", ".hpp", ".hh", ".hxx", ".inc"}


def unit_of_files(files: Iterable[str]) -> dict[str, str]:
    """File -> unit.  A source and the header(s) with the same stem in the same directory are one
    unit (``app/led.c`` + ``app/led.h`` -> ``app/led``): the compilation unit and its interface.
    Anything without such a partner is a unit by itself (a pure header, a lone source).

    Why: an include edge always points at a header and a call edge always at the source that
    defines the callee, so at file level ``A.c -> B.h`` and ``A.c -> B.c`` are two different
    cells and ``A.c -> B.h`` + ``B.c -> A.h`` is not even a cycle.  Merging the pair puts both
    quantities in one cell and makes the mutual dependency visible.
    """

    by_stem: dict[str, set[str]] = {}
    for path in files:
        stem, ext = PurePosixPath(path).with_suffix("").as_posix(), PurePosixPath(path).suffix.lower()
        by_stem.setdefault(stem, set()).add(ext)
    out: dict[str, str] = {}
    for path in files:
        stem, ext = PurePosixPath(path).with_suffix("").as_posix(), PurePosixPath(path).suffix.lower()
        exts = by_stem[stem]
        paired = bool(exts & _SOURCE_SUFFIXES) and bool(exts & _HEADER_SUFFIXES) and ext in (_SOURCE_SUFFIXES | _HEADER_SUFFIXES)
        out[path] = stem if paired else path
    return out


def _path_of_symbol(symbol_id: str) -> str | None:
    match = _SYMBOL.match(symbol_id or "")
    return match.group(1) if match else None


def _directory(path: str) -> str:
    parent = PurePosixPath(path.replace("\\", "/")).parent.as_posix()
    return "" if parent == "." else parent


@dataclass
class _Edge:
    includes: int = 0
    calls: int = 0
    bypass_calls: int = 0
    type_only_includes: int = 0
    types: int = 0  # 用了对方定义的类型（函数 × 类型 × 用法，去重后计数）
    macros: int = 0  # 用了对方定义的宏（文件 × 宏名，去重后计数）
    reads: int = 0  # 读了对方定义的文件级变量（访问次数）
    writes: int = 0  # 写了对方定义的文件级变量（访问次数）


@dataclass(frozen=True)
class DependencyOrder:
    nodes: tuple[dict[str, Any], ...]
    edges: tuple[dict[str, Any], ...]
    sccs: tuple[dict[str, Any], ...]
    max_depth: int
    approximations: tuple[str, ...] = field(default_factory=tuple)
    # 分区结果（剥洋葱 + 撕开）：文件级带边与步骤，目录级带顺序与步骤；反馈边 = 排好序后仍然朝上的边
    files: dict[str, Any] = field(default_factory=dict)
    directories: dict[str, Any] = field(default_factory=dict)
    # 单元级：源文件 + 同目录同主名的头合成一个单元（编译单元 + 它的接口）；include 与调用落在同一个格子里
    units: dict[str, Any] = field(default_factory=dict)
    # 聚簇（文件级）：事实上的组件、每个文件的归属稳定度、每个目录的吻合度；参数随结果一起给
    clusters: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "nodes": list(self.nodes),
            "edges": list(self.edges),
            "sccs": list(self.sccs),
            "maxDepth": self.max_depth,
            "files": self.files,
            "directories": self.directories,
            "units": self.units,
            "clusters": self.clusters,
            "approximations": list(self.approximations),
        }


def strongly_connected_components(nodes: Iterable[str], successors: dict[str, set[str]]) -> list[list[str]]:
    """Tarjan, iterative so a deep include chain cannot hit the recursion limit."""

    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    out: list[list[str]] = []
    counter = 0
    for root in sorted(nodes):
        if root in index:
            continue
        work: list[tuple[str, Iterable[str]]] = [(root, iter(sorted(successors.get(root, ()))))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        while work:
            node, children = work[-1]
            advanced = False
            for child in children:
                if child not in index:
                    index[child] = low[child] = counter
                    counter += 1
                    stack.append(child)
                    on_stack.add(child)
                    work.append((child, iter(sorted(successors.get(child, ())))))
                    advanced = True
                    break
                if child in on_stack:
                    low[node] = min(low[node], index[child])
            if advanced:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[node])
            if low[node] == index[node]:
                component: list[str] = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    component.append(member)
                    if member == node:
                        break
                out.append(sorted(component))
    return out


def sequence(
    nodes: Iterable[str],
    edges: Iterable[tuple[str, str]],
    weights: dict[tuple[str, str], float] | None = None,
) -> tuple[list[str], list[dict[str, Any]], set[tuple[str, str]], dict[str, int]]:
    """Order nodes so that dependencies point downwards, recording every step.

    Peel: a node nobody depends on goes to the top, a node that depends on nothing goes to
    the bottom, repeat; when neither exists what is left is cyclic, and the node with the
    largest out-degree minus in-degree is torn off to the top (Eades–Lin–Smyth).  Each
    step carries its reason as numbers, so the whole order can be replayed and checked.

    ``weights`` (edge -> strength, e.g. the sum of the edge's quantities) only breaks ties in
    the tear step: equal out-in degree, the node with the larger weighted out-in goes first;
    still equal, alphabetical.  Returns (order, steps, feedback edges, level).  Feedback edges point *upwards* in the
    order — the marks below the diagonal of a DSM sorted this way.  ``level`` is the
    longest path to a sink once the feedback edges are ignored (0 = depends on nothing).
    """

    out: dict[str, set[str]] = {n: set() for n in nodes}
    inn: dict[str, set[str]] = {n: set() for n in nodes}
    weights = weights or {}

    def weighted(n: str, remaining: set[str]) -> float:
        return sum(weights.get((n, b), 1.0) for b in out[n] & remaining) - sum(weights.get((a, n), 1.0) for a in inn[n] & remaining)

    for a, b in edges:
        if a == b or a not in out or b not in out:
            continue
        out[a].add(b)
        inn[b].add(a)
    remaining = set(out)
    head: list[str] = []
    tail: list[str] = []
    steps: list[dict[str, Any]] = []
    while remaining:
        progressed = True
        while progressed and remaining:
            progressed = False
            sinks = sorted(n for n in remaining if not (out[n] & remaining))
            for n in sinks:
                tail.append(n)
                remaining.discard(n)
                steps.append({"kind": "sink", "node": n, "out": 0, "in": len(inn[n] & remaining)})
                progressed = True
            sources = sorted(n for n in remaining if not (inn[n] & remaining))
            for n in sources:
                head.append(n)
                remaining.discard(n)
                steps.append({"kind": "source", "node": n, "out": len(out[n] & remaining), "in": 0})
                progressed = True
        if remaining:
            # 剥不动了：剩下的互相依赖。撕开出度−入度最大的那个，放到顶上继续
            # 平了再比权重（边上各量之和）：光看条数，被几百次调用的和只被点了一下的分不出高低
            pick = max(sorted(remaining), key=lambda n: (len(out[n] & remaining) - len(inn[n] & remaining), weighted(n, remaining)))
            head.append(pick)
            remaining.discard(pick)
            steps.append({
                "kind": "tear", "node": pick,
                "out": len(out[pick] & remaining), "in": len(inn[pick] & remaining),
                "weight": weighted(pick, remaining),
                "block": len(remaining) + 1,
            })
    order = head + list(reversed(tail))
    position = {n: i for i, n in enumerate(order)}
    feedback = {(a, b) for a in out for b in out[a] if position[b] < position[a]}
    # 去掉反馈边后是 DAG：level = 到汇的最长路径
    level: dict[str, int] = {}
    for n in reversed(order):  # 底部先算，被依赖者总在依赖者之后
        deps = [b for b in out[n] if (n, b) not in feedback]
        level[n] = max((level[b] for b in deps if b in level), default=-1) + 1
    return order, steps, feedback, level


def derive_dependency_order(
    include_edges: Sequence[tuple[str, str]],
    call_edges: Sequence[tuple[str, str]],
    bypass_calls: Sequence[tuple[str, str]],
    type_only_includes: Sequence[tuple[str, str]],
    files: Iterable[str],
    type_uses: Sequence[tuple[str, str]] = (),
    macro_uses: Sequence[tuple[str, str]] = (),
    read_uses: Sequence[tuple[str, str]] = (),
    write_uses: Sequence[tuple[str, str]] = (),
) -> DependencyOrder | None:
    """Rank directories by longest dependency path; report cycles and edge disagreements.

    ``include_edges`` / ``type_only_includes`` / ``type_uses`` / ``macro_uses`` are (file, file); ``call_edges`` /
    ``bypass_calls`` are (function id, function id).  ``files`` lists every analysed source
    so directories with no edges still get a node.
    """

    edges: dict[tuple[str, str], _Edge] = {}
    file_edges: dict[tuple[str, str], _Edge] = {}
    file_count: dict[str, int] = {}
    all_files: set[str] = set()
    for path in files:
        file_count[_directory(path)] = file_count.get(_directory(path), 0) + 1
        all_files.add(path)

    def bump(source: str, target: str, attribute: str) -> None:
        if source != target:
            record = file_edges.setdefault((source, target), _Edge())
            setattr(record, attribute, getattr(record, attribute) + 1)
            all_files.add(source)
            all_files.add(target)
        a, b = _directory(source), _directory(target)
        if a == b:
            return  # 同一目录内部的依赖不构成目录之间的边
        record = edges.setdefault((a, b), _Edge())
        setattr(record, attribute, getattr(record, attribute) + 1)

    for source, target in include_edges:
        bump(source, target, "includes")
    for source, target in type_only_includes:
        bump(source, target, "type_only_includes")
    for caller, callee in call_edges:
        a, b = _path_of_symbol(caller), _path_of_symbol(callee)
        if a and b:
            bump(a, b, "calls")
    for caller, callee in bypass_calls:
        a, b = _path_of_symbol(caller), _path_of_symbol(callee)
        if a and b:
            bump(a, b, "bypass_calls")
    for source, target in type_uses:
        bump(source, target, "types")
    for source, target in macro_uses:
        bump(source, target, "macros")
    for source, target in read_uses:
        bump(source, target, "reads")
    for source, target in write_uses:
        bump(source, target, "writes")

    nodes = set(file_count) | {a for a, _ in edges} | {b for _, b in edges}
    if not nodes:
        return None
    successors: dict[str, set[str]] = {}
    for a, b in edges:
        successors.setdefault(a, set()).add(b)

    components = strongly_connected_components(nodes, successors)
    component_of: dict[str, int] = {}
    for number, members in enumerate(components):
        for member in members:
            component_of[member] = number

    # 缩点后的 DAG 上算深度：不依赖任何人的是 0，依赖了深度 n-1 的东西就是 n
    component_successors: dict[int, set[int]] = {}
    for a, b in edges:
        ca, cb = component_of[a], component_of[b]
        if ca != cb:
            component_successors.setdefault(ca, set()).add(cb)
    depth_cache: dict[int, int] = {}

    def depth_of(component: int) -> int:
        if component in depth_cache:
            return depth_cache[component]
        # 迭代求最长路径（DAG 上安全）
        order: list[int] = []
        seen: set[int] = set()
        stack = [(component, False)]
        while stack:
            current, done = stack.pop()
            if done:
                order.append(current)
                continue
            if current in seen:
                continue
            seen.add(current)
            stack.append((current, True))
            for nxt in component_successors.get(current, ()):
                if nxt not in seen and nxt not in depth_cache:
                    stack.append((nxt, False))
        for current in order:  # 后序：先算依赖，再算自己
            deps = component_successors.get(current, ())
            depth_cache[current] = max((depth_cache[d] for d in deps), default=-1) + 1
        return depth_cache[component]

    for number in range(len(components)):
        depth_of(number)
    max_depth = max(depth_cache.values(), default=0)

    node_rows = tuple(
        {
            "id": node,
            "files": file_count.get(node, 0),
            "depth": depth_cache[component_of[node]],
            "scc": component_of[node] if len(components[component_of[node]]) > 1 else None,
        }
        for node in sorted(nodes, key=lambda item: (-depth_cache[component_of[item]], item))
    )
    edge_rows = tuple(
        {
            "source": a,
            "target": b,
            "includes": record.includes,
            "calls": record.calls,
            "bypassCalls": record.bypass_calls,
            "typeOnlyIncludes": record.type_only_includes,
            "types": record.types,
            "macros": record.macros,
            "reads": record.reads,
            "writes": record.writes,
            "inCycle": component_of[a] == component_of[b],
            "span": depth_cache[component_of[a]] - depth_cache[component_of[b]],
        }
        for (a, b), record in sorted(edges.items())
    )
    scc_rows = tuple(
        {
            "id": number,
            "nodes": members,
            "edges": sum(1 for (a, b) in edges if component_of[a] == number and component_of[b] == number),
            "depth": depth_cache[number],
        }
        for number, members in enumerate(components)
        if len(members) > 1
    )
    # 分区：文件级与目录级各一份。文件是真实的编译单元，目录是人画的框；两份都给，页面上可以对照
    weight_of = lambda record: float(record.includes + record.calls + record.types + record.macros + record.reads + record.writes)  # noqa: E731
    f_order, f_steps, f_feedback, f_level = sequence(all_files, file_edges.keys(), {pair: weight_of(r) for pair, r in file_edges.items()})
    d_order, d_steps, d_feedback, d_level = sequence(nodes, edges.keys(), {pair: weight_of(r) for pair, r in edges.items()})
    edge_row = lambda pair, record: {  # noqa: E731
        "source": pair[0], "target": pair[1],
        "includes": record.includes, "calls": record.calls,
        "bypassCalls": record.bypass_calls, "typeOnlyIncludes": record.type_only_includes,
        "types": record.types, "macros": record.macros, "reads": record.reads, "writes": record.writes,
    }
    files_view = {
        "order": f_order,
        "level": f_level,
        "steps": f_steps,
        "edges": [edge_row(pair, record) for pair, record in sorted(file_edges.items())],
        "feedback": [edge_row(pair, file_edges[pair]) for pair in sorted(f_feedback)],
    }
    # 单元级：同目录同主名的 .c/.h 合并；单元内部的边（A.c -> A.h）不成边
    unit_of = unit_of_files(sorted(all_files))
    unit_edges: dict[tuple[str, str], _Edge] = {}
    for (a, b), record in file_edges.items():
        ua, ub = unit_of.get(a, a), unit_of.get(b, b)
        if ua == ub:
            continue
        merged = unit_edges.setdefault((ua, ub), _Edge())
        for name in ("includes", "calls", "bypass_calls", "type_only_includes", "types", "macros", "reads", "writes"):
            setattr(merged, name, getattr(merged, name) + getattr(record, name))
    members: dict[str, list[str]] = {}
    for path, unit in unit_of.items():
        members.setdefault(unit, []).append(path)
    u_order, u_steps, u_feedback, u_level = sequence(sorted(set(unit_of.values())), unit_edges.keys(), {pair: weight_of(r) for pair, r in unit_edges.items()})
    units_view = {
        "unitOf": unit_of,
        "members": {unit: sorted(paths) for unit, paths in sorted(members.items())},
        "order": u_order,
        "level": u_level,
        "steps": u_steps,
        "edges": [edge_row(pair, record) for pair, record in sorted(unit_edges.items())],
        "feedback": [edge_row(pair, unit_edges[pair]) for pair in sorted(u_feedback)],
    }
    directories_view = {
        "order": d_order,
        "level": d_level,
        "steps": d_steps,
        "feedback": [edge_row(pair, edges[pair]) for pair in sorted(d_feedback)],
    }
    # 聚簇：耦合 = include + 调用（两个方向相加），固定种子；只算工程内有边的文件
    weighted = [(a, b, float(record.includes + record.calls)) for (a, b), record in file_edges.items()]
    clustering = cluster(sorted(all_files), weighted, {path: _directory(path) for path in all_files}, ClusterParams())
    return DependencyOrder(
        nodes=node_rows,
        edges=edge_rows,
        sccs=scc_rows,
        max_depth=max_depth,
        files=files_view,
        directories=directories_view,
        units=units_view,
        clusters=clustering.to_dict() if clustering is not None else None,
        approximations=(
            "dependencyOrder.granularity: 节点是源文件所在目录；同目录内部的依赖不构成边",
            "dependencyOrder.depth: 缩点后 DAG 的最长路径深度，0 = 不依赖工程内任何目录；只是图上的顺序，不是分层的名字",
            "dependencyOrder.span: 边两端的深度差；跨得远只说明依赖了很底下的东西，是否算「跳层」要有人先规定中间必须经过谁",
            "dependencyOrder.sequence: 分区用源/汇剥离 + 出度−入度撕开（Eades–Lin–Smyth 启发式），反馈边集合小但不保证最小",
        ),
    )
