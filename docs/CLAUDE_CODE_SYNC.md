# Omni-Context Sync for Claude Code

Date: 2026-06-17

This document is a handoff note for Claude Code. It summarizes the current product/code state, recent verification, the local Omni MCP/API test results, and the recommended next plan. Please use this as context before producing implementation plans.

## Current Product Judgment

Omni-Context has real technical substance, but the product needs focus.

The strongest positioning is not "a broad second brain" or "a knowledge graph viewer." The most credible wedge is:

> Local shared memory for ChatGPT, Claude, Cursor, and any MCP client.

Chinese positioning:

> 让 ChatGPT、Claude、Cursor 共用同一个本地长期记忆。

The core use case should be:

1. User discusses a real project in ChatGPT/Claude/Gemini.
2. Omni captures and extracts decisions, tasks, preferences, and project context.
3. User opens Claude Desktop/Cursor/Cline.
4. That AI can retrieve the same local memory through MCP and continue without copy-pasting history.

The main risk is not lack of features. The main risk is that users do not understand why they should use it today, and the current experience is too broad.

## Current Repo State

Workspace:

`omni-context-release` (repository root)

Current git status when last checked:

- Modified:
  - `brain-server/src/graphrag/extractor.ts`
  - `brain-server/tests/api.smoke.test.ts`
  - `mobile-app/src/screens/PairScanScreen.tsx`
- Untracked:
  - `desktop-daemon/brain-server-dist/`

Important: do not revert user changes. The untracked `desktop-daemon/brain-server-dist/` looks like generated packaged output. Decide whether to ignore it or explicitly include it, but do not blindly commit it.

## Recent Fixes Already Made

I found and fixed a contract mismatch in the backend smoke test:

- `LLMExtractorPipeline` now returns `facts`, not old `relationships`.
- `tests/api.smoke.test.ts` mock was updated from `relationships: []` to `facts: []`.
- `GraphRAGExtractor` now defensively treats missing `entities`, `facts`, or `principles` arrays as empty arrays.
- The graph extract smoke test timeout was increased to 15s because first local embedding model load can exceed 5s.

Files changed:

- `brain-server/src/graphrag/extractor.ts`
- `brain-server/tests/api.smoke.test.ts`

## Verification Already Run

These passed:

- `brain-server`: `npm run typecheck`
- `mobile-app`: `npm run typecheck`
- `browser-extension`: `npm run build`
- `brain-server`: `npm test`

Final backend result:

- 5 test files passed
- 87 tests passed

There are still expected stderr logs in tests where LLM/Ollama is unavailable and fallback behavior is exercised. They are noisy but not failures.

## Local Desktop/MCP Test

The user's local desktop app was running.

Health check:

