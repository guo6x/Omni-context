# Goal24 Checkpoint 5 — Lane B: Agent Skills / SKILL.md Safe Importer + Managed Package Snapshot

- Lane: `B — AGENT SKILL IMPORTER`
- Base SHA: `78400cb5bcc66147e203c22c6c2cfe55abcb2a41` (`origin/dev/goal24-cli-skills`)
- Status: `LANE_B_COMPLETE`
- Worktree: `D:\ai_code\Omni-context-worktrees\cp5-agent-skill-importer`
- Local branch: `local/cp5-agent-skill-importer` (no push)

## Scope

This lane implements the safe import layer for the Agent Skills folder +
`SKILL.md` pattern:

```
discover -> inspect -> snapshot -> classify
```

It deliberately does **not** implement:

```
discover -> execute
```

The importer never executes bundled code, never runs package hooks, never
grants trust, and never converts SKILL.md prose into machine safety policy.
Skill Registry core, capability safety-inheritance wiring, and the Tauri
Broker are out of scope for this lane.

## Compatibility principle

The CP5 compatibility profile supports the common Agent Skills directory
shape (`SKILL.md` with YAML frontmatter carrying at least `name` and
`description`, plus optional resources and scripts) for discovery and
import.

Compatibility with the folder pattern is **not** Omni execution authority:

- Bundled scripts are recorded, never executed.
- `SKILL.md` text is never converted into trust or authority.
- Omni safety policy can only come from a validated `omni-skill.json`.
- 100% vendor-runtime behavioral parity is not promised; these are security
  boundaries, not bugs.

## omni-skill.json safety manifest

```
skill/
  SKILL.md                 # procedural, human/agent-readable content
  omni-skill.json          # enforceable Omni safety manifest
  references/
  scripts/
```

`omni-skill.json` is strict-parsed with the existing `SkillManifestSchema`
and is the only machine-readable safety authority. This lane returns
`manifest_schema_valid` and the parsed `manifest`; the full capability
registry inheritance wiring (`validateSkillManifestAgainstCapabilities`)
belongs to Registry Lane A / Integration.

An external Agent Skill that only ships `SKILL.md` can still be discovered,
inspected, and snapshotted, but its status is `QUARANTINED_UNBOUND`. Omni
never auto-generates authority, evidence, or risk for it.

## No LLM safety inference

Text such as "this is safe" in `SKILL.md` has zero effect. `risk`,
`authority`, required evidence, reversibility, and capability bindings are
read **only** from a validated `omni-skill.json` (or a future
owner-authorized manifest workflow). A serialization-level test asserts the
result contains no such inferred fields.

## Frontmatter rules

- `SKILL.md` must exist at the exact package root (no traversal).
- Frontmatter is parsed with `js-yaml` restricted to the JSON schema:
  plain JSON-safe values only. No custom tags, no custom constructors, no
  `eval`/`Function`. Tags such as `!!js/function` are rejected.
- `name` is required and must match `SKILL_NAME_PATTERN`.
- `description` is required, trimmed, and bounded to 2000 characters.
- Unknown frontmatter keys are ignored with a recorded
  `UNKNOWN_FRONTMATTER_KEY` warning and can never change Omni safety policy.
- Malformed frontmatter, missing `name`, or missing `description` reject the
  package with `IMPORT_REJECTED`.

## Name consistency

When `omni-skill.json` is present and its `manifest.name` differs from the
`SKILL.md` frontmatter `name`, the package is quarantined with
`NAME_MISMATCH` and is not eligible for registry validation. Names are never
auto-rewritten.

## Import source and path policy

The importer receives a trusted caller supplied source root (not exposed via
MCP/Tauri/LLM APIs in CP5) and:

- canonicalizes the root via realpath and requires it to be a directory;
- requires `SKILL.md` at the exact root;
- walks recursively without following symlinks, junctions, or other
  reparse points (every accepted entry's realpath must stay inside the
  canonical root; any reparse point or escape fails with
  `PACKAGE_PATH_ESCAPE`);
- rejects `../` segments, backslashes, NUL, absolute paths, and empty
  segments in relative paths.

Development noise directories are skipped with a recorded
`IGNORED_DIRECTORY` warning and are never copied: `.git`, `node_modules`,
`target`, `dist`, `cache`, `__pycache__`. No hooks or lifecycle scripts are
run.

