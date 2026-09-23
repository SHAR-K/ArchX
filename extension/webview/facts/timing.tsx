// 顺序与时间主题的视图。
//
// 这一页最容易被误读，所以口径写在最上面：引擎知道代码里写了什么数字、哪里会让出，
// 不知道任何一段代码真实跑多久。周期是延时实参乘以 tick，是下界不是实测。

import { t } from "../../../packages/facts-view/src/i18n.mjs";
import type { TimingLoop, TimingTheme } from "../../../packages/facts-view/src/timing/model.d.mts";
import type { Round } from "../../../packages/facts-view/src/timing/sequence.d.mts";
import { RoundView } from "./round.tsx";
import { Beat } from "./beat.tsx";
import { Preemptive } from "./preemptive.tsx";
import { Rail } from "./slots.tsx";

export interface TimingProps {
  theme: TimingTheme;
  onOpenFile: (path: string | null | undefined, line?: number | null) => void;
  onCopyId: (id: string) => void;
  /** 一轮按需算：选中哪个单元才去要哪个 */
  round: Round | null;
  roundLoading: boolean;
  roundRoot: string | null;
  showIterations: boolean;
  onRequestRound: (root: string, showIterations: boolean) => void;
}

const UNIT_LABEL: Record<string, string> = { isr: "interrupt", task: "task", callback: "callback", timer: "timer", main: "main" };
const SCHEDULING_LABEL: Record<string, string> = { cooperative: "Cooperative: a task runs until it yields; tasks do not preempt each other, only interrupts cut in", preemptive: "Preemptive: tasks can interrupt each other", unknown: "Scheduling model unknown" };

/** 跑多少次：引擎只读 for 头部，体内若改动计数器或上界，这个数就不成立——所以措辞说「最多」，不说「恰好」 */
function iterationsText(loop: TimingLoop): string {
  const it = loop.iterations;
  if (loop.infinite) return "";
  if (!it || !it.variable) return t("not a counted loop; how many times it runs depends on when the condition fails");
  const head = `${it.variable} ${t("from")} ${it.start ?? "?"} ${it.comparison ?? ""} ${it.limit ?? "?"}${it.step != null && it.step !== 1 ? `, ${t("step")} ${it.step}` : ""}`;
  if (it.max != null) return `${head} · ${t("at most {n} times", { n: it.max })}`;
  if (it.basis === "variable") return `${head} · ${t("the bound is a variable; the count depends on runtime")}`;
  if (it.basis === "sizeof") return `${head} · ${t("the bound is an array length")}`;
  return `${head} · ${t("the bound could not be resolved")}`;
}

function LoopRow({ loop, theme, onOpenFile }: { loop: TimingLoop; theme: TimingTheme; onOpenFile: TimingProps["onOpenFile"] }) {
  const meta = theme.loopClasses?.[loop.class];
  return (
    <tr>
      <td>
        <button className="link" onClick={() => onOpenFile(loop.file, loop.line)}>
          <code>{loop.name}</code> {loop.file?.split("/").pop()}:{loop.line}
        </button>
      </td>
      <td><span className={`pill loop-${meta?.tone ?? "iter"}`} title={meta?.hint ? t(meta.hint) : ""}>{t(meta?.label ?? loop.class)}</span></td>
      <td className="sub"><code>{loop.condition ?? (loop.infinite ? t("unconditional") : "")}</code></td>
      <td className="sub" title={t("Only the for header is read; if the body changes the counter or the bound, this number does not hold")}>{iterationsText(loop)}</td>
      <td className="sub">
        {loop.blocking.length > 0 && `${t("yields")} ${loop.blocking.map((b) => b.callee).join(", ")}`}
        {loop.blocking.length === 0 && loop.mayTimeOut && t("the condition mentions a timeout or count; there may be a bound, the engine does not guarantee it")}
        {loop.blocking.length === 0 && !loop.mayTimeOut && meta?.tone === "busy" && t("no yield and no timeout seen")}
      </td>
      <td className="sub">{loop.exits.length > 0 ? t("{n} early exits", { n: loop.exits.length }) : ""}</td>
    </tr>
  );
}

