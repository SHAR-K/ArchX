from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from archcheck.compile_commands import (
    CompileCommandsError,
    infer_path_mapping,
    load_compile_commands,
    write_local_compilation_database,
)
from support import isolated_work_directory


class LoadCompileCommandsTests(unittest.TestCase):
    def test_loads_arguments_and_resolves_relative_source_file(self) -> None:
        with isolated_work_directory() as project:
            database = project / "compile_commands.json"
            database.write_text(
                json.dumps(
                    [
                        {
                            "directory": str(project),
                            "file": "src/main.c",
                            "arguments": ["clang", "-c", "src/main.c"],
                        }
                    ]
                ),
                encoding="utf-8",
            )

            commands = load_compile_commands(database)

            self.assertEqual(commands[0].file, (project / "src/main.c").resolve())
            self.assertEqual(commands[0].arguments[0], "clang")

    def test_rejects_non_array_root(self) -> None:
        with isolated_work_directory() as project:
            database = project / "compile_commands.json"
            database.write_text("{}", encoding="utf-8")

            with self.assertRaises(CompileCommandsError):
                load_compile_commands(database)

    def test_infers_common_linux_project_root(self) -> None:
        with isolated_work_directory() as project:
            (project / "project").mkdir()
            database = project / "compile_commands.json"
            database.write_text(
                json.dumps(
                    [
                        {
                            "directory": "/root/workspace/build",
                            "file": "/root/workspace/project/main.c",
                            "arguments": ["clang", "-c", "/root/workspace/project/main.c"],
                        }
                    ]
                ),
                encoding="utf-8",
            )

            mapping = infer_path_mapping(database, project)

            self.assertIsNotNone(mapping)
            self.assertEqual(mapping.source, "/root/workspace")
            self.assertEqual(mapping.target, project.resolve())

    def test_no_mapping_when_the_listed_files_exist_on_this_machine(self) -> None:
        # PlatformIO 列出 ~/.platformio 里的框架源码，那边也有 libraries/ 这种和工程同名的目录；
        # 文件在本机原样就在，就不许把框架根当成「旧工程根」映射过来
        with isolated_work_directory() as root:
            project = root / "project"
            (project / "libraries").mkdir(parents=True)
            framework = root / "framework" / "libraries" / "SPI"
            framework.mkdir(parents=True)
            (framework / "SPI.cpp").write_text("void f(void) {}", encoding="utf-8")
            (project / "main.cpp").write_text("int main() { return 0; }", encoding="utf-8")
            database = project / "compile_commands.json"
            database.write_text(json.dumps([
                {"directory": str(project), "file": str(framework / "SPI.cpp"), "arguments": ["g++", "-c", str(framework / "SPI.cpp")]},
                {"directory": str(project), "file": str(project / "main.cpp"), "arguments": ["g++", "-c", str(project / "main.cpp")]},
            ]), encoding="utf-8")
            self.assertIsNone(infer_path_mapping(database, project))

    def test_writes_clangd_database_with_local_paths_and_inferred_target(self) -> None:
        with isolated_work_directory() as project:
            (project / "src").mkdir()
            source = project / "src" / "main.c"
            source.write_text("int main(void) { return 0; }", encoding="utf-8")
            database = project / "compile_commands.json"
            database.write_text(
                json.dumps(
                    [
                        {
                            "directory": "/root/workspace/build",
                            "file": "/root/workspace/src/main.c",
                            "arguments": [
                                "/opt/toolchain/riscv-gcc",
                                "-I/root/workspace/src",
                                "-march=rv32imc",
                                "-c",
                                "/root/workspace/src/main.c",
                            ],
                        }
                    ]
                ),
                encoding="utf-8",
            )
            mapping = infer_path_mapping(database, project)
            commands = load_compile_commands(database, mapping)

            local_database = write_local_compilation_database(
                commands,
                mapping,
                project / "local",
            )
            local_entry = json.loads(local_database.read_text(encoding="utf-8"))[0]

            self.assertEqual(local_entry["directory"], str(project.resolve()))
            self.assertEqual(local_entry["file"], str(source.resolve()))
            self.assertEqual(local_entry["arguments"][0], "clang")
            self.assertIn("--target=riscv32-unknown-elf", local_entry["arguments"])
            self.assertIn("-I" + str((project / "src").resolve()), local_entry["arguments"])

    def test_target_is_inferred_from_the_driver_not_fixed(self) -> None:
        """A cortex-m command under a RISC-V target makes every -mcpu an error and
        clangd rejects the whole AST, which looks like "this project has no code"."""

        from archcheck.compile_commands import target_for_driver

        self.assertEqual(
            "arm-none-eabi",
            target_for_driver("C:/Program Files (x86)/Arm GNU Toolchain arm-none-eabi/12.2/bin/arm-none-eabi-gcc.exe"),
        )
        self.assertEqual("riscv32-unknown-elf", target_for_driver("/opt/toolchain/riscv32-vendor-elf-gcc"))
        self.assertEqual("riscv64-unknown-elf", target_for_driver("riscv64-unknown-elf-gcc"))
        self.assertEqual("avr", target_for_driver("avr-gcc"))
        self.assertEqual("xtensa", target_for_driver("xtensa-esp32s3-elf-gcc"))
        # says nothing about the target -> leave it alone rather than guess
        self.assertIsNone(target_for_driver("/usr/bin/cc"))
        self.assertIsNone(target_for_driver("gcc"))


if __name__ == "__main__":
    unittest.main()
