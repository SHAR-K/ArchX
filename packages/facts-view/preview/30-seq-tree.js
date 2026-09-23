  // ---- 一轮 = 一列一列往右：框、出口、框、出口。
  //      第 1 列就是这个任务函数本身的一整轮（一个框），让出点是框里的一行，不再把框切成"段"。
  //      框在**长出子循环的那一行**裂开，子循环从这道缝里向右展开；再深的循环同理，逐层往右。
  //      段里的调用链一直展开，直到走到"体内有循环"的那个函数；只保留通向循环的分支，其余不展开。
  //      那个函数成为第 2 列的一个框：框头是函数名，框里第一行是 while / for 本身，然后是循环体内的调用（同样一直展开）。
  //      框右边是这个循环的出口：条件不成立 / break / return / 体内的让出。再深的循环进第 3 列。
  const paths = { depth: 4, selected: null, open: new Set(), openAll: false, presetDone: false }; // open: 展开了调用链的那些行
  const ptKey = (l) => `${l.function}:${l.location.line}`;
  const PT_CALL_DEPTH = 7; // 调用链最多展开这么多跳（只沿通向循环的分支）
  function ptSteps(fnId, from, to) {
    const steps = seq1Steps(fnId, from, to);
    const out = []; let cur = { steps: [] };
    for (const st of steps) {
      if (st.type === "wait") {
        if (!st.depth) { cur.exit = { type: "yield", wait: st }; out.push(cur); cur = { steps: [] }; }
        else out.push({ steps: cur.steps.slice(), exit: { type: "yield", wait: st, cond: true }, early: true });
        continue;
      }
      cur.steps.push(st);
    }
    out.push(cur);
    return out.filter((p) => p.steps.length || p.exit);
  }
  const ptDuration = (rootId, line) => { const rm = A.runModes[regById.get(rootId)?.unitId]; const d = rm?.evidence?.blockingCalls?.find((x) => x.location?.line === line)?.duration; if (!d || d.value == null) return null; const f = { ms: 1, us: 0.001, s: 1000, tick: 1 }[d.unit ?? "ms"] ?? 1; return Math.round(d.value * f * 1000) / 1000; };
  function ptFinalExits(l) {
    const out = [];
    if (l) {
      if (l.infinite !== true) out.push({ type: "cond", text: loopCond(l) });
      for (const e of l.exits ?? []) out.push({ type: e.kind, line: e.line });
      if (!out.length) out.push({ type: "none" });
    } else out.push({ type: "loopback" });
    return out;
  }
  const ptTopLoops = (fnId) => {
    const t = fnById.get(fnId);
    if (!t || t.external || !isRegionFnId(fnId) || !t.endLine) return { all: [], top: [] };
    const all = (loopsByFn.get(fnId) ?? []).filter((l) => l.location.line >= t.line && l.location.line <= t.endLine && !l.fromMacro);
    const top = all.filter((l) => !all.some((o) => o !== l && o.location.line < l.location.line && l.endLine <= o.endLine));
    return { all, top };
  };
  // 从一次调用往下展开：只保留自己有循环、或下面有循环的分支
  function ptChain(target, chain, budget) {
    const t = fnById.get(target);
    if (!t || t.external || !isRegionFnId(target) || !t.endLine || chain.includes(target) || budget <= 0) return null;
    const { top } = ptTopLoops(target);
    const mine = top.map((l) => ({ ...l, klass: loopClass(l), timeout: loopTimeout(l) })).filter((l) => seq2.showIter || l.klass !== "iter");
    const inTop = (line) => top.some((l) => line >= l.location.line && line <= l.endLine);
    const children = []; const seen = new Set();
    for (const c of (calleesOf.get(target) ?? []).slice().sort((x, y) => (x.line ?? 0) - (y.line ?? 0))) {
      if (c.line == null || c.line < t.line || c.line > t.endLine || inTop(c.line) || seen.has(c.t)) continue;
      seen.add(c.t);
      const sub = ptChain(c.t, [...chain, target], budget - 1);
      if (sub) children.push({ ...sub, line: c.line });
    }
    if (!mine.length && !children.length) return null;
    return { target, loops: mine, children };
  }

  function ptBuildLevels(rootId, fnId, from, to) {
    const levels = [];
    let badgeSeq = 0;
    const nextBadge = () => { const n = badgeSeq++; return String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26)) : ""); };
    const badgeOf = new Map(); // 同一个循环被多条路径走到时只出一个框，共用一个角标
    let queue = [{ fnId, from, to, loop: null, chain: [rootId], badge: null }];
    for (let depth = 0; depth <= paths.depth && queue.length; depth++) {
      const boxes = []; const next = [];
      for (const item of queue) {
        {
          const rows = []; const spawns = [];
          const scope = `${rootId}|${depth}|${item.badge ?? "root"}`;
          const attach = (loops, rowKey, chain) => loops.map((l) => {
            const key = ptKey(l);
            const known = badgeOf.get(key);
            if (known) return { loop: l, badge: known };
            const badge = nextBadge();
            badgeOf.set(key, badge);
            spawns.push({ loop: l, badge, rowKey });
            next.push({ fnId: l.function, from: l.location.line, to: l.endLine, loop: l, chain: [...chain, l.function], badge, spawnKey: rowKey });
            return { loop: l, badge };
          });
          const walk = (node, ind, chain, ancestors) => {
            // key 必须带上父 key：同一条调用链会从多个入口重复出现，只用 目标:行:深度 会撞
            const key = `${ancestors.at(-1) ?? "^"}>${node.target}:${node.line ?? 0}`;
            rows.push({ type: "chain", target: node.target, line: node.line, ind, badges: attach(node.loops, key, chain), key, ancestors });
            for (const c of node.children) walk(c, ind + 1, [...chain, node.target], [...ancestors, key]);
          };
          for (const st of seq1Steps(item.fnId, item.from, item.to)) {
            // 让出点不再切开框，它就是框里的一行
            if (st.type === "wait") { rows.push({ type: "yield", st, ind: st.depth ?? 0, badges: [], key: `yield:${st.fn}:${st.line}`, ancestors: [] }); continue; }
            if (st.type === "frame-open") {
              const own = st.loop && !st.loop.fromMacro && (seq2.showIter || loopClass(st.loop) !== "iter") ? [{ ...st.loop, klass: loopClass(st.loop), timeout: loopTimeout(st.loop) }] : [];
              const key = `frame:${st.fn}:${st.line}`;
              rows.push({ type: "frame", st, ind: st.depth ?? 0, badges: attach(own, key, item.chain), key, ancestors: [] });
              continue;
            }
            if (st.type !== "call" && st.type !== "self") continue;
            const target = st.type === "self" ? item.fnId : st.target;
            const chained = st.type === "call" ? ptChain(target, item.chain, PT_CALL_DEPTH) : null;
            const key = `${target}:${st.line}`;
            rows.push({ type: "step", st, target, ind: st.depth ?? 0, badges: attach(chained?.loops ?? [], key, item.chain), key, ancestors: [] });
            for (const c of chained?.children ?? []) walk(c, (st.depth ?? 0) + 1, [...item.chain, target], [key]);
          }
          boxes.push({ depth, loop: item.loop, badge: item.badge, fnId: item.fnId, rootId, scope, spawnKey: item.spawnKey ?? null, exits: ptFinalExits(item.loop), rows, spawns });
        }
      }
      levels.push(boxes);
      queue = next;
    }
    return levels;
  }

  // 行上只按类型计数（⛔ 忙等 / ⟲ 让出等待 / ∞ 内层无限 / ↻ 遍历）；右边那组循环对齐在这一行的高度上，字母角标留给框头
  const PT_GLYPH = { busy: "⛔", wait: "⟲", iter: "↻", main: "∞" };
  const ptBadges = (badges) => {
    const counts = new Map();
    for (const x of badges) { const cls = x.loop.klass === "inner-infinite" ? "main" : LOOP_CLASS[x.loop.klass].cls; counts.set(cls, (counts.get(cls) ?? 0) + 1); }
    return ["busy", "main", "wait", "iter"].filter((cls) => counts.has(cls)).map((cls) => `<span class="pt-badge ${cls === "main" ? "busy" : cls}">${PT_GLYPH[cls]}${counts.get(cls)}</span>`).join("");
  };
  function ptRow(row, box, fold, layout) {
    const ind = layout?.ind ?? row.ind;
    const slot = layout?.cont ? `<span class="pt-fold-gap cont"></span>` : `<span class="pt-fold-gap"></span>`;
    const mark = layout?.invStart != null ? `<span class="pt-inv-mark" title="第 ${layout.invStart + 1} 次被调度">${String.fromCharCode(0x2460 + Math.min(19, layout.invStart))}</span>` : "";
    const toggle = fold && fold.count ? `<button class="pt-fold" data-fold="${esc(`${box.scope}|${row.key}`)}" title="它下面一共 ${fold.depth} 层调用链。${fold.open ? "折叠" : "展开"}：单条路径一直展到底，遇到岔路停在那一层">${fold.open ? "▾" : "▸"}<small>${fold.depth}</small></button>` : slot;
    if (row.type === "yield") {
      const st = row.st, ms = ptDuration(box.rootId, st.line);
      // 让出 = 记住行号然后 return：这一行以下的代码要等**下一次调用**才跑到
      const lost = (F.yieldLocals ?? []).filter((x) => x.function === box.fnId && x.yieldedAt?.line === st.line);
      return `<div class="pt-row yieldrow">${mark}<span class="brk wait">⏸ ${esc(st.callee)}</span>${ms != null ? `<b>${ms} ms</b>` : ""}<span class="sub">${esc(st.kind)}</span><a class="sg-line" href="${esc(codeHref(fnById.get(st.fn)?.file, st.line))}">${st.line}</a><span class="pt-ret">↩ return</span><span class="pt-cut"></span><span class="pt-inv">→ 第 ${(layout?.inv ?? 0) + 2} 次调用</span>${lost.map((x) => `<a class="pt-lost" href="${esc(codeHref(x.readAt?.path, x.readAt?.line))}" title="${esc(x.variable)}：写于 ${x.writtenAt?.line}，让出后在 ${x.readAt?.line} 读，非 static 局部不跨让出保留">⚠ ${esc(x.variable)}</a>`).join("")}</div>`;
    }
    if (row.type === "frame") { const st = row.st; return `<div class="pt-row frame" style="--d:${ind}">${mark}<span class="brk ${st.kind}">${esc(st.kind === "loop" ? "loop" : st.kind)}</span><span class="pt-cond">${esc(short(st.label, 42))}</span>${ptBadges(row.badges)}<a class="sg-line" href="${esc(codeHref(fnById.get(st.fn)?.file, st.line))}">${st.line}</a></div>`; }
    const st = row.st; const target = row.target;
    const t = fnById.get(target);
    const mod = row.type === "step" && st.type === "self" ? "本函数" : t?.external ? "lib" : fmodule(target).split("/").pop();
    const vars = row.type === "step" ? seq1Vars(st) : [];
    const r = vars.filter((v) => !v.write).length, w = vars.filter((v) => v.write).length, warn = vars.filter((v) => (v.conflict || v.isrWriters.length) && !v.inCritical).length;
    const line = row.type === "step" ? st.line : row.line;
    const fromFn = row.type === "step" ? st.fn : null;
    const key = `${box.rootId}|${target}:${line}`;
    const yields = row.type === "step" ? (st.summary?.yields ?? []) : [];
    return `<div class="pt-row ${row.type === "chain" ? "deep" : ""} ${row.type === "step" && st.inCritical ? "crit" : ""} ${paths.selected === key ? "sel" : ""} ${layout?.cont ? "cont" : ""}" data-key="${esc(key)}" style="--d:${ind}">${mark}${toggle}<span class="s1-mod" style="background:${mod === "本函数" ? "#334155" : mod === "lib" ? "#64748b" : modColor(fmodule(target))}">${esc(short(mod, 12))}</span><span class="s1-name" data-fn="${esc(target)}" title="${esc(floc(target))}">${esc(fname(target))}</span>${yields.length ? `<span class="brk wait" title="函数体内有阻塞点">⏸</span>` : ""}${row.type === "step" && st.inCritical ? `<span class="brk crit">🔒</span>` : ""}${ptBadges(fold && !fold.open ? fold.badges : row.badges)}<span class="s1-counts">${r ? `<span class="s1-cnt r">R${r}</span>` : ""}${w ? `<span class="s1-cnt w">W${w}</span>` : ""}${warn ? `<span class="s1-cnt warn">⚠${warn}</span>` : ""}</span><a class="sg-line" href="${esc(codeHref(fnById.get(fromFn ?? target)?.file, line))}">${line}</a></div>`;
  }
  function ptExit(e, box) {
    if (e.type === "yield") { const w = e.wait; const ms = ptDuration(box.rootId, w.line); return `<div class="pt-exit yield ${e.cond ? "cond" : ""}" title="${esc(w.callee)}（${esc(w.kind)}）${e.cond ? " · 分支内，走到才让出" : ""}${ms != null ? ` · 标称 ${ms} ms（延时实参，不是实测）` : " · 时长未知，取决于其他任务"} · ${esc(fname(w.fn))}:${w.line}"><span class="brk wait">⏸</span><code>${esc(w.callee)}</code>${ms != null ? `<b>${ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}</b>` : ""}<a class="sg-line" href="${esc(codeHref(fnById.get(w.fn)?.file, w.line))}">${w.line}</a></div>`; }
    if (e.type === "loopback") return `<div class="pt-exit back" title="一轮结束，回到循环开头">↺ 下一轮</div>`;
    if (e.type === "cond") return `<div class="pt-exit cond" title="条件不成立时退出：${esc(e.text || "")}">条件不成立</div>`;
    if (e.type === "none") return `<div class="pt-exit none" title="无限循环，没有条件出口，只能靠让出 / 中断">无出口</div>`;
    return `<div class="pt-exit ${e.type}" title="${esc(e.type)} 在 ${esc(fname(box.fnId))}:${e.line}"><span class="brk ${e.type === "return" ? "fn" : "case"}">${esc(e.type)}</span><a class="sg-line" href="${esc(codeHref(fnById.get(box.fnId)?.file, e.line))}">${e.line}</a></div>`;
  }
  const ptFragScope = new Map(); // 长出子循环的那一行 -> 它所在的那一片，供下一层认父
  function ptBox(box) {
    const l = box.loop;
    const cls = l ? LOOP_CLASS[l.klass].cls : "main";
    const calls = box.rows.filter((x) => x.type === "step").length; // 直接调用点；展开出来的调用链行不算，让出行不算
    const mod = l ? fmodule(l.function).split("/").pop() : null;
    const head = l
      ? `<div class="pt-box-head ${cls}"><span class="pt-badge ${cls}">${esc(box.badge ?? "")}</span><span class="s1-mod" style="background:${modColor(fmodule(l.function))}">${esc(short(mod, 12))}</span><span class="pt-fn" data-fn="${esc(l.function)}">${esc(fname(l.function))}</span><span class="pt-where">${calls} 个调用</span></div>`
      : `<div class="pt-box-head main"><b>${esc(fname(box.fnId))}</b><span class="pt-sched">一轮 = ${(() => { const y = box.rows.filter((x) => x.type === "yield"); const must = y.filter((x) => !(x.st.depth ?? 0)).length; return must === y.length ? `${y.length + 1}` : `${must + 1}–${y.length + 1}`; })()} 次调度</span><span class="sub">${calls} 个调用 · ${box.rows.filter((x) => x.type === "yield").length} 个让出点${box.rows.some((x) => x.type === "yield" && (x.st.depth ?? 0)) ? `（${box.rows.filter((x) => x.type === "yield" && (x.st.depth ?? 0)).length} 个在分支里）` : ""}</span>${(F.taskControls ?? []).filter((c) => c.target === box.fnId && c.kind === "suspend").map((c) => `<a class="brk wait" href="${esc(codeHref(c.location?.path, c.location?.line))}" title="${esc(c.callee)} · ${esc(String(c.location?.path ?? "").split("/").pop())}:${c.location?.line}">可被挂起</a>`).slice(0, 1).join("")}</div>`;
    if (l && calls === 0) {
      const parentScope = box.spawnKey ? ptFragScope.get(box.spawnKey) : null;
      const exitText = (box.exits ?? []).map((e) => e.type === "cond" ? "条件不成立" : e.type === "none" ? "无出口" : e.type === "yield" ? `⏸ ${e.wait?.callee ?? "yield"}` : `${e.type}${e.line ? ` ${e.line}` : ""}`).join(" · ");
      return `<div class="pt-line chip" data-box="${esc(`${box.scope}#0`)}" ${parentScope ? `data-parent="${esc(parentScope)}"` : ""}><div class="pt-chip ${cls}" data-loop="${esc(ptKey(l))}"><span class="pt-badge ${cls}">${esc(box.badge ?? "")}</span><b>${esc(l.kind)}</b><span class="pt-cond">${esc(short(loopCond(l) || "无条件", 56))}</span>${loopTimes(l) ? `<i>${esc(loopTimes(l))}</i>` : ""}<a class="sg-line" href="${esc(codeHref(fnById.get(l.function)?.file, l.location.line))}">${l.location.line}–${l.endLine}</a><span class="pt-chip-exit">${esc(exitText)}</span></div></div>`;
    }
    const loopRow = l
      ? `<div class="pt-loop ${cls}" data-loop="${esc(ptKey(l))}" title="${esc(loopTitle(l))}"><b>${esc(l.kind)}</b> <span class="pt-cond">${esc(short(loopCond(l) || "无条件", 44))}</span>${loopTimes(l) ? `<i>${esc(loopTimes(l))}</i>` : ""}<a class="sg-line" href="${esc(codeHref(fnById.get(l.function)?.file, l.location.line))}">${l.location.line}–${l.endLine}</a></div>`
      : "";
    // 展开规则：点开一行，沿**唯一**的调用路径一路展到底；一遇到岔路（某一行有多个子调用）
    // 就停在那些子调用上，各支要不要再往下由你自己点。
    // gate(行) = 要看到这一行必须先点开的那一行：从父行往上走，只要"父行的父行"只有一个子，就继续往上并入。
    const parentOf = new Map(); const direct = new Map(); const childrenOf = new Map();
    for (const row of box.rows) { const p = (row.ancestors ?? []).at(-1); if (p != null) { parentOf.set(row.key, p); direct.set(p, (direct.get(p) ?? 0) + 1); childrenOf.set(p, [...(childrenOf.get(p) ?? []), row.key]); } }
    // 折叠数字 = 它下面一共有多少层调用链（子树高度），和展开到哪一层无关，所以数字不会变
    const heightCache = new Map();
    const totalDepth = (key) => {
      if (heightCache.has(key)) return heightCache.get(key);
      const kids = childrenOf.get(key) ?? [];
      const h = kids.length ? 1 + Math.max(...kids.map(totalDepth)) : 0;
      heightCache.set(key, h);
      return h;
    };
    const gateCache = new Map();
    const gateOf = (key) => {
      if (gateCache.has(key)) return gateCache.get(key);
      let a = parentOf.get(key) ?? null;
      if (a != null) for (;;) { const p = parentOf.get(a); if (p != null && (direct.get(p) ?? 0) === 1) a = p; else break; }
      gateCache.set(key, a);
      return a;
    };
    const gateChain = (key) => { const out = []; for (let g = gateOf(key); g != null; g = gateOf(g)) out.push(g); return out; };
    const revealCount = new Map();
    for (const row of box.rows) { const g = gateOf(row.key); if (g != null) revealCount.set(g, (revealCount.get(g) ?? 0) + 1); }
    const hidden = new Map(); // 折叠时把子树里的角标聚合到 gate 那一行
    for (const row of box.rows) for (const g of gateChain(row.key)) hidden.set(g, [...(hidden.get(g) ?? []), row]);
    const isOpen = (key) => paths.openAll || paths.open.has(`${box.scope}|${key}`);
    // 单子的直链不再缩进：和父行同一列，用一条小竖线接起来；只有岔路才往右一格
    const dispInd = new Map(); const contRow = new Set();
    for (const row of box.rows) {
      const p = parentOf.get(row.key);
      if (p == null) { dispInd.set(row.key, row.ind); continue; }
      const linear = (direct.get(p) ?? 0) === 1;
      if (linear) contRow.add(row.key);
      dispInd.set(row.key, (dispInd.get(p) ?? 0) + (linear ? 0 : 1));
    }
    // 第几次调用：让出点把一轮切成若干次调用，行归属它所在的那一次
    const invOf = new Map();
    { let n = 0; for (const row of box.rows) { invOf.set(row.key, n); if (row.type === "yield") n += 1; } }
    const visible = box.rows.filter((row) => gateChain(row.key).every(isOpen));
    let lastInv = null;
    const rowHtml = (row) => {
      const count = revealCount.get(row.key) ?? 0;
      const inv = invOf.get(row.key) ?? 0;
      const layout = { ind: dispInd.get(row.key) ?? row.ind, cont: contRow.has(row.key), inv, invStart: inv !== lastInv ? inv : null };
      lastInv = inv;
      if (!count || row.type === "yield") return ptRow(row, box, null, layout);
      const open = isOpen(row.key);
      const badges = []; const seen = new Set();
      for (const b of [...(row.badges ?? []), ...(hidden.get(row.key) ?? []).flatMap((x) => x.badges ?? [])]) if (!seen.has(b.badge)) { seen.add(b.badge); badges.push(b); }
      return ptRow(row, box, { count, depth: totalDepth(row.key), open, badges }, layout);
    };
    // 裂开点：这一行长出了新的子循环框。把行切成若干片，片与片之间留给子循环。
    const spawnKeys = new Set((box.spawns ?? []).map((x) => x.rowKey));
    const frags = [[]];
    for (const row of visible) {
      frags[frags.length - 1].push(row);
      if (spawnKeys.has(row.key)) frags.push([]);
    }
    if (!frags[frags.length - 1].length && frags.length > 1) frags.pop();
    frags.forEach((rows, k) => { for (const row of rows) if (spawnKeys.has(row.key)) ptFragScope.set(row.key, `${box.scope}#${k}`); });
    const parentScope = box.spawnKey ? ptFragScope.get(box.spawnKey) : null;
    return frags.map((rows, k) => {
      const first = k === 0, last = k === frags.length - 1;
      const body = rows.map(rowHtml).join("") || `<div class="sub pt-empty">循环体里没有调用</div>`;
      const exits = last && (box.exits ?? []).length ? `<div class="pt-divider">${box.exits.map((e) => ptExit(e, box)).join("")}</div>` : "";
      return `<div class="pt-line" data-box="${esc(`${box.scope}#${k}`)}" ${first && parentScope ? `data-parent="${esc(parentScope)}"` : ""}><div class="pt-box ${cls} ${first ? "" : "cut-top"} ${last ? "" : "cut-bottom"}">${first ? `${head}${loopRow}` : ""}<div class="pt-box-body">${body}</div></div>${exits}</div>`;
    }).join("");
  }
  function renderSeqUnit(rootId, machine, state) {
    if (!rootId) return "<p>没有可画的入口</p>";
    if (!paths.presetDone) { paths.presetDone = true; const m0 = /pdepth=(\d)/.exec(location.hash); if (m0) paths.depth = Number(m0[1]); if (/pall=1/.test(location.hash)) paths.openAll = true; } // 预置：#tab=seq&pdepth=6
    const stateFn = state ? (state.function ?? machine.function) : null;
    const fnId = state ? stateFn : rootId;
    const range = state ? { from: state.location.line, to: state.endLine } : seqRange(rootId);
    const ml = (loopsByFn.get(rootId) ?? []).map((l) => ({ ...l, klass: loopClass(l) })).find((l) => l.klass === "main");
    const title = state ? `<b>${esc(machine.dispatch)} = ${esc(state.name)}</b> 时的一轮 <span class="pt-where">${esc(fname(stateFn))}:${state.location.line}–${state.endLine}</span>` : ml ? `<b>${esc(ml.kind)} ∞</b> ${esc(fname(rootId))} 的一轮 <span class="pt-where">${ml.location.line}–${ml.endLine}</span>` : `${esc(fname(rootId))} <span class="pt-where">无循环，跑一遍返回</span>`;
    const levels = ptBuildLevels(rootId, fnId, range.from, range.to).filter((boxes) => boxes.length);
    const cols = levels.map((boxes, d) => `<div class="pt-level" data-depth="${d}"><div class="pt-level-head">${d === 0 ? `一轮 · <code>${esc(fname(boxes[0]?.fnId ?? fnId))}</code>` : `第 ${d} 层循环<span class="sub">${boxes.length}</span>`}</div>${boxes.map(ptBox).join("")}</div>`).join("");
    return `<div class="pt-title">${title}</div><div class="pt-scroll"><div class="pt-levels">${cols}</div></div>`;
  }
  // 对齐做两件事，互相牵制：
  //   ① 一组子框的第一个框，顶端对齐它父框的顶端；
  //   ② 父框所在的那一列在它下面**断开**——把下一个兄弟往下推，让整组子框落进这道缝里，
  //      于是"段 1 展开的子循环"不会挤到"段 2"旁边去。
  // 推了兄弟，子组要重新对齐；对齐完又可能要再推，所以来回迭代到不动为止。
  function ptAlign(root) {
    const levels = [...root.querySelectorAll(".pt-level")];
    const lineOf = new Map();
    for (const level of levels) for (const line of level.querySelectorAll(":scope > .pt-line")) lineOf.set(line.dataset.box, line);
    const push = (el, px) => { el.style.marginTop = `${(parseFloat(el.style.marginTop) || 0) + px}px`; };
    for (let pass = 0; pass < 8; pass++) {
      let moved = 0;
      for (let depth = 1; depth < levels.length; depth++) {
        const done = new Set();
        for (const line of levels[depth].querySelectorAll(":scope > .pt-line")) {
          const parent = line.dataset.parent;
          if (!parent || done.has(parent)) continue;
          done.add(parent);
          const box = lineOf.get(parent);
          if (!box) continue;
          const delta = box.getBoundingClientRect().top - line.getBoundingClientRect().top;
          if (delta > 1) { push(line, delta); moved++; }
        }
      }
      for (let depth = levels.length - 1; depth >= 1; depth--) {
        const bottom = new Map();
        for (const line of levels[depth].querySelectorAll(":scope > .pt-line")) {
          const parent = line.dataset.parent;
          if (!parent) continue;
          bottom.set(parent, Math.max(bottom.get(parent) ?? -Infinity, line.getBoundingClientRect().bottom));
        }
        for (const [parent, low] of bottom) {
          const box = lineOf.get(parent);
          const next = box?.nextElementSibling;
          if (!next || !next.classList.contains("pt-line")) continue;
          const gap = low + 8 - next.getBoundingClientRect().top;
          if (gap > 1) { push(next, gap); moved++; }
        }
      }
      if (!moved) break;
    }
    drawBackEdges(root, levels);
  }
  // 回边：一个框（含它裂开的所有片）就是一个循环，最后一片跑完回到第一片的开头。
  // 画在框列最左边，避开右侧的出口栏；跨过中间的缝，顺带说明这些片是同一个循环体。
  function drawBackEdges(root, levels) {
    for (const level of levels) {
      const groups = new Map();
      for (const line of level.querySelectorAll(":scope > .pt-line")) {
        const scope = String(line.dataset.box ?? "").split("#")[0];
        const rect = line.getBoundingClientRect();
        if (line.classList.contains("chip")) continue; // 一行 chip 不画回边，括号比它本身还高
        const group = groups.get(scope) ?? { top: Infinity, bottom: -Infinity, cls: "" };
        group.top = Math.min(group.top, rect.top);
        group.bottom = Math.max(group.bottom, rect.bottom);
        group.cls = line.querySelector(".pt-box")?.classList[1] ?? "";
        groups.set(scope, group);
      }
      const base = level.getBoundingClientRect().top;
      for (const [, group] of groups) {
        if (group.bottom - group.top < 24) continue;
        const edge = document.createElement("div");
        edge.className = `pt-back ${group.cls}`;
        edge.style.top = `${group.top - base}px`;
        edge.style.height = `${group.bottom - group.top}px`;
        edge.innerHTML = `<span>↺ ${level.dataset.depth === "0" ? "下一轮" : "回到开头"}</span>`;
        level.appendChild(edge);
      }
    }
  }
  function wireSeq() {
    for (const root of document.querySelectorAll("#panel-seq .pt-levels")) wireSeqTree(root);
    $("pt-depth")?.addEventListener("change", (e) => { paths.depth = Number(e.target.value); renderSeq(); });
    $("pt-iter")?.addEventListener("change", (e) => { seq2.showIter = e.target.checked; renderSeq(); });
    $("pt-open")?.addEventListener("click", () => { paths.openAll = true; renderSeq(); });
    $("pt-close")?.addEventListener("click", () => { paths.openAll = false; paths.open.clear(); renderSeq(); });
  }
  function wireSeqTree(root) {
    ptAlign(root);
    root.querySelectorAll(".pt-row[data-key]").forEach((el) => el.addEventListener("click", (event) => { if (event.target.closest("a,[data-fn]")) return; paths.selected = el.dataset.key; root.querySelectorAll(".pt-row").forEach((x) => x.classList.toggle("sel", x === el)); }));
    root.querySelectorAll("[data-fn]").forEach((el) => { el.addEventListener("click", (event) => { event.stopPropagation(); showEntry(el.dataset.fn); }); el.addEventListener("dblclick", () => { switchTab("tree"); revealInTree(el.dataset.fn); }); });
    root.querySelectorAll("[data-loop]").forEach((el) => el.addEventListener("click", () => { root.querySelectorAll("[data-loop]").forEach((x) => x.classList.toggle("sel", x === el)); showSeq2Loop(el.dataset.loop); }));
    root.querySelectorAll("[data-fold]").forEach((el) => el.addEventListener("click", (event) => { event.stopPropagation(); const k = el.dataset.fold; if (paths.open.has(k)) paths.open.delete(k); else paths.open.add(k); renderSeq(); }));
  }

  // ---- 时序页：一个调度周期里的任务，按 thread_run 的轮询顺序堆叠。每行是折叠头（顺序、名字、模式与周期、
  //      一轮几次调度、调用数、可达忙等数、可被挂起），点开原地长出这个任务那一轮的树；状态切片跟着任务走。
  //      中断不在轮询序列里，另有「中断」页签。
  function renderSeq() {
    const panel = $("panel-seq");
    if (!A.present) { panel.innerHTML = `<div class="entries"><p class="cmp-note">当前事实没有 AST 层字段，时序图需要 ArchCheck ≥ 0.4.1（loops / resourceAccesses / controlFlow / criticalSections）。</p></div>`; return; }
    if (!seq.presetDone) {
      seq.presetDone = true;
      const m = /pfn=([A-Za-z_]\w*)/.exec(location.hash);
      const target = m ? F.functions.find((f) => f.name === m[1] && f.file.startsWith(F.region)) : null;
      if (target) seq.open.add(target.id);
      if (/seqall=1/.test(location.hash)) for (const r of E.registrations.filter((x) => x.kind === "task")) seq.open.add(r.id);
    }
    // 别的页签跳过来（双击任务 / 状态机的状态）：展开那个任务，带状态的记成它的切片
    if (seq.root) { seq.open.add(seq.root); if (seq.state) seq.states.set(seq.root, seq.state); seq.root = null; seq.state = null; }
    // 申请顺序 = 被 thread_run 轮询的顺序（beatRegisterOrder：从 main 沿调用边按源码行号深度优先），和节拍页同一个
    const order = beatRegisterOrder();
    const tasks = E.registrations.filter((x) => x.kind === "task").map((r) => { const i = order.indexOf(r.id); return { id: r.id, unitId: r.unitId, order: i < 0 ? null : i + 1 }; }).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || fname(a.id).localeCompare(fname(b.id)));
    const placed = tasks.filter((x) => x.order != null).length;
    const facts = (task) => {
      const rm = A.runModes[task.unitId] ?? {};
      const range = seqRange(task.id);
      const steps = seq1Steps(task.id, range.from, range.to);
      const calls = steps.filter((s) => s.type === "call" || s.type === "self").length;
      const waits = steps.filter((s) => s.type === "wait");
      const must = waits.filter((s) => !(s.depth ?? 0)).length;
      const busy = [...reachOf(task.id)].flatMap((f) => loopsByFn.get(f) ?? []).filter((l) => !l.fromMacro && LOOP_CLASS[loopClass(l)].cls === "busy").length;
      const suspend = (F.taskControls ?? []).find((c) => c.kind === "suspend" && c.target === task.id);
      return { rm, calls, sched: must === waits.length ? `${waits.length + 1}` : `${must + 1}–${waits.length + 1}`, busy, suspend, machines: machinesNear(task.id) };
    };
    const head = (task) => {
      const x = facts(task); const open = seq.open.has(task.id); const key = seq.states.get(task.id) ?? "";
      const stateSel = x.machines.length ? `<select class="sq-state" data-task="${esc(task.id)}"><option value="">整个循环体</option>${x.machines.map((m) => m.states.filter((s) => s.endLine).map((s) => `<option value="${esc(`${m.id}|${s.name}`)}" ${`${m.id}|${s.name}` === key ? "selected" : ""}>${esc(m.dispatch)} = ${esc(s.name)}</option>`).join("")).join("")}</select>` : "";
      return `<div class="sq-head" data-toggle="${esc(task.id)}"><span class="s1-caret">${open ? "▾" : "▸"}</span><span class="sq-no">${task.order ?? "–"}.</span><span class="sq-name" data-fn="${esc(task.id)}">${esc(fname(task.id))}</span>${x.suspend ? `<a class="sq-susp" href="${esc(codeHref(x.suspend.location?.path, x.suspend.location?.line))}">可被挂起</a>` : ""}${task.order == null ? `<span class="sub">位置未定</span>` : ""}<span class="sq-f"><i>${esc(modeLabel[x.rm.mode] ?? x.rm.mode ?? "")}</i>${periodText(x.rm) ? `<b>${esc(periodText(x.rm))}</b>` : ""}</span><span class="sq-f"><i>一轮</i><b>${x.sched} 次调度</b></span><span class="sq-f"><i>调用</i><b>${x.calls}</b></span>${x.busy ? `<span class="sq-f bad"><i>⛔</i><b>${x.busy}</b></span>` : ""}<span style="flex:1"></span>${stateSel}</div>`;
    };
    const body = (task) => {
      if (!seq.open.has(task.id)) return "";
      const key = seq.states.get(task.id) ?? null;
      const machines = machinesNear(task.id);
      const machine = machines.find((m) => key && m.states.some((s) => `${m.id}|${s.name}` === key)) ?? null;
      const state = machine ? machine.states.find((s) => `${machine.id}|${s.name}` === key) : null;
      return `<div class="sq-body">${renderSeqUnit(task.id, machine, state)}</div>`;
    };
    panel.innerHTML = `<div class="entries">
      <p class="cmp-note">一行一个任务，顺序 = <code>${esc([...schedulerNames][0] ?? "scheduler")}</code> 轮询的顺序。点开是它的一轮：第 1 列是这个函数，⏸ 是让出点（让出即 return，下面的代码等下一次调度），①②③ = 第几次被调度，左侧 ↺ 是回边；框在长出子循环的那一行裂开，子循环进第 2 列，逐层往右；框右边是出口（条件不成立 / break / return / 体内让出，引擎 <code>loops[].exits</code>）。行上 R / W = 这一步碰到的共享变量数，⚠ = 无保护且中断也写。</p>
      <div class="seq-tools s1-tools"><span class="sub">${tasks.length} 个任务${placed < tasks.length ? `，${tasks.length - placed} 个位置未定（注册点不在 main 路径上）` : ""}</span><label>向右展开深度 <select id="pt-depth">${[1, 2, 3, 4, 5, 6].map((d) => `<option value="${d}" ${paths.depth === d ? "selected" : ""}>${d}</option>`).join("")}</select></label><label><input type="checkbox" id="pt-iter" ${seq2.showIter ? "checked" : ""}> 显示遍历循环</label><span style="flex:1"></span><button id="sq-open-warn">展开有 ⛔ 的</button><button id="pt-open">展开全部调用链</button><button id="pt-close">折叠调用链</button><button id="sq-close-all">全部收起</button></div>
      <div class="sq-list">${tasks.map((task) => `<div class="sq-task ${seq.open.has(task.id) ? "open" : ""}">${head(task)}${body(task)}</div>`).join("")}</div>
    </div>`;
    panel.querySelectorAll("[data-toggle]").forEach((el) => el.addEventListener("click", (event) => { if (event.target.closest("a,[data-fn],select")) return; const id = el.dataset.toggle; if (seq.open.has(id)) seq.open.delete(id); else seq.open.add(id); renderSeq(); }));
    panel.querySelectorAll(".sq-state").forEach((el) => el.addEventListener("change", (event) => { seq.states.set(el.dataset.task, event.target.value || null); renderSeq(); }));
    panel.querySelectorAll(".sq-head [data-fn]").forEach((b) => b.addEventListener("click", (event) => { event.stopPropagation(); showEntry(b.dataset.fn); }));
    $("sq-open-warn")?.addEventListener("click", () => { for (const task of tasks) if (facts(task).busy) seq.open.add(task.id); renderSeq(); });
    $("sq-close-all")?.addEventListener("click", () => { seq.open.clear(); renderSeq(); });
    wireSeq();
    panel.querySelectorAll("[data-var]").forEach((b) => b.addEventListener("click", () => showConflict(b.dataset.var)));
  }
