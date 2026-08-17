/**
 * AI 端点 host 权限管理（Chrome 商店审核要求的最小权限改造）。
 *
 * 背景：manifest 的静态 host_permissions 只保留 B站域（字幕功能必需），
 * AI 服务商域名改为 optional_host_permissions + 运行时按需申请。
 * 用户在设置页填写 Base URL 并点「保存 / 测试连接 / 拉取模型」时，
 * 若该域名尚未授权，Chrome 会弹出一次授权确认。
 *
 * 注意：chrome.permissions.request 必须由用户手势触发且只能在扩展页面
 * （设置页 / 侧边栏）调用；Service Worker 里不要调用 ensure 系列函数。
 */

/**
 * 已知 AI 服务商域名。与 manifest.json 的 optional_host_permissions 保持一致，
 * 改这里时必须同步改 manifest。
 */
export const KNOWN_PROVIDER_HOSTS = [
  "api.deepseek.com",
  "api.openai.com",
  "api.anthropic.com",
  "api.moonshot.cn",
  "open.bigmodel.cn",
  "dashscope.aliyuncs.com",
];

/**
 * 解析 Base URL 的 origin（协议 + 主机），失败或非 http(s) 返回 null。
 * 纯函数，可单测。
 *
 * @param {string} baseUrl
 * @returns {string|null} 例如 "https://api.deepseek.com"
 */
export function parseOrigin(baseUrl) {
  try {
    const url = new URL(String(baseUrl || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * 判断 origin 是否属于 B站静态权限域（这些域名在 manifest 的
 * host_permissions 里，无需动态申请）。
 *
 * @param {string|null} origin
 * @returns {boolean}
 */
export function isStaticBiliOrigin(origin) {
  if (!origin) return false;
  let host;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "www.bilibili.com" || host === "api.bilibili.com") return true;
  return host === "hdslb.com" || host.endsWith(".hdslb.com");
}

/**
 * 把 Base URL 转成 chrome.permissions 使用的 host match pattern，
 * 精确到主机的所有路径，例如 "https://api.deepseek.com/*"。
 *
 * @param {string} baseUrl
 * @returns {string|null}
 */
export function hostPattern(baseUrl) {
  const origin = parseOrigin(baseUrl);
  if (!origin) return null;
  return `${origin}/*`;
}

/**
 * 确保当前 Base URL 的 host 权限已授予。
 *
 * - B站静态域：直接放行；
 * - 其他域：查 chrome.permissions，未授予则弹出申请（需用户手势）；
 * - 地址为空 / 格式非法：放行（不拦截，交给后续校验提示）；
 * - 非扩展环境（如单测）：放行。
 *
 * @param {string} baseUrl
 * @returns {Promise<boolean>} 是否已具备访问权限
 */
export async function ensureHostPermission(baseUrl) {
  const pattern = hostPattern(baseUrl);
  if (!pattern) return true;
  const origin = parseOrigin(baseUrl);
  if (isStaticBiliOrigin(origin)) return true;
  if (typeof chrome === "undefined" || !chrome?.permissions) return true;
  const has = await chrome.permissions.contains({ origins: [pattern] });
  if (has) return true;
  try {
    return Boolean(await chrome.permissions.request({ origins: [pattern] }));
  } catch {
    // request 被拒绝或浏览器不支持时统一按未授权处理
    return false;
  }
}
