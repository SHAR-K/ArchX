// 执行关系主题的视图：从哪里开始，什么会被触达。
//
// 左边是入口，右边是从这个入口往下走的调用树。树是按需展开的：一次只算一层孩子，
// 不预先铺开整棵树，因为深的工程铺开就是几千个节点。
//
// 边有四种颜色和标签，其中「调度」那一跳标成推导——代码里没有这条边，是框架规则推出来的。
//
// 入口栏顶上是函数搜索：输入名字，倒推到入口。搜索在这里本地做（函数表已经在 payload 里），
// 链和可达数要走可达性索引，命中后按需向宿主要。点一条链能让右边的树沿着它展开到那个函数。
//
// 树的下面是双根对比：中断 × 别的入口，格子里是两条执行路径都能到达的函数数。
// 这是并发安全审查的起点——一个中断和一个任务同时能到达的函数与变量。
// 矩阵的数来自派生层（宿主和 MCP 用的同一份），点一个格子才去要那一对的明细。

import { t } from "../../../packages/facts-view/src/i18n.mjs";
import { useContext, useEffect, useMemo, useState } from "react";
import type { ExecutionTheme, FunctionEntry, RootComparison, RootProfile, TreeChild } from "../../../packages/facts-view/src/execution/model.d.mts";
import { ExecCanvas, moduleHue } from "./exec-canvas.tsx";
import { Inspector, Rail, UiContext } from "./slots.tsx";

export interface ExecutionProps {
  theme: ExecutionTheme;
  functions: Record<string, { name: string; file: string; line: number }>;
  onOpenFile: (path: string | null | undefined, line?: number | null) => void;
  onCopyId: (id: string) => void;
  onRequestChildren: (symbol: string) => void;
  onRequestEvidence: (from: string, to: string) => void;
  onRequestCompare: (a: string, b: string) => void;
  onRequestEntry: (id: string) => void;
  onClearEntry: () => void;
  children: Record<string, TreeChild[]>;
  evidence: EdgeEvidence | null;
  compare: { a: string; b: string; data: RootComparison | null } | null;
  entry: { id: string; data: FunctionEntry | null } | null;
  profiles: Record<string, RootProfile>;
  onRequestProfile: (id: string) => void;
}

export interface EdgeEvidence {
  from: { id: string; name: string; file: string; line: number; module: string | null };
  to: { id: string; name: string; file: string; line: number; module: string | null; external: boolean };
  sites: number[];
  cross: boolean;
  bypassesHeader: boolean;
}

const KIND_LABEL: Record<string, string> = { main: "main", isr: "interrupt", task: "task", callback: "callback", handler: "callback", timer: "timer" };
const EDGE_LABEL: Record<string, string> = { call: "", register: "registers", schedule: "schedules", irq: "enables" };

function TreeNode({ symbol, edge, depth, ancestors, reveal, props }: { symbol: string; edge: TreeChild | null; depth: number; ancestors: string[]; reveal: Set<string>; props: ExecutionProps }) {
  const [open, setOpen] = useState(depth === 0 || reveal.has(symbol));
  // 「在执行树中展开到这里」：链上的节点被点名就打开，不管之前是不是收着的
  useEffect(() => { if (reveal.has(symbol)) setOpen(true); }, [reveal, symbol]);
  // 一开始就是展开的（根、被点名的链）也要去要孩子，不然永远停在 Loading…
  useEffect(() => { if (open && !ancestors.includes(symbol) && props.children[symbol] === undefined) props.onRequestChildren(symbol); }, [open, symbol]);
  const fn = props.functions[symbol];
  const kids = props.children[symbol];
  const cycle = ancestors.includes(symbol);
  const parent = ancestors[ancestors.length - 1] ?? null;
  const target = reveal.size > 0 && reveal.has(symbol) && !cycle && kids !== undefined && ![...reveal].some((r) => (kids ?? []).some((k) => k.target === r));

  const expand = () => {
    if (cycle) return;
    if (!open && kids === undefined) props.onRequestChildren(symbol);
    setOpen(!open);
  };

  return (
    <div className="tnode" style={{ marginLeft: depth ? 14 : 0 }}>
      <div className={`trow ${target ? "target" : ""}`}>
        <button className="tcaret" onClick={expand} disabled={cycle}>{cycle ? "↺" : open ? "▾" : "▸"}</button>
        {edge && EDGE_LABEL[edge.kind] && (
          <span className={`pill ${edge.kind}`} title={edge.kind === "schedule" ? t("This edge is not in the code: a framework rule says the scheduler polls this task") : ""}>
            {t(EDGE_LABEL[edge.kind])}{edge.derived ? ` · ${t("inferred")}` : ""}
          </span>
        )}
        <button className="link" onClick={() => props.onOpenFile(fn?.file, fn?.line)}><code>{fn?.name ?? symbol.split(":").pop()}</code></button>
        {cycle && <span className="sub">{t("back to an ancestor")}</span>}
        {parent && edge?.kind === "call" && (
          <button className="link sub" onClick={() => props.onRequestEvidence(parent, symbol)} title={t("Evidence for this edge: call sites, whether it crosses modules, whether it bypasses the header")}>
            {edge.line ? `:${edge.line}` : t("evidence")}
          </button>
        )}
      </div>
      {open && !cycle && kids === undefined && <p className="sub" style={{ marginLeft: 20 }}>{t("Loading…")}</p>}
      {open && !cycle && kids?.length === 0 && <p className="sub" style={{ marginLeft: 20 }}>{t("No further calls.")}</p>}
      {open && !cycle && kids?.map((k) => (
        <TreeNode key={`${k.kind}:${k.target}`} symbol={k.target} edge={k} depth={depth + 1} ancestors={[...ancestors, symbol]} reveal={reveal} props={props} />
      ))}
    </div>
  );
}

