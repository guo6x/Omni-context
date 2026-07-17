# Omni-Context Candidate v3.1 — LongMemEval-S Formal Evaluation (BLOCKED)

## Final Status

```
LONGMEMEVAL_S_FORMAL_BLOCKED
```

## Blocker Reason

```
MISSING_ENGINE_MODULE
```

## Summary

This directory archives the formal LongMemEval-S sealed held-out evaluation attempt for Omni-Context Candidate v3.1. The evaluation was authorized by the project owner but could not proceed to formal generation because the sealed runner (`external-eval/runners/sealed-runner.mjs`) requires an `--engine-module` argument pointing to a module that exports `createEngine({productCommit, isolatedDatabase, dynamicPort})`, and no such module exists in any worktree of the repository.

The spec assumes this module is a pre-existing frozen artifact (`<FROZEN_OMNI_ENGINE_MODULE>`), but exhaustive search across all worktrees confirmed that `createEngine` is not exported by any file. The frozen product's `brain-server` exposes the required capabilities over HTTP (`/api/graph/extract` for ingestion, `/api/mcp/tool/graph_answer` for querying), but no adapter wrapping this HTTP API into the `createEngine` interface has been implemented.

Per the project owner's authorization: "你只是运行管理员，不是系统开发者。本轮不得优化代码、修改产品、调参或根据结果重跑。" Writing a new engine adapter module constitutes system development, which is outside the run administrator's authorized role. Therefore the evaluation is blocked pending a system developer providing the frozen engine module.

## What Was Completed

- Phase 0: Version verification — PASSED
  - HEAD = `5ab7ed3bd74361a313e9ccbe715773e3a8598980`
  - Freeze tag `evaluation-freeze-candidate-v3.1` = `17dc1d0107b0474de84058205a91b302ba290a74`
  - `--validate-only` = VALID, formal_run=false, heldout_accessed=false
  - Worktree clean
- Adapter commit `066b63cb0b72d6aa494804864f59bfc05be5a734` verified
- Preregistration SHA-256 computed: `05205f6a074ba8b044051c00e045b4f943f40d974ccfb075b1357f34097bcc15`
- Provider credentials verified available (DeepSeek, from external secrets file)
- OPENAI_API_KEY confirmed NOT available (official scoring would be PENDING)

## What Was NOT Done

- Phase 1: Isolated environment preparation (not started — blocked before this point)
- Phase 2: Official data download (not started — no data accessed)
- Phase 3: Gold-Free projection generation (not started)
- Phase 4: Authorization file creation (not started)
- Phase 5: 15-item final gate (not started)
- Phase 6: Formal generation — **BLOCKED: MISSING_ENGINE_MODULE**
- Phase 7: Official scoring (not started)
- Phase 8: Result archival (only this blocker documentation)
- Phase 9: Paper integration (not started)
- Phase 10: Final report (see below)

## Data Access Log

No official LongMemEval data was downloaded, previewed, or accessed. The data-access log is empty.

## Resolution Path

To unblock this evaluation, a system developer must:

1. Implement an engine module that exports `createEngine({productCommit, isolatedDatabase, dynamicPort})` returning an engine with `ingest(session)`, `query({question, questionDate})`, and optional `stop()` methods.
2. The engine module must wrap the frozen product's brain-server HTTP API (commit `17dc1d0`) without modifying the product itself.
3. The engine module should be committed and frozen as a new artifact, then referenced via `--engine-module=<path>`.
4. Once the engine module exists, re-run this evaluation from Phase 1.

## Files in This Archive

- `README.md` — this file
- `run-manifest.json` — version pins, verification results, blocker details
- `failure-summary.json` — structured failure report
- `data-access-log-redacted.jsonl` — empty (no data accessed)
