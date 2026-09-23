// 抢占式的时间图：按优先级一行一个任务。模型和坐标来自派生层，这里只画和交互，
// 交互和节拍图一致：横向滚轮缩放跨度、拖动平移、「复位」回整个超周期；点一行选中它展开一轮，
// 点优先级标签跳到写它的那一行。样式复用 .beat 那一套。

import { t } from "../../../packages/facts-view/src/i18n.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { layoutPreemptive } from "../../../packages/facts-view/src/timing/preemptive.mjs";
import type { PreemptiveModel } from "../../../packages/facts-view/src/timing/preemptive.d.mts";

export interface PreemptiveProps {
  model: PreemptiveModel;
  selected: string | null;
  onSelect: (entry: string) => void;
  onOpenFile: (path: string | null | undefined, line?: number | null) => void;
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${+(ms / 1000).toFixed(3)} s` : `${+ms.toFixed(ms < 10 ? 1 : 0)} ms`);
const BASIS_LABEL: Record<string, string> = { literal: "literal", enum: "enum constant", expression: "constant ± literal", "attr-initializer": "attribute struct initializer", unresolved: "not resolved" };

export function Preemptive(props: PreemptiveProps) {
  const { model } = props;
  const host = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);
  const [span, setSpan] = useState<number | null>(null);
  const [t0, setT0] = useState(0);
  const drag = useRef<{ x: number; from: number; per: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(720, el.clientWidth - 2));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => (model.available ? layoutPreemptive(model, { width, t0, span: span ?? undefined }) : null), [model, width, t0, span]);
  if (!model.available) return <p className="sub beat-off">{model.hint ?? t("The preemption picture cannot be drawn.")}</p>;
  if (!layout) return null;
  const L = layout;

  const wheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
    e.preventDefault();
    setSpan(Math.max(4, Math.min(L.total, L.span * (dx > 0 ? 1 / 1.15 : 1.15))));
  };
  const down = (e: React.PointerEvent<HTMLDivElement>) => { drag.current = { x: e.clientX, from: L.t0, per: L.pxPerMs, moved: false }; };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || Math.abs(e.clientX - d.x) < 3) return;
    d.moved = true;
    setT0(Math.max(0, Math.min(L.total - L.span, d.from - (e.clientX - d.x) / d.per)));
  };
  const up = () => { setTimeout(() => { drag.current = null; }, 0); };
  const pick = (entry: string) => { if (drag.current?.moved) return; props.onSelect(entry); };
  const rowOf = (id: string) => model.rows.find((r) => r.id === id);

  return (
    <section className="beat preempt">
      {model.chips && model.chips.length > 0 && (
        <div className="beat-facts">
          {model.chips.map((c) => <span key={c.label} className={`bf ${c.bad ? "bad" : ""}`}><i>{c.label}</i><b>{c.value}</b></span>)}
        </div>
      )}
      <p className="sub">{model.basis}</p>
      <div className="beat-tools">
        <span className="sub">{fmtMs(L.t0)} – {fmtMs(L.t1)} · {t("span")} {fmtMs(L.span)}{model.lcm ? ` · ${t("hyperperiod")} ${fmtMs(model.lcm)}` : ""}</span>
        <span className="beat-key"><i className="run" />{t("due, runs")}<i className="lead" />{t("pushed right by a higher task due at the same instant")}<i className="band event" />{t("waits for an event")}<i className="band poll" />{t("never blocks")}</span>
        <span className="beat-spacer" />
        {model.counts?.unresolved ? <span className="sub">{t("{n} tasks without a resolved priority go last", { n: model.counts.unresolved })}</span> : null}
        <button className="ghost" onClick={() => { setT0(0); setSpan(null); }}>{t("Reset")}</button>
      </div>
      <div ref={host} className="beat-vp" onWheel={wheel} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
        <svg viewBox={`0 0 ${L.width} ${L.height}`} preserveAspectRatio="xMinYMin meet" style={{ width: L.width, height: L.height }}>
          <text className="beat-h" x={L.header.x} y={L.header.y}>{L.header.text}</text>
          <rect className="beat-isrband" x={L.isrBand.x} y={L.isrBand.y} width={L.isrBand.w} height={L.isrBand.h} />
          <text className="beat-isrt" x={L.isrBand.tx} y={L.isrBand.ty}>{L.isrBand.text}</text>
          {L.ticks.map((tk, i) => (
            <g key={i}>
              <line className="beat-tickline" x1={tk.x} y1={tk.y1} x2={tk.x} y2={tk.y2} />
              <text className="beat-tick" x={tk.x + 2} y={tk.y1 - 2}>{tk.label}</text>
            </g>
          ))}
          {L.rows.map((row) => {
            const m = rowOf(row.id);
            const prioTitle = m?.priority
              ? `${t("priority")} ${m.priority.value ?? "?"}${m.priority.symbol ? ` (${m.priority.symbol})` : ""} · ${t(BASIS_LABEL[m.priority.basis] ?? m.priority.basis)}${m.priority.argument ? ` · ${m.priority.argument}` : ""}`
              : t("priority not found at the create call");
            return (
              <g key={row.id} className={`beat-row ${props.selected === row.entry ? "sel" : ""}`} onClick={() => pick(row.entry)} style={{ cursor: "pointer" }}>
                <title>{`${row.name} · ${prioTitle} · ${row.period != null ? t("period {p} ms (delay argument × tick, lower bound)", { p: row.period }) : t(m?.modeNote ?? "period unknown")}`}</title>
                <text className="beat-name" x={row.label.x} y={row.label.y}>{row.label.text}</text>
                <text className={`beat-prio ${row.prio.unresolved ? "unresolved" : ""}`} x={row.prio.x} y={row.prio.y} textAnchor="end"
                  onClick={(e) => { if (row.prio.path) { e.stopPropagation(); props.onOpenFile(row.prio.path, row.prio.line); } }}>
                  <title>{prioTitle}</title>{row.prio.text}
                </text>
                {row.suspend && (
                  <g className="beat-susp" onClick={(e) => { e.stopPropagation(); props.onOpenFile(row.suspend!.path, row.suspend!.line); }}>
                    <title>{`${t("suspendable")}: ${row.suspend.callee ?? ""} · ${String(row.suspend.path ?? "").split("/").pop()}:${row.suspend.line ?? ""}`}</title>
                    <text x={row.suspend.x} y={row.suspend.y}>⏏</text>
                  </g>
                )}
                <line className="beat-lane" x1={row.lane.x1} y1={row.lane.y} x2={row.lane.x2} y2={row.lane.y} />
                {row.band && <rect className={`beat-band ${row.band.kind}`} x={row.band.x} y={row.band.y} width={row.band.w} height={row.band.h} rx={2}><title>{row.band.title}</title></rect>}
                {row.note && <text className="beat-dense-t" x={row.note.x} y={row.note.y}>{row.note.text}</text>}
                {row.leads.map((l, i) => <line key={`l${i}`} className="beat-lead" x1={l.x1} y1={l.y} x2={l.x2} y2={l.y} />)}
                {row.cells.map((c, i) => (
                  <rect key={`c${i}`} className="beat-slot run" x={c.x} y={c.y} width={c.w} height={c.h} rx={1.5}>
                    <title>{`t = ${c.t} ms${c.deferred ? ` · ${t("{n} higher tasks due at the same instant run first", { n: c.deferred })}` : ""}`}</title>
                  </rect>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      {model.rows.some((r) => r.wakeBy.length || r.waits.length) && (
        <details className="dp-more beat-dd">
          <summary><b>{t("Who wakes whom")}</b> <span className="sub">{t("event-driven tasks, what they wait on, and which unit writes the flag")}</span></summary>
          <table className="dd">
            <thead><tr><th>{t("task")}</th><th>{t("waits on")}</th><th>{t("woken by")}</th></tr></thead>
            <tbody>
              {model.rows.filter((r) => r.wakeBy.length || r.waits.length).map((r) => (
                <tr key={r.id}>
                  <td><code>{r.name}</code></td>
                  <td>{r.waits.map((w, i) => <button key={i} className="link" onClick={() => props.onOpenFile(w.path, w.line)}><code>{w.callee}</code>{w.line ? `:${w.line}` : ""}</button>)}</td>
                  <td className="sub">{r.wakeBy.map((w) => `${w.name} ← ${w.producers.map((u) => String(u).split(":").pop()).join(", ")}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {model.dataDeps.length > 0 && (
        <details className="dp-more beat-dd">
          <summary><b>{t("Data dependencies between tasks")}</b> <span className="sub">{t("{n} pairs · a higher task can interrupt a lower one between any two accesses", { n: model.dataDeps.length })}</span></summary>
          <table className="dd">
            <tbody>
              {model.dataDeps.map((d, i) => (
                <tr key={i}><td><code>{d.from.split(":").pop()}</code></td><td>→</td><td><code>{d.to.split(":").pop()}</code></td><td className="sub">{d.resources.join(", ")}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