/** 函数搜索：子串匹配本地函数表，最多 12 个；命中一个就直接要它的入口链 */
function Search({ props }: { props: ExecutionProps }) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const hits = q
    ? Object.entries(props.functions)
      .filter(([id, fn]) => id.startsWith("function:") && !String(fn.file).startsWith("lib:") && fn.name.includes(q))
      .slice(0, 12)
    : [];
  const go = () => { if (hits.length === 1) props.onRequestEntry(hits[0][0]); };
  return (
    <div className="fnsearch-wrap">
      <div className="fnsearch">
        <input value={query} placeholder={t("Type a function name to trace back to its entries")} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
        <button className="ghost" onClick={go} disabled={hits.length !== 1}>{t("Trace")}</button>
      </div>
      {q && hits.length === 0 && <p className="sub hits">{t("No matching function")}</p>}
      {hits.length > 1 && (
        <div className="hits">
          {hits.map(([id, fn]) => (
            <button key={id} className="link block" onClick={() => props.onRequestEntry(id)}>
              <code>{fn.name}</code> <span className="sub">{String(fn.file).split("/").pop()}</span>
            </button>
          ))}
        </div>
      )}
      {hits.length === 1 && (
        <button className="link block hits" onClick={() => props.onRequestEntry(hits[0][0])}>
          <code>{hits[0][1].name}</code> <span className="sub">{String(hits[0][1].file).split("/").pop()} · {t("Enter to trace")}</span>
        </button>
      )}
    </div>
  );
}

/** 函数页：从哪些入口能跑到它，每条链怎么走 */
function EntryCard({ props, onReveal }: { props: ExecutionProps; onReveal: (rootId: string, path: string[]) => void }) {
  const e = props.entry;
  if (!e) return null;
  const d = e.data;
  return (
    <div className="detail entry">
      <div className="detail-head">
        {d
          ? <b><code>{d.name}</code>{d.kind && <span className={`pill ${d.kind}`}> {t(KIND_LABEL[d.kind] ?? d.kind)}</span>}</b>
          : <b><code>{props.functions[e.id]?.name ?? e.id.split(":").pop()}</code></b>}
        <span className="sub">
          {d && <button className="link" onClick={() => props.onOpenFile(d.file, d.line)}>{d.file}:{d.line}</button>}
          {d && ` · ${t("{n} functions run beneath it", { n: d.reaches })}`}
        </span>
        <button className="ghost" onClick={() => props.onCopyId(e.id)}>{t("Copy reference")}</button>
        <button className="ghost" onClick={props.onClearEntry}>×</button>
      </div>
      {!d && <p className="sub">{t("Loading…")}</p>}
      {d && d.unreached && <p className="warn">{t("No entry reaches it: it is not on main's startup path and no task, callback or interrupt reaches it.")}</p>}
      {d && d.chains.length > 0 && (
        <>
          <p className="sub">{t("Chains to entries")} · {t("{n}, each the shortest path", { n: d.chains.length })}</p>
          {d.chains.map((c) => (
            <ul key={c.root.id} className="chain">
              <li>
                <span className={`pill ${c.root.kind ?? ""}`}>{t(KIND_LABEL[c.root.kind ?? ""] ?? c.root.kind ?? "")}</span>
                {c.path.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && <span className="hop">{p.hop} →</span>}{" "}
                    <button className="link" onClick={() => props.onOpenFile(p.file, props.functions[p.id]?.line)}><code>{p.name}</code></button>
                  </span>
                ))}
                <button className="link sub" style={{ marginLeft: 8 }} onClick={() => onReveal(c.root.id, c.path.map((p) => p.id))}>{t("Expand the call tree to here")} →</button>
              </li>
            </ul>
          ))}
        </>
      )}
      {d && d.direct.length > 0 && (
        <p className="sub">
          {t("Direct calls (in region)")} {d.direct.length}:
          {d.direct.slice(0, 20).map((x) => <button key={x.id} className="link" onClick={() => props.onRequestEntry(x.id)}><code>{x.name}</code></button>)}
        </p>
      )}
    </div>
  );
}

