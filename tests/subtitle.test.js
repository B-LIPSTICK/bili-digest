import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSubtitleJson,
  pickChineseTrack,
  secondsToTimestamp,
  normalizeSubtitleUrl,
  parseTimeToSeconds,
  snapToNearestSegment,
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

test("parseTimeToSeconds 支持数字、mm:ss、h:mm:ss 与区间写法", () => {
  assert.equal(parseTimeToSeconds(65), 65);
  assert.equal(parseTimeToSeconds("65"), 65);
  assert.equal(parseTimeToSeconds("01:05"), 65);
  assert.equal(parseTimeToSeconds("1:05:03"), 3903);
  assert.equal(parseTimeToSeconds("[00:04]"), 4);
  assert.equal(parseTimeToSeconds("00:04 - 00:07"), 4);
});

test("parseTimeToSeconds 解析失败返回 null", () => {
  assert.equal(parseTimeToSeconds("第4秒"), null);
  assert.equal(parseTimeToSeconds(""), null);
  assert.equal(parseTimeToSeconds(null), null);
});

test("snapToNearestSegment 吸附到最近字幕句", () => {
  const segments = [{ from: 0 }, { from: 7.26 }, { from: 20 }, { from: 65.4 }];
  assert.equal(snapToNearestSegment(8, segments), 7.26);
  assert.equal(snapToNearestSegment(64, segments), 65.4);
});

test("snapToNearestSegment 偏差过大时保持原值", () => {
  const segments = [{ from: 0 }, { from: 10 }];
  assert.equal(snapToNearestSegment(500, segments), 500);
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
