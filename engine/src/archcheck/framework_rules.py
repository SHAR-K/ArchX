"""Framework rule library (design doc §7).

Rules turn raw facts into interpreted facts:

* an ``address_of`` edge whose callee matches a registration rule becomes a
  ``registers_task`` / ``registers_callback`` edge and later an execution unit;
* a call to an ISR enable API whose IRQ argument resolves to a constant becomes
  an ``enables_isr`` edge.

Built-in rules cover FreeRTOS (§7.1), ESP-IDF (§7.2), the standard protothreads
macros and vendor SDKs such as GD32 / STM32 HAL (§7.4).  Only API names that can
be looked up in public framework docs or a vendor SDK belong here; names that exist
in a single project extend them
through ``framework_rules`` in ``architecture.yaml`` or a standalone
``framework_rules.yaml`` next to it (§7.3).

Schema 3 adds two AST-level rule families:

* blocking rules classify a call inside a loop body as ``delay`` (periodic
  sleep), ``wait`` (queue / semaphore / event / condition wait) or ``yield``
  (cooperative hand-off without a timing guarantee) — they drive ``runMode``;
* critical-section rules pair a *begin* API with an *end* API
  (``__disable_irq`` / ``__enable_irq``, ``taskENTER_CRITICAL`` /
  ``taskEXIT_CRITICAL`` ...) so accesses between them in the same statement
  sequence can be marked as protected (approximation, see ``ast_facts``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any, Iterable

import yaml


REGISTRATION_KINDS = {"task", "callback", "timer"}
CONFIDENCE_LEVELS = {"high", "medium", "low"}
BLOCKING_KINDS = {"delay", "wait", "yield"}
CRITICAL_SECTION_KINDS = {"irq", "scheduler", "mutex"}
SCHEDULING_KINDS = {"cooperative", "preemptive", "unknown"}


class FrameworkRulesError(ValueError):
    """Raised when a rule configuration is malformed."""


@dataclass(frozen=True)
class RegistrationRule:
    rule_id: str
    function: str
    entry_argument: int | None
    kind: str
    confidence: str = "high"
    # Task priority, for ``task_create`` rules only.  ``priority_argument``: the priority is
    # a plain call argument (``xTaskCreate(fn, name, stack, arg, PRIORITY, handle)`` -> 4).
    # ``attr_argument`` + ``priority_field``: the priority sits in an attribute struct passed
    # by address (``osThreadNew(fn, arg, &attr)`` -> 2 / ``priority``) and is read from the
    # struct's file-scope initializer.  Preemptive scheduling is decided by these numbers,
    # so without them no preemption picture can be drawn.
    priority_argument: int | None = None
    attr_argument: int | None = None
    priority_field: str | None = None
    # ``context: isr`` on a ``callback_register`` rule: the API installs an interrupt handler
    # (ESP-IDF ``esp_intr_alloc`` / ``gpio_isr_handler_add``, no vector table involved).  The
    # unit it produces is kind ``isr``, so conflict detection sees an interrupt side.  Without
    # this every ESP-IDF handler is a plain callback and a project reports zero conflicts, which
    # reads as "clean" when it means "unmodelled".
    context: str | None = None

    @property
    def unit_kind(self) -> str:
        return "isr" if self.context == "isr" else self.kind
    # Task priority, for ``task_create`` rules only.  ``priority_argument``: the priority is
    # a plain call argument (``xTaskCreate(fn, name, stack, arg, PRIORITY, handle)`` -> 4).
    # ``attr_argument`` + ``priority_field``: the priority sits in an attribute struct passed
    # by address (``osThreadNew(fn, arg, &attr)`` -> 2 / ``priority``) and is read from the
    # struct's file-scope initializer.  Preemptive scheduling is decided by these numbers,
    # so without them no preemption picture can be drawn.
    priority_argument: int | None = None
    attr_argument: int | None = None
    priority_field: str | None = None
    # Task priority, for ``task_create`` rules only.  ``priority_argument``: the priority is
    # a plain call argument (``xTaskCreate(fn, name, stack, arg, PRIORITY, handle)`` -> 4).
    # ``attr_argument`` + ``priority_field``: the priority sits in an attribute struct passed
    # by address (``osThreadNew(fn, arg, &attr)`` -> 2 / ``priority``) and is read from the
    # struct's file-scope initializer.  Preemptive scheduling is decided by these numbers,
    # so without them no preemption picture can be drawn.
    priority_argument: int | None = None
    attr_argument: int | None = None
    priority_field: str | None = None

    @property
    def relation(self) -> str:
        return "registers_task" if self.kind == "task" else "registers_callback"

    def matches(self, callee: str, argument_index: int) -> bool:
        if self.entry_argument is not None and self.entry_argument != argument_index:
            return False
        return _name_matches(self.function, callee)


@dataclass(frozen=True)
class IsrEnableRule:
    rule_id: str
    function: str
    irq_argument: int
    confidence: str = "high"

    def matches(self, callee: str) -> bool:
        return _name_matches(self.function, callee)


@dataclass(frozen=True)
class BlockingRule:
    """A call that suspends the calling execution unit (design doc §4.3 / 阶段四).

    ``kind`` is ``delay`` (time-based sleep), ``wait`` (blocks on a queue, semaphore,
    event group, notification or arbitrary condition) or ``yield`` (gives the scheduler a
    chance to run something else without a timing guarantee).
    """

    rule_id: str
    function: str
    kind: str
    confidence: str = "high"
    # For ``delay`` rules: which argument carries the duration and its unit
    # (``ms`` | ``us`` | ``s`` | ``tick``).  ``tick`` is converted with FrameworkRules.tick_ms.
    duration_argument: int | None = None
    duration_unit: str = "ms"

    def matches(self, callee: str) -> bool:
        return _name_matches(self.function, callee)


@dataclass(frozen=True)
class SysTickRule:
    """The API that programs the system tick, and which argument carries the reload value.

    ``SysTick_Config(SystemCoreClock / 1000U)`` is CMSIS, so one rule covers every Cortex-M;
    a vendor wrapper that takes no argument is matched too and reports the tick as unknown.
    """

    rule_id: str
    function: str
    reload_argument: int | None = 0
    confidence: str = "high"

    def matches(self, callee: str) -> bool:
        return _name_matches(self.function, callee)


TASK_CONTROL_KINDS = {"suspend", "resume", "exit", "restart"}


@dataclass(frozen=True)
class TaskControlRule:
    """An API that changes whether a task is scheduled at all.

    ``thread_suspend(app_task)`` takes the task out of the polling loop; ``thread_exit()``
    ends it.  ``task_argument`` says which argument names the task (``None`` = the caller's
    own task, as with ``PT_EXIT``), so the caller can resolve it to an execution unit.
    """

    rule_id: str
    function: str
    kind: str  # suspend | resume | exit | restart
    task_argument: int | None = 0
    confidence: str = "high"

    def matches(self, callee: str) -> bool:
        return _name_matches(self.function, callee)


@dataclass(frozen=True)
class CriticalSectionRule:
    """A begin / end API pair delimiting a critical section (design doc §4.5).

    ``match_argument`` requests that the first argument of both calls is textually
    identical (``NVIC_DisableIRQ(X)`` ... ``NVIC_EnableIRQ(X)``); ``kind`` says what
    the section excludes: ``irq`` (interrupts), ``scheduler`` (task switches) or
    ``mutex`` (other holders of the same lock).
    """

    rule_id: str
    begin: str
    end: str
    kind: str = "irq"
    match_argument: bool = False
    confidence: str = "high"

    def matches_begin(self, callee: str) -> bool:
        return _name_matches(self.begin, callee)

    def matches_end(self, callee: str) -> bool:
        return _name_matches(self.end, callee)


@dataclass(frozen=True)
class FrameworkRules:
    registrations: tuple[RegistrationRule, ...] = ()
    isr_enables: tuple[IsrEnableRule, ...] = ()
    sources: tuple[str, ...] = field(default=())
    blocking: tuple[BlockingRule, ...] = ()
    critical_sections: tuple[CriticalSectionRule, ...] = ()
    systicks: tuple[SysTickRule, ...] = ()
    task_controls: tuple[TaskControlRule, ...] = ()
    # Scheduler tick in milliseconds, used to convert ``tick`` durations; a declared
    # assumption (default 1 ms), overridable per project with ``tick_ms:`` in the rules file.
    tick_ms: float = 1.0
    # Widest object a single load / store moves atomically on the target (bytes).  Cortex-M
    # and most 32-bit MCUs: 4; AVR / 8051: 1; 64-bit hosts: 8.  Declared by the MCU profile
    # or the project rules file with ``atomic_width_bytes:``.
    atomic_width_bytes: int = 4
    # How the scheduler hands the CPU between threads, declared by the RTOS / kernel profile
    # with ``scheduling:``.  ``cooperative``: a thread runs until it yields, threads never
    # preempt each other (protothreads, a bare super-loop) — only interrupts interleave, so
    # thread × thread sharing is not a race and a scheduling round is a sequence of slices.
    # ``preemptive``: a higher-priority thread can interrupt a lower one at any point
    # (FreeRTOS, Zephyr, CMSIS-RTOS2).  ``unknown`` when no profile says.
    #
    # ``scheduling`` is the union over every loaded profile, which is useless when a project
    # loads them all: use ``scheduling_of_rules`` with the rule ids that actually produced
    # execution units instead.
    scheduling: str = "unknown"
    # rule id -> the scheduling its own profile declared, so the effective model can be
    # resolved from the rules that actually matched this project.
    scheduling_by_rule: dict[str, str] = field(default_factory=dict)

    def scheduling_of_rules(self, rule_ids: Iterable[str | None]) -> str:
        """Scheduling model implied by the rules that actually fired.

        A project that loads every shipped profile still only matches the kernel it really
        uses, so this is what consumers should read.  Both kinds present -> ``preemptive``
        (the stronger interleaving is the safe assumption); nothing matched -> ``unknown``.
        """

        kinds = {self.scheduling_by_rule.get(rule) for rule in rule_ids if rule}
        kinds.discard(None)
        kinds.discard("unknown")
        if not kinds:
            return "unknown"
        return "preemptive" if "preemptive" in kinds else kinds.pop() if len(kinds) == 1 else "preemptive"

    def match_registration(self, callee: str, argument_index: int) -> RegistrationRule | None:
        # Exact names win over glob patterns so a project rule can override a generic one.
        matches = [rule for rule in self.registrations if rule.matches(callee, argument_index)]
        if not matches:
            return None
        matches.sort(key=lambda rule: (_is_pattern(rule.function), rule.rule_id))
        return matches[0]

    def match_isr_enable(self, callee: str) -> IsrEnableRule | None:
        matches = [rule for rule in self.isr_enables if rule.matches(callee)]
        if not matches:
            return None
        matches.sort(key=lambda rule: (_is_pattern(rule.function), rule.rule_id))
        return matches[0]

    def registration_rule(self, rule_id: str) -> RegistrationRule | None:
        return next((rule for rule in self.registrations if rule.rule_id == rule_id), None)

    def match_blocking(self, callee: str) -> BlockingRule | None:
        matches = [rule for rule in self.blocking if rule.matches(callee)]
        if not matches:
            return None
        matches.sort(key=lambda rule: (_is_pattern(rule.function), rule.rule_id))
        return matches[0]

    def match_systick(self, callee: str) -> SysTickRule | None:
        matches = [rule for rule in self.systicks if rule.matches(callee)]
        if not matches:
            return None
        matches.sort(key=lambda rule: (_is_pattern(rule.function), rule.rule_id))
        return matches[0]

    def match_task_control(self, callee: str) -> TaskControlRule | None:
        matches = [rule for rule in self.task_controls if rule.matches(callee)]
        if not matches:
            return None
        matches.sort(key=lambda rule: (_is_pattern(rule.function), rule.rule_id))
        return matches[0]

    def match_critical_begin(self, callee: str) -> CriticalSectionRule | None:
        matches = [rule for rule in self.critical_sections if rule.matches_begin(callee)]
        if not matches:
            return None
        matches.sort(key=lambda rule: (_is_pattern(rule.begin), rule.rule_id))
        return matches[0]


PROFILES_ROOT = Path(__file__).resolve().parent / "profiles"


@dataclass(frozen=True)
class Profile:
    """One shipped rule file (``profiles/<kind>/<name>.yaml``): an RTOS, an MCU family, a
    platform SDK or a set of naming heuristics.  Profiles are data; contributors add a
    YAML file plus a fixture test, never Python."""

    name: str
    kind: str
    description: str
    path: Path
    rules: FrameworkRules


def list_profiles() -> tuple[Profile, ...]:
    """Every profile shipped with the package, sorted by path for deterministic merging."""

    profiles: list[Profile] = []
    for path in sorted(PROFILES_ROOT.rglob("*.yaml")):
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as exc:
            raise FrameworkRulesError(f"profile 读取失败：{path}: {exc}") from exc
        if not isinstance(raw, dict):
            raise FrameworkRulesError(f"profile 必须是对象：{path}")
        name = str(raw.get("name") or path.stem)
        rules = parse_framework_rules(raw, f"profile:{name}")
        profiles.append(Profile(name=name, kind=str(raw.get("kind") or path.parent.name), description=str(raw.get("description") or ""), path=path, rules=rules))
    return tuple(profiles)


def load_profiles(names: Iterable[str] | None = None) -> FrameworkRules:
    """Merge the shipped profiles (all of them, or only ``names``) into one rule set."""

    available = list_profiles()
    if names is not None:
        wanted = list(names)
        by_name = {profile.name: profile for profile in available}
        unknown = [name for name in wanted if name not in by_name]
        if unknown:
            raise FrameworkRulesError(f"未知 profile：{', '.join(unknown)}；可用：{', '.join(sorted(by_name))}")
        selected = [by_name[name] for name in wanted]
    else:
        selected = list(available)
    return _merge([profile.rules for profile in selected], [f"profile:{profile.name}" for profile in selected])


def _merge(parts: list[FrameworkRules], sources: list[str]) -> FrameworkRules:
    tick_ms = 1.0
    atomic_width_bytes = 4
    scheduling = "unknown"
    by_rule: dict[str, str] = {}
    for part in parts:
        if part.tick_ms != 1.0:
            tick_ms = part.tick_ms
        if part.atomic_width_bytes != 4:
            atomic_width_bytes = part.atomic_width_bytes
        if part.scheduling != "unknown":
            # A preemptive kernel wins over a cooperative one: with both present the
            # stronger interleaving is the safe assumption.
            scheduling = "preemptive" if "preemptive" in {scheduling, part.scheduling} else part.scheduling
        for rule in (*part.registrations, *part.blocking, *part.critical_sections, *part.isr_enables, *part.systicks, *part.task_controls):
            by_rule[rule.rule_id] = part.scheduling
        by_rule.update(part.scheduling_by_rule)
    return FrameworkRules(
        registrations=tuple(rule for part in parts for rule in part.registrations),
        isr_enables=tuple(rule for part in parts for rule in part.isr_enables),
        sources=tuple(sources),
        blocking=tuple(rule for part in parts for rule in part.blocking),
        critical_sections=tuple(rule for part in parts for rule in part.critical_sections),
        systicks=tuple(rule for part in parts for rule in part.systicks),
        task_controls=tuple(rule for part in parts for rule in part.task_controls),
        tick_ms=tick_ms,
        atomic_width_bytes=atomic_width_bytes,
        scheduling=scheduling,
        scheduling_by_rule=by_rule,
    )




_SECTION_KINDS = {
    "task_create": "task",
    "callback_register": "callback",
    "timer_create": "timer",
}


def load_framework_rules(
    project: Path | None,
    architecture_path: Path | None = None,
) -> FrameworkRules:
    """Merge built-in rules with project configuration.

    Configuration is read from ``framework_rules:`` in ``architecture.yaml`` (when the
    file exists) and from ``<project>/framework_rules.yaml`` (root key optional).
    """

    candidates: list[Path] = []
    if architecture_path is not None:
        candidates.append(architecture_path)
    if project is not None:
        candidates.append(project / "framework_rules.yaml")
        if architecture_path is None:
            candidates.append(project / "architecture.yaml")

    seen: set[Path] = set()
    selection: list[str] | None = None
    project_parts: list[FrameworkRules] = []
    project_sources: list[str] = []
    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if resolved in seen or not resolved.is_file():
            continue
        seen.add(resolved)
        chosen = _read_profile_selection(resolved)
        if chosen is not None:
            selection = chosen
        section = _read_rules_section(resolved)
        if section is None:
            continue
        project_parts.append(parse_framework_rules(section, str(resolved)))
        project_sources.append(str(resolved))

    # ``profiles: [freertos, esp-idf]`` narrows the shipped rules to the platforms in use;
    # without it every profile applies (generic heuristics included).
    base = load_profiles(selection) if selection is not None else BUILTIN_RULES
    return _merge([base, *project_parts], [*base.sources, *project_sources])


def _read_profile_selection(path: Path) -> list[str] | None:
    """``profiles:`` at the top level of architecture.yaml or inside ``framework_rules:``."""

    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise FrameworkRulesError(f"框架规则读取失败：{path}: {exc}") from exc
    if not isinstance(raw, dict):
        return None
    value = raw.get("profiles")
    if value is None and isinstance(raw.get("framework_rules"), dict):
        value = raw["framework_rules"].get("profiles")
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise FrameworkRulesError(f"{path}: profiles 必须是字符串列表")
    return value


def parse_framework_rules(
    section: Any,
    origin: str = "framework_rules",
) -> FrameworkRules:
    """Parse one ``framework_rules`` mapping into rules (built-ins are *not* included).

    Sections: ``task_create`` / ``callback_register`` / ``timer_create`` (``function``,
    ``entry_argument``), ``isr_enable`` (``function``, ``irq_argument``), ``blocking``
    (``function``, ``kind``: delay | wait | yield) and ``critical_section`` (``begin``,
    ``end``, optional ``kind``: irq | scheduler | mutex, ``match_argument``).  Every
    item may carry ``rule`` (identifier) and ``confidence``.
    """

    if not isinstance(section, dict):
        raise FrameworkRulesError(f"{origin}: framework_rules 必须是对象")

    registrations: list[RegistrationRule] = []
    isr_enables: list[IsrEnableRule] = []
    blocking: list[BlockingRule] = []
    critical_sections: list[CriticalSectionRule] = []
    for section_name, kind in _SECTION_KINDS.items():
        for index, item in enumerate(_list(section.get(section_name), f"{origin}.{section_name}")):
            function = _string(item.get("function"), f"{origin}.{section_name}[{index}].function")
            entry_argument = item.get("entry_argument")
            if entry_argument is not None and not isinstance(entry_argument, int):
                raise FrameworkRulesError(
                    f"{origin}.{section_name}[{index}].entry_argument 必须是整数或省略"
                )
            priority_argument = item.get("priority_argument")
            attr_argument = item.get("attr_argument")
            priority_field = item.get("priority_field")
            for label, value in (("priority_argument", priority_argument), ("attr_argument", attr_argument)):
                if value is not None and not isinstance(value, int):
                    raise FrameworkRulesError(f"{origin}.{section_name}[{index}].{label} 必须是整数或省略")
            if priority_field is not None and not isinstance(priority_field, str):
                raise FrameworkRulesError(f"{origin}.{section_name}[{index}].priority_field 必须是字符串或省略")
            if (attr_argument is None) != (priority_field is None):
                raise FrameworkRulesError(f"{origin}.{section_name}[{index}]: attr_argument 与 priority_field 要一起给")
            context = item.get("context")
            if context is not None and context != "isr":
                raise FrameworkRulesError(f"{origin}.{section_name}[{index}].context 只能是 isr 或省略，收到 {context!r}")
            if context == "isr" and kind != "callback":
                raise FrameworkRulesError(f"{origin}.{section_name}[{index}]: context: isr 只用于 callback_register")
            registrations.append(
                RegistrationRule(
                    rule_id=str(item.get("rule") or f"project.{function}"),
                    function=function,
                    entry_argument=entry_argument,
                    kind=kind,
                    confidence=_confidence(item.get("confidence"), "high"),
                    priority_argument=priority_argument,
                    attr_argument=attr_argument,
                    priority_field=priority_field,
                    context=context,
                )
            )
    for index, item in enumerate(_list(section.get("isr_enable"), f"{origin}.isr_enable")):
        function = _string(item.get("function"), f"{origin}.isr_enable[{index}].function")
        irq_argument = item.get("irq_argument", 0)
        if not isinstance(irq_argument, int):
            raise FrameworkRulesError(f"{origin}.isr_enable[{index}].irq_argument 必须是整数")
        isr_enables.append(
            IsrEnableRule(
                rule_id=str(item.get("rule") or f"project.{function}"),
                function=function,
                irq_argument=irq_argument,
                confidence=_confidence(item.get("confidence"), "high"),
            )
        )
    for index, item in enumerate(_list(section.get("blocking"), f"{origin}.blocking")):
        function = _string(item.get("function"), f"{origin}.blocking[{index}].function")
        kind = item.get("kind", "delay")
        if kind not in BLOCKING_KINDS:
            raise FrameworkRulesError(
                f"{origin}.blocking[{index}].kind 必须是 delay/wait/yield，收到 {kind!r}"
            )
        duration_argument = item.get("duration_argument")
        if duration_argument is not None and not isinstance(duration_argument, int):
            raise FrameworkRulesError(f"{origin}.blocking[{index}].duration_argument 必须是整数")
        duration_unit = str(item.get("duration_unit", "ms"))
        if duration_unit not in {"ms", "us", "s", "tick"}:
            raise FrameworkRulesError(f"{origin}.blocking[{index}].duration_unit 必须是 ms/us/s/tick，收到 {duration_unit!r}")
        blocking.append(
            BlockingRule(
                rule_id=str(item.get("rule") or f"project.{function}"),
                function=function,
                kind=str(kind),
                confidence=_confidence(item.get("confidence"), "high"),
                duration_argument=duration_argument,
                duration_unit=duration_unit,
            )
        )
    for index, item in enumerate(
        _list(section.get("critical_section"), f"{origin}.critical_section")
    ):
        begin = _string(item.get("begin"), f"{origin}.critical_section[{index}].begin")
        end = _string(item.get("end"), f"{origin}.critical_section[{index}].end")
        kind = item.get("kind", "irq")
        if kind not in CRITICAL_SECTION_KINDS:
            raise FrameworkRulesError(
                f"{origin}.critical_section[{index}].kind 必须是 irq/scheduler/mutex，收到 {kind!r}"
            )
        match_argument = item.get("match_argument", False)
        if not isinstance(match_argument, bool):
            raise FrameworkRulesError(
                f"{origin}.critical_section[{index}].match_argument 必须是布尔值"
            )
        critical_sections.append(
            CriticalSectionRule(
                rule_id=str(item.get("rule") or f"project.{begin}"),
                begin=begin,
                end=end,
                kind=str(kind),
                match_argument=match_argument,
                confidence=_confidence(item.get("confidence"), "high"),
            )
        )
    systicks: list[SysTickRule] = []
    for index, item in enumerate(_list(section.get("systick_config"), f"{origin}.systick_config")):
        function = _string(item.get("function"), f"{origin}.systick_config[{index}].function")
        reload_argument = item.get("reload_argument", 0)
        if reload_argument is not None and (not isinstance(reload_argument, int) or reload_argument < 0):
            raise FrameworkRulesError(f"{origin}.systick_config[{index}].reload_argument 必须是非负整数或 null")
        systicks.append(
            SysTickRule(
                rule_id=str(item.get("rule") or f"project.{function}"),
                function=function,
                reload_argument=reload_argument,
                confidence=_confidence(item.get("confidence"), "high"),
            )
        )
    task_controls: list[TaskControlRule] = []
    for index, item in enumerate(_list(section.get("task_control"), f"{origin}.task_control")):
        function = _string(item.get("function"), f"{origin}.task_control[{index}].function")
        kind = str(item.get("kind") or "")
        if kind not in TASK_CONTROL_KINDS:
            raise FrameworkRulesError(
                f"{origin}.task_control[{index}].kind 必须是 {'/'.join(sorted(TASK_CONTROL_KINDS))}，收到 {kind!r}"
            )
        task_argument = item.get("task_argument", 0)
        if task_argument is not None and (not isinstance(task_argument, int) or task_argument < 0):
            raise FrameworkRulesError(f"{origin}.task_control[{index}].task_argument 必须是非负整数或 null")
        task_controls.append(
            TaskControlRule(
                rule_id=str(item.get("rule") or f"project.{function}"),
                function=function,
                kind=kind,
                task_argument=task_argument,
                confidence=_confidence(item.get("confidence"), "high"),
            )
        )
    tick_ms = section.get("tick_ms", 1.0)
    if not isinstance(tick_ms, (int, float)) or tick_ms <= 0:
        raise FrameworkRulesError(f"{origin}.tick_ms 必须是正数，收到 {tick_ms!r}")
    atomic_width_bytes = section.get("atomic_width_bytes", 4)
    if not isinstance(atomic_width_bytes, int) or atomic_width_bytes not in {1, 2, 4, 8}:
        raise FrameworkRulesError(f"{origin}.atomic_width_bytes 必须是 1/2/4/8，收到 {atomic_width_bytes!r}")
    scheduling = section.get("scheduling", "unknown")
    if scheduling not in SCHEDULING_KINDS:
        raise FrameworkRulesError(f"{origin}.scheduling 必须是 cooperative/preemptive，收到 {scheduling!r}")
    return FrameworkRules(
        registrations=tuple(registrations),
        isr_enables=tuple(isr_enables),
        sources=(origin,),
        blocking=tuple(blocking),
        critical_sections=tuple(critical_sections),
        systicks=tuple(systicks),
        task_controls=tuple(task_controls),
        tick_ms=float(tick_ms),
        atomic_width_bytes=atomic_width_bytes,
        scheduling=str(scheduling),
        scheduling_by_rule={
            rule.rule_id: str(scheduling)
            for rule in (*registrations, *blocking, *critical_sections, *isr_enables, *task_controls)
        },
    )


def _read_rules_section(path: Path) -> Any:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise FrameworkRulesError(f"框架规则读取失败：{path}: {exc}") from exc
    if not isinstance(raw, dict):
        return None
    if "framework_rules" in raw:
        return raw["framework_rules"]
    if path.name == "framework_rules.yaml":
        return raw
    return None


def _list(value: Any, field_name: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise FrameworkRulesError(f"{field_name} 必须是对象数组")
    return value


def _string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise FrameworkRulesError(f"{field_name} 必须是非空字符串")
    return value.strip()


def _confidence(value: Any, default: str) -> str:
    if value is None:
        return default
    if value not in CONFIDENCE_LEVELS:
        raise FrameworkRulesError(f"confidence 必须是 high/medium/low，收到 {value!r}")
    return str(value)


def _is_pattern(name: str) -> bool:
    return any(char in name for char in "*?[")


def _name_matches(pattern: str, callee: str) -> bool:
    if _is_pattern(pattern):
        return fnmatchcase(callee, pattern)
    return pattern == callee


# Built-ins are the merged shipped profiles; evaluated last because they need the parser above.
BUILTIN_RULES = load_profiles()
# Kept for callers that still address the merged built-ins by kind.
BUILTIN_REGISTRATION_RULES = BUILTIN_RULES.registrations
BUILTIN_ISR_ENABLE_RULES = BUILTIN_RULES.isr_enables
BUILTIN_BLOCKING_RULES = BUILTIN_RULES.blocking
BUILTIN_CRITICAL_SECTION_RULES = BUILTIN_RULES.critical_sections
