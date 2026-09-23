from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from queue import Empty, Queue
from threading import Thread
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import webbrowser

from archcheck.analyzer import analyze_project, analyze_source_tree
from archcheck.architecture_config import ArchitectureConfigError
from archcheck.compile_commands import CompileCommandsError, find_compile_commands
from archcheck.keil import (
    KeilProjectError,
    find_keil_projects,
    list_keil_targets,
    write_keil_compilation_database,
)
from archcheck.report import write_reports
from archcheck.semantic import enrich_with_global_variables, find_clangd


LLVM_DOWNLOAD_URL = "https://github.com/llvm/llvm-project/releases/latest"


@dataclass(frozen=True)
class ProjectInput:
    kind: str
    path: Path | None
    label: str


def discover_project_inputs(project: Path) -> tuple[ProjectInput, ...]:
    project = project.expanduser().resolve()
    inputs: list[ProjectInput] = []
    for keil_project in find_keil_projects(project):
        relative = keil_project.relative_to(project)
        inputs.append(ProjectInput("keil", keil_project, f"Keil: {relative}"))
    try:
        compile_commands = find_compile_commands(project)
    except CompileCommandsError:
        compile_commands = None
    if compile_commands is not None:
        relative = compile_commands.relative_to(project)
        inputs.append(
            ProjectInput("compile_commands", compile_commands, f"编译数据库: {relative}")
        )
    inputs.append(ProjectInput("source", None, "仅扫描源码（低精度）"))
    return tuple(inputs)


class ArchcheckApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("ArchCheck 架构分析器")
        self.root.geometry("820x620")
        self.root.minsize(720, 560)
        self.events: Queue[tuple[str, object]] = Queue()
        self.inputs: tuple[ProjectInput, ...] = ()
        self.report_path: Path | None = None

        self.project_var = tk.StringVar()
        self.input_var = tk.StringVar()
        self.target_var = tk.StringVar()
        self.output_var = tk.StringVar()
        self.clangd_var = tk.StringVar()
        self.status_var = tk.StringVar(value="请选择待分析的项目目录")

        self._configure_style()
        self._build_ui()
        self._refresh_clangd()
        self.root.after(100, self._poll_events)

    def _configure_style(self) -> None:
        style = ttk.Style(self.root)
        if "vista" in style.theme_names():
            style.theme_use("vista")
        style.configure("Title.TLabel", font=("Microsoft YaHei UI", 18, "bold"))
        style.configure("Heading.TLabel", font=("Microsoft YaHei UI", 10, "bold"))
        style.configure("TButton", padding=(10, 7))

    def _build_ui(self) -> None:
        outer = ttk.Frame(self.root, padding=24)
        outer.pack(fill="both", expand=True)
        outer.columnconfigure(0, weight=1)

        ttk.Label(outer, text="ArchCheck", style="Title.TLabel").grid(
            row=0, column=0, sticky="w"
        )
        ttk.Label(outer, text="C/C++ 与 Keil 工程离线架构分析").grid(
            row=1, column=0, sticky="w", pady=(2, 22)
        )

        form = ttk.Frame(outer)
        form.grid(row=2, column=0, sticky="nsew")
        form.columnconfigure(0, weight=1)

        self._label(form, 0, "项目目录")
        project_row = ttk.Frame(form)
        project_row.grid(row=1, column=0, sticky="ew", pady=(5, 14))
        project_row.columnconfigure(0, weight=1)
        ttk.Entry(project_row, textvariable=self.project_var).grid(
            row=0, column=0, sticky="ew"
        )
        ttk.Button(project_row, text="选择...", command=self._choose_project).grid(
            row=0, column=1, padx=(8, 0)
        )

        self._label(form, 2, "编译配置")
        self.input_combo = ttk.Combobox(
            form, textvariable=self.input_var, state="readonly"
        )
        self.input_combo.grid(row=3, column=0, sticky="ew", pady=(5, 14))
        self.input_combo.bind("<<ComboboxSelected>>", self._input_changed)

        self.target_label = ttk.Label(form, text="Keil Target", style="Heading.TLabel")
        self.target_label.grid(row=4, column=0, sticky="w")
        self.target_combo = ttk.Combobox(
            form, textvariable=self.target_var, state="disabled"
        )
        self.target_combo.grid(row=5, column=0, sticky="ew", pady=(5, 14))

        self._label(form, 6, "报告目录")
        output_row = ttk.Frame(form)
        output_row.grid(row=7, column=0, sticky="ew", pady=(5, 14))
        output_row.columnconfigure(0, weight=1)
        ttk.Entry(output_row, textvariable=self.output_var).grid(
            row=0, column=0, sticky="ew"
        )
        ttk.Button(output_row, text="选择...", command=self._choose_output).grid(
            row=0, column=1, padx=(8, 0)
        )

        tool_row = ttk.Frame(form)
        tool_row.grid(row=8, column=0, sticky="ew", pady=(2, 18))
        tool_row.columnconfigure(0, weight=1)
        ttk.Label(tool_row, textvariable=self.clangd_var).grid(
            row=0, column=0, sticky="w"
        )
        ttk.Button(tool_row, text="重新检测", command=self._refresh_clangd).grid(
            row=0, column=1, padx=(8, 0)
        )
        ttk.Button(tool_row, text="获取 clangd", command=self._open_clangd_page).grid(
            row=0, column=2, padx=(8, 0)
        )

        self.progress = ttk.Progressbar(form, mode="indeterminate")
        self.progress.grid(row=9, column=0, sticky="ew", pady=(0, 10))
        ttk.Label(form, textvariable=self.status_var, wraplength=740).grid(
            row=10, column=0, sticky="w", pady=(0, 16)
        )

        actions = ttk.Frame(form)
        actions.grid(row=11, column=0, sticky="e")
        self.open_button = ttk.Button(
            actions, text="打开报告", command=self._open_report, state="disabled"
        )
        self.open_button.grid(row=0, column=0, padx=(0, 8))
        self.analyze_button = ttk.Button(
            actions, text="开始分析", command=self._start_analysis
        )
        self.analyze_button.grid(row=0, column=1)

    @staticmethod
    def _label(parent: ttk.Frame, row: int, text: str) -> None:
        ttk.Label(parent, text=text, style="Heading.TLabel").grid(
            row=row, column=0, sticky="w"
        )

    def _choose_project(self) -> None:
        selected = filedialog.askdirectory(title="选择 C/C++ 项目目录")
        if not selected:
            return
        project = Path(selected).resolve()
        self.project_var.set(str(project))
        self.output_var.set(str(project / ".arch-report"))
        self._discover_inputs(project)

    def _choose_output(self) -> None:
        selected = filedialog.askdirectory(title="选择报告输出目录")
        if selected:
            self.output_var.set(selected)

    def _discover_inputs(self, project: Path) -> None:
        try:
            self.inputs = discover_project_inputs(project)
        except OSError as exc:
            messagebox.showerror("项目读取失败", str(exc), parent=self.root)
            return
        labels = [item.label for item in self.inputs]
        self.input_combo.configure(values=labels)
        preferred = next(
            (index for index, item in enumerate(self.inputs) if item.kind != "source"),
            len(self.inputs) - 1,
        )
        self.input_combo.current(preferred)
        self._input_changed()
        detected = len(self.inputs) - 1
        self.status_var.set(
            f"已找到 {detected} 个编译配置" if detected else "未找到编译配置，可进行低精度源码扫描"
        )

    def _selected_input(self) -> ProjectInput | None:
        index = self.input_combo.current()
        return self.inputs[index] if 0 <= index < len(self.inputs) else None

    def _input_changed(self, _event: object | None = None) -> None:
        selected = self._selected_input()
        if selected is None or selected.kind != "keil" or selected.path is None:
            self.target_combo.configure(state="disabled", values=())
            self.target_var.set("")
            return
        try:
            targets = list_keil_targets(selected.path)
        except KeilProjectError as exc:
            messagebox.showerror("Keil 工程无效", str(exc), parent=self.root)
            return
        self.target_combo.configure(state="readonly", values=targets)
        if targets:
            self.target_combo.current(0)

    def _refresh_clangd(self) -> None:
        clangd = find_clangd()
        if clangd is None:
            self.clangd_var.set("clangd：未安装，函数和变量语义分析不可用")
        else:
            self.clangd_var.set(f"clangd：已就绪（{clangd}）")

    @staticmethod
    def _open_clangd_page() -> None:
        webbrowser.open(LLVM_DOWNLOAD_URL)

    def _start_analysis(self) -> None:
        try:
            project = Path(self.project_var.get()).expanduser().resolve()
            output = Path(self.output_var.get()).expanduser().resolve()
        except OSError as exc:
            messagebox.showerror("路径无效", str(exc), parent=self.root)
            return
        selected = self._selected_input()
        if not project.is_dir() or selected is None:
            messagebox.showwarning("信息不完整", "请先选择有效的项目目录。", parent=self.root)
            return
        if find_clangd() is None and selected.kind != "source":
            install = messagebox.askokcancel(
                "未找到 clangd",
                "没有 clangd 仍可生成文件级基础报告，但无法可靠提取函数调用、变量引用和全局变量。\n\n点击“确定”打开 LLVM 下载页面；安装后点击“重新检测”。点击“取消”继续基础分析。",
                parent=self.root,
            )
            if install:
                self._open_clangd_page()
                return

        self.report_path = None
        self.open_button.configure(state="disabled")
        self.analyze_button.configure(state="disabled")
        self.progress.start(12)
        self.status_var.set("正在读取编译配置并分析代码，请稍候...")
        Thread(
            target=self._analyze_worker,
            args=(project, output, selected, self.target_var.get() or None),
            daemon=True,
        ).start()

    def _analyze_worker(
        self,
        project: Path,
        output: Path,
        selected: ProjectInput,
        target: str | None,
    ) -> None:
        try:
            if selected.kind == "source":
                result = analyze_source_tree(project)
            else:
                compile_commands = selected.path
                if selected.kind == "keil" and selected.path is not None:
                    keil = write_keil_compilation_database(
                        project, selected.path, output / ".keil", target
                    )
                    compile_commands = keil.compile_commands
                result = analyze_project(project, compile_commands)
                if find_clangd() is not None:
                    result = enrich_with_global_variables(result, output / ".clangd")
            report_paths = write_reports(result, output)
            self.events.put(("done", (result, report_paths[-1])))
        except (
            ArchitectureConfigError,
            CompileCommandsError,
            KeilProjectError,
            OSError,
            RuntimeError,
        ) as exc:
            self.events.put(("error", exc))

    def _poll_events(self) -> None:
        try:
            kind, payload = self.events.get_nowait()
        except Empty:
            self.root.after(100, self._poll_events)
            return
        self.progress.stop()
        self.analyze_button.configure(state="normal")
        if kind == "error":
            self.status_var.set("分析失败")
            messagebox.showerror("分析失败", str(payload), parent=self.root)
        else:
            result, report_path = payload
            self.report_path = report_path
            self.open_button.configure(state="normal")
            self.status_var.set(
                f"分析完成：{result.metrics.source_files} 个源文件，"
                f"{result.metrics.functions} 个函数，"
                f"{result.metrics.global_variables} 个全局变量。"
            )
            self._open_report()
        self.root.after(100, self._poll_events)

    def _open_report(self) -> None:
        if self.report_path is not None and self.report_path.is_file():
            webbrowser.open(self.report_path.as_uri())


def main() -> None:
    root = tk.Tk()
    ArchcheckApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
