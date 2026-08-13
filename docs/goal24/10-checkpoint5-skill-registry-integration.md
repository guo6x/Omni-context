# Goal24 Checkpoint 5 - Skill Registry / Agent Skills Importer Integration and Security Freeze

Status: **GOAL24_CHECKPOINT5_COMPLETE** - all A-Y gate criteria PASS.
Checkpoint 6 runtime was not started: no Evidence Surface Guard, evidence
retrieval/provider orchestration, qualification runtime, CP6 evidence provider
registry, or retrieve-more/clarify/defer control flow was added. The existing
CP2.2 `assessEvidenceCoverage` pure contract-level coverage assessment remains
unchanged (no retrieval, no time, no registry access).

- Base: `78400cb5bcc66147e203c22c6c2cfe55abcb2a41` (`origin/dev/goal24-cli-skills`)
- Integration branch: `local/cp5-integration` (worktree
  `D:\ai_code\Omni-context-worktrees\cp5-integration`)
- Integration commits (on top of the verified base): see section 3.

## 1. Lanes integrated

| Lane | Requested commits | Integrated commits |
| --- | --- | --- |
| A - Skill Registry V1 | `1d14b44`, `f8a3d56`, `60e123f`, `0f067b3` | `ea016e2`, `e1d583d`, `5805eff`, `c8d3579` |
| B - Agent Skills Importer | `7bfc5d1`, `0cffb8e`, `d30e653`, `df221fd` | `6c4ebb1`, `0f511dc`, `4c8e6aa`, `862fd16` |
| C - Adversarial Oracle / Compatibility Audit | `c6d4e91` | `c890029` |

All lane objects were verified present and cherry-picked in order onto the
verified base; no conflicts. Lane C adds compatibility/security/environment
documentation and the adversarial fixture corpus only; it modifies no runtime.

## 2. Pre-merge scan

- `PROCESS_EXECUTION_ADDED = NO`: the full base..HEAD diff contains no
  `child_process`, no `spawn(`/`exec(` (the only `exec(` hit is the frontmatter
  regex), no `Command::new`, and no `process.env` reads. The importer and
  registry are pure TypeScript modules.
- Rust (`desktop-daemon/src-tauri`) has **zero** diff lines in CP5. CP3/CP4
  broker invariants are preserved by construction and re-verified by the Rust
  test suite (see section 12).

## 3. Integration commits

- `ff0d18f` security(skills): bind imported packages to quarantined registry state
- `d08b1ac` test(skills): cover importer-registry security bridge
- `db8f3ee` security(skills): close importer TOCTOU and grammar gaps found by the adversarial oracle (canonical semver, hyphen name grammar, source file-set recheck)
- `3f08d88` test(skills): add cp5 adversarial oracle with map integrity checks + node audit evidence
- `196e797` chore(desktop): refresh controlled-file snapshot for the frozen checkpoint
- docs(goal24): record checkpoint 5 skill registry integration gate (this commit; FINAL_HEAD_SHA reported in the completion response)

## 4. Importer (Lane B)

`brain-server/src/skills/importer/*` implements
discover -> inspect -> snapshot -> classify. It never executes anything.

- SKILL.md frontmatter: JSON-restricted YAML schema, duplicate keys rejected,
  custom tags rejected, multi-document streams rejected, cyclic aliases
  rejected, acyclic aliases bounded (`maxAliasCount=100`, depth <= 32, nodes
  <= 100k), name grammar `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` (no uppercase,
  leading/trailing/consecutive hyphens), max 64 chars; description max 2000
  chars, control characters and bidi overrides rejected. Vendor keys
  (`license`, `compatibility`, `metadata`, `allowed-tools`) are preserved as
  display-only vendor metadata; all other keys are ignored with an
  `UNKNOWN_FRONTMATTER_KEY` warning and can never change safety policy.
- `omni-skill.json`: strict Zod manifest schema; unknown keys (including
  `trust`, `executable`, `approval_required`, manifest-declared `digest`)
  rejected; version must be canonical `major.minor.patch`.
- Path policy: `..`/`.` segments, absolute paths, drive letters, UNC,
  backslashes, NUL and C0/C1 controls rejected; normalized paths bounded to
  180 chars; case-folded destination collisions (`SKILL.md`+`skill.md`) fail
  closed as `PACKAGE_PATH_COLLISION`; symlinks/junctions/reparse points are
  never followed (`PACKAGE_PATH_ESCAPE`); package limits enforced (256 files,
  256 KiB SKILL.md, 128 KiB manifest, 4 MiB/file, 16 MiB total, depth 8).
- Bundled `.py/.js/.ts/.sh/.ps1/.cmd/.bat/.exe/.dll` and any NUL-containing
  file are classified (`script`/`binary`) and snapshotted but never executed.
- `SKILL_MD = NO` executable role: SKILL.md alone yields
  `QUARANTINED_UNBOUND` (reason `MISSING_OMNI_MANIFEST`), never a usable
  skill. `OMNI_MANIFEST = omni-skill.json` is the only eligibility source.
  `SKILL_MD_ONLY = QUARANTINED_UNBOUND`.
