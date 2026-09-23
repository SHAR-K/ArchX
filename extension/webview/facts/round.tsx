// 一轮：一个执行单元跑一圈的列式展开。
//
// 读法写在页面上，不能靠人自己知道：
//   往右是嵌套深度，不是时间。同一列里两个框之间也不表示先后。
//   只有一个框内部自上而下才是源码顺序。
//   框右边是这个循环怎么出去；出不去就是出不去，不替它编一个。
//
// 对齐是渲染层的事，因为框有多高取决于字体：一组子框的第一个顶端对齐父框那一行，
// 父框下面的兄弟往下让出这道缝。量的是真实 DOM 高度，来回迭代到不动为止。

import { t } from "../../../packages/facts-view/src/i18n.mjs";
import { useLayoutEffect, useRef, useState } from "react";
import type { Round, RoundBadge, RoundBox, RoundRow } from "../../../packages/facts-view/src/timing/sequence.d.mts";

export interface RoundProps {
  round: Round | null;
  loading: boolean;
  showIterations: boolean;
  onShowIterations: (next: boolean) => void;
  onOpenFile: (path: string | null | undefined, line?: number | null) => void;
  onCopyId: (id: string) => void;
}

const TONE: Record<string, string> = {
  main: "main", "inner-infinite": "busy", "busy-var": "busy", "busy-hw": "busy", "busy-poll": "busy",
  wait: "wait", iter: "iter", macro: "macro",
};
const GLYPH: Record<string, string> = { busy: "⛔", main: "∞", wait: "⟲", iter: "↻", macro: "⌗" };
const CLASS_LABEL: Record<string, string> = {
  main: "main loop", "inner-infinite": "inner infinite", wait: "yield-wait",
  "busy-var": "busy-wait on variable", "busy-hw": "busy-wait on hardware", "busy-poll": "busy-poll", iter: "iteration", macro: "macro expansion",
};
const FRAME_LABEL: Record<string, string> = { opt: "if", else: "else", switch: "switch", case: "case", loop: "↻ loop" };
const EXIT_LABEL: Record<string, string> = {
  cond: "condition fails", break: "break", return: "return", goto: "goto",
  none: "no exit: once in, never out", loopback: "next turn",
};

// 一行上的角标按类型计数。哪个循环具体是哪个，看右边那一列的框头字母
function Badges({ badges }: { badges: RoundBadge[] }) {
  if (!badges.length) return null;
  return (
    <>
      {badges.map((b) => (
        <span key={b.badge + b.loop.line} className={`rd-badge ${TONE[b.loop.class] ?? "iter"}`} title={`${t(CLASS_LABEL[b.loop.class] ?? b.loop.class)}${b.repeat ? ` (${t("this loop already has a box above")})` : ""}\n${b.loop.condition ?? ""}`}>
          {GLYPH[TONE[b.loop.class] ?? "iter"]}{b.badge}
        </span>
      ))}
    </>
  );
}

