# Omni-Context Frontend Experience Reconciliation

**Status:** frontend product audit / redesign brief  
**Code baseline:** `main@d4d61f1c9b73d8a127023129adc3376ec6d7db13`  
**Date:** 2026-10-04

This document does not redefine Omni's interaction model. Omni remains ambient-first:

- capture happens while the user works elsewhere;
- connected AI clients are first-class interfaces;
- proactive cognition can surface without opening the Desktop;
- Desktop exists when the user wants to ask, inspect, correct, review, configure or authorize.

The purpose of the frontend rebuild is therefore not to turn Omni into a dashboard product. It is to make the Desktop and companion surfaces feel coherent, human-centered and trustworthy when they are opened.

---

## 1. Current frontend truth

The current Desktop is functionally rich, but the information architecture grew feature-by-feature.

The root screen is effectively:

```text
Header
  upload / HUD / refresh / more / settings
        ↓
GraphViewer as the main stage
        ↓
secondary surfaces mostly opened as overlays/modals
```

Important secondary surfaces include:

- Insights Inbox;
- Decision Timeline;
- Memory Manager;
- Control Center;
- Upload;
- Hardware pairing;
- Settings;
- Onboarding;
- Floating HUD.

This has two consequences.

First, **the graph has become the visual center of the product even though it is not the center of user value**.

Second, **Personal Cognitive features and Action Safety features are siblings in the same overflow menu**, even though they belong to different product layers.

The code also reflects accumulated shell complexity: `page.tsx` owns many boolean modal states and orchestration concerns that should eventually be separated into a navigation/shell model.

---

## 2. What is already good and should survive

### 2.1 Ambient interaction

Keep:

- system tray residency;
- global capture shortcut;
- Floating HUD;
- close-to-tray behavior;
- browser capture;
- proactive notifications;
- connected-AI MCP interaction.

The frontend redesign must not require users to open the main window more often.

### 2.2 The "Ask Brain" interaction

The current GraphViewer command bar already contains a strong product interaction:

- ask a grounded question;
- continue multi-turn;
- inspect reasons/sources;
- save an answer as a decision;
- revisit discussion history.

This should become more visually central when the Desktop is opened.

It should no longer be conceptually coupled to "viewing the graph."

### 2.3 Value-first onboarding

The current onboarding sequence has the right overall intent:

1. connect a reasoning engine;
2. import history and prove Omni understood it;
3. connect another AI client;
4. establish the capture habit.

Keep this logic, but reduce infrastructure language and improve the first-use proof.

### 2.4 Inspect / correct surfaces

Memory Manager, source/provenance views, privacy controls and export controls are important precisely because Omni claims user ownership.

These should remain accessible, but not compete with the primary cognitive experience.

---

## 3. Main frontend problems

### P0 — Graph-first information architecture

The graph is currently the default canvas.

A knowledge graph is a useful inspection/debug/power-user view, but most users do not open a personal AI product because they want to manipulate nodes and edges.

The default Desktop surface should answer:

> What can Omni help me do right now?

not:

> What does my graph look like?

### P0 — Personal cognition and action governance are visually mixed

The More menu currently places:

- Insights;
- Decision Log;
- Control Center;
- Memory Manager;

at roughly the same hierarchy.

This makes the product category ambiguous.

Control Center should be visually and navigationally subordinate to normal personal cognition. It is an advanced safety surface for side-effecting actions.

### P0 — The most important human loop is split across separate components

Today, these are separate UI islands:

```text
Ask Brain
Decision Timeline
Outcome recording
Insights Inbox
Memory Manager
```

But to a user they are one loop:

```text
What am I thinking about?
→ What did I decide?
→ Why?
→ What happened?
→ What did I learn?
→ What should I revisit?
```

The rebuild should present this as one coherent personal history, without forcing the user to manually maintain it.

### P1 — Root shell complexity

`page.tsx` currently carries many unrelated concerns:

- daemon status;
- graph fetching;
- HUD state;
- file drop;
- settings state;
- upload state;
- hardware state;
- insights polling;
- decision modal;
- memory manager;
- Control Center;
- onboarding;
- update UI;
- offline recovery.

This works, but it makes future UX evolution expensive and fragile.

### P1 — Infrastructure language leaks into consumer UX

Current UI uses terms such as:

- Brain Server;
- graph;
- entities;
- relationships;
- MCP;
- Control Center;
- execution outcome;
- revision;
- evidence diagnostics.

These are legitimate advanced concepts, but should not be required vocabulary for ordinary use.

### P1 — Important surfaces are hidden or modal-heavy

Insights and decisions are valuable enough to deserve durable navigation/context.

