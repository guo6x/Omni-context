# Omni-Context Current Product Architecture Reconciliation

**Status:** architecture truth audit / implementation planning  
**Authoritative code baseline:** `main@d4d61f1c9b73d8a127023129adc3376ec6d7db13`  
**Date:** 2026-10-04

> This document reconciles the product that is actually implemented with the product narratives that accumulated over Goals 24–29.
>
> It is intentionally code-first. When an older README, delivery report, or product thesis conflicts with current code, current code wins. When a draft PR contains newer work, it is recorded separately instead of being silently treated as `main`.

---

## 1. Executive conclusion

The repository currently contains **two real product centers**:

1. **Personal Cognitive Layer** — capture a user's ongoing context, retain it over time, make it available across AI clients, help with personal/project decisions, learn from outcomes, and proactively surface useful context.
2. **Agent Judgment / Authority Layer** — qualify evidence before a side-effecting agent action, bind authorization to the exact action, execute through constrained capabilities, independently read reality back, and reopen the judgment when reality disagrees.

The second product center was promoted in `docs/PRODUCT-VISION.md` to the master category:

> Evidence-grounded decision control for long-lived AI agents.

That narrative is internally coherent, but it does **not** replace the first product in the implementation. The first product remains deeply present in the shipped Desktop, browser extension, mobile MVP, MCP surface, decision tools, proactive cognition loop, import/export system, and hardware interaction.

The reconciled architecture is therefore:

```text
Personal context and experience
        ↓
Remember / understand
        ↓
Help the user decide
        ↓
┌───────────────────────────────┐
│ advice only                   │
│                               │
│ or                            │
│                               │
│ side-effecting agent action   │
│        ↓                      │
│ Evidence Qualification        │
│        ↓                      │
│ Approval / Binding            │
│        ↓                      │
│ Controlled Execution          │
│        ↓                      │
│ Independent Read-back         │
└───────────────┬───────────────┘
                ↓
             Outcome
                ↓
             Learn
                ↓
       Proactive cognition
                ↺
```

**Product-level interpretation:** Personal Context & Decision is the primary human-facing loop. Judgment / Authority is the advanced action-safety layer that becomes active when advice turns into real side effects.

This preserves the valuable Goal24–29 work without forcing the entire product to behave like an agent-governance console.

---

## 2. Repository truth baseline

### 2.1 Current `main`

Current `main` HEAD:

```text
d4d61f1c9b73d8a127023129adc3376ec6d7db13
docs(goal29): record V1 freeze gate
```

Important implemented surfaces on `main` include:

- Windows Tauri Desktop daemon + system tray.
- Floating always-on-top HUD.
- Screen + clipboard capture ("沉淀").
- File ingestion and chat-export import.
- Browser extension with ChatGPT / Claude / Gemini extraction.
- Local SQLite memory / graph / temporal assertion substrate.
- Hybrid retrieval and graph-grounded Q&A.
- 26 MCP tools.
- Decision context / analysis / discussion / save / lineage / outcome journal.
- Decision review reminders.
- Proactive insight / blindspot / decay loop.
- Read-only mobile MVP.
- ESP32 physical capture / decision / reset interaction.
- CP6 evidence qualification.
- CP7 authorization / binding.
- CP8 trusted read-back + deterministic outcome evaluation.
- Goal27 human-only decision revision runtime.
- Goal28 second controlled adapter proof.
- Goal29 integrated V1 freeze.

### 2.2 Draft branches not yet in `main`

Three open draft PRs currently sit directly on top of the same `main` baseline:

- **PR #5** `docs/post-goal29-release-truth-sync` — 38 commits ahead. Release/security maintenance, dependency remediation, Windows resolver fix, post-Goal29 truth sync.
- **PR #6** `feat/vnext-evidence-diagnostics` — 21 commits ahead. Desktop evidence diagnostics / Control Center observability; installed Windows gate passed on its branch.
- **PR #7** `feat/vnext-revision-supersession` — 11 commits ahead. Makes current vs superseded authority judgments explicit in Control Center; installed supersession gate is prepared but not executed.

