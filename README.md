# Omni-Context

<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

> **Evidence-grounded decision control for long-lived AI agents.**
> **Local-first, read-back verified, and owned by you.**

<p align="center">
  <img src="docs/landing/assets/social-preview.svg" alt="Omni-Context" width="720">
</p>

[![Build](https://img.shields.io/github/actions/workflow/status/guo6x/Omni-context/build.yml?branch=main)](https://github.com/guo6x/Omni-context/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<p align="center">
  <a href="https://github.com/guo6x/Omni-context/releases/latest"><strong>Download for Windows</strong></a> ·
  <a href="#current-state">Current state</a> ·
  <a href="https://guo6x.github.io/Omni-context/">Landing page</a>
</p>

> **Product baseline status** — `product/omni-v3-unified-r1` is the historical engineering baseline that was promoted into `main` during Goal 23.5 repository consolidation; `main` is now the stable development surface. The engineering starting point `17dc1d0` is **NOT** an official frozen experiment product: the original Targeted-7 gate **FAILED**, and the current selector has **no formal performance proof**. See [docs/PRODUCT-BASELINE.md](docs/PRODUCT-BASELINE.md) and [docs/tag-remediation-proposal.md](docs/tag-remediation-proposal.md).

---

## What is Omni-Context

**Omni-Context is evidence-grounded decision control for long-lived AI agents.**

> Qualify the evidence before an agent acts,
> bind execution to the decision that justified it,
> then read the world back and reopen the decision when reality disagrees.

The judgment loop:

```
Qualify → Bind → Read-back → Reopen
```

Agents can already act — write code, open issues, run commands. But **memory is not evidence**
(what an agent remembers is a claim, not a verified fact), and **tool success is not outcome truth**
(exit code 0 says nothing about whether the world actually changed the way you intended).
Omni-Context closes that gap: it qualifies evidence before action, binds execution to the exact
decision that justified it, reads the world back afterwards, and reopens the decision when
reality disagrees.

- **Memory and the knowledge graph** are the long-term **evidence substrate** — they answer
  "what the agent knows". They are a core part of the product, re-placed at the base of the
  judgment loop, not deleted.
- **MCP is one interface surface**, not the product itself.
- **Desktop** is the human control surface: inspect, approve, audit, and reopen decisions.

Read the full thesis: [docs/goal24/narrative/thesis-note.en.md](docs/goal24/narrative/thesis-note.en.md) ·
product vision: [docs/PRODUCT-VISION.md](docs/PRODUCT-VISION.md)

---

## Current state

Capability status uses exactly three labels: **CURRENTLY_VERIFIED** (user-facing today),
**TARGET** (target architecture), **FUTURE** (planned). "Runtime verified on the development
branch" is not the same as "available today". Governance language is frozen in
[docs/PRODUCT-VISION.md](docs/PRODUCT-VISION.md) (§ 14).

### A. Current user-facing — usable today

- Persistent local memory — SQLite on your disk, no accounts, no servers
- Knowledge graph of entities, relationships, and core principles
- Hybrid retrieval (full-text + vector + graph traversal)
- Temporal / provenance-aware context
- Decision context with principles, precedents, and conflicts
- Saved decisions, decision lineage, and outcome recording
- MCP integration — 26 tools, counted from [mcp_tool_manifest.json](mcp_tool_manifest.json)
- Desktop capture / local desktop application (Windows installer via GitHub Releases)

### B. Development-branch runtime verified (CP3–CP8 internal gates)

Under active development on `dev/goal24-cli-skills`. Each item below has engineering
gate evidence, **but no public invocation surface yet** — it is **runtime verified on the
development branch**, not "available today":

| Component | Gate evidence |
|---|---|
| Restricted execution broker (spawn/kill/timeout, containment, output caps) | [checkpoint3-security-gate.json](docs/goal24/checkpoint3-security-gate.json) — PASS |
| GitHub read-only CLI adapter (5 semantic capabilities, pinned executable, zero write bindings) | [checkpoint4-security-gate.json](docs/goal24/checkpoint4-security-gate.json) — PASS |
| Skills registry + importer (quarantine-by-default, integrity-verified) | [checkpoint5-security-gate.json](docs/goal24/checkpoint5-security-gate.json) — PASS |
| Evidence qualification + surface guard (server-owned eligibility, forged-coverage closure) | [checkpoint6-security-gate.json](docs/goal24/checkpoint6-security-gate.json) — PASS |
| Approval binding + risk policy (single-use grants, replay defense) | [checkpoint7-security-gate.json](docs/goal24/checkpoint7-security-gate.json) — PASS |
| Outcome read-back + deterministic evaluator (trusted resolvers, cross-language state/observation vectors) | [checkpoint8-security-gate.json](docs/goal24/checkpoint8-security-gate.json) — PASS (DRG1 prerequisite satisfied) |
| Real non-synthetic E2E: one approval-gated GitHub issue-close closed loop against real GitHub with independent read-back (exit 0 => PENDING => read-back CLOSED => VERIFIED) | [drg2-authoritative-gate.json](docs/goal24/real-e2e/drg2-authoritative-gate.json) — PASS (DRG2 satisfied) |

CP8 full-suite evidence: Brain 1279 passed / 0 failed; Rust 206 passed / 0 failed / 7 ignored;
cross-language vectors 26 (state) + 35 (observation), 0 mismatches.

**Post-CP8 real E2E (development branch verified):** one real, non-synthetic, approval-gated GitHub issue-close closed-loop E2E has been demonstrated against real GitHub with independent read-back. Exit 0 was NOT treated as success — the outcome stayed PENDING until the trusted `github.issue.read` read-back observed CLOSED and the deterministic evaluator returned VERIFIED. This is **internal runtime** evidence: there is **no public CLI feature** for GitHub automation today. See [docs/goal24/real-e2e/authoritative-real-e2e-proof.json](docs/goal24/real-e2e/authoritative-real-e2e-proof.json).

### C. Target / Future — not available

- `omctx` CLI (`ask` / `inspect` / `approve` / `verify` / `history`) — **TARGET**.
  See [docs/goal24/narrative/cli-product-surface.md](docs/goal24/narrative/cli-product-surface.md).
  The binary does not exist for users yet; there is no npm package to install.
- `omctx reopen` user UX — **FUTURE** (runtime not implemented).
- External memory adapters (e.g. MindMemOS, basic-memory) — **FUTURE**, via
  EvidenceProvider Adapter → qualification → Evidence Guard. External memory never becomes
  an evidence authority on its own.
- Multi-runtime adapters (e.g. OpenClaw, NemoClaw, Claude Code) — **FUTURE**, as capability
  transport only; runtimes never receive decision, approval, or outcome authority.

> **DRG v2**: a real, non-synthetic, user-understandable E2E flow now exists and is verified
> (see the Post-CP8 table row above and
> [docs/goal24/real-e2e/authoritative-real-e2e-proof.json](docs/goal24/real-e2e/authoritative-real-e2e-proof.json)).
> Public capability claims remain frozen to what repo + gate evidence supports; anything else
> is explicitly labeled **TARGET** / **FUTURE** / **DESIGNED TO**. Omni is *designed to* sit
> between heterogeneous memory/evidence sources and heterogeneous agent runtimes — it does
> **not** claim today that it works with any memory OS or any runtime.

---

## How it works

```
Evidence acquisition (capture / browser extension / desktop capture / imports)
       ↓
Evidence Substrate (local knowledge graph + memory + retrieval)
       ↓
Judgment / Authority Core (qualify → decide → approve)
       ↓
Controlled Execution (restricted broker → capability adapters)
       ↓
Read-back → Outcome → Reopen / Revision
```

1. **Capture** — screenshot, drag files, clip web pages, or hit a physical button. Anything.
2. **Extract** — OCR + LLM pipeline pulls entities, relationships, and principles into a local knowledge graph.
3. **Qualify & decide** — evidence qualification gates whether remembered information is trustworthy enough to act on right now.
4. **Execute & verify** — approved semantic capabilities run through a restricted broker, then the world is read back and compared to the expectation that justified the decision.

---

## What makes it different

- **Not a note app** — it is a decision-control layer. Tools don't need their own memory systems; they share one evidence substrate and one authority core.
- **Not cloud** — SQLite on your disk. No accounts, no servers, no data ever leaves your machine.
- **Not locked to one AI** — MCP-based today; MCP clients share the same memory. MCP is an interface surface, not the product.
- **Active, not passive** — the agent scans your graph for connections you've forgotten and surfaces them.
- **Questions your thinking** — blind spot detection finds what you're missing. Anti-consensus insights challenge your assumptions.

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

Full parameter schemas: see [docs/MCP-INTEGRATION.md](docs/MCP-INTEGRATION.md).

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

> There is **no** `omctx` npm package to install today — it is a TARGET. Naming and
> registry status: [docs/goal24/narrative/naming-audit.json](docs/goal24/narrative/naming-audit.json).

---

## Why not memory alone? Why not observability alone? Why not a generic runtime?

- **Memory alone** remembers, but cannot tell which memories are still trustworthy enough to act on. Omni qualifies evidence before action.
- **Observability alone** tells you what happened after the fact, but does not bind execution to a decision or refuse a bad action. Omni binds and gates before and during, then verifies.
- **A generic agent runtime** executes whatever it is told, fast. Omni's execution surface only carries approved semantic capabilities and never converts free-form intent into arbitrary shell commands.

---

## Community

- [Issues](https://github.com/guo6x/Omni-context/issues) — bugs, feature requests
- [Discussions](https://github.com/guo6x/Omni-context/discussions) — ideas, Q&A
- [Contributing](./docs/BUILDING.md) — dev setup, architecture overview

---

MIT License. Own the judgment history — especially the decisions reality proved wrong.
