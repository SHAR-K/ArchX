"""Set differences between the include graph and the call graph (design doc §4.7 item 6).

* ``contractBypass``: a ``calls`` edge whose caller file reaches none of the callee
  module's headers through direct or transitive includes (at most three levels).
  The callee module's headers are the header files in the callee's directory plus
  any header sharing the callee file's stem (``foo.c`` -> ``foo.h`` anywhere).
* ``typeOnlyIncludes``: a direct include of a header that has a sibling implementation
  file, where the including file neither calls nor takes the address of any function
  in that implementation file nor references its global variables.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path
import posixpath

from archcheck.model import (
    ContractBypass,
    DependencyEdge,
    FunctionSymbol,
    SemanticEdge,
    SourceLocation,
    TypeOnlyInclude,
    VariableSymbol,
)


HEADER_SUFFIXES = {".h", ".hpp", ".hh", ".hxx", ".inc"}
SOURCE_SUFFIXES = {".c", ".cc", ".cpp", ".cxx", ".ino"}
CALL_LIKE_RELATIONS = {"calls", "address_of", "registers_task", "registers_callback"}
MAX_INCLUDE_DEPTH = 3


def find_contract_bypasses(
    project: Path,
    functions: tuple[FunctionSymbol, ...],
    edges: tuple[SemanticEdge, ...],
    dependency_edges: tuple[DependencyEdge, ...],
) -> tuple[ContractBypass, ...]:
    by_id = {function.symbol_id: function for function in functions}
    includes: dict[str, set[str]] = {}
    for edge in dependency_edges:
        includes.setdefault(edge.source, set()).add(edge.target)

    header_cache: dict[str, set[str]] = {}
    reach_cache: dict[str, set[str]] = {}
    stem_index = _header_stem_index(project, functions, dependency_edges)
    results: list[ContractBypass] = []
    seen: set[tuple[str, str]] = set()

    for edge in edges:
        if edge.relation != "calls":
            continue
        caller = by_id.get(edge.source)
        callee = by_id.get(edge.target)
        if caller is None or callee is None:
            continue
        caller_file = caller.location.path
        callee_file = callee.location.path
        if caller_file == callee_file or (edge.source, edge.target) in seen:
            continue
        seen.add((edge.source, edge.target))

        if callee.defined_in_header:
            # The header holding the body is the contract itself; any include path to it
            # (however deep, CMSIS intrinsics sit several levels down) honours it.
            if callee_file in _reachable_includes(caller_file, includes, None):
                continue
            reason = "no-include-path-to-callee-module"
        else:
            callee_directory = posixpath.dirname(callee_file)
            headers = header_cache.get(callee_directory)
            if headers is None:
                headers = _headers_in_directory(project, callee_directory)
                header_cache[callee_directory] = headers
            module_headers = headers | stem_index.get(posixpath.splitext(posixpath.basename(callee_file))[0], set())
            if not module_headers:
                reason = "callee-directory-has-no-header"
            else:
                reachable = reach_cache.get(caller_file)
                if reachable is None:
                    reachable = _reachable_includes(caller_file, includes)
                    reach_cache[caller_file] = reachable
                if reachable & module_headers:
                    continue
                reason = "no-include-path-to-callee-module"
        location = edge.locations[0] if edge.locations else caller.location
        results.append(
            ContractBypass(
                caller=edge.source,
                callee=edge.target,
                location=SourceLocation(path=location.path, line=location.line, column=location.column),
                reason=reason,
            )
        )
    results.sort(key=lambda item: (item.location.path, item.location.line, item.callee))
    return tuple(results)


def find_type_only_includes(
    project: Path,
    functions: tuple[FunctionSymbol, ...],
    variables: tuple[VariableSymbol, ...],
    edges: tuple[SemanticEdge, ...],
    dependency_edges: tuple[DependencyEdge, ...],
) -> tuple[TypeOnlyInclude, ...]:
    function_file = {function.symbol_id: function.location.path for function in functions}
    variable_file = {variable.symbol_id: variable.location.path for variable in variables}
    files_with_definitions = set(function_file.values())

    calls_between: dict[tuple[str, str], int] = {}
    references_between: dict[tuple[str, str], int] = {}
    for edge in edges:
        source_file = function_file.get(edge.source)
        if source_file is None:
            continue
        if edge.relation in CALL_LIKE_RELATIONS:
            target_file = function_file.get(edge.target)
            if target_file is not None:
                key = (source_file, target_file)
                calls_between[key] = calls_between.get(key, 0) + max(1, len(edge.locations))
        elif edge.relation == "references":
            target_file = variable_file.get(edge.target)
            if target_file is not None:
                key = (source_file, target_file)
                references_between[key] = references_between.get(key, 0) + max(1, len(edge.locations))

    results: list[TypeOnlyInclude] = []
    for edge in dependency_edges:
        if posixpath.splitext(edge.source)[1].lower() not in SOURCE_SUFFIXES:
            continue
        if posixpath.splitext(edge.target)[1].lower() not in HEADER_SUFFIXES:
            continue
        sibling = _sibling_implementation(project, edge.target, files_with_definitions)
        if sibling is None or sibling == edge.source:
            continue
        calls = calls_between.get((edge.source, sibling), 0)
        references = references_between.get((edge.source, sibling), 0)
        if calls or references:
            continue
        results.append(
            TypeOnlyInclude(
                source=edge.source,
                target=edge.target,
                calls_between_files=calls,
                variable_references=references,
            )
        )
    results.sort(key=lambda item: (item.source, item.target))
    return tuple(results)


def _headers_in_directory(project: Path, directory: str) -> set[str]:
    folder = project / directory if directory else project
    try:
        children = list(folder.iterdir())
    except OSError:
        return set()
    return {
        posixpath.join(directory, child.name) if directory else child.name
        for child in children
        if child.is_file() and child.suffix.lower() in HEADER_SUFFIXES
    }


def _header_stem_index(
    project: Path,
    functions: tuple[FunctionSymbol, ...],
    dependency_edges: tuple[DependencyEdge, ...],
) -> dict[str, set[str]]:
    """Map a file stem to every header with that stem seen in the include graph."""

    index: dict[str, set[str]] = {}
    seen_files = {edge.target for edge in dependency_edges} | {edge.source for edge in dependency_edges}
    for path in seen_files:
        if posixpath.splitext(path)[1].lower() in HEADER_SUFFIXES:
            stem = posixpath.splitext(posixpath.basename(path))[0]
            index.setdefault(stem, set()).add(path)
    # Headers next to definitions that nothing includes yet still count as the contract.
    for directory in {posixpath.dirname(function.location.path) for function in functions}:
        for header in _headers_in_directory(project, directory):
            stem = posixpath.splitext(posixpath.basename(header))[0]
            index.setdefault(stem, set()).add(header)
    return index


def _reachable_includes(
    start: str,
    includes: dict[str, set[str]],
    max_depth: int | None = MAX_INCLUDE_DEPTH,
) -> set[str]:
    reachable: set[str] = set()
    pending = deque([(start, 0)])
    visited = {start}
    while pending:
        current, depth = pending.popleft()
        if max_depth is not None and depth >= max_depth:
            continue
        for target in includes.get(current, ()):
            reachable.add(target)
            if target not in visited:
                visited.add(target)
                pending.append((target, depth + 1))
    return reachable


def _sibling_implementation(
    project: Path,
    header: str,
    files_with_definitions: set[str],
) -> str | None:
    directory = posixpath.dirname(header)
    stem = posixpath.splitext(posixpath.basename(header))[0]
    for suffix in sorted(SOURCE_SUFFIXES):
        candidate = posixpath.join(directory, f"{stem}{suffix}") if directory else f"{stem}{suffix}"
        if candidate in files_with_definitions:
            return candidate
    return None
