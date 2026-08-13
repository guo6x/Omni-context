# Goal24 Checkpoint 5, Lane A - Skill Registry V1 Core + Safety Inheritance Hardening

Date: 2026-08-13
Branch: `local/cp5-skill-registry-core`
Base: `78400cb5bcc66147e203c22c6c2cfe55abcb2a41` (`origin/dev/goal24-cli-skills`, verified exact after `git fetch --all --tags --prune`)

## Scope

This lane fixes the remaining Skill safety inheritance semantics gap and
implements the Skill Registry V1 runtime core with deterministic persistence
and a provenance / trust / version-conflict model.

**In scope**

- `brain-server/src/skills/contracts.ts`: canonical conflict-policy and
  verification-requirement ordering in `validateSkillManifestAgainstCapabilities`
- New `brain-server/src/skills/registry.ts` (runtime core),
  `registry-types.ts` (strict schemas and error model),
  `registry-store.ts` (deterministic JSON persistence)
- New tests `brain-server/tests/goal24-skill-contracts.test.ts` and
  `brain-server/tests/goal24-skill-registry.test.ts`
- New docs `docs/goal24/cp5-lane-a-skill-registry.md` and
  `docs/goal24/checkpoint5-lane-a-manifest.json`

**Not in scope (explicitly not implemented)**

- SKILL.md filesystem importer, Agent Skills package walking
- Tauri UI, GitHub write capabilities, Evidence Guard runtime, Approval Engine
- Skill code/script execution of any kind
- Any MCP / Tauri IPC exposure for the registry

No files outside `brain-server/src/skills`, `brain-server/tests` and
`docs/goal24` were modified. `desktop-daemon` and the GitHub CLI adapter are
untouched. `package.json` / `package-lock.json` are untouched (no new
dependencies).

## Safety inheritance fix (contracts.ts)

Before CP5 the validator only special-cased `verified` and `reject`:

- `capability.conflict_policy === 'reject' && (skill.conflict_policy ?? 'allow') !== 'reject'`
  treated an undeclared skill policy as `allow`, contradicting the CP2.2
  canonical default `conflict_policy ?? 'reject'`.
- Verification only enforced `verified`; the `asserted` tier and the
  canonical default were not ordered.

CP5 replaces both with explicit canonical rank orderings. The wire schema
(`SkillManifestSchema`, `EvidenceRequirementSchema`) is unchanged.

- `CONFLICT_POLICY_RANK = { allow: 0, warn: 1, reject: 2 }`
  Effective value of an undeclared `conflict_policy` is `reject`
  (via the existing `effectiveConflictPolicy` helper from
  capabilities/contracts.ts, CP2.2).
- `VERIFICATION_RANK = { none: 0, asserted: 1, verified: 2 }`
  Effective value of an undeclared `verification_requirement` is `none`
  (new exported helper `effectiveVerificationRequirement`).

A skill requirement is legal only when its effective value is
**greater than or equal to** the effective value of the referenced
capability requirement (skills may strengthen, never weaken).

| Capability | Skill | Verdict |
| --- | --- | --- |
| conflict undefined (reject) | allow | REJECT |
| conflict undefined (reject) | undefined (reject) | PASS |
| conflict warn | allow | REJECT |
| conflict warn | warn / reject | PASS |
| conflict reject | allow / warn | REJECT |
| conflict reject | reject | PASS |
| verification asserted | none / undefined | REJECT |
| verification asserted | asserted / verified | PASS |
| verification verified | none / asserted | REJECT |
| verification verified | verified | PASS |

Unchanged inheritance gates (CP2.1): mandatory capability evidence must
exist in the skill with `mandatory: true`; a capability `freshness_policy`
must exist in the skill with `max_age_ms <=` the capability value; skill
`risk` must not be lower than the highest referenced capability risk.

## Registry principle

