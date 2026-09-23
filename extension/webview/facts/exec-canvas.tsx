// 执行树的画布形态：入口在最左，一层调用深度一列往右，每个函数一张卡片（名字、所在模块、下面还有几个）。
// 子节点按需向宿主要（treeChildren），展开几层就画几层。画布规则和运行图一致：固定高度视口，
// 布局算好后缩放进来；滚轮缩放走原生非 passive 监听，页面不跟着滚；单击展开 / 收起并选中，布局只长不跳。

import { t } from "../../../packages/facts-view/src/i18n.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RootProfile, TreeChild } from "../../../packages/facts-view/src/execution/model.d.mts";

const CW = 210, CH = 38, COLGAP = 70, ROWGAP = 10, PAD = 20;

/** 模块名 → 稳定的颜色（色相按名字散列），同一模块在整张图上同色 */
export function moduleHue(name: string | null | undefined): number {
  let h = 0;
  for (const ch of String(name ?? "")) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

interface Placed { id: string; name: string; module: string | null; count: number; x: number; y: number; depth: number; edge: TreeChild | null; parent: string | null; cycle: boolean; external: boolean }

export function ExecCanvas(props: {
  rootId: string;
  rootName: string;
  rootModule: string | null;
  children: Record<string, TreeChild[]>;
  onRequestChildren: (symbol: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenFile: (path: string | null | undefined, line?: number | null) => void;
  functions: Record<string, { name: string; file: string; line: number }>;
  profile: RootProfile | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([props.rootId]));
  const [view, setView] = useState<{ x: number; y: number; k: number } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [box, setBox] = useState({ w: 900, h: 520 });
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // 换入口就重来
  useEffect(() => { setExpanded(new Set([props.rootId])); setView(null); }, [props.rootId]);
  // 展开了但还没拿到孩子的，去要
  useEffect(() => { for (const id of expanded) if (props.children[id] === undefined) props.onRequestChildren(id); }, [expanded, props.children]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setBox({ w: Math.max(320, el.clientWidth), h: Math.max(240, el.clientHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 布局：叶子自上而下排行，父节点居中于它第一个和最后一个孩子之间；x 按深度
  const layout = useMemo(() => {
    const placed: Placed[] = [];
    let row = 0;
    const walk = (id: string, name: string, module: string | null, count: number, depth: number, edge: TreeChild | null, parent: string | null, ancestors: string[], external: boolean): number => {
      const cycle = ancestors.includes(id);
      const kids = !cycle && expanded.has(id) ? props.children[id] : undefined;
      const me: Placed = { id, name, module, count: kids ? kids.length : count, x: PAD + depth * (CW + COLGAP), y: 0, depth, edge, parent, cycle, external };
      placed.push(me);
      if (kids && kids.length) {
        const ys = kids.map((k) => walk(k.target, k.name ?? props.functions[k.target]?.name ?? k.target.split(":").pop() ?? k.target, k.module ?? null, k.count ?? 0, depth + 1, k, id, [...ancestors, id], Boolean(k.external)));
        me.y = (ys[0] + ys[ys.length - 1]) / 2;
      } else {
        me.y = PAD + row * (CH + ROWGAP);
        row += 1;
      }
      return me.y;
    };
    walk(props.rootId, props.rootName, props.rootModule, props.children[props.rootId]?.length ?? 0, 0, null, null, [], false);
    const width = Math.max(...placed.map((p) => p.x + CW)) + PAD;
    const height = Math.max(...placed.map((p) => p.y + CH)) + PAD;
    return { placed, width, height, byId: new Map(placed.map((p) => [p.id, p])) };
  }, [props.rootId, props.rootName, props.rootModule, props.children, expanded, props.functions]);

  // 适配：放得下就整棵放进来；放不下就保持能读的尺寸（不小于 0.8），把根放在视口竖直中间，其余靠拖和滚轮
  const rootY = layout.byId.get(props.rootId)?.y ?? 0;
  const fit = useMemo(() => {
    const whole = Math.min((box.w - 24) / layout.width, (box.h - 24) / layout.height, 1.2);
    const k = Math.max(whole, 0.8);
    const y = whole >= 0.8 ? (box.h - layout.height * k) / 2 : box.h / 2 - (rootY + CH / 2) * k;
    return { k, x: 12, y };
  }, [box, layout.width, layout.height, rootY]);
  const cur = view ?? fit;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const f = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const r = el.getBoundingClientRect();
      const px = event.clientX - r.left, py = event.clientY - r.top;
      const c = viewRef.current ?? fit;
      const k = Math.min(4, Math.max(0.15, c.k * f));
      setView({ k, x: px - (px - c.x) * (k / c.k), y: py - (py - c.y) * (k / c.k) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fit]);

  const toggle = (p: Placed) => {
    props.onSelect(p.id);
    if (p.cycle || p.count === 0) return;
    setExpanded((prev) => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; });
  };

  const order = props.profile?.id === props.rootId ? props.profile.moduleOrder : [];
  return (
    <section className="xc">
      {order.length > 0 && (
        <div className="xc-order" title={t("Breadth-first from the entry, calls in line order: the first function that enters each module")}>
          <span className="sub">{t("Modules in the order first reached")}:</span>
          {order.map((m, i) => (
            <span key={m.module} className="xc-mod" style={{ ["--h" as string]: String(moduleHue(m.module)) }} title={`${t("first reached at depth {d} through {fn}", { d: m.depth, fn: m.via })}`}>
              {i + 1}. {m.module}
            </span>
          ))}
        </div>
      )}
      <div className="xc-tools">
        <span className="sub">{t("Right = one call deeper · down = source line order · click a card to unfold or fold it")}</span>
        <span className="rm-spacer" />
        <button className="ghost" onClick={() => { setExpanded(new Set([props.rootId])); setView(null); }}>{t("Root only")}</button>
        <button className="ghost" onClick={() => setView(null)}>{t("Fit view")}</button>
      </div>
      <div ref={host} className="xc-vp"
        onMouseDown={(e) => { if ((e.target as Element).closest("[data-fn]")) return; setDrag({ x: e.clientX, y: e.clientY, vx: cur.x, vy: cur.y }); }}
        onMouseMove={(e) => { if (drag) setView({ k: cur.k, x: drag.vx + (e.clientX - drag.x), y: drag.vy + (e.clientY - drag.y) }); }}
        onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}>
        <svg width={box.w} height={box.h}>
          <g transform={`translate(${cur.x},${cur.y}) scale(${cur.k})`}>
            {layout.placed.filter((p) => p.parent).map((p) => {
              const a = layout.byId.get(p.parent!)!;
              const x1 = a.x + CW, y1 = a.y + CH / 2, x2 = p.x, y2 = p.y + CH / 2, mx = x1 + COLGAP / 2;
              return <path key={`e:${p.parent}:${p.id}`} className={`xc-edge ${p.edge?.kind ?? "call"}`} d={`M${x1},${y1} H${mx} V${y2} H${x2}`} />;
            })}
            {layout.placed.map((p) => (
              <g key={`${p.parent ?? ""}>${p.id}`} className={`xc-node ${p.depth === 0 ? "root" : ""} ${props.selected === p.id ? "sel" : ""} ${p.cycle ? "cycle" : ""} ${p.external ? "ext" : ""}`} data-fn={p.id}
                transform={`translate(${p.x},${p.y})`} onClick={() => toggle(p)}
                onDoubleClick={() => props.onOpenFile(props.functions[p.id]?.file, props.functions[p.id]?.line)} style={{ cursor: "pointer" }}>
                <title>{`${p.name}${p.module ? ` · ${p.module}` : ""}${p.edge?.kind === "register" ? ` · ${t("registered here, runs elsewhere")}` : p.edge?.kind === "schedule" ? ` · ${t("scheduler hop inferred from a framework rule")}` : ""}${p.cycle ? ` · ${t("back to an ancestor")}` : ""} · ${t("double-click to open the source")}`}</title>
                <rect width={CW} height={CH} rx={5} />
                <text className="xc-name" x={8} y={15}>{p.name.length > 24 ? `${p.name.slice(0, 23)}…` : p.name}</text>
                {p.module && (
                  <g transform={`translate(8,21)`}>
                    <rect className="xc-tag" width={Math.min(150, p.module.length * 5.6 + 8)} height={12} rx={2} style={{ ["--h" as string]: String(moduleHue(p.module)) }} />
                    <text className="xc-tagt" x={4} y={9}>{p.module.length > 26 ? `${p.module.slice(0, 25)}…` : p.module}</text>
                  </g>
                )}
                {p.cycle ? <text className="xc-count" x={CW - 12} y={24} textAnchor="middle">↺</text>
                  : p.count > 0 && (
                    <g transform={`translate(${CW - 26},11)`}>
                      <rect className={`xc-badge ${expanded.has(p.id) ? "open" : ""}`} width={20} height={16} rx={8} />
                      <text className="xc-count" x={10} y={12} textAnchor="middle">{p.count}</text>
                    </g>
                  )}
              </g>
            ))}
          </g>
        </svg>
      </div>
    </section>
  );
}
