/**
 * B站 WBI 签名实现。
 *
 * WBI 是 B站网页端接口的风控签名：把查询参数排序后拼上 mixinKey，
 * 做 MD5 得到 w_rid，再随 wts（Unix 秒）一起附在请求里。
 *
 * 依据：
 * - 算法公开描述见 B站网页端 JS 及社区整理的 bilibili-API-collect 文档
 * - 本实现用文档中的官方样例做了单元测试验证
 */

export const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/**
 * 由 img_key 和 sub_key 计算 mixinKey。
 */
export function getMixinKey(imgKey, subKey) {
  if (!imgKey || !subKey) {
    throw new Error("getMixinKey: imgKey 和 subKey 不能为空");
  }
  const raw = `${imgKey}${subKey}`;
  let result = "";
  for (let i = 0; i < 32; i += 1) {
    result += raw[MIXIN_KEY_ENC_TAB[i]];
  }
  return result;
}

/**
 * 从 nav 接口返回的伪 PNG URL 中取出 key。
 * 例如 https://i0.hdslb.com/bfs/wbi/abc.png -> "abc"
 */
export function extractWbiKey(url) {
  if (!url) return "";
  const fileName = String(url).split("/").pop();
  return fileName.split(".")[0];
}

function filterChars(value) {
  return String(value).replace(/[!'()*]/g, "");
}

async function md5Hex(text) {
  // 浏览器 / 扩展环境：WebCrypto 支持 MD5
  if (globalThis.crypto?.subtle) {
    try {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("MD5", data);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // 部分运行时（如 Node）不提供 MD5，走下方回退
    }
  }

  // Node 测试环境回退：动态加载，浏览器端不会执行到这里
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(text, "utf8").digest("hex");
}

/**
 * 对参数做 WBI 签名。
 * @param {Record<string, string|number>} params 原始查询参数
 * @param {string} mixinKey
 * @param {number} [wts] Unix 秒；测试时可传入固定值
 * @returns {Promise<{w_rid: string, wts: number}>}
 */
export async function encWbi(params, mixinKey, wts = Math.floor(Date.now() / 1000)) {
  const withTimestamp = { ...params, wts: String(wts) };
  const query = Object.keys(withTimestamp)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(filterChars(withTimestamp[key]))}`)
    .join("&");
  const wRid = await md5Hex(`${query}${mixinKey}`);
  return { w_rid: wRid, wts };
}
