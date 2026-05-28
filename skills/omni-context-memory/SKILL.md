---
name: omni-context-memory
description: >-
  Use the user's Omni-Context long-term memory when it is connected over MCP.
  Trigger this whenever you need to recall what the user has done, decided, or
  prefers across past conversations, or when a conversation reaches something
  worth remembering. Omni-Context is a local knowledge graph — NOT the standard
  @modelcontextprotocol/server-memory — so use the exact tool names below
  (e.g. unified_memory_search, save_conclusion), never read_graph / search_nodes.
---

# Omni-Context memory

Omni-Context exposes a **local knowledge graph** (entities + relationships +
vectors + full-text) over MCP. Treat it as the user's long-term memory: read
from it before giving advice that depends on their history, and write back to it
when something worth remembering happens.

## Correct tool names

This server is `omni-context`, **not** the reference memory server. The tools
`read_graph`, `search_nodes`, `create_entities`, `open_nodes` **do not exist
here** — calling them returns "not available in given tool list". Use these:

**Recall (read)**
- `unified_memory_search` — best general recall; fuses text + vector + graph. Default to this.
- `search_entities` — keyword search by name/description (optional `type` filter).
- `vector_search` — semantic similarity when keywords miss.
- `get_entity` — full detail + relationships for one entity id.
- `get_graph_neighborhood` — what surrounds an entity (depth 1–3).
- `list_entities` — browse all, optionally by `type`.
- `get_core_context` — the user's core principles / rules / preferences.
- `get_stats` — graph size and composition.

**Persist (write)**
- `add_entity` — record a concept, tool, person, project, pattern, etc.
- `add_relationship` — connect two entities (depends_on, conflicts_with, extends, …).
- `save_conclusion` — save a key takeaway at the end of a substantive conversation.
- `update_entity` — correct/enrich an existing entity.
- `extract_from_capture` — auto-extract entities/relationships from a block of text.

**Decisions**
- `get_decision_context` — pull principles, history, and conflicts relevant to a situation (does not decide for you).
- `analyze_decision` / `discuss_decision` — LLM-assisted analysis grounded in the graph (requires an LLM configured in Omni-Context).
- `save_decision` — record a decision the user made, citing the entities it referenced.
- `get_decision_lineage` — trace what a decision cited and how decisions chain.

> The client may namespace these (e.g. the user configured the server under a
> name, so a tool can appear as `omni-context_unified_memory_search`). Use
> whatever name the client lists; the base names are above.

## When to use it

- **Start of a substantive conversation**: call `get_core_context` to learn the
  user's principles, and `unified_memory_search` on the topic to pull relevant
  past context — before giving advice.
- **Mid-conversation recall**: when you need something specific, prefer
  `unified_memory_search`; fall back to `search_entities` / `vector_search`,
  then `get_entity` / `get_graph_neighborhood` for detail.
- **Something worth remembering happens**: `add_entity` + `add_relationship`.
- **A conclusion or decision is reached**: proactively call `save_conclusion`
  (insights) or `save_decision` (concrete choices) so it persists for next time.

## Prerequisites

- The Omni-Context desktop app must be **running** (it hosts the brain server).
- Decision *analysis* tools (`analyze_decision` / `discuss_decision`) need an LLM
  configured in Omni-Context settings; without it they return `LLM_NOT_CONFIGURED`.
  Recall and persist tools work fully offline regardless.