These branches must not be treated as if they are already part of the stable product.

---

## 3. The implemented interaction model

The actual interaction model is not "open Omni and manage a dashboard every day."

It is closer to an **ambient personal cognitive layer**.

### 3.1 Desktop is a daemon first, application second

`desktop-daemon/src-tauri/src/main.rs` implements:

- system tray residency;
- Brain Server lifecycle;
- close-to-tray behavior;
- capture pause/resume;
- settings/data/log access;
- hardware event handling.

`FloatingHUD.tsx` is a frameless, transparent, always-on-top, skip-taskbar surface. This is evidence that the product was designed to remain available while the user works elsewhere.

### 3.2 "沉淀" is a first-class interaction

`useOmniContext.ts` captures:

```text
current screen + clipboard
        ↓
/api/graph/extract
        ↓
entity / relationship / assertion extraction
        ↓
long-term context
```

Privacy defaults are currently conservative:

- Desktop capture is paused by default.
- Sensitive applications are on a default blocklist.
- Browser automatic capture is off by default.

### 3.3 Browser capture is already a real cross-AI acquisition surface

The browser extension currently supports conversation extraction from:

- ChatGPT;
- Claude;
- Gemini.

The current privacy implementation requires explicit opt-in for automatic capture and supports:

- per-domain allow / block;
- global pause;
- preview;
- sensitive-text redaction;
- sensitive-domain policy;
- capture audit state.

**Documentation drift found:** `browser-extension/README.md` still describes automatic capture as default-on, while `privacy.js` and its tests enforce default-off. Implementation is authoritative.

### 3.4 AI clients are already an Omni UI

The MCP surface is not only CRUD. Important user-facing tools already include:

- `get_decision_context`
- `unified_memory_search`
- `ask_memory`
- `graph_answer`
- `save_conclusion`
- `save_decision`
- `analyze_decision`
- `discuss_decision`
- `get_decision_lineage`
- `record_decision_outcome`

The bundled Omni skill explicitly teaches connected AI clients to proactively persist important conclusions and concrete decisions.

Therefore a core interaction is already:

```text
user works in an AI client
        ↓
AI retrieves Omni context
        ↓
AI reasons with that context
        ↓
important conclusion / decision
        ↓
AI writes structured state back to Omni
```

### 3.5 Desktop also contains a direct "Ask Brain" interaction

`GraphViewer.tsx` contains a command/query surface backed by `graph_answer`.

It supports:

- grounded answer;
- reasons;
- citations / entity IDs;
- multi-turn continuation;
- persisted discussions;
- copy / favorite;
- saving a result as a decision.

So Omni currently supports both:

1. **AI-as-interface** through MCP; and
2. **Omni-as-interface** through Desktop.

These are complementary, not competing product directions.

### 3.6 Proactive cognition is implemented, not merely a historical idea

`AgentLoop` still runs independent background tasks for:

- insight generation;
- decision review reminders;
- decay warnings;
- blindspot detection.

Blindspot logic includes behavior such as:

- consume without action;
- source homogeneity;
- search without save.

`InsightsInbox` exposes these outputs and supports review / feedback / promotion into graph memory.

The homepage also polls unread insights so the proactive layer is visible without requiring the user to open the Inbox manually.

### 3.7 Mobile and hardware are real interaction surfaces

The mobile app is currently a read-oriented paired device using scoped `memory:read` and `decision:read` permissions.

ESP32 firmware exposes three physical actions:

- precipitate;
- decision;
- reset.

The hardware path is authenticated with per-device credentials, HMAC, timestamp, nonce and replay protection.

---

## 4. Seven current product chains

### 4.1 Capture

**Status: IMPLEMENTED / USER-FACING**

Current sources:

- Desktop screen + clipboard.
- Drag/drop and uploaded files.
- Browser page / selection capture.
- Browser ChatGPT / Claude / Gemini conversation capture.
- Chat history export import.
- MCP explicit capture.
- ESP32 trigger.