function Row({ row, onOpenFile }: { row: RoundRow; onOpenFile: RoundProps["onOpenFile"] }) {
  if (row.type === "frame-close") return null;
  const indent = { paddingLeft: 4 + row.indent * 11 };

  if (row.type === "yield") {
    return (
      <div className="rd-row yield" style={indent}>
        <span className="rd-mark wait">⏸</span>
        <code>{row.callee}</code>
        <span className="sub"> {row.kind}{row.conditional ? ` · ${t("yields only when this branch is taken")}` : ` · ${t("yields")}`}</span>
        <button className="rd-line" onClick={() => onOpenFile(row.file, row.line)}>{row.line}</button>
      </div>
    );
  }

  if (row.type === "frame") {
    return (
      <div className={`rd-row frame ${row.kind}`} style={indent}>
        <span className={`rd-brk ${row.kind}`}>{FRAME_LABEL[row.kind] ?? row.kind}</span>
        <code className="rd-cond">{row.label}</code>
        <Badges badges={row.badges} />
        <button className="rd-line" onClick={() => onOpenFile(row.file, row.line)}>{row.line}–{row.to}</button>
      </div>
    );
  }

  if (row.type === "chain") {
    return (
      <div className="rd-row chain" style={indent}>
        <span className="rd-mark chain">↳</span>
        <button className="link" onClick={() => onOpenFile(row.file, row.line)}><code>{row.name}</code></button>
        <Badges badges={row.badges} />
      </div>
    );
  }

  const unguarded = row.variables.filter((v) => (v.conflict || v.isrWriters.length) && !v.inCritical);
  return (
    <div className="rd-row step" style={indent}>
      {row.self
        ? <span className="rd-mark self" title={t("read/written directly by the root function")}>·</span>
        : <span className={`rd-mark ${row.kind === "register" ? "register" : "call"}`} title={row.kind === "register" ? t("registration: the function address is stored into the system, not called here") : t("call")}>{row.kind === "register" ? "⌁" : "→"}</span>}
      <button className="link" onClick={() => onOpenFile(row.file, row.line)}><code>{row.name}</code></button>
      {row.variables.length > 0 && (
        <span className="rd-vars">
          {row.variables.map((v) => (
            <span
              key={v.name}
              className={`rd-var ${v.write ? "w" : "r"} ${(v.conflict || v.isrWriters.length) && !v.inCritical ? "bad" : ""} ${v.inCritical ? "locked" : ""}`}
              title={`${v.kinds.join("/")} · ${v.where}${v.inCritical ? ` · ${t("recognized protection is all inside critical sections")}` : ""}${v.isrWriters.length ? `\n${t("written on the interrupt side by")}: ${v.isrWriters.join(", ")}` : ""}${v.wake ? `\n${t("notification flag: design intent, not a race")}` : ""}`}
            >
              {v.name}
            </span>
          ))}
        </span>
      )}
      {row.deepYield && <span className="rd-deep" title={t("a yield point one level deeper; this step may span several scheduling periods")}>⏬</span>}
      <Badges badges={row.badges} />
      {unguarded.length > 0 && <span className="rd-warn" title={t("collides with an interrupt and no protection seen")}>{unguarded.length}</span>}
    </div>
  );
}

