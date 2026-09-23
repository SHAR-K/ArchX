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
  /** 本地网页（scan_project 生成）：工程在本机的根目录，「打开源码」跳 vscode://file/… 而不是 GitHub */
  localRoot?: string;
  /** 不进下拉框，只能从链接进来；repo 为空表示没有公开源码，出处不链、打开文件不跳 */
  hidden?: boolean;
  counts: { files: number; functions: number; units: Record<string, number>; sharedResources: number; conflictCandidates: number };
}
interface Manifest { generatedAt: string; engineCommit: string; default?: string; projects: ManifestProject[] }

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

/**
 * 本地网页模式：scan_project 把事实嵌进页面（window.__ARCHX_EMBED__），双击 .html 就能看，
 * 不需要服务、不 fetch——file:// 下 fetch 本来也用不了。data 是 gzip 后的 base64。
 */
interface Embedded { generatedAt: string; engineCommit: string; project: ManifestProject; data: string }
function embedded(): Embedded | null {
  const value = (window as unknown as { __ARCHX_EMBED__?: Embedded | null }).__ARCHX_EMBED__;
  return value && typeof value === "object" && value.data ? value : null;
}
async function viewFromBase64(data: string): Promise<Record<string, unknown>> {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text);
}

async function main() {
  const embed = embedded();
  // 本地网页只看这一个工程：演示页顶栏里指向别的演示工程的入口藏掉
  if (embed) { document.getElementById("production-link")?.remove(); document.querySelector(".site-note")?.remove(); }
  const manifest: Manifest = embed
    ? { generatedAt: embed.generatedAt, engineCommit: embed.engineCommit, projects: [embed.project] }
    : await (await fetch("data/manifest.json")).json();
  const wanted = location.hash.replace(/^#/, "");
  const project = manifest.projects.find((p) => p.id === wanted) ?? manifest.projects.find((p) => p.id === manifest.default) ?? manifest.projects[0];
  if (!project) throw new Error("manifest has no projects");

  // 顶栏：换工程、换语言、出处
  const select = $<HTMLSelectElement>("project");
  for (const p of manifest.projects) {
    if (p.hidden && p.id !== project.id) continue;
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.title} · ${p.kind}`;
    opt.selected = p.id === project.id;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => { location.hash = select.value; location.reload(); });
  // 已经在隐藏工程里就不再显示去它的入口
  if (project.hidden) document.getElementById("production-link")?.remove();
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
  if (project.repo) {
    const link = document.createElement("a");
    link.href = `${project.repo}/tree/${project.commit}`;
    link.target = "_blank"; link.rel = "noopener";
    link.textContent = `${project.repo.replace("https://github.com/", "")} @ ${project.commit.slice(0, 7)}`;
    link.title = project.blurb;
    meta.appendChild(link);
  } else {
    const label = document.createElement("span");
    label.textContent = project.title;
    label.title = project.blurb;
    meta.appendChild(label);
  }
  const snap = document.createElement("span");
  snap.className = "site-dim";
  snap.textContent = ` · snapshot ${project.snapshot}${project.license ? ` · ${project.license}` : ""}${manifest.engineCommit ? ` · engine ${manifest.engineCommit}` : ""}`;
  meta.appendChild(snap);
  document.title = `ArchCheck — ${project.title}`;

  // 数据 → 视图 → payload，和宿主同一条链
  const view = (embed ? await viewFromBase64(embed.data) : await loadView(`data/${project.id}.json.gz`)) as any;
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
    if (project.localRoot) {
      // 本地网页：交给 VS Code 打开那一行（装了 VS Code 才会响应；没装就什么也不发生）
      const full = `${project.localRoot.replace(/\\/g, "/").replace(/\/+$/, "")}/${file.replace(/^\/+/, "")}`;
      const a = document.createElement("a");
      a.href = `vscode://file/${full}${line ? `:${line}` : ""}`;
      a.click();
      return;
    }
    if (!project.repo) return;
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
