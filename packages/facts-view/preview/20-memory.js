  // ---- 内存：尺寸来自链接产物（独立证据源），归属来自源码事实
  const mem = { sort: "ram", dir: -1, ssort: "size" };
  const fmtBytes = (n) => (n >= 10240 ? `${(n / 1024).toFixed(1)} kB` : n >= 1024 ? `${(n / 1024).toFixed(2)} kB` : `${n} B`);
  function renderMemory() {
    const panel = $("panel-memory");
    const IM = F.imageFacts;
    if (!IM) { panel.innerHTML = `<p class="note">事实里没有 imageFacts。需要 ArchCheck ≥ 0.8.0，且工程里存在链接产物（armlink / Keil 的 .map）。</p>`; return; }
    const st = IM.staleness ?? {}, sc = IM.scopedTotals ?? {}, tt = IM.totals ?? {};
    const built = new Date((IM.artifact.modified ?? 0) * 1000);
    const stamp = `${built.getFullYear()}-${String(built.getMonth() + 1).padStart(2, "0")}-${String(built.getDate()).padStart(2, "0")} ${String(built.getHours()).padStart(2, "0")}:${String(built.getMinutes()).padStart(2, "0")}`;
    const shared = new Map(A.sharedResources.map((r) => [r.name, r]));
    // 目标文件按模块归并
    const modules = new Map();
    for (const o of IM.objects) {
      const key = fileById.get(o.sourcePath)?.module ?? (o.sourcePath ?? "").split("/").slice(0, 2).join("/") ?? "?";
      const row = modules.get(key) ?? { module: key, files: 0, code: 0, ro: 0, rw: 0, zi: 0, objects: [] };
      row.files += 1; row.code += o.codeBytes; row.ro += o.roDataBytes; row.rw += o.rwDataBytes; row.zi += o.ziDataBytes; row.objects.push(o);
      modules.set(key, row);
    }
    const rows = [...modules.values()].map((r) => ({ ...r, rom: r.code + r.ro + r.rw, ram: r.rw + r.zi }));
    const key = (r) => ({ module: r.module, files: r.files, code: r.code, ro: r.ro, rw: r.rw, zi: r.zi, rom: r.rom, ram: r.ram }[mem.sort]);
    rows.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === "string" ? String(x).localeCompare(String(y)) : x - y) * mem.dir; });
    const maxRam = Math.max(1, ...rows.map((r) => r.ram)), maxRom = Math.max(1, ...rows.map((r) => r.rom));
    const th = (id, label, num = true) => `<th class="${num ? "num" : ""} sortable ${mem.sort === id ? "on" : ""}" data-msort="${id}">${label}</th>`;
    const modTable = `<table class="mem-table"><tr>${th("module", "模块", false)}${th("files", "文件")}${th("code", "Code")}${th("ro", "RO Data")}${th("rw", "RW Data")}${th("zi", "ZI Data")}${th("rom", "ROM")}${th("ram", "RAM")}<th>占比</th></tr>${rows.map((r) => `<tr><td>${esc(r.module)}</td><td class="num">${r.files}</td><td class="num">${fmtBytes(r.code)}</td><td class="num">${fmtBytes(r.ro)}</td><td class="num">${fmtBytes(r.rw)}</td><td class="num">${fmtBytes(r.zi)}</td><td class="num"><b>${fmtBytes(r.rom)}</b></td><td class="num"><b>${fmtBytes(r.ram)}</b></td><td class="mem-barcell"><span class="mem-bar rom" style="width:${(r.rom / maxRom) * 46}%"></span><span class="mem-bar ram" style="width:${(r.ram / maxRam) * 46}%"></span></td></tr>`).join("")}</table>`;

    // 大对象榜：只列占空间的数据符号
    const data = IM.symbols.filter((x) => x.kind !== "code");
    const skey = (x) => ({ size: x.sizeBytes, name: x.name, section: x.section ?? "", file: x.sourcePath ?? "" }[mem.ssort]);
    const top = data.slice().sort((a, b) => { const x = skey(a), y = skey(b); return typeof x === "string" ? String(x).localeCompare(String(y)) : y - x; }).slice(0, 40);
    const lineOf = (id) => { const m = /^variable:(.+):(\d+):[^:]+$/.exec(id ?? ""); return m ? Number(m[2]) : null; };
    const sth = (id, label, num = true) => `<th class="${num ? "num" : ""} sortable ${mem.ssort === id ? "on" : ""}" data-ssort="${id}">${label}</th>`;
    const symTable = `<table class="mem-table"><tr>${sth("name", "符号", false)}${sth("section", "段", false)}${sth("size", "字节")}${sth("file", "定义处", false)}<th>模块</th><th>并发</th></tr>${top.map((x) => {
      const r = shared.get(x.name);
      const line = lineOf(x.symbolId);
      const isr = r?.units?.some((u) => u.unitKind === "isr");
      return `<tr><td><code>${esc(x.name)}</code>${x.scope === "global" ? "" : ' <span class="sub">static</span>'}</td><td><span class="mem-sec ${esc((x.section ?? "").replace(/^\./, "").split(".")[0])}">${esc(x.section ?? "?")}</span></td><td class="num"><b>${fmtBytes(x.sizeBytes)}</b></td><td>${x.sourcePath ? `<a class="sg-line" href="${esc(codeHref(x.sourcePath, line))}">${esc(x.sourcePath.split("/").pop())}${line ? `:${line}` : ""}</a>` : `<span class="sub">目标文件 ${esc(x.object)}</span>`}</td><td class="sub">${esc(fileById.get(x.sourcePath)?.module ?? "?")}</td><td>${r ? `<span class="pill ${isr ? "isr" : "task"}">${r.units.length} 个单元</span>${r.atomicity === "composite" && x.kind !== "ro-data" ? ' <span class="sub">整体读写非原子</span>' : ""}` : '<span class="sub">单单元</span>'}</td></tr>`;
    }).join("")}</table>`;

    const sharedBytes = data.filter((x) => shared.has(x.name)).reduce((n, x) => n + x.sizeBytes, 0);
    const link = (label, value, sub, href, bad) => (href ? `<a class="tbc${bad ? " bad" : ""}" href="${esc(href)}"><b>${value}</b><span>${sub}</span></a>` : `<div class="${bad ? "bad" : ""}"><b>${value}</b><span>${sub}</span></div>`);
    const cards = `<div class="brief rm-brief">
      ${link("rom", fmtBytes(tt.romBytes ?? 0), "镜像 ROM · Code + RO + RW", codeHref(IM.artifact.path))}
      ${link("ram", fmtBytes(tt.ramBytes ?? 0), "镜像 RAM · RW + ZI", codeHref(IM.artifact.path))}
      <div><b>${fmtBytes(sc.romBytes ?? 0)}</b><span>本区 ROM · ${sc.objects ?? 0} 个目标文件</span></div>
      <div><b>${fmtBytes(sc.ramBytes ?? 0)}</b><span>本区 RAM · ZI ${fmtBytes(sc.ziDataBytes ?? 0)}</span></div>
      <div><b>${fmtBytes(sharedBytes)}</b><span>多单元共享的数据 · ${data.filter((x) => shared.has(x.name)).length} 个符号</span></div>
      ${link("art", `<span class="mem-art">${esc(String(IM.artifact.path).split("/").pop())}</span>`, `产物 · ${stamp} · ${esc(IM.artifact.kind)}`, codeHref(IM.artifact.path))}
      ${link("stale", String(st.sourcesNewerThanImage ?? 0), "源码新于产物的文件", null, (st.sourcesNewerThanImage ?? 0) > 0)}
      <div><b>${st.filesNotInImage ?? 0}</b><span>源文件没进镜像</span></div>
    </div>`;
    panel.innerHTML = `<div class="entries">${cards}
      <h2>模块占用 <small>尺寸来自产物，模块归属来自源码事实（目标文件按它定义的函数名反查源文件，${IM.objects.filter((o) => o.match === "functions").length}/${IM.objects.length} 由函数名确定）</small></h2>
      ${modTable}
      <h2>数据符号 <small>前 40，按字节</small></h2>
      ${symTable}
      <details class="mem-more"><summary><b>产物与源码的差异</b> <span class="sub">${st.functionsInlinedOrDiscarded ?? 0} 个函数被内联或丢弃 · ${st.filesNotInImage ?? 0} 个源文件没进镜像 · ${st.objectsUnmatched ?? 0} 个目标文件未归属</span></summary>
        <p class="sub">源码新于产物：${(st.sourcesNewerSample ?? []).map((x) => `<code>${esc(x)}</code>`).join("、") || "无"}</p>
        <p class="sub">没进镜像的源文件（样本）：${(st.filesNotInImageSample ?? []).map((x) => `<code>${esc(x)}</code>`).join("、") || "无"}</p>
        <p class="sub">${(IM.approximations ?? []).map(esc).join("<br>")}</p></details></div>`;
    panel.querySelectorAll("[data-msort]").forEach((el) => el.addEventListener("click", () => { const id = el.dataset.msort; mem.dir = mem.sort === id ? -mem.dir : -1; mem.sort = id; renderMemory(); }));
    panel.querySelectorAll("[data-ssort]").forEach((el) => el.addEventListener("click", () => { mem.ssort = el.dataset.ssort; renderMemory(); }));
  }
