// 共享与并发主题的视图：变量 × 执行单元的矩阵。
//
// 三条口径要写在界面上，不能靠人自己知道：
//   冲突是候选不是结论，跨函数和条件性的保护引擎看不见；
//   通知标志是设计意图，长得像竞争但不是；
//   未识别的保护不等于没有保护。

import { t } from "../../../packages/facts-view/src/i18n.mjs";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { FLOW_LABEL, layoutRunMap } from "../../../packages/facts-view/src/concurrency/runmap.mjs";
import { Inspector, Rail, UiContext, type Ui } from "./slots.tsx";
import type { RunMapLayout, RunMapModel, RunMapNode } from "../../../packages/facts-view/src/concurrency/runmap.d.mts";
import type { ConcurrencyResource, ConcurrencyTheme, ResourceSides } from "../../../packages/facts-view/src/concurrency/model.d.mts";

export interface ConcurrencyProps {
  theme: ConcurrencyTheme;
  sides: ResourceSides | null;
  onOpenFile: (path: string | null | undefined, line?: number | null) => void;
  onCopyId: (id: string) => void;
  onRequestSides: (name: string) => void;
}

const UNIT_LABEL: Record<string, string> = { isr: "interrupt", task: "task", callback: "callback", timer: "timer", main: "main" };
const GLYPH: Record<string, string> = { w: "W", r: "R", rw: "RW", addr: "&" };
const ACCESS_LABEL: Record<string, string> = { read: "read", write: "write", read_write: "read/write", address_taken: "address taken" };


const FLOW_KEYS = ["isr→thread", "thread→isr", "mixed", "isr↔isr", "thread↔thread"] as const;
const PROBLEM_LABEL: Record<string, string> = { conflict: "unprotected write conflict", pollution: "interrupt and thread both write", mismatch: "one-sided protection", nonAtomic: "cross-context non-atomic", wake: "notification flag" };
const RHYTHM: Record<string, string> = { periodic: "periodic", "busy-poll": "busy-poll", "event-driven": "event-driven", "one-shot": "one-shot", unknown: "unknown" };

/**
 * 运行图：上排中断、下排线程，中间三层变量，写方 → 变量实线箭头，变量 → 读方细线。
 * 模型和布局来自派生层，这里只画和交互。
 *
 * 画布的状态只由两件事决定：在哪一页（全景 / 某个单元的页）、选中了谁（单元或变量）。
 * 单击 = 选中并高亮，布局不动；进单元页是侧栏里的明确动作（或双击节点）；回退只有面包屑里的「全景」。
 * 筛选和显隐是侧栏的事，改了侧栏画布跟着淡化或重排。
 * 视口是固定高度的：布局先按内容算，再缩放到视口里；滚轮缩放走原生非 passive 监听，
 * 不然 React 的 wheel 是 passive 的，阻止不了外层页面跟着滚。
 */
const LEGEND: Array<{ cls: string; label: string }> = [
  { cls: "conflict", label: "unprotected write conflict" },
  { cls: "pollution", label: "interrupt and thread both write" },
  { cls: "wake", label: "notification flag" },
  { cls: "shared", label: "shared, no finding" },
];

