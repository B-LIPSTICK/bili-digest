/**
 * Bili Digest 侧边栏脚本。
 *
 * 负责：视频检测、字幕渲染（原文/译文/双语）、时间戳跳转、
 * AI 概览、笔记管理、设置。
 *
 * 所有数据请求都通过后台服务（background.js）统一处理。
 */

const state = {
  video: null,
  segments: [],
  mode: "original",
  translations: [],
  translating: false,
  overview: null,
  settings: {
    deepseekApiKey: "",
    targetLanguage: "English",
    customLanguage: "",
  },
  settingsLoaded: false,
  notes: [],
  noteSeconds: 0,
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
const refreshBtn = $("refreshBtn");
const generateOverviewBtn = $("generateOverviewBtn");
const regenerateOverviewBtn = $("regenerateOverviewBtn");
const overviewStatusEl = $("overviewStatus");
const overviewContentEl = $("overviewContent");
const noteTextEl = $("noteText");
const noteTimeChipEl = $("noteTimeChip");
const saveNoteBtn = $("saveNoteBtn");
const notesStatusEl = $("notesStatus");
const notesListEl = $("notesList");
const apiKeyInput = $("apiKeyInput");
const toggleKeyBtn = $("toggleKeyBtn");
const testKeyBtn = $("testKeyBtn");
const keyTestResultEl = $("keyTestResult");
const targetLanguageSelect = $("targetLanguageSelect");
const customLanguageInput = $("customLanguageInput");
const saveSettingsBtn = $("saveSettingsBtn");
const toastEl = $("toast");
const explainSheetEl = $("explainSheet");
const explainOriginalEl = $("explainOriginal");
const explainResultEl = $("explainResult");
const closeExplainBtn = $("closeExplainBtn");

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
  if (!bvid || !cid) {
    renderEmpty(segmentsEl, "⚠️", ["没有读取到该视频的 cid", "请刷新页面后重试"]);
    return;
  }

  transcriptStatusEl.textContent = "正在读取字幕…";
  transcriptStatusEl.className = "status-line";

  try {
    const result = await send("fetchTranscript", {
      bvid,
      cid,
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
  }
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
    state.translations.length !== state.segments.length
  ) {
    startTranslation();
  }
}

async function seekTo(seconds) {
  try {
    await sendToTab("seekTo", { seconds });
  } catch (error) {
    showToast(error.message, "error");
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

  overviewContentEl.appendChild(fragment);
}

// ============================================================
// 笔记
// ============================================================

async function refreshNotes() {
  if (!state.video?.bvid) {
    renderEmpty(notesListEl, "📝", ["先打开一个 B站视频"]);
    return;
  }
  try {
    const result = await send("getNotes", { videoId: state.video.bvid });
    state.notes = result.notes || [];
    renderNotes();
  } catch (error) {
    notesStatusEl.className = "status-line error";
    notesStatusEl.textContent = error.message;
  }
}

function renderNotes() {
  notesListEl.replaceChildren();
  if (state.notes.length === 0) {
    renderEmpty(notesListEl, "📝", ["还没有笔记", "在上方写下想法，保存后会带上时间戳"]);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const note of [...state.notes].sort((a, b) => a.timestamp - b.timestamp)) {
    const card = document.createElement("div");
    card.className = "note-card";
    card.innerHTML = `
      <div class="note-head">
        <button class="note-time" data-seconds="${note.timestamp}">${secondsToTimestamp(note.timestamp)}</button>
      </div>
      <p class="note-text">${escapeHtml(note.text)}</p>
      <button class="note-delete" title="删除笔记">✕</button>
    `;
    card.querySelector(".note-time").addEventListener("click", () => seekTo(note.timestamp));
    card.querySelector(".note-delete").addEventListener("click", async () => {
      try {
        await send("deleteNote", { videoId: state.video.bvid, noteId: note.id });
        await refreshNotes();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
    fragment.appendChild(card);
  }
  notesListEl.appendChild(fragment);
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

// ============================================================
// 设置
// ============================================================

async function loadSettings() {
  try {
    const result = await send("getSettings");
    state.settings = result.settings;
    apiKeyInput.value = state.settings.deepseekApiKey || "";
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
    deepseekApiKey: apiKeyInput.value.trim(),
    targetLanguage: targetLanguageSelect.value,
    customLanguage: customLanguageInput.value.trim(),
  };
  try {
    await send("setSettings", { settings });
    state.settings = settings;
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
    const result = await send("testApiKey", { apiKey: apiKeyInput.value.trim() });
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

generateOverviewBtn.addEventListener("click", () => loadOverview({ force: false }));
regenerateOverviewBtn.addEventListener("click", () => loadOverview({ force: true }));
saveNoteBtn.addEventListener("click", saveCurrentNote);
saveSettingsBtn.addEventListener("click", saveSettings);
testKeyBtn.addEventListener("click", testApiKey);
targetLanguageSelect.addEventListener("change", updateCustomVisibility);

toggleKeyBtn.addEventListener("click", () => {
  const showing = apiKeyInput.type === "text";
  apiKeyInput.type = showing ? "password" : "text";
});

closeExplainBtn.addEventListener("click", () => {
  explainSheetEl.classList.add("hidden");
});

chrome.runtime.onMessage.addListener((message) => {
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
