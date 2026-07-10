# Social Post Pack

发布时间机：录好 `docs/DEMO_SCRIPT.md` 里的 Demo C 后再发。没有视频时只发图文，转化会弱很多。

## 小红书图文

标题备选：

- 我做了一个让 Claude / Cursor 共用同一份本地记忆的工具
- AI 记忆不应该锁在某一家产品里
- 用 MCP 做了一个本地长期记忆层，所有 AI 都能读

正文：

现在每个 AI 都开始做“记忆”，但最大的问题是：各记各的。

ChatGPT 记住的，Claude 不知道；Claude Code 里刚讨论过的项目，Cursor 又要重新解释一遍。更麻烦的是，这些记忆大多存在别人服务器上，换工具就断，迁移也麻烦。

所以我做了 Omni-Context：一个本地运行的 AI 长期记忆层。

它把项目决策、聊天结论、知识点抽成一张本地知识图谱，然后通过 MCP 给 Claude、Cursor、Claude Code 等工具读取。同一份记忆，多个 AI 都能用。

这次更新我重点补了三个闭环：

1. AI 洞见不再只是提醒，会直接给可处理的整理任务。
2. 核心原则过多时，可以一键降级低引用原则，不会删除内容。
3. 数据可以导出成 Obsidian vault，能迁走，不被产品锁住。

我知道它还不是大众产品，但对同时使用多个 AI 工具、又在意本地数据的人来说，这个方向我觉得是成立的。

关键词：本地优先、MCP、AI 记忆、知识图谱、Obsidian

## 知乎文章结构

标题：

`为什么 AI 记忆不应该只属于某一家产品？我做了一个本地 MCP 记忆层`

大纲：

1. 先讲现实痛点：多 AI 工具并行，记忆割裂，反复复制背景。
2. 讲大厂为什么很难做中立记忆：中立会削弱生态锁定，本地会削弱云端数据沉淀。
3. 讲 Omni-Context 的方案：本地 SQLite + 知识图谱 + MCP。
4. 展示 Demo C：A 工具写入，B 工具读取，桌面端整理，Obsidian 导出。
5. 坦诚边界：不是替代 Obsidian，也不是自动 agent；它只做“所有 AI 共用的本地记忆层”。
6. 邀请反馈：尤其是多 AI 工具用户、MCP 用户、本地优先用户。

## GitHub Release / README 更新重点

- 第一屏不要讲“AI 记忆操作系统”，改成“Local shared memory for Claude, Cursor, Claude Code, and any MCP client”。
- 放 Demo C 视频或 GIF。
- 三个 bullet：
  - Shared memory across MCP clients
  - Actionable AI insights and memory curation
  - Local-first data with Obsidian vault export
- 明确数据位置和隐私：local SQLite, no account, no cloud required.

## 录屏检查

- 桌面端 Brain Server 状态必须是在线。
- 洞见卡片里要能看到具体数量和候选样例。
- 记忆管理里要出现“一键降到约 30 条”。
- MCP 客户端回答里要出现真实项目词，不要只回答泛泛的原则。
- 导出镜头要展示 Markdown 文件夹或 Obsidian vault，而不是只说“可以导出”。
