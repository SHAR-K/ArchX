// 事实指针：宿主刚派生过哪一份事实，MCP 去哪儿读。
//
// 宿主和 MCP 是两个进程，之间已经有两条单向文件通道（宿主写状态给 MCP 读、MCP 写视图请求
// 给宿主读）。这是第三条，同一个模式：不用本地端口，Windows 上不弹防火墙。
//
// 为什么需要它：事实落在扩展的 globalStorage 里，那个路径由 VS Code 决定（还随发行版、
// 便携安装而变），MCP 自己推不出来。宿主每次派生完写一行，MCP 照着找。
//
// 指针里带快照 ID，所以 Agent 读到的和人在面板上看到的是不是同一份，能当场对上。

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface FactsPointer {
  seq: number;
  at: string;
  /** 工程根：MCP 用它确认这份指针是不是自己这个项目的 */
  root: string;
  /** 事实文件的绝对路径，可能是 .gz */
  factsFile: string;
  /** 投影用的区域前缀，派生必须用同一个，否则和面板看到的不是一回事 */
  region: string;
  /** 派生时当作工程根的那个目录；扫任意目录时它可能在所选目录之上 */
  projectRoot: string;
  snapshot: string;
  label: string;
}

export function archxStateDirectory(): string {
  // 显式指定优先：测试和想把状态放别处的用户用它；不然按平台惯例
  if (process.env.ARCHX_STATE_DIR) return path.resolve(process.env.ARCHX_STATE_DIR);
  return process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "ArchX")
    : path.join(os.homedir(), ".local", "state", "archx");
}

export function projectKey(root: string): string {
  return crypto.createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex").slice(0, 20);
}

export function factsPointerFile(root: string): string {
  return path.join(archxStateDirectory(), "facts", `${projectKey(root)}.json`);
}

/** 宿主派生完就写一行。写失败不影响面板，只是 Agent 这次得自己找。 */
export function publishFactsPointer(root: string, pointer: Omit<FactsPointer, "seq" | "at" | "root">): void {
  const file = factsPointerFile(root);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let previous = 0;
    try { previous = (JSON.parse(fs.readFileSync(file, "utf8")) as FactsPointer).seq ?? 0; } catch { previous = 0; }
    const payload: FactsPointer = { seq: previous + 1, at: new Date().toISOString(), root: path.resolve(root), ...pointer };
    // 先写临时文件再改名：MCP 可能正好在读，半截的 JSON 会让它报一个看不懂的错
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } catch {
    /* 指针只是给 Agent 抄近路的，写不了就算了 */
  }
}

export function readFactsPointer(root: string): FactsPointer | null {
  try {
    return JSON.parse(fs.readFileSync(factsPointerFile(root), "utf8")) as FactsPointer;
  } catch {
    return null;
  }
}

/**
 * 插件激活时登记 VSIX 自带引擎的位置。终端里的 MCP（Claude Code 从插件市场装的那份）拿不到扩展目录，
 * 照这个找；写不了就算了，MCP 还有别的找法。
 */
export function publishEngineLocation(engine: { executable: string; prefixArgs?: string[]; env?: Record<string, string> }): void {
  try {
    const file = path.join(archxStateDirectory(), "engine.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), prefixArgs: [], env: {}, ...engine })}\n`, "utf8");
  } catch {
    /* 同上 */
  }
}
