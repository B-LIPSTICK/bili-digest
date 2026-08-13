/**
 * Bili Digest 侧边栏脚本。
 *
 * 负责：视频检测、字幕渲染（原文/译文/双语）、时间戳跳转、
 * AI 概览、笔记管理、设置。
 *
 * 所有数据请求都通过后台服务（background.js）统一处理。
 */

import {
  buildMarkdown,
  buildChatMarkdown,
  buildOverviewMarkdown,
} from "./lib/export.js";
import { normalizeProviderConfig, requestAiCompletionStream } from "./lib/ai.js";
import { renderMarkdown } from "./lib/markdown.js";

const EMPTY_GLYPHS = {
  video: '<svg class="empty-glyph" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3.5l4 3 4-3"/></svg>',
  mute: '<svg class="empty-glyph" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><line x1="16" y1="9" x2="20" y2="15"/><line x1="20" y1="9" x2="16" y2="15"/></svg>',
  lock: '<svg class="empty-glyph" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  overview: '<svg class="empty-glyph" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><line x1="10" y1="12" x2="17" y2="12"/><line x1="10" y1="15" x2="14" y2="15"/></svg>',
  notes: '<svg class="empty-glyph" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z"/><line x1="14.5" y1="6.5" x2="17.5" y2="9.5"/></svg>',
};

const state = {
  video: null,
  segments: [],
  mode: "original",
  hideOriginal: false,
  translations: [],
  translating: false,
  overview: null,
  settings: {
    aiApiKey: "",
    aiBaseUrl: "",
    aiModel: "",
    targetLanguage: "English",
    customLanguage: "",
  },
  settingsLoaded: false,
  notes: [],
  notesScope: "current",
  noteSeconds: 0,
  chatMessages: [],
  chatLoaded: false,
  chatSending: false,
  editingIndex: -1,
  currentTab: "transcript",
};

// ============================================================
// DOM 引用
// ============================================================

const $ = (id) => document.getElementById(id);

const videoTitleEl = $("videoTitle");
const videoMetaEl = $("videoMeta");
const segmentsEl = $("segments");
const transcriptStatusEl = $("transcriptStatus");
const translationTrackEl = $("translationTrack");
const translationFillEl = $("translationFill");
const hideOriginalBtn = $("hideOriginalBtn");
const translateBtn = $("translateBtn");
const copyTranscriptBtn = $("copyTranscriptBtn");
const exportBtn = $("exportBtn");
const refreshBtn = $("refreshBtn");
const generateOverviewBtn = $("generateOverviewBtn");
const regenerateOverviewBtn = $("regenerateOverviewBtn");
const exportOverviewBtn = $("exportOverviewBtn");
const overviewStatusEl = $("overviewStatus");
const overviewContentEl = $("overviewContent");
const noteComposerEl = $("noteComposer");
const noteTextEl = $("noteText");
const noteTimeChipEl = $("noteTimeChip");
const polishNoteBtn = $("polishNoteBtn");
const saveNoteBtn = $("saveNoteBtn");
const notesStatusEl = $("notesStatus");
const notesListEl = $("notesList");
const apiKeyInput = $("apiKeyInput");
const toggleKeyBtn = $("toggleKeyBtn");
const testKeyBtn = $("testKeyBtn");
const keyTestResultEl = $("keyTestResult");
const baseUrlInput = $("baseUrlInput");
const modelInput = $("modelInput");
const targetLanguageSelect = $("targetLanguageSelect");
const customLanguageInput = $("customLanguageInput");
const saveSettingsBtn = $("saveSettingsBtn");
const toastEl = $("toast");
const explainSheetEl = $("explainSheet");
const explainOriginalEl = $("explainOriginal");
const explainResultEl = $("explainResult");
const closeExplainBtn = $("closeExplainBtn");
const themeToggleBtn = $("themeToggleBtn");
const regenerateChatBtn = $("regenerateChatBtn");
const exportChatBtn = $("exportChatBtn");
const clearChatBtn = $("clearChatBtn");
const chatStatusEl = $("chatStatus");
const chatMessagesEl = $("chatMessages");
const chatInput = $("chatInput");
const sendChatBtn = $("sendChatBtn");

// ============================================================
// 工具函数
// ============================================================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function secondsToTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

async function send(action, payload = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...payload });
  if (!response || response.success === false) {
    throw new Error(response?.error || "请求失败");
  }
  return response;
}

async function getVideoTab() {
  const tabs = await chrome.tabs.query({});
  const isVideoPage = (url) =>
    /^https:\/\/(www\.)?bilibili\.com\/video\//i.test(url || "");
  const active = tabs.find((tab) => tab.active);
  if (active && isVideoPage(active.url)) return active;
  return tabs.find((tab) => isVideoPage(tab.url)) || null;
}

async function sendToTab(action, payload = {}) {
  const tab = await getVideoTab();
  if (!tab?.id) throw new Error("未找到 B站视频标签页");
  const response = await chrome.tabs.sendMessage(tab.id, { action, ...payload });
  if (!response) throw new Error("视频页没有响应，请刷新视频页后重试");
  if (response.success === false) {
    throw new Error(response.error || "视频页操作失败");
  }
  return response;
}

