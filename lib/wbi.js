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

/**
 * 纯 JS 的 MD5（RFC 1321）。
 *
 * 不用 crypto.subtle 也不用 node:crypto：
 * - Chrome Service Worker 里动态 import 被规范禁止；
 * - 部分运行时的 WebCrypto 不提供 MD5 算法名。
 * 一个纯函数实现可以让浏览器、Service Worker、Node 走完全相同的路径。
 */
function rotateLeft(value, count) {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

export function md5Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true);

  const shifts = [
    [7, 12, 17, 22],
    [5, 9, 14, 20],
    [4, 11, 16, 23],
    [6, 10, 15, 21],
  ];
  const constants = Array.from({ length: 64 }, (_, i) =>
    Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0,
  );

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Array(16);
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let index;
      if (i < 16) {
        f = (b & c) | (~b & d);
        index = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        index = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        index = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        index = (7 * i) % 16;
      }

      const mixed = (f + a + constants[i] + words[index]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(mixed, shifts[Math.floor(i / 16)][i % 4])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const littleEndianHex = (value) => {
    let result = "";
    for (let i = 0; i < 4; i += 1) {
      result += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
    }
    return result;
  };

  return littleEndianHex(a0) + littleEndianHex(b0) + littleEndianHex(c0) + littleEndianHex(d0);
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
  const wRid = md5Hex(`${query}${mixinKey}`);
  return { w_rid: wRid, wts };
}
