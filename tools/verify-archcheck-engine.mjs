import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const directory = path.resolve("extension/engines/win32-x64");
const manifestFile = path.join(directory, "engine-manifest.json");
assert.ok(fs.existsSync(manifestFile), "缺少内置 ArchCheck 引擎清单，请先运行 npm run build:archcheck-engine");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.engine, "archcheck");
assert.equal(manifest.platform, "win32");
assert.equal(manifest.arch, "x64");
assert.equal(manifest.runtime, "embedded-python");
const executable = path.join(directory, manifest.executable);
assert.ok(fs.existsSync(executable), "缺少内置 archcheck.exe，请先运行 npm run build:archcheck-engine");
const hash = crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex");
assert.equal(hash, manifest.sha256, "内置 archcheck.exe 与引擎清单的 SHA-256 不一致");
for (const license of ["PYTHON_LICENSE.txt", "PYYAML_LICENSE.txt", "PYINSTALLER_LICENSE.txt"]) {
  assert.ok(fs.existsSync(path.join(directory, "licenses", license)), `缺少第三方许可证：${license}`);
}
console.log(`ArchCheck embedded engine verified: ${manifest.engineVersion} ${manifest.platform}-${manifest.arch} ${hash.slice(0, 12)}`);
