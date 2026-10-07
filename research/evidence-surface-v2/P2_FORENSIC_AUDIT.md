# V1 P2 Forensic Audit — Initial Findings

**Purpose:** separate what the frozen V1 experiment actually establishes from stronger claims that the current manuscript cannot support.

**Source:** frozen P1/P2 artifacts only. No sample, policy, retriever, gate, or outcome was modified.

## 1. C5 is an oracle-gate sanity check

Frozen policy behavior:

- if `coverage_complete === false`, return `DEFER`;
- otherwise run the ordinary policy.

Frozen UDR definition:

- unsupported iff action is decisive **and** formal coverage is incomplete.

Therefore C5 UDR is mechanically 0 whenever the coverage bit is correct.

Conclusion:

- keep C5 as an **oracle completeness upper bound / sanity check**;
- do not present C5=0 as a standalone method contribution.

## 2. UDR and actual action divergence are not equivalent

Secondary audit against the frozen world contract / C0 decision:

| Condition | UDR count | Decisive action-family violations | Decisions differing from C0 |
|---|---:|---:|---:|
| C0 FULL | 0 | 0 | 0 |
| C1 HIDDEN | 30 | 30 | 30 |
| C2 Lexical | 56 | 18 | 18 |
| C3 Hash-dense | 61 | 23 | 23 |
| C4 Hybrid | 53 | 24 | 24 |
| C5 Coverage-aware | 0 | 0 | 0 |

All C1 unsupported decisions are actual action-family divergences.

For retrieval conditions, many UDR events are support failures without a changed final action:

- C2: 56 unsupported, but 18 diverge;
- C3: 61 unsupported, but 23 diverge;
- C4: 53 unsupported, but 24 diverge.

Family decomposition shows the action-family divergences occur in F6; F1/F2/F4 unsupported decisions under C2–C4 preserve the same full-evidence action family/candidate.

Conclusion:

- UDR must remain a support metric;
- V2 must report a separate world-action / decision-divergence metric.

## 3. F6 is not cue-free in the strong sense

In all 30 frozen F6 formal samples:

- treatment target role = `override`;
- the older standing-instruction evidence remains labeled `currentness: "superseded"`.

After the override is hidden in C1, the downstream input therefore still contains a state cue: the old instruction is explicitly marked superseded.

The frozen policy does not treat `currentness === "superseded"` as a mandatory fallback trigger. Its visible-gap rules inspect role-level patterns such as `stale_fact`, but not the superseded marker.

Conclusion:

V1 establishes:
> the frozen policy's declared gap checks do not catch this omission.

V1 does **not** establish:
> the input contains no detectable cue for any policy.

The manuscript language “no local cue” / “undetectably missing” is therefore too strong for V1.

V2 must use surface-identical paired worlds for a strong indistinguishability claim.

## 4. C1 recall = 16.67% is explainable, not a bug

Under C1:

- F1 required-fact recall = 0.5;
- F2 required-fact recall = 0.5;
- F3 = 0;
- F4 = 0;
- F5 = 0;
- F6 = 0.

Equal family weighting gives:

`(0.5 + 0.5 + 0 + 0 + 0 + 0) / 6 = 1/6 = 16.67%`.

The paper should explain this structure explicitly.

## 5. Bootstrap interval has a narrow interpretation

The frozen primary bootstrap resamples all 180 sample-level C1-C0 differences.

But the direct family effects are deterministic in the frozen benchmark:

- F1–F5: all 0;
- F6: all 1.

Thus the reported bootstrap interval largely reflects variation in how often F6 examples are resampled, not uncertainty across policies or real-world tasks.

Conclusion:

- retain the preregistered result for transparency;
- explicitly bound its interpretation;
- do not use the narrow CI as evidence of external generality.

## 6. Immediate implication

Do not spend effort defending V1 as submission-ready.

Preserve it as a controlled baseline and use V2 to add:

- actual-action metrics;
- surface-identical paired worlds;
- a non-oracle completeness mechanism;
- independent policies / LLMs;
- stronger retrieval controls;
- anonymous one-command reproducibility.
