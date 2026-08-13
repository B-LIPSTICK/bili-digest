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

let digestButton = null;
let lastUrl = location.href;
let reconcileTimer = null;

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
  const videoData = window.__INITIAL_STATE__?.videoData;
  const cid = playinfo?.data?.cid ?? videoData?.cid ?? 0;
  return Number(cid) || 0;
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
// ============================================================

function findToolbar() {
  const candidates = Array.from(
    document.querySelectorAll(
      ".video-toolbar, #toolbar, .video-toolbar-container",
    ),
  );
  return (
    candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    }) || null
  );
}

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
    margin-left: 12px;
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

function injectDigestButton() {
  if (!getBvid()) {
    digestButton?.remove();
    digestButton = null;
    return;
  }

  const toolbar = findToolbar();
  if (!toolbar) {
    debugLog("操作栏尚未渲染，稍后重试");
    return;
  }

  if (!digestButton || !digestButton.isConnected) {
    digestButton = createDigestButton();
  }

  const rightGroup = toolbar.querySelector(".toolbar-right");
  if (rightGroup) {
    rightGroup.insertBefore(digestButton, rightGroup.firstChild);
  } else if (digestButton.parentElement !== toolbar) {
    toolbar.appendChild(digestButton);
  }
}

function scheduleReconcile(delay = 100) {
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    injectDigestButton();
  }, delay);
}

// ============================================================
// SPA 导航监听（B站切视频不刷新页面）
// ============================================================

function watchNavigation() {
  const check = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      debugLog("URL 变化，重新注入按钮");
      scheduleReconcile(500);
    }
  };

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    check();
  };
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    check();
  };
  window.addEventListener("popstate", check);

  // 兜底轮询：B站部分导航不走 history API
  setInterval(check, 1000);
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
  injectDigestButton();
  watchNavigation();
  const observer = new MutationObserver(() => scheduleReconcile(200));
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
