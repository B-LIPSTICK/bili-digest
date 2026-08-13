# Bili Digest 哔哩精读

> 把每一个 B站视频，变成一份可以深度学习的资料。

Bili Digest 是一个 Chrome 侧边栏扩展：在你看 B站视频的同时，把**字幕、双语对照、AI 概览、逐句解释和带时间戳的笔记**全部收进侧边栏，不用离开视频页面，也不丢失学习进度。

- 把字幕变成可阅读、可点击跳转的学习文本
- 原文 / 译文 / 双语三种视图，默认中文译英文，目标语言可配置
- AI 生成内容概要、章节划分和复习要点
- 点任意一条字幕，让 AI 解释它的含义和背景
- 保存带时间戳的笔记，点击时间戳随时回到视频位置
- 自带密钥（BYOK）：使用你自己的 API Key，支持 DeepSeek、OpenAI、Kimi、GLM、通义千问和任意 OpenAI 兼容端点

## 截图

（占位：安装后截图放到 `screenshots/` 目录，并在这里引用）

## 为什么做这个项目

看视频学习有两个痛点：字幕一闪而过、知识不成体系。Bili Digest 把「看」变成「读」：字幕可以像文章一样翻阅，AI 帮你搭出知识骨架，笔记帮你沉淀复习。

