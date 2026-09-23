import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ClaudeStatus {
  available: boolean;
  runnable: boolean;
  executable: string;
  version: string;
  message: string;
}

function spawnCli(executable: string, args: string[]): ChildProcessWithoutNullStreams {
  return spawn(executable, args, { shell: false, windowsHide: true });
}

function candidateExecutables(): string[] {
  const candidates = [process.env.ARCHX_CLAUDE_PATH, "claude"];
  if (process.platform === "win32" && process.env.APPDATA) {
    candidates.unshift(path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
  }
  return candidates.filter((candidate): candidate is string => Boolean(candidate));
}

function collect(processHandle: ChildProcessWithoutNullStreams): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    processHandle.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    processHandle.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    processHandle.on("close", (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }));
    processHandle.on("error", (error) => resolve({ code: 1, stdout, stderr: String(error) }));
  });
}

export async function detectClaude(): Promise<ClaudeStatus> {
  for (const executable of candidateExecutables()) {
    if (path.isAbsolute(executable) && fs.existsSync(executable)) {
      const packageFile = path.join(path.dirname(path.dirname(executable)), "package.json");
      try {
        const manifest = JSON.parse(fs.readFileSync(packageFile, "utf8")) as { version?: string };
        return { available: true, runnable: true, executable, version: `${manifest.version ?? "已安装"} (Claude Code)`, message: "" };
      } catch {
        // Try the next candidate.
      }
    }
    try {
      const result = await collect(spawnCli(executable, ["--version"]));
      if (result.code === 0) return { available: true, runnable: true, executable, version: result.stdout, message: "" };
    } catch {
      // Try the next candidate.
    }
  }
  return { available: false, runnable: false, executable: "", version: "", message: "未检测到 Claude Code CLI" };
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**", "__DOUBLE_STAR__").replaceAll("*", "[^/]*").replaceAll("__DOUBLE_STAR__", ".*");
  return new RegExp(`^${escaped}$`);
}

export function pathIsOwned(file: string, ownedPaths: string[], excludedPaths: string[] = []): boolean {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  const matches = (patterns: string[]) => patterns.some((pattern) => globToRegExp(pattern).test(normalized));
  return matches(ownedPaths) && !matches(excludedPaths);
}
