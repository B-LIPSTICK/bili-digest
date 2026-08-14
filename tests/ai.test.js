import test from "node:test";
import assert from "node:assert/strict";
import {
  detectProviderKind,
  migrateLegacySettings,
  normalizeProviderConfig,
  completionUrl,
  modelsUrl,
  parseModelList,
  buildCompletionBody,
  describeHttpError,
  parseLooseJson,
} from "../lib/ai.js";

const MESSAGES = [{ role: "user", content: "你好" }];

test("detectProviderKind 按 Base URL 识别服务", () => {
  assert.equal(detectProviderKind("https://api.deepseek.com"), "deepseek");
  assert.equal(detectProviderKind("https://api.anthropic.com/v1/"), "anthropic");
  assert.equal(detectProviderKind("https://api.openai.com/v1"), "openai");
  assert.equal(detectProviderKind("http://localhost:11434/v1"), "openai");
});

test("migrateLegacySettings 迁移旧版供应商配置", () => {
  const migrated = migrateLegacySettings({
    aiProvider: "moonshot",
    providers: {
      moonshot: { apiKey: "sk-kimi", baseUrl: "", model: "" },
    },
  });
  assert.equal(migrated.aiApiKey, "sk-kimi");
  assert.equal(migrated.aiBaseUrl, "https://api.moonshot.cn/v1");
  assert.equal(migrated.aiModel, "kimi-k3");
});

test("migrateLegacySettings 迁移旧版 deepseekApiKey", () => {
  const migrated = migrateLegacySettings({
    deepseekApiKey: "sk-old",
    providers: { deepseek: { apiKey: "", baseUrl: "", model: "" } },
  });
  assert.equal(migrated.aiApiKey, "sk-old");
  assert.equal(migrated.aiBaseUrl, "https://api.deepseek.com");
  assert.equal(migrated.aiModel, "deepseek-v4-flash");
});

test("migrateLegacySettings 已是新 schema 时保持不变", () => {
  const settings = { aiApiKey: "sk-new", aiBaseUrl: "https://x", aiModel: "m" };
  assert.equal(migrateLegacySettings(settings), settings);
});

test("normalizeProviderConfig 解析新 schema 并推断类型", () => {
  const config = normalizeProviderConfig({
    aiApiKey: "sk-a",
    aiBaseUrl: "https://api.anthropic.com/v1",
    aiModel: "claude-sonnet-4-5",
  });
  assert.equal(config.apiKey, "sk-a");
  assert.equal(config.model, "claude-sonnet-4-5");
  assert.equal(config.kind, "anthropic");
});

test("completionUrl 去掉末尾斜杠再拼接", () => {
  assert.equal(
    completionUrl("https://api.deepseek.com"),
    "https://api.deepseek.com/chat/completions",
  );
  assert.equal(
    completionUrl("https://api.openai.com/v1/"),
    "https://api.openai.com/v1/chat/completions",
  );
});

test("modelsUrl 去掉末尾斜杠再拼接", () => {
  assert.equal(modelsUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1/models");
  assert.equal(modelsUrl("https://api.deepseek.com"), "https://api.deepseek.com/models");
});

test("parseModelList 兼容 data 与 models 结构并去重排序", () => {
  assert.deepEqual(
    parseModelList({
      data: [{ id: "gpt-5" }, { id: "gpt-4o" }, { id: "gpt-4o" }],
    }),
    ["gpt-4o", "gpt-5"],
  );
  assert.deepEqual(
    parseModelList({ models: [{ name: "llama3:latest" }, { id: "qwen-plus" }] }),
    ["llama3:latest", "qwen-plus"],
  );
  assert.deepEqual(parseModelList(null), []);
  assert.deepEqual(parseModelList({ data: [{ other: "x" }] }), []);
});

test("buildCompletionBody 仅 DeepSeek 带 thinking", () => {
  const deepseek = buildCompletionBody(
    { kind: "deepseek", model: "deepseek-v4-flash" },
    MESSAGES,
  );
  assert.deepEqual(deepseek.thinking, { type: "disabled" });
  assert.equal(deepseek.response_format, undefined);

  const anthropic = buildCompletionBody(
    { kind: "anthropic", model: "claude-sonnet-4-5" },
    MESSAGES,
  );
  assert.equal(anthropic.thinking, undefined);
});

test("buildCompletionBody json 模式：OpenAI 兼容加 response_format，Anthropic 不加", () => {
  const openai = buildCompletionBody(
    { kind: "openai", model: "gpt-5.6-terra" },
    MESSAGES,
    { json: true },
  );
  assert.deepEqual(openai.response_format, { type: "json_object" });

  const anthropic = buildCompletionBody(
    { kind: "anthropic", model: "claude-sonnet-4-5" },
    MESSAGES,
    { json: true },
  );
  assert.equal(anthropic.response_format, undefined);
});

test("describeHttpError 覆盖常见状态码", () => {
  assert.match(describeHttpError(401), /无效/);
  assert.match(describeHttpError(403), /无权/);
  assert.match(describeHttpError(429), /限流/);
  assert.equal(describeHttpError(400), "HTTP 400");
});

test("parseLooseJson 容忍前后多余文本", () => {
  assert.deepEqual(parseLooseJson('说明文字 {"a": 1} 尾巴'), { a: 1 });
  assert.throws(() => parseLooseJson("没有 JSON"), /无法解析/);
});
