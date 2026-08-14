/**
 * Bili Digest 后台服务（MV3 Service Worker）。
 *
 * 职责：
 * 1. 用 WBI 签名调用 B站网页端接口，获取视频信息与字幕；
 * 2. 调用用户选择的 AI 供应商完成翻译、概览、选中解释；
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
  parseTimeToSeconds,
  snapToNearestSegment,
} from "./lib/subtitle.js";
import {
  normalizeProviderConfig,
  migrateLegacySettings,
  requestAiCompletion,
  requestModelList,
  parseLooseJson,
} from "./lib/ai.js";
import { buildNoteContext, segmentsToText } from "./lib/note-context.js";

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
  aiApiKey: "",
  aiBaseUrl: "",
  aiModel: "",
  targetLanguage: "English",
  customLanguage: "",
};

/**
 * 合并并清洗设置，只保留当前 schema 需要的字段。
 */
function mergeSettings(base, incoming = {}) {
  const merged = { ...base, ...incoming };
  merged.aiApiKey = String(merged.aiApiKey ?? "").trim();
  merged.aiBaseUrl = String(merged.aiBaseUrl ?? "").trim();
  merged.aiModel = String(merged.aiModel ?? "").trim();
  merged.targetLanguage = String(merged.targetLanguage || "English");
  merged.customLanguage = String(merged.customLanguage || "").trim();
  // 清理旧版多供应商字段，统一到单入口
  delete merged.aiProvider;
  delete merged.providers;
  delete merged.deepseekApiKey;
  return merged;
}

async function getSettings() {
  const stored = await store.get("settings", {});
  return mergeSettings(DEFAULT_SETTINGS, migrateLegacySettings(stored));
}

// ============================================================
// B站 HTTP 与 WBI 签名
// ============================================================

/**
 * B站请求的通用配置。参考已在生产环境长期工作的
 * Bilibili-Obsidian-Clipper：B站对缺失 Referer / 无浏览器头
 * 的请求会触发风控，这里显式补上浏览器头、语言头和来源页。
 */
function buildBiliRequestOptions() {
  return {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    referrer: "https://www.bilibili.com/",
    referrerPolicy: "strict-origin-when-cross-origin",
  };
}

