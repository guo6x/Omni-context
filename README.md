# Omni-Context

> **Plug long-term memory into any AI client via MCP — runs entirely on your machine, owns your data forever.**

<p align="center">
  <img src="docs/landing/assets/demo.gif" alt="Omni-Context demo" width="720">
</p>

[![Build](https://img.shields.io/github/actions/workflow/status/guo6x/Omni-context/release.yml?branch=main)](https://github.com/guo6x/Omni-context/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<p align="center">
  <a href="https://github.com/guo6x/Omni-context/releases/latest"><strong>Download for Windows</strong></a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="https://guo6x.github.io/Omni-context/">Landing page</a>
</p>

---

## Why Omni-Context

**Your AI forgets you every conversation.** ChatGPT memory is shallow. Cursor's context lasts one session. Claude doesn't remember across projects.

**Cloud memory means someone else's server.** Mem0, Letta, Zep — all impressive, all cloud-first. Your second brain lives on their infrastructure.

**Omni-Context gives every MCP-compatible AI a shared, persistent knowledge graph that lives on your machine.** Plug it into Claude Desktop, Cursor, Cline, Windsurf — they all draw from the same brain. The graph grows as you work. Forever yours.

---

## How it works

```
You capture anything       We build a knowledge graph     Any AI client can query it
───────────────────       ──────────────────────────     ──────────────────────────
Screen · Files · Web       Entities + Relationships      via MCP (standard protocol)
Browser extension          + vectors + full-text         Claude · Cursor · Cline · ...
                           Stored in local SQLite        12+ clients, one brain
```

1. **Capture** — screenshot, drag files, clip web pages, or hit a physical button. Anything.
2. **Extract** — OCR + LLM pipeline pulls out entities and their relationships into a local knowledge graph.
3. **Query** — any MCP-compatible AI client accesses your graph as long-term memory. Same brain, every conversation.

---

## What makes it different

- **Not a note app** — it's an AI memory layer. Your tools don't need their own memory systems; they all share Omni.
- **Not cloud** — SQLite on your disk. No accounts, no servers, no data ever leaves your machine.
- **Not locked to one AI** — MCP-native. Use Claude Desktop today, Cursor tomorrow, same memory.
- **Active, not passive** — the agent scans your graph for connections you've forgotten and surfaces them.

---

## Install

### Windows

Download `Omni-Context-Setup-x64.msi` from [Releases](https://github.com/guo6x/Omni-context/releases/latest). Double-click, done. Fully offline — Node.js runtime and embedding models are bundled.

### macOS / Linux

Build scripts are ready. Community contributors with hardware: pull requests welcome.

### Build from source

```bash
git clone https://github.com/guo6x/Omni-context.git
cd Omni-context
npm run install:all
npm run package
```

---

## Omni vs alternatives

|                    | Omni | ChatGPT Memory | Mem0 | Letta | Obsidian |
|--------------------|------|----------------|------|-------|----------|
| Runs locally       | ✓    | ✗              | ✗    | ✓     | ✓        |
| MCP-native         | ✓    | ✗              | ✗    | ✗     | ✗        |
| Knowledge graph    | ✓    | ✗              | partial | ✓  | manual   |
| Cross-AI shared    | ✓    | ✗              | ✓    | ✗     | ✗        |
| Own your data      | ✓    | ✗              | ✗    | ✓     | ✓        |
| Offline-first      | ✓    | ✗              | ✗    | ✗     | ✓        |

---

## Community

- [Issues](https://github.com/guo6x/Omni-context/issues) — bugs, feature requests
- [Discussions](https://github.com/guo6x/Omni-context/discussions) — ideas, Q&A
- [Contributing](./docs/BUILDING.md) — dev setup, architecture overview

---

MIT License. Built for people who want their AI to actually know them.
