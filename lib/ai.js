/**
 * 多 AI 供应商的统一封装（纯浏览器 / MV3 Service Worker 可用）。
 *
 * 所有供应商统一走 OpenAI 兼容的 Chat Completions 格式：
 *   POST {baseUrl}/chat/completions
 *
 * 供应商默认端点与模型均以各家官方文档为准，新增预设前先查证，
 * 不要凭经验填 URL 或模型名。
 *
 * 本文件不能使用动态 import()、Node API 或任何 Service Worker
 * 之外的环境能力。
 */

export const AI_PROVIDERS = {
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    docUrl: "https://platform.deepseek.com/",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-terra",
    docUrl: "https://platform.openai.com/",
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    docUrl: "https://platform.moonshot.cn/",
  },
  zhipu: {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.2",
    docUrl: "https://open.bigmodel.cn/",
  },
  qwen: {
    id: "qwen",
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    docUrl: "https://dashscope.console.aliyun.com/",
  },
  custom: {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    baseUrl: "",
    model: "",
    docUrl: "",
  },
};

export const AI_PROVIDER_TIMEOUT_MS = 120_000;

/**
 * 从设置中解析当前供应商的完整配置。
 *
 * 兼容旧版设置：`settings.deepseekApiKey` 会自动并入
 * `providers.deepseek.apiKey`（只读迁移，不写回）。
 *
 * @param {object} settings 完整设置对象
 * @returns {{id: string, name: string, apiKey: string, baseUrl: string, model: string}}
 */
export function normalizeProviderConfig(settings = {}) {
  const id = Object.hasOwn(AI_PROVIDERS, settings.aiProvider)
    ? settings.aiProvider
    : "deepseek";
  const preset = AI_PROVIDERS[id];
  const saved = settings.providers?.[id] || {};

  let apiKey = String(saved.apiKey ?? "").trim();
  if (!apiKey && id === "deepseek" && settings.deepseekApiKey) {
    apiKey = String(settings.deepseekApiKey).trim();
  }

  return {
    id,
    name: preset.name,
    apiKey,
    baseUrl: String(saved.baseUrl || preset.baseUrl || "").trim(),
    model: String(saved.model || preset.model || "").trim(),
  };
}

/**
 * 去掉 Base URL 末尾斜杠后拼接 /chat/completions。
 */
export function completionUrl(baseUrl) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/chat/completions`;
}

/**
 * 构造 Chat Completions 请求体。拆成纯函数便于单测。
 *
 * - 仅 DeepSeek 需要 thinking: { type: "disabled" } 显式关闭思考模式；
 * - json: true 时追加 response_format，让各家返回可解析 JSON。
 */
export function buildCompletionBody(config, messages, { json = false } = {}) {
  const body = {
    model: config.model,
    messages,
    stream: false,
  };
  if (config.id === "deepseek") {
    body.thinking = { type: "disabled" };
  }
  if (json) {
    body.response_format = { type: "json_object" };
  }
  return body;
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
 * 调用所选供应商的 Chat Completions。
 *
 * @param {{id: string, name: string, apiKey: string, baseUrl: string, model: string}} config
 * @param {Array<{role: string, content: string}>} messages
 * @param {{json?: boolean, timeoutMs?: number}} [options]
 * @returns {Promise<string>} 模型回复文本
 */
export async function requestAiCompletion(config, messages, options = {}) {
  const { json = false, timeoutMs = AI_PROVIDER_TIMEOUT_MS } = options;

  if (!config.apiKey) {
    throw new Error(`请先在设置中填写 ${config.name} 的 API Key`);
  }
  if (!config.baseUrl || !config.model) {
    throw new Error(`${config.name} 缺少接口地址或模型名，请到设置页补全`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(completionUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildCompletionBody(config, messages, { json })),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${config.name} 请求失败（${describeHttpError(response.status)}）：${detail.slice(0, 200)}`,
      );
    }

    const data = await response.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (!content) {
      throw new Error(`${config.name} 返回了空内容`);
    }
    return content;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${config.name} 请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
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
