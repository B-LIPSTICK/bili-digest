# AGENTS.md — Bili Digest 开发协作规则

> 本文件是给所有 AI 协作代理（DeepSeek Harness / Codex / Copilot / Cursor 等）的项目约定。
> 优先级：本文件（红线） > `待办.md`（状态入口） > 会话上下文。
> **会话恢复第一步：读本文件与 `待办.md`，再确认 `git status`。**

## 会话协议

- 每次会话开始：读本文件 + `待办.md`，确认工作区与分支状态，再动手。
- 每个工作块结束：更新 `待办.md`（本块完成 / 决策 / 新事实 / 下一步）+ 中文描述性 git commit。
- `待办.md` 是唯一状态入口，状态不要散落在多个文档或多轮对话里。

## 黄金法则

- **杜绝臆想，严格循证**：禁止编造 API、URL、函数名、模型名、参数；先查证（官方文档优先）再写代码。
- 缺失信息明确指出并主动索要，不猜测补全。
- 优先复用现有代码、规范与架构（`lib/` 模块、`tests/` 单测、`prompts/` 模板）。
- 硬约束用代码核算，不目测（字数、大小、页数等数值约束交付前精确验证）。

## 工程约束（违反会导致扩展损坏，勿改）

- Manifest V3 Service Worker：**禁止动态 `import()`**、禁止 Node API；代码须纯浏览器 / SW 兼容（无构建步骤）。
- B站页面是 Vue SSR：**严禁向 B站自己管理的 DOM 插节点**，否则 hydration 冲突导致顶部导航消失；注入按钮必须挂 body 下的独立宿主做 fixed 定位。
- 流式长连接在 SW 中不可靠：对话流式由侧边栏页面直连 AI 接口，后台不参与转发。
- B站接口请求必须带浏览器头、`Accept-Language: zh-CN`、`Cache-Control/Pragma`、`referrer=https://www.bilibili.com/`，否则易被 412 拦截。
- 字幕接口未登录返回空列表（靠浏览器 cookie 自动携带；扩展不主动读 cookie）。
- 无构建步骤：纯 HTML/CSS/JS，Node 仅用于测试。新增 / 删除文件必须同步 `scripts/check.js` 的文件清单。

## 产品约束（用户红线）

- **AI 生成必须手动触发**，绝不自动调用（翻译、概览、润色、问答都要用户点按钮）。
- UI 风格：B站配色（蓝 `#00AEEC` / 粉 `#FB7299`），日间/夜间主题。**禁止**：过度设计、渐变、玻璃拟态、霓虹、发光、噪点、大量动画。空状态用 SVG 矢量图标，**不用 emoji**。**不用小电视 logo（侵权风险）**。
- 排版细节是验收红线：对话序号递增、无多余空行、无透视 / 重叠；被用户指出的渲染问题必须修到满意为止。
- 按钮位置敏感：「精读」「标记」按钮位置历经多轮调整（标题右侧 / 弹幕区旁 / 分享右 / 右上角 / 全屏右上角），改动需谨慎并说明理由。

## 交付纪律

- 小步提交：每个稳定变更一次独立 commit，message 用中文描述意图；用户说「提交吧 / 推送吧」再推送。
- 每次变更后跑 `npm test`、`npm run check`（打包场景再 `npm run package`）。
- 无法真实测试的部分（Chrome 实测、真实 API Key 连通性）明确告知需人工验证，不假装测过。
- 所有响应用中文（代码注释与技术术语除外）。
- 敏感信息（API Key、SESSDATA、cookie）绝不写入文件、聊天或任何公开位置。

## 命令速查

- `npm test`：单元测试（`node --test tests/*.test.js`）
- `npm run check`：静态检查（manifest、文件完整性、JS 语法）
- `npm run package`：打包 `dist/bili-digest-vX.Y.Z.zip`
- `npm run verify-bili -- BV1xxxx`：字幕接口自检（可选 `$env:BILI_SESSDATA=...`，仅本机进程内使用，勿外泄）
- 打包脚本为 PowerShell（Windows 环境）
