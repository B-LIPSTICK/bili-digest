/**
 * Bili Digest 内容脚本。
 *
 * 运行在 B站视频页（bilibili.com/video/*）上，负责：
 * 1. 从页面读取视频上下文（BV 号、cid、标题、UP 主）；
 * 2. 在视频标题右侧注入「精读」按钮，点击打开侧边栏；
 * 3. 响应侧边栏的时间戳跳转和当前播放时间查询；
 * 4. 显示笔记保存成功等轻量提示。
 */

const DEBUG = false;

const debugLog = (...args) => {
  if (DEBUG) console.log("[BiliDigest Content]", ...args);
};

let buttonHost = null;
let noteButtonHost = null;
let noteSaving = false;
let noteKeyboardListenerAdded = false;
let lastUrl = location.href;
let updateTimer = null;
let buttonAnchorKey = "";
let buttonShowTimer = null;

// ============================================================
// 视频上下文
// ============================================================

function getBvid() {
  const match = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
  if (match) return match[1];
  return new URLSearchParams(location.search).get("bvid") || "";
}

function getCid() {
  const playinfo = window.__playinfo__;
  const state = window.__INITIAL_STATE__ || {};
  const videoData = state.videoData || {};
  const pageParam = Number(new URLSearchParams(location.search).get("p")) || 0;

  let cid = playinfo?.data?.cid ?? videoData?.cid ?? state.cid ?? 0;
  if (!cid && Array.isArray(videoData.pages)) {
    const page =
      pageParam > 0
        ? videoData.pages[pageParam - 1] || videoData.pages[0]
        : videoData.pages[0];
    cid = page?.cid ?? 0;
  }
  return Number(cid) || 0;
}

function getAid() {
  const state = window.__INITIAL_STATE__ || {};
  const videoData = state.videoData || {};
  return Number(videoData?.aid ?? state.aid) || 0;
}

function getVideoContext() {
  const videoData = window.__INITIAL_STATE__?.videoData;
  const video = document.querySelector("video");

  const title =
    document.querySelector("h1.video-title")?.textContent?.trim() ||
    document.querySelector(".video-info h1")?.textContent?.trim() ||
    document.querySelector("#viewbox_report h1")?.textContent?.trim() ||
    videoData?.title ||
    document.title.replace(/[_\-—].*哔哩哔哩.*$/, "").trim() ||
    "";

  const authorElement =
    document.querySelector(".up-name") ||
    document.querySelector(".up-info .name");
  const author =
    (authorElement?.textContent || "").trim() ||
    videoData?.owner?.name ||
    "";
  const authorMid =
    Number(videoData?.owner?.mid) ||
    Number(window.__INITIAL_STATE__?.upInfo?.mid) ||
    Number(window.__INITIAL_STATE__?.upData?.mid) ||
    Number(
      authorElement?.closest("a")?.href?.match(/space\.bilibili\.com\/(\d+)/)?.[1],
    ) ||
    0;

  return {
    bvid: getBvid(),
    cid: getCid(),
    aid: getAid(),
    title,
    author,
    authorMid,
    currentTime: video ? Math.floor(video.currentTime) : 0,
    paused: video ? video.paused : true,
  };
}

// ============================================================
// 消息处理
// ============================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case "getVideoContext":
      sendResponse(getVideoContext());
      return false;
    case "getCurrentTime": {
      const video = document.querySelector("video");
      sendResponse({
        currentTime: video ? Math.floor(video.currentTime) : 0,
        paused: video ? video.paused : true,
      });
      return false;
    }
    case "seekTo": {
      seekToTimestamp(message.seconds);
      sendResponse({ success: true });
      return false;
    }
    case "showToast": {
      showToast(message.text, message.kind);
      sendResponse({ success: true });
      return false;
    }
    default:
      sendResponse({ success: false, error: "未知操作" });
      return false;
  }
});

function seekToTimestamp(seconds) {
  const video = document.querySelector("video");
  if (!video) return;
  video.currentTime = Math.max(0, Number(seconds) || 0);
  if (video.paused) {
    video.play().catch(() => {
      // 浏览器自动播放策略可能拒绝，忽略即可
    });
  }
}