The registry stores **validated procedural artifact metadata**, never
trusted executable code and never raw executable commands. The registry does
not execute scripts, commands, shells, Python, JS, PowerShell or binaries;
it does not interpret SKILL.md natural-language text as authority or
executable instruction; and it never treats `adapter_preference` as
transport authority (a preference can never override capability authority,
bypass evidence, change risk, select an executable or generate argv).

## Registry record model (`registry-types.ts`)

Strict Zod schemas (`z.strictObject`) for both registration inputs and
persisted records. Unknown fields - including `command`, `shell`, `exec` and
`argv` - are rejected at parse time.

`SkillRegistryRecord`: `name`, `version`, `manifest`, `package_digest`,
`manifest_digest`, `source_type` (`builtin | local | imported`), `source_id`,
optional `source_reference`, `trust_status`, `installed_at`, `updated_at`,
`enabled`, `revoked`, `validation_status`, `validation_issues`,
`capability_ids`, `risk_snapshot`, `provenance[]`.

- Digests must be lowercase SHA-256 hex (64 chars). MD5 and SHA-1 are
  rejected by schema.
- `provenance[]` is a strict `{ actor, mechanism, reason?, at }` object
  list; every trust transition appends one entry.
- Error model: `SKILL_INPUT_INVALID`, `SKILL_VALIDATION_FAILED`,
  `SKILL_VERSION_CONFLICT`, `SKILL_NOT_FOUND`,
  `SKILL_TRUST_TRANSITION_INVALID`, `SKILL_REGISTRY_CORRUPT`.

## Trust model

Canonical states: `quarantined`, `reviewed`, `trusted`, `revoked`.

- Imported and local registrations always start `quarantined`.
- Builtins start `quarantined` unless a separately defined trusted built-in
  policy predicate explicitly allows `trusted` for that builtin.
- **No auto-trust exists.** The registry never promotes a discovered or
  imported skill to `trusted` on its own.
- `setTrustStatus(name, version, status, provenance)` is an internal
  service API only - it is not exposed over MCP or Tauri IPC. It always
  requires an explicit actor/provenance object. Promotion to `trusted`
  requires `mechanism` in
  `{ owner-decision, admin-decision, builtin-policy }`; anything else
  (e.g. model-initiated `self-service`) is rejected.
- `revoked` is not a direct transition target; revocation goes through
  `revoke(name, version, provenance)` and a revoked version can never be
  re-trusted through `setTrustStatus` (re-register as a new version).

## Eligibility

`eligible_for_use(record, lookup)` (pure function, exported) is true only
when all of the following hold:

1. manifest schema valid
2. `validateSkillManifestAgainstCapabilities` returns 0 issues
3. all referenced capabilities exist in the injected capability lookup
4. `package_digest` and `manifest_digest` are valid SHA-256 hex
5. `trust_status === 'trusted'`
6. `enabled === true`
7. `revoked === false`

Eligibility means *eligible for consideration by a future skill
orchestration layer*; it is not execution.

## Version identity and resolution

- Canonical identity: `name@version` (`skillRecordKey`).
- Re-registration of the same identity with identical
  `package_digest` + `manifest_digest` is **idempotent** (returns the
  existing record).
- Same identity with different content throws `SKILL_VERSION_CONFLICT`.
  No overwrite, no last-write-wins. New content requires a new version.
- `compareSemver` compares `major.minor.patch` numerically
  (`1.10.0 > 1.9.0`); no prerelease/range support.
- `resolveLatestTrusted(name)` returns the numerically greatest version
  that is trusted, enabled and not revoked.

## Registry API (`registry.ts`)

`register`, `get(name, version)`, `list`, `listVersions(name)`,
`resolveLatestTrusted(name)`, `disable(name, version)`,
`revoke(name, version, provenance)`, `setTrustStatus(...)` (internal),
`validateManifest`, `validateRecord`, `isEligibleForUse`, static
`open(storePath, options)`.

- Capability lookup is injected (`(capabilityId) => CapabilityDefinition |
  undefined`); the registry never rebuilds a second capability schema and
  validates against the CP4 five GitHub read capabilities correctly.