Current strengths:

- local Brain Server;
- scoped device auth;
- privacy pause / blocklist / consent;
- asynchronous ingestion;
- retry path for failed imports/chunks;
- ingestion chunk persistence for file ingestion.

Current architectural gap:

**There is no single canonical immutable source/event ledger that every acquisition path writes to before derivation.**

This matters because user ownership should mean that future memory engines can re-derive context from source truth.

### 4.2 Context / memory / retrieval

**Status: IMPLEMENTED / USER-FACING, but over-owned by Omni**

Current components include:

- entities;
- relationships;
- temporal assertions;
- core memory;
- archival memory;
- vector search;
- FTS;
- graph traversal;
- evidence fusion;
- temporal retrieval;
- provenance;
- entity resolution;
- conflict resolution;
- memory decay.

This is substantial working infrastructure.

However, under the new product strategy, most of this should be treated as a **replaceable intelligence implementation**, not the irreplaceable product asset.

Long-term product ownership should sit below it:

> source truth + canonical personal objects + decision/outcome history + permissions.

### 4.3 Personal Decision Intelligence

**Status: IMPLEMENTED / USER-FACING**

The current `SaveDecisionSchema` already carries much more structure than a simple note:

- decision question;
- goals;
- selected option;
- alternatives;
- hard constraints;
- soft preferences;
- evaluation criteria;
- supporting / opposing evidence;
- per-evidence role / source span / currentness;
- assumptions;
- uncertainties;
- expected outcomes;
- risks;
- confidence;
- revisit time;
- previous / superseded decision;
- explicit lineage relationship.

Lineage supports:

- continues;
- revises;
- supersedes;
- reverses;
- invalidates.

This means a large portion of the previously discussed "Decision Ledger" already exists.

### 4.4 Proactive cognition

**Status: IMPLEMENTED / USER-FACING**

The background loop already turns stored context and behavior events into candidate insights and reminders.

This is strategically important because it changes Omni from:

> retrieval system

into:

> system that may notice something before the user asks.

This should remain a first-class product capability.

### 4.5 AI interface layer

**Status: IMPLEMENTED / USER-FACING**

MCP is a real cross-client interface today.

It should remain an interface, not become the product category.

The strategic purpose is:

> Any authorized AI should be able to retrieve the same personal context and write back durable conclusions/decisions.

### 4.6 Action Authority

**Status: IMPLEMENTED, mixed user-facing/internal maturity**

Goal24–29 added a second, stricter lifecycle:

```text
Evidence Qualification
→ Judgment
→ Approval
→ Bound Plan
→ Controlled Execution
→ Receipt
→ Independent Read-back
→ Verified / Mismatch / Inconclusive Outcome
→ Reopen / Revision
```

This is valuable but should be understood as the **side-effect safety layer**.

It should not redefine ordinary personal decisions as execution-authority objects.

### 4.7 Outcome / Revision

**Status: TWO DIFFERENT SEMANTICS CURRENTLY COEXIST**

This is the largest conceptual collision in the current architecture.

#### A. Personal decision outcome journal

`record_decision_outcome` records:

- actual outcome;
- assumption failures;
- unexpected factors;
- lessons learned;
- confidence calibration;
- follow-up actions.

The code explicitly marks these records:

```text
outcome_authority = journal
verified = false
```

This is appropriate for human/project/life decisions.

#### B. CP8 execution outcome

The CP8 outcome path requires:

- trusted execution receipt;
- trusted independent observation;
- deterministic evaluator.

It produces authority-grade states such as:

- PENDING;
- VERIFIED;
- MISMATCH;
- INCONCLUSIVE.

These two outcomes are related but are **not the same object** and must not share ambiguous product language.

---

## 5. Naming reconciliation

No destructive database rename is required yet. First freeze a logical vocabulary.

