/**
 * AI 接口统一封装（纯浏览器 / MV3 Service Worker 可用）。
 *
 * 不做各家供应商预设，只提供一个「OpenAI 兼容」入口：
 * 用户自己填 Base URL、模型、Key，覆盖 OpenAI、Anthropic
 * （官方兼容端点）、DeepSeek、本地 Ollama 等一切兼容 Chat
 * Completions 的服务。
 *
 * 按 Base URL 自动识别少数需要特殊参数的服务：
 * - DeepSeek：非思考模式需要 thinking: { type: "disabled" }；
 * - Anthropic：官方 OpenAI 兼容端点加 anthropic-version 头，
 *   且其兼容层对 response_format 支持不稳定，JSON 输出靠
 *   prompt 约束 + parseLooseJson 容错。
 */

export const AI_PROVIDER_TIMEOUT_MS = 120_000;

const PROVIDER_LABELS = {
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  openai: "AI 服务",
};

/**
 * 旧版多供应商预设的默认值，只用于迁移，不再出现在设置页。
 */
const LEGACY_PROVIDER_DEFAULTS = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-terra" },
  moonshot: { baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k3" },
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.2" },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
};

/**
 * 根据 Base URL 推断服务类型，用于决定特殊请求参数。
 */
export function detectProviderKind(baseUrl) {
  const url = String(baseUrl || "").toLowerCase();
  if (url.includes("deepseek.com")) return "deepseek";
  if (url.includes("anthropic.com")) return "anthropic";
  return "openai";
}

/**
 * 把旧版 `{aiProvider, providers}` 设置迁移成新的
 * `{aiApiKey, aiBaseUrl, aiModel}` 单入口结构（只读迁移）。
 */
export function migrateLegacySettings(settings = {}) {
  if (settings.aiApiKey || !settings.providers) return settings;

  const ids = Object.keys(settings.providers || {});
  const id = [settings.aiProvider, "deepseek", ...ids].find(
    (candidate) => candidate && settings.providers?.[candidate],
  );
  const saved = settings.providers?.[id] || {};
  const fallback = LEGACY_PROVIDER_DEFAULTS[id] || {};
  const legacyKey =
    id === "deepseek" && settings.deepseekApiKey ? settings.deepseekApiKey : "";

  return {
    ...settings,
    aiApiKey: String(saved.apiKey || legacyKey || "").trim(),
    aiBaseUrl: String(saved.baseUrl || fallback.baseUrl || "").trim(),
    aiModel: String(saved.model || fallback.model || "").trim(),
  };
}

/**
 * 从设置解析当前 AI 接口配置。
 */
export function normalizeProviderConfig(settings = {}) {
  const apiKey = String(settings.aiApiKey ?? "").trim();
  const baseUrl = String(settings.aiBaseUrl ?? "").trim();
  const model = String(settings.aiModel ?? "").trim();
  return { apiKey, baseUrl, model, kind: detectProviderKind(baseUrl) };
}

export function providerLabel(config) {
  return PROVIDER_LABELS[config.kind] || PROVIDER_LABELS.openai;
}

/**
 * 去掉 Base URL 末尾斜杠后拼接 /chat/completions。
 */
export function completionUrl(baseUrl) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/chat/completions`;
}

/**
 * 去掉 Base URL 末尾斜杠后拼接 /models（拉取可用模型列表）。
 */
export function modelsUrl(baseUrl) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/models`;
}

/**
 * 构造 Chat Completions 请求体。拆成纯函数便于单测。
 */
export function buildCompletionBody(
  config,
  messages,
  { json = false, stream = false } = {},
) {
  const body = {
    model: config.model,
    messages,
    stream,
  };
  if (config.kind === "deepseek") {
    body.thinking = { type: "disabled" };
  }
  // Anthropic 兼容层不支持 response_format 时仍能靠 prompt + 容错解析工作
  if (json && config.kind !== "anthropic") {
    body.response_format = { type: "json_object" };
  }
  return body;
}

/**
 * 构造请求头。拆出来给流式和非流式共用。
 */
export function buildAiHeaders(config) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (config.kind === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
  }
  return headers;
}

/**
 * 把 HTTP 状态码映射成给用户看的中文提示。
 */
