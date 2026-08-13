/**
 * Bili Digest 后台服务（MV3 Service Worker）。
 *
 * 职责：
 * 1. 用 WBI 签名调用 B站网页端接口，获取视频信息与字幕；
 * 2. 调用 DeepSeek 完成翻译、概览、选中解释；
 * 3. 在 chrome.storage.local 中缓存结果并管理笔记；
 * 4. 作为消息中枢，路由侧边栏 / 内容脚本的请求。
 *
 * 注意：B站字幕接口需要登录态。本扩展不收集任何 cookie，
 * 而是由浏览器在请求 B站域名时自动携带用户自己的登录 cookie。
 */

import { encWbi, getMixinKey, extractWbiKey } from "./lib/wbi.js";
import {
  parseSubtitleJson,
  pickChineseTrack,
  normalizeSubtitleUrl,
  secondsToTimestamp,
} from "./lib/subtitle.js";
import { requestDeepSeek, parseLooseJson } from "./lib/deepseek.js";

const DEBUG = false;
const TRANSLATE_BATCH_SIZE = 3;
const TRANSCRIPT_CACHE_TTL_MS = 24 * 3600 * 1000;
const WBI_KEYS_TTL_MS = 12 * 3600 * 1000;

const debugLog = (...args) => {
  if (DEBUG) console.log("[BiliDigest]", ...args);
};

const store = {
  async get(key, fallback) {
    const result = await chrome.storage.local.get(key);
    return key in result ? result[key] : fallback;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};

const DEFAULT_SETTINGS = {
  deepseekApiKey: "",
  targetLanguage: "English",
  customLanguage: "",
};

async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await store.get("settings", {})) };
}

// ============================================================
// B站 HTTP 与 WBI 签名
// ============================================================

async function fetchJson(url, { skipCodeCheck = false } = {}) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`B站接口请求失败（HTTP ${response.status}）`);
  }
  const data = await response.json();
  if (!skipCodeCheck && typeof data?.code === "number" && data.code !== 0) {
    throw new Error(`B站接口返回错误（${data.code}）：${data.message || "未知错误"}`);
  }
  return data;
}

async function getMixinKeyCached(force = false) {
  const cached = await store.get("wbiKeys", null);
  if (
    !force &&
    cached?.mixinKey &&
    Date.now() - (cached.fetchedAt || 0) < WBI_KEYS_TTL_MS
  ) {
    return cached.mixinKey;
  }

  // nav 接口未登录会返回 -101，但 wbi_img 仍然可用，因此跳过 code 检查
  const nav = await fetchJson("https://api.bilibili.com/x/web-interface/nav", {
    skipCodeCheck: true,
  });
  const imgUrl = nav?.data?.wbi_img?.img_url;
  const subUrl = nav?.data?.wbi_img?.sub_url;
  if (!imgUrl || !subUrl) {
    throw new Error("获取 WBI 密钥失败：nav 接口未返回 wbi_img");
  }
  const mixinKey = getMixinKey(extractWbiKey(imgUrl), extractWbiKey(subUrl));
  await store.set("wbiKeys", { mixinKey, fetchedAt: Date.now() });
  return mixinKey;
}

async function signedGet(path, params) {
  const attempt = async (forceRefresh) => {
    const mixinKey = await getMixinKeyCached(forceRefresh);
    const { w_rid, wts } = await encWbi(params, mixinKey);
    const qs = new URLSearchParams({ ...params, w_rid, wts });
    return fetchJson(`https://api.bilibili.com${path}?${qs.toString()}`);
  };

  try {
    return await attempt(false);
  } catch (error) {
    const message = String(error.message);
    // 签名参数过期 / 密钥轮换导致的拦截：刷新密钥重试一次
    if (
      message.includes("-403") ||
      message.includes("-412") ||
      message.includes("HTTP 403") ||
      message.includes("HTTP 412")
    ) {
      return attempt(true);
    }
    throw error;
  }
}

// ============================================================
// 视频信息与字幕
// ============================================================

function transcriptKey(bvid, cid) {
  return `transcript:${bvid}:${cid}`;
}

async function handleGetVideoInfo(bvid) {
  if (!bvid) throw new Error("缺少视频 BV 号");
  const view = await signedGet("/x/web-interface/wbi/view", { bvid });
  const data = view.data;
  return {
    bvid,
    aid: data.aid,
    title: data.title,
    author: data.owner?.name || "",
    duration: data.duration,
    cid: data.cid,
    pages: Array.isArray(data.pages)
      ? data.pages.map((page) => ({
          cid: page.cid,
          page: page.page,
          part: page.part,
        }))
      : [],
  };
}

