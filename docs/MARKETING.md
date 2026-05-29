# 宣传文案底稿 / Marketing Copy

> 草稿，供迭代。对外定位：**给任何 AI 装一个有长期记忆的本地大脑，数据全在用户自己机器上。** 不罗列功能，先讲价值。

---

## 1. 一句话价值主张 / One-liner

**中文**

> 给任何 AI 装一个有长期记忆的本地大脑——你的数据，永远只在你自己机器上。

备选：
- 和 AI 聊过的东西，它不该转头就忘。
- 本地知识图谱，让任何 AI 记得住你、基于你的历史做判断。

**English**

> Give any AI a long-term memory it can reason over — and keep every byte on your own machine.

Alt: *Your AI forgets everything. This fixes that — locally.*

---

## 2. README / 落地页 Hero / Landing hero

**中文**

> 你每天喂给 AI 大量上下文，但它记不住。换个对话、换个工具，全忘了。
>
> **Omni-Context 是一个本地运行的知识图谱**：你在桌面、浏览器、手机上随手沉淀的信息，会被自动结构化成「实体 + 关系」，越用越懂你。通过标准 MCP 协议，Claude、Cursor、Cline 等 12+ 个 AI 客户端可以**即插即用**地接上这张图谱——从此它们记得住你的历史，并能据此做判断。
>
> 全本地 SQLite，无云端、无账号、无公网。**你的第二大脑，钥匙在你手里。**

**English**

> You feed your AI tons of context every day — and it forgets all of it the moment you switch chats or tools.
>
> **Omni-Context is a local knowledge graph.** Whatever you capture — from your desktop, browser, or phone — gets structured into entities and relationships that grow smarter over time. Through the standard MCP protocol, 12+ AI clients (Claude, Cursor, Cline…) plug straight in and finally **remember your history and reason over it.**
>
> All local SQLite. No cloud, no account, no exposure. **Your second brain — and you hold the only key.**

---

## 3. 发布帖 / Launch posts

### Show HN (English)

> **Show HN: Omni-Context – a local knowledge graph that gives any AI long-term memory (MCP)**
>
> I kept hitting the same wall: every AI tool I use forgets everything between sessions. So I built Omni-Context — a local-first knowledge graph that captures what I read/write, structures it into entities + relationships, and exposes it to any MCP client (Claude Desktop, Cursor, Cline, etc.). Now when I ask Cursor something, it can pull up the note I saved last week — automatically.
>
> Everything runs locally: SQLite + on-device embeddings, no cloud, no account, no public endpoint. The graph also surfaces forgotten connections proactively.
>
> Desktop app (Win/macOS/Linux), browser extension, one-click MCP setup for verified clients. Would love feedback on the capture→graph→retrieval loop.
>
> [repo link] · 90s demo: [link]

### 即刻 / V2EX（中文）

> **标题：做了个本地知识图谱，给 AI 装「长期记忆」，数据全在自己电脑上**
>
> 痛点很简单：我每天给 AI 喂一堆东西，它转头就忘。换个对话、换个工具，从零开始。
>
> 所以做了 Omni-Context——一个**本地运行**的知识图谱。我在电脑/浏览器/手机上随手存的东西，会自动抽成「实体+关系」，越用越懂我。然后通过 MCP 协议挂给 Claude、Cursor、Cline 这些客户端，它们就能直接调我这张图谱：上周看的资料、之前做过的决定，AI 现在都记得，还能据此帮我判断。
>
> 关键是**全本地**：SQLite + 本地向量，无云、无账号、不联网鉴权。数据主权在自己手里。
>
> 桌面端三平台 + 浏览器插件 + 验证过的客户端一键接入。开源，求拍砖：[链接]

---

## 4. 渠道与节奏 / Channels

按低成本→高投入排：

1. GitHub README 打磨（截图 + 30s GIF + 一键安装）
2. Show HN / Reddit（r/LocalLLaMA, r/selfhosted）/ V2EX / 即刻
3. MCP 生态目录收录（Claude / Cursor 社区的 MCP server 列表）
4. 90 秒录屏（脚本见 `DEMO_SCRIPT.md`）

文案原则：痛点 → 反差 → 可复现的 30 秒 demo → 本地/数据主权差异化。**不要一上来列 14 个 MCP 工具。**
