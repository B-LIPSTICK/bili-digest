import test from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_PROVIDER_HOSTS,
  parseOrigin,
  isStaticBiliOrigin,
  hostPattern,
  ensureHostPermission,
} from "../lib/host-permissions.js";

test("parseOrigin 解析常见 Base URL", () => {
  assert.equal(parseOrigin("https://api.deepseek.com"), "https://api.deepseek.com");
  assert.equal(parseOrigin("https://api.openai.com/v1/"), "https://api.openai.com");
  assert.equal(parseOrigin("http://localhost:11434/v1"), "http://localhost:11434");
  assert.equal(parseOrigin(" https://api.anthropic.com/v1 "), "https://api.anthropic.com");
  assert.equal(parseOrigin(""), null);
  assert.equal(parseOrigin("随便写的地址"), null);
  assert.equal(parseOrigin("ftp://example.com"), null);
  assert.equal(parseOrigin("https://"), null);
});

test("isStaticBiliOrigin 识别 B站静态权限域", () => {
  assert.equal(isStaticBiliOrigin("https://www.bilibili.com"), true);
  assert.equal(isStaticBiliOrigin("https://api.bilibili.com"), true);
  assert.equal(isStaticBiliOrigin("https://aisubtitle.hdslb.com"), true);
  assert.equal(isStaticBiliOrigin("https://hdslb.com"), true);
  assert.equal(isStaticBiliOrigin("https://api.deepseek.com"), false);
  assert.equal(isStaticBiliOrigin("https://bilibili.com.evil.com"), false);
  assert.equal(isStaticBiliOrigin(null), false);
});

test("hostPattern 生成 match pattern", () => {
  assert.equal(
    hostPattern("https://api.deepseek.com"),
    "https://api.deepseek.com/*",
  );
  assert.equal(
    hostPattern("http://localhost:11434/v1"),
    "http://localhost:11434/*",
  );
  assert.equal(hostPattern(""), null);
});

test("已知供应商域名与 manifest 声明一致（改动需同步）", () => {
  assert.ok(KNOWN_PROVIDER_HOSTS.includes("api.deepseek.com"));
  assert.ok(KNOWN_PROVIDER_HOSTS.includes("api.anthropic.com"));
  assert.ok(KNOWN_PROVIDER_HOSTS.includes("dashscope.aliyuncs.com"));
});

test("ensureHostPermission 在非扩展环境直接放行", async () => {
  // node 测试环境没有 chrome.permissions，应放行而不是抛错
  assert.equal(await ensureHostPermission("https://api.deepseek.com"), true);
  assert.equal(await ensureHostPermission(""), true);
});
