/**
 * B站字幕 JSON 的解析与工具函数。
 *
 * 字幕文件结构（B站 aisubtitle 服务的 JSON）：
 * {
 *   "font_size": 0.4,
 *   "body": [
 *     { "from": 7.26, "to": 8.79, "location": 2, "content": "字幕文本" },
 *     ...
 *   ]
 * }
 * from/to 单位是秒。
 */

export function parseSubtitleJson(json) {
  if (!json || !Array.isArray(json.body)) return [];
  return json.body
    .filter(
      (item) =>
        typeof item.from === "number" &&
        typeof item.to === "number" &&
        item.to > item.from,
    )
    .map((item) => ({
      from: item.from,
      to: item.to,
      content: String(item.content ?? "").trim(),
    }))
    .filter((segment) => segment.content.length > 0);
}

/**
 * 从字幕轨道列表里挑中文轨道。B站会同时给出多种语言的轨道，
 * 这里优先取中文（简体优先），没有中文时退回第一条。
 */
export function pickChineseTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const priority = ["zh-CN", "zh-Hans", "ai-zh", "zh-Hant", "zh"];
  for (const lang of priority) {
    const hit = tracks.find(
      (track) => String(track.lan ?? "").toLowerCase() === lang.toLowerCase(),
    );
    if (hit) return hit;
  }
  return tracks[0];
}

export function secondsToTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0
    ? `${hours}:${mm}:${ss}`
    : `${mm}:${ss}`;
}

/**
 * 把模型返回的各种时间写法解析成秒：
 * 支持数字（65）、"mm:ss"（01:05）、"h:mm:ss"（1:05:03）、
 * 带方括号（[00:04]）、区间只取开头（00:04 - 00:07）。
 * 解析失败返回 null，调用方自行决定丢弃。
 *
 * @param {number|string} value
 * @returns {number|null}
 */
export function parseTimeToSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value !== "string") return null;

  const text = value.trim().replace(/[[\]]/g, "");
  if (/^\d{1,6}$/.test(text)) {
    return Math.max(0, Math.floor(Number(text)));
  }

  const clock = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})/.exec(text);
  if (clock) {
    const hours = clock[1] ? Number(clock[1]) : 0;
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3]);
    if (minutes > 59 || seconds > 59) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
}

/**
 * 把时间吸附到最近的一条字幕起始时间，修正模型给出的近似值，
 * 保证点击跳转正好落在一句话的开头。
 *
 * @param {number} seconds 待校正的秒数
 * @param {Array<{from: number}>} segments 字幕片段
 * @param {number} [maxDrift=60] 与最近字幕句的最大允许偏差（秒），超出则保持原值
 * @returns {number}
 */
export function snapToNearestSegment(seconds, segments, maxDrift = 60) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return seconds;
  if (!Array.isArray(segments) || segments.length === 0) return seconds;

  let nearest = segments[0].from;
  let bestDistance = Math.abs(seconds - nearest);
  for (const segment of segments) {
    const distance = Math.abs(seconds - segment.from);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = segment.from;
    }
  }
  return bestDistance <= maxDrift ? nearest : seconds;
}

export function normalizeSubtitleUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}
