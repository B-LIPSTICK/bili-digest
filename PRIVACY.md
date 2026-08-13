# 隐私说明

Bili Digest 以「本地优先、最小数据外发」为原则。

## 数据保存在哪里

- DeepSeek API Key、目标语言等设置：保存在 Chrome 的 `chrome.storage.local`（本机）；
- 字幕、翻译、概览的缓存：保存在 `chrome.storage.local`；
- 笔记：保存在 `chrome.storage.local`；
- B站登录 cookie：扩展**从不读取、复制或保存**。浏览器在请求 B站域名时自动携带，这是浏览器的标准行为。

## 数据发到哪里

| 数据 | 接收方 | 用途 |
| --- | --- | --- |
| 视频 BV 号、cid | `api.bilibili.com` | 获取视频信息与字幕轨道列表 |
| 字幕文件请求 | `aisubtitle.hdslb.com` | 下载字幕 JSON |
| 字幕文本 / 你选中的文本 | `api.deepseek.com` | 翻译、概览、逐句解释 |

扩展直接调用上述服务，不经过任何第三方中转服务器。

## 不会发生什么

- 没有账号系统，不收集邮箱、手机号或个人信息；
- 没有广告 SDK、统计 SDK、崩溃上报或遥测；
- 不读取其他网站的页面内容或浏览历史。

DeepSeek 与 B站会依据各自的隐私政策处理收到的请求数据。请分别阅读它们的隐私政策。
