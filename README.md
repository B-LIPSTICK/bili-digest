<div align="center">

<img src="icons/icon128.png" width="96" alt="Bili Digest 哔哩精读图标">

# Bili Digest 哔哩精读

> 把每一个 B站视频，变成一份可以深度学习的资料。

Bili Digest 是一个 Chrome 侧边栏扩展：在你看 B站视频的同时，把**字幕、双语对照、AI 概览、逐句解释和带时间戳的笔记**全部收进侧边栏，不用离开视频页面，也不丢失学习进度。

![Manifest V3](https://img.shields.io/badge/Manifest-V3-00aeec?style=flat-square)
![License MIT](https://img.shields.io/badge/License-MIT-fb7299?style=flat-square)
![BYOK](https://img.shields.io/badge/API-自带密钥-8a9aa8?style=flat-square)
![Chrome](https://img.shields.io/badge/Chrome-%E2%89%A5116-4285f4?style=flat-square)

</div>

---

## 功能

- 把字幕变成可阅读、可点击跳转的学习文本
- 日间 / 夜间主题一键切换，整套界面用 B站品牌配色
- 原文 / 双语两种视图（双语可一键隐藏原文只看译文），默认中文译英文，目标语言可配置
- 字幕一键复制全文，导出为 Markdown（含视频简介、概览、双语字幕、笔记）
- AI 生成内容概要、章节划分、复习要点和原文金句
- 点任意一条字幕，让 AI 解释它的含义和背景
- 看视频时点右上角「标记」或按 N：把当前句原文存为带时间戳的标记，不调用 AI，不用暂停视频
- 笔记支持手写 + AI 润色，可复制文本 / 复制时间戳链接 / 一键回到视频位置，还能切换查看当前视频或全部视频的笔记
- 「对话」页：基于当前视频的字幕和 AI 流式问答，回答只依据字幕、不编造，对话记录可导出 Markdown
- 自带密钥（BYOK）：一个「OpenAI 兼容」入口，OpenAI、Anthropic、DeepSeek、Kimi、GLM、通义千问、本地模型都能接

## 截图

安装并登录后，把各页截图放进 `screenshots/` 目录再在这里引用。建议至少覆盖：双语字幕、AI 概览、视频对话、笔记列表、设置页。

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

AI 功能（翻译、概览、逐句解释、笔记润色、视频问答）需要你自己的 API Key。设置页只提供一个「OpenAI 兼容」入口：填接口地址、模型名和 Key，任何兼容 Chat Completions 的服务都能用：

1. 到对应平台注册并创建 API Key；
2. 在扩展侧边栏的「设置」页填入接口地址、模型和 Key（或右键扩展图标 → 选项）；
3. 点「测试连接」确认可用。

说明：Anthropic 用的是官方 OpenAI SDK 兼容端点（官方标注为测试用途，按正常价格计费）；扩展会按接口地址自动带上各家需要的参数，例如 DeepSeek 的非思考模式。**不要把 Key 贴进聊天、截图或任何公开的地方。**

## 使用前提

- Chrome 116 或更新版本；
- 在 `bilibili.com` 处于**登录状态**。B站的网页端字幕接口只对登录用户返回字幕列表。扩展不会读取或保存你的登录信息，只是由浏览器在请求时自动携带；
- 视频本身要有字幕。B站部分视频（尤其较老的搬运视频）没有 CC 字幕或 AI 字幕，这类视频无法提取字幕。Shorts、直播、番剧页不在支持范围内。

## 使用

1. 打开一个带字幕的 B站视频（`bilibili.com/video/...`）；
2. 点击工具栏的「精读」按钮或扩展图标打开侧边栏；
3. 「字幕」页：点时间戳跳转，切换原文 / 双语（双语可隐藏原文只看译文），悬停某句点「解释」；切到双语不会自动翻译，点右上角「翻译」按钮才触发（结果会缓存复用），右上角还能复制全文或导出 Markdown；
4. 「概览」页：点「生成 AI 概览」才会调用 AI（不会自动生成），生成内容概要、章节、要点和金句，金句可复制或直接存为笔记，右上角可单独导出概览；
5. 记笔记：看视频时点右上角「标记」或按 N，把当前句原文存为带时间戳的标记；也可以在「笔记」页手写后点「AI 润色」；
6. 「笔记」页：切换「本视频 / 全部视频」，每条笔记都能复制文本、复制时间戳链接或一键回到对应位置；
7. 「对话」页：就视频字幕提问，AI 流式回答；对话按视频保存在本机，可随时导出 Markdown。

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
   字幕两视图 · 概览 · 笔记 · 对话 · 设置
```

说明：

- B站字幕接口返回 `subtitle_url`，指向一个字幕 JSON 文件，结构为 `{ body: [{ from, to, content }] }`，`from/to` 单位是秒；
- 字幕轨道的主来源是 `x/player/wbi/v2`（带 `aid+cid`，与播放页一致），失败时回退 `x/player/v2`；两者都失败才用 WBI 签名（`w_rid` + `wts`）兜底，签名实现有单元测试覆盖；
- 请求 B站接口时显式携带浏览器头、`zh-CN` 语言头和 `https://www.bilibili.com/` 的 Referer，避免被风控拦截；
- 字幕、概览、翻译都会缓存在本机 `chrome.storage.local`，重复观看不重复计费。

## 数据与隐私

- 字幕请求发给 B站（`api.bilibili.com`、`aisubtitle.hdslb.com`）；
- AI 请求发给你在设置中填写的接口地址，只发送字幕、你选中的文本、笔记草稿或对话所需的整段字幕；若使用「自定义」端点，数据直接发往你填写的地址，扩展不中转；
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
- 字幕内搜索与筛选
- 笔记导出为 Anki / CSV
- 词汇本（生词 + 例句 + 时间戳）
- 更多目标语言

## 许可证

[MIT](LICENSE)

## 致谢

- [zarazhangrui/youtube-digest](https://github.com/zarazhangrui/youtube-digest)：产品形态的灵感来源；
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)：B站接口的社区文档（该仓库已于 2026 年 1 月停止维护）。

## 友链

- [LINUX DO](https://linux.do)：开放的 Linux 与开发者社区，本项目在此发布与交流。

欢迎交换友链，感谢每一位愿意把项目分享出去的朋友。