// ============================================================
// 「精读」按钮注入
//
// 注意：B站整个页面（含顶部导航）由 Vue 服务端渲染并 hydration。
// 按钮不能插进 B站自己管理的节点里，否则会产生 hydration 冲突，
// 极端情况下会触发整页重渲染、顶部导航消失。这里改为把按钮挂在
// body 下的独立宿主节点上，用 fixed 定位到视频标题右侧，
// B站的重渲染永远不会碰到它。
// ============================================================

function createDigestButton() {
  const button = document.createElement("button");
  button.id = "bili-digest-button";
  button.type = "button";
  button.title = "打开 Bili Digest";
  button.textContent = "精读";

  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0 16px;
    border: none;
    border-radius: 16px;
    background: #00aeec;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    flex: 0 0 auto;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
    transition: background 0.15s ease, transform 0.1s ease;
  `;

  button.addEventListener("mouseenter", () => {
    button.style.background = "#00a1d6";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "#00aeec";
  });
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const result = await chrome.runtime.sendMessage({ action: "openSidePanel" });
      if (result && result.opened === false) {
        showToast(result.hint || "请点击浏览器工具栏上的 Bili Digest 图标");
      }
    } catch (error) {
      console.error("[BiliDigest] 打开侧边栏失败", error);
      showToast("打开侧边栏失败，请点击浏览器工具栏上的 Bili Digest 图标");
    }
  });

  return button;
}

function ensureButtonHost() {
  if (buttonHost?.isConnected) return buttonHost;
  buttonHost = document.createElement("div");
  buttonHost.id = "bili-digest-button-host";
  buttonHost.style.cssText = "position: fixed; z-index: 9998; display: none;";
  buttonHost.appendChild(createDigestButton());
  (document.body || document.documentElement).appendChild(buttonHost);
  return buttonHost;
}

/**
 * 找视频标题作为锚点，把按钮放在标题右侧。
 * 标题区布局稳定，不会像操作栏那样被晚加载的按钮挤动。
 */
function findTitleAnchor() {
  const selectors = ["h1.video-title", ".video-info h1", "#viewbox_report h1"];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0) {
      return { rect };
    }
  }
  return null;
}

function positionButton(host, anchor) {
  const button = host.firstElementChild;
  const width = button.offsetWidth || 90;
  const height = button.offsetHeight || 32;
  const rawTop = anchor.rect.top + (anchor.rect.height - height) / 2;
  const top = Math.min(Math.max(rawTop, 64), window.innerHeight - height - 8);
  const left = Math.min(anchor.rect.right + 8, window.innerWidth - width - 12);
  host.style.top = `${top}px`;
  host.style.left = `${Math.max(8, left)}px`;
  host.style.display = "block";
}

function updateButton() {
  if (!getBvid()) {
    buttonAnchorKey = "";
    if (buttonShowTimer) clearTimeout(buttonShowTimer);
    if (buttonHost) buttonHost.style.display = "none";
    return;
  }

  const anchor = findTitleAnchor();
  if (!anchor || anchor.rect.bottom < 64) {
    // 标题还没渲染，或已经滚到固定头部下方看不到：先隐藏
    buttonAnchorKey = "";
    if (buttonShowTimer) clearTimeout(buttonShowTimer);
    if (buttonHost) buttonHost.style.display = "none";
    return;
  }

  const host = ensureButtonHost();
  const key = `${Math.round(anchor.rect.left)}:${Math.round(anchor.rect.top)}:${Math.round(anchor.rect.right)}`;
  if (host.style.display === "none") {
    // 首次出现前，等标题位置连续稳定一小段时间，避免闪跳。
    if (key !== buttonAnchorKey) {
      buttonAnchorKey = key;
      if (buttonShowTimer) clearTimeout(buttonShowTimer);
      buttonShowTimer = setTimeout(() => {
        buttonShowTimer = null;
        updateButton();
      }, 1500);
      return;
    }
  }

  positionButton(host, anchor);
}

function scheduleUpdate(delay = 100) {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    updateTimer = null;
    updateButton();
  }, delay);
}

// ============================================================
// 「标记」悬浮按钮 + N 快捷键
//
// 与「精读」按钮同理：挂在 body 下，不进入 B站 Vue 管理的 DOM。
// 点击或按 N 时，把「刚才这句话」（当前时间往前 3 秒）交给后台，
// 由后台直接保存为带时间戳的标记，不调用 AI。
// ============================================================

function ensureNoteButtonHost() {
  if (noteButtonHost?.isConnected) return noteButtonHost;
  noteButtonHost = document.createElement("div");
  noteButtonHost.id = "bili-digest-note-button-host";
  noteButtonHost.style.cssText =
    "position: fixed; top: 80px; right: 16px; z-index: 9998; display: none;";

  const button = document.createElement("button");
  button.id = "bili-digest-note-button";
  button.type = "button";
  button.title = "标记当前播放位置（快捷键 N）";
  button.textContent = "标记";
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 14px;
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 15px;
    background: #fb7299;
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
    transition: background 0.15s ease;
  `;
  button.addEventListener("mouseenter", () => {
    button.style.background = "#f25d8a";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "#fb7299";
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    captureCurrentNote();
  });

  noteButtonHost.appendChild(button);
  (document.body || document.documentElement).appendChild(noteButtonHost);
  return noteButtonHost;
}