- TOCTOU: source mutation between inspection and snapshot (add/modify/remove/
  swap SKILL.md) fails closed with `PACKAGE_CHANGED_DURING_IMPORT`; the
  managed snapshot is removed on failure. The package digest is computed over
  the complete sorted file listing (length-prefixed encoding, unambiguous),
  and a tampered pre-existing snapshot fails closed with
  `MANAGED_SNAPSHOT_CORRUPT`.

## 5. Registry V1 (Lane A)

`brain-server/src/skills/registry*.ts` stores validated procedural metadata
only; it never executes scripts/commands/shells/binaries and never treats
`adapter_preference` as transport authority.

- Imported/local records always start `quarantined`; no auto-trust.
  Promotion to `trusted` requires an explicit provenance object whose
  mechanism is `owner-decision` | `admin-decision` | `builtin-policy`;
  anything else (including model-initiated or self-service transitions) is
  rejected with `SKILL_TRUST_TRANSITION_INVALID`. `revoke()` is one-way: a
  revoked version cannot be un-revoked; re-registration requires a new
  version.
- Version identity `name@version`; same identity with different content
  throws `SKILL_VERSION_CONFLICT` in both orders and can never displace a
  trusted record. Identical content re-registration is idempotent.
  `resolveLatestTrusted` filters by the full eligibility gate and picks the
  numerically greatest `major.minor.patch` (`1.10.0 > 1.9.0`).
- Eligibility: enabled + not revoked + `trusted` + valid + SHA-256 digests +
  capability ids consistent + capability lookup + safety inheritance clean.
- Persistence: atomic temp-file + fsync + rename writes serialized through an
  in-process queue (concurrent registrations cannot lose updates); corrupt
  JSON, unknown schema version, unknown fields, duplicate identities and
  missing required fields all fail closed with `SKILL_REGISTRY_CORRUPT`.
  A package named `registry-0001` lives in the skill name namespace and can
  never collide with internal store fields.

## 6. Security bridge

`brain-server/src/skills/skill-package-registry-service.ts` is the only
importer -> registry path:

- `importSkillPackage()`: import -> managed snapshot verification -> manifest
  validation -> safety inheritance validation -> register. The result is
  `REGISTERED_QUARANTINED` (or a quarantine/import status); the caller can
  never choose a trust state at import time.
- `resolveSkillForUse()`: the single formal consumer entry point. It checks
  policy eligibility, then re-walks and re-hashes the managed snapshot from
  disk and compares it with the registry `package_digest`; any divergence
  throws `SKILL_PACKAGE_INTEGRITY_FAILURE` (this is the
  content-addressed-managed-snapshot-with-digest-verification gate; the
  snapshot is not OS-enforced immutable, which is exactly why the digest is
  re-verified before every use).
- No trust mutation (`registerSkill`/`trustSkill`/`setTrustStatus`/
  `revokeSkill`) is exposed over MCP, Tauri IPC or HTTP. All usages are
  confined to the internal skills module and tests.

## 7. Adversarial oracle

- Vectors: `docs/goal24/cp5-skill-adversarial-vectors.json` (148 vectors).
- Execution map: `docs/goal24/checkpoint5-adversarial-execution-map.json`:
  total 148, automated 130, covered 14 (lane tests), manual 0,
  not_applicable 4, unmapped 0, failed 0.
- Executable oracle: `brain-server/tests/goal24-cp5-adversarial-oracle.test.ts`
  (67 tests: 64 automated-vector probes + 3 map-integrity tests). All PASS.
  The map-integrity tests re-derive every count from the vector source, verify
  every vector id maps 1:1, and verify every AUTOMATED entry references a
  test name defined in this file.
- Real gaps found and closed by the oracle: leading-zero semver accepted
  (now canonical-only), trailing/consecutive hyphen skill names accepted (now
  rejected), file-added-during-import TOCTOU silently excluded the file (now
  `PACKAGE_CHANGED_DURING_IMPORT`). The map was kept truthful throughout.
- Not-applicable decisions (4): prerelease coexistence (strict
  major.minor.patch subset), manifest-declared digests (digests are always
  computed by the importer), NTFS trailing dot/space directory names (the
  filesystem normalizes them on Windows), archive expansion (the importer
  never unpacks archives).

## 8. Node security

`docs/goal24/audit-brain-server-cp5.json` (fresh `npm audit --omit=dev
--audit-level=critical --json`):

- js-yaml `4.3.1`: 0 advisories (the CP5 frontmatter parser; duplicate-key
  rejection verified).
- Importer-reachable findings: 0.
- Baseline findings: 16 (identical to the CP2.2 baseline; none reachable from
  the CP5 importer/registry/bridge path).
- UNKNOWN = 0, FIX_BEFORE_CP5 = 0, BLOCKS_CP5 = 0.

## 9. Rust security

`cargo audit` (fresh, cargo-audit 0.22.2, offline RustSec DB):