| Human/product concept | Recommended canonical name | Existing implementation |
|---|---|---|
| A choice the user makes about life/project/work | **Personal Decision** | decision entity + `SaveDecisionSchema` |
| What later happened after that choice | **Decision Outcome Journal** | `record_decision_outcome` |
| What was learned from the result | **Decision Lesson** | `lessons_learned` inside outcome journal |
| Whether an agent may perform a side-effecting operation | **Action Judgment** | CP6/CP7 decision/authorization runtime |
| Permission bound to an exact operation | **Action Authorization** | approval/grant/plan |
| What reality says after the operation | **Execution Outcome** | CP8 |
| A new authority judgment created after reality/evidence changes | **Judgment Revision** | Goal27 |

Rule:

> Never use an unqualified "Decision" or "Outcome" in new architecture docs when the object could belong to either domain.

---

## 6. Data-ownership audit

The future-proof product thesis depends on the user's source data surviving changes in memory/retrieval/model technology.

The current implementation is **partially there**, but not yet consistent across all acquisition paths.

### 6.1 What is already strong

For ordinary file/browser ingestion through `/api/ingest/file`:

- cleaned source text is placed into archival memory;
- chunked source content is persisted in `ingestion_chunks`;
- document metadata is persisted in `ingestion_documents`;
- assertions can carry raw-event references and provenance;
- full database export includes these tables.

The admin export is genuinely broad and includes:

- entities;
- relationships;
- assertions;
- core memory;
- archival memory;
- discussions;
- ingestion documents/chunks;
- behavior events;
- proactive insights;
- merge/conflict audit state;
- non-secret device configuration;
- embedding metadata.

### 6.2 Critical gap found

The successful **chat-export import path** (`/api/import/chat` → `runImportPipeline`) extracts entities / relationships / assertions / principles, but does not currently persist every successfully imported original conversation as a canonical raw source record before derivation.

Failed imports may retain payload snapshots for retry, but successful imports should not depend on derived entities being the only durable representation.

For a product whose long-term invariant is "your context outlives every model," this is a real architectural gap.

### 6.3 Required invariant

Before replacing any memory engine, establish:

> **Source truth is durable. Derived memory is rebuildable.**

Target shape:

```text
Source
  ↓
Raw Event / Document / Conversation
  ↓
canonical immutable payload + provenance
  ↓
derived views
  ├─ native current graph
  ├─ Hindsight
  ├─ Graphiti
  ├─ future memory engine
  └─ future model-derived summaries
```

No provider should become the only holder of personal history.

---

## 7. Module disposition

### OWN — product assets Omni should control long-term

- Local/user-owned source vault.
- Source / raw-event identity and provenance.
- Capture consent and privacy policy.
- Import/export portability contract.
- Personal Decision objects.
- Decision Outcome Journal / lessons / revisit lifecycle.
- User corrections / supersession history.
- Behavior event ledger.
- Proactive cognition policy and feedback.
- Cross-AI authorization / permissions.
- Provider interfaces and routing.
- MCP / API surface contracts.

### KEEP, but stop treating as moat

- Current SQLite graph.
- Current temporal assertions.
- Current native retrieval.
- Current archival/core memory.
- Current entity/conflict resolution.

These remain useful as a default implementation and fallback.

### ADAPTERIZE

These should become replaceable behind explicit interfaces:

- memory extraction;
- memory consolidation;
- semantic retrieval;
- graph/temporal memory;
- embeddings;
- reranking;
- reasoning model;
- bounded decision model.

Candidate external systems may be evaluated later. Do not integrate multiple providers before the source-truth contract is stable.

### ADVANCED / OPTIONAL

Keep Goal24–29 safety work as a distinct layer:

- CP6 evidence qualification;
- CP7 exact action binding / approval;
- restricted execution broker;
- capability adapters;
- CP8 read-back;
- Goal27 authority revision;
- evidence diagnostics;
- superseded-judgment audit UI.

This layer becomes active when Omni or a connected agent is asked to change external reality.