async function fetchTranscriptFromServer(bvid, cid) {
  if (!bvid) throw new Error("未检测到视频 BV 号");
  if (!cid) {
    const info = await handleGetVideoInfo(bvid);
    cid = info.cid;
  }

  const player = await signedGet("/x/player/wbi/v2", { bvid, cid });
  const tracks = player?.data?.subtitle?.subtitles || [];
  if (tracks.length === 0) {
    return { bvid, cid, tracks: [], track: null, segments: [] };
  }

  const track = pickChineseTrack(tracks);
  if (!track?.subtitle_url) {
    return { bvid, cid, tracks, track: null, segments: [] };
  }

  const subtitleUrl = normalizeSubtitleUrl(track.subtitle_url);
  const json = await fetchJson(subtitleUrl, { skipCodeCheck: true });
  const segments = parseSubtitleJson(json);
  return { bvid, cid, tracks, track, segments };
}

async function handleFetchTranscript({ bvid, cid }) {
  const key = transcriptKey(bvid, cid);
  const cached = await store.get(key, null);
  if (cached && Date.now() - cached.fetchedAt < TRANSCRIPT_CACHE_TTL_MS) {
    return cached;
  }
  const data = await fetchTranscriptFromServer(bvid, cid);
  const record = { ...data, fetchedAt: Date.now() };
  await store.set(key, record);
  return record;
}

// ============================================================
// Prompt 模板
// ============================================================

const promptCache = new Map();

async function renderPrompt(fileName, variables = {}) {
  if (!promptCache.has(fileName)) {
    const url = chrome.runtime.getURL(`prompts/${fileName}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`读取 prompt 模板失败：${fileName}`);
    }
    promptCache.set(fileName, await response.text());
  }
  let text = promptCache.get(fileName);
  for (const [key, value] of Object.entries(variables)) {
    text = text.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return text;
}

// ============================================================
// AI 功能
// ============================================================

function translationKey(bvid, cid, lang) {
  return `translation:${bvid}:${cid}:${lang}`;
}

function broadcastTranslationProgress(payload) {
  chrome.runtime
    .sendMessage({ action: "translationProgress", ...payload })
    .catch(() => {
      // 侧边栏没打开时忽略
    });
}

async function handleTranslate({ bvid, cid, segments, targetLanguage }) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { texts: [], cached: true };
  }

  const key = translationKey(bvid, cid, targetLanguage);
  const cached = await store.get(key, null);
  if (cached && cached.texts?.length === segments.length) {
    return { texts: cached.texts, cached: true };
  }

  const settings = await getSettings();
  const texts = new Array(segments.length).fill("");
  const idSegments = segments.map((segment, index) => ({
    id: String(index),
    content: segment.content,
  }));
  const totalBatches = Math.ceil(idSegments.length / TRANSLATE_BATCH_SIZE);

  broadcastTranslationProgress({
    bvid,
    cid,
    done: 0,
    total: idSegments.length,
    status: "translating",
  });

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const batch = idSegments.slice(
      batchIndex * TRANSLATE_BATCH_SIZE,
      (batchIndex + 1) * TRANSLATE_BATCH_SIZE,
    );
    const prompt = await renderPrompt("translation.md", {
      target_language: targetLanguage,
      segments_json: JSON.stringify(batch),
    });
    const content = await requestDeepSeek(
      settings.deepseekApiKey,
      [{ role: "user", content: prompt }],
      { json: true },
    );
    const parsed = parseLooseJson(content);
    const items = Array.isArray(parsed?.translations) ? parsed.translations : [];
    const byId = new Map(
      items.map((item) => [String(item.id), String(item.text ?? "").trim()]),
    );
    for (const segment of batch) {
      texts[Number(segment.id)] = byId.get(segment.id) ?? "";
    }

    broadcastTranslationProgress({
      bvid,
      cid,
      done: Math.min(segments.length, (batchIndex + 1) * TRANSLATE_BATCH_SIZE),
      total: segments.length,
      status: "translating",
    });
  }

  await store.set(key, { texts, fetchedAt: Date.now() });
  broadcastTranslationProgress({
    bvid,
    cid,
    done: segments.length,
    total: segments.length,
    status: "done",
  });
  return { texts, cached: false };
}

function digestKey(bvid, cid) {
  return `digest:${bvid}:${cid}`;
}

async function handleGenerateOverview({ bvid, cid, segments, force = false }) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("没有字幕，无法生成概览");
  }

  const key = digestKey(bvid, cid);
  if (!force) {
    const cached = await store.get(key, null);
    if (cached) return { ...cached, cached: true };
  }

  const settings = await getSettings();
  const transcript = segments
    .map((segment) => `[${secondsToTimestamp(segment.from)}] ${segment.content}`)
    .join("\n");
  const prompt = await renderPrompt("analysis.md", { transcript });
  const content = await requestDeepSeek(
    settings.deepseekApiKey,
    [{ role: "user", content: prompt }],
    { json: true },
  );
  const parsed = parseLooseJson(content);
  const keyPoints = Array.isArray(parsed.key_points)
    ? parsed.key_points
    : Array.isArray(parsed.keyPoints)
      ? parsed.keyPoints
      : [];

  const overview = {
    summary: String(parsed.summary ?? "").trim(),
    chapters: Array.isArray(parsed.chapters)
      ? parsed.chapters
          .map((chapter) => ({
            title: String(chapter.title ?? "").trim(),
            time: Number(chapter.time) || 0,
          }))
          .filter((chapter) => chapter.title)
      : [],
    keyPoints: keyPoints.map((point) => String(point).trim()).filter(Boolean),
  };
  await store.set(key, { ...overview, fetchedAt: Date.now() });
  return { ...overview, cached: false };
}

async function handleExplain({ text, context }) {
  if (!text) throw new Error("没有选中文本");
  const settings = await getSettings();
  const prompt = await renderPrompt("explain.md", { text, context });
  const result = await requestDeepSeek(settings.deepseekApiKey, [
    { role: "user", content: prompt },
  ]);
  return { text: result };
}

// ============================================================
// 笔记
// ============================================================

function notesKey(videoId) {
  return `notes:${videoId}`;
}

async function handleSaveNote({ videoId, timestamp, videoTitle, author, text }) {
  if (!videoId) throw new Error("缺少视频 ID");
  const notes = await store.get(notesKey(videoId), []);
  const seconds = Math.max(0, Number(timestamp) || 0);
  const note = {
    id: crypto.randomUUID(),
    videoId,
    timestamp: seconds,
    videoTitle: String(videoTitle ?? ""),
    author: String(author ?? ""),
    text: String(text ?? "").trim(),
    createdAt: Date.now(),
    url: `https://www.bilibili.com/video/${videoId}?t=${seconds}`,
  };
  notes.push(note);
  await store.set(notesKey(videoId), notes);
  return { success: true, note };
}

async function handleGetNotes(videoId) {
  if (!videoId) return [];
  return store.get(notesKey(videoId), []);
}

async function handleDeleteNote({ videoId, noteId }) {
  const notes = await store.get(notesKey(videoId), []);
  const next = notes.filter((note) => note.id !== noteId);
  await store.set(notesKey(videoId), next);
  return next;
}

// ============================================================
// 设置
// ============================================================

async function handleSetSettings({ settings }) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  await store.set("settings", merged);
  return merged;
}

