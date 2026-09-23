from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any

import yaml

from archcheck.model import ArchitectureModule


class ArchitectureConfigError(ValueError):
    """Raised when architecture.yaml is malformed."""


@dataclass(frozen=True)
class ArchitectureConfig:
    path: Path
    modules: tuple[ArchitectureModule, ...]

    def match_module(self, file_path: str) -> str | None:
        normalized = file_path.replace("\\", "/")
        matches = [
            (len(pattern), module.module_id)
            for module in self.modules
            for pattern in module.paths
            if _matches_path(normalized, pattern)
        ]
        return max(matches)[1] if matches else None


def load_architecture_config(path: Path) -> ArchitectureConfig:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ArchitectureConfigError(f"架构配置不存在：{path}") from exc
    except yaml.YAMLError as exc:
        raise ArchitectureConfigError(f"架构配置 YAML 无效：{exc}") from exc

    if not isinstance(raw, dict):
        raise ArchitectureConfigError("architecture.yaml 根节点必须是对象")
    if raw.get("version") != 1:
        raise ArchitectureConfigError("architecture.yaml version 必须为 1")
    raw_modules = raw.get("modules")
    if not isinstance(raw_modules, dict) or not raw_modules:
        raise ArchitectureConfigError("architecture.yaml 至少需要一个 modules 节点")

    modules: list[ArchitectureModule] = []
    for module_id, value in raw_modules.items():
        if not isinstance(module_id, str) or not isinstance(value, dict):
            raise ArchitectureConfigError("modules 必须使用字符串 ID 和对象配置")
        paths = _string_tuple(value.get("paths"), f"modules.{module_id}.paths", required=True)
        modules.append(
            ArchitectureModule(
                module_id=module_id,
                name=str(value.get("name") or module_id),
                paths=paths,
                public_paths=_string_tuple(value.get("public"), f"modules.{module_id}.public"),
                may_depend_on=_string_tuple(
                    value.get("may_depend_on"),
                    f"modules.{module_id}.may_depend_on",
                ),
                owns_state=_string_tuple(
                    value.get("owns_state"),
                    f"modules.{module_id}.owns_state",
                ),
            )
        )
    return ArchitectureConfig(path=path.resolve(), modules=tuple(modules))


def write_draft_architecture(
    destination: Path,
    file_paths: tuple[str, ...],
) -> Path:
    modules: dict[str, dict[str, Any]] = {}
    node_paths = sorted({_candidate_node(path) for path in file_paths})
    for node_path in node_paths:
        module_id = _unique_module_id(node_path, modules)
        has_child_node = any(
            other.startswith(node_path + "/") for other in node_paths
        )
        modules[module_id] = {
            "name": _display_name(node_path),
            "paths": [f"{node_path}/*" if has_child_node else f"{node_path}/**"],
            "public": [],
            "may_depend_on": [],
            "owns_state": [],
        }

    document = {
        "version": 1,
        "status": "draft",
        "modules": modules,
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        yaml.safe_dump(document, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    return destination.resolve()


def default_node_for_path(file_path: str) -> str:
    return _candidate_node(file_path)


def _candidate_node(file_path: str) -> str:
    parts = file_path.replace("\\", "/").split("/")
    if parts and parts[0] == "components" and len(parts) == 3:
        return "/".join(parts[:2])
    if parts and parts[0] == "components" and len(parts) > 3:
        return "/".join(parts[: min(3, len(parts) - 1)])
    if parts and parts[0] == "third_party" and len(parts) >= 2:
        return "/".join(parts[:2])
    if len(parts) >= 2:
        return "/".join(parts[:2])
    return parts[0] if parts else "unassigned"


def _unique_module_id(node_path: str, modules: dict[str, Any]) -> str:
    base = node_path.split("/")[-1].replace("-", "_") or "module"
    candidate = base
    prefix_index = -2
    while candidate in modules:
        parts = node_path.split("/")
        prefix = parts[prefix_index] if len(parts) >= abs(prefix_index) else "module"
        candidate = f"{prefix}_{base}".replace("-", "_")
        prefix_index -= 1
    return candidate


def _display_name(node_path: str) -> str:
    return node_path.split("/")[-1]


def _string_tuple(value: Any, field: str, required: bool = False) -> tuple[str, ...]:
    if value is None and not required:
        return ()
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ArchitectureConfigError(f"{field} 必须是字符串数组")
    if required and not value:
        raise ArchitectureConfigError(f"{field} 不能为空")
    return tuple(value)


def _matches_path(path: str, pattern: str) -> bool:
    token = "\0DOUBLE_STAR\0"
    expression = re.escape(pattern.replace("**", token))
    expression = expression.replace(re.escape(token), ".*")
    expression = expression.replace(r"\*", "[^/]*")
    expression = expression.replace(r"\?", "[^/]")
    return re.fullmatch(expression, path) is not None
