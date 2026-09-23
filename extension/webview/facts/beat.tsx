// 节拍：横轴毫秒、纵轴一行一个任务的画布。模型和坐标都来自派生层，这里只画和交互：
// 左右滚动（横向滚轮 / shift + 滚轮）= 缩放时间跨度，拖动 = 平移，「复位」回到整个超周期。
// 点一行选中那个任务，它的一轮在下面展开；点延时标签跳到源码那一行。

import { t } from "../../../packages/facts-view/src/i18n.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { layoutBeat } from "../../../packages/facts-view/src/timing/beat.mjs";
import type { BeatModel } from "../../../packages/facts-view/src/timing/beat.d.mts";

export interface BeatProps {
  model: BeatModel;
  selected: string | null;
  onSelect: (entry: string) => void;
  onOpenFile: (path: string | null | undefined, line?: number | null) => void;
}

const UNIT_LABEL: Record<string, string> = { isr: "interrupt", task: "task", callback: "callback", timer: "timer", main: "main" };
const fmtMs = (ms: number) => (ms >= 1000 ? `${+(ms / 1000).toFixed(3)} s` : `${+ms.toFixed(ms < 10 ? 1 : 0)} ms`);

export function Beat(props: BeatProps) {
  const { model } = props;
  const host = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);
  const [span, setSpan] = useState<number | null>(null);
  const [t0, setT0] = useState(0);
  const drag = useRef<{ x: number; from: number; per: number; moved: boolean } | null>(null);

  // 画布永远一页宽：跟着容器走，缩放只改跨度
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(720, el.clientWidth - 2));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => (model.available ? layoutBeat(model, { width, t0, span: span ?? undefined }) : null), [model, width, t0, span]);

  if (!model.available) return <p className="sub beat-off">{model.hint ?? t("The beat cannot be drawn.")}</p>;
  if (!layout) return null;
  const L = layout;

  const wheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY)) return; // 纵向滚动交回页面
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
  const up = () => { const d = drag.current; setTimeout(() => { drag.current = null; }, 0); return d?.moved ?? false; };
  const pick = (entry: string) => { if (drag.current?.moved) return; props.onSelect(entry); };

  return (
    <section className="beat">
      {model.chips && model.chips.length > 0 && (
        <div className="beat-facts">
          {model.chips.map((c) => (
            c.path
              ? <button key={c.label} className={`bf ${c.bad ? "bad" : ""}`} onClick={() => props.onOpenFile(c.path, c.line)}><i>{c.label}</i><b>{c.value}</b><u>{String(c.path).split("/").pop()}{c.line ? `:${c.line}` : ""}</u></button>
              : <span key={c.label} className={`bf ${c.bad ? "bad" : ""}`}><i>{c.label}</i><b>{c.value}</b></span>
          ))}
        </div>
      )}
      <div className="beat-tools">
        <span className="sub">{fmtMs(L.t0)} – {fmtMs(L.t1)} · {t("span")} {fmtMs(L.span)}{model.lcm ? ` · ${t("hyperperiod")} ${fmtMs(model.lcm)}` : ""}</span>
        <span className="beat-key"><i className="run" />{t("runs")}<i className="unb" />{t("unbounded busy-wait")}<i className="band" />{t("every round / denser than a cell")}<i className="lead" />{t("lead back to due time")}</span>
        <span className="beat-spacer" />
        {model.unplaced ? <span className="sub">{t("{n} tasks are not in the polling order and go last", { n: model.unplaced })}</span> : null}
        <button className="ghost" onClick={() => { setT0(0); setSpan(null); }}>{t("Reset")}</button>
      </div>
      <div ref={host} className="beat-vp" onWheel={wheel} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
        <svg viewBox={`0 0 ${L.width} ${L.height}`} preserveAspectRatio="xMinYMin meet" style={{ width: L.width, height: L.height }}>
          <text className="beat-h" x={L.header.x} y={L.header.y}>{L.header.text}</text>
          <rect className="beat-isrband" x={L.isrBand.x} y={L.isrBand.y} width={L.isrBand.w} height={L.isrBand.h} />
          <text className="beat-isrt" x={L.isrBand.tx} y={L.isrBand.ty}>{L.isrBand.text}</text>
          {L.ticks.map((t, i) => (
            <g key={i}>
              <line className="beat-tickline" x1={t.x} y1={t.y1} x2={t.x} y2={t.y2} />
              <text className="beat-tick" x={t.x + 2} y={t.y1 - 2}>{t.label}</text>
            </g>
          ))}
          {L.rows.map((row) => (
            <g key={row.id} className={`beat-row ${props.selected === row.entry ? "sel" : ""}`} onClick={() => pick(row.entry)} style={{ cursor: "pointer" }}>
              <title>{`${row.name} · ${row.always ? t("runs every round") : row.period != null ? t("period {p} ms (delay argument × tick, lower bound)", { p: row.period }) : t("period unknown")}${row.unbounded ? ` · ${t("reaches unbounded busy-wait")}` : ""}`}</title>
              <text className="beat-name" x={row.label.x} y={row.label.y}>{row.label.text}</text>
              {row.note && !row.note.inPlot && <text className="beat-per" x={row.note.x} y={row.note.y} textAnchor="end">{row.note.text}</text>}
              {row.chips.map((c, i) => (
                <g key={i} className="beat-chip" onClick={(e) => { e.stopPropagation(); props.onOpenFile(c.path, c.line); }}>
                  <title>{c.title}</title>
                  <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={3} />
                  <text x={c.x + c.w / 2} y={c.y + c.h - 3} textAnchor="middle">{c.label}</text>
                </g>
              ))}
              {row.suspend && (
                <g className="beat-susp" onClick={(e) => { e.stopPropagation(); props.onOpenFile(row.suspend!.path, row.suspend!.line); }}>
                  <title>{`${t("suspendable")}: ${row.suspend.callee ?? ""} · ${String(row.suspend.path ?? "").split("/").pop()}:${row.suspend.line ?? ""}`}</title>
                  <text x={row.suspend.x} y={row.suspend.y}>⏏</text>
                </g>
              )}
              <line className="beat-lane" x1={row.lane.x1} y1={row.lane.y} x2={row.lane.x2} y2={row.lane.y} />
              {row.band && <rect className={`beat-band ${row.unbounded ? "unbounded" : "run"}`} x={row.band.x} y={row.band.y} width={row.band.w} height={row.band.h} rx={2}><title>{row.band.title}</title></rect>}
              {row.note?.inPlot && <text className="beat-dense-t" x={row.note.x} y={row.note.y}>{row.note.text}</text>}
              {row.leads.map((l, i) => <line key={`l${i}`} className="beat-lead" x1={l.x1} y1={l.y} x2={l.x2} y2={l.y} />)}
              {row.cells.map((c, i) => (
                <rect key={`c${i}`} className={`beat-slot ${c.unbounded ? "unbounded" : "run"}`} x={c.x} y={c.y} width={c.w} height={c.h} rx={1.5}>
                  <title>{`${c.t == null ? "" : `t = ${c.t} ms · `}${t("segment")} ${c.index + 1}/${c.count} · ${t("{n} calls", { n: c.calls })}${c.bounded ? ` + ${t("bounded loops {n} steps", { n: c.bounded })}` : ""}${c.unboundedCount ? ` · ${t("unbounded busy-wait")} ${c.unboundedCount}` : ""}${c.callee ? ` · ${t("yield")} ${c.callee}${c.wait != null ? ` ${c.wait} ms` : ""}` : ""}`}</title>
                </rect>
              ))}
              {row.yields.map((y, i) => <line key={`y${i}`} className={`beat-yield ${y.sleep ? "sleep" : ""}`} x1={y.x} y1={y.y1} x2={y.x} y2={y.y2} />)}
            </g>
          ))}
        </svg>
      </div>
      {model.dataDeps.rows.length > 0 && (
        <details className="dp-more beat-dd">
          <summary>
            <b>{t("Data dependencies (between execution units)")}</b>
            <span className="sub"> {t("{n} rows", { n: model.dataDeps.rows.length })} · {Object.entries(model.dataDeps.counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${model.dataDeps.rows.find((r) => r.order === k)?.label ?? k} ${n}`).join(" · ")} · {t("order judged by polling position")}</span>
          </summary>
          {model.pollingOrder && model.pollingOrder.length > 0 && (
            <p className="sub">{t("Polling order")}: {model.pollingOrder.map((p) => <span key={p.unit}> #{p.position} <code>{p.name}</code></span>)}</p>
          )}
          <table className="grid">
            <thead><tr><th>{t("Writer")}</th><th>{t("Reader")}</th><th>{t("Variable")}</th><th>{t("Order")}</th></tr></thead>
            <tbody>
              {model.dataDeps.rows.slice(0, 400).map((d, i) => (
                <tr key={i} className={`dd-${d.order}`}>
                  <td><span className={`pill ${d.fromKind}`}>{t(UNIT_LABEL[d.fromKind] ?? d.fromKind)}</span> <code>{d.from.split(":").slice(1).join(":")}</code>{d.fromPosition != null && <span className="sub"> #{d.fromPosition + 1}</span>}</td>
                  <td><span className={`pill ${d.toKind}`}>{t(UNIT_LABEL[d.toKind] ?? d.toKind)}</span> <code>{d.to.split(":").slice(1).join(":")}</code>{d.toPosition != null && <span className="sub"> #{d.toPosition + 1}</span>}</td>
                  <td>{d.resources.map((r) => <button key={r.name} className="link" onClick={() => props.onOpenFile(r.file, r.line)}><code>{r.name}</code></button>)}</td>
                  <td className="sub">{d.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
