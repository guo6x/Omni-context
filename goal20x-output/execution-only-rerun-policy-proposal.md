# Goal20X — V3-R1 Execution-Only Rerun Policy Proposal (DRAFT for owner decision)

- Status: **V3_R1_EXECUTION_ONLY_RERUN_ELIGIBLE**
- Do NOT launch automatically. This is a frozen-policy proposal only.
- Root cause: `PROVIDER_STOCHASTIC_JSON_EMPTY` (official DeepSeek JSON-mode empty-content behavior; E1 profile: complete JSON emitted in `reasoning_content`, empty final `content`, HTTP 200, finish_reason=stop, sub-second latency).
- No model-visible request defect, no executor state/order defect, no scientific/method issue found.
- Any prompt / response_format / schema / parameter / serialization change would reclassify V3-R1 as `POST_FAILURE_DIAGNOSTIC_SET` and require `UNSEEN_VALIDATION_V3_R2` — this proposal changes NONE of those.

## 1. Diagnosed mechanism (what the proposal follows from)

- Frozen executor re-fires EMPTY_CONTENT retries with **no backoff and no jitter** (V2.4 frozen backoff applies to transport class only; run.mjs:302-309).
- Observed consecutive empty attempts: ~2.1–2.7 s apart, byte-identical request bodies, high prompt cache hits (e.g., cached=2176, miss=65), provider latency 84–516 ms — consecutive retries re-hit the same provider fast-empty path (temporally correlated, not independent draws).
- V2.4's only recovery of the same tuple (711/A3) followed a ~43 s inter-attempt gap (attempts 1–3 empty at 04:47:01–06, success at 04:47:49); V3-R1's five ~2.6 s retries all failed.
- Transport class already has frozen exponential backoff (2 s/5 s/15 s/30 s/60 s + deterministic tuple-derived stagger) and recovered cleanly in V2.4/V3-R1.

## 2. Proposed frozen execution-policy change (uniform, minimal, non-sample-specific)

1. Apply **bounded exponential backoff + deterministic tuple-derived stagger to qualifying EMPTY_CONTENT retries**, identical to the frozen transport pattern:
   - base delays: `[5000, 15000, 45000, 120000, 300000] ms` (proposal values; owner may adjust)
   - stagger: existing frozen `transportStaggerMs(tuple)` (0–1000 ms, tuple-hash-derived) so retries spread deterministically
2. Keep `EMPTY_CONTENT_MAX_ATTEMPTS = 5` (initial + 4 retries). Optionally (owner decision) 6 total attempts with the 5 delays above. **No "5 failed → 10" fishing.**
3. Applies **uniformly to every provider tuple** (A0–A3) that hits a qualifying EMPTY_CONTENT. No sample/TT/arm-specific behavior.
4. Request bytes, system/user prompts, output schema, response_format, model, thinking/reasoning_effort/max_output_tokens/temperature, retry taxonomy classes — **all unchanged**.
5. No new diagnostic provider calls are required by this proposal.

## 3. Failure-closed guarantees

- If a replacement run again exhausts the frozen (possibly amended) EMPTY_CONTENT budget on any tuple → executor FAILED marker → fail closed and report; **no further automatic tuning** (consistent with V2.4 amendment §9/§10 and Goal20X §17).
- If the amended policy still fails the same tuple, the next step is a new owner scientific decision (potentially diagnostic calls per Goal20X §9–11 or V3-R2).

## 4. What the owner must decide

1. Approve V3-R1 execution-only rerun under an amended frozen execution policy (new run instance, 0/720, same campaign lineage `goal20-formal-validation-v1`, epoch v3).
2. Approve the exact backoff schedule and attempt budget (proposal: 5 attempts; delays 5 s/15 s/45 s/120 s/300 s + stagger).
3. Confirm no prompt/schema/parameter change (model-visible bytes identical to V3-R1).
4. Optionally authorize a precommitted diagnostic plan (Conditions A/B/C on dev/reg/synthetic fixtures only) to resolve the TT15-006 concentration question before rerun — not executed by this task.

## 5. Traceability

- Proposal follows Goal20X §14 (decision branch A) and §17 (no attempt-limit fishing; policy follows the diagnosed temporally-correlated mechanism).
- Evidence files: `goal20x-output/root-cause-classification.json`, `goal20x-output/analysis-stratified.json`, `goal20x-output/empty-content-census.jsonl`, `goal20x-output/request-reconstruction.json`, `goal20x-output/executor-state-leak-audit.json`, `goal20x-output/official-evidence/`.