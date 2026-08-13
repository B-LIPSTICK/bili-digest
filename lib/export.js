/**
 * 把学习资料组装成 Markdown 的纯函数。
 *
 * 不依赖 DOM / Chrome API，便于在 Node 里做单元测试，
 * 侧边栏只负责把返回的字符串写成文件下载。
 */

import { secondsToTimestamp } from "./subtitle.js";

/**
 * 规范化模型输出的 Markdown 文本：
 * - 统一换行、去掉行尾空格，把连续多个空行折叠成一个空行；
 * - 模型常用「每行都写 1.」的懒编号，重排成 1、2、3…递增序号。
 *
 * 空白行不会打断编号（保持列表视觉上的连续性），
 * 遇到非空、非列表行才会重置编号。
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeModelMarkdown(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));

  let counter = 0;
  const renumbered = lines.map((line) => {
    const match = /^(\s*)\d+([.)])(\s+)(.+)$/.exec(line);
    if (match) {
      counter += 1;
      return `${match[1]}${counter}${match[2]}${match[3]}${match[4]}`;
    }
    if (line.trim() !== "") counter = 0;
    return line;
  });

  return renumbered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * @param {object} args
 * @param {object} args.video 视频信息（bvid / title / author）
 * @param {string} [args.description] 视频简介
 * @param {object|null} args.overview AI 概览
 * @param {Array<{from: number, content: string}>} args.segments 字幕
 * @param {string[]} args.translations 与字幕一一对应的译文
 * @param {Array<{timestamp: number, text: string}>} args.notes 笔记
 * @param {Date} [args.exportedAt] 导出时间（测试可注入）
 * @returns {string} Markdown 文本
 */
export function buildMarkdown({
  video = {},
  description = "",
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

  if (description) {
    lines.push("", "## 视频简介", "", description, "");
  }

  if (overview) {
    lines.push("", "## AI 概览", "");
    if (overview.summary) {
      lines.push(normalizeModelMarkdown(overview.summary), "");
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
        lines.push(`- ${normalizeModelMarkdown(point)}`);
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

/**
 * 把某个视频的问答对话组装成 Markdown。
 *
 * @param {object} args
 * @param {object} args.video 视频信息（bvid / title / author）
 * @param {Array<{role: string, content: string}>} args.messages 对话消息
 * @param {Date} [args.exportedAt]
 * @returns {string} Markdown 文本
 */
export function buildChatMarkdown({
  video = {},
  messages = [],
  exportedAt = new Date(),
}) {
  const bvid = String(video.bvid || "");
  const title = String(video.title || bvid || "B站视频");
  const videoUrl = bvid ? `https://www.bilibili.com/video/${bvid}` : "";

  const lines = [`# ${title} · 对话记录`, ""];
  const meta = [];
  if (video.author) meta.push(`UP：${video.author}`);
  if (bvid) meta.push(`BV：${bvid}`);
  meta.push(`导出时间：${exportedAt.toISOString()}`);
  lines.push(meta.join(" · "));
  if (videoUrl) {
    lines.push("", videoUrl);
  }

  if (!messages.length) {
    lines.push("", "（暂无对话内容）");
  } else {
    lines.push("");
    for (const message of messages) {
      const speaker = message.role === "user" ? "我" : "AI";
      lines.push(
        `## ${speaker}`,
        "",
        normalizeModelMarkdown(message.content),
        "",
      );
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

/**
 * 只导出 AI 概览（概要、章节、要点、金句）。
 */
export function buildOverviewMarkdown({
  video = {},
  overview = {},
  exportedAt = new Date(),
}) {
  const bvid = String(video.bvid || "");
  const title = String(video.title || bvid || "B站视频");
  const videoUrl = bvid ? `https://www.bilibili.com/video/${bvid}` : "";
  const jumpUrl = (seconds) =>
    videoUrl ? `${videoUrl}?t=${Math.max(0, Number(seconds) || 0)}` : "";

  const lines = [`# ${title} · AI 概览`, ""];
  const meta = [];
  if (video.author) meta.push(`UP：${video.author}`);
  if (bvid) meta.push(`BV：${bvid}`);
  meta.push(`导出时间：${exportedAt.toISOString()}`);
  lines.push(meta.join(" · "));
  if (videoUrl) {
    lines.push("", videoUrl);
  }

  if (overview.summary) {
    lines.push("", "## 概要", "", normalizeModelMarkdown(overview.summary));
  }
  if (overview.chapters?.length) {
    lines.push("", "## 章节", "");
    for (const chapter of overview.chapters) {
      const time = secondsToTimestamp(chapter.time);
      const link = jumpUrl(chapter.time);
      lines.push(`- ${link ? `[${time}](${link})` : time} ${chapter.title}`);
    }
  }
  if (overview.keyPoints?.length) {
    lines.push("", "## 要点", "");
    for (const point of overview.keyPoints) {
      lines.push(`- ${normalizeModelMarkdown(point)}`);
    }
  }
  if (overview.keyQuotes?.length) {
    lines.push("", "## 金句", "");
    for (const quote of overview.keyQuotes) {
      const time = secondsToTimestamp(quote.time);
      const link = jumpUrl(quote.time);
      lines.push(`- ${link ? `[${time}](${link})` : time} ${quote.text}`);
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}
