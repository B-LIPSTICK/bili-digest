/**
 * 把学习资料组装成 Markdown 的纯函数。
 *
 * 不依赖 DOM / Chrome API，便于在 Node 里做单元测试，
 * 侧边栏只负责把返回的字符串写成文件下载。
 */

import { secondsToTimestamp } from "./subtitle.js";

/**
 * @param {object} args
 * @param {object} args.video 视频信息（bvid / title / author）
 * @param {object|null} args.overview AI 概览
 * @param {Array<{from: number, content: string}>} args.segments 字幕
 * @param {string[]} args.translations 与字幕一一对应的译文
 * @param {Array<{timestamp: number, text: string}>} args.notes 笔记
 * @param {Date} [args.exportedAt] 导出时间（测试可注入）
 * @returns {string} Markdown 文本
 */
export function buildMarkdown({
  video = {},
  overview = null,
  segments = [],
  translations = [],
  notes = [],
  exportedAt = new Date(),
}) {
  const bvid = String(video.bvid || "");
  const title = String(video.title || bvid || "B站视频");
  const videoUrl = bvid ? `https://www.bilibili.com/video/${bvid}` : "";
  const jumpUrl = (seconds) =>
    videoUrl ? `${videoUrl}?t=${Math.max(0, Number(seconds) || 0)}` : "";

  const lines = [`# ${title}`, ""];
  const meta = [];
  if (video.author) meta.push(`UP：${video.author}`);
  if (bvid) meta.push(`BV：${bvid}`);
  meta.push(`导出时间：${exportedAt.toISOString()}`);
  lines.push(meta.join(" · "));
  if (videoUrl) {
    lines.push("", videoUrl);
  }

  if (overview) {
    lines.push("", "## AI 概览", "");
    if (overview.summary) {
      lines.push(overview.summary, "");
    }
    if (overview.chapters?.length) {
      lines.push("### 章节", "");
      for (const chapter of overview.chapters) {
        const time = secondsToTimestamp(chapter.time);
        const link = jumpUrl(chapter.time);
        lines.push(`- ${link ? `[${time}](${link})` : time} ${chapter.title}`);
      }
      lines.push("");
    }
    if (overview.keyPoints?.length) {
      lines.push("### 要点", "");
      for (const point of overview.keyPoints) {
        lines.push(`- ${point}`);
      }
      lines.push("");
    }
    if (overview.keyQuotes?.length) {
      lines.push("### 金句", "");
      for (const quote of overview.keyQuotes) {
        const time = secondsToTimestamp(quote.time);
        const link = jumpUrl(quote.time);
        lines.push(`- ${link ? `[${time}](${link})` : time} ${quote.text}`);
      }
      lines.push("");
    }
  }

  if (segments.length) {
    const hasTranslation = translations.length === segments.length;
    lines.push("## 字幕", "");
    segments.forEach((segment, index) => {
      const time = secondsToTimestamp(segment.from);
      lines.push(`- [${time}] ${segment.content}`);
      if (hasTranslation && translations[index]) {
        lines.push(`  - ${translations[index]}`);
      }
    });
    lines.push("");
  }

  if (notes.length) {
    lines.push("## 笔记", "");
    for (const note of notes) {
      lines.push(`- [${secondsToTimestamp(note.timestamp)}] ${note.text}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
