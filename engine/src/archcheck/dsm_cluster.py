"""DSM clustering: which files belong together, by their coupling alone.

Partitioning (``dependency_order.sequence``) asks "in what order do things depend on each
other".  Clustering asks a different question: "which things are so tightly coupled that
they are really one component" — the de-facto modules, whatever the directories say.

The algorithm is Thebeau's DSM clustering (2001), a seeded local search: pick an element at
random, let every cluster bid for it (coupling with the cluster's members, penalised by the
cluster's size), move it to the best bid, keep the move if the total coordination cost drops
(or occasionally even if it does not, to escape local minima), repeat until nothing improves.
It is a search, not a proof: the seed is fixed so a run is reproducible, every accepted move
is recorded so the run can be replayed, and the same search is repeated with several seeds
to measure how *stable* each element's membership is — an element that lands with the same
neighbours every time belongs there; one that keeps switching sits on a boundary.

Parameters are knobs, not facts; they travel with the result so a reader can see them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import random
from typing import Any, Iterable, Sequence


@dataclass(frozen=True)
class ClusterParams:
    pow_cc: float = 1.0  # 同簇内耦合按簇大小的这个次幂计成本
    pow_bid: float = 1.0  # 出价除以簇大小的这个次幂：大簇出价打折
    pow_dep: float = 4.0  # 出价里耦合强度的次幂：强耦合占主导
    max_cluster_ratio: float = 0.5  # 簇最大成员数 = N × 这个比例
    rand_bid: int = 30  # 每 rand_bid 次里有一次选第二高的出价
    rand_accept: int = 30  # 每 rand_accept 次里有一次接受变差的搬动
    iterations_per_node: int = 30  # 总迭代 = N × 这个数
    stable_rounds: int = 8  # 连续这么多轮（每轮 N 次）没有改进就停
    seeds: tuple[int, ...] = (1, 2, 3, 4, 5)

    def to_dict(self) -> dict[str, Any]:
        return {
            "powCc": self.pow_cc, "powBid": self.pow_bid, "powDep": self.pow_dep,
            "maxClusterRatio": self.max_cluster_ratio, "randBid": self.rand_bid,
            "randAccept": self.rand_accept, "iterationsPerNode": self.iterations_per_node,
            "stableRounds": self.stable_rounds, "seeds": list(self.seeds),
        }


@dataclass
class ClusterRun:
    seed: int
    clusters: list[list[str]]
    cost: float
    initial_cost: float
    steps: list[dict[str, Any]]
    iterations: int


@dataclass(frozen=True)
class Clustering:
    params: ClusterParams
    runs: tuple[ClusterRun, ...]
    stability: dict[str, float]
    directory_agreement: dict[str, dict[str, Any]]
    approximations: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        primary = self.runs[0] if self.runs else None
        return {
            "params": self.params.to_dict(),
            "clusters": primary.clusters if primary else [],
            "cost": primary.cost if primary else None,
            "initialCost": primary.initial_cost if primary else None,
            "iterations": primary.iterations if primary else 0,
            "steps": primary.steps if primary else [],
            "seedResults": [{"seed": run.seed, "clusters": len(run.clusters), "cost": run.cost} for run in self.runs],
            "stability": self.stability,
            "directoryAgreement": self.directory_agreement,
            "approximations": list(self.approximations),
        }


def _coupling(edges: Iterable[tuple[str, str, float]]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for a, b, w in edges:
        if a == b or w <= 0:
            continue
        out.setdefault(a, {})[b] = out.get(a, {}).get(b, 0.0) + w
        out.setdefault(b, {})[a] = out.get(b, {}).get(a, 0.0) + w
    return out


def cluster_once(
    nodes: Sequence[str],
    edges: Sequence[tuple[str, str, float]],
    params: ClusterParams,
    seed: int,
    record: bool = True,
) -> ClusterRun:
    """One seeded run of Thebeau's algorithm.  Every accepted move is recorded."""

    rng = random.Random(seed)
    order = sorted(nodes)
    n = len(order)
    if n == 0:
        return ClusterRun(seed, [], 0.0, 0.0, [], 0)
    coupling = _coupling(edges)
    directed = [(a, b, w) for a, b, w in edges if a != b and w > 0 and a in coupling and b in coupling]
    member: dict[str, int] = {node: i for i, node in enumerate(order)}
    clusters: dict[int, set[str]] = {i: {node} for i, node in enumerate(order)}
    max_size = max(2, int(n * params.max_cluster_ratio))

    # 成本函数是这个搜索里最热的一段：每次试搬都要整算一遍，一次扫描下来三万多次。
    # 下面两处纯属去掉重复劳动，加法的顺序和每一项的数值都不变，所以结果逐位相同：
    #   ① 节点名换成整数下标，member 从 dict[str] 变成 list——省掉每条边两次字符串哈希；
    #   ② size ** pow_cc 每次调用只按簇算一遍，不再每条边算一遍。
    index_of = {node: i for i, node in enumerate(order)}
    directed_ix = [(index_of[a], index_of[b], w) for a, b, w in directed]
    member_ix: list[int] = list(range(n))
    outer_term = n ** params.pow_cc
    pow_cc = params.pow_cc

    def total_cost() -> float:
        sized = {cluster_id: len(members) ** pow_cc for cluster_id, members in clusters.items()}
        cost = 0.0
        for a, b, w in directed_ix:
            group = member_ix[a]
            if group == member_ix[b]:
                cost += w * sized[group]
            else:
                cost += w * outer_term
        return cost

    def bid(node: str, cluster_id: int) -> float:
        members = clusters[cluster_id]
        strength = 0.0
        links = coupling.get(node, {})
        for other in members:
            if other != node and other in links:
                strength += links[other] ** params.pow_dep
        return strength / (len(members) ** params.pow_bid) if strength else 0.0

    cost = total_cost()
    initial = cost
    best_cost, best_member, best_step = cost, dict(member), 0
    steps: list[dict[str, Any]] = []
    budget = n * params.iterations_per_node
    since_improvement = 0
    iteration = 0
    while iteration < budget and since_improvement < params.stable_rounds * n:
        iteration += 1
        since_improvement += 1
        node = order[rng.randrange(n)]
        current = member[node]
        bids: list[tuple[float, int]] = []
        for cluster_id, members in clusters.items():
            if cluster_id == current or not members or len(members) >= max_size:
                continue
            value = bid(node, cluster_id)
            if value > 0:
                bids.append((value, cluster_id))
        if not bids:
            continue
        bids.sort(key=lambda item: (-item[0], item[1]))
        choice = bids[0]
        if len(bids) > 1 and rng.randrange(params.rand_bid) == 0:
            choice = bids[1]
        # 试着搬过去
        clusters[current].discard(node)
        clusters[choice[1]].add(node)
        member[node] = choice[1]
        member_ix[index_of[node]] = choice[1]
        new_cost = total_cost()
        worse = new_cost >= cost
        accept = not worse or rng.randrange(params.rand_accept) == 0
        if accept:
            if record:
                steps.append({
                    "i": iteration, "node": node, "from": current, "to": choice[1],
                    "bid": round(choice[0], 3), "second": round(bids[1][0], 3) if len(bids) > 1 else 0.0,
                    "cost": round(new_cost, 1), "worse": worse,
                })
            if new_cost < cost:
                since_improvement = 0
            cost = new_cost
            if cost < best_cost:
                best_cost, best_member, best_step = cost, dict(member), len(steps)
            if not clusters[current]:
                del clusters[current]
        else:
            clusters[choice[1]].discard(node)
            clusters[current].add(node)
            member[node] = current
            member_ix[index_of[node]] = current
    # 返回见过的最好状态；steps 里标出它是第几步（回放到那一步就是结果）
    grouped: dict[int, list[str]] = {}
    for node, cluster_id in best_member.items():
        grouped.setdefault(cluster_id, []).append(node)
    result = sorted((sorted(members) for members in grouped.values()), key=lambda c: (-len(c), c[0]))
    if record and steps:
        steps.append({"i": iteration, "node": None, "from": None, "to": None, "bid": 0, "second": 0, "cost": round(best_cost, 1), "worse": False, "bestAt": best_step})
    return ClusterRun(seed, result, round(best_cost, 1), round(initial, 1), steps, iteration)


