# Rule profiles / 规则 profile

每个 YAML 文件描述一个 RTOS、MCU 库、平台 SDK 或一组命名启发式的 API 名字。引擎本身不认识任何函数名，所有识别都来自这里。目录名就是 `kind`。

Each YAML file names the APIs of one RTOS, MCU library, platform SDK or a set of naming heuristics. The engine itself knows no function name; every recognition comes from here. The directory name is the `kind`.

| kind | 目录 / directory | 例子 / examples |
|---|---|---|
| `rtos` | `rtos/` | freertos, protothreads, cmsis-rtos2, zephyr, posix |
| `mcu` | `mcu/` | gd32f30x, cortex-m-cmsis, stm32-hal |
| `platform` | `platform/` | esp-idf |
| `generic` | `generic/` | heuristics（低置信度的命名规则 / low-confidence naming rules） |
| `toolchain` | `toolchain/` | 预留：编译器关键字映射 / reserved for compiler keyword maps |

## 选择 / Selection

默认全部 profile 生效。项目在 `architecture.yaml` 里可以只选用到的：

All profiles apply by default. A project can narrow the set in `architecture.yaml`:

```yaml
profiles: [freertos, esp-idf]
framework_rules:            # 项目私有规则，追加在 profile 之后 / project-private rules, appended after the profiles
  callback_register:
    - function: my_bus_subscribe
      entry_argument: 1
```

事实里的 `rule` 字段（如 `freertos.xTaskCreate`）指回这里的条目，下游据此显示"这条判断依据哪条规则"。

The `rule` field in the facts (e.g. `freertos.xTaskCreate`) points back to an entry here; downstream tools show it as the basis of a judgement.

## 字段 / Fields