### STOP INVESTING AS PRIMARY DIFFERENTIATION

- A proprietary generic Decision Kernel as the intelligence moat.
- A proprietary generic memory algorithm as the product moat.
- MCP itself as the moat.
- Knowledge graph visualization itself as the product.
- Control Center as the primary daily consumer UX.

---

## 8. Correct product architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                       USER / LIFE / WORK                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                      acquisition surfaces
                              │
      ┌─────────────┬─────────┼──────────┬─────────────┐
      │             │         │          │             │
   Browser       Desktop    Files      Mobile       Hardware
      │             │         │          │             │
      └─────────────┴─────────┼──────────┴─────────────┘
                              ▼
                  ┌───────────────────────┐
                  │  USER-OWNED SOURCE   │
                  │        VAULT          │
                  │ source/raw events     │
                  │ provenance/consent    │
                  └───────────┬───────────┘
                              │
                   rebuildable derivations
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
   Memory Provider       Graph Provider       Native fallback
         └────────────────────┼────────────────────┘
                              ▼
                     Context Builder
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
   GPT / Claude / ...   Decision model        Rules/tools
         └────────────────────┼────────────────────┘
                              ▼
                   Personal Decision Layer
                              │
             ┌────────────────┴────────────────┐
             │                                 │
          advice only                    external action
             │                                 │
             │                        Action Safety Layer
             │                  qualify → bind → execute
             │                      → read-back → revise
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                           Outcome
                              │
                            Learn
                              │
                     Proactive cognition
                              ↺
