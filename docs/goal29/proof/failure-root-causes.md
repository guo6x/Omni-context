# Goal29 V1 freeze — failure reproduction and root causes

Base under test: `69e3c12c1e9a0f4fca0080b96282c3d48025f464`.

All reproduction was performed in the isolated Goal29 worktree. No GitHub
write, npm publication, scientific benchmark, or Holdback payload was used.

## Fresh install entity search

- Classification: `WINDOWS_PORTABILITY_DEFECT` / `TEST_INFRASTRUCTURE_DEFECT`
- Reproduction: a new Brain database was initialized with the migration-created
  legacy `vec_entities` table, then the normal embedding profile produced a
  1024-dimensional query.
- Original error: `ENTITY_VECTOR_DIMENSION_MISMATCH: index=384 query=1024`.
- Root cause: a fresh install can legitimately have durable entity embedding
  blobs before the explicit profile/index rebuild creates a 1024-dimensional
  manifest. The old query path treated that transitional state as an error.
- Repair: normal mode searches the durable entity blobs while no entity index
  manifest exists and the query matches the active profile dimension. Existing
  manifests and evaluation mode remain fail-closed.
- Evidence: `embedding-index-manifest.test.ts` and the installed application
  E2E import/search path.

## Fresh install assertion persistence

- Classification: `WINDOWS_PORTABILITY_DEFECT` / `DETERMINISTIC_BASELINE_DEFECT`
- Reproduction: onboarding demo seeding created a relationship and assertion
  before `vec_assertions` had an explicit manifest.
- Original error: `EMBEDDING_INDEX_MANIFEST_MISSING: vec_assertions`; the seed
  transaction rolled back, and a concurrent upload then reported
  `FOREIGN KEY constraint failed` because its referenced entities no longer
  existed.
- Root cause: durable relationship/assertion creation was coupled to an
  optional vector-index row before the first profile rebuild.
- Repair: normal mode preserves the durable assertion and defers its vector
  row until the explicit rebuild; evaluation mode still fails closed.
- Evidence: `embedding-index-manifest.test.ts`, direct fresh-database
  reproduction, and the final installed-app onboarding/import E2E.

## Windows Brain test timeout noise

- Classification: `WINDOWS_PORTABILITY_DEFECT` / `TESTABILITY_DEFECT`
- Reproduction: the AgentLoop timeout test used a wall-clock `<500ms`
  assertion, and the skill-registry test performed 30 atomic persistent writes
  under the default 5-second Vitest timeout. Both are load-sensitive on this
  Windows workstation.
- Repair: AgentLoop timeout is driven with Vitest fake timers; the persistent
  concurrency test receives a 60-second test budget. Neither change alters the
  product timeout, registry, or atomic-write semantics.
- Evidence: Brain full regression `72 files / 1336 tests PASS` and standalone
  skill-bridge regression `21 tests PASS`.

## Windows native sqlite test isolation

- Classification: `WINDOWS_PORTABILITY_DEFECT`
- Root cause: concurrent Vitest file workers can race initialization of the
  native `sqlite3` / `sqlite-vec` modules on Windows, producing timeout or
  N-API initialization noise rather than a business failure.
- Repair: the Brain Vitest configuration serializes file workers only on
  Windows; POSIX retains file-level parallelism.
- Evidence: the final full Brain run passed with 72 files and 1336 tests.

## Onboarding E2E race and process cleanup

- Classification: `TEST_INFRASTRUCTURE_DEFECT`
- Root cause: the installed-app harness clicked onboarding and began import
  before the asynchronous demo-seed response completed; after restart, a
  packaged Brain/WebView child could also outlive the desktop process.
- Repair: the harness waits for the seed response and cleans only the unique
  E2E profile's Brain PID and reserved CDP listener.
- Evidence: the fresh installed-app run passed all 11 UI checkpoints,
  including restart persistence, export, and restore.

## CLI package dry-run target

- Classification: `DETERMINISTIC_BASELINE_DEFECT`
- Root cause: the root `cli:pack:dry` script invoked npm's default pack target
  from the `packages/omctx` directory instead of its declared `pack:dry`
  script, so Windows reported the root `omni-context` package rather than the
  authoritative `omctx@0.1.0-alpha.0` package.
- Repair: the root script delegates to `npm --prefix packages/omctx run
  pack:dry`; package contents and dependency versions were not changed.
- Evidence: dry-run reports `omctx@0.1.0-alpha.0`, 20 files, and the external
  installed tarball smoke passed help/version/doctor checks.

## Semantic and security conclusion

No new product capability, authority, execution gateway, retry, rollback,
approval, read-back, or outcome semantics were added. The repairs preserve
fail-closed behavior for explicit manifests/evaluation mode and only restore
the intended fresh-install transitional path.