- An injectable `now` clock keeps tests deterministic.

## Persistence (`registry-store.ts`)

Deterministic JSON store, deliberately not a database migration:

```json
{ "schema_version": 1, "updated_at": "...", "records": [...] }
```

- Atomic writes: temp file -> write -> fsync -> close -> rename.
- Reads are strict: malformed JSON, unknown fields, duplicate
  `name@version` identities or an unknown `schema_version` all fail closed
  with `SKILL_REGISTRY_CORRUPT`. The store is never silently reset, so
  trust/revocation history cannot be lost to a parse error.
- A missing file (ENOENT only) is a clean first-run empty registry.
- The store path is injected via constructor / `open`; it is never
  hardcoded into product source and never chosen by an LLM, manifest or
  SKILL.md. Tests use OS temp directories.

## Tests

All pure: no process spawn, no network, no remote state changes.

- `tests/goal24-skill-contracts.test.ts` (24 tests): the canonical
  conflict-policy ordering matrix, the canonical verification-ordering
  matrix, `effectiveVerificationRequirement` defaults, and unchanged
  mandatory/freshness inheritance regressions.
- `tests/goal24-skill-registry.test.ts` (30 tests): valid register,
  invalid manifest / unknown fields / missing capability / risk weakening /
  evidence weakening rejection, invalid SHA digest rejection, idempotent
  re-registration, `SKILL_VERSION_CONFLICT`, numeric semver resolution
  (`1.10.0 > 1.9.0`), quarantined/reviewed/trusted/revoked/disabled
  eligibility, promotion-mechanism enforcement, provenance requirements,
  builtin-policy trust, persistence reload, corrupt-store fail-closed,
  unknown persisted fields, duplicate persisted identities, first-run
  empty store.

## Verification

- `npm run typecheck`: PASS (exit 0)
- `npx vitest run` (full brain-server suite): 634 passed, 0 failed across
  44 test files (54 of the tests are new CP5 tests)
- `npm run build`: PASS (tsc emit, exit 0)
- `npm run lint`: 0 errors; only pre-existing warnings in files outside
  this lane; no warnings in CP5 files
- `npm audit`: not required - no dependency changes
  (`package.json` / `package-lock.json` untouched)
- `git diff --check`: PASS
- Static no-execution scan of the four CP5 source files: no
  `child_process`, `exec`, `execFile`, `spawn`, `shell`, `Command`,
  `powershell`, `cmd.exe`, `bash`, `sh -c` tokens (only words inside
  documentation comments that describe what is *rejected*)

## Security invariants

- `PROCESS_EXECUTION_ADDED`: NO
- `PUBLIC_TRUST_IPC_ADDED`: NO (no MCP tool, no Tauri command, no IPC
  endpoint was added)
- `AUTO_TRUST_PRESENT`: NO (imported default `quarantined`; `trusted`
  requires an explicit owner/admin/builtin-policy decision)
- `VERSION_CONFLICT_FAIL_CLOSED`: YES
- `CORRUPT_STORE_FAIL_CLOSED`: YES
- `desktop-daemon`, GitHub CLI adapter, MCP/IPC surfaces: untouched

## Known limitations and residual risks

- The registry accepts digests from the future importer; it does not read
  the package filesystem itself, so importer correctness (hashing the
  right bytes) is a later-checkpoint concern.
- `validateRecord` recomputes issues on demand but the stored record is
  the registration-time snapshot; eligibility re-validates against the
  live capability lookup at read time.
- `setTrustStatus` is an internal service API. It must stay out of MCP /
  Tauri IPC in later checkpoints; wiring it there would need its own
  security gate.
- Built-in trust policy is injected and applied only to
  `source_type === 'builtin'` registrations.

## Scientific firewall

`research/decision-benchmark-holdback-v2`, `science/*`, formal benchmark,
Gold and paper were not read or modified. The dirty legacy worktree
`.worktrees/goal24-cp21` was not touched. No remote branch was pushed.