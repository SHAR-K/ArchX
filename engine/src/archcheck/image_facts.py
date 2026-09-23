"""Image facts: sizes read from the linker's own output, not derived from source.

Every other fact in this engine comes from the source as clangd sees it.  Byte sizes
cannot: a struct's footprint depends on the target's layout rules, an object's section
depends on what the linker did with it, and code size does not exist at the AST level at
all.  Those numbers do exist, exactly, in the map file the linker already wrote.

So this module is a *separate evidence source*.  It parses an armlink map (Keil MDK) and
reports what the image actually contains:

* per symbol — name, section, size, address, the object file it came from;
* per object file — code / RO data / RW data / ZI data, i.e. ROM and RAM per source file;
* the image totals.

The join back to the architecture is the delicate part.  A symbol carries a name and an
object file, never a source path, and ``static`` names are not unique across translation
units.  So objects are matched to source files by **which functions they define**: the
map's ``Thumb Code`` symbols are function names, and the AST knows which file defines each
function, so the object that defines ``sensor_task``, ``sensor_init``, … is ``sensor.c``.
That is self-verifying and survives Keil's duplicate-basename objects (``foo.o`` /
``foo_1.o``); matching by basename would silently mispair them.

Staleness is reported, never hidden: the artifact's hash and mtime travel with the facts,
along with how many analysed sources are newer than the image and how many defined
functions are absent from it.  A size fact whose artifact is stale is worse than no size
fact, because it looks right.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
from pathlib import Path
import re
from typing import Any, Iterable, Sequence

from archcheck.model import FunctionSymbol, VariableSymbol

# `    s_task            0x2000927c   Data       168  thread.o(.bss)`
# 中间可能夹一列小写标志（c / d / ab …），ABSOLUTE 之类的尾巴不带括号。
_SYMBOL = re.compile(
    r"^\s{4}(?P<name>\S+)\s+0x(?P<address>[0-9a-fA-F]{8})\s+"
    r"(?:(?P<flags>[a-z]{1,2})\s+)?"
    r"(?P<type>Section|Thumb Code|ARM Code|Data|Number)\s+"
    r"(?P<size>\d+)\s+(?P<object>[^\s(]+)(?:\((?P<section>[^)]*)\))?"
)
# `       812         36        120          4         64       5210   sensor.o`
_COMPONENT = re.compile(
    r"^\s+(?P<code>\d+)\s+(?P<inline>\d+)\s+(?P<ro>\d+)\s+(?P<rw>\d+)\s+(?P<zi>\d+)\s+"
    r"(?P<debug>\d+)\s+(?P<name>\S+)\s*$"
)
_TOTAL = re.compile(r"^\s+Total\s+(?P<kind>RO|RW|ROM)\s+Size[^\d]+(?P<bytes>\d+)")

_CODE_TYPES = {"Thumb Code", "ARM Code"}


def _kind_of(symbol_type: str, section: str | None) -> str | None:
    """Classify a map symbol into what it costs: code / data / ro-data / zero-init."""

    if symbol_type in _CODE_TYPES:
        return "code"
    if symbol_type != "Data":
        return None  # Section / Number 不占空间，是段名与绝对量
    text = (section or "").lower()
    if text.startswith(".bss") or "zero" in text:
        return "zero-init"
    if text.startswith(".constdata") or text.startswith(".conststring") or text.startswith(".rodata"):
        return "ro-data"
    return "data"


@dataclass(frozen=True)
class ImageSymbol:
    """One symbol in the linked image."""

    name: str
    kind: str  # code | data | ro-data | zero-init
    size_bytes: int
    address: str
    object: str
    section: str | None
    scope: str  # local | global
    source_path: str | None = None
    symbol_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "kind": self.kind,
            "sizeBytes": self.size_bytes,
            "address": self.address,
            "object": self.object,
            "section": self.section,
            "scope": self.scope,
            "sourcePath": self.source_path,
            "symbolId": self.symbol_id,
        }


@dataclass(frozen=True)
class ImageObject:
    """One object file's contribution, as the linker accounts for it."""

    object: str
    source_path: str | None
    code_bytes: int
    inline_data_bytes: int
    ro_data_bytes: int
    rw_data_bytes: int
    zi_data_bytes: int
    debug_bytes: int
    library: bool
    match: str | None  # functions | basename | None
    match_evidence: tuple[str, ...] = ()

    @property
    def rom_bytes(self) -> int:
        return self.code_bytes + self.ro_data_bytes + self.rw_data_bytes

    @property
    def ram_bytes(self) -> int:
        return self.rw_data_bytes + self.zi_data_bytes

    def to_dict(self) -> dict[str, Any]:
        return {
            "object": self.object,
            "sourcePath": self.source_path,
            "codeBytes": self.code_bytes,
            "inlineDataBytes": self.inline_data_bytes,
            "roDataBytes": self.ro_data_bytes,
            "rwDataBytes": self.rw_data_bytes,
            "ziDataBytes": self.zi_data_bytes,
            "romBytes": self.rom_bytes,
            "ramBytes": self.ram_bytes,
            "library": self.library,
            "match": self.match,
            "matchEvidence": list(self.match_evidence),
        }