function RunMap({ model, ui, patchConc, onPickVar, selectedVar }: { model: RunMapModel; ui: Ui["conc"]; patchConc: (patch: Partial<Ui["conc"]>) => void; onPickVar: (name: string) => void; selectedVar: string | null }) {
  const page = ui.page;
  const filter = ui.filter;
  const expandIdle = ui.showIdle;
  const focusUnit = ui.unit;
  const [view, setView] = useState<{ x: number; y: number; k: number } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [hoverUnit, setHoverUnit] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 900, h: 480 });
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const layout = useMemo(() => layoutRunMap(model, { page, filter, expandIdle }), [model, page, filter, expandIdle]);

  // 视口尺寸跟着容器走；布局按内容算，缩放到视口里
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setBox({ w: Math.max(320, el.clientWidth), h: Math.max(240, el.clientHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 适配按高度：几十个单元的全景横向铺很宽，按宽度适配就是一条看不清的带子。
  // 高度填满视口，宽度超出的靠平移；侧栏里点谁，画布就把谁挪到中间
  const fitView = useMemo(() => {
    const k = Math.min((box.h - 24) / layout.height, 1.4);
    const wide = layout.width * k > box.w - 24;
    return { k, x: wide ? 12 : (box.w - layout.width * k) / 2, y: (box.h - layout.height * k) / 2, wide };
  }, [box, layout]);
  const current = view ?? fitView;
  // 换页或换筛选就回到适配：上一页的平移对新布局没有意义
  useEffect(() => { setView(null); }, [page, filter, expandIdle]);
  // 选中单元：水平方向把它挪到视口中间（缩放不变），宽图上这就是导航
  useEffect(() => {
    if (!focusUnit) return;
    const node = [...layout.isrs, ...layout.threads].find((n) => n.id === focusUnit);
    if (!node) return;
    const cur = viewRef.current ?? fitView;
    if (!fitView.wide && !viewRef.current) return;
    setView({ k: cur.k, x: box.w / 2 - node.x * cur.k, y: cur.y });
  }, [focusUnit]);

  // 滚轮缩放：原生监听、非 passive，只在光标落在画布上时接管，页面不再跟着滚
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const f = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const r = el.getBoundingClientRect();
      const px = event.clientX - r.left, py = event.clientY - r.top;
      const cur = viewRef.current ?? fitView;
      const k = Math.min(6, Math.max(0.1, cur.k * f));
      setView({ k, x: px - (px - cur.x) * (k / cur.k), y: py - (py - cur.y) * (k / cur.k) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fitView]);

  if (model.vars.length === 0) return null;

  const units = [...layout.isrs, ...layout.threads];
  const selectedVarId = selectedVar ? layout.vars.find((v) => v.name === selectedVar)?.id ?? null : null;
  const litUnit = hoverUnit ?? focusUnit;
  const edgeOn = (e: RunMapLayout["edges"][number]) => (selectedVarId ? e.var === selectedVarId : litUnit ? e.unit === litUnit : true);
  const transform = `translate(${current.x},${current.y}) scale(${current.k})`;
  const nodeTitle = (n: RunMapNode) => `${n.name} · ${t("touches {n} shared variables, writes {w}", { n: n.touches, w: n.writes })}${n.kind === "callback" ? (n.host ? ` · ${t("host")} ${n.host.split(":").pop()}` : n.hosts?.length ? ` · ${t("{n} possible hosts", { n: n.hosts.length })}` : ` · ${t("host unknown")}`) : ""} · ${t("click to highlight, double-click to focus")}`;
  const rhythm = (n: RunMapNode) => (n.kind === "isr" ? (n.kernel ? t("kernel exception") : n.preempt == null ? t("priority unknown") : `${t("preempt")} ${n.preempt}`) : n.kind === "task" ? (n.periodMs != null ? `${n.periodMs} ms` : t(RHYTHM[n.mode ?? "unknown"] ?? n.mode ?? "")) : n.kind === "callback" ? t("callback") : n.kind);
  const pageName = layout.page?.name ?? null;

  return (
    <section className="runmap">
      <header className="rm-head">
        <b>{t("Run map")}</b>
        <nav className="rm-crumbs" aria-label={t("Where you are")}>
          <button className={`crumb ${page ? "" : "here"}`} disabled={!page} onClick={() => patchConc({ page: null })}>{t("Overview")}</button>
          {layout.page && <><span className="sub">›</span><span className="crumb here"><span className={`pill ${layout.page.kind}`}>{t(UNIT_LABEL[layout.page.kind] ?? layout.page.kind)}</span> <code>{pageName}</code></span></>}
          {filter && <span className="sub"> · {t("filtered")}: {t(FLOW_LABEL[filter as keyof typeof FLOW_LABEL] ?? PROBLEM_LABEL[filter] ?? filter)}</span>}
        </nav>
        <span className="rm-spacer" />
        {view && <span className="sub">{t("zoom")} {Math.round(current.k * 100)}%</span>}
        <button className="ghost" onClick={() => setView(null)} disabled={!view}>{t("Fit view")}</button>
      </header>
      {/* 图例放画布外面，不遮节点 */}
      <div className="rm-legend" aria-label={t("Legend")}>
          {LEGEND.map((item) => <span key={item.cls}><i className={`sw ${item.cls}`} />{t(item.label)}</span>)}
          <span><i className="sw isr" />{t("interrupt")}</span>
          <span><i className="sw callback" />{t("callback")}</span>
          <span><i className="sw arrow" />{t("writer → variable")}</span>
          <span><i className="sw line" />{t("variable → reader")}</span>
      </div>
      <div ref={host} className="rm-wrap">
        <svg
          viewBox={`0 0 ${box.w} ${box.h}`}
          width={box.w}
          height={box.h}
          onMouseDown={(e) => { if ((e.target as Element).closest("[data-unit],[data-var]")) return; setDrag({ x: e.clientX, y: e.clientY, vx: current.x, vy: current.y }); }}
          onMouseMove={(e) => { if (drag) setView({ k: current.k, x: drag.vx + (e.clientX - drag.x), y: drag.vy + (e.clientY - drag.y) }); }}
          onMouseUp={() => setDrag(null)}
          onMouseLeave={() => setDrag(null)}
          onClick={(e) => { if (e.target === e.currentTarget) patchConc({ unit: null }); }}
        >
          <defs>
            {["shared", "cross", "wake", "conflict", "pollution", "bad"].map((c) => (
              <marker key={c} id={`rm-arrow-${c}`} className={`rm-arrow ${c}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker>
            ))}
          </defs>
          <g transform={transform}>
            <text className="rm-label" x={layout.rowLabels.isr.x} y={layout.rowLabels.isr.y}>{layout.rowLabels.isr.text}</text>
            {layout.layers.map((l) => (
              <g key={l.index}>
                <rect className="rm-layer" x={l.x} y={l.top} width={l.width} height={l.height} rx={6} />
                <text className="rm-label" x={l.x + 6} y={l.top + 11}>{l.label} · {l.count}</text>
              </g>
            ))}
            <text className="rm-label" x={layout.rowLabels.thread.x} y={layout.rowLabels.thread.y}>{layout.rowLabels.thread.text}</text>
            {layout.edges.map((e, i) => (
              <path
                key={i}
                className={`rm-edge ${e.kind} ${e.bad ? "bad" : e.cls} ${edgeOn(e) ? "" : "dim"} ${(selectedVarId && e.var === selectedVarId) || (litUnit && e.unit === litUnit) ? "hi" : ""}`}
                d={e.d}
                markerEnd={e.kind === "write" ? `url(#rm-arrow-${e.bad ? "bad" : e.cls})` : undefined}
                strokeDasharray={e.kind === "both" ? "2 3" : undefined}
              >
                <title>{`${e.unit.split(":").pop()} ${e.kind === "write" ? t("writes") : e.kind === "both" ? t("reads and writes") : t("reads")} ${layout.vars.find((v) => v.id === e.var)?.name ?? ""}${e.bare ? ` (${t("unprotected")})` : ""}`}</title>
              </path>
            ))}
            {units.map((n) => (
              <g key={n.id} className={`rm-node ${n.kind} w-${n.worst} ${page === n.id ? "page" : ""} ${focusUnit === n.id ? "sel" : ""} ${litUnit && litUnit !== n.id && !selectedVarId ? "faded" : ""}`} data-unit={n.id} style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoverUnit(n.id)} onMouseLeave={() => setHoverUnit(null)}
                onClick={(e) => { e.stopPropagation(); patchConc({ unit: focusUnit === n.id ? null : n.id }); }}
                onDoubleClick={(e) => { e.stopPropagation(); patchConc({ page: n.id, unit: n.id }); }}>
                <title>{nodeTitle(n)}</title>
                <rect x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx={6} />
                <text className="rm-name" x={n.x} y={n.y - 3} textAnchor="middle">{n.name.length > 16 ? `${n.name.slice(0, 15)}…` : n.name}</text>
                <text className="rm-rhythm" x={n.x} y={n.y + 11} textAnchor="middle">{rhythm(n)}</text>
              </g>
            ))}
            {(["isr", "thread"] as const).map((kind) => layout.idle[kind] && (
              <g key={kind} className="rm-node idle" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); patchConc({ showIdle: true }); }}>
                <rect x={layout.idle[kind]!.x - layout.idle[kind]!.w / 2} y={layout.idle[kind]!.y - layout.idle[kind]!.h / 2} width={layout.idle[kind]!.w} height={layout.idle[kind]!.h} rx={6} strokeDasharray="4 3" />
                <text className="rm-rhythm" x={layout.idle[kind]!.x} y={layout.idle[kind]!.y + 4} textAnchor="middle">{t("{n} more touch no shared variable", { n: layout.idle[kind]!.count })}</text>
              </g>
            ))}
            {layout.vars.map((v) => (
              <g key={v.id} className={`rm-var ${v.cls} ${selectedVarId === v.id ? "sel" : ""} ${litUnit && !selectedVarId && !layout.edges.some((e) => e.var === v.id && e.unit === litUnit) ? "faded" : ""}`} data-var={v.id} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPickVar(v.name); }}>
                <title>{`${v.name} · ${t(FLOW_LABEL[v.flow as keyof typeof FLOW_LABEL] ?? v.flow)}${v.flags.multiWriter ? ` · ${t("multiple writers")} ×${v.flags.writerCount}` : v.owner ? ` · owner ${String(v.owner).split(":").pop()}` : ""}${v.flags.protectedAll ? ` · ${t("all recognized accesses are inside critical sections")}` : ""}${v.flags.nonAtomic ? ` · ${t("cross-context and non-atomic")}` : ""}`}</title>
                <rect x={v.x - v.w / 2} y={v.y} width={v.w} height={v.h} rx={4} />
                <text className="rm-vname" x={v.x} y={v.y + 15} textAnchor="middle">{v.name.length > 22 ? `${v.name.slice(0, 21)}…` : v.name}</text>
                {v.flags.multiWriter && <text className="rm-badge" x={v.x + v.w / 2 - 2} y={v.y + 3}>×{v.flags.writerCount}</text>}
                {v.flags.protectedAll && <text className="rm-lock" x={v.x - v.w / 2 + 2} y={v.y + 8}>🔒</text>}
                {v.flags.nonAtomic && <text className="rm-atom" x={v.x + v.w / 2 - 2} y={v.y + v.h - 2}>{t("non-atomic")}</text>}
              </g>
            ))}
          </g>
        </svg>
      </div>
      {!page && model.mainInit.length > 0 && (
        <p className="sub rm-main">{t("main writes {n} shared variables during initialization (not counted as runtime data flow)", { n: model.mainInit.length })}: {model.mainInit.slice().sort().map((n) => <button key={n} className="link" onClick={() => onPickVar(n)}><code>{n}</code></button>)}</p>
      )}
    </section>
  );
}

