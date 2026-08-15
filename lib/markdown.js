/**
 * 给聊天消息用的极简 Markdown 渲染器。
 *
 * 只支持常用子集：标题、无序/有序列表、加粗、行内代码、链接、
 * 段落。所有文本先做 HTML 转义，链接只放行 http/https，不解析
 * 原始 HTML，避免模型输出注入脚本。
 */

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * 规范化模型输出的 Markdown：
 * 折叠连续空行、去掉行尾空格，并把「每行都写 1.」的懒编号
 * 重排成 1、2、3…（空行不打断编号，遇到正文才重置）。
 */
export function normalizeModelMarkdown(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));

  let counter = 0;
  const renumbered = lines.map((line) => {
    const match = /^(\s*)(\d+)([.)、．])\s*(.+)$/.exec(line);
    if (match) {
      counter += 1;
      return `${match[1]}${counter}${match[3]} ${match[4]}`;
    }
    const trimmed = line.trim();
    if (
      trimmed !== "" &&
      (/^#{1,6}\s/.test(trimmed) || /^(-{3,}|\*{3,})$/.test(trimmed))
    ) {
      // 只有标题或分隔线才会开启新的编号序列；
      // 正文和无序子项都属于上一条列表项的展开内容，不能重置编号
      counter = 0;
    }
    return line;
  });

  return renumbered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * @param {string} text
 * @returns {string} 已转义、只含白名单标签的 HTML
 */
export function renderMarkdown(text) {
  const lines = normalizeModelMarkdown(text).split("\n");
  const html = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const rawLine of lines) {
    const line = escapeHtml(rawLine);
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      html.push("");
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      closeList();
      const level = Math.min(3, heading[1].length);
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^[-*]\s+(.*)$/.exec(trimmed);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = /^(\d+)([.)、．])\s*(.*)$/.exec(trimmed);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      // 显式写 value，避免空行把列表拆散后每条都重新从 1 开始
      html.push(`<li value="${ordered[1]}">${renderInline(ordered[3])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInline(trimmed)}</p>`);
  }
  closeList();
  return html.join("\n");
}