At the same time, ordinary users should not face a giant permanent sidebar full of technical sections.

The shell needs a small, stable information architecture rather than more buttons.

---

## 4. Target interaction architecture

### 4.1 Ambient surfaces remain primary

Outside the main window:

```text
Browser / AI client / Desktop work / hardware
                │
                ├─ capture
                ├─ retrieve context
                ├─ save decision/conclusion
                └─ proactive signal
```

This remains the primary day-to-day Omni interaction.

### 4.2 Desktop becomes a human-centered "Omni Shell"

When the user intentionally opens Omni, provide four top-level modes.

#### Ask

Default entry.

Purpose:

- ask about personal history;
- ask for decision support;
- continue previous conversations;
- inspect cited source context;
- save a conclusion/decision when useful.

This should reuse the current `graph_answer` / discussion work but move the mental model from "graph command bar" to "talk to my long-term context."

#### Journey

Human-readable longitudinal history.

Combines:

- important events;
- personal decisions;
- decision lineage;
- expected outcomes;
- actual outcome journals;
- lessons;
- revisit reminders;
- meaningful proactive insights.

The primary unit is not a graph node. It is a moment in the person's evolving context.

#### Library

Inspect / correct / control source and memory.

Includes:

- sources/imports;
- memories;
- provenance;
- current vs historical facts;
- merge/review queues where appropriate;
- export;
- delete/correct controls;
- privacy visibility.

Graph view belongs here as an optional expert visualization.

#### Advanced

Technical and safety controls.

Includes:

- Action Safety / Control Center;
- MCP/client connections;
- provider diagnostics;
- embedding/index diagnostics;
- hardware/device management;
- developer-level logs.

Most users should rarely need this mode.

---

## 5. Proposed Desktop shell

```text
┌──────────────────────────────────────────────────────┐
│ Omni                                Capture ●   ⚙    │
├──────────────┬───────────────────────────────────────┤
│              │                                       │
│ Ask          │                                       │
│ Journey      │           current workspace            │
│ Library      │                                       │
│              │                                       │
│ ──────────   │                                       │
│ Advanced     │                                       │
│              │                                       │
└──────────────┴───────────────────────────────────────┘
```

Rules:

- Sidebar can collapse to icons.
- Do not show server/process health in the normal header unless unhealthy.
- Capture state must remain visible and trustworthy.
- Advanced can be collapsed/hidden until explicitly opened.
- Graph is not a top-level identity.
- Control Center is not a peer of personal decisions.
- "Ask" should be keyboard-first and immediately usable.
- Proactive insights may surface contextually inside Ask/Journey instead of living only in an Inbox modal.

This is a Desktop shell design only. It does **not** mean users are expected to spend their day inside the app.

---

## 6. Ask surface

The current command-bar behavior is valuable but visually attached to the graph.

Target layout:

```text
Ask anything about your history, work or decisions
[________________________________________________]

Recent threads
- Should I keep building X?
- What changed in my priorities this month?
- Why did I stop project Y?

Answer
Conclusion
Why Omni thinks this
Sources
What is uncertain

[Continue]  [Save conclusion]  [This is a decision]
```

Critical behavior:

- sources remain inspectable;
- uncertain / conflicting context is visible;
- decision detection should be assistive, not force a form;
- a user can jump from an answer to the relevant Journey moment or Library source;
- graph highlighting is optional secondary evidence visualization.

---

## 7. Journey surface

This is the frontend area that most directly unlocks the value already present in the backend.

Example:

```text
2026-10-04
Omni product direction changed

You decided:
Keep Omni as a personal AI context/decision layer.

Why:
- preserve user-owned context
- use best external memory engines
- keep action safety as advanced lane

Expected:
Build a source-truth layer before provider integration.

Outcome:
Pending

Revisit:
after source rebuild proof
```

Later:

```text
Outcome recorded
- rebuild succeeded
- external provider replaced native recall without data loss

Lesson
- source ownership mattered more than retrieval implementation

This changed:
next decision ...
```

The Journey should allow history to emerge from normal use rather than asking users to manually curate every entry.

---

## 8. Library surface

The current Memory Manager is powerful but maintenance-oriented.

Reframe Library around user ownership:

### Sources

"What did Omni receive?"

- AI conversations;
- uploaded files;
- browser captures;
- desktop captures;
- manual notes;
- future connectors.

### Derived context

"What did Omni infer?"

- facts;
- goals;
- preferences;
- projects;
- principles;
- decisions;
- relationships.

### Corrections

"What does Omni have wrong or uncertain?"

- conflicts;
- stale state;
- merge candidates;
- low-confidence extracted facts;
- user corrections.

