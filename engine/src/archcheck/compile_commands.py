from __future__ import annotations

import json
import os
import posixpath
import shlex
from collections import Counter
from pathlib import Path
from typing import Any

from archcheck.paths import resolved

from archcheck.model import CompileCommand, PathMapping


class CompileCommandsError(ValueError):
    """Raised when a compilation database is missing or malformed."""


def find_compile_commands(project: Path) -> Path:
    candidates = (
        project / "compile_commands.json",
        project / "build" / "compile_commands.json",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()

    searched = ", ".join(str(path) for path in candidates)
    raise CompileCommandsError(f"compile_commands.json not found; searched: {searched}")


def load_compile_commands(
    path: Path,
    path_mapping: PathMapping | None = None,
) -> list[CompileCommand]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CompileCommandsError(f"file does not exist: {path}") from exc
    except json.JSONDecodeError as exc:
        raise CompileCommandsError(f"invalid JSON in {path}: {exc}") from exc

    if not isinstance(raw, list):
        raise CompileCommandsError("compilation database root must be a JSON array")

    commands: list[CompileCommand] = []
    for index, entry in enumerate(raw):
        commands.append(_parse_entry(entry, index, path_mapping))
    return commands


def infer_path_mapping(path: Path, project: Path) -> PathMapping | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    if not isinstance(raw, list):
        return None

    project = project.resolve()
    top_level_directories = {
        child.name
        for child in project.iterdir()
        if child.is_dir() and child.name not in {".git", "build", "output"}
    }
    candidates: Counter[str] = Counter()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        for key in ("file", "directory"):
            value = entry.get(key)
            if not isinstance(value, str):
                continue
            normalized = value.replace("\\", "/")
            for directory_name in top_level_directories:
                marker = f"/{directory_name}/"
                marker_index = normalized.find(marker)
                if marker_index > 0:
                    candidates[normalized[:marker_index]] += 1

    if not candidates:
        return None
    source, _ = candidates.most_common(1)[0]
    return PathMapping(source=source, target=project)


def map_compilation_path(
    value: str,
    raw_directory: str,
    path_mapping: PathMapping | None,
) -> Path:
    normalized_value = value.replace("\\", "/")
    normalized_directory = raw_directory.replace("\\", "/")
    if not posixpath.isabs(normalized_value) and not Path(value).is_absolute():
        normalized_value = posixpath.normpath(
            posixpath.join(normalized_directory, normalized_value)
        )

    if path_mapping is not None:
        source = path_mapping.source.replace("\\", "/").rstrip("/")
        if normalized_value == source or normalized_value.startswith(source + "/"):
            suffix = normalized_value[len(source) :].lstrip("/")
            mapped = resolved(path_mapping.target.joinpath(*suffix.split("/")))
            # 映射逐条判断。数据库来自别的机器时原路径不存在，映射过去就对；PlatformIO 的数据库
            # 列出 ~/.platformio 里的框架文件，仓库若自带同一份（hoverboard 自带 HAL 与启动文件），
            # 映射到自带副本也对；但框架里仓库没有的目录（Grbl_Esp32 的 SDK 头文件目录）映射过去
            # 就指向虚空，IRAM_ATTR 这类宏没了定义，带它的函数整个解析失败——那种情况保留原路径
            try:
                original_exists = Path(value).expanduser().exists()
            except OSError:
                original_exists = False
            if mapped.exists() or not original_exists:
                return mapped

    path_value = Path(value).expanduser()
    if not path_value.is_absolute():
        path_value = Path(raw_directory).expanduser() / path_value
    return resolved(path_value)


# clangd 拿到的是 clang 而不是工程自己的交叉编译器，所以目标三元组要重新说一遍，
# 而且必须和随行的 -m 开关对得上。cortex-m7 的命令配上 RISC-V 目标，每个 -mcpu 都成了
# 错误，clangd 对整个文件回 "invalid AST"——输出读起来像「这个工程没有函数」，
# 而不像一次失败。
_DRIVER_TARGETS = (
    ("arm-none-eabi", "arm-none-eabi"),
    ("arm-eabi", "arm-none-eabi"),
    ("aarch64", "aarch64-none-elf"),
    ("riscv64", "riscv64-unknown-elf"),
    ("riscv32", "riscv32-unknown-elf"),
    # 光写 riscv 说不清 32 还是 64；嵌入式工具链里 32 位远多于 64 位
    ("riscv", "riscv32-unknown-elf"),
    ("msp430", "msp430-none-elf"),
    ("avr", "avr"),
    ("xtensa", "xtensa"),
)


def target_for_driver(driver: str) -> str | None:
    """工程用哪个编译器构建，就推出对应的 clang 目标三元组。

    驱动名说明不了目标时返回 None，调用方就不动目标——猜错一个目标比不给目标更糟。
    """

    name = Path(driver).name.lower()
    for prefix, target in _DRIVER_TARGETS:
        if prefix in name:
            return target
    return None


def write_local_compilation_database(
    commands: list[CompileCommand],
    path_mapping: PathMapping | None,
    destination: Path,
) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    entries = []
    for command in commands:
        arguments = list(command.arguments)
        if arguments:
            driver = arguments[0]
            arguments[0] = "clang"
            if not any(
                item == "-target"
                or item.startswith("--target=")
                or item.startswith("-target=")
                for item in arguments[1:]
            ):
                target = target_for_driver(driver)
                if target is not None:
                    arguments.insert(1, f"--target={target}")
        arguments = _map_command_arguments(arguments, command, path_mapping)
        working_directory = (
            path_mapping.target
            if path_mapping is not None
            else command.directory
        )
        if not working_directory.is_dir():
            working_directory = command.file.parent
        entries.append(
            {
                "directory": str(working_directory),
                "file": str(command.file),
                "arguments": arguments,
            }
        )

    output_path = destination / "compile_commands.json"
    output_path.write_text(
        json.dumps(entries, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return output_path


def _map_command_arguments(
    arguments: list[str],
    command: CompileCommand,
    path_mapping: PathMapping | None,
) -> list[str]:
    mapped: list[str] = []
    path_flags = {"-I", "/I", "-isystem", "-iquote", "-idirafter"}
    index = 0
    while index < len(arguments):
        argument = arguments[index]
        mapped.append(argument)
        if argument in path_flags and index + 1 < len(arguments):
            index += 1
            mapped.append(
                str(
                    map_compilation_path(
                        arguments[index],
                        command.raw_directory,
                        path_mapping,
                    )
                )
            )
        elif argument.startswith("-I") and len(argument) > 2:
            mapped[-1] = "-I" + str(
                map_compilation_path(
                    argument[2:],
                    command.raw_directory,
                    path_mapping,
                )
            )
        elif argument.startswith("-isystem") and len(argument) > len("-isystem"):
            mapped[-1] = "-isystem" + str(
                map_compilation_path(
                    argument[len("-isystem") :],
                    command.raw_directory,
                    path_mapping,
                )
            )
        elif _looks_like_source_path(argument):
            mapped[-1] = str(
                map_compilation_path(
                    argument,
                    command.raw_directory,
                    path_mapping,
                )
            )
        index += 1
    return mapped


def _looks_like_source_path(value: str) -> bool:
    return Path(value).suffix.lower() in {".c", ".cc", ".cpp", ".cxx", ".ino", ".s", ".asm"}


def _parse_entry(
    entry: Any,
    index: int,
    path_mapping: PathMapping | None,
) -> CompileCommand:
    if not isinstance(entry, dict):
        raise CompileCommandsError(f"entry {index} must be an object")

    directory_value = entry.get("directory")
    file_value = entry.get("file")
    if not isinstance(directory_value, str) or not isinstance(file_value, str):
        raise CompileCommandsError(f"entry {index} requires string directory and file fields")

    directory = map_compilation_path(directory_value, directory_value, path_mapping)
    source_file = map_compilation_path(file_value, directory_value, path_mapping)

    arguments_value = entry.get("arguments")
    command_value = entry.get("command")
    if isinstance(arguments_value, list) and all(isinstance(item, str) for item in arguments_value):
        arguments = tuple(arguments_value)
    elif isinstance(command_value, str):
        arguments = tuple(shlex.split(command_value, posix=os.name != "nt"))
    else:
        raise CompileCommandsError(f"entry {index} requires arguments or command")

    # Arduino：PlatformIO 把 sketch.ino 转成临时的 sketch.ino.cpp 编译，生成数据库后临时文件就删了。
    # 那份 .ino.cpp 就是 .ino 前面补了 #include <Arduino.h> 和原型；还原回 .ino、按 C++ 解析，
    # 不然 setup() / loop() 所在的文件「不在磁盘上」，Arduino 工程就没有入口
    if source_file.name.lower().endswith(".ino.cpp") and not source_file.exists():
        sketch = source_file.with_name(source_file.name[: -len(".cpp")])
        if sketch.is_file():
            original = str(source_file)
            source_file = sketch
            rewritten: list[str] = []
            for item in arguments:
                if item == original or item.replace("\\", "/") == file_value.replace("\\", "/") or item.endswith(".ino.cpp"):
                    rewritten.extend(["-x", "c++", "-include", "Arduino.h", str(sketch)])
                else:
                    rewritten.append(item)
            arguments = tuple(rewritten)

    output = entry.get("output")
    return CompileCommand(
        directory=directory,
        file=source_file,
        arguments=arguments,
        raw_directory=directory_value,
        output=output if isinstance(output, str) else None,
    )