```

---

## 9. UI reconciliation

Do **not** replace the current interaction model with a dashboard-first redesign.

Primary user interactions should remain:

1. **Ambient / one-action capture** — normal work continues; important context is captured with consent.
2. **AI-as-interface** — the user can stay in their preferred AI; Omni supplies and receives durable context.
3. **Direct Ask Brain** — Omni Desktop remains available when the user wants to interrogate their own history directly.
4. **Proactive cognition** — useful reminders/insights can surface without a query.
5. **Inspect / correct / control** — Desktop exposes graph, memory manager, decision history, privacy, exports and advanced action control.

The main Desktop application is therefore simultaneously:

- direct second-brain surface;
- inspect/correct surface;
- privacy/data control plane;
- optional action-authority console.

It should not be reduced to any one of these.

---

## 10. Immediate implementation gaps worth fixing

### P0 — Canonical source truth

Create a durable source/event contract used by **every** acquisition path, including successful chat-export imports.

Acceptance criteria:

- every imported conversation has a durable source identity;
- raw/normalized payload survives re-indexing;
- derived entity/assertion IDs reference source IDs;
- export includes source truth;
- re-index can delete/rebuild derived memory without destroying source history;
- sensitive payload policy is explicit.

### P0 — Separate personal decision semantics from action-authority semantics

Do this first at type/API/documentation boundaries; avoid destructive DB migration until compatibility is understood.

Acceptance criteria:

- new code uses `PersonalDecision` vs `ActionJudgment`;
- new code uses `DecisionOutcomeJournal` vs `ExecutionOutcome`;
- UI never presents journal outcomes as CP8 VERIFIED outcomes;
- Control Center remains action-authority-only.

### P1 — Complete the personal decision feedback loop in UI

The backend already stores rich decision metadata and outcome journals. The Timeline currently under-exposes them.

Add an inspect/review experience showing:

```text
decision question
→ selected option
→ goals / constraints / assumptions
→ expected outcome
→ actual outcome
→ failed assumptions / unexpected factors
→ lessons
→ follow-up / revisit
```

Do not require manual form-filling for every decision. AI/MCP-assisted capture remains the preferred path.

### P1 — Provider boundary

After source truth is stable, introduce narrow provider contracts rather than integrating several vendors at once.

Initial seams:

```ts
interface MemoryProvider {
  ingest(sourceRefs: string[]): Promise<void>
  recall(query: string, context?: unknown): Promise<unknown[]>
  reflect?(query: string, context?: unknown): Promise<unknown>
  rebuild?(sourceRefs?: string[]): Promise<void>
  health(): Promise<unknown>
}
```

Separate Graph / Embedding / Reasoning providers only when a real replacement requires it.

### P2 — Evaluate external memory engines

Only after P0/P1.

The benchmark should use the same user-owned source set and compare:

- retrieval usefulness;
- temporal correctness;
- contradiction handling;
- decision-context quality;
- source traceability;
- rebuild cost;
- local/self-host feasibility.

---

## 11. Draft PR disposition

### PR #5 — release/security truth sync

Recommendation: **preserve and likely land before structural refactoring**, after normal owner review.

Reason:

- fixes known dependency/security baseline problems;
- fixes Windows resolver portability;
- corrects stale release claims;
- does not redefine the core code architecture.

### PR #6 — evidence diagnostics

Recommendation: **preserve, do not discard**, but treat as Action Safety Layer work.

It is useful for advanced execution governance, not the next consumer-product priority.

### PR #7 — revision supersession

Recommendation: **preserve, do not discard**.

Its distinction between current and superseded authority judgments is correct. It should stay scoped to Action Judgment history and should not be conflated with Personal Decision lineage.

The branch's installed supersession gate remains `PREPARED_NOT_EXECUTED` and must not be upgraded by documentation alone.

---

## 12. Product thesis after reconciliation

A concise product definition that matches the implemented system better than either historical extreme:

> **Omni-Context is a user-owned personal AI context and decision layer that continuously carries a person's history across AI systems, helps them make and revisit decisions, and adds a stricter evidence/authority loop when AI is allowed to act on the world.**

Short version:

> **Your context outlives every model.**

System invariant:

> **Source truth is owned by the user. Intelligence is replaceable.**

Interaction invariant:

> **The user should not have to maintain a memory database in order to benefit from long-term memory.**

Safety invariant:

> **Advice can be probabilistic; side effects require explicit authority and independent reality checks.**

---

## 13. What we should not do next

Do not begin another broad Goal-series feature sprint.

Do not immediately add Hindsight, Graphiti, Mem0, ActivityWatch, Gmail, Calendar and other connectors simultaneously.

Do not rewrite the Desktop around a new dashboard.

Do not delete the current graph/retrieval implementation before a provider contract and rebuild path exist.

Do not merge Personal Decision semantics with CP6/CP7/CP8 authority semantics.

Do not promote draft branch capabilities to current-user-facing claims.

---

## 14. Next concrete engineering sequence

```text
R0  Freeze this reconciliation + terminology
 ↓
R1  Canonical Source / Raw Event layer
 ↓
R2  Route all existing acquisition paths through it
 ↓
R3  Prove export → wipe derived state → rebuild
 ↓
F1–F5  Frontend experience rebuild
        Ask / Journey / Library / Advanced
        (includes Personal Decision → Outcome → Lesson UI)
 ↓
R5  Introduce MemoryProvider seam around current native implementation
 ↓
R6  Benchmark one external memory provider against native
 ↓
R7  Only then decide what native memory code to retire
 ↓
R8  Resume Action Safety / Control Center work as an advanced lane
```

The first code change after this audit should therefore **not** be a new memory engine.

It should be the canonical source-truth layer that makes memory engines safely replaceable.

---

## 15. Frontend redesign track

The frontend is now a first-class product workstream, not a final cosmetic pass.

See:

- `docs/frontend-experience-reconciliation.md`

Key rule:

> Omni remains ambient-first, but when the Desktop is opened it must be human-centered rather than graph-centered.

The frontend rebuild will preserve the current capture/HUD/browser/MCP interaction model while reorganizing the Desktop around four modes:

```text
Ask
Journey
Library
Advanced
```

The current GraphViewer, DecisionTimeline, InsightsInbox, MemoryManager and ControlCenter are treated as reusable capability surfaces to be recomposed, not discarded wholesale.
