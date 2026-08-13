import test from "node:test";
import assert from "node:assert/strict";
import { buildMarkdown } from "../lib/export.js";

const FIXED_DATE = new Date("2026-08-13T08:00:00.000Z");

test("buildMarkdown 包含视频信息、链接与导出时间", () => {
  const markdown = buildMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频", author: "某UP主" },
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /^# 测试视频/);
  assert.match(markdown, /UP：某UP主/);
  assert.match(markdown, /BV：BV1xx411c7mD/);
  assert.match(markdown, /https:\/\/www\.bilibili\.com\/video\/BV1xx411c7mD/);
  assert.match(markdown, /2026-08-13T08:00:00\.000Z/);
});

test("buildMarkdown 输出概览的章节、要点与金句", () => {
  const markdown = buildMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频" },
    overview: {
      summary: "一句话概要",
      chapters: [{ title: "开头", time: 0 }],
      keyPoints: ["要点甲"],
      keyQuotes: [{ text: "原话一句", time: 65 }],
    },
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /## AI 概览/);
  assert.match(markdown, /一句话概要/);
  assert.match(markdown, /\[00:00\]\([^)]+\?t=0\) 开头/);
  assert.match(markdown, /- 要点甲/);
  assert.match(markdown, /\[01:05\]\([^)]+\?t=65\) 原话一句/);
});

test("buildMarkdown 译文数量对齐时输出双语字幕", () => {
  const markdown = buildMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频" },
    segments: [
      { from: 7.26, content: "第一句" },
      { from: 9, content: "第二句" },
    ],
    translations: ["First", "Second"],
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /- \[00:07\] 第一句\n  - First/);
  assert.match(markdown, /- \[00:09\] 第二句\n  - Second/);
});

test("buildMarkdown 译文不完整时不输出译文行", () => {
  const markdown = buildMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频" },
    segments: [{ from: 7.26, content: "第一句" }],
    translations: [],
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /- \[00:07\] 第一句/);
  assert.doesNotMatch(markdown, /First/);
});

test("buildMarkdown 输出带时间戳的笔记", () => {
  const markdown = buildMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频" },
    notes: [{ timestamp: 125, text: "这里的推导很关键" }],
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /## 笔记/);
  assert.match(markdown, /- \[02:05\] 这里的推导很关键/);
});
