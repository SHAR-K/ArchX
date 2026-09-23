// 共享与并发主题的视图：变量 × 执行单元的矩阵。
//
// 三条口径要写在界面上，不能靠人自己知道：
//   冲突是候选不是结论，跨函数和条件性的保护引擎看不见；
//   通知标志是设计意图，长得像竞争但不是；
//   未识别的保护不等于没有保护。

import { t } from "../../../packages/facts-view/src/i18n.mjs";
import { useContext, useMemo, useState } from "react";
import type React from "react";
import { FLOW_LABEL, layoutRunMap } from "../../../packages/facts-view/src/concurrency/runmap.mjs";
import { Inspector, Rail, UiContext } from "./slots.tsx";
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
 * 模型和布局来自派生层，这里只画和交互：点变量选中它（右侧两侧明细跟着走），
 * 点单元切成它的一页，卡片按流向或问题过滤。可平移缩放，适应视图一键回来。
 */
function RunMap({ model, onPickVar, selectedVar }: { model: RunMapModel; onPickVar: (name: string) => void; selectedVar: string | null }) {
  // 单元一多，全景就被压成一条带子，看不出东西：默认进第一个带冲突的单元页，全景一键可回
  const [page, setPage] = useState<string | null>(() => {
    const all = [...model.isrs, ...model.threads].filter((n) => model.used.includes(n.id));
    if (all.length <= 12) return null;
    return all.find((n) => model.worst[n.id] === "conflict")?.id ?? null;
  });
  const [filter, setFilter] = useState<string | null>(null);
  const [expandIdle, setExpandIdle] = useState(false);
  const [view, setView] = useState<{ x: number; y: number; k: number } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [hoverUnit, setHoverUnit] = useState<string | null>(null);
  const layout = useMemo(() => layoutRunMap(model, { page, filter, expandIdle }), [model, page, filter, expandIdle]);
  if (model.vars.length === 0) return null;

  const units = [...layout.isrs, ...layout.threads];
  const selectedVarId = selectedVar ? layout.vars.find((v) => v.name === selectedVar)?.id ?? null : null;
  const focusUnit = hoverUnit;
  const edgeOn = (e: RunMapLayout["edges"][number]) => (selectedVarId ? e.var === selectedVarId : focusUnit ? e.unit === focusUnit : true);
  const k = view?.k ?? 1;
  const transform = view ? `translate(${view.x},${view.y}) scale(${view.k})` : undefined;
  const fit = () => setView(null);
  const wheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const f = event.deltaY < 0 ? 1.1 : 0.9;
    const r = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - r.left, py = event.clientY - r.top;
    const cur = view ?? { x: 0, y: 0, k: 1 };
    setView({ k: cur.k * f, x: px - (px - cur.x) * f, y: py - (py - cur.y) * f });
  };
  const pages = units.filter((n) => model.used.includes(n.id));
  const nodeTitle = (n: RunMapNode) => `${n.name} · ${t("touches {n} shared variables, writes {w}", { n: n.touches, w: n.writes })}${n.kind === "callback" ? (n.host ? ` · ${t("host")} ${n.host.split(":").pop()}` : n.hosts?.length ? ` · ${t("{n} possible hosts", { n: n.hosts.length })}` : ` · ${t("host unknown")}`) : ""}`;
  const rhythm = (n: RunMapNode) => (n.kind === "isr" ? (n.kernel ? t("kernel exception") : n.preempt == null ? t("priority unknown") : `${t("preempt")} ${n.preempt}`) : n.kind === "task" ? (n.periodMs != null ? `${n.periodMs} ms` : t(RHYTHM[n.mode ?? "unknown"] ?? n.mode ?? "")) : n.kind === "callback" ? t("callback") : n.kind);

  return (
    <section className="runmap">
      <header>
        <b>{t("Run map")}</b>
        <span className="sub">{t("Which context a shared variable is produced in and which one consumes it. Writer → variable is a solid arrow, variable → reader a thin line; red is an unprotected write conflict, orange is interrupt and thread both writing")}</span>
      </header>
      <div className="rm-chips">
        {FLOW_KEYS.map((key) => (
          <button key={key} className={`rm-chip ${filter === key ? "on" : ""} ${(key === "thread→isr" || key === "mixed") && model.flows[key] ? "bad" : ""}`} onClick={() => setFilter(filter === key ? null : key)} title={t("Click to show only this category")}>
            {t(FLOW_LABEL[key])} <b>{model.flows[key]}</b>
          </button>
        ))}
      </div>
      <div className="rm-chips">
        <span className="sub">{t("Problems")}:</span>
        {Object.entries(PROBLEM_LABEL).map(([key, label]) => (
          <button key={key} className={`rm-chip ${filter === key ? "on" : ""} ${key !== "wake" && model.problems[key as keyof typeof model.problems] ? "bad" : ""}`} onClick={() => setFilter(filter === key ? null : key)}>
            {t(label)} <b>{model.problems[key as keyof typeof model.problems]}</b>
          </button>
        ))}
      </div>
      <div className="rm-strip">
        <button className="ghost" disabled={!page} onClick={() => { setPage(null); setView(null); }}>◀ {t("Overview")}</button>
        <div className="rm-cells">
          {pages.map((n) => (
            <button key={n.id} className={`rm-cell ${n.kind} w-${n.worst} ${page === n.id ? "on" : ""}`} title={nodeTitle(n)} onClick={() => { setPage(page === n.id ? null : n.id); setView(null); }} />
          ))}
        </div>
        {layout.page && <span className="sub">{t("Page of")} <span className={`pill ${layout.page.kind}`}>{t(UNIT_LABEL[layout.page.kind] ?? layout.page.kind)}</span> <code>{layout.page.name}</code></span>}
        <span className="rm-spacer" />
        {!page && (layout.idle.isr || layout.idle.thread || expandIdle) && (
          <button className="ghost" onClick={() => { setExpandIdle(!expandIdle); setView(null); }}>{expandIdle ? t("Hide units that touch no shared variable") : t("Show units that touch no shared variable")}</button>
        )}
        <button className="ghost" onClick={fit}>{t("Fit view")}</button>
      </div>
      <div className="rm-wrap">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMin meet"
          onWheel={wheel}
          onMouseDown={(e) => { if ((e.target as Element).closest("[data-unit],[data-var]")) return; const cur = view ?? { x: 0, y: 0, k: 1 }; setDrag({ x: e.clientX, y: e.clientY, vx: cur.x, vy: cur.y }); if (!view) setView(cur); }}
          onMouseMove={(e) => { if (drag) setView((v) => ({ k: v?.k ?? 1, x: drag.vx + (e.clientX - drag.x) / 1, y: drag.vy + (e.clientY - drag.y) / 1 })); }}
          onMouseUp={() => setDrag(null)}
          onMouseLeave={() => setDrag(null)}
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
                className={`rm-edge ${e.kind} ${e.bad ? "bad" : e.cls} ${edgeOn(e) ? "" : "dim"} ${(selectedVarId && e.var === selectedVarId) || (focusUnit && e.unit === focusUnit) ? "hi" : ""}`}
                d={e.d}
                markerEnd={e.kind === "write" ? `url(#rm-arrow-${e.bad ? "bad" : e.cls})` : undefined}
                strokeDasharray={e.kind === "both" ? "2 3" : undefined}
              >
                <title>{`${e.unit.split(":").pop()} ${e.kind === "write" ? t("writes") : e.kind === "both" ? t("reads and writes") : t("reads")} ${layout.vars.find((v) => v.id === e.var)?.name ?? ""}${e.bare ? ` (${t("unprotected")})` : ""}`}</title>
              </path>
            ))}
            {units.map((n) => (
              <g key={n.id} className={`rm-node ${n.kind} w-${n.worst} ${page === n.id ? "page" : ""}`} data-unit={n.id} style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoverUnit(n.id)} onMouseLeave={() => setHoverUnit(null)}
                onClick={() => { setPage(page === n.id ? null : n.id); setView(null); }}>
                <title>{nodeTitle(n)}</title>
                <rect x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx={6} />
                <text className="rm-name" x={n.x} y={n.y - 3} textAnchor="middle">{n.name.length > 16 ? `${n.name.slice(0, 15)}…` : n.name}</text>
                <text className="rm-rhythm" x={n.x} y={n.y + 11} textAnchor="middle">{rhythm(n)}</text>
              </g>
            ))}
            {(["isr", "thread"] as const).map((kind) => layout.idle[kind] && (
              <g key={kind} className="rm-node idle" style={{ cursor: "pointer" }} onClick={() => { setExpandIdle(true); setView(null); }}>
                <rect x={layout.idle[kind]!.x - layout.idle[kind]!.w / 2} y={layout.idle[kind]!.y - layout.idle[kind]!.h / 2} width={layout.idle[kind]!.w} height={layout.idle[kind]!.h} rx={6} strokeDasharray="4 3" />
                <text className="rm-rhythm" x={layout.idle[kind]!.x} y={layout.idle[kind]!.y + 4} textAnchor="middle">{t("{n} more touch no shared variable", { n: layout.idle[kind]!.count })}</text>
              </g>
            ))}
            {layout.vars.map((v) => (
              <g key={v.id} className={`rm-var ${v.cls} ${selectedVarId === v.id ? "sel" : ""}`} data-var={v.id} style={{ cursor: "pointer" }} onClick={() => onPickVar(v.name)}>
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
      {k !== 1 && <p className="sub">{t("zoom")} {Math.round(k * 100)}%</p>}
    </section>
  );
}

export function Concurrency(props: ConcurrencyProps) {
  const { theme } = props;
  // 选中的变量是跨栏的：矩阵和运行图在舞台，两侧明细在侧栏
  const { ui, patch } = useContext(UiContext);
  const selected = ui.conc.selected;
  const setSelected = (name: string | null) => patch({ conc: { selected: name } });
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