async function fetchJson(url, { skipCodeCheck = false } = {}) {
  const response = await fetch(url, buildBiliRequestOptions());
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

function transcriptKey(bvid, cid, lan = "") {
  return `transcript:${bvid}:${cid}:${String(lan || "")}`;
}

function activeTrackKey(bvid, cid) {
  return `activeTrack:${bvid}:${cid}`;
}

async function handleGetVideoInfo(bvid, page = 0) {
  if (!bvid) throw new Error("缺少视频 BV 号");
  const params = { bvid };
  if (Number(page) > 1) params.p = String(Number(page));
  const view = await signedGet("/x/web-interface/wbi/view", params);
  const data = view.data;
  return {
    bvid,
    aid: data.aid,
    title: data.title,
    desc: data.desc || "",
    author: data.owner?.name || "",
    authorMid: Number(data.owner?.mid) || 0,
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

/**
 * 多 P 视频以官方 view 接口按 p 参数解析 aid/cid。
 * 页面首屏缓存里的 cid 在切 P 后可能仍是 P1，不能直接信。
 */
async function resolvePartIdentity(bvid, cid, aid, page) {
  if (Number(page) <= 1) {
    return { cid: Number(cid) || 0, aid: String(aid || "") };
  }
  try {
    const info = await handleGetVideoInfo(bvid, Number(page));
    // view 接口的顶层 cid 不随 p 变化，真正的分集 cid 在 pages 列表里
    const pages = Array.isArray(info.pages) ? info.pages : [];
    const target = pages[Number(page) - 1];
    return {
      cid: Number(target?.cid) || Number(cid) || 0,
      aid: String(info.aid || aid || ""),
    };
  } catch {
    return { cid: Number(cid) || 0, aid: String(aid || "") };
  }
}

async function fetchSubtitleTracks(bvid, cid, aid = "", page = 0) {
  if (!bvid) throw new Error("未检测到视频 BV 号");
  if (!aid || !cid) {
    const info = await handleGetVideoInfo(bvid, page);
    aid = String(info.aid || "");
    cid = cid || info.cid;
  }

  // 与 Clipper 相同的主/备来源策略：
  // 1. 主来源 player/wbi/v2，优先带 aid（B站实际播放页用的就是 aid+cid）；
  // 2. 主来源请求失败时回退 player/v2；
  // 3. 两个都不行再退回带 WBI 签名的 wbi/v2。
  // 主来源成功但字幕为空 = 确实没有字幕，不再跨源兜底。
  const primaryUrl =
    "https://api.bilibili.com/x/player/wbi/v2" +
    `?aid=${encodeURIComponent(aid)}` +
    `&cid=${encodeURIComponent(String(cid))}` +
    `&bvid=${encodeURIComponent(bvid)}`;
  const fallbackUrl =
    "https://api.bilibili.com/x/player/v2" +
    `?bvid=${encodeURIComponent(bvid)}` +
    `&cid=${encodeURIComponent(String(cid))}` +
    (aid ? `&aid=${encodeURIComponent(aid)}` : "");

  let playerData;
  try {
    playerData = (await fetchJson(primaryUrl)).data;
  } catch (primaryError) {
    debugLog("主来源失败，回退 player/v2", primaryError);
    try {
      playerData = (await fetchJson(fallbackUrl)).data;
    } catch (fallbackError) {
      debugLog("player/v2 也失败，改用 WBI 签名请求", fallbackError);
      const params = { bvid, cid };
      if (aid) params.aid = aid;
      playerData = (await signedGet("/x/player/wbi/v2", params)).data;
    }
  }

  return { tracks: playerData?.subtitle?.subtitles || [] };
}

async function fetchTranscriptFromServer(
  bvid,
  cid,
  aid = "",
  preferredLan = "",
  page = 0,
) {
  const { tracks } = await fetchSubtitleTracks(bvid, cid, aid, page);
  if (tracks.length === 0) {
    return { bvid, cid, tracks: [], track: null, segments: [] };
  }

  const track = preferredLan
    ? tracks.find((item) => String(item?.lan) === String(preferredLan))
    : pickChineseTrack(tracks);
  if (!track?.subtitle_url) {
    return { bvid, cid, tracks, track: track || null, segments: [] };
  }

  const subtitleUrl = normalizeSubtitleUrl(track.subtitle_url);
  const json = await fetchJson(subtitleUrl, { skipCodeCheck: true });
  const segments = parseSubtitleJson(json);
  return { bvid, cid, tracks, track, segments };
}

async function handleFetchTranscript({ bvid, cid, aid, lan, page }) {
  ({ cid, aid } = await resolvePartIdentity(bvid, cid, aid, page));
  let trackLan = String(lan || "");
  if (!trackLan) {
    const { tracks } = await fetchSubtitleTracks(bvid, cid, aid, page);
    trackLan = String(pickChineseTrack(tracks)?.lan || "");
    if (!trackLan) {
      return { bvid, cid, tracks, track: null, segments: [] };
    }
  }

  const key = transcriptKey(bvid, cid, trackLan);
  const cached = await store.get(key, null);
  if (cached && Date.now() - cached.fetchedAt < TRANSCRIPT_CACHE_TTL_MS) {
    return cached;
  }
  const data = await fetchTranscriptFromServer(bvid, cid, aid, trackLan, page);
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

function translationKey(bvid, cid, lan, lang) {
  return `translation:${bvid}:${cid}:${String(lan || "")}:${lang}`;
}

function broadcastTranslationProgress(payload) {
  chrome.runtime
    .sendMessage({ action: "translationProgress", ...payload })
    .catch(() => {
      // 侧边栏没打开时忽略
    });
}

async function handleTranslate({ bvid, cid, lan, segments, targetLanguage }) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { texts: [], cached: true };
  }

  const key = translationKey(bvid, cid, lan, targetLanguage);
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
    const config = normalizeProviderConfig(settings);
    const content = await requestAiCompletion(
      config,
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

function digestKey(bvid, cid, lan = "") {
  return `digest:${bvid}:${cid}:${String(lan || "")}`;
}

async function handleGenerateOverview({ bvid, cid, lan, segments, force = false }) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("没有字幕，无法生成概览");
  }

  const key = digestKey(bvid, cid, lan);
  if (!force) {
    const cached = await store.get(key, null);
    if (cached) return { ...cached, cached: true };
  }

  const settings = await getSettings();
  const transcript = segments
    .map((segment) => `[${secondsToTimestamp(segment.from)}] ${segment.content}`)
    .join("\n");
  const prompt = await renderPrompt("analysis.md", { transcript });
  const config = normalizeProviderConfig(settings);
  let content = await requestAiCompletion(
    config,
    [{ role: "user", content: prompt }],
    { json: true },
  );
  let parsed = parseLooseJson(content);

  // 模型偶尔只给两三个章节，带着上次结果让它补一次，只重试一次。
  const validChapterCount = (value) =>
    Array.isArray(value?.chapters)
      ? value.chapters.filter(
          (chapter) =>
            String(chapter?.title ?? "").trim() &&
            parseTimeToSeconds(chapter?.time) !== null,
        ).length
      : 0;
  if (validChapterCount(parsed) < 4) {
    content = await requestAiCompletion(
      config,
      [
        { role: "user", content: prompt },
        { role: "assistant", content },
        {
          role: "user",
          content:
            "刚才的章节太少。请重新输出完整 JSON：章节至少 6 段、从头到尾覆盖全片，time 用数字秒数或 mm:ss，对应该段第一条字幕的真实起始时间。",
        },
      ],
      { json: true },
    );
    parsed = parseLooseJson(content);
  }

  const keyPoints = Array.isArray(parsed.key_points)
    ? parsed.key_points
    : Array.isArray(parsed.keyPoints)
      ? parsed.keyPoints
      : [];
  const keyQuotes = Array.isArray(parsed.key_quotes)
    ? parsed.key_quotes
        .map((quote) => {
          const text = String(quote?.text ?? "").trim();
          if (!text) return null;
          const seconds = parseTimeToSeconds(quote?.time);
          return {
            text,
            time: seconds === null ? 0 : snapToNearestSegment(seconds, segments),
          };
        })
        .filter(Boolean)
    : [];

  const chapters = (Array.isArray(parsed.chapters) ? parsed.chapters : [])
    .map((chapter) => {
      const seconds = parseTimeToSeconds(chapter?.time);
      if (seconds === null) return null;
      return {
        title: String(chapter?.title ?? "").trim(),
        time: snapToNearestSegment(seconds, segments),
      };
    })
    .filter((chapter) => chapter && chapter.title)
    .sort((a, b) => a.time - b.time)
    .filter(
      (chapter, index, list) => index === 0 || list[index - 1].time !== chapter.time,
    );

  const overview = {
    summary: String(parsed.summary ?? "").trim(),
    chapters,
    keyPoints: keyPoints.map((point) => String(point).trim()).filter(Boolean),
    keyQuotes,
  };
  await store.set(key, { ...overview, fetchedAt: Date.now() });
  return { ...overview, cached: false };
}

async function handleExplain({ text, context }) {
  if (!text) throw new Error("没有选中文本");
  const settings = await getSettings();
  const prompt = await renderPrompt("explain.md", { text, context });
  const config = normalizeProviderConfig(settings);
  const result = await requestAiCompletion(config, [
    { role: "user", content: prompt },
  ]);
  return { text: result };
}

async function handlePolishNote({ text }) {
  if (!text) throw new Error("没有可润色的内容");
  const settings = await getSettings();
  const config = normalizeProviderConfig(settings);
  const prompt = await renderPrompt("polish.md", { draft: text });
  const content = await requestAiCompletion(
    config,
    [{ role: "user", content: prompt }],
    { json: true },
  );
  const parsed = parseLooseJson(content);
  const polished = String(parsed?.text ?? "").trim();
  if (!polished) {
    throw new Error("AI 没有返回润色结果");
  }
  return { text: polished };
}

// ============================================================
// 笔记
// ============================================================

function notesKey(videoId) {
  return `notes:${videoId}`;
}

async function handleSaveNote({
  videoId,
  timestamp,
  videoTitle,
  author,
  text,
  page = 0,
}) {
  if (!videoId) throw new Error("缺少视频 ID");
  const notes = await store.get(notesKey(videoId), []);
  const seconds = Math.max(0, Number(timestamp) || 0);
  const pageQuery = Number(page) > 1 ? `?p=${Number(page)}&t=${seconds}` : `?t=${seconds}`;
  const note = {
    id: crypto.randomUUID(),
    videoId,
    timestamp: seconds,
    page: Number(page) || 1,
    videoTitle: String(videoTitle ?? ""),
    author: String(author ?? ""),
    text: String(text ?? "").trim(),
    createdAt: Date.now(),
    url: `https://www.bilibili.com/video/${videoId}${pageQuery}`,
  };
  notes.push(note);
  await store.set(notesKey(videoId), notes);
  return { success: true, note };
}

async function handleCaptureNote({
  bvid,
  cid,
  aid,
  page,
  seconds,
  videoTitle,
  author,
}) {
  if (!bvid) throw new Error("未检测到视频");
  ({ cid, aid } = await resolvePartIdentity(bvid, cid, aid, page));
  const time = Math.max(0, Number(seconds) || 0);

  const activeLan = await store.get(activeTrackKey(bvid, cid), "");
  let record = activeLan
    ? await store.get(transcriptKey(bvid, cid, activeLan), null)
    : null;
  if (!record?.segments?.length) {
    record = await fetchTranscriptFromServer(bvid, cid, aid, activeLan, page);
  }
  const segments = record?.segments || [];
  if (!segments.length) {
    throw new Error("该视频没有字幕，无法标记");
  }

  // 轻量标记：直接记下当前句原文，不调用 AI
  const { before, target, after } = buildNoteContext(segments, time);
  const text = String(target?.content ?? "").trim() ||
    segmentsToText([...before, target, ...after]);
  if (!text) {
    throw new Error("这个时间点附近没有字幕内容");
  }

  const { note } = await handleSaveNote({
    videoId: bvid,
    timestamp: time,
    videoTitle,
    author,
    page,
    text: text.slice(0, 3000),
  });
  // 通知侧边栏刷新（侧边栏未打开时忽略失败）
  chrome.runtime.sendMessage({ action: "noteSaved", note }).catch(() => {});
  return { note };
}

async function handleGetNotes(videoId) {
  if (!videoId) return [];
  return store.get(notesKey(videoId), []);
}

async function handleGetAllNotes() {
  const all = await chrome.storage.local.get(null);
  const notes = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith("notes:") && Array.isArray(value)) {
      notes.push(...value);
    }
  }
  notes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { notes: notes.slice(0, 200) };
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
  const current = await getSettings();
  const merged = mergeSettings(current, settings);
  await store.set("settings", merged);
  return merged;
}

