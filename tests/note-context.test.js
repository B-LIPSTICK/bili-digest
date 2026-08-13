import test from "node:test";
import assert from "node:assert/strict";
import {
  findTargetIndex,
  buildNoteContext,
  segmentsToText,
} from "../lib/note-context.js";

const SEGMENTS = [
  { from: 0, to: 4, content: "第一句" },
  { from: 4, to: 9, content: "第二句" },
  { from: 9, to: 15, content: "第三句" },
  { from: 15, to: 20, content: "第四句" },
  { from: 20, to: 26, content: "第五句" },
];

test("findTargetIndex 覆盖当前时刻的句子", () => {
  assert.equal(findTargetIndex(SEGMENTS, 10), 2);
  assert.equal(findTargetIndex(SEGMENTS, 4), 1);
});

test("findTargetIndex 落在句间空隙时取上一句", () => {
  assert.equal(findTargetIndex(SEGMENTS, 9.5), 2);
});

test("buildNoteContext 提取前后各若干句", () => {
  const { before, target, after, fullContext } = buildNoteContext(SEGMENTS, 10);
  assert.equal(target.content, "第三句");
  assert.deepEqual(before.map((s) => s.content), ["第一句", "第二句"]);
  assert.deepEqual(after.map((s) => s.content), ["第四句", "第五句"]);
  assert.equal(fullContext.length, 5);
});

test("buildNoteContext 处理空字幕", () => {
  assert.deepEqual(buildNoteContext([], 3), {
    before: [],
    target: null,
    after: [],
    fullContext: [],
  });
});

test("segmentsToText 拼接内容并过滤空行", () => {
  assert.equal(
    segmentsToText([{ content: " 甲 " }, { content: "" }, { content: "乙" }]),
    "甲\n乙",
  );
});
