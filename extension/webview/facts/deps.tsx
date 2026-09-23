// 依赖主题的视图：一张分层 DSM。
//
// 分组树、嵌套排序、聚合边全部来自 packages/facts-view 的派生模块，这里只画和交互。
// 那个模块同时被宿主和 MCP 用，所以画出来的和 Agent 读到的必然是同一批对象。
//
// 格子只有颜色：有没有、正向还是反向、什么性质；轻重用深浅三档。数字在悬浮和明细里。
// 格子固定 20×20，多了就滚，行列头冻结。

import { t } from "../../../packages/facts-view/src/i18n.mjs";
import { useContext, useEffect, useMemo, useState } from "react";
import * as Deps from "../../../packages/facts-view/src/deps/model.mjs";
import { Inspector, Rail, UiContext } from "./slots.tsx";
import type { Declarations, DepBlock, DepEdge, DependenciesTheme, EdgeDetail } from "../../../packages/facts-view/src/deps/model.d.mts";

const CELL = 20;
const INDENT = 12;
const HEAD_W = 300;
const HEAD_H = 120;

export interface DepsProps {
  theme: DependenciesTheme;
  declarations: Declarations;
  onDeclare: (next: Declarations) => void;
  onOpenFile: (path: string | null | undefined, line?: number | null) => void;
  onCopyId: (id: string) => void;
  onRequestDetail: (edge: DepEdge, sourceFiles: string[], targetFiles: string[]) => void;
  detail: { edgeId: string; data: EdgeDetail } | null;
  selectId: string | null;
}

const ROLE_ORDER = ["includes", "calls", "types", "macros", "reads", "writes"] as const;

