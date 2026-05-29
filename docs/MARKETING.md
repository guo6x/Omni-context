# 宣传文案底稿 / Marketing Copy

> 草稿，供迭代。
>
> **核心定位（护城河）**：一份记忆，**跨所有 AI 通用**，且**只属于你**——这是任何一家大厂在利益上都不会给你的。
> 大厂的记忆只服务自家产品（锁定你），且存在他们云上（数据不归你）。Omni-Context 是中立的、本地的、归你所有的。
>
> 「本地知识图谱」「长期记忆」是机制，**「跨 AI 中立 + 数据自主」是卖点**。先喊卖点。

---

## 1. 一句话价值主张 / One-liner

**中文**

> 一份记忆，所有 AI 通用，且只属于你——这是任何一家大厂都不会给你的。

备选：
- 你的 AI 记忆，不该被某一家锁住。
- 把你的记忆从某家 AI 里解放出来：本地、跨工具、归你所有。

**English**

> One memory, every AI, owned by you — the one thing no AI vendor will ever give you.

Alt:
- Your AI memory shouldn't be trapped inside one vendor.
- A vendor-neutral, local memory layer for all your AI tools.

---

## 2. README / 落地页 Hero / Landing hero

**中文**

> 你的记忆被切成碎片，锁在各家 AI 里：ChatGPT 记住的，Claude 不知道；换个工具，又从零开始。而且这些记忆存在别人服务器上——**严格说，它们不归你。**
>
> **Omni-Context 把记忆从厂商手里拿回来。** 一张运行在你自己机器上的知识图谱，通过标准 MCP 协议同时挂给 Claude、Cursor、Cline 等 12+ 个 AI 客户端——**一份记忆，所有 AI 共享**，越用越懂你。
>
> 为什么大厂不会做这个？因为他们的生意是把你锁进自家生态、把数据放进自家云。**中立和本地，他们做不了，你才需要 Omni-Context。**
>
> 全本地 SQLite，无云端、无账号、无公网。**你的第二大脑，跨所有 AI，钥匙只在你手里。**

**English**

> Your memory is fragmented and locked inside each AI: what ChatGPT remembers, Claude has no idea about — switch tools and you start from zero. And it all lives on someone else's servers. **Strictly speaking, it isn't yours.**
>
> **Omni-Context takes memory back from the vendors.** A knowledge graph that runs on *your* machine and plugs into 12+ AI clients (Claude, Cursor, Cline…) over the standard MCP protocol — **one memory, shared across every AI**, getting smarter the more you use it.
>
> Why won't the big players build this? Because their business is locking you into their ecosystem and keeping your data in their cloud. **Neutral and local is exactly what they can't offer — and exactly why you need Omni-Context.**
>
> All local SQLite. No cloud, no account, no exposure. **Your second brain, across every AI — and you hold the only key.**

---

## 3. 发布帖 / Launch posts

### Show HN (English)

> **Show HN: Omni-Context – a vendor-neutral, local memory layer that any AI can share (MCP)**
>
> Every AI tool now has "memory" — but it's siloed (ChatGPT's memory doesn't help Claude) and it lives on their servers. I wanted one memory that works across all my tools and stays on my machine. So I built Omni-Context: a local-first knowledge graph that captures what I read/write, structures it into entities + relationships, and exposes it to any MCP client. I save something while using Cursor; later I ask Claude and it already knows.
>
> Everything runs locally — SQLite + on-device embeddings, no cloud, no account, no public endpoint. The graph is yours and portable. It also surfaces forgotten connections proactively.
>
> The bet: the big labs are structurally disincentivized to be neutral (they want lock-in) or local (they want your data in their cloud). That gap is the whole point.
>
> Desktop app (Win/macOS/Linux), browser extension, one-click MCP setup for verified clients. Feedback welcome — especially on the cross-tool flow.
>
> [repo link] · 60s demo: [link]

### 即刻 / V2EX（中文）

> **标题：做了个跨所有 AI 通用的本地记忆层——ChatGPT 和 Claude 终于能共享同一份记忆，还全在自己电脑上**
>
> 现在每个 AI 都有"记忆"了，但有两个问题：① 各记各的，ChatGPT 记的 Claude 不知道，换工具从零开始；② 都存在人家服务器上，严格说不归你。
>
> 所以做了 Omni-Context——一个**本地运行**的知识图谱。随手存的东西自动抽成「实体+关系」，通过 MCP 协议同时挂给 Claude、Cursor、Cline。我在一个工具里存的，换另一个工具问，它直接就知道。一份记忆，所有 AI 共享。
>
> 为什么大厂不做？因为中立 = 帮对手，本地 = 自断云生意。这俩他们结构上做不了，正好是我的活路。
>
> 全本地：SQLite + 本地向量，无云、无账号、不联网鉴权。数据归你、可带走。开源，求拍砖：[链接]

---

## 4. 渠道与节奏 / Channels

按低成本→高投入排，**只打对的人群（在意本地/数据自主、且同时用多个 AI 工具的开发者）**，不追大流量：

1. GitHub README 打磨（截图 + 60s 跨工具 demo GIF + 一键安装）
2. Show HN / Reddit（r/LocalLLaMA、r/selfhosted）/ V2EX / 即刻
3. MCP 生态目录收录（Claude / Cursor 社区的 MCP server 列表）——这里全是已经认同 MCP、最容易转化的人
4. 60–90 秒录屏（脚本见 `DEMO_SCRIPT.md`，主打 Demo B「瑞士时刻」）

文案铁律：
- 先喊**跨 AI 中立 + 数据归你**，再讲怎么做到（本地知识图谱）。
- 一定给**可复现的跨工具瞬间**（A 工具存、B 工具问、它知道）。
- **不要一上来列 14 个 MCP 工具**，没人关心。
- 主动点名"大厂给不了"——这是记忆点。