这个项目的灵感来自 [zarazhangrui/youtube-digest](https://github.com/zarazhangrui/youtube-digest)（MIT 许可），但它是为 B站从零重写的：数据源换成 B站网页端字幕，不依赖任何第三方转写服务。

## 安装

1. 下载本仓库（Code → Download ZIP 或 `git clone`），解压到一个**长期保留**的目录；
2. 打开 Chrome，访问 `chrome://extensions`；
3. 打开右上角「开发者模式」；
4. 点「加载已解压的扩展程序」，选择包含 `manifest.json` 的目录；
5. 把扩展固定到工具栏。

注意：这是「加载已解压」方式安装的扩展，Chrome 不会自动更新。目录移动或删除后需要重新加载。

## 配置 AI 服务

AI 功能（翻译、概览、逐句解释）需要你自己的 API Key，可以任选一家：

| 服务商 | 接口地址 | 默认模型 | 申请入口 |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-flash` | [开放平台](https://platform.deepseek.com/) |
| OpenAI | `https://api.openai.com/v1` | `gpt-5.6-terra` | [开放平台](https://platform.openai.com/) |
| Moonshot Kimi | `https://api.moonshot.cn/v1` | `kimi-k3` | [开放平台](https://platform.moonshot.cn/) |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.2` | [开放平台](https://open.bigmodel.cn/) |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | [百炼控制台](https://dashscope.console.aliyun.com/) |
| 自定义 | 你填写 | 你填写 | 任意 OpenAI 兼容端点，如本地 Ollama、vLLM |

1. 到对应平台注册并创建 API Key；
2. 在扩展侧边栏的「设置」页选择服务商并粘贴 Key（或右键扩展图标 → 选项）；
3. 点「测试连接」确认可用。

预设服务商只需填 Key，接口地址和模型已按官方默认值预填，想换模型可以直接覆盖；选择「自定义」时需要同时填写接口地址、模型和 Key。**不要把 Key 贴进聊天、截图或任何公开的地方。**

## 使用前提

- Chrome 116 或更新版本；
- 在 `bilibili.com` 处于**登录状态**。B站的网页端字幕接口只对登录用户返回字幕列表。扩展不会读取或保存你的登录信息，只是由浏览器在请求时自动携带；
- 视频本身要有字幕。B站部分视频（尤其较老的搬运视频）没有 CC 字幕或 AI 字幕，这类视频无法提取字幕。Shorts、直播、番剧页不在支持范围内。

## 使用

1. 打开一个带字幕的 B站视频（`bilibili.com/video/...`）；
2. 点击工具栏的「精读」按钮或扩展图标打开侧边栏；
3. 「字幕」页：点时间戳跳转，切换原文 / 译文 / 双语，悬停某句点「解释」；
4. 「概览」页：生成内容概要、章节和要点；
5. 「笔记」页：写下想法，保存后自动带上当前播放位置。

## 工作原理

```text
B站视频页 (content.js)
   │  BV 号、cid、标题、播放进度
   ▼
后台服务 (background.js)
   │  WBI 签名 → x/player/wbi/v2 → 字幕轨道列表
   │  下载字幕 JSON（aisubtitle.hdslb.com）
   │  所选 AI 服务 → 翻译 / 概览 / 解释
   ▼
侧边栏 (sidepanel.*)
   字幕三视图 · 时间戳跳转 · 笔记 · 设置
```

说明：

- B站字幕接口返回 `subtitle_url`，指向一个字幕 JSON 文件，结构为 `{ body: [{ from, to, content }] }`，`from/to` 单位是秒；
- 字幕轨道的主来源是 `x/player/wbi/v2`（带 `aid+cid`，与播放页一致），失败时回退 `x/player/v2`；两者都失败才用 WBI 签名（`w_rid` + `wts`）兜底，签名实现有单元测试覆盖；
- 请求 B站接口时显式携带浏览器头、`zh-CN` 语言头和 `https://www.bilibili.com/` 的 Referer，避免被风控拦截；
- 字幕、概览、翻译都会缓存在本机 `chrome.storage.local`，重复观看不重复计费。

## 数据与隐私

- 字幕请求发给 B站（`api.bilibili.com`、`aisubtitle.hdslb.com`）；
- AI 请求发给你在设置中选择的服务商，只发送字幕或你选中的文本；若使用「自定义」端点，数据直接发往你填写的地址，扩展不中转；
- 没有账号系统、广告、埋点或遥测。详见 [PRIVACY.md](PRIVACY.md)。

## 费用

字幕提取免费。AI 功能按你选择的服务商定价计费，翻译只在你切换到译文视图时发生，且结果会缓存。各家的价格和优惠不同，请以对应的官方定价页为准（例如 [DeepSeek 定价页](https://api-docs.deepseek.com/quick_start/pricing)）。

## 字幕提取不出来？

1. 确认 Chrome 里 `bilibili.com` 处于**登录状态**，然后刷新视频页；
2. 确认这个视频**本身有字幕**（CC 字幕或 AI 字幕）。没有字幕的视频无法提取，这是 B站的数据限制；
3. 在项目目录运行自检脚本，能区分「接口不通」和「视频无字幕」：

   ```bash
   npm run verify-bili -- BV1xxxxxxxx
   # 带上登录态完整验证（SESSDATA 从浏览器开发者工具 Cookie 里复制，只在本机进程内使用）
   $env:BILI_SESSDATA="你的SESSDATA"; npm run verify-bili -- BV1xxxxxxxx
   ```

   PowerShell 用 `$env:BILI_SESSDATA=...`，macOS/Linux 用 `BILI_SESSDATA=... npm run verify-bili -- BV1xxxxxxxx`。不要把 SESSDATA 贴进聊天或公开仓库。

## 免责声明

- 本项目**仅供个人学习交流**，使用 B站网页端**公开可见**的接口，未修改、未绕过任何访问控制；
- B站接口与页面结构可能随时变化，导致扩展失效；如遇失效请更新到最新代码；
- 请遵守 B站用户协议与相关法律法规，不要将本项目用于商业用途或大规模抓取；
- 本项目与哔哩哔哩及各 AI 服务商均无隶属关系。

## 开发

纯 HTML / CSS / JavaScript，无构建步骤。Node.js 仅用于测试和检查。

```bash
npm test      # 单元测试（WBI 签名、字幕解析、AI 配置）
npm run check # 静态检查：manifest、文件完整性、JS 语法
npm run package # 打包成 dist/bili-digest-vX.Y.Z.zip
```

## 路线图

- 多 P 视频的分 P 切换
- 字幕跟随播放自动滚动
- 笔记导出为 Markdown / Anki
- 词汇本（生词 + 例句 + 时间戳）
- 更多目标语言

## 许可证

[MIT](LICENSE)

## 致谢

- [zarazhangrui/youtube-digest](https://github.com/zarazhangrui/youtube-digest)：产品形态的灵感来源；
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)：B站接口的社区文档（该仓库已于 2026 年 1 月停止维护）。
