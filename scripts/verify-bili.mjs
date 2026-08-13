/**
 * B站接口链路自检（开发用）。
 *
 * 用法：
 *   node scripts/verify-bili.mjs BV1xxxxxxxx
 *
 * 可选：通过环境变量 BILI_SESSDATA 提供登录 cookie，验证「登录后能拿到字幕」。
 * 注意：cookie 只在本机进程内使用，不会写出或打印。
 */

import { encWbi, getMixinKey, extractWbiKey } from "../lib/wbi.js";
import { pickChineseTrack, parseSubtitleJson, normalizeSubtitleUrl } from "../lib/subtitle.js";

const bvid = process.argv[2];
if (!bvid) {
  console.error("用法：node scripts/verify-bili.mjs <BV号>");
  process.exit(1);
}

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Referer: "https://www.bilibili.com/",
};

async function getJson(url) {
  const response = await fetch(url, { headers, credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function signedGet(path, params, mixinKey) {
  const { w_rid, wts } = await encWbi(params, mixinKey);
  const qs = new URLSearchParams({ ...params, w_rid, wts });
  return getJson(`https://api.bilibili.com${path}?${qs.toString()}`);
}

// 1. 登录 cookie（可选）
if (process.env.BILI_SESSDATA) {
  headers.Cookie = `SESSDATA=${process.env.BILI_SESSDATA}`;
  console.log("[1] 已检测到 SESSDATA，将验证登录态下的字幕链路");
} else {
  console.log("[1] 未提供 SESSDATA，只验证签名与接口连通性");
}

// 2. WBI 密钥
const nav = await getJson("https://api.bilibili.com/x/web-interface/nav");
const imgUrl = nav?.data?.wbi_img?.img_url;
const subUrl = nav?.data?.wbi_img?.sub_url;
if (!imgUrl || !subUrl) throw new Error("nav 接口未返回 wbi_img");
const mixinKey = getMixinKey(extractWbiKey(imgUrl), extractWbiKey(subUrl));
console.log("[2] WBI mixinKey:", mixinKey.slice(0, 8) + "…");

// 3. 视频信息
const view = await signedGet("/x/web-interface/wbi/view", { bvid }, mixinKey);
if (view.code !== 0) throw new Error(`view 接口错误 ${view.code}：${view.message}`);
const cid = view.data.cid;
console.log(`[3] 视频：${view.data.title}`);
console.log(`    UP：${view.data.owner?.name}，cid=${cid}，时长=${view.data.duration}s`);

// 4. 字幕轨道
const player = await signedGet("/x/player/wbi/v2", { bvid, cid }, mixinKey);
if (player.code !== 0) throw new Error(`player 接口错误 ${player.code}：${player.message}`);
const tracks = player?.data?.subtitle?.subtitles || [];
console.log(`[4] 字幕轨道数：${tracks.length}`);
for (const track of tracks) {
  console.log(`    lan=${track.lan} lan_doc=${track.lan_doc}`);
}

if (tracks.length === 0) {
  console.log("[!] 没有字幕轨道。原因通常是：未登录，或该视频本身没有字幕。");
  console.log("    提供 BILI_SESSDATA 后重试，可区分两种情况。");
  process.exit(0);
}

// 5. 下载字幕 JSON
const track = pickChineseTrack(tracks);
const url = normalizeSubtitleUrl(track.subtitle_url);
const subtitleJson = await getJson(url);
const segments = parseSubtitleJson(subtitleJson);
console.log(`[5] 选中轨道：${track.lan}（${track.lan_doc}），解析出 ${segments.length} 条字幕`);
if (segments[0]) {
  console.log(`    示例：[${segments[0].from}s] ${segments[0].content.slice(0, 40)}`);
}