export function Dependencies(props: DepsProps) {
  const { theme, declarations } = props;
  // 分组方式、展开了哪些组、搜索词是跨栏的：工具条在侧栏，DSM 在舞台
  const { ui, patch } = useContext(UiContext);
  const kind = ui.deps.kind;
  const setKind = (next: "dir" | "cluster") => patch({ deps: { ...ui.deps, kind: next, open: null } });
  const open = useMemo(() => (ui.deps.open ? new Set(ui.deps.open) : null), [ui.deps.open]);
  const setOpen = (next: Set<string> | null) => patch({ deps: { ...ui.deps, open: next ? [...next] : null } });
  const [selected, setSelected] = useState<string | null>(null);
  const search = ui.deps.search;
  const setSearch = (next: string) => patch({ deps: { ...ui.deps, search: next } });
  // 回放：停在排序算法的第 k 步。每一步派生层都记在 seq.steps 里，这里不重算，只是取一个前缀。
  // 行列是带 key 的元素，重排时 React 复用同一个 DOM 节点，CSS transition 才有起点——
  // 原型是 innerHTML 重建节点，所以那边的动画从来没真正动过。
  const [playing, setPlaying] = useState<{ group: string; step: number } | null>(null);
  const [running, setRunning] = useState(false);

  const tree = useMemo(
    () => (kind === "cluster" && theme.clusters ? Deps.clusterTree(theme, declarations) : Deps.dirTree(theme, declarations)),
    [theme, declarations, kind],
  );
  const openSet = open ?? tree.defaultOpen();
  const layout = useMemo(
    () => Deps.layoutRows(theme, tree, openSet, { declarations, playing }),
    [theme, tree, openSet, declarations, playing],
  );

  const playBlock: DepBlock | null = playing ? layout.blocks.find((b) => b.group === playing.group) ?? null : null;
  const playTotal = playBlock ? playBlock.seq.steps.length : 0;
  // 自动播放：一步一个过渡时长，比 transition 略长一点，免得两步叠在一起看不清
  useEffect(() => {
    if (!running || !playing) return undefined;
    if (playing.step >= playTotal) { setRunning(false); return undefined; }
    const timer = setTimeout(() => setPlaying({ group: playing.group, step: playing.step + 1 }), 620);
    return () => clearTimeout(timer);
  }, [running, playing, playTotal]);


  if (!theme.available) return <p className="empty">{theme.hint ?? t("This scan has no dependency-order facts.")}</p>;

  const byUnit = new Map(theme.leaves.map((l) => [l.unit, l]));
  const label = (row: string) => (tree.isGroup(row) ? tree.label(row) : byUnit.get(row)?.label ?? row);
  const filesUnder = (row: string) => layout.rowsUnder(row).flatMap((r) => byUnit.get(r)?.members ?? []);
  const leafCount = new Map<string, number>();
  for (const leaf of theme.leaves) { const r = layout.rowOf(leaf.unit); if (r) leafCount.set(r, (leafCount.get(r) ?? 0) + 1); }
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const e of layout.edges) { outDeg.set(e.s, (outDeg.get(e.s) ?? 0) + 1); inDeg.set(e.t, (inDeg.get(e.t) ?? 0) + 1); }

  const weights = layout.edges.map(Deps.edgeWeight).sort((a, b) => a - b);
  const q1 = weights[Math.floor(weights.length / 3)] ?? 0;
  const q2 = weights[Math.floor((weights.length * 2) / 3)] ?? 0;
  const tone = (e: DepEdge) => { const w = Deps.edgeWeight(e); return w > q2 ? 1 : w > q1 ? 0.78 : 0.55; };

  const stopPlay = () => { setPlaying(null); setRunning(false); };
  const startPlay = (group: string) => {
    if (playing?.group === group) { setRunning(!running); return; }
    setPlaying({ group, step: 0 });
    setRunning(true);
  };
  // 这一步为什么这么排。剥离和撕开是两种不同的动作，说法要分开，不能都叫「排好了」
  const why = (step: DepBlock["seq"]["steps"][number] | undefined) => {
    if (!step) return <>{t("Initial: alphabetical")}</>;
    const name = label(step.node);
    if (step.kind === "sink") return <>{t("Row {name} has no cells among the remaining elements of the block (depends on nobody) → moved to the bottom", { name })}</>;
    if (step.kind === "source") return <>{t("Column {name} has no cells among the remaining elements of the block (nobody depends on it) → moved to the top", { name })}</>;
    return (
      <>
        {t("{n} left that depend on each other, nothing more to peel → tear off {name}, the one with the largest out-degree minus in-degree", { n: step.block, name })}
        {t("(depends on {out}, depended on by {in}{weight}) → moved to the top", { out: step.out, in: step.in, weight: step.weight != null ? `, ${t("out-weight minus in-weight")} ${step.weight}` : "" })}
      </>
    );
  };

  const toggle = (group: string) => {
    stopPlay();
    const next = new Set(openSet);
    if (next.has(group)) {
      next.delete(group);
      for (const g of [...next]) { let p = tree.parent(g); while (p != null) { if (p === group) { next.delete(g); break; } p = tree.parent(p); } }
    } else next.add(group);
    setOpen(next);
  };

  const declare = (patch: Partial<Declarations>) => props.onDeclare({ ...declarations, ...patch });
  const pin = (row: string, side: "top" | "bottom") => {
    const list = [...(declarations[side] ?? [])];
    const other = side === "top" ? "bottom" : "top";
    const i = list.indexOf(row);
    if (i >= 0) list.splice(i, 1); else list.push(row);
    declare({ [side]: list, [other]: (declarations[other] ?? []).filter((x) => x !== row) } as Partial<Declarations>);
  };
  const declaredCount = declarations.top.length + declarations.bottom.length + Object.keys(declarations.regroup).length + declarations.invert.length + Object.keys(declarations.names).length;

  const width = HEAD_W + layout.order.length * CELL;
  const height = HEAD_H + layout.order.length * CELL;
  const cellClass = (e: DepEdge) => [
    "dm-cell cell",
    layout.feedback.has(e.id) ? "back" : "",
    layout.inverted.has(e.id) ? "plan" : "",
    e.includes === 0 ? "bypass" : e.calls === 0 ? "typeonly" : "",
    selected && (e.s === selected || e.t === selected) ? "hl" : selected ? "dim" : "",
  ].filter(Boolean).join(" ");
  const cellTitle = (e: DepEdge) =>
    `${label(e.s)} → ${label(e.t)} · include ${e.includes} · ${t("calls")} ${e.calls}`
    + (e.types ? ` · ${t("types")} ${e.types}` : "") + (e.macros ? ` · ${t("macros")} ${e.macros}` : "")
    + (e.reads ? ` · ${t("reads")} ${e.reads}` : "") + (e.writes ? ` · ${t("writes")} ${e.writes}` : "")
    + ` · ${t("{n} file pairs", { n: e.pairs.length })} · ${t("click for details")}`;

  const rootBlock = layout.blocks.find((b) => b.group === Deps.ROOT) ?? null;

  // 切割集：当前视图里的反向边。剪掉它们剩下的就是 DAG，所以这张表就是「要动哪几处」的清单。
  // 折叠层级不同，切割集也不同——它说的是这个视图下的代价，不是全工程的
  const cut = layout.edges.filter((e) => layout.feedback.has(e.id)).sort((a, b) => (b.includes + b.calls) - (a.includes + a.calls));
  const pairsOf = (e: DepEdge) =>
    Object.entries(e.files).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k, n]) => `${k.split("→").map((f) => f.split("/").pop()).join(" → ")}（${n}）`)
      .join("、");

  const detail = props.detail;
  const detailEdge = detail ? layout.edges.find((e) => e.id === detail.edgeId) : null;

  return (
    <div className="board wide deps">
      <Rail><div className="deps-bar">
        <span className="segmented">
          <button className={kind === "dir" ? "on" : ""} onClick={() => { setKind("dir"); stopPlay(); }} title={t("Group by directory — the boxes people drew")}>{t("Directory")}</button>
          {theme.clusters && <button className={kind === "cluster" ? "on" : ""} onClick={() => { setKind("cluster"); stopPlay(); }} title={t("Group by cluster — computed from the edges; an inference, not a fact")}>{t("Cluster")}</button>}
        </span>
        <span className="segmented">
          <button onClick={() => { setOpen(tree.allOpen()); stopPlay(); }}>{t("Expand all")}</button>
          <button onClick={() => { setOpen(tree.defaultOpen()); stopPlay(); }}>{t("Collapse")}</button>
        </span>
        <input placeholder={t("Search names")} value={search} onChange={(event) => setSearch(event.target.value)} />
        <span className="sub">
          {t("Units")} {theme.leaves.length}
          {theme.pairedUnits ? ` (${t("{n} .c/.h pairs merged", { n: theme.pairedUnits })})` : ""}
          {` · ${t("back edges")} `}
          <b className={layout.feedback.size ? "bad" : ""}>{t("blocked")} {layout.feedback.size}</b>
          {` · ${t("flat")} ${layout.flat.feedback.size} · ${t("whole project")} ${theme.projectFeedback ?? 0}`}
        </span>
        {declaredCount > 0 && (
          <span className="declared-chip">
            {t("Declarations")} {declaredCount}
            <button className="link" onClick={() => props.onDeclare({ top: [], bottom: [], regroup: {}, invert: [], names: {} })}>{t("Clear")}</button>
          </span>
        )}
      </div></Rail>

      {playBlock && (
        <div className="dm-play">
          <button onClick={() => setRunning(!running)}>{running ? `⏸ ${t("Pause")}` : `▶ ${t("Continue")}`}</button>
          <button onClick={() => { setRunning(false); setPlaying({ group: playBlock.group, step: Math.max(0, playing!.step - 1) }); }}>◀</button>
          <button onClick={() => { setRunning(false); setPlaying({ group: playBlock.group, step: Math.min(playTotal, playing!.step + 1) }); }}>▶</button>
          <input
            type="range" min={0} max={playTotal} value={playing!.step}
            onChange={(event) => { setRunning(false); setPlaying({ group: playBlock.group, step: Number(event.target.value) }); }}
          />
          <span className="why">
            {playBlock.group === Deps.ROOT ? t("top level") : tree.label(playBlock.group)} · {t("step {i} of {n}", { i: playing!.step, n: playTotal })} · {why(playBlock.seq.steps[playing!.step - 1])}
          </span>
          <button onClick={stopPlay}>{t("Stop")}</button>
        </div>
      )}

      <div className="dm-wrap">
        <div className="dm-grid" style={{ width, height }}>
          <div className="dm-layer-cols" style={{ width, height: HEAD_H }}>
            <div className="dm-corner" style={{ width: HEAD_W, height: HEAD_H }}>
              <button
                className="dm-corner-play"
                title={t("Replay the top-level ordering: {n} steps, {peel} peels · {tear} tears", { n: rootBlock?.seq.steps.length ?? 0, peel: rootBlock?.seq.steps.filter((x) => x.kind !== "tear").length ?? 0, tear: rootBlock?.seq.steps.filter((x) => x.kind === "tear").length ?? 0 })}
                onClick={() => startPlay(Deps.ROOT)}
              >
                {running && playing?.group === Deps.ROOT ? "⏸" : "▶"}
              </button>
              <div className="dm-legend">
                <span className="dm-legend-h">{t("row = dependent · column = depended on · shade = weight")}</span>
                <span><i className="dep" />{t("depends")}</span>
                <span><i className="back" />{t("back (the edge that closes a cycle)")}</span>
                <span><i className="bypass" />{t("call without include")}</span>
                <span><i className="typeonly" />{t("include without call")}</span>
                <span><i className="plan" />{t("planned inversion (Alt+click)")}</span>
                <span>▸ {t("expand · bar = expanded group")}</span>
              </div>
            </div>
            {layout.order.map((row) => (
              <div
                key={row}
                className={`dm-col ${selected === row ? "sel" : ""} ${search && label(row).toLowerCase().includes(search.toLowerCase()) ? "hit" : ""} ${tree.isGroup(row) ? "dir" : ""}`}
                style={{ width: CELL, height: HEAD_H, transform: `translate(${HEAD_W + layout.pos.get(row)! * CELL}px,0)` }}
                onClick={() => (tree.isGroup(row) ? toggle(row) : setSelected(selected === row ? null : row))}
              >
                <span>{label(row)}</span>
              </div>
            ))}
          </div>
          <div className="dm-body" style={{ width, height: height - HEAD_H }}>
            <div className="dm-layer-rows" style={{ width: HEAD_W, height: height - HEAD_H }}>
              {layout.order.map((row) => (
                <div
                  key={row}
                  className={`dm-row ${selected === row ? "sel" : ""} ${layout.pending.has(row) ? "pending" : ""} ${tree.isGroup(row) ? "dir" : ""} ${declarations.top.includes(row) || declarations.bottom.includes(row) ? "declared" : ""}`}
                  style={{ height: CELL, width: HEAD_W, transform: `translate(0,${layout.pos.get(row)! * CELL}px)`, paddingLeft: 6 + layout.depthOf(row) * INDENT }}
                  onClick={() => setSelected(selected === row ? null : row)}
                >
                  {tree.isGroup(row)
                    ? <b className="dm-tog" onClick={(event) => { event.stopPropagation(); toggle(row); }} title={t("Expand")}>▸</b>
                    : <i style={{ background: "var(--pos)" }} />}
                  <span title={tree.isGroup(row) ? row : (byUnit.get(row)?.members ?? []).join(" + ")}>{label(row)}</span>
                  <small>
                    {tree.isGroup(row)
                      ? `${t("{n} units", { n: leafCount.get(row) ?? 0 })}${layout.inner.get(row) ? ` · ${t("{n} inner edges", { n: layout.inner.get(row) })}` : ""}`
                      : `L${layout.flat.level.get(row) ?? 0}`}
                    {` · ${outDeg.get(row) ?? 0}→ ←${inDeg.get(row) ?? 0}`}
                  </small>
                  <button className="dm-pin" onClick={(event) => { event.stopPropagation(); pin(row, "top"); }} title={t("Pin to the top of the block (declaration)")}>⤒</button>
                  <button className="dm-pin" onClick={(event) => { event.stopPropagation(); pin(row, "bottom"); }} title={t("Pin to the bottom of the block (declaration)")}>⤓</button>
                </div>
              ))}
              {layout.blocks.filter((b) => b.group !== Deps.ROOT).map((b) => (
                <div
                  key={`band-${b.group}`}
                  className={`dm-band d${b.depth % 3}`}
                  title={`${tree.label(b.group)} · ${t("click to collapse")}`}
                  style={{ left: 2 + (b.depth - 1) * INDENT, top: b.first * CELL, width: INDENT - 3, height: (b.last - b.first + 1) * CELL - 1 }}
                  onClick={() => toggle(b.group)}
                >
                  {(b.last - b.first + 1) * CELL > 40 && b.seq.steps.length > 0 && (
                    <button
                      className="dm-band-play"
                      title={t("Replay the ordering inside this block: {n} steps", { n: b.seq.steps.length })}
                      onClick={(event) => { event.stopPropagation(); startPlay(b.group); }}
                    >
                      {running && playing?.group === b.group ? "⏸" : "▶"}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {layout.blocks.filter((b) => b.group !== Deps.ROOT).map((b) => (
              <div key={`block-${b.group}`} className={`dm-block d${b.depth % 3}`} style={{ transform: `translate(${HEAD_W + b.first * CELL}px,${b.first * CELL}px)`, width: (b.last - b.first + 1) * CELL, height: (b.last - b.first + 1) * CELL }} />
            ))}
            {layout.edges.map((e) => (
              <div
                key={e.id}
                className={cellClass(e)}
                title={cellTitle(e)}
                style={{ width: CELL - 1, height: CELL - 1, opacity: tone(e), transform: `translate(${HEAD_W + layout.pos.get(e.t)! * CELL}px,${layout.pos.get(e.s)! * CELL}px)` }}
                onClick={(event) => {
                  if (event.altKey) {
                    const list = [...declarations.invert];
                    const i = list.indexOf(e.id);
                    if (i >= 0) list.splice(i, 1); else list.push(e.id);
                    declare({ invert: list });
                    return;
                  }
                  props.onRequestDetail(e, filesUnder(e.s), filesUnder(e.t));
                }}
              />
            ))}
            {layout.order.map((row) => (
              <div key={`diag-${row}`} className="dm-cell diag" style={{ width: CELL - 1, height: CELL - 1, transform: `translate(${HEAD_W + layout.pos.get(row)! * CELL}px,${layout.pos.get(row)! * CELL}px)` }} />
            ))}
          </div>
        </div>
      </div>

      <details className="dp-more" open={cut.length > 0 && cut.length <= 12}>
        <summary>
          <b>{t("Cut set")}</b>
          <span className="sub"> {t("Cut these edges and what remains is a DAG")} · {t("current view")} {cut.length}</span>
        </summary>
        {cut.length === 0
          ? <p className="sub">{t("The current view has no back edges.")}</p>
          : (
            <table className="dp-table">
              <thead>
                <tr>
                  <th>{t("Back edge (click for details)")}</th>
                  <th className="num">include</th><th className="num">{t("calls")}</th>
                  <th className="num">{t("types")}</th><th className="num">{t("macros")}</th>
                  <th>{t("Caused by which file pairs (top 4, by include + calls)")}</th>
                </tr>
              </thead>
              <tbody>
                {cut.map((e) => (
                  <tr key={e.id} className="dp-edge-row" onClick={() => props.onRequestDetail(e, filesUnder(e.s), filesUnder(e.t))}>
                    <td><b>{label(e.s)}</b> → {label(e.t)}</td>
                    <td className="num">{e.includes}</td><td className="num">{e.calls}</td>
                    <td className="num">{e.types}</td><td className="num">{e.macros}</td>
                    <td className="sub">{pairsOf(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </details>

      {detail && detailEdge && <Inspector><EdgeDetailPane edge={detailEdge} label={label} data={detail.data} onOpenFile={props.onOpenFile} onCopyId={props.onCopyId} /></Inspector>}
      {!detail && <p className="sub hint">{t("Click a cell to see what makes up the edge; Alt+click to mark a planned inversion. Click a row or column header to select; click a group name in the column header to collapse. ▶ at the top-left replays the top-level ordering; ▶ on the bar left of a block replays that block.")}</p>}
    </div>
  );
}

function EdgeDetailPane({ edge, label, data, onOpenFile, onCopyId }: { edge: DepEdge; label: (id: string) => string; data: EdgeDetail; onOpenFile: DepsProps["onOpenFile"]; onCopyId: DepsProps["onCopyId"] }) {
  const short = (p: string) => p.split("/").pop();
  const counts: Record<(typeof ROLE_ORDER)[number], number> = {
    includes: edge.includes, calls: edge.calls, types: edge.types, macros: edge.macros, reads: edge.reads, writes: edge.writes,
  };
  const LABEL: Record<string, string> = { includes: "include", calls: "calls", types: "types", macros: "macros", reads: "reads", writes: "writes" };
  return (
    <div className="detail">
      <div className="detail-head">
        <b><code>{label(edge.s)}</code> → <code>{label(edge.t)}</code></b>
        <span className="sub">{ROLE_ORDER.filter((k) => counts[k]).map((k) => `${t(LABEL[k])} ${counts[k]}`).join(" · ")} · {t("{n} file pairs", { n: edge.pairs.length })}</span>
        <button className="ghost" onClick={() => onCopyId(edge.id)}>{t("Copy reference")}</button>
      </div>
      {data.includes.length > 0 && (
        <details open><summary><b>include</b> <span className="sub">{data.includes.length}</span></summary>
          {data.includes.map((i) => (
            <div key={`${i.s}→${i.t}`} className="line">
              <button className="link" onClick={() => onOpenFile(i.s)}>{short(i.s)}</button> → <button className="link" onClick={() => onOpenFile(i.t)}>{short(i.t)}</button>
            </div>
          ))}
        </details>
      )}
      {data.calls.length > 0 && (
        <details open><summary><b>{t("Calls")}</b> <span className="sub">{data.calls.length}</span></summary>
          {data.calls.map((c) => (
            <div key={`${c.from}→${c.to}`} className="line">
              <code>{c.fromName}</code> → <code>{c.toName}</code>
              <span className="sub"> {c.lines.slice(0, 6).map((l) => <button key={l} className="link" onClick={() => onOpenFile(c.file, l)}>:{l}</button>)}</span>
            </div>
          ))}
        </details>
      )}
      {data.types.length > 0 && (
        <details open><summary><b>{t("Types")}</b> <span className="sub">{data.types.length}</span></summary>
          {data.types.map((ty) => (
            <div key={ty.type} className="line">
              <code>{ty.type}</code>
              <button className="link" onClick={() => onOpenFile(ty.def.path, ty.def.line)}>{short(ty.def.path)}:{ty.def.line}</button>
              <span className="sub"> {Object.entries(ty.roles).map(([role, n]) => `${t(role)} ${n}`).join(", ")} · {t("{n} functions", { n: ty.functions })}</span>
            </div>
          ))}
        </details>
      )}
      {data.macros.length > 0 && (
        <details open><summary><b>{t("Macros")}</b> <span className="sub">{data.macros.length}</span></summary>
          {data.macros.map((m) => (
            <div key={m.macro} className="line">
              <code>{m.macro}</code>
              <button className="link" onClick={() => onOpenFile(m.def.path, m.def.line)}>{short(m.def.path)}:{m.def.line}</button>
              <span className="sub"> {t("used {n} times in {files} files", { n: m.n, files: m.files })}</span>
            </div>
          ))}
        </details>
      )}
      {(["reads", "writes"] as const).map((key) => data[key].length > 0 && (
        <details open key={key}><summary><b>{key === "reads" ? t("Reads") : t("Writes")}</b> <span className="sub">{data[key].length}</span></summary>
          {data[key].map((v) => (
            <div key={v.name} className="line">
              <code>{v.name}</code>
              <button className="link" onClick={() => onOpenFile(v.path, v.line)}>{short(v.path)}{v.line ? `:${v.line}` : ""}</button>
              <span className="sub"> {t("{n} functions", { n: v.functions })} · {t("{n} times", { n: v.n })}</span>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}