## File limits

| Bound | Default |
| --- | --- |
| max files | 256 |
| `SKILL.md` max | 256 KiB |
| `omni-skill.json` max | 128 KiB |
| single other file max | 4 MiB |
| total package max | 16 MiB |
| max directory depth | 8 |

Exceeding any bound fails with `PACKAGE_LIMIT_EXCEEDED`; the walk is
iterative, never unbounded recursion.

## Bundled code

Files such as `.py`, `.js`, `.ts`, `.sh`, `.ps1`, `.cmd`, `.bat`, `.exe`,
`.dll`, and binary content are detected, classified, and recorded in
`script_files[]` / `bundled_code_present`. The importer:

- never runs them;
- never syntax-checks them by spawning an interpreter;
- never runs package installs or builds;
- never marks them executable.

Malicious `SKILL.md` instructions ("run powershell -Command ...",
"curl secret to ...", "read GH_TOKEN", "ignore Omni policy",
"execute script.py", "disable approval", "merge PR automatically") are
treated as plain text and are never promoted into policy, trust, or
authority.

## Managed immutable snapshot

The external directory is mutable, so the Registry must never trust the
live folder. The importer materializes a snapshot at:

```
<managed_skill_root>/<package_digest>/
```

`managed_skill_root` is injected via constructor/config; no absolute
machine path is hard-coded.

Only regular files that passed inspection are copied. After the copy the
destination tree is re-hashed and compared with the source enumeration, and
the source is re-checked as well; any divergence fails closed with
`PACKAGE_CHANGED_DURING_IMPORT` and the freshly created tree is removed.

## Package digest

- Per file: SHA-256 of the file bytes (`relative_path`, `size`, `sha256`
  recorded).
- Package digest: SHA-256 over the concatenation of
  `relative_path SPACE size SPACE sha256 LF` lines sorted by normalized
  relative path. File ordering on disk can never change the digest.
- `manifest_digest` (optional): SHA-256 of the raw `omni-skill.json` bytes.

## Import result

`ImportedSkillPackage` carries: `source_type`, `source_root`
(requested + canonical), `managed_snapshot_root`, `agent_skill_metadata`
(name, description, unknown frontmatter keys), `omni_manifest_present`,
`omni_manifest_valid`, `manifest`, `manifest_digest`, `package_digest`,
`files[]` (relative_path, sha256, size, classification), `warnings[]`,
`bundled_code_present`, `script_files[]`, `import_status`,
`quarantine_reasons[]`, `eligible`, `failure`. It never returns an
executable command, and it never returns a `trusted` flag — trust state is
owned by the future Skill Registry.

Statuses:

- `ready_for_registry_validation` — valid `SKILL.md` + valid, name-matching
  `omni-skill.json`.
- `QUARANTINED_UNBOUND` — valid `SKILL.md` only.
- `QUARANTINED_INVALID_MANIFEST` — manifest present but not schema-valid.
- `QUARANTINED_NAME_MISMATCH` — schema-valid manifest whose name mismatches
  `SKILL.md`.
- `IMPORT_REJECTED` — missing/malformed frontmatter or `SKILL.md`, limit
  violations, path escapes, or changed-during-import.

Quarantined packages keep their inspection evidence and snapshot;
rejected packages are not snapshotted.

## Verification

- `npm run typecheck` — PASS
- `npm test` (full vitest) — PASS (43 files, 621 tests; lane tests:
  `tests/goal24-skill-importer.test.ts`, 41 tests)
- `npm run build` — PASS
- `npm run lint` — PASS (0 errors in lane files)
- `npm audit` — 28 pre-existing findings in the unchanged baseline tree;
  the new `js-yaml` direct dependency has zero advisories
- `git diff --check` — PASS

## Declarations

- Process execution added in the importer: NO (static scan; zero
  `child_process` / spawn / shell usage).
- Auto safety inference from SKILL.md text: NO.
- Auto trust: NO.
- Bundled code executed: NO.
- Registry runtime added: NO.
- Skill Registry started: NO.
- Holdback / science / benchmark / gold / paper touched: NO.
- Remote branch pushed: NO.
- Stale worktree `.worktrees/goal24-cp21` touched: NO.