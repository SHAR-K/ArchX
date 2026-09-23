// 侧栏的两个槽位，加上跨栏共享的 UI 状态。
//
// Rail 放「本主题里有什么可选」（入口、状态机、中断梯子、依赖的工具条），Inspector 放
// 「点了什么、看什么」——原型里右侧 aside 承担的全部内容。用 portal 而不是把明细状态提到
// 壳子里：各主题自己知道明细长什么样、什么时候出现，壳子只负责给它们一个落点。
//
// 侧栏是 VS Code 自己的侧边栏视图，和舞台面板是两个 webview。同一个 bundle 按 body 上的
// data-mode 决定画哪一半；选了什么主题、选了哪个对象这类跨栏的状态放在 Ui 里，以宿主为
// 唯一来源——谁改都发给宿主，宿主合并后广播，两边都按同一份画。这里的 patch 先本地乐观
// 应用再上报，免得每次点击都要等一个来回。

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface SlotTargets {
  rail: HTMLElement | null;
  inspector: HTMLElement | null;
}

export const Slots = createContext<SlotTargets>({ rail: null, inspector: null });

export function Rail({ children }: { children: ReactNode }) {
  const slots = useContext(Slots);
  return slots.rail ? createPortal(children, slots.rail) : null;
}

export function Inspector({ children }: { children: ReactNode }) {
  const slots = useContext(Slots);
  return slots.inspector ? createPortal(children, slots.inspector) : null;
}

export type ThemeKey = "exec" | "deps" | "timing" | "conc" | "state" | "memory";

/** 跨栏共享的选择状态。形状改了要同步 facts-panel.ts 里的 DEFAULT_UI。 */
export interface Ui {
  theme: ThemeKey;
  exec: { rootId: string | null; reveal: string[] };
  state: { machineId: string | null; stateName: string | null };
  conc: { selected: string | null };
  deps: { kind: "dir" | "cluster"; open: string[] | null; search: string };
  timing: { root: string | null; showIterations: boolean };
}

export const DEFAULT_UI: Ui = {
  theme: "exec",
  exec: { rootId: null, reveal: [] },
  state: { machineId: null, stateName: null },
  conc: { selected: null },
  deps: { kind: "dir", open: null, search: "" },
  timing: { root: null, showIterations: false },
};

export const UiContext = createContext<{ ui: Ui; patch: (patch: Partial<Ui>) => void }>({ ui: DEFAULT_UI, patch: () => {} });

export function useUi() {
  return useContext(UiContext);
}
