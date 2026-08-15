import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarkdown,
  buildChatMarkdown,
  buildOverviewMarkdown,
  buildNotesMarkdown,
  normalizeModelMarkdown,
} from "../lib/export.js";

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

test("buildMarkdown 可导出不含 AI 概览的资料版", () => {
  const markdown = buildMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频" },
    overview: { summary: "一句话概要" },
    includeOverview: false,
    exportedAt: FIXED_DATE,
  });
  assert.doesNotMatch(markdown, /## AI 概览/);
  assert.doesNotMatch(markdown, /一句话概要/);
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

test("buildMarkdown 输出视频简介", () => {
  const markdown = buildMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频" },
    description: "这是视频简介",
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /## 视频简介/);
  assert.match(markdown, /这是视频简介/);
});

test("buildChatMarkdown 输出对话记录", () => {
  const markdown = buildChatMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频", author: "某UP主" },
    messages: [
      { role: "user", content: "讲了什么？" },
      { role: "assistant", content: "讲了三个要点。" },
    ],
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /^# 测试视频 · 对话记录/);
  assert.match(markdown, /## 我/);
  assert.match(markdown, /讲了什么？/);
  assert.match(markdown, /## AI/);
  assert.match(markdown, /讲了三个要点。/);
});

test("buildChatMarkdown 空对话给占位说明", () => {
  const markdown = buildChatMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频" },
    messages: [],
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /暂无对话内容/);
});

test("buildOverviewMarkdown 只输出概览内容", () => {
  const markdown = buildOverviewMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频" },
    overview: {
      summary: "一句话概要",
      chapters: [{ title: "开头", time: 0 }],
      keyPoints: ["要点甲"],
      keyQuotes: [{ text: "原话一句", time: 65 }],
    },
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /^# 测试视频 · AI 概览/);
  assert.match(markdown, /## 概要/);
  assert.match(markdown, /\[00:00\]\([^)]+\?t=0\) 开头/);
  assert.match(markdown, /## 要点/);
  assert.match(markdown, /## 金句/);
  assert.doesNotMatch(markdown, /## 字幕/);
});

test("normalizeModelMarkdown 重排懒编号并折叠多余空行", () => {
  const out = normalizeModelMarkdown(
    "原因如下：\n\n1. 技术门槛\n1. 封装能力\n\n1. 交付能力\n\n\n结论",
  );
  assert.equal(
    out,
    "原因如下：\n\n1. 技术门槛\n2. 封装能力\n\n3. 交付能力\n\n结论",
  );
});

test("normalizeModelMarkdown 标题分隔的列表各自独立编号", () => {
  const out = normalizeModelMarkdown(
    "1. 甲\n1. 乙\n\n## 第二部分\n1. 丙\n1. 丁",
  );
  assert.equal(out, "1. 甲\n2. 乙\n\n## 第二部分\n1. 丙\n2. 丁");
});

test("normalizeModelMarkdown 列表项后的正文不打断编号", () => {
  const out = normalizeModelMarkdown(
    "1. **甲**\n\n正文说明\n\n1. **乙**\n\n正文说明2",
  );
  assert.equal(out, "1. **甲**\n\n正文说明\n\n2. **乙**\n\n正文说明2");
});

test("buildChatMarkdown 对 AI 回答应用规范化", () => {
  const markdown = buildChatMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频" },
    messages: [
      {
        role: "assistant",
        content: "原因如下：\n\n\n1. 技术门槛\n1. 封装能力",
      },
    ],
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /原因如下：\n\n1\. 技术门槛\n2\. 封装能力/);
  assert.doesNotMatch(markdown, /\n\n\n\n/);
});

test("buildNotesMarkdown 本视频视图输出链接与时间戳", () => {
  const markdown = buildNotesMarkdown({
    video: { bvid: "BV1xx411c7mD", title: "测试视频" },
    notes: [{ videoId: "BV1xx411c7mD", timestamp: 125, text: "这里的推导很关键" }],
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /^# 笔记 · 测试视频/);
  assert.match(markdown, /https:\/\/www\.bilibili\.com\/video\/BV1xx411c7mD/);
  assert.match(markdown, /\[02:05\]\([^)]+\?t=125\) 这里的推导很关键/);
  assert.doesNotMatch(markdown, /未知视频/);
});

test("buildNotesMarkdown 全部视频视图带上视频标题前缀", () => {
  const markdown = buildNotesMarkdown({
    video: {},
    notes: [
      {
        videoId: "BV1aa",
        videoTitle: "第一个视频",
        timestamp: 10,
        text: "笔记甲",
      },
    ],
    scope: "all",
    exportedAt: FIXED_DATE,
  });
  assert.match(markdown, /^# B站笔记 · 全部视频/);
  assert.match(markdown, /第一个视频 · 笔记甲/);
});

test("buildNotesMarkdown 空笔记给占位说明", () => {
  const markdown = buildNotesMarkdown({ video: {}, notes: [], exportedAt: FIXED_DATE });
  assert.match(markdown, /暂无笔记/);
});