@dataclass(frozen=True)
class ImageFacts:
    """Sizes from one build artifact, plus how far that artifact can be trusted."""

    artifact: dict[str, Any]
    totals: dict[str, int]
    objects: tuple[ImageObject, ...]
    symbols: tuple[ImageSymbol, ...]
    staleness: dict[str, Any]
    approximations: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifact": self.artifact,
            "totals": self.totals,
            "objects": [item.to_dict() for item in self.objects],
            "symbols": [item.to_dict() for item in self.symbols],
            "staleness": self.staleness,
            "approximations": list(self.approximations),
        }


@dataclass
class _ParsedMap:
    symbols: list[dict[str, Any]] = field(default_factory=list)
    components: list[dict[str, Any]] = field(default_factory=list)
    totals: dict[str, int] = field(default_factory=dict)


def parse_armlink_map(text: str) -> _ParsedMap:
    """Parse the symbol table, the per-object component sizes and the image totals."""

    out = _ParsedMap()
    scope = "global"
    section = ""  # symbols | objects | libraries
    library = False
    for line in text.splitlines():
        if line.startswith("Image Symbol Table"):
            section = "symbols"
            continue
        if line.strip() == "Local Symbols":
            scope = "local"
            continue
        if line.strip() == "Global Symbols":
            scope = "global"
            continue
        if "Object Name" in line and "Code" in line:
            section, library = "objects", False
            continue
        if "Library Member Name" in line and "Code" in line:
            section, library = "objects", True
            continue
        if line.strip().endswith(("Object Totals", "Library Totals", "Grand Totals")):
            section = ""
        if line.startswith("Memory Map of the image"):
            section = ""
            continue
        total = _TOTAL.match(line)
        if total is not None:
            out.totals[total.group("kind").lower()] = int(total.group("bytes"))
            continue
        if section == "symbols":
            match = _SYMBOL.match(line)
            if match is None:
                continue
            kind = _kind_of(match.group("type"), match.group("section"))
            size = int(match.group("size"))
            if kind is None or (size <= 0 and kind != "code"):
                continue
            out.symbols.append(
                {
                    "name": match.group("name"),
                    "kind": kind,
                    "size": size,
                    "address": f"0x{match.group('address').lower()}",
                    "object": match.group("object"),
                    "section": match.group("section"),
                    "scope": scope,
                }
            )
            continue
        if section == "objects":
            match = _COMPONENT.match(line)
            if match is None:
                continue
            out.components.append(
                {
                    "object": match.group("name"),
                    "code": int(match.group("code")),
                    "inline": int(match.group("inline")),
                    "ro": int(match.group("ro")),
                    "rw": int(match.group("rw")),
                    "zi": int(match.group("zi")),
                    "debug": int(match.group("debug")),
                    "library": library,
                }
            )
    return out


def _definitions_by_name(functions: Sequence[FunctionSymbol]) -> dict[str, set[str]]:
    """function name -> the source paths that define it (headers excluded)."""

    out: dict[str, set[str]] = {}
    for item in functions:
        if not item.is_definition or item.defined_in_header:
            continue
        out.setdefault(item.name, set()).add(item.location.path)
    return out