function updateNoteButton() {
  const video = document.querySelector("video");
  const visible = Boolean(getBvid() && video);
  if (!visible) {
    if (noteButtonHost) noteButtonHost.style.display = "none";
    return;
  }
  ensureNoteButtonHost().style.display = "block";
}

async function captureCurrentNote() {
  if (noteSaving) return;
  const context = getVideoContext();
  if (!context.bvid) return;

  const video = document.querySelector("video");
  // 用户反应过来再点按钮时，真正想记的是几秒前那句，往前回退 3 秒
  const seconds = Math.max(0, Math.floor((video?.currentTime ?? 0)) - 3);

  noteSaving = true;
  const button = noteButtonHost?.firstElementChild;
  const originalText = button?.textContent;
  if (button) button.textContent = "保存中…";

  try {
    const result = await chrome.runtime.sendMessage({
      action: "captureNote",
      bvid: context.bvid,
      cid: context.cid,
      aid: context.aid,
      seconds,
      videoTitle: context.title,
      author: context.author,
    });
    if (!result || result.success === false) {
      throw new Error(result?.error || "保存失败");
    }
    showToast(`已标记：${String(result.note?.text || "").slice(0, 42)}`);
  } catch (error) {
    showToast(`标记失败：${error.message}`, "error");
  } finally {
    noteSaving = false;
    if (button) button.textContent = originalText;
  }
}

function handleNoteKeyboardShortcut(event) {
  if (event.key && event.key.toLowerCase() !== "n") return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable)
  ) {
    return;
  }
  event.preventDefault();
  captureCurrentNote();
}

// ============================================================
// SPA 导航监听（B站切视频不刷新页面）
// ============================================================

function watchNavigation() {
  const check = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      debugLog("URL 变化，重新定位按钮");
      scheduleUpdate(500);
    }
  };

  window.addEventListener("popstate", check);

  // 兜底轮询：B站部分导航不走 history API
  setInterval(() => {
    check();
    updateButton();
    updateNoteButton();
  }, 1000);
}

// ============================================================
// 轻提示
// ============================================================

function showToast(text, kind = "info") {
  document.getElementById("bili-digest-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "bili-digest-toast";
  toast.textContent = text;
  const background = kind === "error" ? "#f85a54" : "#00aeec";
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    max-width: 360px;
    padding: 12px 18px;
    border-radius: 10px;
    background: ${background};
    color: #fff;
    font-size: 13px;
    line-height: 1.5;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ============================================================
// 初始化
// ============================================================

function init() {
  if (!noteKeyboardListenerAdded) {
    document.addEventListener("keydown", handleNoteKeyboardShortcut);
    noteKeyboardListenerAdded = true;
  }
  window.addEventListener("scroll", () => scheduleUpdate(100), { passive: true });
  window.addEventListener("resize", () => scheduleUpdate(100), { passive: true });
  watchNavigation();
  updateButton();
  updateNoteButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
