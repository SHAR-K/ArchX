// 静态演示页：把插件的 webview 原样跑在浏览器里，宿主那一半在这儿用同一份派生代码顶替。
//
// 插件里 webview 通过 acquireVsCodeApi().postMessage 问宿主，宿主算完 postMessage 回来。
// 这里在 import 面板之前先把 acquireVsCodeApi 挂到 window 上：问题落到本地 answer()，
// 答案用 window.postMessage 送回去，面板一行不改。「打开文件」变成跳到 GitHub 上那个 commit 的那一行。
//
// 数据是 build-site.mts 出的投影（gzip），主题在页面里算——和插件宿主同一份 derivePayload。

import "./theme.css";
import { buildIndex } from "../packages/facts-view/src/graph.mjs";
import { answer, derivePayload, irqPairsOf, NO_DECLARATIONS } from "../packages/facts-view/src/payload.mjs";
import { getLocale } from "../packages/facts-view/src/i18n.mjs";

interface ManifestProject {
  id: string; title: string; repo: string; commit: string; license: string; kind: string; blurb: string; build: string;
  focus: string[]; region: string; snapshot: string;
  counts: { files: number; functions: number; units: Record<string, number>; sharedResources: number; conflictCandidates: number };
}
interface Manifest { generatedAt: string; engineCommit: string; projects: ManifestProject[] }

const DEFAULT_UI = {
  theme: "exec",
  exec: { rootId: null, reveal: [] },
  state: { machineId: null, stateName: null },
  conc: { selected: null, unit: null, page: null, filter: null, showIdle: false },
  deps: { kind: "dir", open: null, search: "" },
  timing: { root: null, showIterations: false },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** .gz 直接下下来在浏览器里解；托管方若已按 Content-Encoding 解过，拿到的就是明文 */
async function loadView(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gzipped
    ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : new TextDecoder().decode(buf);
  return JSON.parse(text);
}

async function main() {
  const manifest: Manifest = await (await fetch("data/manifest.json")).json();
  const wanted = location.hash.replace(/^#/, "");
  const project = manifest.projects.find((p) => p.id === wanted) ?? manifest.projects[0];
  if (!project) throw new Error("manifest has no projects");

  // 顶栏：换工程、换语言、出处
  const select = $<HTMLSelectElement>("project");
  for (const p of manifest.projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.title} · ${p.kind}`;
    opt.selected = p.id === project.id;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => { location.hash = select.value; location.reload(); });
  const lang = $<HTMLButtonElement>("lang");
  const zh = getLocale() === "zh-CN";
  lang.textContent = zh ? "English" : "中文";
  lang.addEventListener("click", () => {
    const next = zh ? "en" : "zh-CN";
    try { localStorage.setItem("archx.lang", next); } catch { /* 私密窗口没有它也行 */ }
    const url = new URL(location.href); url.searchParams.set("lang", next); location.href = url.toString();
  });
  const meta = $<HTMLSpanElement>("meta");
  meta.replaceChildren();
  const link = document.createElement("a");
  link.href = `${project.repo}/tree/${project.commit}`;
  link.target = "_blank"; link.rel = "noopener";
  link.textContent = `${project.repo.replace("https://github.com/", "")} @ ${project.commit.slice(0, 7)}`;
  link.title = project.blurb;
  meta.appendChild(link);
  const snap = document.createElement("span");
  snap.className = "site-dim";
  snap.textContent = ` · snapshot ${project.snapshot} · ${project.license}${manifest.engineCommit ? ` · engine ${manifest.engineCommit}` : ""}`;
  meta.appendChild(snap);
  document.title = `ArchCheck — ${project.title}`;

  // 数据 → 视图 → payload，和宿主同一条链
  const view = await loadView(`data/${project.id}.json.gz`) as any;
  const index = buildIndex(view);
  const irqPairs = irqPairsOf(view);
  let payload = derivePayload(view, {
    snapshot: project.snapshot,
    project: project.title,
    projectRoot: "",
    partition: project.focus.length === 1 && project.focus[0] === "**" ? "" : project.id,
    region: project.region,
    generatedAt: manifest.generatedAt,
    declarations: NO_DECLARATIONS,
  });
  // ?theme=conc 之类的深链接：直接落到某个主题，截图和分享用
  const wantedTheme = new URLSearchParams(location.search).get("theme");
  let ui: Record<string, unknown> = { ...DEFAULT_UI, ...(wantedTheme && ["exec", "deps", "timing", "conc", "state", "memory"].includes(wantedTheme) ? { theme: wantedTheme } : {}) };
  // ?unit=<名字>：直接选中「顺序与时间」里的一个执行单元，它一轮的步骤会展开
  const wantedUnit = new URLSearchParams(location.search).get("unit");
  const unitHit = wantedUnit ? (payload.themes.timing.units ?? []).find((u: { name: string; entry: string | null }) => u.name === wantedUnit && u.entry) : null;
  if (unitHit) ui = { ...ui, timing: { root: unitHit.entry, showIterations: false } };

  const post = (message: unknown) => window.postMessage(message, "*");
  const openOnGitHub = (file: string, line?: number) => {
    const url = `${project.repo}/blob/${project.commit}/${file.replace(/^\/+/, "")}${line ? `#L${line}` : ""}`;
    window.open(url, "_blank", "noopener");
  };
  const handle = (message: any) => {
    switch (message?.type) {
      case "ready":
        post({ type: "facts", payload });
        post({ type: "ui", ui });
        post({ type: "mode", side: false }); // 没有 VS Code 侧栏：主题导航和对象列表画在页面里
        return;
      case "ui":
        ui = { ...ui, ...message.patch };
        post({ type: "ui", ui });
        return;
      case "openFile":
        openOnGitHub(String(message.path), message.line ?? undefined);
        return;
      case "copyId":
        void navigator.clipboard?.writeText(String(message.id));
        return;
      case "declare":
        payload = { ...payload, declarations: message.declarations };
        return;
      default: {
        const reply = answer(view, index, irqPairs, message);
        if (reply) post(reply);
      }
    }
  };
  (window as any).acquireVsCodeApi = () => ({ postMessage: handle });

  // 面板在 import 时就挂载并发 ready，所以 shim 必须在这之前就位
  await import("../extension/webview/facts/main.tsx");
}

main().catch((error) => {
  const root = document.getElementById("root");
  if (root) root.innerHTML = `<div class="boot"><p>Could not load the facts.</p><p class="sub">${String(error?.message ?? error)}</p></div>`;
});