export function describeHttpError(status) {
  if (status === 401) return "API Key 无效或没有权限";
  if (status === 403) return "无权访问（可能是地区或组织限制）";
  if (status === 429) return "触发限流或余额不足";
  if (status >= 500) return `服务端错误（HTTP ${status}）`;
  return `HTTP ${status}`;
}

/**
 * 调用 OpenAI 兼容的 Chat Completions。
 *
 * @param {{apiKey: string, baseUrl: string, model: string, kind: string}} config
 * @param {Array<{role: string, content: string}>} messages
 * @param {{json?: boolean, timeoutMs?: number}} [options]
 * @returns {Promise<string>} 模型回复文本
 */
export async function requestAiCompletion(config, messages, options = {}) {
  const { json = false, timeoutMs = AI_PROVIDER_TIMEOUT_MS } = options;
  const label = providerLabel(config);

  if (!config.apiKey) {
    throw new Error("请先在设置中填写 API Key");
  }
  if (!config.baseUrl || !config.model) {
    throw new Error("请先在设置中填写接口地址和模型名");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(completionUrl(config.baseUrl), {
      method: "POST",
      headers: buildAiHeaders(config),
      body: JSON.stringify(buildCompletionBody(config, messages, { json })),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${label} 请求失败（${describeHttpError(response.status)}）：${detail.slice(0, 200)}`,
      );
    }

    const data = await response.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (!content) {
      throw new Error(`${label} 返回了空内容`);
    }
    return content;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${label} 请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 /models 响应里提取模型名。
 * 兼容 OpenAI 的 `{data: [{id}]}` 与部分服务的
 * `{models: [{id|name|model}]}` 两种结构，去重并按名称排序。
 *
 * @param {object} payload
 * @returns {string[]}
 */
export function parseModelList(payload) {
  if (!payload || typeof payload !== "object") return [];
  const raw = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];
  const names = raw
    .map((item) => String(item?.id ?? item?.name ?? item?.model ?? "").trim())
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * 拉取 OpenAI 兼容服务的模型列表（GET {baseUrl}/models）。
 * 只需要 Key 和接口地址，不需要先填模型名。
 */
export async function requestModelList(config, { timeoutMs = 30_000 } = {}) {
  const label = providerLabel(config);
  if (!config.apiKey) {
    throw new Error("请先填写 API Key");
  }
  if (!config.baseUrl) {
    throw new Error("请先填写接口地址");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(modelsUrl(config.baseUrl), {
      method: "GET",
      headers: buildAiHeaders(config),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        throw new Error("该接口不支持拉取模型列表，请手动填写模型名");
      }
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${label} 拉取模型失败（${describeHttpError(response.status)}）：${detail.slice(0, 200)}`,
      );
    }
    const data = await response.json().catch(() => null);
    const models = parseModelList(data);
    if (!models.length) {
      throw new Error("接口没有返回模型列表，请手动填写模型名");
    }
    return models;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `${label} 拉取模型超时（${Math.round(timeoutMs / 1000)} 秒）`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 流式调用 Chat Completions（SSE）。
 * 只用于不需要 JSON 输出的场景（如视频问答），每收到一段增量就回调 onDelta。
 */
export async function requestAiCompletionStream(
  config,
  messages,
  { onDelta, timeoutMs = AI_PROVIDER_TIMEOUT_MS } = {},
) {
  const label = providerLabel(config);
  if (!config.apiKey) {
    throw new Error("请先在设置中填写 API Key");
  }
  if (!config.baseUrl || !config.model) {
    throw new Error("请先在设置中填写接口地址和模型名");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(completionUrl(config.baseUrl), {
      method: "POST",
      headers: buildAiHeaders(config),
      body: JSON.stringify(
        buildCompletionBody(config, messages, { stream: true }),
      ),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${label} 请求失败（${describeHttpError(response.status)}）：${detail.slice(0, 200)}`,
      );
    }
    if (!response.body) {
      throw new Error(`${label} 未返回流式响应`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    const flushLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const delta =
          json?.choices?.[0]?.delta?.content ??
          json?.choices?.[0]?.text ??
          "";
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
      } catch {
        // 单个分片解析失败就跳过，不影响后续
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        flushLine(line);
      }
    }
    flushLine(buffer);
    return full;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${label} 请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析模型返回的 JSON，容忍前后多余文本。
 */
export function parseLooseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // 继续往下走，最终抛统一的解析错误
      }
    }
    throw new Error("无法解析 AI 返回的 JSON");
  }
}
