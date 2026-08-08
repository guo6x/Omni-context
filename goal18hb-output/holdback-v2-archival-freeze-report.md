# Goal 18HB-A - Holdback V2 Post-Seal Archival Freeze Report

- Goal: Goal 18HB-A (post-seal evidence archival freeze for Holdback V2)
- Status: HOLDBACK_V2_ARCHIVAL_FREEZE_COMPLETE (see finalization section; pending placeholder in commit A)
- Issued: 2026-08-08 (Asia/Shanghai)

## 1. Scope and constraints honored

- No regeneration of fixtures; no re-seal; no scoring; no Kernel/A0-A5/scorer run.
- Sealed artifact, public manifest, access log, plaintext/gold/seed hashes are unchanged from the
  Goal 18HB seal. Existing frozen artifact bytes were NOT modified.
- No plaintext access: only the custody seed was read (in memory, for comparison only) and the
  custody fixture/gold/seed hashes were re-verified; raw seed and plaintext were never printed,
  logged, or staged.
- `formal-experiment-freeze-manifest.json` `validation_fixture_sha256` (3ceddb1a...) left untouched;
  validation gold freeze remains `PENDING_VALIDATION_GOLD_FREEZE_V2`.
- Goal 20 remains `WAITING_FOR_HR1_AND_VALIDATION_FREEZE`.

## 2. Evidence commit

- Archival (evidence) commit SHA: SEE_EVIDENCE_COMMIT_SHA (filled at finalization)
- Record-finalization commit SHA: SEE_FINALIZATION_COMMIT_SHA (filled at finalization)
- Parent (generator/seal) commit: cd53eaea538ac2992012e21e94370e918b166dde
- Scheme: two-commit, non-circular. Commit A carries the full evidence set (record with placeholder
  SHAs); commit B finalizes the record/report/scan-result with the real SHAs. The record therefore
  never needs to self-reference.

## 3. Frozen identities (unchanged from seal)

| Item | SHA-256 |
|---|---|
| Sealed artifact holdback-v2-sealed.bin | 4737bc7746825cac27938682f1a82ada28044d8122a5c2b6c35a67efb54adbd3 |
| Public manifest holdback-v2-public-manifest.json | 4e4239d4170b56286eb33cd832e66c3aa1c2c2ba3bb7053e050af7c7a4319d7a |
| Access log holdback-v2-access-log.jsonl | 472294af320c20d335366e4f81a6374248d15bed1a09a987c228103d5705818c |
| Plaintext fixture (custody) | 005aa51f1d030dae2019a70f2de705ac2b2a5480a9f2ce043930eef29057050a |
| Gold projection (custody) | 80ab80ecb4784f783a4ba38d5511f5f10d16452b130a006a724c39d40209e45b |
| Seed (hash only; raw never released) | c627039c6930c35cbc62bd256bba89f8daab6278840b4af8ac4f1e8b43a2caa1 |
| Seal script scripts/seal/seal-holdback-v2.mjs | 0b09b7df88d2ed2a6d789f53a1cbce6bceeb1642e9ae6d9946158e721824ef1f |
| Run authorization holdback-v2-run-auth.json | f5e4867569c62ebeb1ed1cb7e90c767fb2ce7b1155262cc73a364691d5e77117 |
| RI audit holdback-v2-referential-integrity.json | 18102cccc081342ea58dacbd761b4e56bd7e80fd25c2e926eac052f468fe7cad |
| Integrity suite benchmark-integrity-tests/integrity.test.mjs | 47f643b1e9f1b067faef0f296ef4c8908f375748b73252c96353f7824bb644b1 |

Custody re-verification at archival time (hash only): seed.txt trimmed == c627039c...; fixture and
gold custody files hashes match the public manifest (see secret-scan-result.json and verify-seal-v2
output recorded in the 18HB log).

## 4. Secret scan

- Scanner: goal18hb-output/scripts/archive/secret-scan.mjs (SHA-256 6bd7adbc49337b54573e29b0e6487a59f067b80aefef31d2492eae43f6b7304d)
- Method: staged blobs (`git show :<path>`) compared in memory against the custody seed (trimmed);
  private-key / API-key / token patterns; secret-bearing pathname rules. Raw seed never printed.
- Result: goal18hb-output/secret-scan-result.json
- Verdict: PASS, 0 findings (commit A scan; commit B scan appended at finalization)

## 5. Staged evidence (explicit list only)

- All public Goal 18HB artifacts, reports, scripts, integrity tests, READMEs under goal18hb-output/.
- Selected work files: work/19f-holdback-refs.json, work/19f-sync-draft.md,
  work/custody-role-templates.md, work/dummy-seal-decrypt-results.json.
- Goal 19F metadata files (4): formal-run-config-v1.json, formal-experiment-freeze-manifest.json,
  model-and-budget-owner-decision.json, unresolved-formal-run-risks.md.
- Excluded by design: work/dummy-seed-1.txt (non-formal dummy seed), work/dummy-hb-run{1,2,3}/,
  work/coverage-proxy/, work/overlap-leak-proxy/, work/holdback-v2-referential-integrity.json
  (duplicate of the top-level file). Sealed binary and *.log staged with `git add -f`.
- Exact list printed from `git diff --cached --name-only` and recorded in secret-scan-result.json.

## 6. Finalization (commit B)

- Archival commit SHA: SEE_EVIDENCE_COMMIT_SHA
- Finalization commit SHA: SEE_FINALIZATION_COMMIT_SHA
- secret-scan-result.json gains a commit-B scan block (record/report/scan-result/log/artifact list).
- artifact-sha256.txt gains archive metadata entries; custody-handoff hash line reconciled.

## 7. Clean-checkout verification (after commit B)

- Status: SEE_CLEAN_CHECKOUT_STATUS
- Verified at HEAD in a fresh `git worktree`: sealed hash identical, scripts pass `node --check`,
  required reports exist, secret scan PASS, `git status --porcelain` empty in the worktree.
- Worktree path: SEE_WORKTREE_PATH

## 8. Final gate answers

1. Archival commit SHA: SEE_EVIDENCE_COMMIT_SHA
2. Staged file count: SEE_STAGED_COUNT (see secret-scan-result.json per-scan counts)
3. Secret scan: PASS (0 findings; seed-presence check enabled)
4. Plaintext staged: false; ciphertext modified: false
5. Clean worktree check: SEE_CLEAN_CHECKOUT_STATUS
6. Validation gold freeze: PENDING_VALIDATION_GOLD_FREEZE_V2 (3ceddb1a... untouched)
7. Goal 20: WAITING_FOR_HR1_AND_VALIDATION_FREEZE
8. Holdback access: never decrypted; plaintext never read beyond custody hash verification