async function handleTestApiKey({ apiKey }) {
  const content = await requestDeepSeek(apiKey, [
    { role: "user", content: "请只回复两个字：正常" },
  ]);
  return { text: content.trim() };
}

// ============================================================
// 消息路由
// ============================================================

async function route(message, sender) {
  switch (message.action) {
    case "openSidePanel": {
      let tabId = sender.tab?.id;
      if (!tabId) {
        const [tab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        tabId = tab?.id;
      }
      try {
        if (tabId) await chrome.sidePanel.open({ tabId });
        return { opened: true };
      } catch {
        // 浏览器要求用户手势才能打开侧边栏；从页面按钮触发时手势可能丢失
        return {
          opened: false,
          hint: "请点击浏览器工具栏上的 Bili Digest 图标打开侧边栏",
        };
      }
    }
    case "getSettings":
      return { settings: await getSettings() };
    case "setSettings":
      return { settings: await handleSetSettings({ settings: message.settings }) };
    case "testApiKey":
      return await handleTestApiKey({ apiKey: message.apiKey });
    case "getVideoInfo":
      return { info: await handleGetVideoInfo(message.bvid) };
    case "fetchTranscript":
      return await handleFetchTranscript({ bvid: message.bvid, cid: message.cid });
    case "translate":
      return await handleTranslate({
        bvid: message.bvid,
        cid: message.cid,
        segments: message.segments,
        targetLanguage: message.targetLanguage,
      });
    case "generateOverview":
      return await handleGenerateOverview({
        bvid: message.bvid,
        cid: message.cid,
        segments: message.segments,
        force: Boolean(message.force),
      });
    case "explainSelection":
      return await handleExplain({ text: message.text, context: message.context });
    case "saveNote":
      return await handleSaveNote(message);
    case "getNotes":
      return { notes: await handleGetNotes(message.videoId) };
    case "deleteNote":
      return {
        notes: await handleDeleteNote({
          videoId: message.videoId,
          noteId: message.noteId,
        }),
      };
    default:
      throw new Error(`未知操作：${message.action}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog("收到消息", message.action, message);
  route(message, sender)
    .then((result) => sendResponse({ success: true, ...result }))
    .catch((error) => {
      console.error("[BiliDigest]", message.action, error);
      sendResponse({ success: false, error: error?.message || "未知错误" });
    });
  return true; // 保持消息通道，等待异步结果
});

// 点击工具栏图标直接打开侧边栏
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
