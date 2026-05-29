# Demo Scripts

两个版本，先拍 **Demo B**——它是传播主力（杀手锏），把"跨 AI 中立 + 数据归你"一镜讲清楚。Demo A 是更完整的"怎么用"解说版，适合 README / 落地页深度展示。

**通用录制**：[OBS Studio](https://obsproject.com/)（免费）或 [Loom](https://www.loom.com/)。1920x1080 @ 30fps。不用真人配音，加字幕即可。

---

## Demo B — 瑞士时刻（主推，~50s）

**目标**：一镜证明"我在一个 AI 工具里存的东西，换另一个 AI 工具能直接用"——这是任何大厂都给不了的。

**前置**：Omni-Context 运行中；**两个**不同的 MCP 客户端都已接入（推荐 Cursor + Claude Desktop）；图谱可以非空（已有一些你的真实内容更可信）。

### 00:00 — 痛点 (8s)

| 画面 | 动作 |
|------|------|
| 并排两个窗口：Cursor 和 Claude Desktop | 字幕：*"两个 AI，各记各的。一个知道的，另一个完全不知道。"* |

### 00:08 — 在 A 工具里"存" (15s)

| 画面 | 动作 |
|------|------|
| Cursor（或任意 MCP 客户端 A） | 正常对话中说一句结论性的话，比如："记住：这个项目我们最终决定用 SQLite 而不是 Postgres，因为要本地优先。" AI 调用 `save_conclusion` 把它写回图谱。 |

字幕：*"在 Cursor 里随手定了个决定——它被存进了我自己的本地图谱。"*

### 00:23 — 切到 B 工具直接问 (20s)

| 画面 | 动作 |
|------|------|
| 切到 Claude Desktop，**全新对话** | 输入："我们这个项目数据库选型是怎么定的？为什么？" Claude 调用 `unified_memory_search`，**准确答出 SQLite + 本地优先的理由**，并标出来源实体。 |

字幕：*"换到 Claude，全新对话——它已经知道了。同一份记忆，跨工具通用。"*

### 00:43 — 收尾 (7s)

| 画面 | 动作 |
|------|------|
| 全屏卡片 | 文案："一份记忆，所有 AI 通用，且只属于你。全在你自己机器上。" 下方：GitHub URL + Download |

> **README Hero GIF**：截 00:08–00:43 这段（A 存 → B 知道），15–20 秒，是最强的钩子。

---

## Demo A — 完整解说版（90s）

**Goal**: Show someone what Omni-Context does and convince them to install it.

**What you need**: Windows machine with Omni-Context installed, Claude Desktop with MCP configured, 3 sample files ready.

---

## Shot list

### 00:00 — The problem (5s)

| Screen | Action |
|--------|--------|
| Claude Desktop, fresh conversation | Type: "Tell me about me — what projects am I working on? What decisions have I made recently?" |

Claude responds: *"I don't know anything about you. I can only work with what you share in this conversation."*

### 00:05 — The setup (10s)

| Screen | Action |
|--------|--------|
| Omni-Context main window | Switch to Omni. Show the MCP tab in Settings — Claude Desktop is already configured (one click). |

Caption: *"Omni-Context — local knowledge graph over MCP. Download, install, 2 clicks to plug into any AI."*

### 00:15 — Feed it (30s)

| Screen | Action |
|--------|--------|
| Omni graph view (empty) | Drag 3 files onto the window: (1) a project README, (2) a technical decision log, (3) a code review note. |

Show the file drop feedback. Switch to graph view. **Show the graph populating** — entities and relationships appearing in the 3D visualization. Click one node to show its details (type, connections, description).

Caption: *"Drag anything in. Files, screenshots, web pages. It extracts entities and relationships into a local knowledge graph."*

### 00:45 — The payoff (25s)

| Screen | Action |
|--------|--------|
| Switch back to Claude Desktop | New conversation. Type the exact same question: "Tell me about me — what projects am I working on? What decisions have I made recently?" |

Claude calls `unified_memory_search` and responds with:
- Your role and current projects
- Recent decisions you've made
- Key principles you follow
- Cites specific entities by name

Caption: *"Every MCP-compatible AI now shares the same brain. Same knowledge. Forever yours."*

### 01:10 — Close (10s)

| Screen | Action |
|--------|--------|
| Full-screen card | Text: "Omni-Context — Long-term memory for any AI. Runs on your machine." |
| | Below: GitHub URL + "Download for Windows" |

Fade to black.

---

## Pre-flight checklist

- [ ] Claude Desktop installed and MCP configured for Omni-Context
- [ ] Omni-Context running (brain-server online)
- [ ] Graph is initially empty (reset if needed)
- [ ] 3 sample files ready on desktop: one project doc, one decision log, one code note
- [ ] OBS/Loom set to 1920x1080, 30fps
- [ ] Close unnecessary windows, notifications silenced
- [ ] Test run once before recording

## Tips

- **Don't narrate live.** Record the screen, then add captions. Keeps it clean.
- **15s clip for README.** Cut a 15-second excerpt (00:15-00:30 — the graph populating) for the README hero GIF.
- **Keep it under 100s.** If it goes over, speed up the drag-and-drop section.
- **Show the graph.** That's the visual hook — people need to *see* the knowledge graph growing.