let toastTimer = null;
function showToast(text, kind = "info") {
  toastEl.textContent = text;
  toastEl.className = `toast show${kind === "error" ? " error" : ""}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "toast";
  }, 2600);
}

function setProgress(percent) {
  translationFillEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function effectiveTargetLanguage() {
  if (state.settings.targetLanguage === "custom") {
    return state.settings.customLanguage || "English";
  }
  return state.settings.targetLanguage;
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggleBtn.textContent = isDark ? "☀" : "☾";
}

async function loadTheme() {
  try {
    const { theme } = await chrome.storage.local.get("theme");
    applyTheme(theme === "dark" ? "dark" : "light");
  } catch {
    applyTheme("light");
  }
}

function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  chrome.storage.local.set({ theme: next }).catch(() => {});
}

function renderEmpty(targetEl, glyph, lines, { glyphHtml = false } = {}) {
  targetEl.replaceChildren();
  const box = document.createElement("div");
  box.className = "empty-state";
  const glyphMarkup = glyphHtml
    ? glyph
    : `<span class="glyph">${escapeHtml(glyph)}</span>`;
  box.innerHTML = `${glyphMarkup}${lines
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("")}`;
  targetEl.appendChild(box);
}

// ============================================================
// 视频检测
// ============================================================

function updateHeader() {
  if (!state.video?.bvid) {
    videoTitleEl.textContent = "尚未检测到视频";
    videoMetaEl.replaceChildren();
    return;
  }
  videoTitleEl.textContent = state.video.title || state.video.bvid;

  videoMetaEl.replaceChildren();
  if (state.video.author) {
    const author = document.createElement("button");
    author.className = "video-meta-author";
    author.type = "button";
    author.textContent = state.video.author;
    if (state.video.authorMid) {
      author.title = "打开作者主页";
      author.addEventListener("click", () => {
        const url = `https://space.bilibili.com/${state.video.authorMid}`;
        chrome.tabs
          .create({ url })
          .catch(() => {
            window.open(url, "_blank", "noopener");
          });
      });
    } else {
      author.title = "未取到作者主页链接";
    }
    videoMetaEl.appendChild(author);
  }

  if (state.video.bvid) {
    if (videoMetaEl.childElementCount > 0) {
      const separator = document.createElement("span");
      separator.className = "video-meta-sep";
      separator.textContent = "·";
      videoMetaEl.appendChild(separator);
    }
    const bv = document.createElement("button");
    bv.className = "video-meta-bv";
    bv.type = "button";
    bv.textContent = state.video.bvid;
    bv.title = "点击复制 BV 号";
    bv.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.video.bvid);
        showToast("已复制 BV 号");
      } catch {
        showToast("复制失败，请手动复制", "error");
      }
    });
    videoMetaEl.appendChild(bv);
  }
}

async function detectVideo() {
  try {
    const context = await sendToTab("getVideoContext");
    if (!context.bvid) {
      state.video = null;
      updateHeader();
      renderEmpty(
        segmentsEl,
        EMPTY_GLYPHS.video,
        ["请打开一个 B站视频页面", "字幕和笔记会出现在这里"],
        { glyphHtml: true },
      );
      return;
    }

    const changed =
      !state.video ||
      state.video.bvid !== context.bvid ||
      state.video.cid !== context.cid;

    if (changed) {
      state.video = context;
      state.segments = [];
      state.translations = [];
      state.overview = null;
      state.notes = [];
      state.chatMessages = [];
      state.chatLoaded = false;
      updateHeader();
      ensureAuthorMid();
      await loadTranscript();
    } else {
      state.video = context;
      updateHeader();
      ensureAuthorMid();
    }
  } catch {
    // 暂时连不上视频页（例如在非 B站页签），静默等待下一轮轮询
  }
}

/**
 * 内容脚本拿不到 UP 的 mid 时，用后台的视频信息接口补一次。
 * 成功后重新渲染头部，让作者名变成可点击。
 */
async function ensureAuthorMid() {
  const bvid = state.video?.bvid;
  if (!bvid || state.video.authorMid) return;
  try {
    const info = await send("getVideoInfo", { bvid });
    const mid = Number(info.info?.authorMid) || 0;
    if (mid && state.video?.bvid === bvid) {
      state.video.authorMid = mid;
      updateHeader();
    }
  } catch {
    // 拿不到就保持纯文本，不影响其它功能
  }
}

// ============================================================
// 字幕
// ============================================================

async function loadTranscript() {
  const { bvid, cid } = state.video;
  if (!bvid) {
    renderEmpty(
      segmentsEl,
      EMPTY_GLYPHS.video,
      ["请打开一个 B站视频页面", "字幕和笔记会出现在这里"],
      { glyphHtml: true },
    );
    return;
  }

  transcriptStatusEl.textContent = "正在读取字幕…";
  transcriptStatusEl.className = "status-line";

  try {
    const result = await send("fetchTranscript", {
      bvid,
      // cid 允许为 0：页面数据未就绪时由后台通过签名接口解析
      cid: cid || 0,
      aid: state.video.aid,
    });
    state.segments = result.segments || [];
    state.translations = [];

    if (state.segments.length === 0) {
      renderEmpty(
        segmentsEl,
        EMPTY_GLYPHS.mute,
        [
          result.tracks?.length
            ? "字幕文件为空"
            : "没有找到字幕轨道",
          "请确认：已在 bilibili.com 登录，且这个视频本身有字幕",
        ],
        { glyphHtml: true },
      );
      transcriptStatusEl.textContent = "";
      return;
    }

    transcriptStatusEl.textContent = `已加载 ${state.segments.length} 条字幕`;
    renderSegments();
    updateTranslateButton();
  } catch (error) {
    transcriptStatusEl.textContent = "";
    const message = error.message || "未知错误";
    const needsLogin = message.includes("-101") || message.includes("未登录");
    renderEmpty(
      segmentsEl,
      EMPTY_GLYPHS.lock,
      [
        `读取字幕失败：${message}`,
        needsLogin ? "请先在 bilibili.com 登录，然后刷新视频页" : "请刷新视频页后重试",
      ],
      { glyphHtml: true },
    );
  }
}

