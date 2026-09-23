  // ---- 依赖：一张分层 DSM。行 = 依赖方，列 = 被依赖方。
  //      叶子是「单元」：源文件 + 同目录同主名的头（引擎 dependencyOrder.units），include 与调用落在同一个格子里。
  //      行是分组树上的可见节点：展开的组显示它的子项（连续成块、缩进），没展开的组折成一行（格子是聚合值）。
  //      分组树可选：目录（人画的框）/ 聚簇（引擎从边算出来的组）。折叠而不是过滤：范围外的组也在表里。
  //      排序是嵌套的：组之间按聚合边排，块内部按子项之间的边排（同一套源/汇剥离 + 撕开算法）；
  //      同时算一遍打平排序，两者反向边数的差就是这棵分组树的代价。
  //      格子固定 20×20，多了就滚（行列头冻结）；每个块都能回放它内部的排序过程。
  const deps = { tree: "dir", open: null, sel: null, search: "", play: null, timer: null, cplay: null, ctimer: null, presetDone: false };
  // 格子只有颜色：有没有、正向还是反向、什么性质；轻重用深浅三档（八个量之和的三分位）。数字在悬浮、明细和切割集里
  // 声明（人的假设，不是事实）：钉到块顶/块底的行、文件改归哪个模块（what-if）、打算反转的边、簇的名字。
  // 页面上一律带紫色虚线与「声明」标记；改完代码重扫之后它们才可能变成事实。原型阶段存 localStorage。
  const DECL_KEY = `archx.deps.decl.${F.project ?? ""}.${F.partition?.id ?? F.region}`;
  const loadDecl = () => { try { const raw = JSON.parse(localStorage.getItem(DECL_KEY) || "{}"); return { top: raw.top ?? [], bottom: raw.bottom ?? [], regroup: raw.regroup ?? {}, invert: raw.invert ?? [], names: raw.names ?? {} }; } catch { return { top: [], bottom: [], regroup: {}, invert: [], names: {} }; } };
  const saveDecl = (d) => { try { localStorage.setItem(DECL_KEY, JSON.stringify(d)); } catch { /* 存不了就只在本次会话有效 */ } };
  const decl = loadDecl();
  const declCount = () => decl.top.length + decl.bottom.length + Object.keys(decl.regroup).length + decl.invert.length + Object.keys(decl.names).length;
  const moduleOfFile = (path) => decl.regroup[path] ?? fileById.get(path)?.module ?? "?";
  const REGION_DIR = F.region.replace(/\/$/, "");
  const moduleDirOf = (id) => { const m = F.modules.find((x) => x.id === id); if (!m || m.library) return null; if (m.external) return m.id.replace(/^ext:/, ""); return m.dir === "(root)" ? REGION_DIR : `${REGION_DIR}/${m.dir.replace(/\/$/, "")}`; };
  const parentDir = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
  const ROOT = "";
  // 聚簇（引擎 dependencyOrder.clusters）：文件 -> 簇号（按大小排的簇列表下标），以及回放用的成员重建
  function depClusters(D) {
    const K = D.clusters; if (!K) return null;
    const of = new Map(); K.clusters.forEach((members, i) => members.forEach((f) => of.set(f, i)));
    return { K, of, stability: K.stability ?? {}, agreement: K.directoryAgreement ?? {} };
  }
  function depClusterAtStep(K, k) {
    const sorted = K.clusters.flat().sort();
    const member = new Map(sorted.map((f, i) => [f, i]));
    for (const s of K.steps.slice(0, k)) if (s.node != null) member.set(s.node, s.to);
    const groups = new Map(); for (const [f, id] of member) groups.set(id, [...(groups.get(id) ?? []), f]);
    return { member, groups: [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]) };
  }
  // 同一套分区算法（引擎 sequence 的 JS 版）：返回顺序、每一步、反馈边集合、层级
  function depSequence(nodes, edgeList) {
    // edgeList：[a, b, 权重?]。撕开时先比（出度 − 入度），平了再比（出权 − 入权），再平按名字——权重 = 边上八个量之和
    const out = new Map(nodes.map((n) => [n, new Set()])), inn = new Map(nodes.map((n) => [n, new Set()])), wt = new Map();
    for (const [a, b, w] of edgeList) { if (a === b || !out.has(a) || !out.has(b)) continue; out.get(a).add(b); inn.get(b).add(a); wt.set(`${a}→${b}`, (wt.get(`${a}→${b}`) ?? 0) + (w ?? 1)); }
    const remaining = new Set(nodes), head = [], tail = [], steps = [];
    const live = (set) => [...set].filter((x) => remaining.has(x)).length;
    const liveW = (n) => [...out.get(n)].filter((x) => remaining.has(x)).reduce((acc, x) => acc + (wt.get(`${n}→${x}`) ?? 1), 0) - [...inn.get(n)].filter((x) => remaining.has(x)).reduce((acc, x) => acc + (wt.get(`${x}→${n}`) ?? 1), 0);
    while (remaining.size) {
      let progressed = true;
      while (progressed && remaining.size) {
        progressed = false;
        for (const n of [...remaining].filter((x) => !live(out.get(x))).sort()) { tail.push(n); remaining.delete(n); steps.push({ kind: "sink", node: n, out: 0, in: live(inn.get(n)) }); progressed = true; }
        for (const n of [...remaining].filter((x) => !live(inn.get(x))).sort()) { head.push(n); remaining.delete(n); steps.push({ kind: "source", node: n, out: live(out.get(n)), in: 0 }); progressed = true; }
      }
      if (remaining.size) {
        const score = (n) => [live(out.get(n)) - live(inn.get(n)), liveW(n)];
        const pick = [...remaining].sort().reduce((best, n) => { if (best == null) return n; const a = score(n), b = score(best); return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? n : best; }, null);
        remaining.delete(pick); head.push(pick);
        steps.push({ kind: "tear", node: pick, out: live(out.get(pick)), in: live(inn.get(pick)), weight: liveW(pick), block: remaining.size + 1 });
      }
    }
    const order = [...head, ...tail.slice().reverse()];
    const pos = new Map(order.map((n, i) => [n, i]));
    const feedback = new Set(); for (const [a, set] of out) for (const b of set) if (pos.get(b) < pos.get(a)) feedback.add(`${a}→${b}`);
    const level = new Map();
    for (const n of order.slice().reverse()) { let best = -1; for (const b of out.get(n)) if (!feedback.has(`${n}→${b}`) && level.has(b)) best = Math.max(best, level.get(b)); level.set(n, best + 1); }
    return { order, steps, feedback, level };
  }
  function depOrderAtStep(nodes, steps, k) {
    const head = [], tail = [], placed = new Set();
    for (const s of steps.slice(0, k)) { placed.add(s.node); (s.kind === "sink" ? tail : head).push(s.node); }
    const rest = nodes.filter((n) => !placed.has(n)).sort();
    return { order: [...head, ...rest, ...tail.slice().reverse()], pending: new Set(rest) };
  }
  const edgeWeight = (e) => (e.includes ?? 0) + (e.calls ?? 0) + (e.types ?? 0) + (e.macros ?? 0) + (e.reads ?? 0) + (e.writes ?? 0);
  // 聚合一组边：把 (s,t) 映射到 (ms,mt)，同一对相加，记住造成它的文件对
  function aggregateEdges(edges, mapS, mapT) {
    const out = new Map();
    for (const e of edges) {
      const s = mapS(e.s ?? e.source), t = (mapT ?? mapS)(e.t ?? e.target); if (!s || !t || s === t) continue;
      const id = `${s}→${t}`; const rec = out.get(id) ?? { id, s, t, includes: 0, calls: 0, bypass: 0, typeOnly: 0, types: 0, macros: 0, reads: 0, writes: 0, pairs: [], files: new Map(), cls: "" };
      rec.includes += e.includes; rec.calls += e.calls; rec.bypass += e.bypass ?? e.bypassCalls ?? 0; rec.typeOnly += e.typeOnly ?? e.typeOnlyIncludes ?? 0; rec.types += e.types ?? 0; rec.macros += e.macros ?? 0; rec.reads += e.reads ?? 0; rec.writes += e.writes ?? 0;
      if (e.pairs) { rec.pairs.push(...e.pairs); for (const [k, v] of e.files ?? []) rec.files.set(k, (rec.files.get(k) ?? 0) + v); } else { rec.pairs.push({ s: e.source, t: e.target }); rec.files.set(`${e.source}→${e.target}`, (e.includes + e.calls) || 1); }
      out.set(id, rec);
    }
    return [...out.values()];
  }
  // 叶子 = 单元（.c + 同名 .h）；没有 units 字段的老事实退化成文件
  function depsModel() {
    const D = F.dependencyOrder; const U = D.units ?? null;
    const unitOf = (f) => U?.unitOf?.[f] ?? f;
    const membersOf = (u) => U?.members?.[u] ?? [u];
    const regionFiles = F.files.filter((f) => f.path.startsWith(F.region) && !f.path.startsWith("lib:"));
    const fileEdges = (D.files?.edges ?? []).filter((e) => !String(e.source).startsWith("lib:") && !String(e.target).startsWith("lib:"));
    const leafSet = new Set(regionFiles.map((f) => unitOf(f.path)));
    for (const e of fileEdges) { leafSet.add(unitOf(e.source)); leafSet.add(unitOf(e.target)); }
    const leafEdges = aggregateEdges(fileEdges, unitOf);
    const leafLabel = (u) => { const m = membersOf(u); if (m.length === 1) return m[0].split("/").pop(); const exts = m.map((f) => f.split(".").pop()).sort((a, b) => (a.startsWith("c") ? -1 : 1) - (b.startsWith("c") ? -1 : 1)); return `${u.split("/").pop()}.${exts.join("/")}`; };
    const leafFile = (u) => { const m = membersOf(u); return m.find((f) => /\.c(c|pp|xx)?$/i.test(f)) ?? m[0]; };
    return { D, U, unitOf, membersOf, regionFiles, fileEdges, leaves: [...leafSet], leafEdges, leafLabel, leafFile, pairedUnits: U ? Object.values(U.members).filter((m) => m.length > 1).length : 0 };
  }
  // 分组树：目录 / 聚簇。统一接口：children(g) / parent(id) / isGroup(id) / label(id) / defaultOpen() / allOpen()
  function dirTree(M) {
    const leafDir = (u) => { for (const f of M.membersOf(u)) { const m = decl.regroup[f]; const d = m ? moduleDirOf(m) : null; if (d) return d; } return parentDir(u); };
    const children = new Map([[ROOT, new Set()]]), parent = new Map(), groups = new Set([ROOT]);
    const add = (g, c) => { if (!children.has(g)) children.set(g, new Set()); children.get(g).add(c); parent.set(c, g); };
    // 分区目录到根这一串（src/、src/app/）永远展开，所以直接提升：它们的子项挂在根下，不占缩进
    const hoisted = new Set(); { let d = REGION_DIR; while (d) { hoisted.add(d); d = parentDir(d); } }
    const up = (d) => (hoisted.has(d) ? ROOT : d);
    for (const u of M.leaves) { let d = up(leafDir(u)); add(d, u); while (d !== ROOT) { groups.add(d); const p = up(parentDir(d)); add(p, d); d = p; } }
    const label = (g) => g === ROOT ? "" : `${g.startsWith(`${REGION_DIR}/`) ? g.slice(REGION_DIR.length + 1) : g}/`;
    const defaultOpen = () => new Set([ROOT]);
    const allOpen = () => new Set([ROOT, ...[...groups].filter((g) => g.startsWith(`${REGION_DIR}/`))]);
    return { kind: "dir", groups, children: (g) => [...(children.get(g) ?? [])].sort(), parent: (id) => parent.get(id) ?? null, isGroup: (id) => groups.has(id), label, defaultOpen, allOpen, shortLabel: (g) => `${label(g).replace(/\/$/, "").split("/").pop()}/` };
  }
  function clusterTree(M, CL) {
    const clusterOf = (u) => { const votes = new Map(); for (const f of M.membersOf(u)) if (CL.of.has(f)) votes.set(CL.of.get(f), (votes.get(CL.of.get(f)) ?? 0) + 1); const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]; return top ? `cl:${top[0]}` : "cl:none"; };
    const children = new Map([[ROOT, new Set()]]), parent = new Map(), groups = new Set([ROOT]);
    for (const u of M.leaves) { const g = clusterOf(u); groups.add(g); if (!children.has(g)) children.set(g, new Set()); children.get(g).add(u); parent.set(u, g); children.get(ROOT).add(g); parent.set(g, ROOT); }
    const label = (g) => { if (g === ROOT) return ""; if (g === "cl:none") return "未聚簇（无边）"; const i = g.slice(3); return decl.names[i] ? `${decl.names[i]}（C${i}）` : `C${i}`; };
    return { kind: "cluster", groups, children: (g) => [...(children.get(g) ?? [])].sort((a, b) => (children.get(b)?.size ?? 0) - (children.get(a)?.size ?? 0) || String(a).localeCompare(String(b))), parent: (id) => parent.get(id) ?? null, isGroup: (id) => groups.has(id), label, defaultOpen: () => new Set([ROOT]), allOpen: () => new Set(groups), shortLabel: label };
  }
  // 布局：可见行、行之间的聚合边、嵌套排序（每个展开的组内部单独排，块连续）、块的范围
  function layoutRows(M, T, open, playing) {
    const rows = [];
    const visit = (g) => { for (const c of T.children(g)) { if (T.isGroup(c) && open.has(c)) visit(c); else rows.push(c); } };
    visit(ROOT);
    const rowSet = new Set(rows);
    const rowOfCache = new Map();
    const rowOf = (leaf) => { if (rowOfCache.has(leaf)) return rowOfCache.get(leaf); let id = leaf; while (id != null && !rowSet.has(id)) id = T.parent(id); rowOfCache.set(leaf, id); return id; };
    const edges = aggregateEdges(M.leafEdges, rowOf);
    const inner = new Map(); for (const e of M.leafEdges) { const s = rowOf(e.s), t = rowOf(e.t); if (s && s === t) inner.set(s, (inner.get(s) ?? 0) + 1); }
    const inverted = new Set(decl.invert);
    const live = edges.filter((e) => !inverted.has(e.id));
    const kidOf = (row, g) => { let id = row, prev = row; while (id != null && id !== g) { prev = id; id = T.parent(id); } return id === g ? prev : null; };
    const blocks = [];
    const orderGroup = (g, depth) => {
      const kids = T.children(g).filter((c) => rowSet.has(c) || (T.isGroup(c) && open.has(c)));
      const kidSet = new Set(kids);
      const kidEdges = aggregateEdges(live, (r) => { const k = kidOf(r, g); return kidSet.has(k) ? k : null; });
      const seq = depSequence(kids, kidEdges.map((e) => [e.s, e.t, edgeWeight(e)]));
      const top = decl.top.filter((k) => kidSet.has(k)), bottom = decl.bottom.filter((k) => kidSet.has(k)), pinned = new Set([...top, ...bottom]);
      let order = [...top, ...seq.order.filter((k) => !pinned.has(k)), ...bottom];
      let pending = new Set();
      if (playing && playing.group === g) { const at = depOrderAtStep(kids, seq.steps, playing.step); order = at.order; pending = at.pending; }
      const block = { group: g, depth, kids, seq, order, pending, edges: kidEdges, first: -1, last: -1 };
      blocks.push(block);
      const out = [];
      for (const k of order) { if (T.isGroup(k) && open.has(k)) out.push(...orderGroup(k, depth + 1)); else out.push(k); }
      return out;
    };
    const order = orderGroup(ROOT, 0);
    const pos = new Map(order.map((r, i) => [r, i]));
    const rowsUnder = (g) => { const out = []; const walk = (x) => { if (rowSet.has(x)) out.push(x); else for (const c of T.children(x)) walk(c); }; walk(g); return out; };
    for (const b of blocks) { const ps = rowsUnder(b.group).map((r) => pos.get(r)); b.first = Math.min(...ps); b.last = Math.max(...ps); }
    const depthOf = (row) => { let d = 0, id = T.parent(row); while (id != null && id !== ROOT) { d++; id = T.parent(id); } return d; };
    const feedback = new Set(live.filter((e) => pos.get(e.t) < pos.get(e.s)).map((e) => e.id));
    const flat = depSequence(rows, live.map((e) => [e.s, e.t, edgeWeight(e)]));
    const pending = new Set(blocks.flatMap((b) => [...b.pending].flatMap((k) => rowsUnder(k))));
    return { rows, order, pos, edges, inner, blocks, feedback, flat, rowOf, depthOf, pending, inverted, rowsUnder };
  }
  // 一条边的明细：六个量各一个下拉段（默认全展开），段里是具体的文件对 / 函数对 / 类型 / 宏 / 变量，都带跳转
  function edgeSections(e, M, L, T, open) {
    const filesUnder = (row) => { const out = new Set(); for (const u of M.leaves) if (L.rowOf(u) === row) for (const f of M.membersOf(u)) out.add(f); return out; };
    const sFiles = filesUnder(e.s), tFiles = filesUnder(e.t);
    const fl = (path, line) => `<a class="sg-line" href="${esc(codeHref(path, line))}">${esc(String(path).split("/").pop())}${line ? `:${line}` : ""}</a>`;
    const inc = [...e.files.keys()].map((k) => k.split("→")).filter(([a, b]) => M.fileEdges.some((x) => x.source === a && x.target === b && x.includes));
    const calls = F.callPairs.filter((c) => { const sf = fnById.get(c.s)?.file, tf = fnById.get(c.t)?.file; return sf && tf && sFiles.has(sf) && tFiles.has(tf); });
    const callsBy = new Map(); for (const c of calls) { const k = `${c.s}→${c.t}`; const r = callsBy.get(k) ?? { s: c.s, t: c.t, lines: [] }; if (c.line) r.lines.push(c.line); callsBy.set(k, r); }
    const types = new Map(); for (const u of F.typeUses ?? []) { const f = fnById.get(u.fn)?.file; if (!f || !u.def || !sFiles.has(f) || !tFiles.has(u.def.path)) continue; const r = types.get(u.type) ?? { type: u.type, def: u.def, n: 0, fns: new Set(), roles: new Map(), at: u.at }; r.n += u.n; r.fns.add(u.fn); r.roles.set(u.role, (r.roles.get(u.role) ?? 0) + u.n); types.set(u.type, r); }
    const macros = new Map(); for (const u of F.macroUses ?? []) { if (!u.def || !sFiles.has(u.file) || !tFiles.has(u.def.path)) continue; const r = macros.get(u.macro) ?? { macro: u.macro, def: u.def, n: 0, files: new Set(), at: u.at }; r.n += u.n; r.files.add(u.file); macros.set(u.macro, r); }
    const vars = (kinds) => { const out = new Map(); for (const a of A.resourceAccesses ?? []) { if (!kinds.has(a.kind)) continue; const f = fnById.get(a.function)?.file; const vp = a.variable ? String(a.variable).split(":")[1] : null; if (!f || !vp || !sFiles.has(f) || !tFiles.has(vp)) continue; const r = out.get(a.name) ?? { name: a.name, path: vp, line: Number(String(a.variable).split(":")[2]) || null, n: 0, fns: new Set(), sites: [] }; r.n += 1; r.fns.add(a.function); if (r.sites.length < 6) r.sites.push(a.location); out.set(a.name, r); } return out; };
    const reads = vars(new Set(["read", "read_write"])), writes = vars(new Set(["write", "read_write"]));
    const ROLE = { param: "形参", return: "返回", local: "局部", global: "全局变量", member: "字段", cast: "强转" };
    const varRows = (m) => `<table>${[...m.values()].sort((x, y) => y.n - x.n).map((r) => `<tr><td><code>${esc(r.name)}</code> ${fl(r.path, r.line)}<br><span class="sub">${r.fns.size} 个函数 · ${r.sites.map((l) => fl(l.path, l.line)).join(" ")}</span></td><td class="num">${r.n}</td></tr>`).join("")}</table>`;
    const sections = [
      ["include", inc.length, () => `<table>${inc.map(([a, b]) => `<tr><td>${fl(a)} → ${fl(b)}</td></tr>`).join("")}</table>`],
      ["调用", callsBy.size, () => `<table>${[...callsBy.values()].sort((x, y) => y.lines.length - x.lines.length).slice(0, 80).map((r) => `<tr><td><button class="link" data-fn="${esc(r.s)}">${esc(fname(r.s))}</button> → <button class="link" data-fn="${esc(r.t)}">${esc(fname(r.t))}</button><br><span class="sub">${r.lines.slice(0, 6).map((l) => fl(fnById.get(r.s)?.file, l)).join(" ")}</span></td><td class="num">${r.lines.length || 1}</td></tr>`).join("")}</table>`],
      ["类型", types.size, () => `<table>${[...types.values()].sort((x, y) => y.n - x.n).map((r) => `<tr><td><code>${esc(r.type)}</code> ${fl(r.def.path, r.def.line)}<br><span class="sub">${[...r.roles.entries()].map(([k, n]) => `${ROLE[k] ?? k} ${n}`).join("、")} · ${r.fns.size} 个函数 · 首次 ${fl(r.at.path, r.at.line)}</span></td><td class="num">${r.n}</td></tr>`).join("")}</table>`],
      ["宏", macros.size, () => `<table>${[...macros.values()].sort((x, y) => y.n - x.n).map((r) => `<tr><td><code>${esc(r.macro)}</code> ${fl(r.def.path, r.def.line)}<br><span class="sub">${r.files.size} 个文件 · 首次 ${fl(r.at.path, r.at.line)}</span></td><td class="num">${r.n}</td></tr>`).join("")}</table>`],
      ["读", reads.size, () => varRows(reads)],
      ["写", writes.size, () => varRows(writes)],
    ];
    return sections.filter(([, n]) => n).map(([label_, n, body]) => `<details class="dm-sec" ${open ? "open" : ""}><summary><b>${label_}</b> <span class="sub">${n}</span></summary>${body()}</details>`).join("") || `<p class="sub">这条边上没有可列的明细。</p>`;
  }
  const edgeHead = (e, L, name) => `<h2>${esc(name(e.s))} → ${esc(name(e.t))}</h2><p class="sub">${e.pairs.length} 对文件${L.feedback.has(e.id) ? " · <b>反向边</b>" : ""}${e.bypass ? ` · 绕过 ${e.bypass}` : ""}${e.typeOnly ? ` · 仅类型 include ${e.typeOnly}` : ""}</p>`;
  function showDepEdge(e, M, L, T) {
    const name = (r) => T.isGroup(r) ? T.label(r) : M.leafLabel(r);
    aside.innerHTML = `<div class="search"><input id="fn-search" placeholder="输入函数名，倒推到入口" /><button id="fn-search-btn">倒推</button></div>${edgeHead(e, L, name)}${edgeSections(e, M, L, T, true)}`;
    wireEntryAside();
  }
  // 选中一行 / 一列：这个文件组的全部依赖——它依赖谁（这一行的格子）、谁依赖它（这一列的格子），每条边一个下拉，展开是同一份明细
  function showDepNode(n, M, L, T) {
    const name = (r) => T.isGroup(r) ? T.label(r) : M.leafLabel(r);
    const outs = L.edges.filter((e) => e.s === n).sort((a, b) => edgeWeight(b) - edgeWeight(a));
    const ins = L.edges.filter((e) => e.t === n).sort((a, b) => edgeWeight(b) - edgeWeight(a));
    const kinds = (e) => `${L.feedback.has(e.id) ? "<b>反向</b> · " : ""}include ${e.includes} · 调用 ${e.calls}${e.types ? ` · 类型 ${e.types}` : ""}${e.macros ? ` · 宏 ${e.macros}` : ""}${e.reads ? ` · 读 ${e.reads}` : ""}${e.writes ? ` · 写 ${e.writes}` : ""}`;
    const list = (edges, other) => edges.length ? edges.map((e) => `<details class="dm-edge ${L.feedback.has(e.id) ? "back" : ""}"><summary><b>${esc(name(other(e)))}</b> <span class="sub">${kinds(e)}</span></summary>${edgeSections(e, M, L, T, true)}</details>`).join("") : `<p class="sub">没有。</p>`;
    const members = T.isGroup(n) ? `${M.leaves.filter((u) => L.rowOf(u) === n).length} 个单元` : M.membersOf(n).map((f) => `<code>${esc(f.split("/").pop())}</code>`).join(" + ");
    aside.innerHTML = `<div class="search"><input id="fn-search" placeholder="输入函数名，倒推到入口" /><button id="fn-search-btn">倒推</button></div>
      <h2>${esc(name(n))}</h2><p class="sub">${members}</p>
      <h3>依赖谁 <span class="sub">${outs.length}（这一行）</span></h3>${list(outs, (e) => e.t)}
      <h3>谁依赖它 <span class="sub">${ins.length}（这一列）</span></h3>${list(ins, (e) => e.s)}`;
    wireEntryAside();
  }
  function renderDeps() {
    const panel = $("panel-deps");
    if (!F.dependencyOrder?.files) { panel.innerHTML = `<div class="entries"><p class="cmp-note">事实里没有 dependencyOrder.files，需要 ArchCheck ≥ 0.10.1。</p></div>`; return; }
    const M = depsModel();
    const CL = depClusters(M.D);
    if (!deps.presetDone) {
      deps.presetDone = true;
      const h = new URLSearchParams(location.hash.slice(1));
      if (h.get("dtree") === "cluster" && CL) deps.tree = "cluster";
      const T0 = deps.tree === "cluster" ? clusterTree(M, CL) : dirTree(M);
      deps.open = T0.defaultOpen();
      if (h.get("dopen")) for (const d of h.get("dopen").split(",")) deps.open.add(d);
      if (h.get("dplay")) deps.play = { group: ROOT, step: Number(h.get("dplay")), n: -1 };
      if (h.get("dcplay")) deps.cplay = { step: Number(h.get("dcplay")) };
    }
    if (deps.tree === "cluster" && !CL) deps.tree = "dir";
    const T = deps.tree === "cluster" ? clusterTree(M, CL) : dirTree(M);
    if (!deps.open) deps.open = T.defaultOpen();
    let L = layoutRows(M, T, deps.open, deps.play);
    const N = L.rows.length;
    if (deps.play && deps.play.n === -1) deps.play.n = N;
    if (deps.play && (deps.play.n !== N || !L.blocks.some((b) => b.group === deps.play.group))) { deps.play = null; clearInterval(deps.timer); deps.timer = null; L = layoutRows(M, T, deps.open, null); }
    const { order, pos, edges, inner, blocks, feedback, flat, inverted } = L;
    const isGroup = (r) => T.isGroup(r);
    const label = (r) => isGroup(r) ? T.label(r) : M.leafLabel(r);
    const color = (r) => { if (isGroup(r)) { const leaf = M.leaves.find((u) => L.rowOf(u) === r); return modColor(leaf ? moduleOfFile(M.leafFile(leaf)) : r); } return modColor(moduleOfFile(M.leafFile(r))); };
    const leafCount = new Map(); for (const u of M.leaves) { const r = L.rowOf(u); if (r) leafCount.set(r, (leafCount.get(r) ?? 0) + 1); }
    const edgeAt = new Map(edges.map((e) => [e.id, e]));
    const outDeg = new Map(order.map((n) => [n, 0])), inDeg = new Map(order.map((n) => [n, 0]));
    for (const e of edges) { outDeg.set(e.s, outDeg.get(e.s) + 1); inDeg.set(e.t, inDeg.get(e.t) + 1); }
    // 簇与目录不一致的单元：它的簇 ≠ 它所在目录里单元的多数簇（目录树下的标记，代替原来的吻合度 / 摇摆面板）
    const unitCluster = (u) => { if (!CL) return null; const votes = new Map(); for (const f of M.membersOf(u)) if (CL.of.has(f)) votes.set(CL.of.get(f), (votes.get(CL.of.get(f)) ?? 0) + 1); return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
    const dirMajority = new Map();
    if (CL) { const byDir = new Map(); for (const u of M.leaves) { const c = unitCluster(u); if (c == null) continue; const d = parentDir(u); const m = byDir.get(d) ?? new Map(); m.set(c, (m.get(c) ?? 0) + 1); byDir.set(d, m); } for (const [d, m] of byDir) dirMajority.set(d, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]); }
    const odd = (u) => { const c = unitCluster(u); const m = dirMajority.get(parentDir(u)); return c != null && m != null && c !== m ? { c, m } : null; };
    // ---- 事实条：只剩三个数
    const D = M.D;
    const chip = (label_, value, bad) => `<span class="bf${bad ? " bad" : ""}"><i>${label_}</i><b>${value}</b></span>`;
    const facts = `<div class="beat-facts">
      ${chip("单元", `${M.leaves.length}${M.U ? `（合并 ${M.pairedUnits} 对 .c/.h · 区域内文件 ${M.regionFiles.length}）` : ""}`)}${chip("反向边", `分块 ${feedback.size} · 打平 ${flat.feedback.size} · 全工程 ${(D.units?.feedback ?? D.files.feedback ?? []).length}`, feedback.size > 0)}${declCount() ? `<span class="bf dm-decl"><i>声明</i><b>${declCount()}</b><button class="dm-x" id="dm-decl-clear" title="清空全部声明">×</button></span>` : ""}
    </div>`;
    // ---- 矩阵
    const sel = deps.sel && pos.has(deps.sel) ? deps.sel : null;
    const q = deps.search.trim().toLowerCase();
    const hit = (n) => q && label(n).toLowerCase().includes(q);
    const cellCls = (e) => { const back = feedback.has(e.id); const rel = sel && (e.s === sel || e.t === sel); return `cell ${back ? "back" : ""} ${inverted.has(e.id) ? "plan" : ""} ${e.includes === 0 ? "bypass" : e.calls === 0 ? "typeonly" : ""} ${rel ? "hl" : ""} ${sel && !rel ? "dim" : ""}`; };
    const cellTitle = (e) => `${label(e.s)} → ${label(e.t)} · include ${e.includes} · 调用 ${e.calls}${e.bypass ? ` · 绕过 ${e.bypass}` : ""}${e.typeOnly ? ` · 仅类型 ${e.typeOnly}` : ""}${e.types ? ` · 类型 ${e.types}` : ""}${e.macros ? ` · 宏 ${e.macros}` : ""}${e.reads ? ` · 读 ${e.reads}` : ""}${e.writes ? ` · 写 ${e.writes}` : ""} · ${e.pairs.length} 对文件 · 点击看明细，Alt+点 = 声明反转`;
    const weights = edges.map(edgeWeight).sort((a, b) => a - b);
    const q1 = weights[Math.floor(weights.length / 3)] ?? 0, q2 = weights[Math.floor((weights.length * 2) / 3)] ?? 0;
    const tier = (e) => { const w = edgeWeight(e); return w > q2 ? 1 : w > q1 ? 0.78 : 0.55; };
    const headCls = (n) => `${sel === n ? "sel" : ""} ${hit(n) ? "hit" : ""} ${L.pending.has(n) ? "pending" : ""} ${isGroup(n) ? "dir" : ""}`;
    const maxDepth = Math.max(0, ...blocks.map((b) => b.depth));
    const IND = 12;
    // 格子固定 20×20：多了就滚（行列头是冻结的），名字不随行数缩
    const CELL = 20;
    const HW = 300 + maxDepth * IND, CW = CELL, RH = CELL, HH = 120 + maxDepth * IND;
    const dense = false;
    const W = HW + N * CW, H = HH + N * RH;
    let cells = "";
    for (const b of blocks) if (b.group !== ROOT) cells += `<div class="dm-block d${b.depth % 3}" style="transform:translate(${HW + b.first * CW}px,${b.first * RH}px);width:${(b.last - b.first + 1) * CW}px;height:${(b.last - b.first + 1) * RH}px"></div>`;
    for (const e of edges) cells += `<div class="dm-cell ${cellCls(e)}" data-edge="${esc(e.id)}" title="${esc(cellTitle(e))}" style="width:${CW - 1}px;height:${RH - 1}px;--w:${tier(e)};transform:translate(${HW + pos.get(e.t) * CW}px,${pos.get(e.s) * RH}px)"></div>`;
    for (const r of order) cells += `<div class="dm-cell diag" style="width:${CW - 1}px;height:${RH - 1}px;transform:translate(${HW + pos.get(r) * CW}px,${pos.get(r) * RH}px)"></div>`;
    const declared = (n) => decl.top.includes(n) || decl.bottom.includes(n) || (!isGroup(n) && M.membersOf(n).some((f) => decl.regroup[f]));
    const pinBtns = (n) => `<button class="dm-pin ${decl.top.includes(n) ? "on" : ""}" data-pin="top" data-node-pin="${esc(n)}" title="钉到块顶（声明）">⤒</button><button class="dm-pin ${decl.bottom.includes(n) ? "on" : ""}" data-pin="bottom" data-node-pin="${esc(n)}" title="钉到块底（声明）">⤓</button>`;
    const regroupSel = (n) => !isGroup(n) && (sel === n || M.membersOf(n).some((f) => decl.regroup[f])) ? `<select class="dm-regroup ${M.membersOf(n).some((f) => decl.regroup[f]) ? "dm-decl" : ""}" data-regroup="${esc(n)}" title="what-if：把这个单元归到别的模块（声明）">${F.modules.filter((m) => !m.library).map((m) => `<option value="${esc(m.id)}" ${moduleOfFile(M.leafFile(n)) === m.id ? "selected" : ""}>${esc(m.id)}</option>`).join("")}</select>` : "";
    const rowMeta = (n) => {
      if (isGroup(n)) return `${leafCount.get(n) ?? 0} 单元${inner.get(n) ? ` · 内 ${inner.get(n)} 边` : ""} · ${outDeg.get(n)}→ ←${inDeg.get(n)}`;
      const o = deps.tree === "dir" ? odd(n) : null;
      const stab = deps.tree === "cluster" && CL && CL.stability[M.leafFile(n)] != null ? `稳 ${Math.round(CL.stability[M.leafFile(n)] * 100)}% · ` : "";
      return `${stab}${o ? `<u class="dm-odd" title="它的簇 C${o.c}，所在目录多数在 C${o.m}">簇异</u> · ` : ""}${outDeg.get(n)}→ ←${inDeg.get(n)}`;
    };
    const rows = order.map((n) => `<div class="dm-row ${headCls(n)} ${declared(n) ? "declared" : ""} ${dense ? "dense" : ""}" data-node="${esc(n)}" style="height:${RH}px;transform:translate(0,${pos.get(n) * RH}px);width:${HW}px;padding-left:${6 + L.depthOf(n) * IND}px">${isGroup(n) ? `<b class="dm-tog" data-toggle="${esc(n)}" title="展开">▸</b>` : `<i style="background:${color(n)}"></i>`}<span title="${esc(isGroup(n) ? n : M.membersOf(n).join(" + "))}">${esc(label(n))}</span>${regroupSel(n)}<small>${rowMeta(n)}</small>${pinBtns(n)}</div>`).join("");
    const cols = order.map((n) => `<div class="dm-col ${headCls(n)} ${dense ? "dense" : ""}" data-node="${esc(n)}" style="width:${CW}px;height:${HH}px;transform:translate(${HW + pos.get(n) * CW}px,0)"><span>${esc(label(n))}</span></div>`).join("");
    let rbands = "", cbands = "";
    for (const b of blocks) {
      if (b.group === ROOT) continue;
      const n = b.last - b.first + 1, d = b.depth - 1;
      rbands += `<div class="dm-band d${b.depth % 3}" data-close="${esc(b.group)}" title="${esc(T.label(b.group))} · 点击折回" style="left:${2 + d * IND}px;top:${b.first * RH}px;width:${IND - 3}px;height:${n * RH - 1}px">${n * RH > 40 ? `<button class="dm-band-play" data-play-group="${esc(b.group)}" title="回放这个块内部的排序">▶</button>` : ""}${n * RH > 70 ? `<span>${esc(T.shortLabel(b.group))}</span>` : ""}</div>`;
      cbands += `<div class="dm-cband d${b.depth % 3}" data-close="${esc(b.group)}" title="${esc(T.label(b.group))} · 点击折回" style="top:${2 + d * IND}px;left:${HW + b.first * CW}px;height:${IND - 3}px;width:${n * CW - 1}px">${n * CW > 50 ? `<span>${esc(T.shortLabel(b.group))}</span>` : ""}</div>`;
    }
    // 三层：列头层钉顶、行头层钉左、角两边都钉（CSS sticky；格子的位移动画在 body 层里，不受影响）
    const root = blocks[0];
    const corner = `<div class="dm-corner" id="dm-corner" style="width:${HW}px;height:${HH}px"><button class="dm-corner-play" id="dm-play" title="回放顶层排序：${root.seq.steps.length} 步，剥离 ${root.seq.steps.filter((s) => s.kind !== "tear").length} · 撕开 ${root.seq.steps.filter((s) => s.kind === "tear").length}">${deps.play && deps.timer ? "⏸" : "▶"}</button><div class="dm-legend"><span class="dm-legend-h">行 = 依赖方 · 列 = 被依赖方 · 深浅 = 轻重</span><span><i class="dep"></i>依赖</span><span><i class="back"></i>反向（扣环的边）</span><span><i class="bypass"></i>没 include 的调用</span><span><i class="typeonly"></i>只 include 没调用</span><span><i class="plan"></i>打算反转（Alt+点）</span><span>▸ 展开 · 竖条 = 展开的组</span></div></div>`;
    // 真正的 sticky：列头层在流里钉顶，行头层在流里钉左，角在列头层里再钉左；格子相对 body 绝对定位（y 不含列头高度）
    const matrix = `<div class="dm-wrap" id="dm-wrap"><div class="dm-grid" style="width:${W}px;height:${H}px"><div class="dm-layer-cols" style="width:${W}px;height:${HH}px">${corner}${cols}${cbands}</div><div class="dm-body" style="width:${W}px;height:${H - HH}px"><div class="dm-layer-rows" style="width:${HW}px;height:${H - HH}px">${rows}${rbands}</div>${cells}</div></div></div>`;
    const selInfo = sel ? `<span class="sub">选中 <b>${esc(label(sel))}</b> · 依赖 ${outDeg.get(sel)} 个（这一行）· 被 ${inDeg.get(sel)} 个依赖（这一列）</span><button id="dm-unsel">取消</button>` : "";
    // ---- 回放条：只在回放中出现
    const pb = deps.play ? blocks.find((b) => b.group === deps.play.group) : null;
    const total = pb ? pb.seq.steps.length : root.seq.steps.length;
    const step = pb ? pb.seq.steps[deps.play.step - 1] : null;
    const kidLabel = (k) => isGroup(k) ? T.label(k) : M.leafLabel(k);
    const reason = (s) => !s ? "" : s.kind === "sink" ? `<b>${esc(kidLabel(s.node))}</b> 这一行在块里剩下的元素中没有格子（不依赖任何人）→ 放到块底` : s.kind === "source" ? `<b>${esc(kidLabel(s.node))}</b> 这一列在块里剩下的元素中没有格子（没人依赖它）→ 放到块顶` : `剩下 ${s.block} 个互相依赖，剥不动了 → 撕开出度−入度最大的 <b>${esc(kidLabel(s.node))}</b>（依赖 ${s.out} 个、被 ${s.in} 个依赖${s.weight != null ? `，出权−入权 ${s.weight}` : ""}）→ 放到块顶`;
    const playbar = deps.play ? `<div class="dm-play"><button id="dm-play2">${deps.timer ? "⏸ 暂停" : "▶ 继续"}</button><button id="dm-prev">◀</button><button id="dm-next">▶</button><input id="dm-slider" type="range" min="0" max="${total}" value="${deps.play.step}"><span class="sub">${pb.group === ROOT ? "顶层" : esc(T.label(pb.group))} · 第 ${deps.play.step}/${total} 步 · ${reason(step) || "初始：字母序"}</span><button id="dm-stop">结束</button></div>` : "";
    // ---- 切割集（当前视图）：红格的汇总，含造成它的文件对
    const pairsOf = (e) => [...e.files.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, n]) => `${k.split("→").map((f) => f.split("/").pop()).join(" → ")}（${n}）`).join("、");
    const vCut = edges.filter((e) => feedback.has(e.id)).sort((a, b) => (b.includes + b.calls) - (a.includes + a.calls));
    const cutView = vCut.length ? `<table class="dp-table"><tr><th>反向边（当前视图，点击看明细）</th><th class="num">include</th><th class="num">调用</th><th class="num">类型</th><th class="num">宏</th><th>由哪些文件对造成（前 4，按 include+调用）</th></tr>${vCut.map((e) => `<tr class="dp-edge-row" data-edge="${esc(e.id)}"><td><b>${esc(label(e.s))}</b> → ${esc(label(e.t))}</td><td class="num">${e.includes}</td><td class="num">${e.calls}</td><td class="num">${e.types ?? 0}</td><td class="num">${e.macros ?? 0}</td><td class="sub">${esc(pairsOf(e))}</td></tr>`).join("")}</table>` : `<p class="sub">当前视图没有反向边。</p>`;
    // ---- 聚簇树下：搜索参数与回放
    let clusterPanel = "";
    if (CL && deps.tree === "cluster") {
      const K = CL.K;
      const regionSet = new Set(M.regionFiles.map((f) => f.path));
      const stab = Object.entries(CL.stability).filter(([f]) => regionSet.has(f));
      const avgStab = stab.length ? stab.reduce((n, [, v]) => n + v, 0) / stab.length : 1;
      const cp = deps.cplay;
      const ctotal = K.steps.length;
      let playHtml = "";
      if (cp) {
        const st = depClusterAtStep(K, cp.step);
        const cstep = K.steps[cp.step - 1];
        const groups = st.groups.filter(([, members]) => members.some((f) => regionSet.has(f)));
        const bandsHtml = groups.map(([id, members]) => { const inRegion = members.filter((f) => regionSet.has(f)); return `<div class="dc-band" data-band="${id}"><span class="dc-band-h">${inRegion.length}</span>${inRegion.map((f) => `<i class="dc-chip ${cstep && cstep.node === f ? "moved" : ""}" title="${esc(f.split("/").pop())}" style="background:${modColor(fileById.get(f)?.module ?? "")}"></i>`).join("")}</div>`; }).join("");
        const creason = cstep ? (cstep.node == null ? `搜索结束：最好状态在第 ${cstep.bestAt} 步，代价 ${cstep.cost}` : `搬 <b>${esc(cstep.node.split("/").pop())}</b>：对簇 ${cstep.to} 的出价 ${cstep.bid}（次高 ${cstep.second}）→ 代价 ${cstep.cost}${cstep.worse ? "（变差，随机接受）" : ""}`) : "初始：每个文件自成一簇";
        const costs = K.steps.map((s) => s.cost); const cmax = Math.max(K.initialCost ?? 0, ...costs), cmin = Math.min(...costs);
        const spark = `<svg class="dc-spark" viewBox="0 0 200 40" preserveAspectRatio="none"><polyline points="${costs.map((c, i) => `${(i / Math.max(1, ctotal - 1)) * 200},${40 - ((c - cmin) / Math.max(1, cmax - cmin)) * 38}`).join(" ")}"></polyline><line x1="${(cp.step / Math.max(1, ctotal)) * 200}" y1="0" x2="${(cp.step / Math.max(1, ctotal)) * 200}" y2="40"></line></svg>`;
        playHtml = `<div class="dm-play"><button id="dc-play">${deps.ctimer ? "⏸ 暂停" : "▶"}</button><button id="dc-prev">◀</button><button id="dc-next">▶</button><input id="dc-slider" type="range" min="0" max="${ctotal}" value="${cp.step}"><span class="sub">第 ${cp.step}/${ctotal} 步 · ${creason}</span>${spark}<button id="dc-stop">结束</button></div><div class="dc-bands">${bandsHtml}</div>`;
      }
      clusterPanel = `<details class="dp-more" ${cp ? "open" : ""}><summary><b>聚簇是怎么来的</b> <span class="sub">推导，固定种子 ${K.params.seeds.join("/")} · ${K.clusters.length} 个簇 · 代价 ${K.initialCost} → ${K.cost} · ${K.iterations} 次迭代 · 平均稳定度 ${Math.round(avgStab * 100)}%</span></summary>
        <div class="dm-play">${cp ? "" : `<button id="dc-play">▶ 回放聚簇搜索</button><span class="sub">${ctotal} 次被接受的搬动 · 参数：出价次幂 ${K.params.powDep} · 簇上限 N×${K.params.maxClusterRatio} · 每 ${K.params.randBid} 次选一次次高出价 · 每 ${K.params.randAccept} 次接受一次变差（这些是旋钮，不是事实）</span>`}</div>
        ${playHtml}</details>`;
    }
    const wrapBefore = $("dm-wrap"); const keep = wrapBefore ? { l: wrapBefore.scrollLeft, t: wrapBefore.scrollTop } : null;
    panel.innerHTML = `<div class="entries">${facts}
      <div class="seq-tools s1-tools"><span class="btn-group"><button id="dm-tree-dir" class="${deps.tree === "dir" ? "active" : ""}" title="按目录分组（人画的框）">目录</button>${CL ? `<button id="dm-tree-cl" class="${deps.tree === "cluster" ? "active" : ""}" title="按聚簇分组（从边算出来的，推导）">聚簇</button>` : ""}</span><span class="btn-group"><button id="dm-open-all" title="全部展开到单元">展开到底</button><button id="dm-open-reset" title="折回默认层级">折回</button></span><input id="dm-search" placeholder="搜索名字" value="${esc(deps.search)}"><span style="flex:1"></span>${selInfo}</div>
      ${playbar}
      ${matrix}
      ${clusterPanel}
      <details class="dp-more" open><summary><b>切割集</b> <span class="sub">剪掉这些边，剩下的就是 DAG · 当前视图 ${vCut.length} 条</span></summary>${cutView}</details>
    </div>`;
    const wrap = $("dm-wrap");
    if (keep) { wrap.scrollLeft = keep.l; wrap.scrollTop = keep.t; }
    // ---- 交互
    const stopTimer = () => { clearInterval(deps.timer); deps.timer = null; };
    const ancestors = (id) => { const out = []; let p = T.parent(id); while (p != null) { out.push(p); p = T.parent(p); } return out; };
    const syncHash = () => { try { const h = new URLSearchParams(location.hash.slice(1)); const extra = [...deps.open].filter((d) => d !== ROOT && !T.defaultOpen().has(d)).sort(); if (extra.length) h.set("dopen", extra.join(",")); else h.delete("dopen"); if (deps.tree === "cluster") h.set("dtree", "cluster"); else h.delete("dtree"); h.delete("dmod"); history.replaceState(null, "", `#${h.toString()}`); } catch { /* 地址栏写不了就算了 */ } };
    const toggle = (g) => { if (deps.open.has(g)) { deps.open.delete(g); for (const x of [...deps.open]) if (ancestors(x).includes(g)) deps.open.delete(x); } else deps.open.add(g); deps.play = null; stopTimer(); syncHash(); renderDeps(); };
    panel.querySelectorAll("[data-toggle]").forEach((el) => el.addEventListener("click", (event) => { event.stopPropagation(); toggle(el.dataset.toggle); }));
    panel.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", (event) => { if (event.target.closest("[data-play-group]")) return; toggle(el.dataset.close); }));
    panel.querySelectorAll("[data-node]").forEach((el) => el.addEventListener("click", (event) => { if (event.target.closest("[data-toggle]")) return; const n = el.dataset.node; if (isGroup(n) && el.classList.contains("dm-col")) { toggle(n); return; } deps.sel = deps.sel === n ? null : n; renderDeps(); if (deps.sel) { const L2 = layoutRows(M, T, deps.open, deps.play); showDepNode(deps.sel, M, L2, T); } }));
    panel.querySelectorAll(".dm-row.dir").forEach((el) => el.addEventListener("dblclick", () => toggle(el.dataset.node)));
    panel.querySelectorAll("[data-edge]").forEach((el) => el.addEventListener("click", (event) => {
      const id = el.dataset.edge; const e = edgeAt.get(id); if (!e) return;
      if (event.altKey) { const i = decl.invert.indexOf(id); if (i >= 0) decl.invert.splice(i, 1); else decl.invert.push(id); saveDecl(decl); renderDeps(); return; }
      showDepEdge(e, M, L, T);
    }));
    panel.querySelectorAll("[data-node-pin]").forEach((el) => el.addEventListener("click", (event) => {
      event.stopPropagation(); const n = el.dataset.nodePin, side = el.dataset.pin, list = decl[side], other = decl[side === "top" ? "bottom" : "top"];
      const i = list.indexOf(n); if (i >= 0) list.splice(i, 1); else { list.push(n); const k = other.indexOf(n); if (k >= 0) other.splice(k, 1); }
      saveDecl(decl); renderDeps();
    }));
    panel.querySelectorAll("[data-regroup]").forEach((el) => { el.addEventListener("click", (event) => event.stopPropagation()); el.addEventListener("change", (event) => { const u = el.dataset.regroup; const m = event.target.value; for (const f of M.membersOf(u)) { if (m === (fileById.get(f)?.module ?? "?")) delete decl.regroup[f]; else decl.regroup[f] = m; } saveDecl(decl); renderDeps(); }); });
    const nameCluster = (c) => { const name = prompt(`给簇 C${c} 起个名字（声明，不是事实；留空删除）`, decl.names[c] ?? ""); if (name == null) return; if (name.trim()) decl.names[c] = name.trim(); else delete decl.names[c]; saveDecl(decl); renderDeps(); };
    if (deps.tree === "cluster") panel.querySelectorAll(".dm-row.dir span").forEach((el) => el.addEventListener("dblclick", (event) => { event.stopPropagation(); const g = el.closest("[data-node]").dataset.node; if (g.startsWith("cl:") && g !== "cl:none") nameCluster(g.slice(3)); }));
    $("dm-decl-clear")?.addEventListener("click", () => { decl.top = []; decl.bottom = []; decl.regroup = {}; decl.invert = []; decl.names = {}; saveDecl(decl); renderDeps(); });
    $("dm-open-all")?.addEventListener("click", () => { deps.open = T.allOpen(); deps.play = null; stopTimer(); syncHash(); renderDeps(); });
    $("dm-open-reset")?.addEventListener("click", () => { deps.open = T.defaultOpen(); deps.play = null; stopTimer(); syncHash(); renderDeps(); });
    $("dm-tree-dir")?.addEventListener("click", () => { if (deps.tree === "dir") return; deps.tree = "dir"; deps.open = null; deps.play = null; stopTimer(); deps.sel = null; renderDeps(); });
    $("dm-tree-cl")?.addEventListener("click", () => { if (deps.tree === "cluster") return; deps.tree = "cluster"; deps.open = null; deps.play = null; stopTimer(); deps.sel = null; renderDeps(); });
    $("dm-unsel")?.addEventListener("click", () => { deps.sel = null; renderDeps(); });
    const stopC = () => { clearInterval(deps.ctimer); deps.ctimer = null; };
    const ctotal = CL ? CL.K.steps.length : 0;
    $("dc-play")?.addEventListener("click", () => {
      if (deps.cplay && deps.ctimer) { stopC(); renderDeps(); return; }
      if (!deps.cplay) deps.cplay = { step: 0 };
      deps.ctimer = setInterval(() => { if (deps.cplay.step >= ctotal) { stopC(); renderDeps(); return; } deps.cplay.step = Math.min(ctotal, deps.cplay.step + Math.max(1, Math.floor(ctotal / 200))); renderDeps(); }, 120);
      renderDeps();
    });
    $("dc-prev")?.addEventListener("click", () => { stopC(); deps.cplay.step = Math.max(0, deps.cplay.step - 1); renderDeps(); });
    $("dc-next")?.addEventListener("click", () => { stopC(); deps.cplay.step = Math.min(ctotal, deps.cplay.step + 1); renderDeps(); });
    $("dc-slider")?.addEventListener("input", (event) => { stopC(); deps.cplay.step = Number(event.target.value); renderDeps(); });
    $("dc-stop")?.addEventListener("click", () => { stopC(); deps.cplay = null; renderDeps(); });
    const search = $("dm-search");
    search?.addEventListener("input", () => { deps.search = search.value; const v = deps.search.trim().toLowerCase(); panel.querySelectorAll("[data-node]").forEach((el) => el.classList.toggle("hit", Boolean(v) && (el.textContent || "").toLowerCase().includes(v))); });
    const startPlay = (group) => {
      if (deps.play && deps.play.group === group && deps.timer) { stopTimer(); renderDeps(); return; }
      if (!deps.play || deps.play.group !== group) deps.play = { group, step: 0, n: N };
      const steps = blocks.find((b) => b.group === group)?.seq.steps.length ?? 0;
      stopTimer();
      deps.timer = setInterval(() => { if (deps.play.step >= steps) { stopTimer(); renderDeps(); return; } deps.play.step++; renderDeps(); }, Math.max(120, Math.min(650, 60000 / Math.max(1, steps))));
      renderDeps();
    };
    $("dm-play")?.addEventListener("click", (event) => { event.stopPropagation(); startPlay(deps.play?.group ?? ROOT); });
    $("dm-play2")?.addEventListener("click", () => startPlay(deps.play?.group ?? ROOT));
    panel.querySelectorAll("[data-play-group]").forEach((el) => el.addEventListener("click", (event) => { event.stopPropagation(); startPlay(el.dataset.playGroup); }));
    $("dm-prev")?.addEventListener("click", () => { stopTimer(); deps.play.step = Math.max(0, deps.play.step - 1); renderDeps(); });
    $("dm-next")?.addEventListener("click", () => { stopTimer(); deps.play.step = Math.min(total, deps.play.step + 1); renderDeps(); });
    $("dm-slider")?.addEventListener("input", (event) => { stopTimer(); deps.play.step = Number(event.target.value); renderDeps(); });
    $("dm-stop")?.addEventListener("click", () => { stopTimer(); deps.play = null; renderDeps(); });
  }
