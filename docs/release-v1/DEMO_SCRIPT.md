# Omni-Context V1 Release Demo Script

> Status: release-preparation draft
> Truth baseline: Goal29 V1 feature freeze + DRG2 authoritative PASS
> Rule: never present an INTERNAL capability as a public user-facing feature.

## Demo goal

In 90 seconds, make one idea obvious:

> Omni-Context is not just memory. It is a local judgment layer that keeps evidence, decisions, authority, outcomes, and revision history connected.

The public demo has two clearly separated parts:

- **Part A — User-facing today (CURRENTLY_VERIFIED):** installed Desktop flow.
- **Part B — Controlled runtime proof (CURRENTLY_VERIFIED_INTERNAL):** the already-verified GitHub issue-close closed loop. This is evidence of the architecture, **not a public GitHub automation feature**.

---

## 0. Pre-recording truth checks

Before recording:

- Use the Goal29-frozen Windows V1 build or an artifact derived from the same verified baseline.
- Do not show `omctx` as an npm-installed public product.
- Do not show `omctx reopen` as implemented.
- Do not say "works with any AI", "works with any runtime", or "provider-independent".
- Do not imply process exit 0 means semantic success.
- If Part B is shown, put the label **INTERNAL CONTROLLED RUNTIME PROOF — NOT A PUBLIC FEATURE** on screen.

---

## Part A — Public V1 product demo (about 55–65 s)

### Shot 1 — The problem (0–8 s)

**Visual:** Omni-Context Desktop opens to a populated local workspace.

**On-screen copy:**

> AI agents remember things.  
> The harder problem is knowing what is still valid — and what a decision was based on.

**Voiceover:**

> Long-lived agents do not just need more memory. They need evidence that can be qualified, traced, and revised when reality changes.

### Shot 2 — Local evidence substrate (8–20 s)

**Visual:** import/capture a small project artifact, then show search / graph / timeline results.

Use only already verified public surfaces:
- import/capture
- hybrid search / Ask Brain
- graph/timeline
- source/time metadata

**On-screen copy:**

> Local-first evidence  
> source + time + relationships

**Voiceover:**

> Omni-Context keeps the evidence locally, with its source, time, and relationships, instead of reducing everything to a flat chat memory.

### Shot 3 — Decision context (20–36 s)

**Visual:** open the decision surface / saved decision context. Show a decision with supporting evidence and constraints. Avoid any unverified execution button.

**On-screen copy:**

> Evidence → Decision  
> not “prompt → action”

**Voiceover:**

> A decision is stored with the evidence and constraints that justified it. The judgment history remains inspectable instead of disappearing into a conversation transcript.

### Shot 4 — Revision / lineage (36–52 s)

**Visual:** show Decision A, then Decision B / lineage view from the installed E2E path. Make the relationship between the older and newer judgment visible.

**On-screen copy:**

> Decisions have lineage.

**Voiceover:**

> When the situation changes, Omni-Context preserves the earlier judgment and its lineage instead of silently overwriting history.

Do **not** call this the `omctx reopen` user UX. That command remains FUTURE.

### Shot 5 — Persistence / ownership (52–62 s)

**Visual:** restart persistence or export/restore clip.

**On-screen copy:**

> Local-first. Persistent. Owned by you.

**Voiceover:**

> The state survives restart and can be exported and restored. There is no required cloud account or remote authority.

---

## Part B — Architecture proof, explicitly INTERNAL (about 20–25 s)

### Shot 6 — Real controlled GitHub E2E (62–84 s)

**Permanent overlay:**

> INTERNAL CONTROLLED RUNTIME PROOF  
> NOT A PUBLIC GITHUB AUTOMATION FEATURE

**Visual sequence based on the already-recorded authoritative proof:**

```
GitHub issue = OPEN
↓
decision + approval binding
↓
restricted execution
↓
process exit = 0
↓
outcome = PENDING
↓
independent read-back = CLOSED
↓
deterministic evaluator = VERIFIED
```

**Voiceover:**

> In the controlled runtime proof, an approved GitHub issue-close actually changed the external world. But exit code zero still did not count as success. The outcome stayed pending until an independent read-back observed the issue closed; only then did the deterministic evaluator mark it verified.

### Shot 7 — End card (84–90 s)

**Visual:** clean end card.

**Primary line:**

> Evidence-grounded decision control for long-lived AI agents.

**Secondary line:**

> Qualify → Bind → Read-back → Revise

**Trust anchor:**

> Local-first, read-back verified, and owned by you.

**Footnote:**

> Public V1 surfaces and internal controlled-runtime evidence are labeled separately.

---

## What this demo intentionally does not claim

- no "works with every AI"
- no "works with every runtime"
- no public GitHub write automation claim
- no public npm `omctx` claim
- no implemented `omctx reopen` claim
- no automatic rollback
- no LLM-as-judge
- no generic shell agent
- no deployment-readiness claim derived from the research benchmark
- no cross-provider research claim

---

## Recording assets checklist

Required:
- Goal29-frozen Windows installer/build
- a clean local demo profile
- 2–3 small non-sensitive demo artifacts
- one decision + a later revised/linked decision
- restart/export/restore clip
- DRG2 authoritative E2E evidence clip or reconstructed screen sequence clearly labeled INTERNAL
- final end card

Optional:
- graph animation
- timeline animation
- source/time metadata close-up
- brief architecture diagram

## Acceptance gate for the recording

The demo is acceptable only if a viewer can answer all four:

1. What is Omni-Context now?  
   **Evidence-grounded decision control for long-lived AI agents.**
2. Why is it more than memory?  
   **It connects evidence to bounded decisions and preserves judgment history.**
3. Why is read-back important?  
   **A successful process is not proof that the intended external state changed.**
4. Which shown capabilities are public vs internal?  
   **The video labels them explicitly.**