async function handleTestApiKey({ apiKey, baseUrl, model }) {
  const config = normalizeProviderConfig({
    aiApiKey: apiKey,
    aiBaseUrl: baseUrl,
    aiModel: model,
  });
  if (!config.apiKey) {
    throw new Error("请先填写 API Key");
  }
  if (!config.baseUrl || !config.model) {
    throw new Error("请先填写接口地址和模型名");
  }
  const content = await requestAiCompletion(
    config,
    [{ role: "user", content: "请只回复两个字：正常" }],
    { timeoutMs: 30_000 },
  );
  return { text: content.trim() };
}

async function handleListModels({ apiKey, baseUrl }) {
  const config = normalizeProviderConfig({
    aiApiKey: apiKey,
    aiBaseUrl: baseUrl,
    aiModel: "",
  });
  if (!config.apiKey) {
    throw new Error("请先填写 API Key");
  }
  if (!config.baseUrl) {
    throw new Error("请先填写接口地址");
  }
  const models = await requestModelList(config);
  return { models };
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
      return await handleTestApiKey({
        apiKey: message.apiKey,
        baseUrl: message.baseUrl,
        model: message.model,
      });
    case "listModels":
      return await handleListModels({
        apiKey: message.apiKey,
        baseUrl: message.baseUrl,
      });
    case "getVideoInfo":
      return { info: await handleGetVideoInfo(message.bvid) };
    case "fetchTranscript":
      return await handleFetchTranscript({
        bvid: message.bvid,
        cid: message.cid,
        aid: message.aid,
        lan: message.lan,
        page: message.page,
      });
    case "translate":
      return await handleTranslate({
        bvid: message.bvid,
        cid: message.cid,
        lan: message.lan,
        segments: message.segments,
        targetLanguage: message.targetLanguage,
      });
    case "generateOverview":
      return await handleGenerateOverview({
        bvid: message.bvid,
        cid: message.cid,
        lan: message.lan,
        segments: message.segments,
        force: Boolean(message.force),
      });
    case "setActiveTrack": {
      const identity = await resolvePartIdentity(
        message.bvid,
        message.cid,
        message.aid,
        message.page,
      );
      await store.set(
        activeTrackKey(message.bvid, identity.cid),
        String(message.lan || ""),
      );
      return { ok: true };
    }
    case "explainSelection":
      return await handleExplain({ text: message.text, context: message.context });
    case "polishNote":
      return await handlePolishNote({ text: message.text });
    case "saveNote":
      return await handleSaveNote(message);
    case "captureNote":
      return await handleCaptureNote(message);
    case "getNotes":
      return { notes: await handleGetNotes(message.videoId) };
    case "getAllNotes":
      return await handleGetAllNotes();
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