| 段 / section | 字段 / fields | 含义 / meaning |
|---|---|---|
| `task_create` `callback_register` `timer_create` | `rule` `function` `entry_argument` `confidence` | 注册 API；`entry_argument` 是入口函数指针是第几个实参（0 起），省略表示任意位置。产出 `executionUnits[kind=task|callback|timer]` 与 `registers_*` 边。/ Registration API; `entry_argument` is the 0-based index of the entry-function argument, omitted = any. Produces `executionUnits` and `registers_*` edges. |
| `callback_register` 附加 | `context: isr` | 这条 API 装的是中断处理函数（ESP-IDF `esp_intr_alloc` / `gpio_isr_handler_add`，没有向量表）。命中的单元 kind 为 `isr`，带 `registeredAt` 与 `rule` 而没有 `vector`；冲突检测据此取到中断侧。/ The API installs an interrupt handler (no vector table); the unit is kind `isr` with `registeredAt` and `rule` but no `vector`, so conflict detection has an interrupt side. |
| `task_create` 附加 | `priority_argument` 或 `attr_argument` + `priority_field` | 任务优先级在哪：`priority_argument` 是优先级实参下标（`xTaskCreate` 为 4）；`attr_argument` + `priority_field` 说优先级在按地址传入的属性结构体的哪个字段里（`osThreadNew(fn, arg, &attr)` → 2 / `priority`），从该结构体的文件级初始化器里读。字面量、枚举常量、`常量 ± 字面量` 解成数字，其余只记原文（`basis: unresolved`）。出到 `executionUnits[kind=task].priority`。/ Where the task priority is: a call argument index, or an attribute struct (passed by address) and its field, read from the struct's file-scope initializer. Literals, enum constants and `constant ± literal` resolve to a number; anything else keeps the text only. |
| `isr_enable` | `rule` `function` `irq_argument` `confidence` | 中断使能 API；`irq_argument` 是 IRQ 号实参下标。常量实参直接解析；非常量走一层数据流（`enableSites`）。IRQ 后面的两个字面整数记为抢占 / 子优先级。/ ISR enable API; constant IRQ arguments resolve directly, non-constant ones go through one data-flow step (`enableSites`); two literal integers after the IRQ are recorded as preempt / sub priority. |
| `blocking` | `rule` `function` `kind` `confidence` `duration_argument` `duration_unit` | 阻塞点。`kind`：`delay` 定时睡眠 → 周期任务；`wait` 等事件 / 队列 / 信号量 → 事件驱动；`yield` 让出 → 忙轮询。`duration_*` 给周期推导用，单位 `ms` `us` `s` `tick`。函数式宏按源码文本匹配。/ Blocking point. `delay` → periodic, `wait` → event-driven, `yield` → busy-poll. `duration_*` feed the period derivation. Function-like macros match by source text. |
| `critical_section` | `rule` `begin` `end` `kind` `match_argument` `confidence` | 成对 API；`kind`：`irq` 屏蔽中断、`scheduler` 屏蔽任务切换、`mutex` 互斥；`match_argument` 要求两端首个实参文本一致（`NVIC_DisableIRQ(X)` … `NVIC_EnableIRQ(X)`）。判定是"同一语句块内成对"；同一函数里嵌套的第二次 begin 不再开新段；只调 begin 不调 end 的函数被认作 begin 包装（`lock()`），反之为 end 包装，调用方按源码顺序配对（`viaWrapper: true`）。/ Paired APIs; `match_argument` requires identical first arguments. Same-block pairing; a nested begin inside an open section is folded into it; begin-only / end-only functions are recognised as wrappers and paired in callers by source order (`viaWrapper: true`). |
| `systick_config` | `rule` `function` `reload_argument` | 系统节拍配置 API；`reload_argument` 是重载值实参下标（省略为 0，写 `null` 表示无实参的包装）。引擎折叠该实参（字面量 + hover 解析的常量）得出 SysTick 重载值，配合 CMSIS 的核心时钟全局算出 tick 周期，出到 `timeBase`。/ System-tick configuration API; the engine folds the reload argument and, with the CMSIS core-clock global, derives the tick period into `timeBase`. |
| `task_control` | `rule` / `function` / `kind`（suspend / resume / exit / restart）/ `task_argument`（任务实参下标，`null` = 调用者自己） | 挂起的任务会被调度器整个跳过，所以"每个注册任务每圈都跑"对它不成立。引擎产出 `taskControls[]`：谁在哪一行挂起 / 恢复 / 结束了哪个任务；实参是普通函数名时解析到具体任务，否则只记表达式原文 |
| `scheduling` | `cooperative` / `preemptive` | 调度模型。`cooperative`：线程跑到自己让出为止，线程之间不抢占，只有中断插进来（protothreads、裸机大循环）——线程 × 线程的共享不算竞争，一轮调度是一串首尾相接的时间片；`preemptive`：高优先级线程可在任意点打断低优先级线程（FreeRTOS / Zephyr / CMSIS-RTOS2）。多个 profile 同时声明时抢占式优先（更强的交错是安全假设）。出到 `scheduling` 字段。/ Scheduling model; consumers must draw and reason differently for the two. |
| `atomic_width_bytes` | 1 / 2 / 4 / 8 | 目标上单次 load / store 原子的最大宽度，默认 4；用于 `sharedResources[].atomicity`（`single-word` / `wide` / `composite` / `unknown`）。/ Widest atomic single load / store on the target, default 4; feeds `sharedResources[].atomicity`. |
| `tick_ms` | 数字 / number | 调度 tick，默认 1 ms，`duration_unit: tick` 用它换算。/ Scheduler tick, default 1 ms, used for `tick` durations. |

`function` / `begin` / `end` 支持 `*` 通配（`fnmatch`）。精确名字优先于通配；同级按 `rule` 字典序，所以结果与文件顺序无关。

`function` / `begin` / `end` accept `*` wildcards (`fnmatch`). Exact names win over patterns; ties break on `rule`, so results do not depend on file order.

## 贡献 / Contributing

见仓库根目录 [CONTRIBUTING.md](../../../CONTRIBUTING.md)（中文）/ [CONTRIBUTING.en.md](../../../CONTRIBUTING.en.md)（English）。一个 profile = 一个 YAML + 一个最小 C fixture 测试。

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) / [CONTRIBUTING.en.md](../../../CONTRIBUTING.en.md). One profile = one YAML + one minimal C fixture test.