/** 共用函数数的深浅：只分四档，数字本身在格子里 */
const level = (n: number) => (n === 0 ? "z" : n < 3 ? "l1" : n < 10 ? "l2" : "l3");

function Compare({ props }: { props: ExecutionProps }) {
  const cmp = props.theme.compare;
  const sel = props.compare;
  const [pickA, setPickA] = useState<string>(cmp.allIsrs[0]?.id ?? "");
  const [pickB, setPickB] = useState<string>(cmp.allOthers[0]?.id ?? "");
  if (!cmp || cmp.allIsrs.length === 0 || cmp.allOthers.length === 0) return null;
  const isSel = (a: string, b: string) => sel?.a === a && sel?.b === b;
  const data = sel?.data ?? null;

  return (
    <section className="cmp">
      <header>
        <b>{t("Two-root comparison")}</b>
        <span className="sub">{t("How many functions an interrupt and another entry can both reach. A cell is the starting point of a concurrency review; click it to see the shared functions and variables")}</span>
      </header>
      {cmp.rows.length === 0
        ? <p className="sub">{t("No interrupt meets another entry at the function level. Variable-level overlap may still exist; pick any pair below.")}</p>
        : (
          <table className="grid">
            <thead>
              <tr>
                <th>{t("Interrupt ＼ entry")}</th>
                {cmp.cols.map((c) => <th key={c.id} className={`unit ${c.kind}`} title={c.id}><code>{c.name}</code></th>)}
              </tr>
            </thead>
            <tbody>
              {cmp.rows.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.name}</code></td>
                  {cmp.cols.map((c) => {
                    const n = cmp.cells[r.id]?.[c.id] ?? 0;
                    return (
                      <td key={c.id} className={`cnt ${level(n)} ${isSel(r.id, c.id) ? "sel" : ""}`} title={t("{a} and {b} share {n} functions", { a: r.name, b: c.name, n })} onClick={() => props.onRequestCompare(r.id, c.id)}>
                        {n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {(cmp.hiddenIsrs > 0 || cmp.hiddenOthers > 0) && (
        <p className="sub hidden-note">
          {t("Hidden because they share no function with the other side")}: {cmp.hiddenIsrs > 0 ? t("{n} interrupts", { n: cmp.hiddenIsrs }) : ""}{cmp.hiddenIsrs > 0 && cmp.hiddenOthers > 0 ? ", " : ""}{cmp.hiddenOthers > 0 ? t("{n} entries", { n: cmp.hiddenOthers }) : ""}. {t("There is no function-level concurrency overlap between them.")}
        </p>
      )}
      <div className="pick">
        <span className="sub">{t("Pick any pair")}</span>
        <select value={pickA} onChange={(e) => setPickA(e.target.value)}>
          {cmp.allIsrs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <span className="sub">×</span>
        <select value={pickB} onChange={(e) => setPickB(e.target.value)}>
          {cmp.allOthers.map((o) => <option key={o.id} value={o.id}>{o.name}{o.kind !== "main" ? ` · ${t(KIND_LABEL[o.kind] ?? o.kind)}` : ""}</option>)}
        </select>
        <button className="ghost" onClick={() => pickA && pickB && props.onRequestCompare(pickA, pickB)}>{t("Show this pair")}</button>
      </div>

      {sel && !data && <p className="sub">{t("Loading…")}</p>}
      {data && (
        <Inspector><div className="detail">
          <div className="detail-head">
            <b><code>{data.a.name}</code> × <code>{data.b.name}</code></b>
            <span className="sub">{t("reach {a} / {b} functions", { a: data.a.reaches, b: data.b.reaches })} · {t("share {f} functions and {v} variables", { f: data.sharedFunctions.length, v: data.sharedVariables.length })}{data.sharedVariables.length > data.sharedFunctions.length ? ` · ${t("variables are shared by direct access, not through common functions, so the two counts need not match")}` : ""}</span>
          </div>
          <div className="two">
            <div>
              <p className="sub">{t("Shared functions")}</p>
              {data.sharedFunctions.length === 0 && <p className="sub">{t("none")}</p>}
              {data.sharedFunctions.map((f) => (
                <button key={f.id} className="link block" onClick={() => props.onOpenFile(props.functions[f.id]?.file ?? f.file, props.functions[f.id]?.line)}>
                  <code>{f.name}</code>
                </button>
              ))}
            </div>
            <div>
              <p className="sub">{t("Variables both sides reach · read/write direction, protection and conflict confidence are under Sharing & concurrency")}</p>
              {data.sharedVariables.length === 0 && <p className="sub">{t("none")}</p>}
              {data.sharedVariables.length > 0 && (
                <table className="grid">
                  <thead><tr><th>{t("Variable")}</th><th className="num">{t("{name}-side functions", { name: data.a.name })}</th><th className="num">{t("{name}-side functions", { name: data.b.name })}</th></tr></thead>
                  <tbody>
                    {data.sharedVariables.map((v) => (
                      <tr key={v.id}>
                        <td><button className="link" onClick={() => props.onOpenFile(v.file, v.line)}><code>{v.name}</code></button></td>
                        <td className="num">{v.aFunctions}</td>
                        <td className="num">{v.bFunctions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div></Inspector>
      )}
    </section>
  );
}

/** 选中的函数：它下面跑着多少函数、按模块怎么分，以及它的直接调用。原型执行树右栏那一块 */
function ProfileCard({ profile, onOpenFile, onPick }: { profile: RootProfile; onOpenFile: ExecutionProps["onOpenFile"]; onPick: (id: string) => void }) {
  const max = Math.max(1, ...profile.byModule.map((m) => m.count));
  return (
    <div className="detail">
      <div className="detail-head">
        <button className="link strong" onClick={() => onOpenFile(profile.file, profile.line)}><code>{profile.name}</code></button>
        <span className="sub">{profile.file}{profile.line ? `:${profile.line}` : ""}{profile.module ? ` · ${profile.module}` : ""}</span>
      </div>
      <p className="sub">{t("{n} functions run below it", { n: profile.reaches })}</p>
      <div className="xp-mods">
        {profile.byModule.map((m) => (
          <div key={m.module} className="xp-mod">
            <span className="xp-bar" style={{ width: `${(m.count / max) * 100}%`, ["--h" as string]: String(moduleHue(m.module)) }} />
            <span className="xp-name">{m.module}</span>
            <span className="xp-n">{m.count}</span>
          </div>
        ))}
      </div>
      {profile.direct.length > 0 && (
        <>
          <p className="sub">{t("Direct calls (in region)")} {profile.direct.length}</p>
          {profile.direct.map((d) => (
            <div key={d.id} className="line">
              <button className="link" onClick={() => onPick(d.id)}><code>{d.name}</code></button>
              {d.kind === "register" && <span className="pill register">{t("registers")}</span>}
              <button className="link sub" onClick={() => onOpenFile(d.file, null)}>{String(d.file ?? "").split("/").pop()}</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function Execution(props: ExecutionProps) {
  const { theme } = props;
  // 选了哪个入口、沿哪条链展开是跨栏的：入口列表和链在侧栏，树在舞台
  const { ui, patch } = useContext(UiContext);
  const rootId = ui.exec.rootId ?? theme.roots[0]?.symbol ?? null;
  const reveal = useMemo(() => new Set(ui.exec.reveal), [ui.exec.reveal]);
  const setRootId = (id: string | null) => patch({ exec: { rootId: id, reveal: [] } });
  // 画布 / 列表：原型默认画布；「在执行树中展开到这里」要的是那条链，切回列表
  const [shape, setShape] = useState<"canvas" | "list">("canvas");
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { if (ui.exec.reveal.length) setShape("list"); }, [ui.exec.reveal]);
  useEffect(() => { setPicked(null); }, [rootId]);
  const focusId = picked ?? rootId;
  useEffect(() => { if (focusId) props.onRequestProfile(focusId); }, [focusId]);
  if (!theme.available) return <p className="empty">{theme.hint ?? t("This scan has no execution-unit facts.")}</p>;
  const root = theme.roots.find((r) => r.symbol === rootId) ?? theme.roots[0];
  const evidence = props.evidence;

  // 沿链展开：切到那个入口，链上每个还没取过孩子的节点都去要一层
  const revealPath = (rootSymbol: string, path: string[]) => {
    patch({ exec: { rootId: rootSymbol, reveal: path } });
    for (const id of path.slice(0, -1)) if (props.children[id] === undefined) props.onRequestChildren(id);
  };

  return (
    <div className="theme">
      <Rail><aside className="machines">
        <Search props={props} />
        {(() => {
          // 内核异常（向量号 < 0）多是启动模板里的空处理：默认折起来，不占首屏
          const rootButton = (r: typeof theme.roots[number]) => (
            <button key={r.id} className={`machine ${r.symbol === root?.symbol ? "sel" : ""}`} onClick={() => setRootId(r.symbol)}>
              <code>{r.name}</code>
              <span className="sub">{t(KIND_LABEL[r.kind] ?? r.kind)} · {t("reaches")} {r.reaches}{r.vector != null ? ` · ${t("vector")} ${r.vector}` : ""}</span>
            </button>
          );
          const isKernel = (r: typeof theme.roots[number]) => Boolean((r as { idle?: boolean }).idle);
          const kernel = theme.roots.filter(isKernel);
          return (
            <>
              {theme.roots.filter((r) => !isKernel(r)).map(rootButton)}
              {kernel.length > 0 && (
                <details className="ol-group" open={kernel.some((r) => r.symbol === root?.symbol)}>
                  <summary className="sub">{t("Core exceptions")} · {kernel.length}</summary>
                  {kernel.map(rootButton)}
                </details>
              )}
            </>
          );
        })()}
        {theme.unreached.length > 0 && (
          <details className="tables">
            <summary className="sub">{t("Reached by no entry")} {theme.unreached.length}</summary>
            {theme.unreached.slice(0, 40).map((u) => (
              <button key={u.id} className="link block" onClick={() => props.onRequestEntry(u.id)}><code>{u.name}</code></button>
            ))}
          </details>
        )}
      </aside></Rail>
      <main className="board">
        <Inspector><EntryCard props={props} onReveal={revealPath} /></Inspector>
        {root && (
          <>
            <header>
              <button className="link strong" onClick={() => props.onOpenFile(props.functions[root.symbol]?.file, props.functions[root.symbol]?.line)}>
                <code>{root.name}</code>
              </button>
              <span className="sub">
                {t(KIND_LABEL[root.kind] ?? root.kind)} · {t("reaches {n} functions", { n: root.reaches })}
                {root.rule && ` · ${t("rule")} ${root.rule}`}
              </span>
              <button className="ghost" onClick={() => props.onCopyId(root.id)}>{t("Copy reference")}</button>
            </header>
            <p className="sub">{theme.basis}</p>
            <div className="seg">
              <button className={shape === "canvas" ? "on" : ""} onClick={() => setShape("canvas")}>{t("Canvas")}</button>
              <button className={shape === "list" ? "on" : ""} onClick={() => setShape("list")}>{t("List")}</button>
            </div>
            {shape === "canvas"
              ? <ExecCanvas rootId={root.symbol} rootName={root.name} rootModule={props.profiles[root.symbol]?.module ?? null} children={props.children}
                  onRequestChildren={props.onRequestChildren} selected={focusId} onSelect={setPicked} onOpenFile={props.onOpenFile}
                  functions={props.functions} profile={props.profiles[root.symbol] ?? null} />
              : (
                <div className="tree">
                  <TreeNode key={root.symbol} symbol={root.symbol} edge={null} depth={0} ancestors={[]} reveal={reveal} props={props} />
                </div>
              )}
            {shape === "canvas" && focusId && props.profiles[focusId] && !props.entry && !evidence && (
              <Inspector><ProfileCard profile={props.profiles[focusId]} onOpenFile={props.onOpenFile} onPick={setPicked} /></Inspector>
            )}
          </>
        )}
        {evidence && (
          <Inspector><div className="detail">
            <div className="detail-head">
              <b><code>{evidence.from.name}</code> → <code>{evidence.to.name}</code></b>
              <span className="sub">
                {evidence.cross ? `${evidence.from.module} → ${evidence.to.module}` : t("same module")}
                {evidence.to.external && ` · ${t("closed-source library")}`}
              </span>
            </div>
            <div className="line">
              {t("{n} call sites", { n: evidence.sites.length })}:
              {evidence.sites.map((l) => <button key={l} className="link" onClick={() => props.onOpenFile(evidence.from.file, l)}>:{l}</button>)}
            </div>
            {evidence.bypassesHeader && (
              <p className="warn">{t("There is a call, but three include hops from {file} never reach the callee's module: a contract bypass.", { file: evidence.from.file.split("/").pop() })}</p>
            )}
          </div></Inspector>
        )}
        {theme.compare && <Compare props={props} />}
      </main>
    </div>
  );
}