function renderSegments() {
  segmentsEl.replaceChildren();
  const fragment = document.createDocumentFragment();
  const isBilingual = state.mode === "bilingual";
  const showOriginal =
    state.mode === "original" || (isBilingual && !state.hideOriginal);

  state.segments.forEach((segment, index) => {
    const row = document.createElement("div");
    row.className = "segment";
    if (isBilingual && !state.translations[index]) {
      row.classList.add("tr-empty");
    }

    const original = showOriginal
      ? `<span class="segment-zh">${escapeHtml(segment.content)}</span>`
      : "";
    const translation = isBilingual
      ? `<div class="segment-tr${state.hideOriginal ? " tr-inline" : ""}">${escapeHtml(state.translations[index] || "…")}</div>`
      : "";

    row.innerHTML = `
      <span class="segment-time">${secondsToTimestamp(segment.from)}</span>
      <button class="segment-explain" data-index="${index}" title="让 AI 解释这一句">解释</button>
      ${original}
      ${translation}
    `;
    row.addEventListener("click", () => seekTo(segment.from));
    row
      .querySelector(".segment-explain")
      .addEventListener("click", (event) => {
        event.stopPropagation();
        openExplain(Number(event.currentTarget.dataset.index));
      });
    fragment.appendChild(row);
  });

  segmentsEl.appendChild(fragment);
}

async function openExplain(index) {
  const segment = state.segments[index];
  if (!segment) return;
  const before = state.segments
    .slice(Math.max(0, index - 2), index)
    .map((item) => item.content)
    .join("\n");
  const after = state.segments
    .slice(index + 1, index + 3)
    .map((item) => item.content)
    .join("\n");
  const context = [before, after].filter(Boolean).join("\n");

  explainOriginalEl.textContent = segment.content;
  explainResultEl.textContent = "正在思考…";
  explainSheetEl.classList.remove("hidden");

  try {
    const result = await send("explainSelection", {
      text: segment.content,
      context,
    });
    explainResultEl.textContent = result.text;
  } catch (error) {
    explainResultEl.textContent = `解释失败：${error.message}`;
  }
}

async function startTranslation() {
  if (state.translating || state.segments.length === 0) return;
  const target = effectiveTargetLanguage();

  state.translating = true;
  updateTranslateButton();
  translationTrackEl.classList.remove("hidden");
  setProgress(0);
  transcriptStatusEl.className = "status-line";
  transcriptStatusEl.textContent = `正在翻译为 ${target}…（已翻译内容会缓存复用）`;

  try {
    const result = await send("translate", {
      bvid: state.video.bvid,
      cid: state.video.cid,
      segments: state.segments,
      targetLanguage: target,
    });
    state.translations = result.texts || [];
    transcriptStatusEl.textContent = "";
    renderSegments();
  } catch (error) {
    transcriptStatusEl.className = "status-line error";
    transcriptStatusEl.textContent = `翻译失败：${error.message}`;
    setProgress(0);
  } finally {
    state.translating = false;
    translationTrackEl.classList.add("hidden");
    updateTranslateButton();
  }
}

function updateTranslateButton() {
  const hasSegments = state.segments.length > 0;
  const complete =
    hasSegments && state.translations.length === state.segments.length;
  if (state.translating) {
    translateBtn.disabled = true;
    translateBtn.textContent = "翻译中…";
    return;
  }
  translateBtn.disabled = !hasSegments || complete;
  translateBtn.textContent = complete ? "已翻译" : "翻译";
}

function switchMode(mode) {
  state.mode = mode;
  if (mode === "original") {
    state.hideOriginal = false;
  }
  document.querySelectorAll(".mode").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  updateHideOriginalButton();
  renderSegments();

  if (
    mode !== "original" &&
    state.segments.length > 0 &&
    state.translations.length !== state.segments.length &&
    !state.translating
  ) {
    transcriptStatusEl.className = "status-line";
    transcriptStatusEl.textContent =
      "尚未翻译，点右上角「翻译」按钮开始（结果会缓存）";
  } else if (
    mode === "original" &&
    (transcriptStatusEl.textContent || "").includes("尚未翻译")
  ) {
    transcriptStatusEl.textContent = "";
  }
}

function updateHideOriginalButton() {
  const bilingual = state.mode === "bilingual";
  hideOriginalBtn.classList.toggle("hidden", !bilingual);
  hideOriginalBtn.textContent = state.hideOriginal ? "显示原文" : "隐藏原文";
}

async function seekTo(seconds) {
  try {
    await sendToTab("seekTo", { seconds });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function exportMarkdown() {
  if (!state.video?.bvid) {
    showToast("先打开一个 B站视频", "error");
    return;
  }
  try {
    // 导出时重新取一次笔记，避免侧边栏里还没打开过笔记页导致漏导
    let notes = state.notes;
    try {
      const result = await send("getNotes", { videoId: state.video.bvid });
      notes = result.notes || [];
    } catch {
      // 拿不到就用内存里的，仍可导出其余内容
    }

    let description = "";
    try {
      const info = await send("getVideoInfo", { bvid: state.video.bvid });
      description = info.info?.desc || "";
    } catch {
      // 简介拿不到不影响导出其余内容
    }

    const markdown = buildMarkdown({
      video: state.video,
      description,
      overview: state.overview,
      segments: state.segments,
      translations: state.translations,
      notes,
    });
    const rawName = (state.video.title || state.video.bvid || "bili-digest")
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 60);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${rawName}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已导出 Markdown");
  } catch (error) {
    showToast(`导出失败：${error.message}`, "error");
  }
}

async function copyTranscript() {
  if (!state.segments.length) {
    showToast("没有字幕可复制", "error");
    return;
  }
  const lines = state.segments.map((segment, index) => {
    const time = secondsToTimestamp(segment.from);
    if (state.mode === "bilingual") {
      if (state.hideOriginal) {
        return `[${time}] ${state.translations[index] || "…"}`;
      }
      const translation = state.translations[index];
      return translation
        ? `[${time}] ${segment.content}\n${" ".repeat(time.length + 3)}${translation}`
        : `[${time}] ${segment.content}`;
    }
    return `[${time}] ${segment.content}`;
  });
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    copyTranscriptBtn.textContent = "✓";
    setTimeout(() => {
      copyTranscriptBtn.textContent = "⧉";
    }, 1200);
    showToast("已复制字幕");
  } catch {
    showToast("复制失败，请手动选择复制", "error");
  }
}