/** 侧栏：单元列表（单击高亮、「只看它」进页）、筛选、显隐。画布上不再放这些开关 */
function RunMapRail({ model, ui, patchConc }: { model: RunMapModel; ui: Ui["conc"]; patchConc: (patch: Partial<Ui["conc"]>) => void }) {
  const list = [...model.isrs, ...model.threads].filter((n) => model.used.includes(n.id) || ui.showIdle);
  const WORST_LABEL: Record<string, string> = { conflict: "conflict", pollution: "both write", mismatch: "one-sided protection", shared: "shared", idle: "no shared state" };
  const toggle = (key: string) => patchConc({ filter: ui.filter === key ? null : key });
  return (
    <div className="rm-rail">
      <div className="rm-rail-h"><b>{t("Units")}</b> <span className="sub">{t("{n} touch shared state", { n: model.used.length })}</span></div>
      <div className="rm-units">
        {list.map((n) => (
          <div key={n.id} className={`rm-unit ${ui.unit === n.id ? "sel" : ""} ${ui.page === n.id ? "page" : ""}`}>
            <button className="rm-unit-main" onClick={() => patchConc({ unit: ui.unit === n.id ? null : n.id })} title={t("Highlight it and what it touches; the layout stays")}>
              <i className={`dot w-${model.worst[n.id] ?? "idle"} ${n.kind}`} />
              <code>{n.name}</code>
              <span className="sub">{t(UNIT_LABEL[n.kind] ?? n.kind)} · {t(WORST_LABEL[model.worst[n.id] ?? "idle"])}</span>
            </button>
            <button className={`rm-unit-focus ${ui.page === n.id ? "on" : ""}`} onClick={() => patchConc({ page: ui.page === n.id ? null : n.id, unit: n.id })} title={ui.page === n.id ? t("Back to the overview") : t("Show only this unit's page")}>{ui.page === n.id ? "◀" : "▸"}</button>
          </div>
        ))}
      </div>
      <label className="sub rail-toggle">
        <input type="checkbox" checked={ui.showIdle} onChange={(e) => patchConc({ showIdle: e.target.checked })} />
        {" "}{t("Show units that touch no shared variable")}
      </label>
      <div className="rm-rail-h"><b>{t("Filter variables")}</b> <span className="sub">{t("one at a time; click again to clear")}</span></div>
      <div className="rm-chips">
        {FLOW_KEYS.map((key) => (
          <button key={key} className={`rm-chip ${ui.filter === key ? "on" : ""} ${(key === "thread→isr" || key === "mixed") && model.flows[key] ? "bad" : ""}`} onClick={() => toggle(key)}>
            {t(FLOW_LABEL[key])} <b>{model.flows[key]}</b>
          </button>
        ))}
      </div>
      <div className="rm-chips">
        {Object.entries(PROBLEM_LABEL).map(([key, label]) => (
          <button key={key} className={`rm-chip ${ui.filter === key ? "on" : ""} ${key !== "wake" && model.problems[key as keyof typeof model.problems] ? "bad" : ""}`} onClick={() => toggle(key)}>
            {t(label)} <b>{model.problems[key as keyof typeof model.problems]}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Concurrency(props: ConcurrencyProps) {
  const { theme } = props;
  // 选中的变量是跨栏的：矩阵和运行图在舞台，两侧明细在侧栏
  const { ui, patch } = useContext(UiContext);
  const selected = ui.conc.selected;
  const setSelected = (name: string | null) => patch({ conc: { ...ui.conc, selected: name } });
  // 运行图的页、高亮、筛选、显隐都在共享的 ui.conc 里：侧栏和舞台按同一份画
  const patchConc = (next: Partial<Ui["conc"]>) => patch({ conc: { ...ui.conc, ...next } });
  if (!theme.available) return <p className="empty">{theme.hint ?? t("This scan has no concurrency facts.")}</p>;
  const counts = theme.counts;

  const pick = (r: ConcurrencyResource) => {
    setSelected(r.name);
    props.onRequestSides(r.name);
  };

  return (
    <div className="board wide">
      <header>
        <b>{t("Sharing & concurrency")}</b>
        <span className="sub">
          {counts && `${t("high-confidence conflicts")} ${counts.high} · ${t("medium")} ${counts.medium} · ${t("variables touched by an interrupt and another unit")} ${counts.shared} · ${t("notification flags")} ${counts.wake} · ${t("critical sections")} ${counts.criticalSections}${counts.criticalSectionsTotal != null && counts.criticalSectionsTotal !== counts.criticalSections ? ` (${t("{n} in the whole scan", { n: counts.criticalSectionsTotal })})` : ""} · ${t("access sites")} ${counts.accesses}`}
        </span>
      </header>
      <p className="sub">{theme.basis}</p>

      {theme.runMap && theme.runMap.vars.length > 0 && (
        <Rail><RunMapRail model={theme.runMap} ui={ui.conc} patchConc={patchConc} /></Rail>
      )}

      {theme.isrs && theme.isrs.length > 0 && (
        <Rail><div className="ladder">
          <span className="sub">{t("Interrupt priority: a smaller number preempts a larger one; unknown stays unknown — no guessing")}</span>
          {theme.isrs.map((i) => (
            <button key={i.id} className="rung" onClick={() => props.onOpenFile(i.file)}>
              <b>{i.name}</b>
              <span className="sub">{i.kernel ? t("kernel exception") : i.preempt == null ? t("priority unknown") : `${t("preempt")} ${i.preempt}${i.sub == null ? "" : `.${i.sub}`}`}{i.vector != null ? ` · ${t("vector")} ${i.vector}` : ""}{i.enabled ? "" : ` · ${t("no enable seen")}`}</span>
            </button>
          ))}
        </div></Rail>
      )}

      {theme.runMap && (
        <RunMap
          model={theme.runMap}
          ui={ui.conc}
          patchConc={patchConc}
          selectedVar={selected}
          onPickVar={(name) => { const r = theme.resources.find((x) => x.name === name); if (r) pick(r); else { setSelected(name); props.onRequestSides(name); } }}
        />
      )}

      {theme.resources.length === 0
        ? <p className="sub">{t("No variable is touched by both an interrupt and another execution unit.")}</p>
        : (
          <table className="grid rw">
            <thead>
              <tr>
                <th>{t("Variable")}</th>
                {theme.units.map((u) => <th key={u.unit} className={`unit ${u.kind}`} title={u.unit}>{u.label}</th>)}
                <th>{t("Verdict")}</th>
              </tr>
            </thead>
            <tbody>
              {theme.resources.map((r) => (
                <tr key={r.id} className={selected === r.name ? "sel" : ""} onClick={() => pick(r)}>
                  <td>
                    <code>{r.name}</code>
                    {r.volatile && <span className="sub"> volatile</span>}
                    {r.atomicity && r.atomicity !== "unknown" && <span className="sub"> · {r.atomicity}</span>}
                  </td>
                  {theme.units.map((u) => {
                    const cell = r.units.find((x) => x.unit === u.unit);
                    return (
                      <td key={u.unit} className="cellmark">
                        {cell && (
                          <span className={`mark ${cell.glyph} ${cell.protected ? "locked" : ""}`} title={`${t("{n} accesses", { n: cell.accesses })}${cell.protected ? ` · ${t("recognized protection is all inside critical sections")}` : ""}${cell.derived ? ` · ${t("includes one-step pointer inference")}` : ""}`}>
                            {GLYPH[cell.glyph]}{cell.protected ? "🔒" : ""}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="sub">
                    {r.conflict && <span className={`pill ${r.conflict.confidence}`}>{t("conflict candidate")} {r.conflict.confidence}</span>}
                    {r.wake && <span className="pill wake">{t("notification flag")}</span>}
                    {!r.conflict && !r.wake && "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {props.sides && (
        <Inspector><div className="detail">
          <div className="detail-head">
            <b><code>{props.sides.name}</code></b>
            <button className="ghost" onClick={() => props.onCopyId(props.sides!.id)}>{t("Copy reference")}</button>
          </div>
          {props.sides.sides.map((side) => (
            <section key={side.unit}>
              <h4>
                <span className={`pill ${side.kind}`}>{t(UNIT_LABEL[side.kind] ?? side.kind)}</span> {side.unit.split(":").slice(1).join(":")}
                <span className="sub"> {side.kinds.map((k) => t(ACCESS_LABEL[k] ?? k)).join("/")}{side.unprotectedKinds.length === 0 && side.kinds.length ? ` · ${t("all recognized accesses are inside critical sections")}` : ""}</span>
              </h4>
              {side.accesses.map((a, i) => (
                <div key={i} className="line">
                  <button className="link" onClick={() => props.onOpenFile(a.file, a.line)}>
                    <code>{a.name}</code> {a.file?.split("/").pop()}:{a.line}
                  </button>
                  <span className="sub">
                    {" "}{t(ACCESS_LABEL[a.kind] ?? a.kind)}
                    {a.via && ` · ${a.via}`}
                    {a.inCriticalSection && ` · ${t("inside critical section")}`}
                    {a.derived && ` · ${t("via {callee} parameter {param} (one-step inference)", { callee: a.derived.callee, param: a.derived.param })}`}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div></Inspector>
      )}

      {theme.criticalSections && theme.criticalSections.length > 0 && (
        <details className="dp-more">
          <summary><b>{t("Critical sections")}</b> <span className="sub">{t("{n} sites", { n: theme.criticalSections.length })} · {t("judged as paired APIs within one statement block; cross-function or conditional protection is invisible")}</span></summary>
          {theme.criticalSections.map((c, i) => (
            <div key={i} className="line">
              <button className="link" onClick={() => props.onOpenFile(c.file, c.begin?.line)}><code>{c.name}</code></button>
              <span className="sub"> {c.api}{c.endApi ? ` … ${c.endApi}` : ` (${t("no matching end found")})`} · {t("protects {n} accesses", { n: c.accesses })}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
