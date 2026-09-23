// 代码事实面板的视图层：只画和交互，不算分析。
//
// 所有数据来自宿主派生好的 payload；这里不重算任何一条结论，否则界面和 Agent 会各说各话。
// 颜色全部走 VS Code 主题变量，明暗两套都成立。

import { t, t as tr } from "../../../packages/facts-view/src/i18n.mjs";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { Dependencies } from "./deps.tsx";
import { Concurrency } from "./concurrency.tsx";
import type { ConcurrencyTheme, ResourceSides } from "../../../packages/facts-view/src/concurrency/model.d.mts";
import { Execution, type EdgeEvidence } from "./execution.tsx";
import { DEFAULT_UI, Inspector, Rail, Slots, UiContext, type Ui } from "./slots.tsx";
import { layoutMachine } from "../../../packages/facts-view/src/fsm/layout.mjs";
import { Timing } from "./timing.tsx";
import type { TimingTheme } from "../../../packages/facts-view/src/timing/model.d.mts";
import type { Round } from "../../../packages/facts-view/src/timing/sequence.d.mts";
import type { ExecutionTheme, FunctionEntry, RootComparison, TreeChild } from "../../../packages/facts-view/src/execution/model.d.mts";
import type { Declarations, DepEdge, DependenciesTheme, EdgeDetail } from "../../../packages/facts-view/src/deps/model.d.mts";
import type { MemoryTheme } from "../../../packages/facts-view/src/memory/model.d.mts";
import type { AtomRow, FsmMachine, StatePanel, StateTransitionsTheme } from "../../../packages/facts-view/src/types.d.mts";
import "./styles.css";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

interface Payload {
  snapshot: string;
  project: string;
  projectRoot: string;
  partition: string;
  region: string;
  generatedAt: string;
  counts: { files: number; functions: number };
  themes: { stateTransitions: StateTransitionsTheme; memory: MemoryTheme; dependencies: DependenciesTheme; execution: ExecutionTheme; concurrency: ConcurrencyTheme; timing: TimingTheme };
  declarations: Declarations;
  functions: Record<string, { name: string; file: string; line: number }>;
  scope?: { folder: string; buildRoot: string; basis: string };
}

const openFile = (path: string | null | undefined, line?: number | null) => {
  if (!path) return;
  vscode.postMessage({ type: "openFile", path, line: line ?? undefined });
};
const copyId = (id: string) => vscode.postMessage({ type: "copyId", id });

const KIND_LABEL: Record<string, string> = { next: "forward", jump: "jump", back: "back", self: "self", exit: "exit" };
const OWNER_LABEL: Record<string, string> = { task: "task", callback: "callback", handler: "callback", isr: "interrupt", main: "main" };

/** 一行判断。tone 决定颜色，tag 是行首标签，点击跳到那一行代码。 */
function Row({ row, file }: { row: AtomRow; file: string | null }) {
  return (
    <button className={`row ${row.tone}`} onClick={() => openFile(file, row.line)} title={row.line ? `${file ?? ""}:${row.line}` : ""}>
      <span className="tag">{row.tag}</span>
      <code>{row.text}</code>
    </button>
  );
}

