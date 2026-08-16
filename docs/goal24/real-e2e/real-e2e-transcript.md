# Post-CP8 Real E2E — Human Transcript

**What happened, in plain language.** A real GitHub issue was closed by
Omni-Context through the full trust chain, and Omni refused to call that
"success" until it independently re-read GitHub and saw CLOSED with its
own trusted eyes.

## User intent

The operator asked Omni-Context to close one disposable fixture issue:
`guo6x/Omni-context#2` — "[DRG2-E2E] Disposable issue-close verification
fixture". The issue was created OUTSIDE Omni purely for this verification
and its body says so. The one real pre-existing issue (#1) was never
touched.

## What Omni knew (before doing anything)

1. Omni read the live GitHub state through the pinned `gh.exe` with fixed
   machine-readable queries — the issue existed and was OPEN, and the
   repository identity checked out. This evidence was qualified through the
   CP6 Evidence Guard: action = **proceed**, reason = EVIDENCE_SATISFIED.
2. Omni wrote a decision: close exactly `guo6x/Omni-context#2`
   (decision `c3a2c692-c6ba-4861-8651-4a8e46002d81`).

## Why approval was required

Closing an issue is a **reversible write with an external side effect** on
a shared tracker. The capability is declared `reversible_write / medium /
L2`, so the fixed CP7 policy marked the plan **approval REQUIRED** — no
LLM, skill or caller can grant it. A human operator wrote a one-time
approval artifact (`APPROVE guo6x/Omni-context#2`), which the native
authority consumed (single-use) before anything could spawn.

## What exactly was executed

Only one fixed command shape, built from validated inputs, with the pinned
validated `gh.exe` and no shell:

    gh issue close 2 --repo=guo6x/Omni-context

**PROCESS EXIT = 0.**

## Why exit 0 was NOT trusted

Exit 0 means "the process finished with code 0" — nothing more. Omni
persisted that fact as a native receipt (`rcpt_45c2518c8e4724f830f178cc63a0a32d`,
state Completed, exit 0) and the Outcome stayed **PENDING**.

> THE DEMO MOMENT: PROCESS EXIT = 0, but OUTCOME = PENDING.

The close command's own stdout is never even parsed as truth; it is kept
only as a bounded audit digest.

## What GitHub looked like after execution

Omni then ran an **independent read-back** through the trusted
read-only capability `github.issue.read`:

    READBACK STATE = CLOSED (number = 2)

This is a fresh query to GitHub, not the write command's output.

## Why the final Outcome became VERIFIED

A deterministic trusted evaluator (no LLM, no prompt, no predicate) took
the approved plan's expectation — "issue `guo6x/Omni-context#2` must be
CLOSED" — and compared it with the trusted read-back payload: exact
subject, exact number, state CLOSED.

    FINAL OUTCOME = VERIFIED

The OutcomeRecord was persisted with the attempt history
(`out-19d9bfdf-3a35-4b9a-bf63-89c7dc19103d`), `revisit_required = false`.
An independent `gh issue view` outside Omni confirmed GitHub state CLOSED
(stateReason COMPLETED, closedAt 2026-08-16T02:17:42Z).

## The chain, end to end

Evidence (live read, guard proceed) → Decision (exact subject) → Approval
(required, human-granted, single-use, consume-before-spawn) → Restricted
broker execution (exit 0) → Persistent native receipt → Independent
read-back (CLOSED) → Trusted deterministic evaluator → **VERIFIED** →
revisit_required = false.

Machine-readable record: `docs/goal24/real-e2e/real-e2e-proof.json`.

*Note on iteration honesty: the first two native-phase rehearsals used an
earlier harness export and were reverted by reopening the disposable
fixture outside Omni; the transcript and proof above reflect the single
clean verified run.*
