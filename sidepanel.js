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

const state = {
  video: null,
  segments: [],
  mode: "original",
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

function renderEmpty(targetEl, glyph, lines) {
  targetEl.replaceChildren();
  const box = document.createElement("div");
  box.className = "empty-state";
  box.innerHTML = `<span class="glyph">${escapeHtml(glyph)}</span>${lines
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
    videoMetaEl.textContent = "";
    return;
  }
  videoTitleEl.textContent = state.video.title || state.video.bvid;
  const parts = [];
  if (state.video.author) parts.push(`UP：${state.video.author}`);
  parts.push(state.video.bvid);
  videoMetaEl.textContent = parts.join("  ·  ");
}

async function detectVideo() {
  try {
    const context = await sendToTab("getVideoContext");
    if (!context.bvid) {
      state.video = null;
      updateHeader();
      renderEmpty(
        segmentsEl,
        "📺",
        ["请打开一个 B站视频页面", "字幕和笔记会出现在这里"],
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
      await loadTranscript();
    } else {
      state.video = context;
      updateHeader();
    }
  } catch {
    // 暂时连不上视频页（例如在非 B站页签），静默等待下一轮轮询
  }
}

// ============================================================
// 字幕
// ============================================================

async function loadTranscript() {
  const { bvid, cid } = state.video;
  if (!bvid) {
    renderEmpty(segmentsEl, "📺", ["请打开一个 B站视频页面", "字幕和笔记会出现在这里"]);
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
        "🔇",
        [
          result.tracks?.length
            ? "字幕文件为空"
            : "没有找到字幕轨道",
          "请确认：已在 bilibili.com 登录，且这个视频本身有字幕",
        ],
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
      "🔒",
      [
        `读取字幕失败：${message}`,
        needsLogin ? "请先在 bilibili.com 登录，然后刷新视频页" : "请刷新视频页后重试",
      ],
    );
  }
}

function renderSegments() {
  segmentsEl.replaceChildren();
  const fragment = document.createDocumentFragment();

  state.segments.forEach((segment, index) => {
    const row = document.createElement("div");
    row.className = "segment";
    if (state.mode === "translated" && !state.translations[index]) {
      row.classList.add("tr-empty");
    }

    const translation =
      state.mode === "original"
        ? ""
        : `<div class="segment-tr">${escapeHtml(state.translations[index] || "…")}</div>`;

    row.innerHTML = `
      <span class="segment-time">${secondsToTimestamp(segment.from)}</span>
      <button class="segment-explain" data-index="${index}" title="让 AI 解释这一句">解释</button>
      <span class="segment-zh">${escapeHtml(segment.content)}</span>
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
  document.querySelectorAll(".mode").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
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
    if (state.mode === "translated") {
      return `[${time}] ${state.translations[index] || "…"}`;
    }
    if (state.mode === "bilingual") {
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
      "🗂️",
      ["该视频没有字幕，无法生成概览"],
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
        renderEmpty(notesListEl, "📝", ["先打开一个 B站视频"]);
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
      "📝",
      state.notesScope === "all"
        ? ["还没有任何视频的笔记", "看视频时点「记笔记」或按 N，AI 会帮你整理好当前句"]
        : ["还没有笔记", "看视频时点「记笔记」或按 N，AI 会帮你整理好当前句"],
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
        ${state.notesScope === "all" ? `<span class="note-video-title">${escapeHtml(note.videoTitle || note.videoId || "")}</span>` : ""}
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

function renderChat() {
  chatMessagesEl.replaceChildren();
  if (!state.chatMessages.length) {
    renderEmpty(chatMessagesEl, "💬", [
      "就当前视频的字幕问我问题",
      "回答只依据字幕内容，不会编造",
    ]);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.chatMessages.forEach((message, index) => {
    const isUser = message.role === "user";
    const wrapper = document.createElement("div");
    wrapper.className = `chat-msg ${isUser ? "user" : "ai"}`;
    wrapper.innerHTML = `
      <span class="chat-msg-head">${isUser ? "你" : "AI"}</span>
      <div class="chat-msg-text">${escapeHtml(message.content)}</div>
    `;
    const isPending =
      !isUser &&
      index === state.chatMessages.length - 1 &&
      state.chatSending &&
      !message.content;
    if (isPending) {
      wrapper.classList.add("typing");
      wrapper.querySelector(".chat-msg-text").textContent = "正在思考…";
    }
    fragment.appendChild(wrapper);
  });
  chatMessagesEl.appendChild(fragment);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
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

function finishChat(key, port) {
  state.chatSending = false;
  sendChatBtn.disabled = false;
  try {
    port.disconnect();
  } catch {
    // 端口可能已经断开
  }
  chrome.storage.local.set({ [key]: state.chatMessages }).catch(() => {});
  renderChat();
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || state.chatSending) return;
  if (!state.video?.bvid) {
    showToast("先打开一个 B站视频", "error");
    return;
  }

  state.chatSending = true;
  sendChatBtn.disabled = true;
  state.chatMessages.push({ role: "user", content: text });
  state.chatMessages.push({ role: "assistant", content: "" });
  renderChat();
  chatInput.value = "";

  const key = chatKey(state.video.bvid, state.video.cid);
  const history = state.chatMessages.filter((message) => message.content);
  const port = chrome.runtime.connect({ name: "chat" });
  let received = "";

  port.onMessage.addListener((message) => {
    if (message.type === "delta") {
      received += message.delta;
      appendChatDelta(message.delta);
    } else if (message.type === "done") {
      finishChat(key, port);
    } else if (message.type === "error") {
      const last = state.chatMessages[state.chatMessages.length - 1];
      if (!last || last.role === "user") {
        state.chatMessages.push({ role: "assistant", content: "" });
      }
      state.chatMessages[state.chatMessages.length - 1].content =
        `回答失败：${message.error}`;
      finishChat(key, port);
    }
  });

  port.onDisconnect.addListener(() => {
    if (!received && state.chatSending) {
      const last = state.chatMessages[state.chatMessages.length - 1];
      if (last && last.role === "assistant" && !last.content) {
        last.content = "连接中断，请重试";
      }
      finishChat(key, port);
    }
  });

  try {
    port.postMessage({
      action: "chatAsk",
      bvid: state.video.bvid,
      cid: state.video.cid,
      aid: state.video.aid,
      messages: history,
    });
  } catch (error) {
    const last = state.chatMessages[state.chatMessages.length - 1];
    if (last && last.role === "assistant" && !last.content) {
      last.content = `发送失败：${error.message}`;
    }
    finishChat(key, port);
  }
}

async function clearChat() {
  if (!state.video?.bvid) return;
  let confirmed = true;
  try {
    confirmed = window.confirm("清空当前视频的对话记录？");
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
    loadOverview();
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
exportBtn.addEventListener("click", exportMarkdown);
copyTranscriptBtn.addEventListener("click", copyTranscript);
generateOverviewBtn.addEventListener("click", () => loadOverview({ force: false }));
regenerateOverviewBtn.addEventListener("click", () => loadOverview({ force: true }));
exportOverviewBtn.addEventListener("click", exportOverview);
polishNoteBtn.addEventListener("click", polishCurrentNote);
saveNoteBtn.addEventListener("click", saveCurrentNote);
exportChatBtn.addEventListener("click", exportChat);
clearChatBtn.addEventListener("click", clearChat);
sendChatBtn.addEventListener("click", sendChat);
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

detectVideo();
setInterval(detectVideo, 2000);