/** 状态图：层来自派生的 depth，同层按状态顺序排。边的种类决定线型。 */
function StateGraph({ machine, panel, childMachines, selected, onSelect, onDescend }: { machine: FsmMachine; panel: StatePanel | null; childMachines: FsmMachine[]; selected: string | null; onSelect: (name: string) => void; onDescend: (id: string) => void }) {
  // 层是我们算的，dagre 只管同层排序和走线；坐标全部来自派生层，这里只画
  const layout = useMemo(() => layoutMachine(machine, machine.analysis, { children: childMachines.map((c) => ({ id: c.id, parentState: c.parentState, dispatch: c.dispatch })) }), [machine, childMachines]);
  const [view, setView] = useState<{ x: number; y: number; k: number } | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  useEffect(() => { setView(null); }, [machine.id]);
  const bb = layout.bbox;
  if (!layout.nodes.length) return <p className="sub">{t("No states to draw.")}</p>;
  const transform = view ? `translate(${view.x},${view.y}) scale(${view.k})` : undefined;

  // 选中状态的出边和侧栏里的转换条目一一对应：同一个编号
  const numberOf = (from: string, to: string, line: number | null) =>
    selected === from && panel ? panel.items.find((it) => it.to === to && (it.line ?? null) === (line ?? null))?.number ?? null : null;
  const smooth = (pts: Array<{ x: number; y: number }>) => {
    if (pts.length < 2) return "";
    if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const c = pts[i], n = pts[i + 1];
      const mx = (c.x + n.x) / 2, my = (c.y + n.y) / 2;
      d += ` Q ${c.x} ${c.y} ${mx} ${my}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  };
  const wheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.1 : 0.9;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const cur = view ?? { x: 0, y: 0, k: 1 };
    // 把屏幕坐标换回 viewBox 坐标再缩放，焦点不动
    const sx = bb.width / r.width, sy = bb.height / r.height, s = Math.max(sx, sy);
    const vx = px * s, vy = py * s;
    setView({ k: cur.k * f, x: vx - (vx - cur.x) * f, y: vy - (vy - cur.y) * f });
  };
  const KIND: Record<string, string> = { next: "forward step", jump: "forward jump", back: "back", self: "self-loop", exit: "exit" };

  return (
    <div className="fsm-wrap">
      <div className="fsm-tools">
        <span className="sub">{t("Scroll to zoom · drag to pan · click a state for its conditions · numbers on outgoing edges match the transitions in the sidebar")}</span>
        <span className="fsm-legend"><i className="next" />{t("forward")} {machine.analysis.stats.next}<i className="jump" />{t("jump")} {machine.analysis.stats.jump}<i className="back" />{t("back")} {machine.analysis.stats.back}<i className="self" />{t("self")} {machine.analysis.stats.self}<i className="exit" />{t("exit")} {machine.analysis.stats.exit}</span>
        <span className="fsm-spacer" />
        {layout.ranker === "fallback" && <span className="sub warn-inline" title={t("All dagre rankers failed on this machine; using a simple layout: rows by depth, back edges routed to the right")}>{t("The routing library failed on this machine; simple rows are used")}</span>}
        <button className="ghost" onClick={() => setView(null)}>{t("Fit")}</button>
      </div>
      <svg
        className="graph uml"
        viewBox={`${bb.x} ${bb.y} ${bb.width} ${bb.height}`}
        style={{ maxHeight: Math.min(560, bb.height + 20) }}
        onWheel={wheel}
        onMouseDown={(e) => { if ((e.target as Element).closest(".state,.uml-flags")) return; const cur = view ?? { x: 0, y: 0, k: 1 }; drag.current = { x: e.clientX, y: e.clientY, vx: cur.x, vy: cur.y, moved: false }; if (!view) setView(cur); }}
        onMouseMove={(e) => { const d = drag.current; if (!d) return; d.moved = true; const r = e.currentTarget.getBoundingClientRect(); const s = Math.max(bb.width / r.width, bb.height / r.height); setView((v) => ({ k: v?.k ?? 1, x: d.vx + (e.clientX - d.x) * s, y: d.vy + (e.clientY - d.y) * s })); }}
        onMouseUp={() => { drag.current = null; }}
        onMouseLeave={() => { drag.current = null; }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
          </marker>
        </defs>
        <g transform={transform}>
          {layout.init && (
            <g className="uml-init">
              <circle cx={layout.init.x} cy={layout.init.y} r={6} />
              <line x1={layout.init.x} y1={layout.init.y + 6} x2={layout.init.x} y2={layout.init.targetY - 1} markerEnd="url(#arrow)" />
            </g>
          )}
          {layout.edges.map((e) => {
            const related = selected === e.from || selected === e.to;
            const num = numberOf(e.from, e.to, e.line);
            const mid = e.points[Math.floor(e.points.length / 2)] ?? e.points[0];
            return (
              <g key={`e${e.index}`}>
                <path className={`edge ${e.kind} ${related ? "on" : ""} ${num ? "active" : ""}`} d={smooth(e.points)} markerEnd="url(#arrow)">
                  <title>{`${e.from} → ${e.to} · ${t(KIND[e.kind] ?? e.kind)}\n${e.condition ?? t("unconditional")}${e.via ? `\n${e.via}` : ""}${e.line ? ` · ${t("line")} ${e.line}` : ""}`}</title>
                </path>
                {num && (
                  <g className={`uml-badge ${e.kind}`}>
                    <circle cx={mid.x} cy={mid.y} r={9} />
                    <text x={mid.x} y={mid.y + 3.5} textAnchor="middle">{num}</text>
                  </g>
                )}
              </g>
            );
          })}
          {layout.selfLoops.map((s) => {
            const num = numberOf(s.from, s.to, s.line);
            const x = s.x, y = s.y;
            return (
              <g key={`s${s.index}`}>
                <path className={`edge self ${selected === s.from ? "on" : ""} ${num ? "active" : ""}`} d={`M${x},${y - 10} C${x + 40},${y - 30} ${x + 40},${y + 30} ${x},${y + 10}`} markerEnd="url(#arrow)">
                  <title>{`${s.from} → ${s.to} · ${t("self-loop")}\n${s.condition ?? t("unconditional")}${s.line ? ` · ${t("line")} ${s.line}` : ""}`}</title>
                </path>
                {num && <g className="uml-badge self"><circle cx={x + 30} cy={y} r={9} /><text x={x + 30} y={y + 3.5} textAnchor="middle">{num}</text></g>}
              </g>
            );
          })}
          {layout.nodes.map((n) => {
            const sel = selected === n.name;
            const guards = sel && panel ? panel.guards : [];
            return (
              <g key={n.name}>
                <g className={`state ${sel ? "sel" : ""} ${n.terminal ? "term" : ""} ${n.extra ? "extra" : ""} ${n.children.length ? "composite" : ""}`} onClick={() => onSelect(n.name)}>
                  {n.terminal
                    ? <><circle className="outer" cx={n.x} cy={n.y} r={n.w / 2} /><circle className="core" cx={n.x} cy={n.y} r={n.w / 2 - 5} /></>
                    : <rect x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx={6} />}
                  {n.children.length > 0 && <rect className="stack" x={n.x - n.w / 2 + 4} y={n.y - n.h / 2 - 4} width={n.w - 8} height={n.h} rx={6} />}
                  <text x={n.x} y={n.terminal ? n.y + n.h / 2 + 14 : n.y + 4} textAnchor="middle">{n.name}</text>
                </g>
                <g className="uml-flags">
                  {n.flags.map((f, i) => <text key={f.kind} className={`flag ${f.kind}`} x={n.x - n.w / 2} y={n.y + n.h / 2 + 12 + i * 11} >{f.text}</text>)}
                  {guards.map((g, i) => (
                    <g key={g.letter} className="uml-guard">
                      <rect x={n.x - n.w / 2 + 4 + i * 18} y={n.y - n.h / 2 - 9} width={16} height={12} rx={3} />
                      <text x={n.x - n.w / 2 + 12 + i * 18} y={n.y - n.h / 2} textAnchor="middle">{g.letter}</text>
                    </g>
                  ))}
                  {n.children.map((c, i) => (
                    <text key={c.id} className="flag child" x={n.x + n.w / 2} y={n.y + n.h / 2 + 12 + i * 11} textAnchor="end" style={{ cursor: "pointer" }} onClick={() => onDescend(c.id)}>{t("sub-machine")} {c.dispatch} →</text>
                  ))}
                </g>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function StateDetail({ panel, machine }: { panel: StatePanel; machine: FsmMachine }) {
  const stateFile = machine.file;
  return (
    <div className="detail">
      <div className="detail-head">
        <button className="link strong" onClick={() => openFile(stateFile, panel.state?.location?.line)}>
          <code>{panel.name}</code>
        </button>
        <button className="ghost" onClick={() => copyId(panel.id)} title={t("Copy the stable reference; it can be handed straight to the agent")}>{t("Copy reference")}</button>
      </div>
      {panel.guards.length > 0 && (
        <section>
          <h4>{t("Guards")} <span className="sub">{t("checks that bail out right after entering this case")}</span></h4>
          {panel.guards.map((g) => (
            <div key={g.letter} className="group">
              <span className="letter">{g.letter}</span>
              <div>{g.rows.map((r, i) => <Row key={i} row={r} file={stateFile} />)}</div>
            </div>
          ))}
        </section>
      )}
      <section>
        <h4>{t("Transitions")} <span className="sub">{panel.items.length}</span></h4>
        {panel.items.length === 0 && <p className="sub">{t("This state has no transitions inside the switch.")}</p>}
        {panel.items.map((item) => (
          <div key={item.number} className="group transition">
            <span className="badge-num">{item.number}</span>
            <div className="grow">
              <div className="to">
                → <code>{item.to}</code>
                <span className={`pill ${item.kind}`}>{KIND_LABEL[item.kind] ?? item.kind}</span>
                {item.helper && <span className="pill helper">{t("via")} {item.helper}()</span>}
                <button className="link" onClick={() => openFile(item.file, item.line)}>:{item.line ?? "?"}</button>
              </div>
              {item.siteRows.length > 0 && <div className="rows">{item.siteRows.map((r, i) => <Row key={`s${i}`} row={r} file={item.file} />)}</div>}
              {item.innerRows.length > 0 && (
                <div className="rows inner">
                  <span className="sub">{t("inside")} {item.helper}()</span>
                  {item.innerRows.map((r, i) => <Row key={`i${i}`} row={r} file={null} />)}
                </div>
              )}
              {item.directRows.length > 0 && <div className="rows">{item.directRows.map((r, i) => <Row key={`d${i}`} row={r} file={item.file} />)}</div>}
              {item.siteRows.length + item.innerRows.length + item.directRows.length === 0 && <p className="sub">{t("Unconditional: transitions as soon as the case is entered.")}</p>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function StateTransitions({ theme, payload }: { theme: StateTransitionsTheme; payload: Payload }) {
  // 选了哪台机、哪个状态是跨栏的：列表在侧栏、图在舞台、明细又在侧栏
  const { ui, patch } = useContext(UiContext);
  const machineId = ui.state.machineId ?? theme.machines[0]?.id ?? null;
  const stateName = ui.state.stateName;
  const machine = theme.machines.find((m) => m.id === machineId) ?? theme.machines[0] ?? null;
  const setMachineId = (id: string | null) => patch({ state: { machineId: id, stateName: null } });
  const setStateName = (name: string | null) => patch({ state: { machineId, stateName: name } });

  if (!theme.available) return <p className="empty">{t("This scan has no AST-level facts, so state transitions cannot be drawn. Try a full scan with clangd.")}</p>;
  if (!machine) return <p className="empty">{t("No state machine recognized. The engine treats")} <code>switch(variable)</code> {t("as a candidate; there is none in this scope.")}</p>;

  const panel = stateName ? machine.panels?.[stateName] ?? null : null;
  return (
    <div className="theme">
      <Rail><aside className="machines">
        {theme.machines.map((m) => (
          <button key={m.id} className={`machine ${m.id === machine.id ? "sel" : ""}`} onClick={() => setMachineId(m.id)} style={{ marginLeft: m.depth * 12 }}>
            <code>{m.dispatch}</code>
            <span className="sub">
              {t("{n} states", { n: m.states.length })} · {t("{n} transitions", { n: m.analysis.stats.total })}
              {m.owners.length > 0 && ` · ${t(OWNER_LABEL[m.owners[0].kind] ?? m.owners[0].kind)} ${m.owners[0].name}`}
            </span>
            <span className={`conf ${m.confidence}`} title={`${t("confidence")} ${m.confidence}`} />
          </button>
        ))}
        {theme.dispatchTables.length > 0 && (
          <details className="tables">
            <summary className="sub">{t("Dispatch tables")} {theme.dispatchTables.length}</summary>
            {theme.dispatchTables.map((d) => (
              <button key={d.id} className="link block" onClick={() => openFile(d.location?.path, d.location?.line)}>
                <code>{d.dispatch}</code> <span className="sub">{t("{n} cases, dispatch only, no state change", { n: d.cases })}</span>
              </button>
            ))}
          </details>
        )}
      </aside></Rail>
      <main className="board">
        <header>
          <button className="link strong" onClick={() => openFile(machine.file, machine.location?.line)}><code>{machine.dispatch}</code></button>
          <span className="sub">
            {machine.file}
            {machine.enumType && ` · ${machine.enumType}`}
            {` · ${t("forward")} ${machine.analysis.stats.next} ${t("jump")} ${machine.analysis.stats.jump} ${t("back")} ${machine.analysis.stats.back} ${t("self")} ${machine.analysis.stats.self} ${t("exit")} ${machine.analysis.stats.exit}`}
            {` · ${t("linearity")} ${Math.round((machine.analysis.stats.linearity ?? 0) * 100)}%`}
          </span>
          <button className="ghost" onClick={() => copyId(machine.id)}>{t("Copy reference")}</button>
        </header>
        {machine.analysis.isrWriters.length > 0 && (
          <p className="warn">
            {t("Rewritten inside interrupts")}:
            {machine.analysis.isrWriters.map((f) => (
              <button key={f} className="link" onClick={() => openFile(payload.functions[f]?.file, payload.functions[f]?.line)}>{payload.functions[f]?.name ?? f}</button>
            ))}
          </p>
        )}
        {machine.waitsOn.length > 0 && (
          <p className="sub">
            {t("Transition conditions query other state machines")}:
            {machine.waitsOn.map((w) => <button key={w.id} className="link" onClick={() => setMachineId(w.id)}><code>{w.dispatch}</code></button>)}
          </p>
        )}
        <p className="sub verdict" title={t("linearity = forward steps ÷ all transitions")}>{machine.analysis.verdict}</p>
        <StateGraph machine={machine} panel={panel} childMachines={theme.machines.filter((m) => m.parent === machine.id)} selected={stateName} onSelect={(name) => setStateName(name === stateName ? null : name)} onDescend={(id) => setMachineId(id)} />
        <details className="tables enum-table" open={Boolean(machine.enumTable.enum)}>
          <summary className="sub">
            {t("Enum overview")}
            {machine.enumTable.enum
              ? <> <code>{machine.enumTable.enum.name}</code> ({t("{n} members", { n: machine.enumTable.enum.members })}{machine.enumTable.unused > 0 ? `, ${t("{n} not in the switch", { n: machine.enumTable.unused })}` : ""})</>
              : ` (${t("the engine gave no enum definition; showing the {n} labels seen in the switch", { n: machine.enumTable.rows.length })})`}
            {machine.enumTable.enum?.location && (
              <button className="link sub" onClick={(e) => { e.preventDefault(); openFile(machine.enumTable.enum!.location!.path, machine.enumTable.enum!.location!.line); }}>
                {machine.enumTable.enum.location.path.split("/").pop()}:{machine.enumTable.enum.location.line}
              </button>
            )}
          </summary>
          <table className="grid">
            <thead><tr><th>{t("Member")}</th><th className="num">{t("Value")}</th><th>{t("Has case")}</th><th className="num">{t("In")}</th><th className="num">{t("Out")}</th><th className="num">break</th><th>{t("Role")}</th></tr></thead>
            <tbody>
              {machine.enumTable.rows.map((r) => (
                <tr key={r.name} className={r.inMachine ? "" : "unused"}>
                  <td><code>{r.name}</code></td>
                  <td className="num">{r.value ?? "?"}</td>
                  <td>{r.isCase ? t("yes") : r.inMachine ? t("no (target only)") : t("no")}</td>
                  <td className="num">{r.inDeg ?? ""}</td>
                  <td className="num">{r.outDeg ?? ""}</td>
                  <td className="num">{r.guards || ""}</td>
                  <td className="sub">{r.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <Inspector>{panel ? <StateDetail panel={panel} machine={machine} /> : <p className="sub hint">{t("Click a state to see its guards and the condition of each transition.")}</p>}</Inspector>
      </main>
    </div>
  );
}

const fmtBytes = (n: number) => (n >= 10240 ? `${(n / 1024).toFixed(1)} kB` : n >= 1024 ? `${(n / 1024).toFixed(2)} kB` : `${n} B`);

function Memory({ theme }: { theme: MemoryTheme }) {
  const [sort, setSort] = useState<"ram" | "rom">("ram");
  if (!theme.available) return <p className="empty">{theme.hint ?? t("This scan has no link artifact, so sizes are unavailable.")}</p>;
  const modules = theme.modules.slice().sort((a, b) => (sort === "ram" ? b.ram - a.ram : b.rom - a.rom));
  const maxima = Math.max(1, ...modules.map((m) => (sort === "ram" ? m.ram : m.rom)));
  const stale = (theme.staleness ?? {}) as Record<string, number | string[]>;
  const staleFiles = Number(stale.sourcesNewerThanImage ?? 0);
  return (
    <div className="board wide">
      <header>
        <b>{t("Memory footprint")}</b>
        <span className="sub">
          {theme.artifact ? `${t("artifact")} ${theme.artifact.path}` : ""}
          {theme.totals && ` · ${t("image")} ROM ${fmtBytes(Number(theme.totals.romBytes ?? 0))} / RAM ${fmtBytes(Number(theme.totals.ramBytes ?? 0))}`}
          {theme.scoped && ` · ${t("this region")} ROM ${fmtBytes(Number(theme.scoped.romBytes ?? 0))} / RAM ${fmtBytes(Number(theme.scoped.ramBytes ?? 0))}`}
        </span>
        {theme.artifact && <button className="ghost" onClick={() => openFile(theme.artifact!.path)}>{t("Open artifact")}</button>}
      </header>
      <p className="sub">{theme.basis} ({t("{m}/{n} object files traced to a source file by function names", { m: theme.matchedByFunctions, n: theme.objectCount })})</p>
      {staleFiles > 0 && <p className="warn">{t("{n} source files are newer than the artifact: these sizes do not match the current code.", { n: staleFiles })}</p>}
      <div className="segmented">
        <button className={sort === "ram" ? "on" : ""} onClick={() => setSort("ram")}>{t("By RAM")}</button>
        <button className={sort === "rom" ? "on" : ""} onClick={() => setSort("rom")}>{t("By ROM")}</button>
      </div>
      <table className="grid">
        <thead><tr><th>{t("Module")}</th><th className="num">{t("Files")}</th><th className="num">Code</th><th className="num">RO</th><th className="num">RW</th><th className="num">ZI</th><th className="num">ROM</th><th className="num">RAM</th><th className="bar" /></tr></thead>
        <tbody>
          {modules.map((m) => (
            <tr key={m.id}>
              <td><code>{m.module}</code></td>
              <td className="num">{m.files}</td>
              <td className="num">{fmtBytes(m.code)}</td>
              <td className="num">{fmtBytes(m.ro)}</td>
              <td className="num">{fmtBytes(m.rw)}</td>
              <td className="num">{fmtBytes(m.zi)}</td>
              <td className="num">{fmtBytes(m.rom)}</td>
              <td className="num">{fmtBytes(m.ram)}</td>
              <td className="bar"><i style={{ width: `${((sort === "ram" ? m.ram : m.rom) / maxima) * 100}%` }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>{t("Data symbols")} <span className="sub">{t("{n}, by bytes; {shared} shared by multiple units, {bytes} in total", { n: theme.symbols.length, shared: theme.sharedCount, bytes: fmtBytes(theme.sharedBytes ?? 0) })}</span></h4>
      <table className="grid">
        <thead><tr><th>{t("Symbol")}</th><th>{t("Section")}</th><th className="num">{t("Bytes")}</th><th>{t("Defined at")}</th><th>{t("Concurrency")}</th></tr></thead>
        <tbody>
          {theme.symbols.slice(0, 60).map((x) => (
            <tr key={x.id}>
              <td><code>{x.name}</code>{x.scope !== "global" && <span className="sub"> static</span>}</td>
              <td className="sub">{x.section ?? "?"}</td>
              <td className="num">{fmtBytes(x.size)}</td>
              <td>{x.file ? <button className="link" onClick={() => openFile(x.file, x.line)}>{x.file.split("/").pop()}{x.line ? `:${x.line}` : ""}</button> : <span className="sub">{t("not located")}</span>}</td>
              <td className="sub">{x.sharedUnits.length === 0 ? "" : `${t("{n} units", { n: x.sharedUnits.length })}${x.touchedByIsr ? ` · ${t("incl. interrupt")}` : ""}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [status, setStatus] = useState<string>(t("Waiting for a scan"));
  // 跨栏共享的 UI 状态：先本地乐观应用，再报给宿主；宿主合并后广播，两边按同一份画
  const [ui, setUiState] = useState<Ui>(DEFAULT_UI);
  const patchUi = (patch: Partial<Ui>) => { setUiState((prev) => ({ ...prev, ...patch })); vscode.postMessage({ type: "ui", patch }); };
  const theme = ui.theme;
  const setTheme = (next: Ui["theme"]) => patchUi({ theme: next });
  // body 上的 data-mode 说这个 webview 是侧栏还是舞台；舞台在侧栏不可见时退回合一
  const [sideAvailable, setSideAvailable] = useState(false);
  const bodyMode = document.body.dataset.mode === "side" ? "side" : "stage";
  const mode: "side" | "stage" | "all" = bodyMode === "side" ? "side" : sideAvailable ? "stage" : "all";
  const [sides, setSides] = useState<ResourceSides | null>(null);
  const [treeKids, setTreeKids] = useState<Record<string, TreeChild[]>>({});
  const [evidence, setEvidence] = useState<EdgeEvidence | null>(null);
  const [compare, setCompare] = useState<{ a: string; b: string; data: RootComparison | null } | null>(null);
  const [entry, setEntry] = useState<{ id: string; data: FunctionEntry | null } | null>(null);
  // 左栏两个槽位的 DOM 落点，各主题用 portal 往里投
  const [rail, setRail] = useState<HTMLElement | null>(null);
  const [inspector, setInspector] = useState<HTMLElement | null>(null);
  const [detail, setDetail] = useState<{ edgeId: string; data: EdgeDetail } | null>(null);
  const [declarations, setDeclarations] = useState<Declarations | null>(null);
  const [round, setRound] = useState<{ root: string; data: Round | null; loading: boolean; showIterations: boolean } | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type: string; payload?: Payload; text?: string; id?: string; edgeId?: string; data?: EdgeDetail; symbol?: string; children?: TreeChild[]; evidence?: EdgeEvidence | null; sides?: ResourceSides | null; root?: string; round?: Round; a?: string; b?: string; comparison?: RootComparison; entry?: FunctionEntry | null; ui?: Ui; side?: boolean };
      if (message.type === "facts" && message.payload) { setPayload(message.payload); setDeclarations(message.payload.declarations); setDetail(null); setTreeKids({}); setEvidence(null); setCompare(null); setEntry(null); setSides(null); setRound(null); setStatus(""); }
      if (message.type === "edgeDetail" && message.edgeId && message.data) setDetail({ edgeId: message.edgeId, data: message.data });
      if (message.type === "treeChildren" && message.symbol) setTreeKids((prev) => ({ ...prev, [message.symbol!]: message.children ?? [] }));
      if (message.type === "callEvidence") setEvidence(message.evidence ?? null);
      if (message.type === "functionEntry" && message.id) setEntry({ id: message.id, data: message.entry ?? null });
      // 只认自己刚要的那一对
      if (message.type === "compareRoots" && message.a && message.b) setCompare({ a: message.a, b: message.b, data: message.comparison ?? null });
      if (message.type === "resourceSides") setSides(message.sides ?? null);
      // 只认自己刚要的那一份：切得快的时候旧请求会后到
      if (message.type === "round" && message.root) {
        setRound((prev) => (prev && prev.root === message.root ? { ...prev, data: message.round ?? null, loading: false } : prev));
      }
      // ID 的种类决定它属于哪个主题：Agent 指过来时先切主题，再由主题自己定位对象
      if (message.type === "select" && message.id && document.body.dataset.mode !== "side") {
        if (message.id.startsWith("fsm:") || message.id.startsWith("state:")) setTheme("state");
        if (message.id.startsWith("mem:") || message.id.startsWith("sym:")) setTheme("memory");
        if (message.id.startsWith("unit:")) setTheme("deps");
        if (message.id.startsWith("exec:")) patchUi({ theme: "exec", exec: { rootId: message.id.slice("exec:".length), reveal: [] } });
        if (message.id.startsWith("res:")) patchUi({ theme: "conc", conc: { selected: message.id.split(":").pop() ?? null } });
        if (message.id.startsWith("loop:")) setTheme("timing");
        if (message.id.startsWith("fsm:")) patchUi({ theme: "state", state: { machineId: message.id, stateName: null } });
        if (message.id.startsWith("state:")) {
          const key = message.id.slice("state:".length);
          const cut = key.lastIndexOf("/");
          patchUi({ theme: "state", state: { machineId: `fsm:${key.slice(0, cut)}`, stateName: key.slice(cut + 1) } });
        }
      }
      if (message.type === "status" && message.text != null) setStatus(message.text);
      if (message.type === "ui" && message.ui) setUiState(message.ui);
      if (message.type === "mode") setSideAvailable(Boolean(message.side));
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // 一轮跟着 ui.timing 走：侧栏选了哪个单元，舞台就要哪一轮。两个 webview 都会走到这里，
  // 只让舞台那个去要，侧栏等广播——答案是广播的，两边都收得到
  useEffect(() => {
    const { root, showIterations } = ui.timing;
    if (!root) { setRound(null); return; }
    setRound({ root, data: null, loading: true, showIterations });
    if (document.body.dataset.mode !== "side") vscode.postMessage({ type: "round", root, showIterations });
  }, [ui.timing.root, ui.timing.showIterations, payload?.snapshot]);

  if (!payload) return <div className="boot"><p>{status}</p><p className="sub">{t("Ask the agent to scan this repository, or run the command ArchX: Scan Partition.")}</p></div>;
  const themes = [
    { key: "exec", label: t("Execution"), available: payload.themes.execution.available },
    { key: "deps", label: t("Dependencies"), available: payload.themes.dependencies.available },
    { key: "timing", label: t("Order & time"), available: payload.themes.timing.available },
    { key: "conc", label: t("Sharing & concurrency"), available: payload.themes.concurrency.available },
    { key: "state", label: t("State transitions"), available: payload.themes.stateTransitions.available },
    { key: "memory", label: t("Memory footprint"), available: payload.themes.memory.available },
  ] as const;
  return (
    <Slots.Provider value={{ rail, inspector }}>
    <UiContext.Provider value={{ ui, patch: patchUi }}>
    <div className={`app side-layout mode-${mode}`}>
      {mode !== "stage" && (
      <aside className={`side ${mode === "side" ? "full" : ""}`}>
        <nav className="themes themes-v">
          {themes.map((t) => (
            <button key={t.key} className={`${theme === t.key ? "on" : ""} ${t.available ? "" : "dim"}`} onClick={() => setTheme(t.key)} title={t.available ? "" : tr("This scan has no data for this theme")}>
              {t.label}
            </button>
          ))}
        </nav>
        <span className="sub side-status">
          {payload.partition || payload.region || tr("whole project")} · {tr("{n} files", { n: payload.counts.files })} · {tr("{n} functions", { n: payload.counts.functions })} · {tr("snapshot")} {payload.snapshot}
        </span>
        {payload.scope && (
          <span className="sub" title={`${tr("scan root")} ${payload.scope.buildRoot}`}>
            {tr("scan root")} {payload.scope.buildRoot === payload.scope.folder ? tr("is the selected folder") : payload.scope.buildRoot} · {payload.scope.basis}
          </span>
        )}
        <div className="rail" ref={setRail} />
        <div className="inspector" ref={setInspector} data-hint={tr("Click an object on the stage; its details show here")} />
      </aside>
      )}
      {/* 侧栏模式下舞台照常渲染但不显示：各主题的 Rail / Inspector 是从它们的组件里投出来的 */}
      <main className="stage" hidden={mode === "side"}>
      {theme === "exec" && (
        <Execution
          theme={payload.themes.execution}
          functions={payload.functions}
          onOpenFile={openFile}
          onCopyId={copyId}
          onRequestChildren={(symbol: string) => vscode.postMessage({ type: "treeChildren", symbol })}
          onRequestEvidence={(from: string, to: string) => vscode.postMessage({ type: "callEvidence", from, to })}
          children={treeKids}
          evidence={evidence}
          compare={compare}
          onRequestCompare={(a: string, b: string) => { setCompare({ a, b, data: null }); vscode.postMessage({ type: "compareRoots", a, b }); }}
          entry={entry}
          onRequestEntry={(id: string) => { setEntry({ id, data: null }); vscode.postMessage({ type: "functionEntry", id }); }}
          onClearEntry={() => setEntry(null)}
        />
      )}
      {theme === "timing" && (
        <Timing
          theme={payload.themes.timing}
          onOpenFile={openFile}
          onCopyId={copyId}
          round={round?.data ?? null}
          roundLoading={Boolean(round?.loading)}
          roundRoot={ui.timing.root}
          showIterations={ui.timing.showIterations}
          onRequestRound={(root: string, showIterations: boolean) => {
            // 再点同一个就收起来，免得看完一个还要滚很远才回到表
            const same = ui.timing.root === root && ui.timing.showIterations === showIterations;
            patchUi({ timing: { root: same ? null : root, showIterations } });
          }}
        />
      )}
      {theme === "conc" && (
        <Concurrency
          theme={payload.themes.concurrency}
          sides={sides}
          onOpenFile={openFile}
          onCopyId={copyId}
          onRequestSides={(name: string) => vscode.postMessage({ type: "resourceSides", name })}
        />
      )}
      {theme === "deps" && (
        <Dependencies
          theme={payload.themes.dependencies}
          declarations={declarations ?? payload.declarations}
          onDeclare={(next) => { setDeclarations(next); vscode.postMessage({ type: "declare", declarations: next }); }}
          onOpenFile={openFile}
          onCopyId={copyId}
          onRequestDetail={(edge: DepEdge, sourceFiles: string[], targetFiles: string[]) => vscode.postMessage({ type: "edgeDetail", edgeId: edge.id, sourceFiles, targetFiles })}
          detail={detail}
          selectId={null}
        />
      )}
      {theme === "state" && <StateTransitions theme={payload.themes.stateTransitions} payload={payload} />}
      {theme === "memory" && <Memory theme={payload.themes.memory} />}
      </main>
    </div>
    </UiContext.Provider>
    </Slots.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
