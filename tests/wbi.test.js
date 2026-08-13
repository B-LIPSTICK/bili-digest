import test from "node:test";
import assert from "node:assert/strict";
import { encWbi, getMixinKey, extractWbiKey } from "../lib/wbi.js";

// 依据 B站 WBI 文档中的官方样例
const IMG_KEY = "7cd084941338484aae1ad9425b84077c";
const SUB_KEY = "4932caff0ff746eab6f01bf08b70ac45";
const SAMPLE_WTS = 1702204169;

test("getMixinKey 与官方样例一致", () => {
  assert.equal(
    getMixinKey(IMG_KEY, SUB_KEY),
    "ea1db124af3c7062474693fa704f4ff8",
  );
});

test("extractWbiKey 从伪 PNG URL 中取 key", () => {
  assert.equal(
    extractWbiKey("https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png"),
    "7cd084941338484aae1ad9425b84077c",
  );
});

test("encWbi 与官方样例一致", async () => {
  const { w_rid, wts } = await encWbi(
    { foo: "114", bar: "514", zab: 1919810 },
    getMixinKey(IMG_KEY, SUB_KEY),
    SAMPLE_WTS,
  );
  assert.equal(wts, SAMPLE_WTS);
  assert.equal(w_rid, "8f6f2b5b3d485fe1886cec6a0be8c5d4");
});

test("encWbi 过滤非法字符并按 URL 规则编码", async () => {
  const { w_rid } = await encWbi(
    { key: "one one four", sym: "a!'()*b" },
    getMixinKey(IMG_KEY, SUB_KEY),
    SAMPLE_WTS,
  );
  assert.equal(typeof w_rid, "string");
  assert.equal(w_rid.length, 32);
});
