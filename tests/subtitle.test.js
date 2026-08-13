import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSubtitleJson,
  pickChineseTrack,
  secondsToTimestamp,
  normalizeSubtitleUrl,
} from "../lib/subtitle.js";

test("parseSubtitleJson 解析 body 并过滤无效条目", () => {
  const segments = parseSubtitleJson({
    font_size: 0.4,
    body: [
      { from: 7.26, to: 8.79, location: 2, content: "第一句" },
      { from: 9.0, to: 9.1, content: "  " },
      { from: 10, to: 11, content: "第二句" },
      { from: "bad", to: 12, content: "无效" },
    ],
  });
  assert.deepEqual(segments, [
    { from: 7.26, to: 8.79, content: "第一句" },
    { from: 10, to: 11, content: "第二句" },
  ]);
});

test("pickChineseTrack 优先中文简体", () => {
  const tracks = [
    { lan: "en-US", subtitle_url: "https://example.com/en.json" },
    { lan: "zh-CN", subtitle_url: "https://example.com/zh.json" },
    { lan: "ai-zh", subtitle_url: "https://example.com/ai-zh.json" },
  ];
  assert.equal(pickChineseTrack(tracks).lan, "zh-CN");
  assert.equal(pickChineseTrack([tracks[0]]).lan, "en-US");
  assert.equal(pickChineseTrack([]), null);
});

test("secondsToTimestamp 输出 mm:ss 或 h:mm:ss", () => {
  assert.equal(secondsToTimestamp(65), "01:05");
  assert.equal(secondsToTimestamp(3661), "1:01:01");
  assert.equal(secondsToTimestamp(-3), "00:00");
});

test("normalizeSubtitleUrl 补全协议", () => {
  assert.equal(
    normalizeSubtitleUrl("//aisubtitle.hdslb.com/x.json"),
    "https://aisubtitle.hdslb.com/x.json",
  );
  assert.equal(
    normalizeSubtitleUrl("https://aisubtitle.hdslb.com/x.json"),
    "https://aisubtitle.hdslb.com/x.json",
  );
  assert.equal(normalizeSubtitleUrl(""), "");
});