// ============================================================
// 概览
// ============================================================

async function loadOverview({ force = false } = {}) {
  if (!state.video?.bvid || !state.segments.length) {
    renderEmpty(
      overviewContentEl,
      EMPTY_GLYPHS.overview,
      ["该视频没有字幕，无法生成概览"],
      { glyphHtml: true },
    );
    return;
  }

  generateOverviewBtn.disabled = true;
  regenerateOverviewBtn.classList.add("spinning");
  overviewStatusEl.className = "status-line";
  overviewStatusEl.textContent = force
    ? "正在重新生成概览…"
    : "正在生成 AI 概览…";

  try {
    const result = await send("generateOverview", {
      bvid: state.video.bvid,
      cid: state.video.cid,
      segments: state.segments,
      force,
    });
    state.overview = result;
    overviewStatusEl.textContent = result.cached ? "已加载缓存的概览" : "";
    renderOverview();
  } catch (error) {
    overviewStatusEl.className = "status-line error";
    overviewStatusEl.textContent = `生成失败：${error.message}`;
  } finally {
    generateOverviewBtn.disabled = false;
    regenerateOverviewBtn.classList.remove("spinning");
  }
}

/**
 * 打开概览页时只读本地缓存：有就直接展示，没有则提示用户手动生成，
 * 绝不在这里自动调用 AI（生成需要用户明确点按钮确认）。
 */
async function loadCachedOverview() {
  if (!state.video?.bvid) {
    renderEmpty(
      overviewContentEl,
      EMPTY_GLYPHS.overview,
      ["先打开一个 B站视频"],
      { glyphHtml: true },
    );
    return;
  }
  try {
    const key = `digest:${state.video.bvid}:${state.video.cid}`;
    const result = await chrome.storage.local.get(key);
    const cached = result[key];
    if (cached?.summary || cached?.chapters?.length) {
      state.overview = { ...cached, cached: true };
      overviewStatusEl.textContent = "已加载缓存的概览";
      renderOverview();
      return;
    }
  } catch {
    // 读缓存失败就当没有缓存，走下面的引导提示
  }
  state.overview = null;
  overviewStatusEl.textContent = "";
  renderEmpty(
    overviewContentEl,
    EMPTY_GLYPHS.overview,
    [
      "这个视频还没有概览",
      "点上方「生成 AI 概览」开始，会调用 AI 并缓存结果",
    ],
    { glyphHtml: true },
  );
}

function renderOverview() {
  overviewContentEl.replaceChildren();
  if (!state.overview) return;

  const fragment = document.createDocumentFragment();

  if (state.overview.summary) {
    const summary = document.createElement("div");
    summary.className = "summary-card";
      summary.innerHTML = `
      <p class="card-label">内容概要</p>
      <p class="summary-text">${escapeHtml(state.overview.summary)}</p>
    `;
    fragment.appendChild(summary);
  }

  if (state.overview.chapters?.length) {
    const section = document.createElement("div");
    const label = document.createElement("p");
    label.className = "card-label";
    label.textContent = "章节";
    section.appendChild(label);
    for (const chapter of state.overview.chapters) {
      const card = document.createElement("div");
      card.className = "chapter-card";
      card.innerHTML = `
        <div class="chapter-title">${escapeHtml(chapter.title)}</div>
        <span class="chapter-time">${secondsToTimestamp(chapter.time)}</span>
      `;
      card.addEventListener("click", () => seekTo(chapter.time));
      section.appendChild(card);
    }
    fragment.appendChild(section);
  }

  if (state.overview.keyPoints?.length) {
    const section = document.createElement("div");
    const label = document.createElement("p");
    label.className = "card-label";
    label.textContent = "要点";
    section.appendChild(label);
    const list = document.createElement("ul");
    list.className = "keypoints";
    for (const point of state.overview.keyPoints) {
      const item = document.createElement("li");
      item.textContent = point;
      list.appendChild(item);
    }
    section.appendChild(list);
    fragment.appendChild(section);
  }

  if (state.overview.keyQuotes?.length) {
    const section = document.createElement("div");
    const label = document.createElement("p");
    label.className = "card-label";
    label.textContent = "金句";
    section.appendChild(label);
    for (const quote of state.overview.keyQuotes) {
      const card = document.createElement("div");
      card.className = "quote-item";
      card.innerHTML = `
        <p class="quote-text">${escapeHtml(quote.text)}</p>
        <div class="quote-meta">
          <button class="quote-time" data-seconds="${Number(quote.time) || 0}">${secondsToTimestamp(quote.time)}</button>
          <span class="quote-actions">
            <button class="quote-copy-btn" type="button">复制</button>
            <button class="quote-save-btn" type="button">存为笔记</button>
          </span>
        </div>
      `;
      card.querySelector(".quote-time").addEventListener("click", () =>
        seekTo(quote.time),
      );
      card.querySelector(".quote-copy-btn").addEventListener("click", async (event) => {
        try {
          await navigator.clipboard.writeText(quote.text);
          event.currentTarget.textContent = "已复制";
          setTimeout(() => {
            event.currentTarget.textContent = "复制";
          }, 1200);
        } catch {
          showToast("复制失败，请手动选择文本", "error");
        }
      });
      card.querySelector(".quote-save-btn").addEventListener("click", () =>
        saveQuoteAsNote(quote),
      );
      section.appendChild(card);
    }
    fragment.appendChild(section);
  }

  overviewContentEl.appendChild(fragment);
}

