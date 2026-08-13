# 隐私说明

Bili Digest 以「本地优先、最小数据外发」为原则。

## 数据保存在哪里

- 所选 AI 服务商的 API Key、接口地址、模型名、目标语言等设置：保存在 Chrome 的 `chrome.storage.local`（本机）；
- 字幕、翻译、概览的缓存：保存在 `chrome.storage.local`；
- 笔记：保存在 `chrome.storage.local`；
- B站登录 cookie：扩展**从不读取、复制或保存**。浏览器在请求 B站域名时自动携带，这是浏览器的标准行为。

## 数据发到哪里

| 数据 | 接收方 | 用途 |
| --- | --- | --- |
| 视频 BV 号、cid | `api.bilibili.com` | 获取视频信息与字幕轨道列表 |
| 字幕文件请求 | `aisubtitle.hdslb.com` | 下载字幕 JSON |
| 字幕文本 / 你选中的文本 | 你在设置中选择的 AI 服务商（`api.deepseek.com` / `api.openai.com` / `api.moonshot.cn` / `open.bigmodel.cn` / `dashscope.aliyuncs.com`，或自定义端点） | 翻译、概览、逐句解释 |

扩展直接调用上述服务，不经过任何第三方中转服务器。

「自定义」端点的地址由你自己填写（例如本机的 Ollama），扩展会把字幕或选中文本直接发往该地址，不会中转或另存。为了支持任意兼容端点，扩展的 manifest 申请了访问所有 `https` 和 `http` 站点的权限——这只用于把请求发给你配置的地址，扩展本身不扫描或访问其它网站。

## 不会发生什么

- 没有账号系统，不收集邮箱、手机号或个人信息；
- 没有广告 SDK、统计 SDK、崩溃上报或遥测；
- 不读取其他网站的页面内容或浏览历史。

各 AI 服务商与 B站会依据各自的隐私政策处理收到的请求数据。请分别阅读它们的隐私政策。
