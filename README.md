# Omni-Context

<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

> **A local, persistent context and decision-intelligence layer for long-lived AI agents. Your memory and decisions stay on your machine.**

<p align="center">
  <img src="docs/landing/assets/social-preview.svg" alt="Omni-Context" width="720">
</p>

[![Build](https://img.shields.io/github/actions/workflow/status/guo6x/Omni-context/build.yml?branch=main)](https://github.com/guo6x/Omni-context/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<p align="center">
  <a href="https://github.com/guo6x/Omni-context/releases/latest"><strong>Download for Windows</strong></a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="https://guo6x.github.io/Omni-context/">Landing page</a>
</p>

> **Product baseline status** — `product/omni-v3-unified-r1` is the historical engineering baseline that was promoted into `main` during Goal 23.5 repository consolidation; `main` is now the stable development surface. The engineering starting point `17dc1d0` is **NOT** an official frozen experiment product: the original Targeted-7 gate **FAILED**, and the current selector has **no formal performance proof**. See [docs/PRODUCT-BASELINE.md](docs/PRODUCT-BASELINE.md) and [docs/tag-remediation-proposal.md](docs/tag-remediation-proposal.md).

---

## Why Omni-Context

**Your AI forgets you every conversation.** ChatGPT memory is shallow. Cursor's context lasts one session. Claude doesn't remember across projects.

**Cloud memory means someone else's server.** Mem0, Letta, Zep — all impressive, all cloud-first. Your context and decisions live on their infrastructure.

**Omni-Context is a local, persistent context and decision-intelligence layer for long-lived AI agents.** It keeps a knowledge graph, retrieval index, and decision history on your machine, so agents can ground their work in your actual context instead of a fresh chat window.

**More than memory.** Most "AI memory" tools are fancy databases. Omni-Context also tracks decisions — context, reasoning, lineage, and outcomes — and surfaces evidence for the choices agents make. MCP is one integration surface for this today, not the product itself.

---

## How it works

```
Capture / Sources
       ↓
Persistent Local Context
       ↓
Knowledge Graph + Retrieval
       ↓
Evidence / Decision Intelligence
       ↓
Integration Surfaces
       ↓
AI Agents
```

1. **Capture** — screenshot, drag files, clip web pages, or hit a physical button. Anything.
2. **Extract** — OCR + LLM pipeline pulls entities, relationships, and principles into a local knowledge graph.
3. **Reason** — decision context, lineage, and outcomes give agents evidence-qualified context instead of raw memory dumps.
4. **Integrate** — today, AI clients access this through MCP; CLI/API adapters are in development.

---

## Today / Current capabilities

- Persistent local memory (SQLite on your disk — no accounts, no servers)
- Knowledge graph of entities, relationships, and core principles
- Hybrid retrieval (full-text + vector + graph traversal)
- Temporal / provenance-aware context
- Decision context with principles, precedents, and conflicts
- Saved decisions and decision lineage
- Outcome recording (calibration, lessons, follow-ups)
- MCP integration (current integration surface)
- Desktop capture / local desktop application

## Active development / Roadmap

Under active development on `dev/goal24-cli-skills`:

- Transport-agnostic capabilities
- Skills
- CLI adapters
- Evidence-gated execution
- Approval boundaries
- Verified outcomes

None of the roadmap items are available yet.

---

## What makes it different

- **Not a note app** — it's a context and decision layer. Your tools don't need their own memory systems; they all share the same brain.
- **Not cloud** — SQLite on your disk. No accounts, no servers, no data ever leaves your machine.
- **Not locked to one AI** — MCP-based today; Claude Desktop, Cursor, Cline, and other MCP clients share the same memory.
- **Active, not passive** — the agent scans your graph for connections you've forgotten and surfaces them.
- **Questions your thinking** — blind spot detection finds what you're missing. Anti-consensus insights challenge your assumptions. Your graph pushes back.

---

## Tools

Current MCP interface exposes 26 tools, grouped by what they do. Canonical count is generated in
[`mcp_tool_manifest.json`](mcp_tool_manifest.json).

### Decision & retrieval — the "brain"

- `get_decision_context` — given a situation, return relevant principles, precedents, conflicts, and graph neighborhood in one call
- `unified_memory_search` — three-layer fusion search (full-text + vector + graph traversal) in one natural-language query
- `vector_search` — pure semantic vector search; finds conceptually similar entities even with different wording
- `ask_memory` — ask a question, get a synthesized answer grounded in your graph
- `graph_answer` — graph-grounded Q&A with citation to source entities
- `search_entities` — find entities by name / description keywords
- `get_core_context` — fetch core principles relevant to a topic (or a compact overview if no topic given)
- `get_entity` — get one entity's full info and all its relationships by ID
- `get_graph_neighborhood` — get the N-hop subgraph around an entity
- `list_entities` — list entities, optionally filtered by type

### Capture & write — grow the memory

- `record_capture` — store a capture snapshot (screenshot / clipboard / text)
- `extract_from_capture` — auto-extract entities + relationships + principles from a text passage
- `add_entity` — create a new entity
- `add_relationship` — link two existing entities
- `update_entity` — modify an entity's name / description / tags / metadata
- `set_core_principle` — record or update a core principle

### Decision pipeline — sediment thinking

- `save_conclusion` — persist a conclusion worth remembering
- `save_decision` — record a decision with its context and reasoning
- `analyze_decision` — analyze a decision for coherence and potential conflicts
- `discuss_decision` — explore a decision from multiple angles
- `get_decision_lineage` — trace how a decision evolved over time
- `record_decision_outcome` — record an observed result for a saved decision (calibration, lessons, follow-ups)

### Graph maintenance

- `merge_entities` — merge duplicate entities into one
- `delete_entity` — remove an entity
- `get_stats` — entity / relationship counts, type distribution
- `get_decay_report` — which memories have crossed the decay threshold (cleanup candidates)

Full parameter schemas: see [`docs/MCP-INTEGRATION.md`](docs/MCP-INTEGRATION.md).

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
