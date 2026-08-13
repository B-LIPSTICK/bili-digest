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

export function normalizeSubtitleUrl(url) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}