- `http://127.0.0.1:3001/health` returned OK.

Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "omni-context": {
      "command": "<install-path>/brain-server/node.exe",
      "args": [
        "<install-path>/brain-server/dist/mcp-proxy.js"
      ]
    }
  }
}
```

The MCP proxy reads the local API token from:

`%LOCALAPPDATA%\omni-context\local-token.txt`

Stats from the running local instance:

- Entities: 10972
- Relationships: 3155
- Principles: 2381
- Core principles: 52
- Archival memory items: 44

## MCP Tool Quality Findings

### What Worked Well

`unified_memory_search` was useful.

Query:

`Omni-Context 产品定位 跨 AI 本地记忆 ChatGPT Claude Cursor`

It correctly retrieved:

- `Omni-Context 定位：跨 AI 中立的记忆底座`
- `Omni-Context`
- `演示护城河：跨 AI 连续性`
- `记忆即身份，AI 是可换的身体`
- `演示上镜 ≠ 护城河深`

This is strong evidence that the core memory layer is useful. It recovered a prior strategic decision:

> 明确不做自主 agent。只做所有 AI 共享、用户拥有、本地优先的记忆层，用 MCP 让任何 AI 插上同一个大脑。

### What Worked Poorly

`ask_memory` and `get_decision_context` were too noisy for product decisions.

When asked what Omni should do next, they retrieved broad personal/entrepreneurship principles such as:

- `先搞渠道再产品`
- `念起即行三步法`
- `提前规划与积累作品`
- `迈出第一步`

These may be useful in another context, but they were off-domain for a product strategy question about Omni-Context.

Main issue:

The memory base mixes personal principles, entrepreneurship notes, product strategy, imported documents, and project decisions. The answer layer lacks strong topic/domain filtering.

## Product Implication

The product is not useless. It already helps recover old decisions. But to become something the user wants to use daily, it must become much more reliable in active answers.

The next high-leverage work is retrieval precision and trustworthy citation, not more features.

## Recommended v0.3 Direction

Do not expand the feature surface. Build a focused v0.3 around this claim:

> Multiple AI tools, one local memory.

### Primary User

Heavy AI users and indie developers who use more than one AI tool:

- ChatGPT
- Claude
- Gemini
- Cursor
- Claude Desktop
- Cline/Windsurf/other MCP clients

### Primary Pain

Context is scattered across AI tools. Every tool forgets what was discussed elsewhere. Users repeatedly copy-paste project background, decisions, and preferences.

### Primary Demo

1. Discuss a project in ChatGPT/Claude/Gemini.
2. Omni browser extension captures the conversation.
3. Desktop shows the memory was extracted.
4. Open a different MCP client.
5. Ask: "继续上次那个扫码连接问题."
6. The other AI retrieves prior decision/context from Omni and answers with citations.

## Implementation Priorities

### P0: Retrieval Precision

Improve the tools that answer from memory:

- `ask_memory`
- `get_decision_context`
- `unified_memory_search`

Required behavior:

- Prefer same-project memories when query contains a known project name.
- Boost `decision`, `project`, `task`, `question`, `concept` for product/project questions.
- Down-rank generic imported `principle` entries unless explicitly asked for principles.
- Allow caller to pass filters: `types`, `tags`, `project`, `excludeTags`, `excludeTypes`.
- Put hard caps on graph expansion to prevent hundreds of loosely related nodes from flooding answers.
- Return compact citations with why each memory was selected.

Suggested first target:

For queries containing `Omni-Context`, `ask_memory` should first retrieve `tags` containing `Omni-Context` or entity names matching `Omni-Context`, and should avoid generic uploaded-file principles unless no project-specific memory exists.

### P1: README and Landing Reposition

Rewrite first-screen copy around:

> Local shared memory for ChatGPT, Claude, Cursor, and any MCP client.

Avoid leading with:

- "AI memory operating system"
- "physical-level"
- broad "second brain"
- knowledge graph as the primary feature

Lead with a concrete before/after workflow.

### P1: Demo Script

Create a 60-second demo script:

- capture conversation in browser extension
- retrieve it in a different AI through MCP
- show citations
- show local/offline ownership as a trust point, not the main story

### P2: Onboarding Simplification

First run should focus on:

1. Connect local brain server.
2. Install/use browser extension.
3. Capture one AI conversation.
4. Connect one MCP client.
5. Ask one query that proves continuity.

Do not foreground mobile app, hardware, complex graph editing, or blind spot detection in first-run onboarding.

### P2: Engineering Hygiene

- Decide what to do with `desktop-daemon/brain-server-dist/`.
- Consider adding it to `.gitignore` if generated.
- Keep typecheck/tests green.
- Reduce noisy test stderr later if it hurts confidence.

## Suggested Planning Task for Claude Code

Please produce a concrete implementation plan for v0.3 with:

1. File-by-file changes.
2. Exact behavioral acceptance criteria.
3. A minimal test plan.
4. Explicit non-goals.
5. Risks and rollback plan.

Preferred first implementation chunk:

> Improve retrieval precision for `ask_memory` and `get_decision_context` so Omni-Context project questions retrieve project-specific decisions before generic principles.

Do not start by redesigning the whole UI. The fastest value is making the memory answers more trustworthy.

