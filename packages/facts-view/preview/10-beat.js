  // ---- 节拍：一张画布。横轴是毫秒（`sleep 实参 × tick`，事实），纵轴一行一个任务（申请顺序）。
  //      同一刻到期的任务不会并行——协作式里它们按申请顺序依次执行，所以每个任务在自己的到期时刻
  //      向右错开「申请顺序 − 1」格画。**一格是一个时间片的理想化占位**（假设每个任务一格），
  //      实际耗时静态不可知；细线把方块连回它真正的到期时刻，避免把错开读成时间。
  //      方块颜色是事实：深蓝 = 这一轮会跑的段，红 = 这一轮走到无界忙等（步数上界不成立）。
  const beat = { t0: 0, span: null, sel: null, presetDone: false, wired: false, drag: null }; // 时间轴视窗：起点与跨度（ms）；画布始终一页宽，缩放只改跨度、左边永远对齐
  const gcd2 = (a, b) => (b ? gcd2(b, a % b) : a);
  // 申请顺序：从 main 沿调用边按源码行号深度优先，遇到注册点记序号（初始化是直线时成立）
  function beatRegisterOrder() {
    const regByFn = new Map();
    for (const r of E.registrations.filter((x) => x.kind === "task")) for (const g of r.registrars ?? []) regByFn.set(g.id, [...(regByFn.get(g.id) ?? []), { line: g.line ?? 0, id: r.id }]);
    const out = []; const seen = new Set();
    const walk = (fnId, depth) => {
      if (!fnId || seen.has(fnId) || depth > 14) return;
      seen.add(fnId);
      const items = [...(calleesOf.get(fnId) ?? []).map((c) => ({ line: c.line ?? Infinity, kind: "call", t: c.t })), ...(regByFn.get(fnId) ?? []).map((x) => ({ line: x.line, kind: "reg", t: x.id }))];
      items.sort((x, y) => x.line - y.line || (x.kind === "reg" ? -1 : 1));
      for (const it of items) { if (it.kind === "reg") { if (!out.includes(it.t)) out.push(it.t); } else walk(it.t, depth + 1); }
    };
    walk(E.main, 0);
    return out;
  }
  function beatModel() {
    const order = beatRegisterOrder();
    const regs = E.registrations.filter((x) => x.kind === "task");
    const rows = regs.map((reg) => {
      const rm = A.runModes[reg.unitId] ?? {};
      const range = seqRange(reg.id);
      const segments = ptSteps(reg.id, range.from, range.to);
      const steps = segments.reduce((n, p) => n + p.steps.filter((x) => x.type === "call").length, 0);
      const loops = [...reachOf(reg.id)].flatMap((f) => loopsByFn.get(f) ?? []).map((l) => ({ ...l, klass: loopClass(l) }));
      let bounded = 0, unbounded = 0;
      for (const l of loops) { if (l.klass === "main" || l.fromMacro) continue; if (LOOP_CLASS[l.klass].cls === "busy" || l.infinite) { unbounded++; continue; } const body = Math.max(1, (l.callsInBody ?? []).length); bounded += (l.iterations?.max ?? 1) * body; }
      const idx = order.indexOf(reg.id);
      // 段序列：protothread 一次调用只跑一段（从上次的 case 继续到下一个让出）。
      // 分支里的提前出口是同一段的另一条走法，不是独立的一段，所以不进序列，只计数。
      const main = segments.filter((p) => !p.early);
      // 一段的成本：段内的调用数，加上从这些调用能走到的循环的迭代上界 × 体内调用数；
      // 走到无界忙等的段单独标出来，它的宽度不成立。
      const flat = (nodes, out = []) => { for (const n of nodes ?? []) { out.push(n); flat(n.kids ?? [], out); } return out; };
      const segWork = (p) => {
        let calls = 0, bounded = 0, unbounded = 0;
        for (const st of p.steps) {
          if (st.type !== "call") continue;
          calls++;
          for (const l of flat(loopTree(st.target, 1, [reg.id]))) {
            if (l.fromMacro) continue;
            if (LOOP_CLASS[l.klass].cls === "busy" || l.infinite) { unbounded++; continue; }
            bounded += (l.iterations?.max ?? 1) * Math.max(1, (l.callsInBody ?? []).length);
          }
        }
        return { calls, bounded, unbounded };
      };
      const seq = (main.length ? main : segments).map((p) => {
        const w = segWork(p);
        const wait = p.exit ? ptDuration(reg.id, p.exit.wait.line) : null; // 有标称延时的是 sleep，null 是纯 yield
        return { calls: Math.max(1, w.calls + w.bounded), rawCalls: w.calls, bounded: w.bounded, unbounded: w.unbounded, wait, callee: p.exit?.wait.callee ?? null };
      });
      // 延时实参：画布上跟在任务名后面的绿标签，点它跳到那一行
      const delays = [];
      for (const b of rm.evidence?.blockingCalls ?? []) {
        if (!b.duration) continue;
        const key = `${b.duration.value}@${b.location?.path}:${b.location?.line}`;
        if (delays.some((d) => d.key === key)) continue;
        delays.push({ key, callee: b.callee, value: b.duration.value, unit: b.duration.unit, argument: b.duration.argument, resolvedFrom: b.duration.resolvedFrom, path: b.location?.path, line: b.location?.line });
      }
      return { id: reg.id, unitId: reg.unitId, delays, mode: rm.mode ?? "unknown", period: rm.periodMs ?? null, steps, bounded, unbounded, segments, seq, alt: segments.length - main.length, always: rm.mode === "busy-poll", order: idx < 0 ? null : idx + 1, work: steps + bounded, machines: [] };
    }).sort((x, y) => (x.order ?? 999) - (y.order ?? 999) || fname(x.id).localeCompare(fname(y.id)));
    const periods = rows.filter((r) => r.period != null).map((r) => r.period);
    const lcm = periods.length ? periods.reduce((p, q) => (p * q) / gcd2(p, q), 1) : 0;
    // 一圈的成本：每个任务都要被访问一次，到期的跑一整轮、没到期的只查一下定时器（CHECK 步）
    const CHECK = 1;
    const roundCost = (fired) => rows.reduce((n, r) => n + (r.always || fired.has(r.id) ? r.work : CHECK), 0);
    return { rows, lcm, minPeriod: periods.length ? Math.min(...periods) : null, CHECK, roundCost, unplaced: rows.filter((r) => r.order == null), sched: F.scheduling ?? "unknown" };
  }
  // tick 周期：代码里读到的优先，读不到才退回 profile 声明值
  function beatTick() {
    const facts = F.timeBase ?? [];
    const fromCode = facts.find((x) => x.kind === "systick" && x.value != null && x.basis !== "declared");
    if (fromCode) return { ms: fromCode.value, basis: "code", fact: fromCode };
    return { ms: F.tickMs ?? 1, basis: "declared", fact: facts.find((x) => x.kind === "systick") ?? null };
  }
  const fmtMs = (ms) => (ms >= 1000 ? `${+(ms / 1000).toFixed(3)} s` : `${+ms.toFixed(ms < 10 ? 1 : 0)} ms`);
  // 事实条：一个通用标签一个值，有出处的可点跳源码；取不到值的不出现
  function beatFacts(M) {
    const facts = F.timeBase ?? [];
    const of = (kind) => facts.filter((x) => x.kind === kind);
    const chip = (label, value, fact) => {
      if (value == null) return "";
      const path = fact?.location?.path, line = fact?.location?.line;
      const body = `<i>${label}</i><b>${value}</b>`;
      return path ? `<a class="bf" href="${esc(codeHref(path, line))}">${body}<u>${esc(String(path).split("/").pop())}:${line}</u></a>` : `<span class="bf">${body}</span>`;
    };
    const suspends = (F.taskControls ?? []).filter((c) => c.kind === "suspend");
    const clock = of("core-clock")[0];
    // 主频这条事实引擎没给出处：它是个全局变量，定义位置在变量事实里
    const clockDef = clock ? F.globals.find((g) => g.name === clock.name)?.definition : null;
    const clockAt = clock && clockDef ? { location: clockDef } : clock;
    // 调度模型来自 profile 的 scheduling，代码侧的证据是让这条规则命中的注册点
    const reg = E.registrations.find((x) => x.kind === "task" && x.registrars?.length);
    const regAt = reg ? { location: { path: fnById.get(reg.registrars[0].id)?.file, line: reg.registrars[0].line } } : null;
    const ticks = of("systick");
    const counter = of("tick-counter")[0];
    const waits = of("timeout-loop");
    const steps = M.rows.map((r) => r.seq.reduce((n, x) => n + x.calls, 0));
    const busy = M.rows.filter((r) => r.always).reduce((n, r) => n + r.unbounded, 0);
    return `<div class="beat-facts">
      ${chip(`scheduling${reg?.rule ? ` · ${esc(reg.rule)}` : ""}`, M.sched === "unknown" ? null : esc(M.sched), regAt)}
      ${chip(clock ? esc(clock.name) : "SystemCoreClock", clock?.value ? (clock.value >= 1e6 ? `${+(clock.value / 1e6).toFixed(3)} MHz` : `${clock.value} Hz`) : null, clockAt)}
      ${chip(ticks[0] ? esc(ticks[0].name) : "tick_ms", ticks[0]?.value != null ? fmtMs(ticks[0].value) : F.tickMs != null ? fmtMs(F.tickMs) : null, ticks[0])}
      ${chip("计时基准", counter ? `<code>${esc(counter.name)}</code>` : null, counter)}
      ${waits.length === 1 ? chip("超时上界", waits[0].value != null ? `${waits[0].value} tick` : null, waits[0]) : waits.length > 1 ? chip("超时循环", String(waits.length), waits[0]) : ""}
      ${suspends.length ? chip("可被挂起的任务", String(new Set(suspends.map((c) => c.targetUnit ?? c.argument)).size), { location: suspends[0].location }) : ""}
      ${chip("最小周期", M.minPeriod != null ? `${M.minPeriod} ms` : null, null)}
      ${chip("一轮步数", steps.length ? `${Math.min(...steps)}–${Math.max(...steps)}` : null, null)}
      ${chip("超周期", M.lcm ? (M.lcm >= 1000 ? `${M.lcm / 1000} s` : `${M.lcm} ms`) : null, null)}
      ${busy ? `<span class="bf bad"><i>每圈必跑·无界忙等</i><b>${busy}</b></span>` : ""}
    </div>`;
  }
  // 执行单元之间的数据依赖（引擎 dataDependencies）：写方 → 读方 · 变量 · 顺序。顺序码的固定对应：
  // same-round 同轮 / next-round 跨轮 / async 异步 / preemptive 抢占 / main main 上下文 / unknown-order 顺序未知。放在这一页是因为轮询顺序在这
  function beatDataDeps() {
    const ORDER = { "same-round": "同轮", "next-round": "跨轮", async: "异步", preemptive: "抢占", main: "main 上下文", "unknown-order": "顺序未知" };
    const rank = { "next-round": 0, "unknown-order": 1, async: 2, preemptive: 3, "same-round": 4, main: 5 };
    const regionUnits = new Set((F.entries?.units ?? []).map((u) => u.id));
    const dd = (F.dataDependencies ?? []).filter((d) => regionUnits.has(d.from) || regionUnits.has(d.to));
    if (!dd.length) return "";
    const count = {}; for (const d of dd) count[d.order] = (count[d.order] ?? 0) + 1;
    const rows = dd.slice().sort((x, y) => (rank[x.order] ?? 9) - (rank[y.order] ?? 9) || x.name.localeCompare(y.name));
    const unitLabel = (id) => `<span class="pill ${id.startsWith("isr:") ? "isr" : id.startsWith("task:") ? "task" : ""}">${{ isr: "中断", task: "任务", callback: "回调", main: "main", timer: "定时" }[id.split(":")[0]] ?? id.split(":")[0]}</span> ${esc(id.split(":").slice(1).join(":"))}`;
    const posTag = (p) => p == null ? "" : `<span class="sub">#${p + 1}</span>`;
    const link = (file, line) => `<a class="sg-line" href="${esc(codeHref(file, line))}">${esc(String(file).split("/").pop())}${line ? `:${line}` : ""}</a>`;
    const table = `<table class="dp-table"><tr><th>写方</th><th>读方</th><th>变量</th><th>顺序</th><th class="num">写 / 读</th><th></th></tr>${rows.slice(0, 400).map((d) => `<tr class="dd-${esc(d.order)}"><td>${unitLabel(d.from)} ${posTag(d.fromPosition)}</td><td>${unitLabel(d.to)} ${posTag(d.toPosition)}</td><td><code>${esc(d.name)}</code>${d.variable ? ` ${link(String(d.variable).split(":")[1], Number(String(d.variable).split(":")[2]))}` : ""}</td><td><b>${ORDER[d.order] ?? esc(d.order)}</b></td><td class="num">${d.writes} / ${d.reads}</td><td class="sub">${d.volatile ? "volatile" : ""}${d.atomicity && d.atomicity !== "unknown" ? ` · ${esc(d.atomicity)}` : ""}${d.derived ? " · 含一步推导访问" : ""}</td></tr>`).join("")}</table>${rows.length > 400 ? `<p class="sub">只列前 400 条（按顺序类别：跨轮 → 顺序未知 → 异步 → 抢占 → 同轮 → main 上下文），合计见标题。</p>` : ""}`;
    const polling = (F.pollingOrder ?? []).length ? `<p class="sub">轮询顺序（引擎：从 main 深搜、按调用行序遇到的注册）：${(F.pollingOrder ?? []).map((u, i) => `#${i + 1} <code>${esc(u.split(":").slice(1).join(":"))}</code>`).join(" → ")}</p>` : "";
    return `<details class="dp-more"><summary><b>数据依赖（执行单元之间）</b> <span class="sub">${dd.length} 条 · ${Object.entries(count).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${ORDER[k] ?? k} ${n}`).join(" · ")}</span></summary>${polling}${table}</details>`;
  }
  function renderBeat() {
    const panel = $("panel-beat");
    if (!A.present) { panel.innerHTML = `<div class="entries"><p class="cmp-note">当前事实没有 AST 层字段，需要 ArchCheck ≥ 0.4.1。</p></div>`; return; }
    if (!beat.presetDone) { beat.presetDone = true; const w = /bms=(\d+)/.exec(location.hash); if (w) beat.span = Number(w[1]); }
    const M = beatModel();
    if (M.sched === "preemptive") {
      panel.innerHTML = `<div class="entries"><p class="cmp-note">profile 的 <code>scheduling: preemptive</code> · 该调度模型的画法未实现</p></div>`;
      return;
    }
    const T = beatTick();
    const tick = T.ms;
    const LBL = 236, ROW = 18, PAD = 12, HEAD = 34, ISR = 22, RPAD = 24, CELL = 7;
    const rowsH = M.rows.length * ROW;
    // 画布永远是一页宽：宽度由容器给定，缩放只改时间轴的跨度
    const vpNow = panel.querySelector(".beat-vp");
    const W = Math.max(720, vpNow ? vpNow.clientWidth : Math.max(0, panel.clientWidth - 34));
    const plotW = W - LBL - RPAD;
    const total = M.lcm || 200;                       // 超周期：时间轴全长
    if (beat.span == null) beat.span = total;
    beat.span = Math.max(4, Math.min(total, beat.span));
    beat.t0 = Math.max(0, Math.min(beat.t0, total - beat.span));
    const span = beat.span, t0 = beat.t0, t1 = t0 + span;
    const PXMS = plotW / span;
    const H = PAD + HEAD + ISR + rowsH + PAD;
    const mx = (ms) => LBL + (ms - t0) * PXMS;
    // 可被挂起：调度器 status 判断会整个跳过它，所以它不一定每圈都在
    const suspendMark = (row, y) => {
      const hit = (F.taskControls ?? []).find((c) => c.kind === "suspend" && c.target === row.id);
      if (!hit) return "";
      const x = PAD + (String(row.order ?? "–").length + 2 + short(fname(row.id), 16).length) * 6.02 + 5;
      return `<a class="beat-susp" href="${esc(codeHref(hit.location?.path, hit.location?.line))}"><title>${esc(hit.callee)} · ${esc(String(hit.location?.path ?? "").split("/").pop())}:${hit.location?.line}</title><text x="${x}" y="${y + 12}">挂</text></a>`;
    };
    // 延时实参标签：右对齐贴在名字后面，链到源码行
    const delayChips = (row, y) => {
      const list = (row.delays ?? []).slice(0, 4);
      if (!list.length) return `<text class="beat-per" x="${LBL - 6}" y="${y + 12}" text-anchor="end">${row.always ? "每圈" : "?"}</text>`;
      let out = "", x = LBL - 6;
      for (let i = list.length - 1; i >= 0; i--) {
        const d = list[i];
        const label = d.value == null ? "运行期" : d.value >= 1000 ? `${d.value / 1000}s` : `${d.value}${d.unit === "ms" ? "ms" : ""}`;
        const w = 9 + label.length * 6.4;
        x -= w;
        out = `<a class="beat-chip" href="${esc(codeHref(d.path, d.line))}"><title>${esc(d.callee)}(${esc(String(d.argument))})${d.resolvedFrom ? ` → ${esc(d.resolvedFrom)}` : ""} · ${esc(String(d.path ?? "").split("/").pop())}:${d.line}</title><rect x="${x}" y="${y + 2}" width="${w}" height="${ROW - 6}" rx="3"></rect><text x="${x + w / 2}" y="${y + 11.5}" text-anchor="middle">${esc(label)}</text></a>` + out;
        x -= 3;
      }
      return out;
    };
    let g = "";
    // 刻度：跨度变了就换一档，标签间距不小于 60 px
    const stepMs = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((v) => v * PXMS >= 60) ?? 10000;
    const gridTop = PAD + HEAD + ISR;
    for (let t = Math.ceil(t0 / stepMs) * stepMs; t <= t1 + 0.001; t += stepMs) g += `<line class="beat-tickline" x1="${mx(t)}" y1="${gridTop - 12}" x2="${mx(t)}" y2="${gridTop + rowsH}"></line><text class="beat-tick" x="${mx(t)}" y="${gridTop - 16}" text-anchor="middle">${t} ms</text>`;
    g += `<text class="beat-h" x="${PAD}" y="${PAD + 10}">到期时刻 = sleep 实参 × tick ${tick} ms · 横向错开 = 申请顺序 · 左右滚动缩放尺度</text>`;
    // 中断：能在任意点插入，位置静态不可知，所以只占一条带
    const isrs = E.isrs.filter((i) => !i.kernel && (calleesOf.get(i.id) ?? []).length);
    g += `<rect class="beat-isrband" x="${LBL}" y="${PAD + 16}" width="${plotW}" height="${ISR - 12}"></rect><text class="beat-isrt" x="${LBL + 4}" y="${PAD + 27}">中断 ${isrs.length} · 位置静态不可知</text>`;
    const kind = (row) => (row.unbounded ? "unbounded" : "run");
    M.rows.forEach((row, i) => {
      const y = gridTop + i * ROW;
      const dx = ((row.order ?? M.rows.length) - 1) * CELL;   // 申请顺序 = 被 thread_run 轮询的顺序
      g += `<g class="beat-row ${beat.sel === row.id ? "sel" : ""}" data-fn="${esc(row.id)}" style="cursor:pointer"><title>${esc(fname(row.id))}</title><text class="beat-name" x="${PAD}" y="${y + 12}">${row.order ?? "–"}. ${esc(short(fname(row.id), 16))}</text></g>${suspendMark(row, y)}${delayChips(row, y)}`;
      g += `<line class="beat-lane" x1="${LBL}" y1="${y + ROW - 1}" x2="${mx(t1)}" y2="${y + ROW - 1}"></line>`;
      const right = LBL + plotW;
      // 一轮 = 被让出点切开的若干段，一段一格；格后那道竖线就是让出（实线 = sleep，虚线 = 纯 yield）
      const round = (x0, cellW, at, t) => {
        let out = "";
        row.seq.forEach((seg, k) => {
          const x = x0 + k * cellW;
          if (x >= right) return;
          const w = Math.max(1.5, Math.min(cellW - 1.6, right - x));
          out += `<rect class="beat-slot ${seg.unbounded ? "unbounded" : "run"}" x="${x}" y="${y + 3}" width="${w}" height="${ROW - 7}"><title>${t == null ? "" : `t = ${t} ms · `}段 ${k + 1}/${row.seq.length} · ${seg.calls} 步${seg.wait != null ? ` · ${esc(seg.callee ?? "sleep")} ${seg.wait} ms` : ` · ${esc(seg.callee ?? "yield")}`}</title></rect>`;
          if (x + w + 1.2 < right) out += `<line class="beat-yield ${seg.wait != null ? "sleep" : ""}" x1="${x + w + 0.8}" y1="${y + 2}" x2="${x + w + 0.8}" y2="${y + ROW - 4}"></line>`;
        });
        if (at != null && x0 > at) out += `<line class="beat-lead" x1="${at}" y1="${y + ROW / 2}" x2="${x0}" y2="${y + ROW / 2}"></line>`;
        return out;
      };
      // 整条带从自己的第一格开始，不从画布左边开始
      const band = (from, note) => `<rect class="beat-band ${kind(row)}" x="${from}" y="${y + 3}" width="${Math.max(2, right - from)}" height="${ROW - 7}">${note}</rect>`;
      if (row.always) { g += band(LBL + dx, "") + round(LBL + dx, CELL, null, null); return; }
      if (row.period == null) { g += `<text class="beat-dense-t" x="${LBL + 4}" y="${y + 12}">周期未知</text>`; return; }
      const first = Math.ceil(t0 / row.period) * row.period;
      if (row.period * PXMS < 3) { g += band(Math.max(LBL, mx(first) + dx), `<title>${row.period} ms</title>`); return; }
      // 段挤不进一个周期时把格压窄，宁可窄也不让相邻两轮叠在一起
      const cellW = Math.min(CELL, Math.max(2, (row.period * PXMS) / row.seq.length));
      for (let t = first; t <= t1; t += row.period) {
        const at = mx(t), x = at + dx;
        if (x > right) continue;
        g += round(x, cellW, at, t);
      }
    });
    const canvas = `<svg id="beat-canvas" class="fsm-svg beat" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" style="width:${W}px;height:${H}px">${g}</svg>`;
    const keepY = panel.scrollTop, keepVp = vpNow ? vpNow.scrollTop : 0;
    panel.innerHTML = `<div class="entries">${beatFacts(M)}
      <div class="seq-tools s1-tools"><span class="sub">${fmtMs(t0)} – ${fmtMs(t1)} · 跨度 ${fmtMs(span)}</span><span class="beat-key"><i class="run"></i>会跑<i class="unb"></i>无界忙等<i class="band"></i>每圈必跑<i class="yield"></i>让出（实线 sleep / 虚线 yield）<i class="cell"></i>一格 = 一段（理想化）</span><span style="flex:1"></span><button id="beat-reset">${fmtMs(total)}</button></div>
      <div class="beat-vp" id="beat-vp-ms"><div class="beat-inner">${canvas}</div></div>
      ${beatDataDeps()}`;
    const vp = $("beat-vp-ms");
    panel.scrollTop = keepY; vp.scrollTop = keepVp;
    // 左右滚动（水平滚轮 / shift+滚轮 / 触控板横扫）= 缩放尺度，左边不动；纵向滚动交回页面
    vp.addEventListener("wheel", (event) => {
      const dx = event.shiftKey ? event.deltaY : event.deltaX;
      if (Math.abs(dx) <= Math.abs(event.shiftKey ? 0 : event.deltaY)) return;
      event.preventDefault();
      beat.span = Math.max(4, Math.min(total, span * (dx > 0 ? 1 / 1.15 : 1.15)));
      renderBeat();
    }, { passive: false });
    vp.addEventListener("pointerdown", (event) => { beat.drag = { x: event.clientX, from: t0, per: PXMS, moved: false }; });
    if (!beat.wired) {
      beat.wired = true;
      window.addEventListener("pointermove", (event) => {
        const d = beat.drag;
        if (!d || state.tab !== "beat") return;
        if (Math.abs(event.clientX - d.x) < 3) return;
        d.moved = true;
        beat.t0 = d.from - (event.clientX - d.x) / d.per;
        renderBeat();
      });
      window.addEventListener("pointerup", () => { if (beat.drag) setTimeout(() => { beat.drag = null; }, 0); });
      window.addEventListener("resize", () => { if (state.tab === "beat") renderBeat(); });
    }
    panel.querySelectorAll("[data-fn]").forEach((el) => el.addEventListener("click", () => { if (beat.drag?.moved) return; beat.sel = el.dataset.fn; seq.root = el.dataset.fn; seq.level = "unit"; paths.open.clear(); switchTab("seq"); }));
    $("beat-reset")?.addEventListener("click", () => { beat.t0 = 0; beat.span = total; renderBeat(); });
    if (!aside.querySelector("#fn-search")) showEntriesStart();
  }