### Export / portability

"Can I take everything with me?"

- full source export;
- derived context export;
- portable backup;
- provider rebuild state.

This becomes much more important after the Canonical Source layer is implemented.

---

## 9. Advanced / Action Safety surface

Do not delete Control Center.

Instead clarify what it is:

> A safety console for AI actions that can change external reality.

Keep detailed objects such as:

- evidence qualification;
- plan;
- approval;
- execution receipt;
- read-back;
- execution outcome;
- judgment revision;
- superseded judgment history.

This surface can stay information-dense because its users need precision.

It should not determine the visual language of the entire consumer product.

---

## 10. Visual direction

The current dark/cyan technical aesthetic is coherent, but the rebuild should reduce "developer dashboard" density.

Direction:

- dark-first remains acceptable;
- fewer glowing borders and status chips in ordinary flows;
- larger readable typography for conclusions and personal history;
- stronger visual separation between source fact, AI inference and user decision;
- restrained motion;
- graph visualization as an optional analytical mode;
- technical identifiers hidden behind disclosure controls;
- ordinary language by default, exact IDs/details on demand.

Trust should come from inspectability, not from showing infrastructure everywhere.

---

## 11. Component architecture target

Do not keep adding conditional overlays to `page.tsx`.

Target shell:

```text
AppShell
├─ GlobalStatus
├─ CaptureIndicator
├─ PrimaryNavigation
├─ AskWorkspace
├─ JourneyWorkspace
├─ LibraryWorkspace
├─ AdvancedWorkspace
└─ GlobalOverlays
   ├─ Upload
   ├─ Settings
   ├─ Onboarding
   └─ Confirm/Toast
```

The current components can be migrated rather than rewritten simultaneously:

- GraphViewer → Ask + Library/Graph pieces;
- DecisionTimeline → Journey;
- InsightsInbox → Journey/contextual proactive cards;
- MemoryManager → Library;
- ControlCenter → Advanced;
- SettingsPanel → global settings;
- FloatingHUD remains independent.

---

## 12. Frontend execution sequence

Do not start this before the source-truth contract is sufficiently stable, because Library/Sources needs a real source model.

### F0 — UX truth freeze

- freeze this information architecture;
- inventory current routes/components/actions;
- define ordinary vs advanced vocabulary;
- no visual rewrite yet.

### F1 — Shell extraction

- split `page.tsx` orchestration from workspaces;
- introduce stable app navigation state;
- preserve all existing behavior;
- no feature removal.

### F2 — Ask-first experience

- extract current command bar / answer / discussion UX from GraphViewer;
- make Ask the default Desktop workspace;
- keep source citations and jump-to-context;
- keep graph as optional evidence visualization.

### F3 — Journey

- merge Decision Timeline + outcome journal + lessons + revisit reminders + relevant proactive insight presentation;
- no forced manual bookkeeping.

### F4 — Library / Sources

- build source-first inspection after Canonical Source layer lands;
- expose "received vs inferred";
- corrections / provenance / export;
- place graph here.

### F5 — Advanced separation

- move Control Center and technical diagnostics into Advanced;
- preserve authority precision;
- reduce exposure to ordinary users.

### F6 — Visual system pass

- typography;
- spacing;
- iconography;
- state hierarchy;
- motion;
- empty/loading/error states;
- responsive behavior;
- accessibility;
- localization consistency.

### F7 — Installed-app product test

Validate the real packaged Desktop, not only browser dev mode:

- first run;
- import;
- ask;
- decision;
- outcome/revisit;
- proactive insight;
- privacy pause;
- offline/recovery;
- update;
- Advanced action workflow.

---

## 13. Relationship to backend roadmap

The frontend work should be inserted into the current architecture sequence as follows:

```text
R0  architecture reconciliation
 ↓
R1  canonical source/raw-event layer
 ↓
R2  route acquisition through source layer
 ↓
R3  prove export → wipe derived → rebuild
 ↓
F1–F5  frontend experience rebuild
 ↓
R5  MemoryProvider seam
 ↓
R6  benchmark external memory provider
 ↓
R7  decide native memory retirement
 ↓
R8  continue Action Safety advanced lane
```

Some shell extraction (F1) can begin in parallel with R1/R2 if it does not depend on the new source schema.

---

## 14. Frontend acceptance test

The redesign is successful when a new user can understand the product without knowing the words:

- GraphRAG;
- entity;
- assertion;
- MCP;
- CP6/CP7/CP8;
- execution broker;
- evidence diagnostics.

And a power user can still drill down to all of them.

The intended feeling is:

> "This is my long-term AI context."

not:

> "This is a graph database and agent governance console I need to operate."
