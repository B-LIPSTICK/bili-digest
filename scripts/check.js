/**
 * 发布前静态检查：
 * 1. manifest.json 可解析且字段齐全；
 * 2. 关键文件存在；
 * 3. 所有 JS 文件能通过语法检查。
 */

import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "options.html",
  "options.css",
  "options.js",
  "lib/wbi.js",
  "lib/subtitle.js",
  "lib/ai.js",
  "prompts/translation.md",
  "prompts/analysis.md",
  "prompts/explain.md",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "README.md",
  "LICENSE",
];

const JS_FILES = [
  "background.js",
  "content.js",
  "sidepanel.js",
  "options.js",
  "lib/wbi.js",
  "lib/subtitle.js",
  "lib/ai.js",
];

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

const manifestText = await readFile(path.join(root, "manifest.json"), "utf8");
let manifest;
try {
  manifest = JSON.parse(manifestText);
} catch {
  fail("manifest.json 不是合法 JSON");
  process.exit(1);
}

if (!manifest.name || !manifest.version || !manifest.manifest_version) {
  fail("manifest.json 缺少 name / version / manifest_version");
}
if (!Array.isArray(manifest.host_permissions) || manifest.host_permissions.length === 0) {
  fail("manifest.json 缺少 host_permissions");
}

for (const file of REQUIRED_FILES) {
  try {
    await access(path.join(root, file));
  } catch {
    fail(`缺少文件：${file}`);
  }
}

for (const file of JS_FILES) {
  try {
    execFileSync("node", ["--check", path.join(root, file)], { stdio: "pipe" });
  } catch (error) {
    fail(`语法检查失败：${file}\n${error.stderr?.toString() || ""}`);
  }
}

if (!process.exitCode) {
  console.log(`✓ 检查通过：${manifest.name} v${manifest.version}`);
}