- 5 vulnerabilities (crossbeam-epoch 0.9.18 RUSTSEC-2026-0204; quick-xml
  0.30.0/0.39.3 RUSTSEC-2026-0194/0195), 17 warnings - identical to the
  CP3/CP4 baseline; all NOT_REACHABLE (fmt::Pointer impls never exercised;
  xcb build-dep / plist / wayland-scanner paths not compiled on Windows).
- UNKNOWN = 0, FIX_BEFORE_CP5 = 0, BLOCKS_CP5 = 0.
- Evidence archived at `D:\environment\tmp\cp5-audit.txt`.

## 10. CP3 / CP4 invariants preserved

- `desktop-daemon/src-tauri` has zero diff lines in CP5; Rust behavior is
  unchanged and re-verified: `cargo test` 124 passed / 0 failed / 6 ignored
  (broker adversarial tests incl. `output_limit_error_code_reported`,
  `timeout_error_code_reported`).
- `execute_ipc_enabled` remains `false` in
  `desktop-daemon/src-tauri/src/execution_broker/mod.rs`; generic execute IPC
  stays disabled.
- CP4 production GitHub bindings: still exactly the 5 read-only bindings;
  write bindings remain 0; `gh pr view --json statusCheckRollup` shape
  unchanged; broker global exit semantics unchanged.
- `verify:controlled` refreshed: CP4's final commit had updated
  `src-tauri/src/main.rs` without re-snapshotting
  `scripts/controlled-files.sha256.json`; CP5 refreshed exactly that one hash
  (plus `generatedAt`) so the guard is green again.

## 11. Regression evidence

- Brain server: typecheck PASS; vitest **763 passed (47 files)**; build PASS;
  lint **0 errors / 9 pre-existing warnings**; `git diff --check` clean.
- Desktop: `npm run build` PASS; `npm run verify:controlled` PASS.
- Rust: `cargo fmt --check` PASS; `cargo check` PASS; `cargo clippy
  --all-targets` PASS (warnings only in pre-existing files); `cargo test`
  124 passed / 0 failed / 6 ignored.
- Real end-to-end evidence for CP5 is the importer -> managed snapshot ->
  registry -> trust -> resolve bridge exercised through
  `SkillPackageRegistryService` with real filesystem snapshots and digest
  re-verification (`goal24-skill-bridge.test.ts` + the oracle). CP5 adds no
  new process-execution path, so no new broker spawn E2E is required; the
  CP4 authenticated GitHub E2E (5/5) is unchanged because Rust is untouched.

## 12. Security gate

`docs/goal24/checkpoint5-security-gate.json`: criteria A-Y, all PASS.
`CHECKPOINT5_SECURITY_GATE = PASS`.

## 13. Declarations

- `CHECKPOINT6_STARTED = NO` (no Evidence Surface Guard runtime, evidence
  retrieval/provider orchestration, qualification runtime, CP6 evidence provider
  registry, or retrieve-more/clarify/defer control flow was added; the existing
  CP2.2 `assessEvidenceCoverage` pure contract-level coverage assessment remains
  unchanged).
- CP5 itself implemented the Skill Registry V1 runtime, persistent registry
  store, Agent Skills / SKILL.md importer, managed package snapshot, and the
  importer-to-registry bridge with `resolveSkillForUse` integrity verification.
- CP5 freeze documentation correction: criterion Y and the declarations above
  were corrected (CP5.1 docs-only patch); CP5 implementation/security gate
  remains PASS, CP5 freeze documentation corrected, CP6 NOT STARTED.
- `HOLDBACK_TOUCHED = NO`, `SCIENTIFIC_REFS_CHANGED = NO`, `MAIN_TOUCHED = NO`.
- `DIRTY_CP21_WORKTREE_TOUCHED = NO` - `D:\ai_code\Omni-context\.worktrees\goal24-cp21`
  was never entered, reset, cleaned, stashed, checked out, deleted or modified.
- `AUTH_MUTATED = NO`, `TOKEN_READ = NO` (no GitHub CLI auth command of any
  kind was executed during CP5).
- Machine-readable records: `checkpoint5-security-gate.json`,
  `checkpoint5-manifest.json`, `checkpoint5-environment.json`,
  `checkpoint5-adversarial-execution-map.json`, `audit-brain-server-cp5.json`.

## 14. Environment

`docs/goal24/checkpoint5-environment.json`: Node v22.23.2 (D:\environment),
cargo 1.97.1, cargo-audit 0.22.2 with offline RustSec DB
(`D:\environment\advisory-db-offline`), npm cache on D:.

## 15. Freeze

- Code head at freeze: `3f08d88` (recorded in `checkpoint5-manifest.json`).
- Freeze commits: `db8f3ee`, `3f08d88`, `196e797`, plus this docs commit.
- FINAL_HEAD_SHA (after this docs commit and fast-forward push) is reported
  in the completion response.
- Push: fast-forward `local/cp5-integration` -> `origin/dev/goal24-cli-skills`
  only; no force; `main` untouched.
- Lane worktrees (`cp5-skill-registry-core`, `cp5-agent-skill-importer`,
  `cp5-skill-security`) and the `cp5-integration` worktree were removed after
  integration; local `local/cp5-*` branches were deleted. The dirty
  `goal24-cp21` worktree was never touched.