import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../lib/markdown.js";

test("renderMarkdown 渲染标题、列表与段落", () => {
  const html = renderMarkdown(
    "### 标题\n\n- 第一点\n- 第二点\n\n1. 第一步\n2. 第二步\n\n正文段落。",
  );
  assert.match(html, /<h3>标题<\/h3>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>第一点<\/li>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li value="1">第一步<\/li>/);
  assert.match(html, /<p>正文段落。<\/p>/);
});

test("renderMarkdown 懒编号重排并显式写序号", () => {
  const html = renderMarkdown("1. 甲\n\n1. 乙\n\n1. 丙");
  assert.match(html, /<li value="1">甲<\/li>/);
  assert.match(html, /<li value="2">乙<\/li>/);
  assert.match(html, /<li value="3">丙<\/li>/);
});

test("renderMarkdown 列表项之间的正文不打断编号", () => {
  const html = renderMarkdown("1. **甲**\n\n正文说明\n\n1. **乙**\n\n正文说明2");
  assert.match(html, /<li value="1">/);
  assert.match(html, /<li value="2">/);
});

test("renderMarkdown 兼容顿号和全角句点序号", () => {
  const html = renderMarkdown("1、甲\n1、乙\n1．丙");
  assert.match(html, /<li value="1">甲<\/li>/);
  assert.match(html, /<li value="2">乙<\/li>/);
  assert.match(html, /<li value="3">丙<\/li>/);
});

test("renderMarkdown 渲染加粗、行内代码与链接", () => {
  const html = renderMarkdown(
    "这是**重点**和 `code`，参考 [链接](https://example.com/a)。",
  );
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(
    html,
    /<a href="https:\/\/example\.com\/a" target="_blank" rel="noopener noreferrer">链接<\/a>/,
  );
});

test("renderMarkdown 转义原始 HTML，不放行危险链接", () => {
  const html = renderMarkdown(
    '<script>alert(1)</script> [点我](javascript:alert(1))',
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /\[点我\]\(javascript:alert\(1\)\)/);
});
