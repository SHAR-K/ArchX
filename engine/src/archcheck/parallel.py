"""Sharding the clangd phase across several processes.

Where the time goes, measured on a 222-file project: 22.6 s of the 30 s scan is spent waiting
on one clangd, and 18 s of that is the per-translation-unit loop -- 10.3 s parsing each unit
once (``documentSymbol``, 70 ms median) and 7.5 s producing 100 MB of AST JSON.  Both are
per-unit work with no dependency between units, and both are one process's CPU rather than
shared I/O: the raw pipe on this machine does 2.4 GB/s while the AST stream moves at 9.3 MB/s.
So N clangds should scale it close to linearly, and a 20-core machine was using one core.

What sharding must not change is the facts.  Two rules make that hold:

*   **Merge in the original order.**  Every list is rebuilt by translation-unit index, never
    by completion order, and every "first one wins" map (a header's ``static inline`` body is
    reachable from many units) resolves in that same order.
*   **Route follow-up questions to the owner.**  clangd answers ``outgoing_calls`` and
    ``references`` only for documents it has open -- asking a shard that never opened the file
    gets "trying to get AST for non-added document", not a degraded answer.  So the tail keeps
    every shard alive and sends each question to the shard that owns that file.

**Measured, and the reason this is off by default.**

Those two rules are necessary but not sufficient, because a third thing does not shard:
clangd answers a cross-file question only about documents *that process* has open.  Ask a shard
about a variable whose references live in another shard's files and it gives a smaller answer,
with no error.  Asking every shard and taking the union recovers most of it -- on a 36-unit
Keil project, 11 lost edges became 2 -- but not all, and what remains also depends on how far
each shard's background index has got, which is a race.

And the payoff is small.  On a 332-unit project, six shards took 166 s against 202 s serial:
18%, not the 4x the request profile suggested, because the 100 MB of AST JSON still lands in
one Python process behind one GIL.  Meanwhile ``function_calls`` moved 9015 -> 9013.

18% is not worth facts that change with ``--jobs``.  So sharding is off unless asked for by
name, and it stays here because the measurements are the useful part: the wall is not thread
scheduling, it is that clangd's cross-file answers are a property of a process, not of the
code.  Getting past it means deriving those relations from the per-unit ASTs we already
collect, instead of asking clangd a second time -- which would also make incremental rescans
possible, since they hit exactly the same wall.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence
import os

# 小工程不分片：起 clangd 要花掉几百毫秒，几十个编译单元时那笔开销比省下来的还多。
# 而且自建样例只有 5 个单元，保持串行，金样才逐字节不变。
MIN_UNITS_FOR_SHARDING = 40
MAX_SHARDS = 8


def shard_count(unit_count: int, requested: int | None = None) -> int:
    """要开几个 clangd。requested 为 None 时按机器和规模自己定。"""

    if requested is None:
        # 默认串行。分片会改变事实（见文件头的实测），所以只在明确要求时才开。
        return 1
    return max(1, min(int(requested), MAX_SHARDS))


def split_round_robin(items: Sequence[Any], shards: int) -> list[list[tuple[int, Any]]]:
    """轮转分片，每项带上它的原始下标。

    轮转而不是连续切分：编译单元的代价差得很远（同一个工程里 70 ms 到 234 ms 都有），
    连续切分会让某一片全是大文件。下标一路带着，合并时按它排回原序。
    """

    buckets: list[list[tuple[int, Any]]] = [[] for _ in range(max(1, shards))]
    for index, item in enumerate(items):
        buckets[index % len(buckets)].append((index, item))
    return buckets


@dataclass
class OrderedSink:
    """按原始下标收集，读的时候按下标排好序给出。

    并行的完成顺序是不确定的，而事实的顺序必须是确定的——投影和金样都按顺序逐字节比。
    所以谁先跑完都不影响结果，下标说了算。
    """

    _items: list[tuple[int, int, Any]] = field(default_factory=list)
    _seq: int = 0

    def extend(self, unit_index: int, values: Iterable[Any]) -> None:
        for value in values:
            self._items.append((unit_index, self._seq, value))
            self._seq += 1

    def ordered(self) -> list[Any]:
        # 次序键是（编译单元下标，该单元内部的产出次序）：单元之间按原序，单元内部按产出序
        return [value for _, _, value in sorted(self._items, key=lambda row: (row[0], row[1]))]


def merge_first_wins(targets: Sequence[dict], order: Sequence[int]) -> dict:
    """按分片的原始次序合并若干个「先到先得」的映射。

    同一个头文件里的 static inline 函数会被多个编译单元触达；串行时第一个见到它的单元
    赢，分片之后每片各自见到一次，所以合并要按同一个次序重放，否则赢家可能换人——
    值一样，但来源位置和计数会变。
    """

    out: dict = {}
    for position in order:
        for key, value in targets[position].items():
            out.setdefault(key, value)
    return out


class ShardRouter:
    """把针对某个文件的追问，送到打开过那个文件的那一片。

    clangd 只对自己 didOpen 过的文档回答 AST 相关的请求，问错分片会拿到
    "trying to get AST for non-added document"。这个类让尾部那几步不用关心分片存在。
    """

    def __init__(self, clients: Sequence[Any], owner_of: dict[str, int], fallback: int = 0) -> None:
        self.clients = list(clients)
        self.owner_of = owner_of
        self.fallback = fallback

    def for_path(self, path: str | Path | None) -> Any:
        if path is None:
            return self.clients[self.fallback]
        key = str(path).replace("\\", "/")
        index = self.owner_of.get(key)
        if index is None:
            # 尾部还会打开头文件之类没被任何编译单元认领的文件，交给第 0 片
            index = self.fallback
        return self.clients[index]

    def each(self, call: Callable[[Any], None]) -> None:
        for client in self.clients:
            call(client)

    @property
    def primary(self) -> Any:
        return self.clients[self.fallback]
