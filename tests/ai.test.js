import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_PROVIDERS,
  normalizeProviderConfig,
  completionUrl,
  buildCompletionBody,
  describeHttpError,
  parseLooseJson,
} from "../lib/ai.js";

const MESSAGES = [{ role: "user", content: "你好" }];

test("normalizeProviderConfig 补齐预设默认值", () => {
  const config = normalizeProviderConfig({ aiProvider: "moonshot" });
  assert.equal(config.id, "moonshot");
  assert.equal(config.apiKey, "");
  assert.equal(config.baseUrl, AI_PROVIDERS.moonshot.baseUrl);
  assert.equal(config.model, AI_PROVIDERS.moonshot.model);
});

test("normalizeProviderConfig 迁移旧版 deepseekApiKey", () => {
  const config = normalizeProviderConfig({
    deepseekApiKey: "sk-legacy",
  });
  assert.equal(config.id, "deepseek");
  assert.equal(config.apiKey, "sk-legacy");
  assert.equal(config.baseUrl, AI_PROVIDERS.deepseek.baseUrl);
  assert.equal(config.model, AI_PROVIDERS.deepseek.model);
});

test("normalizeProviderConfig 优先使用用户保存的覆盖值", () => {
  const config = normalizeProviderConfig({
    aiProvider: "deepseek",
    providers: {
      deepseek: {
        apiKey: "sk-new",
        baseUrl: "https://example.com/v1",
        model: "custom-model",
      },
    },
  });
  assert.equal(config.apiKey, "sk-new");
  assert.equal(config.baseUrl, "https://example.com/v1");
  assert.equal(config.model, "custom-model");
});

test("normalizeProviderConfig 自定义端点必须由用户显式提供", () => {
  const config = normalizeProviderConfig({
    aiProvider: "custom",
    providers: {
      custom: {
        apiKey: "ollama",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3",
      },
    },
  });
  assert.equal(config.baseUrl, "http://localhost:11434/v1");
  assert.equal(config.model, "llama3");
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

test("buildCompletionBody 仅 DeepSeek 带 thinking", () => {
  const deepseek = buildCompletionBody(
    { id: "deepseek", model: "deepseek-v4-flash" },
    MESSAGES,
  );
  assert.deepEqual(deepseek.thinking, { type: "disabled" });
  assert.equal(deepseek.response_format, undefined);

  const openai = buildCompletionBody(
    { id: "openai", model: "gpt-5.6-terra" },
    MESSAGES,
  );
  assert.equal(openai.thinking, undefined);
});

test("buildCompletionBody json 模式追加 response_format", () => {
  const body = buildCompletionBody(
    { id: "qwen", model: "qwen-plus" },
    MESSAGES,
    { json: true },
  );
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.thinking, undefined);
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