def _match_objects(
    components: Sequence[dict[str, Any]],
    symbols: Sequence[dict[str, Any]],
    functions: Sequence[FunctionSymbol],
) -> tuple[dict[str, tuple[str | None, str | None, tuple[str, ...]]], int]:
    """Map each object file to a source path by the functions it defines.

    Returns ``{object: (source path, how, evidence)}`` and how many objects stayed
    unmatched.  A basename fallback is used only when the object defines no function the
    AST knows (pure data objects, assembly), and only when the basename is unambiguous.
    """

    by_name = _definitions_by_name(functions)
    paths = {item.location.path for item in functions if item.is_definition}
    by_basename: dict[str, set[str]] = {}
    for path in paths:
        by_basename.setdefault(Path(path).stem.lower(), set()).add(path)

    code_names: dict[str, list[str]] = {}
    for symbol in symbols:
        if symbol["kind"] == "code":
            code_names.setdefault(symbol["object"], []).append(symbol["name"])

    resolved: dict[str, tuple[str | None, str | None, tuple[str, ...]]] = {}
    unmatched = 0
    for item in components:
        obj = item["object"]
        votes: dict[str, int] = {}
        matched: dict[str, list[str]] = {}
        for name in code_names.get(obj, []):
            for path in by_name.get(name, ()):  # 同名 static 函数会给多个候选，靠票数分开
                votes[path] = votes.get(path, 0) + 1
                matched.setdefault(path, []).append(name)
        if votes:
            ranked = sorted(votes.items(), key=lambda pair: (-pair[1], pair[0]))
            best, best_votes = ranked[0]
            runner_up = ranked[1][1] if len(ranked) > 1 else 0
            if best_votes > runner_up:
                resolved[obj] = (best, "functions", tuple(sorted(matched[best])[:6]))
                continue
        stem = Path(obj).stem.lower()
        stem = re.sub(r"_\d+$", "", stem)  # Keil 给重名源文件加的 _1 / _2 后缀
        candidates = by_basename.get(stem, set())
        if len(candidates) == 1:
            resolved[obj] = (next(iter(candidates)), "basename", ())
            continue
        resolved[obj] = (None, None, ())
        if not item["library"]:
            unmatched += 1
    return resolved, unmatched


