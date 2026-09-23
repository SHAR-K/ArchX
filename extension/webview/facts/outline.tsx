// 一轮里依次做什么：编号步骤，按源码顺序。分支 / 循环是缩进的框，让出点、被调函数里的循环、
// 碰到的共享变量挂在所在的那一步上。数据来自派生层 unitOutline，这里只画和交互：
// 点步骤名跳到被调函数的定义，点行号跳到调用点。

import { t } from "../../../packages/facts-view/src/i18n.mjs";
import type { OutlineLoop, UnitOutline } from "../../../packages/facts-view/src/timing/sequence.d.mts";

const LOOP_LABEL: Record<string, string> = {
  "busy-var": "busy-wait on a variable", "busy-hw": "busy-wait on hardware", "busy-poll": "busy-poll", "inner-infinite": "endless inner loop",
  wait: "yield-wait", iter: "iteration", macro: "macro loop", main: "main loop",
};
const FRAME_LABEL: Record<string, string> = { opt: "if", else: "else", case: "case", switch: "switch", loop: "loop" };

function LoopChip({ loop, onOpenFile }: { loop: OutlineLoop; onOpenFile: (path: string | null | undefined, line?: number | null) => void }) {
  const label = t(LOOP_LABEL[loop.class] ?? loop.class);
  const extra = loop.iterations != null ? ` ≤${loop.iterations}` : loop.busy && loop.exits === 0 && loop.infinite ? ` · ${t("no way out")}` : "";
  return (
    <button className={`ol-chip ${loop.busy ? "bad" : ""}`} onClick={() => onOpenFile(loop.file, loop.line)} title={`${label}${loop.line ? ` · ${String(loop.file ?? "").split("/").pop()}:${loop.line}` : ""}`}>
      ↻ {label}{extra}
    </button>
  );
}

export function Outline({ outline, onOpenFile }: { outline: UnitOutline; onOpenFile: (path: string | null | undefined, line?: number | null) => void }) {
  if (!outline.available) return null;
  const s = outline.summary;
  return (
    <section className="outline">
      <header>
        <b>{t("One round of {name}, in order", { name: outline.name ?? "" })}</b>
        <span className="sub">{outline.range?.label}</span>
      </header>
      <div className="ol-sum">
        <span>{t("{n} steps", { n: s.calls })}</span>
        {s.waits > 0 && <span className="wait">⏸ {t("{n} yields", { n: s.waits })}</span>}
        {s.busy > 0 && <span className="bad">⛔ {t("{n} busy-waits", { n: s.busy })}</span>}
        {s.writes > 0 && <span>✎ {t("writes {n} shared variables", { n: s.writes })}</span>}
        {s.conflicts > 0 && <span className="bad">⚠ {t("{n} conflict candidates", { n: s.conflicts })}</span>}
      </div>
      <ol className="ol-list">
        {outline.steps.map((st, i) => {
          if (st.type === "end") return null;
          const pad = { paddingLeft: `${st.depth * 18 + 4}px` };
          if (st.type === "frame") {
            return (
              <li key={i} className={`ol-frame ${st.kind} ${st.loop?.busy ? "bad" : ""}`} style={pad}>
                <button className="link" onClick={() => onOpenFile(st.file, st.line)}>
                  <span className="kw">{t(FRAME_LABEL[st.kind] ?? st.kind)}</span> <code>{st.label || "—"}</code>
                </button>
                {st.loop && <LoopChip loop={st.loop} onOpenFile={onOpenFile} />}
                <span className="sub ol-line">:{st.line}</span>
              </li>
            );
          }
          if (st.type === "wait") {
            return (
              <li key={i} className="ol-wait" style={pad}>
                <button className="link" onClick={() => onOpenFile(st.file, st.line)}>⏸ {t("yields")} <code>{st.callee}</code></button>
                <span className="sub ol-line">{st.kind} · :{st.line}</span>
              </li>
            );
          }
          return (
            <li key={i} className={`ol-step ${st.vars.some((v) => v.conflict && v.write) ? "hot" : ""}`} style={pad}>
              <span className="ol-n">{st.n}</span>
              <button className="link" onClick={() => onOpenFile(st.targetFile ?? st.file, st.targetLine ?? st.line)} title={t("Open the definition")}>
                <code>{st.name}</code>
              </button>
              {st.type === "self" && <span className="sub"> {t("(its own body)")}</span>}
              {st.inCritical && <span className="ol-chip" title={t("inside a critical section")}>🔒</span>}
              {st.deepYield && <span className="ol-chip wait" title={t("something it calls blocks")}>⏸ {t("yields inside")}</span>}
              {st.loops.map((l, k) => <LoopChip key={k} loop={l} onOpenFile={onOpenFile} />)}
              {st.vars.filter((v) => v.write || v.conflict || v.isrWriters.length).map((v) => (
                <span key={v.name} className={`ol-var ${v.conflict ? "bad" : ""}`} title={`${v.write ? t("writes") : t("reads")} ${v.name}${v.isrWriters.length ? ` · ${t("also written by interrupt")} ${v.isrWriters.join(", ")}` : ""}${v.inCritical ? ` · ${t("inside a critical section")}` : ""}`}>
                  {v.write ? "✎" : "👁"} {v.name}{v.isrWriters.length ? ` ← ${v.isrWriters.join(", ")}` : ""}{v.conflict ? " ⚠" : ""}
                </span>
              ))}
              <button className="link sub ol-line" onClick={() => onOpenFile(st.file, st.line)} title={t("Open the call site")}>:{st.line}</button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