export function RoundView(props: RoundProps) {
  const { round } = props;
  const scroll = useRef<HTMLDivElement>(null);
  const [offsets, setOffsets] = useState<Record<string, number>>({});

  // 对齐：子框顶端对齐它长出来的那一行，父框下面的兄弟往下让出这道缝。
  // 高度只有渲染出来才知道，所以量真实 DOM，来回迭代到不动为止（最多八轮，够了）
  useLayoutEffect(() => {
    const root = scroll.current;
    if (!root || !round) return;
    const next: Record<string, number> = {};
    const boxEl = new Map<string, HTMLElement>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-box]")) boxEl.set(el.dataset.box!, el);
    const rowEl = new Map<string, HTMLElement>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-row]")) rowEl.set(el.dataset.row!, el);
    const bump = (id: string, px: number) => { next[id] = (next[id] ?? 0) + px; };

    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      // ① 子框顶端对齐父框里长出它的那一行
      for (const boxes of round.levels.slice(1)) {
        for (const box of boxes) {
          if (!box.spawnKey) continue;
          const child = boxEl.get(box.id);
          const anchor = rowEl.get(box.spawnKey);
          if (!child || !anchor) continue;
          const delta = anchor.getBoundingClientRect().top - child.getBoundingClientRect().top;
          if (delta > 1) { bump(box.id, delta); moved = true; }
        }
      }
      if (!moved) break;
      // 量下一轮之前先把这一轮的位移写进去
      for (const [id, px] of Object.entries(next)) { const el = boxEl.get(id); if (el) el.style.marginTop = `${px}px`; }
    }
    setOffsets(next);
  }, [round]);

  if (props.loading) return <p className="sub">{t("Unfolding this round…")}</p>;
  if (!round) return <p className="sub">{t("Pick an execution unit to see what one round of it passes through.")}</p>;
  if (!round.available) return <p className="sub">{t("This entry has no round to unfold")}: {round.reason ?? t("no call and loop facts")}.</p>;

  return (
    <div className="rd">
      <div className="rd-title">
        <b>{t("One round of")} <code>{round.name}</code></b>
        <span className="sub"> {round.range.label}</span>
        <label className="rd-toggle">
          <input type="checkbox" checked={props.showIterations} onChange={(e) => props.onShowIterations(e.target.checked)} />
          {t("Also unfold iteration loops")}
        </label>
      </div>
      <p className="sub rd-note">
        {t("Rightward is nesting depth, not time. Two boxes in one column do not imply order either; only top-to-bottom inside one box is source order.")}
        {t("To the right of a box is how that loop exits.")}
        {round.truncated && ` ${t("Deeper loops are not drawn: at most {n} levels", { n: round.maxLevels })}.`}
      </p>
      <div className="rd-scroll" ref={scroll}>
        <div className="rd-levels">
          {round.levels.map((boxes, depth) => (
            <div className="rd-level" key={depth}>
              <div className="rd-level-head">{depth === 0 ? t("one round") : t("loop level {n}", { n: depth })}<span className="sub"> {boxes.length}</span></div>
              {boxes.map((box) => (
                <div key={box.id} data-box={box.id} className="rd-slot" style={{ marginTop: offsets[box.id] ?? 0 }}>
                  <BoxRows box={box} onOpenFile={props.onOpenFile} onCopyId={props.onCopyId} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="sub">
        {t("boxes")} {round.counts.boxes} · {t("steps")} {round.counts.steps} · {t("yields")} {round.counts.yields}
        {round.counts.unguarded > 0 && <> · <b className="bad">{t("accesses that collide with an interrupt with no protection seen")} {round.counts.unguarded}</b></>}
      </p>
    </div>
  );
}

// 行要挂 data-row 供对齐用，所以框体单独一层
function BoxRows({ box, onOpenFile, onCopyId }: { box: RoundBox; onOpenFile: RoundProps["onOpenFile"]; onCopyId: RoundProps["onCopyId"] }) {
  const tone = box.loop ? TONE[box.loop.class] ?? "iter" : "root";
  return (
    <div className={`rd-box ${tone}`}>
      <div className="rd-head">
        {box.badge && <b className="rd-tag">{box.badge}</b>}
        <button className="link" onClick={() => onOpenFile(box.file, box.loop?.line ?? null)}><code>{box.name}</code></button>
        {box.loop && (
          <span className="sub">
            {" "}{CLASS_LABEL[box.loop.class] ?? box.loop.class} · {box.loop.kind} {box.loop.line}–{box.loop.endLine}
            {box.loop.mayTimeOut && ` · ${t("the condition mentions a timeout or count; there may be a bound")}`}
          </span>
        )}
        {box.loop && <button className="ghost" title={t("Copy this loop's reference")} onClick={() => onCopyId(box.loop!.id)}>⧉</button>}
      </div>
      {box.loop?.condition && <div className="rd-boxcond"><code>{box.loop.condition}</code></div>}
      <div className="rd-rows">
        {box.rows.length === 0
          ? <div className="rd-row"><span className="sub">{t("no calls and no yield points in this segment")}</span></div>
          : box.rows.map((row) => (
            <div key={row.key} data-row={row.key}>
              <Row row={row} onOpenFile={onOpenFile} />
            </div>
          ))}
      </div>
      <div className="rd-exits">
        {box.exits.map((e, i) => (
          <span key={i} className={`rd-exit ${e.type}`} title={e.type === "none" ? t("no condition, no break, no return: no way out visible statically") : ""}>
            {EXIT_LABEL[e.type] ?? e.type}
            {e.text && <code> {e.text}</code>}
            {e.line != null && <span className="sub"> :{e.line}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