async function exportOverview() {
  if (!state.video?.bvid) {
    showToast("先打开一个 B站视频", "error");
    return;
  }
  if (!state.overview) {
    showToast("还没有概览，先生成一次", "error");
    return;
  }
  try {
    const markdown = buildOverviewMarkdown({
      video: state.video,
      overview: state.overview,
    });
    const rawName = (state.video.title || state.video.bvid || "bili-digest")
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 50);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${rawName}-概览.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已导出概览");
  } catch (error) {
    showToast(`导出失败：${error.message}`, "error");
  }
}

async function saveQuoteAsNote(quote) {
  if (!state.video?.bvid) {
    showToast("没有检测到视频", "error");
    return;
  }
  try {
    await send("saveNote", {
      videoId: state.video.bvid,
      timestamp: Number(quote.time) || 0,
      videoTitle: state.video.title,
      author: state.video.author,
      text: quote.text,
    });
    showToast("金句已存为笔记");
  } catch (error) {
    showToast(error.message, "error");
  }
}

// ============================================================
// 笔记
// ============================================================

async function refreshNotes() {
  try {
    if (state.notesScope === "all") {
      const result = await send("getAllNotes");
      state.notes = result.notes || [];
    } else {
      if (!state.video?.bvid) {
        renderEmpty(
          notesListEl,
          EMPTY_GLYPHS.notes,
          ["先打开一个 B站视频"],
          { glyphHtml: true },
        );
        return;
      }
      const result = await send("getNotes", { videoId: state.video.bvid });
      state.notes = result.notes || [];
    }
    renderNotes();
  } catch (error) {
    notesStatusEl.className = "status-line error";
    notesStatusEl.textContent = error.message;
  }
}

