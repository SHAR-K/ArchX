// 代码事实面板：把引擎事实派生成主题视图，画给人看。
//
// 这是新方向的显示面（见 docs/ARCHX_DIRECTION.md）：Agent 拿派生结果做约束开发，
// 这个面板拿同一份派生结果画图，供人理解和审核。面板不产生事实，也不写回任何状态。
//
// 派生跑在宿主侧，webview 只负责画和交互。这样 MCP 和界面读到的是同一份对象、同一个快照。
//
// 界面分两处：VS Code 侧边栏里的视图放主题导航、本主题可选的对象和检查面板（原型右侧 aside
// 承担的「点什么、看什么」），编辑区的面板只当舞台。两个 webview 跑同一个 bundle 的两种模式，
// 选了什么主题、选了哪个对象这类 UI 状态以宿主为唯一来源：谁改都发到这里，合并后广播给两边，
// 两边都是「事实 + UI 状态」的纯函数。侧栏视图没开时，舞台面板退回「侧 + 舞台合一」。

import { getLocale, t } from "../../packages/facts-view/src/i18n.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import { buildFactsView } from "../../packages/facts-view/src/projection.mjs";
import { answer, derivePayload, irqPairsOf } from "../../packages/facts-view/src/payload.mjs";
import type { FactsPayload, IrqPairs } from "../../packages/facts-view/src/payload.d.mts";
import type { Declarations } from "../../packages/facts-view/src/deps/model.d.mts";
import { buildIndex as buildFactsIndex } from "../../packages/facts-view/src/graph.mjs";
import { readFacts } from "../../packages/core/src/facts-io.ts";
import type { FactsView } from "../../packages/facts-view/src/types.d.mts";

export type { FactsPayload } from "../../packages/facts-view/src/payload.d.mts";
export { NO_DECLARATIONS } from "../../packages/facts-view/src/payload.mjs";

/** 派生结果 + 投影本身；后者留着按需算边明细，不进 payload。region 空串表示整个工程。 */
export function deriveFacts(factsFile: string, projectRoot: string, region: string, options: { declarations?: Declarations } = {}): { payload: FactsPayload; view: FactsView } {
  // 事实可能是压缩的；快照 ID 要按事实本身算，不按落盘编码算，否则同一份事实换个
  // 存法就换个 ID，人和 Agent 手里的引用就对不上了
  const facts = readFacts<Record<string, unknown>>(factsFile);
  const canonical = JSON.stringify(facts);
  const generatedAt = new Date().toISOString();
  const view = buildFactsView(facts, region, { source: factsFile, generatedAt });
  const payload = derivePayload(view, {
    // 快照 ID 认的是事实内容，不是时间：同一份事实反复打开，人和 Agent 说的是同一个快照
    snapshot: crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 12),
    project: String((facts.project as string | undefined) ?? projectRoot),
    projectRoot,
    partition: String(((facts.partition as { id?: string } | undefined)?.id) ?? ""),
    region,
    generatedAt,
    declarations: options.declarations,
  });
  return { payload, view };
}

type Incoming =
  | { type: "ready" }
  | { type: "openFile"; path: string; line?: number }
  | { type: "copyId"; id: string }
  | { type: "ui"; patch: Record<string, unknown> }
  | { type: "edgeDetail"; edgeId: string; sourceFiles: string[]; targetFiles: string[] }
  | { type: "treeChildren"; symbol: string }
  | { type: "callEvidence"; from: string; to: string }
  | { type: "compareRoots"; a: string; b: string }
  | { type: "functionEntry"; id: string }
  | { type: "resourceSides"; name: string }
  | { type: "round"; root: string; showIterations?: boolean }
  | { type: "declare"; declarations: Declarations };

interface Client {
  post(message: unknown): void;
  /** 只有侧栏视图会汇报可见性；舞台面板永远算「不是侧栏」 */
  readonly side: boolean;
  visible(): boolean;
}

/** 选了什么主题、哪个对象。宿主只当它是一个平铺对象来合并，形状由 webview 的 Ui 类型定 */
const DEFAULT_UI: Record<string, unknown> = {
  theme: "exec",
  exec: { rootId: null, reveal: [] },
  state: { machineId: null, stateName: null },
  conc: { selected: null },
  deps: { kind: "dir", open: null, search: "" },
  timing: { root: null, showIterations: false },
};

/**
 * 事实中枢：事实、投影、索引、UI 状态和所有客户端都在这里。
 * 舞台面板和侧栏视图都是它的客户端，谁问都答，答案广播给所有人。
 */
class FactsHub {
  payload: FactsPayload | null = null;
  view: FactsView | null = null;
  workspaceRoot = "";
  onDeclare: ((declarations: Declarations) => void) | null = null;
  private index: ReturnType<typeof buildFactsIndex> | null = null;
  private irqPairs: IrqPairs = new Map();
  private ui: Record<string, unknown> = { ...DEFAULT_UI };
  private readonly clients = new Set<Client>();

  addClient(client: Client): void {
    this.clients.add(client);
    this.announceMode();
  }

  removeClient(client: Client): void {
    this.clients.delete(client);
    this.announceMode();
  }

  broadcast(message: unknown): void {
    for (const client of this.clients) client.post(message);
  }

  /** 侧栏视图在不在、可见不可见，决定舞台面板是只画舞台还是侧 + 舞台合一 */
  announceMode(): void {
    const side = [...this.clients].some((client) => client.side && client.visible());
    this.broadcast({ type: "mode", side });
  }