def derive_image_facts(
    map_path: Path,
    project_root: Path,
    functions: Sequence[FunctionSymbol],
    variables: Sequence[VariableSymbol],
    analysed_paths: Iterable[str] = (),
) -> ImageFacts | None:
    """Read ``map_path`` and attribute its sizes to source files and symbol ids."""

    try:
        raw = map_path.read_bytes()
    except OSError:
        return None
    text = raw.decode("utf-8", errors="replace")
    parsed = parse_armlink_map(text)
    if not parsed.components and not parsed.symbols:
        return None

    resolved, unmatched = _match_objects(parsed.components, parsed.symbols, functions)
    objects = tuple(
        ImageObject(
            object=item["object"],
            source_path=resolved.get(item["object"], (None, None, ()))[0],
            code_bytes=item["code"],
            inline_data_bytes=item["inline"],
            ro_data_bytes=item["ro"],
            rw_data_bytes=item["rw"],
            zi_data_bytes=item["zi"],
            debug_bytes=item["debug"],
            library=item["library"],
            match=resolved.get(item["object"], (None, None, ()))[1],
            match_evidence=resolved.get(item["object"], (None, None, ()))[2],
        )
        for item in parsed.components
    )

    # 变量符号 id：同一个源文件里名字唯一，所以 (源文件, 名字) 就能定位；
    # 函数内 static 不参与（armlink 会改名，连上也不可靠）。
    variable_ids: dict[tuple[str, str], str] = {}
    for item in variables:
        if item.parent_function is not None:
            continue
        variable_ids[(item.location.path, item.name)] = item.symbol_id
    function_ids: dict[tuple[str, str], str] = {
        (item.location.path, item.name): item.symbol_id
        for item in functions
        if item.is_definition and not item.defined_in_header
    }

    symbols: list[ImageSymbol] = []
    for symbol in parsed.symbols:
        source_path = resolved.get(symbol["object"], (None, None, ()))[0]
        index = function_ids if symbol["kind"] == "code" else variable_ids
        symbols.append(
            ImageSymbol(
                name=symbol["name"],
                kind=symbol["kind"],
                size_bytes=symbol["size"],
                address=symbol["address"],
                object=symbol["object"],
                section=symbol["section"],
                scope=symbol["scope"],
                source_path=source_path,
                symbol_id=index.get((source_path, symbol["name"])) if source_path else None,
            )
        )

    # -- 陈旧性：产物是某一次构建的，源码可能已经变了 ------------------------------
    stat = map_path.stat()
    newer: list[str] = []
    for relative in analysed_paths:
        candidate = project_root / relative
        try:
            if candidate.stat().st_mtime > stat.st_mtime:
                newer.append(relative)
        except OSError:
            continue
    in_image = {symbol.name for symbol in symbols if symbol.kind == "code"}
    paths_in_image = {item.source_path for item in objects if item.source_path}
    absent_inlined: set[str] = set()
    files_absent: set[str] = set()
    for item in functions:
        if not item.is_definition or item.defined_in_header or item.name in in_image:
            continue
        # 文件有目标文件在镜像里 → 这个函数是被内联或被链接器丢掉了（armcc 把 static helper
        # 内联进调用方，map 里就只剩调用方那一个 i.xxx 段）；文件没有目标文件 → 根本没参与编译
        if item.location.path in paths_in_image:
            absent_inlined.add(item.name)
        else:
            files_absent.add(item.location.path)
    totals = {
        "romBytes": parsed.totals.get("rom", 0),
        "roBytes": parsed.totals.get("ro", 0),
        "ramBytes": parsed.totals.get("rw", 0),
        "codeBytes": sum(item.code_bytes for item in objects),
        "objectRomBytes": sum(item.rom_bytes for item in objects if not item.library),
        "objectRamBytes": sum(item.ram_bytes for item in objects if not item.library),
    }
    return ImageFacts(
        artifact={
            "path": map_path.as_posix(),
            "kind": "armlink-map",
            "sha1": hashlib.sha1(raw).hexdigest(),
            "modified": int(stat.st_mtime),
            "sizeBytes": len(raw),
        },
        totals=totals,
        objects=objects,
        symbols=tuple(symbols),
        staleness={
            "sourcesNewerThanImage": len(newer),
            "sourcesNewerSample": newer[:8],
            "functionsInlinedOrDiscarded": len(absent_inlined),
            "filesNotInImage": len(files_absent),
            "filesNotInImageSample": sorted(files_absent)[:8],
            "objectsUnmatched": unmatched,
        },
        approximations=(
            "image.sizes: 尺寸来自链接产物，不是源码事实；产物过期时数字会与当前源码不符，"
            "已给出产物哈希、时间与陈旧计数",
            "image.objectToSource: 目标文件按它定义的函数名反查源文件；纯数据 / 汇编目标文件退回基名匹配，"
            "基名不唯一时不归属",
            "image.inlining: 被内联的函数其代码计入调用方所在目标文件，函数级代码尺寸因此偏小",
            "image.absentFunctions: 源文件有目标文件但函数不在镜像里 = 被内联或被 --gc-sections 丢弃，"
            "两者在产物里区分不了；源文件没有目标文件 = 没参与编译",
        ),
    )


def find_image_artifact(keil_project: Path | None, project_root: Path) -> Path | None:
    """Find an armlink map next to the Keil project (newest wins), or under the project."""

    roots: list[Path] = []
    if keil_project is not None:
        roots.append(keil_project.parent)
    roots.append(project_root)
    seen: set[Path] = set()
    for root in roots:
        candidates = [
            item
            for item in root.glob("**/*.map")
            if item.is_file() and item not in seen and ".archx" not in item.parts
        ]
        seen.update(candidates)
        if not candidates:
            continue
        # 只认 armlink 的 map：开头有 Image Symbol Table / Image component sizes
        for item in sorted(candidates, key=lambda path: path.stat().st_mtime, reverse=True):
            try:
                head = item.read_text(encoding="utf-8", errors="replace")[:400_000]
            except OSError:
                continue
            if "Image Symbol Table" in head or "Image component sizes" in head:
                return item
    return None