function renderNotes() {
  notesListEl.replaceChildren();
  if (state.notes.length === 0) {
    renderEmpty(
      notesListEl,
      EMPTY_GLYPHS.notes,
      state.notesScope === "all"
        ? ["还没有任何视频的笔记", "看视频时点「标记」或按 N，把当前句原文存为标记"]
        : ["还没有笔记", "看视频时点「标记」或按 N，把当前句原文存为标记"],
      { glyphHtml: true },
    );
    return;
  }

  const list =
    state.notesScope === "all"
      ? state.notes
      : [...state.notes].sort((a, b) => a.timestamp - b.timestamp);
  const fragment = document.createDocumentFragment();
  for (const note of list) {
    const card = document.createElement("div");
    card.className = "note-card";
    card.innerHTML = `
      <div class="note-head">
        <button class="note-time" data-seconds="${Number(note.timestamp) || 0}">${secondsToTimestamp(note.timestamp)}</button>
        ${state.notesScope === "all" ? `<button class="note-video-title" type="button">${escapeHtml(note.videoTitle || note.videoId || "")}</button>` : ""}
        <button class="note-delete" title="删除笔记">✕</button>
      </div>
      <p class="note-text">${escapeHtml(note.text)}</p>
      <div class="note-actions">
        <button class="note-copy-text" type="button">复制文本</button>
        <button class="note-copy-link" type="button">复制时间戳</button>
        <button class="note-play" type="button">播放</button>
      </div>
    `;
    card.querySelector(".note-time").addEventListener("click", () => playNote(note));
    card
      .querySelector(".note-video-title")
      ?.addEventListener("click", () => playNote(note));
    card.querySelector(".note-delete").addEventListener("click", async () => {
      try {
        await send("deleteNote", { videoId: note.videoId, noteId: note.id });
        await refreshNotes();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
    card
      .querySelector(".note-copy-text")
      .addEventListener("click", () =>
        copyWithFeedback(card.querySelector(".note-copy-text"), note.text),
      );
    card
      .querySelector(".note-copy-link")
      .addEventListener("click", () =>
        copyWithFeedback(
          card.querySelector(".note-copy-link"),
          note.url ||
            `https://www.bilibili.com/video/${note.videoId}?t=${Number(note.timestamp) || 0}`,
        ),
      );
    card.querySelector(".note-play").addEventListener("click", () => playNote(note));
    fragment.appendChild(card);
  }
  notesListEl.appendChild(fragment);
}

async function playNote(note) {
  const seconds = Number(note.timestamp) || 0;
  if (state.video?.bvid === note.videoId) {
    seekTo(seconds);
    return;
  }
  try {
    await chrome.tabs.create({
      url: note.url || `https://www.bilibili.com/video/${note.videoId}?t=${seconds}`,
    });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function copyWithFeedback(button, text) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "已复制";
    setTimeout(() => {
      if (button.isConnected) button.textContent = original;
    }, 1200);
  } catch {
    showToast("复制失败，请手动复制", "error");
  }
}

function switchNotesScope(scope) {
  state.notesScope = scope === "all" ? "all" : "current";
  document.querySelectorAll(".notes-scope .mode").forEach((button) => {
    button.classList.toggle("active", button.dataset.scope === state.notesScope);
  });
  noteComposerEl.classList.toggle("hidden", state.notesScope !== "current");
  refreshNotes();
}

async function captureCurrentSeconds() {
  try {
    const result = await sendToTab("getCurrentTime");
    state.noteSeconds = result.currentTime || 0;
  } catch {
    state.noteSeconds = 0;
  }
  noteTimeChipEl.textContent = secondsToTimestamp(state.noteSeconds);
}

async function saveCurrentNote() {
  const text = noteTextEl.value.trim();
  if (!text) {
    showToast("先写点内容再保存", "error");
    return;
  }
  if (!state.video?.bvid) {
    showToast("没有检测到视频", "error");
    return;
  }

  saveNoteBtn.disabled = true;
  try {
    await send("saveNote", {
      videoId: state.video.bvid,
      timestamp: state.noteSeconds,
      videoTitle: state.video.title,
      author: state.video.author,
      text,
    });
    noteTextEl.value = "";
    showToast("笔记已保存");
    await refreshNotes();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    saveNoteBtn.disabled = false;
  }
}

async function polishCurrentNote() {
  const draft = noteTextEl.value.trim();
  if (!draft) {
    showToast("先写点内容再润色", "error");
    return;
  }
  polishNoteBtn.disabled = true;
  polishNoteBtn.textContent = "润色中…";
  try {
    const result = await send("polishNote", { text: draft });
    noteTextEl.value = String(result.text || "");
    showToast("已润色，可以再改改");
  } catch (error) {
    showToast(`润色失败：${error.message}`, "error");
  } finally {
    polishNoteBtn.disabled = false;
    polishNoteBtn.textContent = "AI 润色";
  }
}

// ============================================================
// 对话
// ============================================================

function chatKey(videoId, cid) {
  return `chat:${videoId}:${cid}`;
}

function saveChat() {
  if (!state.video?.bvid) return;
  chrome.storage.local
    .set({ [chatKey(state.video.bvid, state.video.cid)]: state.chatMessages })
    .catch(() => {});
}

function deleteChatMessage(index) {
  if (state.chatSending) return;
  const message = state.chatMessages[index];
  if (!message) return;
  state.chatMessages.splice(index, 1);
  // 删除用户的问题时，把紧跟着的 AI 回复一并删掉，保持一问一答成对
  if (
    message.role === "user" &&
    state.chatMessages[index]?.role === "assistant"
  ) {
    state.chatMessages.splice(index, 1);
  }
  saveChat();
  renderChat();
}

async function loadChat() {
  if (!state.video?.bvid) {
    state.chatMessages = [];
    renderChat();
    state.chatLoaded = true;
    return;
  }
  const key = chatKey(state.video.bvid, state.video.cid);
  try {
    const result = await chrome.storage.local.get(key);
    const saved = result[key];
    state.chatMessages = Array.isArray(saved) ? saved : [];
  } catch {
    state.chatMessages = [];
  }
  renderChat();
  state.chatLoaded = true;
}

function formatClock(ts) {
  if (!ts) return "";
  const date = new Date(Number(ts));
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function renderChat() {
  chatMessagesEl.replaceChildren();
  if (!state.chatMessages.length) {
    renderEmpty(
      chatMessagesEl,
      '<svg class="empty-glyph" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.4-.66L3 21l1.66-5.09A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/><circle cx="8.5" cy="11.5" r="0.85" fill="currentColor" stroke="none"/><circle cx="12.5" cy="11.5" r="0.85" fill="currentColor" stroke="none"/><circle cx="16.5" cy="11.5" r="0.85" fill="currentColor" stroke="none"/></svg>',
      ["就当前视频的字幕问我问题", "回答只依据字幕内容，不会编造"],
      { glyphHtml: true },
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  state.chatMessages.forEach((message, index) => {
    const isUser = message.role === "user";
    const isEditing = isUser && index === state.editingIndex;
    const wrapper = document.createElement("div");
    wrapper.className = `chat-msg ${isUser ? "user" : "ai"}`;

    if (isEditing) {
      wrapper.innerHTML = `
        <div class="chat-edit-box">
          <textarea rows="3" spellcheck="false">${escapeHtml(message.content)}</textarea>
          <div class="chat-edit-actions">
            <button class="ghost-btn" data-edit="cancel" type="button">取消</button>
            <button class="primary-btn" data-edit="save" type="button">保存并重新回答</button>
          </div>
        </div>
      `;
      wrapper
        .querySelector('[data-edit="cancel"]')
        .addEventListener("click", cancelEditMessage);
      wrapper
        .querySelector('[data-edit="save"]')
        .addEventListener("click", saveEditMessage);
      fragment.appendChild(wrapper);
      return;
    }

    const isPending =
      !isUser &&
      index === state.chatMessages.length - 1 &&
      state.chatSending &&
      !message.content;
    const contentHtml = isUser
      ? escapeHtml(message.content)
      : renderMarkdown(message.content);
    wrapper.innerHTML = `
      <div class="chat-msg-head">
        <span>${isUser ? "你" : "AI"}</span>
        <span class="chat-msg-actions">
          <span class="chat-msg-time">${formatClock(message.ts)}</span>
          <button class="chat-msg-action" data-action="copy" type="button">复制</button>
          ${isUser ? '<button class="chat-msg-action" data-action="edit" type="button">编辑</button>' : ""}
          <button class="chat-msg-action" data-action="delete" type="button">删除</button>
        </span>
      </div>
      <div class="chat-msg-text">${isPending ? "" : contentHtml}</div>
    `;
    if (isPending) {
      wrapper.classList.add("typing");
      wrapper.querySelector(".chat-msg-text").textContent = "正在思考…";
    }
    wrapper
      .querySelector('[data-action="copy"]')
      .addEventListener("click", () => copyChatMessage(index));
    wrapper
      .querySelector('[data-action="delete"]')
      .addEventListener("click", () => deleteChatMessage(index));
    const editButton = wrapper.querySelector('[data-action="edit"]');
    if (editButton) {
      editButton.addEventListener("click", () => startEditMessage(index));
    }
    fragment.appendChild(wrapper);
  });
  chatMessagesEl.appendChild(fragment);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

async function copyChatMessage(index) {
  const message = state.chatMessages[index];
  if (!message?.content) return;
  try {
    await navigator.clipboard.writeText(message.content);
    showToast("已复制");
  } catch {
    showToast("复制失败，请手动复制", "error");
  }
}

function startEditMessage(index) {
  if (state.chatSending) return;
  const message = state.chatMessages[index];
  if (!message || message.role !== "user") return;
  state.editingIndex = index;
  renderChat();
  const textarea = chatMessagesEl.querySelector(".chat-edit-box textarea");
  if (textarea) {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
}

function cancelEditMessage() {
  state.editingIndex = -1;
  renderChat();
}

async function saveEditMessage() {
  const textarea = chatMessagesEl.querySelector(".chat-edit-box textarea");
  const text = textarea?.value.trim();
  if (!text) return;
  const index = state.editingIndex;
  state.chatMessages[index].content = text;
  // 问题改了，旧回答作废：删掉其后的所有内容并重新生成
  state.chatMessages.splice(index + 1);
  state.chatMessages.push({ role: "assistant", content: "" });
  state.editingIndex = -1;
  state.chatSending = true;
  sendChatBtn.disabled = true;
  renderChat();
  await runChatRequest();
}

function appendChatDelta(delta) {
  let last = state.chatMessages[state.chatMessages.length - 1];
  if (!last || last.role === "user") {
    last = { role: "assistant", content: "" };
    state.chatMessages.push(last);
  }
  last.content += delta;

  const nodes = chatMessagesEl.querySelectorAll(".chat-msg");
  const textEl = nodes[nodes.length - 1]?.querySelector(".chat-msg-text");
  if (textEl) {
    textEl.textContent = last.content;
  }
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function chatTranscriptText() {
  let text = state.segments
    .map((segment) => `[${secondsToTimestamp(segment.from)}] ${segment.content}`)
    .join("\n");
  const LIMIT = 24000;
  if (text.length > LIMIT) {
    text = `${text.slice(0, LIMIT)}\n\n（字幕过长，仅载入前 ${LIMIT} 字，回答可能不涉及后半段内容）`;
  }
  return text;
}

async function renderChatSystem(transcript) {
  const url = chrome.runtime.getURL("prompts/chat.md");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("读取对话提示词失败");
  }
  const template = await response.text();
  return template.replaceAll("{{transcript}}", transcript);
}

function setChatError(message) {
  let last = state.chatMessages[state.chatMessages.length - 1];
  if (!last || last.role === "user") {
    last = { role: "assistant", content: "" };
    state.chatMessages.push(last);
  }
  last.content = last.content
    ? `${last.content}\n\n（回答中断：${message}）`
    : `回答失败：${message}`;
}

async function requestChatReply() {
  if (!state.settingsLoaded) {
    await loadSettings();
  }
  const config = normalizeProviderConfig(state.settings);
  if (!config.apiKey) {
    throw new Error("请先在「设置」里填写 API Key");
  }
  if (!config.baseUrl || !config.model) {
    throw new Error("请先在「设置」里填写接口地址和模型名");
  }

  const system = await renderChatSystem(chatTranscriptText());
  // 去掉末尾的空 assistant 占位，只把已有内容的对话历史发出去
  const history = state.chatMessages.filter((message) => message.content);
  await requestAiCompletionStream(
    config,
    [{ role: "system", content: system }, ...history],
    {
      onDelta: (delta) => appendChatDelta(delta),
    },
  );
}

async function runChatRequest() {
  try {
    await requestChatReply();
  } catch (error) {
    setChatError(error?.message || "未知错误");
  } finally {
    const last = state.chatMessages[state.chatMessages.length - 1];
    if (last && last.role === "assistant" && !last.ts) {
      last.ts = Date.now();
    }
    state.chatSending = false;
    sendChatBtn.disabled = false;
    saveChat();
    renderChat();
  }
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || state.chatSending) return;
  if (!state.video?.bvid) {
    showToast("先打开一个 B站视频", "error");
    return;
  }
  if (!state.segments.length) {
    showToast("没有字幕无法对话，请先加载字幕", "error");
    return;
  }

  state.chatSending = true;
  sendChatBtn.disabled = true;
  state.chatMessages.push({ role: "user", content: text, ts: Date.now() });
  state.chatMessages.push({ role: "assistant", content: "" });
  renderChat();
  chatInput.value = "";
  await runChatRequest();
}

async function regenerateChat() {
  if (state.chatSending) return;
  if (!state.video?.bvid) {
    showToast("先打开一个 B站视频", "error");
    return;
  }
  if (!state.segments.length) {
    showToast("没有字幕无法对话，请先加载字幕", "error");
    return;
  }

  let lastUserIndex = -1;
  for (let i = state.chatMessages.length - 1; i >= 0; i -= 1) {
    if (state.chatMessages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex === -1) {
    showToast("没有可重新回答的问题", "error");
    return;
  }

  // 回退：删掉上一条问题的回答（含失败占位），重新生成
  state.chatMessages.splice(lastUserIndex + 1);
  state.chatMessages.push({ role: "assistant", content: "" });
  state.chatSending = true;
  sendChatBtn.disabled = true;
  renderChat();
  await runChatRequest();
}

async function clearChat() {
  if (!state.video?.bvid) return;
  let confirmed = true;
  try {
    confirmed = window.confirm("重置当前视频的对话？");
  } catch {
    // 个别环境禁用 confirm，直接执行清空
  }
  if (!confirmed) return;
  state.chatMessages = [];
  await chrome.storage.local
    .remove(chatKey(state.video.bvid, state.video.cid))
    .catch(() => {});
  renderChat();
  showToast("对话已清空");
}

async function exportChat() {
  if (!state.video?.bvid) {
    showToast("先打开一个 B站视频", "error");
    return;
  }
  if (!state.chatMessages.length) {
    showToast("还没有对话可导出", "error");
    return;
  }
  try {
    const markdown = buildChatMarkdown({
      video: state.video,
      messages: state.chatMessages,
    });
    const rawName = (state.video.title || state.video.bvid || "bili-digest")
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 50);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${rawName}-对话.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已导出对话");
  } catch (error) {
    showToast(`导出失败：${error.message}`, "error");
  }
}

// ============================================================
// 设置
// ============================================================

async function loadSettings() {
  try {
    const result = await send("getSettings");
    state.settings = result.settings;
    apiKeyInput.value = state.settings.aiApiKey || "";
    baseUrlInput.value = state.settings.aiBaseUrl || "";
    modelInput.value = state.settings.aiModel || "";
    targetLanguageSelect.value = state.settings.targetLanguage || "English";
    customLanguageInput.value = state.settings.customLanguage || "";
    updateCustomVisibility();
    state.settingsLoaded = true;
  } catch (error) {
    showToast(error.message, "error");
  }
}

function updateCustomVisibility() {
  customLanguageInput.classList.toggle(
    "hidden",
    targetLanguageSelect.value !== "custom",
  );
}

async function saveSettings() {
  const settings = {
    aiApiKey: apiKeyInput.value.trim(),
    aiBaseUrl: baseUrlInput.value.trim(),
    aiModel: modelInput.value.trim(),
    targetLanguage: targetLanguageSelect.value,
    customLanguage: customLanguageInput.value.trim(),
  };
  try {
    const result = await send("setSettings", { settings });
    state.settings = result.settings;
    showToast("设置已保存");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function testApiKey() {
  keyTestResultEl.className = "hint";
  keyTestResultEl.textContent = "正在测试…";
  testKeyBtn.disabled = true;
  try {
    const result = await send("testApiKey", {
      apiKey: apiKeyInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      model: modelInput.value.trim(),
    });
    keyTestResultEl.className = "hint ok";
    keyTestResultEl.textContent = `连接成功：${result.text}`;
  } catch (error) {
    keyTestResultEl.className = "hint error";
    keyTestResultEl.textContent = error.message;
  } finally {
    testKeyBtn.disabled = false;
  }
}

// ============================================================
// 标签页
// ============================================================

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tab}`);
  });

  if (tab === "overview" && !state.overview) {
    loadCachedOverview();
  }
  if (tab === "notes") {
    captureCurrentSeconds();
    refreshNotes();
  }
  if (tab === "chat" && !state.chatLoaded) {
    loadChat();
  }
  if (tab === "settings" && !state.settingsLoaded) {
    loadSettings();
  }
}

// ============================================================
// 事件绑定
// ============================================================

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => switchMode(button.dataset.mode));
});

refreshBtn.addEventListener("click", () => {
  refreshBtn.classList.add("spinning");
  loadTranscript().finally(() => refreshBtn.classList.remove("spinning"));
});

translateBtn.addEventListener("click", startTranslation);
hideOriginalBtn.addEventListener("click", () => {
  if (state.mode !== "bilingual") return;
  state.hideOriginal = !state.hideOriginal;
  updateHideOriginalButton();
  renderSegments();
});
exportBtn.addEventListener("click", exportMarkdown);
copyTranscriptBtn.addEventListener("click", copyTranscript);
generateOverviewBtn.addEventListener("click", () => loadOverview({ force: false }));
regenerateOverviewBtn.addEventListener("click", () => loadOverview({ force: true }));
exportOverviewBtn.addEventListener("click", exportOverview);
themeToggleBtn.addEventListener("click", toggleTheme);
polishNoteBtn.addEventListener("click", polishCurrentNote);
saveNoteBtn.addEventListener("click", saveCurrentNote);
exportChatBtn.addEventListener("click", exportChat);
clearChatBtn.addEventListener("click", clearChat);
sendChatBtn.addEventListener("click", sendChat);
regenerateChatBtn.addEventListener("click", regenerateChat);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendChat();
  }
});
saveSettingsBtn.addEventListener("click", saveSettings);
testKeyBtn.addEventListener("click", testApiKey);
targetLanguageSelect.addEventListener("change", updateCustomVisibility);
document.querySelectorAll(".notes-scope .mode").forEach((button) => {
  button.addEventListener("click", () => switchNotesScope(button.dataset.scope));
});

toggleKeyBtn.addEventListener("click", () => {
  const showing = apiKeyInput.type === "text";
  apiKeyInput.type = showing ? "password" : "text";
});

closeExplainBtn.addEventListener("click", () => {
  explainSheetEl.classList.add("hidden");
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "noteSaved") {
    if (state.currentTab === "notes") refreshNotes();
    return;
  }
  if (message.action !== "translationProgress") return;
  if (
    !state.video ||
    message.bvid !== state.video.bvid ||
    message.cid !== state.video.cid
  ) {
    return;
  }
  if (message.total) {
    setProgress(Math.round((message.done / message.total) * 100));
  }
  if (message.status === "done") {
    transcriptStatusEl.textContent = "";
  }
});

// ============================================================
// 轮询与初始化
// ============================================================

loadTheme();
detectVideo();
setInterval(detectVideo, 2000);