  setFacts(payload: FactsPayload, view?: FactsView): void {
    this.payload = payload;
    if (view) {
      this.view = view;
      this.index = null;
      this.irqPairs = irqPairsOf(view);
    }
    // 换了一份事实，之前选中的对象大概率不在了；主题保留，其余回默认
    this.ui = { ...DEFAULT_UI, theme: this.ui.theme };
    this.broadcast({ type: "facts", payload });
    this.broadcast({ type: "ui", ui: this.ui });
  }

  select(id: string): void {
    this.broadcast({ type: "select", id });
  }

  setStatus(text: string): void {
    this.broadcast({ type: "status", text });
  }

  handle(message: Incoming, from: Client): void {
    if (message.type === "ready") {
      if (this.payload) from.post({ type: "facts", payload: this.payload });
      from.post({ type: "ui", ui: this.ui });
      this.announceMode();
      return;
    }
    if (message.type === "ui") {
      // 唯一来源在这里：合并后广播全量，两边都按同一份画
      this.ui = { ...this.ui, ...message.patch };
      this.broadcast({ type: "ui", ui: this.ui });
      return;
    }
    if (message.type === "openFile") {
      const root = this.payload?.projectRoot ?? this.workspaceRoot;
      const target = path.isAbsolute(message.path) ? message.path : path.join(root, message.path);
      const line = Math.max(0, (message.line ?? 1) - 1);
      void vscode.window
        .showTextDocument(vscode.Uri.file(target), { selection: new vscode.Range(line, 0, line, 0), preview: true, viewColumn: vscode.ViewColumn.Beside })
        .then(undefined, () => vscode.window.showWarningMessage(t("Cannot open {target}", { target })));
      return;
    }
    if (message.type === "copyId") {
      void vscode.env.clipboard.writeText(message.id);
      void vscode.window.setStatusBarMessage(t("Copied {id}", { id: message.id }), 2000);
      return;
    }
    if (message.type === "declare") {
      if (this.payload) this.payload = { ...this.payload, declarations: message.declarations };
      this.onDeclare?.(message.declarations);
      return;
    }
    if (!this.view) return;
    const index = this.index ?? (this.index = buildFactsIndex(this.view));
    // 下面全是按需算的明细。谁问的无所谓，答案广播：舞台点的格子，明细要落到侧栏里
    const reply = answer(this.view, index, this.irqPairs, message);
    if (reply) this.broadcast(reply);
  }
}

export const factsHub = new FactsHub();

function pageHtml(webview: vscode.Webview, extensionUri: vscode.Uri, mode: "stage" | "side"): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const root = vscode.Uri.joinPath(extensionUri, "dist", "facts");
  const script = webview.asWebviewUri(vscode.Uri.joinPath(root, "main.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(root, "main.css"));
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${style}" />
  <title>ArchX Code Facts</title>
</head>
<body data-mode="${mode}" data-lang="${getLocale()}"><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body>
</html>`;
}

/** 舞台：编辑区里的面板。对外的 setFacts / setStatus / select / onDeclare 都转给中枢，调用方不用知道有两个 webview。 */
export class FactsPanel implements Client {
  static current: FactsPanel | null = null;
  readonly side = false;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  private constructor(private readonly context: vscode.ExtensionContext, workspaceRoot: string) {
    factsHub.workspaceRoot = workspaceRoot;
    this.panel = vscode.window.createWebviewPanel("archx.facts", t("ArchX Code Facts"), vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "facts")],
    });
    this.panel.webview.html = pageHtml(this.panel.webview, context.extensionUri, "stage");
    this.panel.webview.onDidReceiveMessage((message: Incoming) => factsHub.handle(message, this), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    factsHub.addClient(this);
  }

  static show(context: vscode.ExtensionContext, workspaceRoot: string): FactsPanel {
    if (FactsPanel.current && !FactsPanel.current.disposed) {
      FactsPanel.current.panel.reveal(vscode.ViewColumn.One);
      factsHub.workspaceRoot = workspaceRoot;
      return FactsPanel.current;
    }
    FactsPanel.current = new FactsPanel(context, workspaceRoot);
    return FactsPanel.current;
  }

  post(message: unknown): void {
    if (!this.disposed) void this.panel.webview.postMessage(message);
  }

  visible(): boolean {
    return !this.disposed && this.panel.visible;
  }

  get onDeclare(): ((declarations: Declarations) => void) | null { return factsHub.onDeclare; }
  set onDeclare(value: ((declarations: Declarations) => void) | null) { factsHub.onDeclare = value; }

  setFacts(payload: FactsPayload, view?: FactsView): void { factsHub.setFacts(payload, view); }

  /** Agent 或宿主要求把界面停到某个对象上；ID 的种类决定它属于哪个主题。 */
  select(id: string): void { factsHub.select(id); }

  setStatus(text: string): void { factsHub.setStatus(text); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    factsHub.removeClient(this);
    if (FactsPanel.current === this) FactsPanel.current = null;
    for (const item of this.disposables.splice(0)) item.dispose();
    this.panel.dispose();
  }
}

/** 侧栏：VS Code 活动栏 ArchX 容器里的视图，放主题导航、本主题可选的对象和检查面板。 */
export class FactsSideProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "archx.factsSide";

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist", "facts")] };
    view.webview.html = pageHtml(view.webview, this.context.extensionUri, "side");
    const client: Client = {
      side: true,
      post: (message) => void view.webview.postMessage(message),
      visible: () => view.visible,
    };
    view.webview.onDidReceiveMessage((message: Incoming) => factsHub.handle(message, client));
    // 侧栏收起或切到别的容器时，舞台面板要退回合一模式，否则导航和明细都没了
    view.onDidChangeVisibility(() => factsHub.announceMode());
    view.onDidDispose(() => factsHub.removeClient(client));
    factsHub.addClient(client);
  }
}
