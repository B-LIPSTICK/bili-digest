/**
 * B站接口链路自检（开发用）。
 *
 * 用法：
 *   node scripts/verify-bili.mjs BV1xxxxxxxx
 *
 * 可选：通过环境变量 BILI_SESSDATA 提供登录 cookie，验证「登录后能拿到字幕」。
 * 注意：cookie 只在本机进程内使用，不会写出或打印。
 */

import { pickChineseTrack, parseSubtitleJson, normalizeSubtitleUrl } from "../lib/subtitle.js";
import { encWbi, getMixinKey, extractWbiKey } from "../lib/wbi.js";

const bvid = process.argv[2];
if (!bvid) {
  console.error("用法：node scripts/verify-bili.mjs <BV号>");
  process.exit(1);
}

async function getJson(url) {
  const cookies = [];
  if (process.env.BILI_BUVID3) cookies.push(`buvid3=${process.env.BILI_BUVID3}`);
  if (process.env.BILI_SESSDATA) cookies.push(`SESSDATA=${process.env.BILI_SESSDATA}`);
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      ...(cookies.length ? { Cookie: cookies.join("; ") } : {}),
    },
    referrer: "https://www.bilibili.com/",
    referrerPolicy: "strict-origin-when-cross-origin",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// 1. 登录 cookie（可选）
let buvid3 = process.env.BILI_BUVID3 || "";
if (!buvid3) {
  const spi = await getJson("https://api.bilibili.com/x/frontend/finger/spi");
  buvid3 = spi?.data?.b_3 || "";
  if (buvid3) process.env.BILI_BUVID3 = buvid3;
}
console.log(`[1] buvid3：${buvid3 ? "已获取" : "缺失"}，SESSDATA：${process.env.BILI_SESSDATA ? "已提供" : "未提供"}`);

if (process.env.BILI_SESSDATA) {
  console.log("    将验证登录态下的字幕链路");
} else {
  console.log("    未提供 SESSDATA，只能验证接口连通性（字幕列表预期为空）");
}

// 2. 视频信息：与扩展一致，用 WBI 签名的 view 接口
const nav = await getJson("https://api.bilibili.com/x/web-interface/nav");
const imgKey = extractWbiKey(nav?.data?.wbi_img?.img_url);
const subKey = extractWbiKey(nav?.data?.wbi_img?.sub_url);
const mixinKey = getMixinKey(imgKey, subKey);
const signed = await encWbi({ bvid }, mixinKey);
const viewQuery = new URLSearchParams({ bvid, w_rid: signed.w_rid, wts: String(signed.wts) });
const view = await getJson(
  `https://api.bilibili.com/x/web-interface/wbi/view?${viewQuery.toString()}`,
);
if (view.code !== 0) throw new Error(`view 接口错误 ${view.code}：${view.message}`);
const cid = view.data.cid;
const aid = String(view.data.aid || "");
console.log(`[2] 视频：${view.data.title}`);
console.log(`    UP：${view.data.owner?.name}，aid=${aid}，cid=${cid}，时长=${view.data.duration}s`);

// 3. 字幕轨道：主来源 wbi/v2（aid+cid），失败回退 player/v2
let player;
try {
  player = await getJson(
    "https://api.bilibili.com/x/player/wbi/v2" +
      `?aid=${encodeURIComponent(aid)}` +
      `&cid=${encodeURIComponent(cid)}` +
      `&bvid=${encodeURIComponent(bvid)}`,
  );
} catch (error) {
  console.log(`[3] 主来源失败（${error.message}），回退 player/v2`);
  player = await getJson(
    "https://api.bilibili.com/x/player/v2" +
      `?bvid=${encodeURIComponent(bvid)}` +
      `&cid=${encodeURIComponent(cid)}` +
      `&aid=${encodeURIComponent(aid)}`,
  );
}
if (player.code !== 0) throw new Error(`player 接口错误 ${player.code}：${player.message}`);
const tracks = player?.data?.subtitle?.subtitles || [];
console.log(`[3] 字幕轨道数：${tracks.length}`);
for (const track of tracks) {
  console.log(`    lan=${track.lan} lan_doc=${track.lan_doc}`);
}

if (tracks.length === 0) {
  console.log("[!] 没有字幕轨道。原因通常是：未登录，或该视频本身没有字幕。");
  console.log("    提供 BILI_SESSDATA 后重试，可区分两种情况。");
  process.exit(0);
}

// 4. 逐个轨道下载字幕 JSON，排查「切换语言没反应」
console.log("[4] 逐轨验证下载：");
for (const track of tracks) {
  const url = normalizeSubtitleUrl(track.subtitle_url);
  if (!url) {
    console.log(`    ${track.lan}（${track.lan_doc}）：没有 subtitle_url，跳过`);
    continue;
  }
  try {
    const subtitleJson = await getJson(url);
    const segments = parseSubtitleJson(subtitleJson);
    const sample = segments[0]
      ? `，示例：[${segments[0].from}s] ${segments[0].content.slice(0, 30)}`
      : "";
    console.log(
      `    ${track.lan}（${track.lan_doc}）：${segments.length} 条字幕${sample}`,
    );
  } catch (error) {
    console.log(
      `    ${track.lan}（${track.lan_doc}）：下载失败（${error.message}）`,
    );
  }
}

// 5. 扩展默认会选的轨道
const defaultTrack = pickChineseTrack(tracks);
console.log(
  `[5] 扩展默认选择：${defaultTrack?.lan}（${defaultTrack?.lan_doc}）`,
);