export function Timing(props: TimingProps) {
  const { theme } = props;
  if (!theme.available) return <p className="empty">{theme.hint ?? t("This scan has no timing facts.")}</p>;
  const busy = theme.loops.filter((l) => theme.loopClasses?.[l.class]?.tone === "busy");

  return (
    <div className="board wide">
      <Rail>
        <aside className="machines">
          {theme.units.map((u) => (
            <button key={u.id} className={`machine ${props.roundRoot === u.entry ? "sel" : ""}`} disabled={!u.entry} onClick={() => u.entry && props.onRequestRound(u.entry, props.showIterations)} title={props.roundRoot === u.entry ? t("Click again to collapse") : t("See what one round of it passes through")}>
              <code>{u.name}</code>
              <span className="sub">{t(UNIT_LABEL[u.kind] ?? u.kind)} · {t(u.modeLabel ?? "unknown")}{u.periodMs != null ? ` · ${u.periodMs} ms` : ""}{u.busyLoops ? ` · ${t("busy-wait")} ${u.busyLoops}` : ""}</span>
            </button>
          ))}
          <label className="sub rail-toggle">
            <input type="checkbox" checked={props.showIterations} onChange={(e) => props.roundRoot && props.onRequestRound(props.roundRoot, e.target.checked)} disabled={!props.roundRoot} />
            {" "}{t("Also unfold iteration loops")}
          </label>
        </aside>
      </Rail>
      <header>
        <b>{t("Order & time")}</b>
        <span className="sub">
          {t(SCHEDULING_LABEL[theme.scheduling ?? "unknown"] ?? theme.scheduling ?? "")}
          {theme.tickMs != null && ` · tick ${theme.tickMs} ms`}
          {theme.counts && ` · ${t("loops")} ${theme.counts.loops}`}
        </span>
      </header>
      <p className="sub">{theme.basis}</p>

      {theme.pollingOrder && theme.pollingOrder.length > 0 && (
        <p className="sub">
          {t("Polling order (depth-first from main, registrations in call-line order)")}:
          {theme.pollingOrder.map((p) => <span key={p.unit}> #{p.position} <code>{p.name}</code></span>)}
        </p>
      )}

      {theme.preemptive?.available
        ? <Preemptive model={theme.preemptive} selected={props.roundRoot} onSelect={(entry) => props.onRequestRound(entry, props.showIterations)} onOpenFile={props.onOpenFile} />
        : <Beat model={theme.beat} selected={props.roundRoot} onSelect={(entry) => props.onRequestRound(entry, props.showIterations)} onOpenFile={props.onOpenFile} />}

      <h4>{t("Rhythm of execution units")}</h4>
      <table className="grid">
        <thead><tr><th>{t("Unit")}</th><th>{t("Mode")}</th><th className="num">{t("Period")}</th><th className="num">{t("Busy-wait")}</th><th className="num">{t("Yield-wait")}</th><th>{t("Basis")}</th></tr></thead>
        <tbody>
          {theme.units.map((u) => (
            <tr key={u.id} className={`${props.roundRoot === u.entry ? "sel" : ""} ${u.entry ? "pick" : ""}`} onClick={() => u.entry && props.onRequestRound(u.entry, props.showIterations)}>
              <td>
                <span className={`pill ${u.kind}`}>{UNIT_LABEL[u.kind] ?? u.kind}</span>{" "}
                <button className="link" onClick={() => props.onOpenFile(u.file)}><code>{u.name}</code></button>
              </td>
              <td>{t(u.modeLabel ?? "unknown")}{u.confidence && <span className="sub"> {u.confidence}</span>}</td>
              <td className="num">{u.periodMs == null ? "—" : u.periodMs >= 1000 ? `${u.periodMs / 1000} s` : `${u.periodMs} ms`}</td>
              <td className={`num ${u.busyLoops ? "bad" : ""}`}>{u.busyLoops || ""}</td>
              <td className="num">{u.waitLoops || ""}</td>
              <td className="sub">{u.periodMs != null ? t("delay argument × tick, a lower bound") : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 一轮：表格能说「这里有三个循环」，说不了「先走到哪、在哪停下」。这一段就是为了说后者 */}
      <RoundView
        round={props.round}
        loading={props.roundLoading}
        showIterations={props.showIterations}
        onShowIterations={(next) => props.roundRoot && props.onRequestRound(props.roundRoot, next)}
        onOpenFile={props.onOpenFile}
        onCopyId={props.onCopyId}
      />

      {busy.length > 0 && (
        <>
          <h4 className="bad">{t("Busy-wait")} <span className="sub">{t("{n} sites", { n: busy.length })} · {t("no yield: the whole schedule stalls; for how long depends on external conditions and cannot be seen statically")}</span></h4>
          <table className="grid">
            <thead><tr><th>{t("Location")}</th><th>{t("Class")}</th><th>{t("Condition")}</th><th>{t("Count")}</th><th>{t("Yield / timeout")}</th><th>{t("Exit")}</th></tr></thead>
            <tbody>{busy.map((l) => <LoopRow key={l.id} loop={l} theme={theme} onOpenFile={props.onOpenFile} />)}</tbody>
          </table>
        </>
      )}

      <details className="dp-more" open={busy.length === 0}>
        <summary><b>{t("All loops")}</b> <span className="sub">{theme.counts?.loops ?? 0} · {Object.entries(theme.counts?.byClass ?? {}).map(([k, n]) => `${t(theme.loopClasses?.[k]?.label ?? k)} ${n}`).join(" · ")}</span></summary>
        <table className="grid">
          <thead><tr><th>{t("Location")}</th><th>{t("Class")}</th><th>{t("Condition")}</th><th>{t("Count")}</th><th>{t("Yield / timeout")}</th><th>{t("Exit")}</th></tr></thead>
          <tbody>{theme.loops.map((l) => <LoopRow key={l.id} loop={l} theme={theme} onOpenFile={props.onOpenFile} />)}</tbody>
        </table>
      </details>

      {theme.yieldLocals && theme.yieldLocals.length > 0 && (
        <details className="dp-more" open>
          <summary>
            <b className="bad">{t("Locals not preserved across a yield")}</b>
            <span className="sub"> {theme.yieldLocals.length} · {t("in a stackless coroutine a yield is a return: a non-static local on the stack no longer holds its value next time")}</span>
          </summary>
          {theme.yieldLocals.map((y, i) => (
            <div key={i} className="line">
              <button className="link" onClick={() => props.onOpenFile(y.file, y.writtenAt?.line)}>
                <code>{y.variable}</code> {t("in")} <code>{y.name}</code>
              </button>
              <span className="sub">
                {" "}{t("written at line {w}, {callee} yields, read again at line {r}", { w: y.writtenAt?.line, callee: y.callee, r: y.readAt?.line })}
              </span>
            </div>
          ))}
        </details>
      )}

      {theme.timeBase && theme.timeBase.length > 0 && (
        <details className="dp-more">
          <summary><b>{t("Where time comes from")}</b> <span className="sub">{t("{n} entries", { n: theme.timeBase.length })} · {t("the numbers in the firmware that define time, each with its source")}</span></summary>
          {theme.timeBase.map((t, i) => {
            const item = t as { kind: string; name?: string; value?: number; unit?: string; expression?: string; confidence?: string; location?: { path: string; line: number } };
            return (
              <div key={i} className="line">
                <code>{item.name ?? item.kind}</code>
                <span className="sub">
                  {" "}{item.kind}
                  {item.value != null && ` = ${item.value}${item.unit ?? ""}`}
                  {item.expression && ` · ${item.expression}`}
                  {item.confidence && ` · ${item.confidence}`}
                </span>
                {item.location && <button className="link" onClick={() => props.onOpenFile(item.location!.path, item.location!.line)}>{item.location.path.split("/").pop()}:{item.location.line}</button>}
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}
