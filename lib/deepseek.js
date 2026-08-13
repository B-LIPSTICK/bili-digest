/**
 * DeepSeek API 的最小封装。
 *
 * 固定配置（以 DeepSeek 官方文档为准）：
 * - Base URL: https://api.deepseek.com
 * - Model: deepseek-v4-flash（非思考模式）
 * - 非思考模式通过 thinking: { type: "disabled" } 显式指定
 */

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-v4-flash";

export const AI_PROVIDER_TIMEOUT_MS = 120_000;

/**
 * 调用 DeepSeek chat completions。
 * @param {string} apiKey
 * @param {Array<{role: string, content: string}>} messages
 * @param {{json?: boolean, timeoutMs?: number}} [options]
 * @returns {Promise<string>} 模型回复文本
 */
export async function requestDeepSeek(apiKey, messages, options = {}) {
  if (!apiKey) {
    throw new Error("请先在设置中填写 DeepSeek API Key");
  }

  const { json = false, timeoutMs = AI_PROVIDER_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model: DEEPSEEK_MODEL,
      messages,
      stream: false,
      thinking: { type: "disabled" },
    };
    if (json) {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const hint =
        response.status === 401
          ? "Key 无效或没有权限"
          : response.status === 429
            ? "触发限流或余额不足"
            : `HTTP ${response.status}`;
      throw new Error(`DeepSeek 请求失败（${hint}）：${detail.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (!content) {
      throw new Error("DeepSeek 返回了空内容");
    }
    return content;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`DeepSeek 请求超时（${timeoutMs / 1000} 秒）`);
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
