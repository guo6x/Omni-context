# Omni-Context Candidate v3.1 — LongMemEval-S Formal Evaluation (ENGINE MODULE RESOLVED)

## Final Status

```
READY_FOR_NEW_AUTHORIZATION
```

## Blocker Resolution

```
MISSING_ENGINE_MODULE = RESOLVED
FORMAL DATASET ACCESSED = false
FORMAL PROVIDER CALLS = 0
FORMAL RUN STATUS = READY_FOR_NEW_AUTHORIZATION
```

## Summary

This directory archives the formal LongMemEval-S sealed held-out evaluation attempt for Omni-Context Candidate v3.1. The evaluation was initially blocked at Phase 6 because the sealed runner required an `--engine-module` exporting `createEngine({productCommit, isolatedDatabase, dynamicPort})`, and no such module existed.

The blocker has been resolved. A frozen engine adapter module (`external-eval/engines/omni-frozen-v3.1.mjs`) has been implemented, tested (22 tests, all passing), and committed. The adapter wraps the frozen brain-server HTTP API and CognitiveProvider without modifying any product code. A preregistration v2 has been created documenting the engine adapter commit, file hash, and all preserved experimental parameters.

**No formal data was accessed, no Provider was called, and no Gold was opened during the resolution.** This was evaluation-side infrastructure development only.

## Resolution Details

- **Engine Adapter Commit**: `e98ab1039091481c2b3e1bb34dfec07acaa3532c`
- **Engine Adapter File**: `external-eval/engines/omni-frozen-v3.1.mjs`
- **Engine Adapter File SHA-256**: `eacb6e2c7997d913715d682d9f0c2a234f3ac1d18639ca0de3b2db9a9d6ec309`
- **Engine Interface**: `createEngine-v1` (exports `createEngine`, `ingest(session)`, `query({question, questionDate})`, `stop()`)
- **Answer Path**: `session ingestion → rebuild embeddings → unified_memory_search Top-10 → map evidence → CognitiveProvider.answer() → structured.answer`
- **graph_answer Used**: false (temperature 0.4 prohibited; formal path uses temperature 0)
- **Preregistration v2 Commit**: `d03238dd584538958e4c5c8e20f263cbe821506c`
- **Preregistration v2 File**: `external-eval/preregistration/longmemeval-v2.json`
- **Validate-only Commit**: `9ca1c6d` (recognizes v2, verifies engine adapter file hash)
- **All v1 experimental parameters preserved** (product commit, build hash, answer model, temperature, max_tokens, thinking, top-k, prompt hash, concurrency, retry policy)

## What Was Completed

### Initial Run (Blocked)
- Phase 0: Version verification — PASSED
  - HEAD = `5ab7ed3bd74361a313e9ccbe715773e3a8598980`
  - Freeze tag `evaluation-freeze-candidate-v3.1` = `17dc1d0107b0474de84058205a91b302ba290a74`
  - `--validate-only` = VALID, formal_run=false, heldout_accessed=false
  - Worktree clean
- Adapter commit `066b63cb0b72d6aa494804864f59bfc05be5a734` verified
- Preregistration SHA-256 computed: `05205f6a074ba8b044051c00e045b4f943f40d974ccfb075b1357f34097bcc15`
- Provider credentials verified available (DeepSeek, from external secrets file)
- OPENAI_API_KEY confirmed NOT available (official scoring would be PENDING)

### Resolution Round
- Engine adapter module created, tested, committed
- Preregistration v2 created with engine adapter metadata
- `validate-only` updated to recognize v2 and verify engine adapter file hash
- All tests passing (22 engine tests + 12 sealed-runner tests)
- `--validate-only` returns VALID with `engine_adapter_verified: true`

## What Was NOT Done

- No formal dataset downloaded or accessed
- No Provider calls made
- No Gold accessed
- No formal generation run
- No official scoring

## Next Steps

To proceed with the formal evaluation:
1. A custodian must create a new authorization file matching all v2 preregistration hashes
2. The formal run can proceed from Phase 1 using `--engine-module=external-eval/engines/omni-frozen-v3.1.mjs` and `--preregistration=external-eval/preregistration/longmemeval-v2.json`

## Files in This Archive

- `README.md` — this file
- `run-manifest.json` — version pins, verification results, blocker details, resolution
- `failure-summary.json` — structured failure report with resolution section
- `data-access-log-redacted.jsonl` — empty (no data accessed)
