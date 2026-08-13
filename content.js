/**
 * Bili Digest 内容脚本。
 *
 * 运行在 B站视频页（bilibili.com/video/*）上，负责：
 * 1. 从页面读取视频上下文（BV 号、cid、标题、UP 主）；
 * 2. 在视频下方操作栏注入「精读」按钮，点击打开侧边栏；
 * 3. 响应侧边栏的时间戳跳转和当前播放时间查询；
 * 4. 显示笔记保存成功等轻量提示。
 */

const DEBUG = false;

const debugLog = (...args) => {
  if (DEBUG) console.log("[BiliDigest Content]", ...args);
};

let buttonHost = null;
let lastUrl = location.href;
let updateTimer = null;

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

  const author =
    document.querySelector(".up-name")?.textContent?.trim() ||
    document.querySelector(".up-info .name")?.textContent?.trim() ||
    videoData?.owner?.name ||
    "";

  return {
    bvid: getBvid(),
    cid: getCid(),
    aid: getAid(),
    title,
    author,
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
// body 下的独立宿主节点上，用 fixed 定位贴到视频操作栏旁边，
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
    button.style.background = "#009bd4";
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
 * 找一个可见的视频操作栏锚点。优先贴到右侧按钮组（投币/收藏/分享）左边，
 * 没有右侧组时退到整个操作栏的右端。
 */
function findToolbarAnchor() {
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const right = Array.from(document.querySelectorAll(".video-toolbar-right")).find(
    isVisible,
  );
  if (right) return { kind: "right", rect: right.getBoundingClientRect() };

  const container = Array.from(
    document.querySelectorAll(".video-toolbar, .video-toolbar-container"),
  ).find(isVisible);
  if (container) return { kind: "container", rect: container.getBoundingClientRect() };
  return null;
}

function updateButton() {
  if (!getBvid()) {
    if (buttonHost) buttonHost.style.display = "none";
    return;
  }

  const anchor = findToolbarAnchor();
  if (!anchor || anchor.rect.bottom < 64) {
    // 操作栏还没渲染，或已经滚到固定头部下方看不到：先隐藏
    if (buttonHost) buttonHost.style.display = "none";
    return;
  }

  const host = ensureButtonHost();
  const button = host.firstElementChild;
  const width = button.offsetWidth || 90;
  const height = button.offsetHeight || 32;
  const rawTop = anchor.rect.top + (anchor.rect.height - height) / 2;
  const top = Math.min(Math.max(rawTop, 64), window.innerHeight - height - 8);
  const left =
    anchor.kind === "right"
      ? anchor.rect.left - width - 8
      : anchor.rect.right - width - 8;
  host.style.top = `${top}px`;
  host.style.left = `${Math.max(8, left)}px`;
  host.style.display = "block";
}

function scheduleUpdate(delay = 100) {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    updateTimer = null;
    updateButton();
  }, delay);
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
  const background = kind === "error" ? "#e45d5d" : "#00aeec";
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
  window.addEventListener("scroll", () => scheduleUpdate(100), { passive: true });
  window.addEventListener("resize", () => scheduleUpdate(100), { passive: true });
  watchNavigation();
  updateButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
