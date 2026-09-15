/**
 * 把学习资料组装成 Markdown 的纯函数。
 *
 * 不依赖 DOM / Chrome API，便于在 Node 里做单元测试，
 * 侧边栏只负责把返回的字符串写成文件下载。
 */

import { secondsToTimestamp } from "./subtitle.js";
import { normalizeModelMarkdown } from "./markdown.js";

export { normalizeModelMarkdown };

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
  includeOverview = true,
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

  if (overview && includeOverview) {
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
    const partLabel = video.partTitle
      ? ` · ${video.partTitle}`
      : Number(video.page) > 1
        ? ` · P${video.page}`
        : "";
    lines.push(`## 笔记${partLabel}`, "");
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

/**
 * 只导出笔记：支持当前分集、全部分集与全部视频三种视图。
 */
export function buildNotesMarkdown({
  video = {},
  notes = [],
  scope = "current",
  exportedAt = new Date(),
}) {
  const videoTitle = String(video.title || video.bvid || "B站视频");
  let headerTitle = `# 笔记 · ${videoTitle}`;
  if (scope === "all") {
    headerTitle = "# B站笔记 · 全部视频";
  } else if (scope === "series") {
    headerTitle = `# 笔记 · ${videoTitle} · 全部分集`;
  } else if (video.partTitle) {
    headerTitle = `# 笔记 · ${videoTitle} · ${video.partTitle}`;
  } else if (Number(video.page) > 1) {
    headerTitle = `# 笔记 · ${videoTitle} · P${video.page}`;
  }

  const lines = [headerTitle, ""];

  if (scope === "current" && video.bvid) {
    const pageParam = Number(video.page) > 1 ? `?p=${Number(video.page)}` : "";
    lines.push(`视频：https://www.bilibili.com/video/${video.bvid}${pageParam}`, "");
  } else if (scope === "series" && video.bvid) {
    lines.push(`视频：https://www.bilibili.com/video/${video.bvid}`, "");
  }
  lines.push(`导出时间：${exportedAt.toISOString()}`, "");

  if (!notes.length) {
    lines.push("（暂无笔记）");
    return lines.join("\n").trimEnd() + "\n";
  }

  if (scope === "series") {
    const sorted = [...notes].sort(
      (a, b) =>
        (Number(a.page) || 1) - (Number(b.page) || 1) ||
        (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0),
    );
    let lastPage = null;
    for (const note of sorted) {
      const page = Number(note.page) || 1;
      if (page !== lastPage) {
        lastPage = page;
        const partName = note.partTitle ? ` ${note.partTitle}` : "";
        lines.push(`## P${page}${partName}`, "");
      }
      const time = secondsToTimestamp(note.timestamp);
      const link =
        note.url ||
        `https://www.bilibili.com/video/${note.videoId || video.bvid}?p=${page}&t=${Number(note.timestamp) || 0}`;
      lines.push(`- [${time}](${link}) ${note.text}`);
    }
  } else {
    for (const note of notes) {
      const time = secondsToTimestamp(note.timestamp);
      const link =
        note.url ||
        `https://www.bilibili.com/video/${note.videoId}?t=${Number(note.timestamp) || 0}`;
      let titlePrefix = "";
      if (scope === "all") {
        const partTag = note.partTitle
          ? ` (P${note.page || 1} ${note.partTitle})`
          : Number(note.page) > 1
            ? ` (P${note.page})`
            : "";
        titlePrefix = `${note.videoTitle || note.videoId || "未知视频"}${partTag} · `;
      }
      lines.push(`- [${time}](${link}) ${titlePrefix}${note.text}`);
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}