def cluster(
    nodes: Sequence[str],
    edges: Sequence[tuple[str, str, float]],
    directory_of: dict[str, str],
    params: ClusterParams | None = None,
) -> Clustering | None:
    """Run the search for each seed; report the first run in full and the agreement across runs."""

    params = params or ClusterParams()
    nodes = [node for node in nodes if any(a == node or b == node for a, b, _w in edges)]
    if len(nodes) < 3:
        return None
    runs = tuple(cluster_once(nodes, edges, params, seed, record=(index == 0)) for index, seed in enumerate(params.seeds))
    primary = runs[0]
    # 稳定度：一个元素和它（主跑）簇友们在各次跑里同簇的比例
    memberships: list[dict[str, int]] = []
    for run in runs:
        table: dict[str, int] = {}
        for cluster_id, members in enumerate(run.clusters):
            for node in members:
                table[node] = cluster_id
        memberships.append(table)
    stability: dict[str, float] = {}
    for members in primary.clusters:
        for node in members:
            mates = [other for other in members if other != node]
            if not mates:
                stability[node] = 1.0
                continue
            together = 0
            for table in memberships:
                together += sum(1 for other in mates if table.get(other) == table.get(node))
            stability[node] = round(together / (len(mates) * len(memberships)), 3)
    # 目录吻合度：目录里的文件落在同一个（主跑）簇里的最大比例
    agreement: dict[str, dict[str, Any]] = {}
    by_dir: dict[str, list[str]] = {}
    for node in nodes:
        by_dir.setdefault(directory_of.get(node, ""), []).append(node)
    for directory, files in sorted(by_dir.items()):
        counts: dict[int, int] = {}
        for node in files:
            counts[memberships[0].get(node, -1)] = counts.get(memberships[0].get(node, -1), 0) + 1
        top = max(counts.items(), key=lambda item: (item[1], -item[0]))
        agreement[directory] = {"files": len(files), "mainCluster": top[0], "inMainCluster": top[1], "ratio": round(top[1] / len(files), 3)}
    return Clustering(
        params=params,
        runs=runs,
        stability=stability,
        directory_agreement=agreement,
        approximations=(
            "clusters.search: Thebeau 式随机局部搜索，固定种子可复现；结果是启发式，不是最优解",
            "clusters.weight: 耦合 = include 数 + 调用数，两个方向相加；权重口径是选择，不是事实",
            "clusters.stability: 主跑簇友在各种子下同簇的比例；低 = 这个文件在两个簇的边界上",
        ),
    )
