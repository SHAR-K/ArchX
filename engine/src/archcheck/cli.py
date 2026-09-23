from __future__ import annotations

import argparse
from dataclasses import replace
import json
import sys
from pathlib import Path

from archcheck.analyzer import analyze_project, analyze_source_tree
from archcheck.architecture_config import (
    ArchitectureConfigError,
    write_draft_architecture,
)
from archcheck.compile_commands import CompileCommandsError
from archcheck.dependency_order import derive_dependency_order
from archcheck.image_facts import derive_image_facts, find_image_artifact
from archcheck.keil import KeilProjectError, write_keil_compilation_database
from archcheck.report import write_reports
from archcheck.semantic import enrich_with_global_variables


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="archcheck",
        description="Recover the runtime structure of a C/C++ firmware project from its compilation database and write the code facts.",
    )
    parser.add_argument("project", nargs="?", default=".", type=Path)
    parser.add_argument("--compile-commands", type=Path, dest="compile_commands")
    parser.add_argument(
        "--jobs",
        type=int,
        default=None,
        help="Number of parallel clangd processes. Default: chosen from CPU count and the number of "
             "translation units; 1 runs serially. Shards are merged in the original order, so the facts do not change.",
    )
    parser.add_argument("--keil-project", type=Path, help="Keil .uvprojx project file")
    parser.add_argument("--keil-target", help="Keil target name")
    parser.add_argument(
        "--image-map",
        type=Path,
        dest="image_map",
        help="Linker map file (armlink / Keil). Default: the newest one found next to the Keil project or in the project root",
    )
    parser.add_argument(
        "--no-image",
        action="store_true",
        dest="no_image",
        help="Do not read the linker output; source facts only",
    )
    parser.add_argument(
        "--keil-toolchain-include",
        type=Path,
        dest="keil_toolchain_include",
        help="Keil ARM compiler include directory (e.g. C:\\Keil_v5\\ARM\\ARMCLANG\\include). Default: detected",
    )
    parser.add_argument(
        "--keil-define",
        action="append",
        default=[],
        dest="keil_defines",
        metavar="MACRO[=VALUE]",
        help="Extra preprocessor macro, repeatable; for macros Keil injects outside the .uvprojx",
    )
    parser.add_argument("--architecture", type=Path, help="Path to architecture.yaml")
    parser.add_argument("--out", type=Path, help="Output directory. Default: <project>/.arch-report")
    parser.add_argument("--json", action="store_true", help="Print the facts as JSON on stdout")
    parser.add_argument(
        "--source-scan",
        action="store_true",
        help="Ignore compile_commands.json and scan source files only; no semantic facts (calls, units, loops)",
    )
    parser.add_argument(
        "--no-globals",
        action="store_true",
        help="Skip the clangd global-variable and reference analysis",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    _configure_standard_streams()
    actual_argv = list(sys.argv[1:] if argv is None else argv)
    if actual_argv[:1] == ["init-architecture"]:
        return _initialize_architecture(actual_argv[1:])

    args = build_parser().parse_args(actual_argv)
    project = args.project.expanduser().resolve()
    output_directory = args.out or project / ".arch-report"

    try:
        compile_commands = args.compile_commands
        target: str | None = None
        keil_warnings: tuple[str, ...] = ()
        if args.keil_project is not None:
            keil = write_keil_compilation_database(
                project,
                args.keil_project,
                output_directory / ".keil",
                args.keil_target,
                toolchain_include=args.keil_toolchain_include,
                extra_defines=tuple(args.keil_defines),
            )
            compile_commands = keil.compile_commands
            target = f"keil:{keil.target_name}"
            keil_warnings = tuple(f"Keil: {item}" for item in keil.warnings)
            for warning in keil_warnings:
                print(f"archcheck: {warning}", file=sys.stderr)
        result = (
            analyze_source_tree(project)
            if args.source_scan
            else analyze_project(project, compile_commands, args.architecture, target)
        )
        if not args.source_scan and not args.no_globals:
            result = enrich_with_global_variables(
                result,
                output_directory / ".clangd",
                jobs=args.jobs,
            )
        if keil_warnings:
            result = replace(
                result, semantic_warnings=keil_warnings + result.semantic_warnings
            )
        # 依赖顺序：目录级的图论排序，不需要任何分层声明
        if result.functions:
            function_file = {item.symbol_id: item.location.path for item in result.functions}
            variable_file = {item.symbol_id: item.location.path for item in result.variables}

            def variable_uses(kinds: tuple[str, ...]) -> list[tuple[str, str]]:
                # 读 / 写了别的文件定义的文件级变量：文件 -> 定义它的文件
                return [
                    (function_file[item.function], variable_file[item.variable])
                    for item in result.resource_accesses
                    if item.kind in kinds and item.function in function_file and item.variable in variable_file
                ]
            order = derive_dependency_order(
                [(edge.source, edge.target) for edge in result.dependency_edges],
                [(edge.source, edge.target) for edge in result.semantic_edges if edge.relation == "calls" and not edge.dead_branch],
                [(item.caller, item.callee) for item in result.contract_bypass],
                [(item.source, item.target) for item in result.type_only_includes],
                [item.path for item in result.file_metrics],
                type_uses=[
                    (function_file[item.function], item.defined_in.path)
                    for item in result.type_uses
                    if item.defined_in is not None and item.function in function_file
                ],
                macro_uses=[
                    (item.file, item.defined_in.path) for item in result.macro_uses if item.defined_in is not None
                ],
                read_uses=variable_uses(("read", "read_write")),
                write_uses=variable_uses(("write", "read_write")),
            )
            if order is not None:
                result = replace(result, dependency_order=order)
        # 链接产物：尺寸的唯一可靠来源，但它是另一次构建的产物，所以单独一层并带上陈旧信息
        if not args.no_image and result.functions:
            image_map = args.image_map or find_image_artifact(args.keil_project, project)
            if image_map is not None:
                image_facts = derive_image_facts(
                    image_map,
                    project,
                    result.functions,
                    result.variables,
                    tuple(item.path for item in result.file_metrics),
                )
                if image_facts is not None:
                    result = replace(result, image_facts=image_facts)
                    print(
                        f"archcheck: read linker output {image_map.name}"
                        f" (ROM {image_facts.totals.get('romBytes', 0)} B, "
                        f"RAM {image_facts.totals.get('ramBytes', 0)} B, "
                        f"{len(image_facts.symbols)} symbols, "
                        f"{image_facts.staleness['sourcesNewerThanImage']} source files newer than the image)",
                        file=sys.stderr,
                    )
        report_paths = write_reports(result, output_directory)
    except (ArchitectureConfigError, CompileCommandsError, KeilProjectError, OSError) as exc:
        print(f"archcheck: {exc}", file=sys.stderr)
        return 2

    if args.json:
        # 不缩进：这份 JSON 只会被程序 parse，缩进在一个两百来个文件的工程上是 6 MB
        # 的管道流量和额外的解析时间，没有任何人会用眼睛读它
        print(json.dumps(result.to_dict(), ensure_ascii=False))
    else:
        mode_name = "compilation database" if result.analysis_mode == "compilation-database" else "source-tree scan"
        print(f"Mode: {mode_name}")
        print(f"Translation units: {result.metrics.translation_units}")
        print(f"Unique source files: {result.metrics.source_files}")
        print(f"Local include edges: {result.metrics.include_edges}")
        print(f"Include cycle groups: {result.metrics.dependency_cycle_groups}")
        print(
            f"Global variables: {result.metrics.global_variables}, "
            f"referenced across files: {result.metrics.cross_file_global_variables}"
        )
        print(
            f"Functions: {result.metrics.functions}, calls: {result.metrics.function_calls}, "
            f"variables: {result.metrics.variables}"
        )
        if result.coverage is not None:
            print(
                f"Coverage: {result.coverage.files_analyzed}/{result.coverage.source_files_on_disk} "
                f"source files analyzed (target {result.coverage.target})"
            )
        if result.functions:
            unit_counts: dict[str, int] = {}
            for unit in result.execution_units:
                unit_counts[unit.kind] = unit_counts.get(unit.kind, 0) + 1
            print(
                f"Entries: {len(result.entries)}, execution units: "
                + (
                    ", ".join(f"{kind} {count}" for kind, count in sorted(unit_counts.items()))
                    or "0"
                )
                + f", extern declarations: {len(result.extern_declarations)}, "
                f"contract bypasses: {len(result.contract_bypass)}, "
                f"type-only includes: {len(result.type_only_includes)}"
            )
            if result.ast_facts is not None:
                run_mode_counts: dict[str, int] = {}
                for mode in result.run_modes:
                    run_mode_counts[mode.mode] = run_mode_counts.get(mode.mode, 0) + 1
                print(
                    f"AST layer: {result.ast_facts.functions_analyzed}/{result.ast_facts.functions_requested} functions"
                    f" ({result.ast_facts.elapsed_seconds:.1f}s), loops {len(result.loops)}, "
                    f"state-machine candidates {len(result.state_machines)}, variable accesses {len(result.resource_accesses)}, "
                    f"critical sections {len(result.critical_sections)}, shared resources {len(result.shared_resources)}, "
                    f"conflict candidates {len(result.conflict_candidates)}; run modes: "
                    + (", ".join(f"{mode} {count}" for mode, count in sorted(run_mode_counts.items())) or "0")
                )
            data_callbacks = sum(1 for unit in result.execution_units if unit.form is not None)
            unresolved_sites = sum(1 for site in result.enable_sites if not site.resolved_to)
            print(
                f"Indirection: callbacks registered through data {data_callbacks}, non-constant IRQ enable sites {len(result.enable_sites)}"
                f" ({unresolved_sites} unresolved), external symbols {len(result.external_symbols)}, "
                f"files with inactive regions {sum(1 for item in result.inactive_regions if item.regions)}, "
                f"inactive functions {len(result.inactive_functions)}"
            )
        if result.path_mapping is not None:
            print(
                "Path mapping: "
                f"{result.path_mapping.source} -> {result.path_mapping.target}"
            )
        print(f"Output: {report_paths[0].parent}")
    return 0


def _configure_standard_streams() -> None:
    # JSON is consumed by editors and may contain symbols outside the active Windows code page.
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def _initialize_architecture(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="archcheck init-architecture",
        description="Draft an architecture.yaml from the files that actually compile.",
    )
    parser.add_argument("project", nargs="?", default=".", type=Path)
    parser.add_argument("--compile-commands", type=Path, dest="compile_commands")
    parser.add_argument("--out", type=Path, help="Output path. Default: <project>/architecture.yaml")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing file")
    args = parser.parse_args(argv)
    project = args.project.expanduser().resolve()
    destination = (args.out or project / "architecture.yaml").expanduser().resolve()
    if destination.exists() and not args.force:
        print(f"archcheck: {destination} already exists; not overwritten (use --force)", file=sys.stderr)
        return 2

    try:
        result = analyze_project(project, args.compile_commands, destination)
        path = write_draft_architecture(
            destination,
            tuple(item.path for item in result.file_metrics),
        )
    except (ArchitectureConfigError, CompileCommandsError, OSError) as exc:
        print(f"archcheck: {exc}", file=sys.stderr)
        return 2

    print(f"Architecture draft written: {path}")
    print("Status: draft. Review node responsibilities and may_depend_on before turning on the architecture gate.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
