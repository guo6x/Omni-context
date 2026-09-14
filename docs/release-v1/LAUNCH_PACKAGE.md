# Omni-Context V1 Launch Package

> Status: release-preparation checklist
> Baseline: Goal29 V1 feature freeze
> DRG2: SATISFIED
> Principle: launch the frozen product; do not reopen feature development to make the launch look bigger.

## 1. Release thesis

**Category headline**

> Evidence-grounded decision control for long-lived AI agents.

**Mechanism**

> Qualify evidence → bind execution to the decision → read the world back → revise when reality disagrees.

**Trust anchor**

> Local-first, read-back verified, and owned by you.

## 2. Required launch assets

| Asset | Current state | Release action |
|---|---|---|
| README EN | current narrative | final post-Goal29 consistency pass |
| README ZH | current narrative | final post-Goal29 consistency pass |
| PRODUCT-VISION | DRG2 truth synced on release-doc branch; Goal27 internal reopen/revision truth must stay separated from public UX | merge after review |
| Landing | DRG2 truth synced on release-doc branch | merge after review |
| GitHub repository metadata | public description still uses legacy Memory OS / fully-offline positioning | update repository description immediately before/with launch |
| Windows installer | Goal29 controlled install PASS | choose fresh release artifact + checksum |
| Public demo | not recorded | record from `docs/release-v1/DEMO_SCRIPT.md` |
| Screenshots | partial/unknown | capture 3–5 from frozen V1 |
| MCP quick start | existing docs | verify instructions against frozen build |
| Architecture graphic | existing assets likely reusable | select one that matches current Judgment Core positioning |
| Public CLI alpha | private/internal implementation exists; not public | separate go/no-go decision; do not block Desktop launch unless owner chooses |
| Release claim audit | release-doc branch | final pass immediately before release |

## 3. Minimum launch package

A release may proceed without adding new features if these are ready:

1. Windows installer + SHA-256
2. README / Landing / GitHub repository metadata aligned to Goal29 truth
3. 90-second demo
4. 3–5 screenshots
5. install / MCP quick-start instructions
6. current-vs-internal-vs-future capability labels
7. known limitations
8. final claim audit

## 4. Screenshot set

Capture exactly these unless a better verified surface is available:

1. **Evidence substrate** — graph/search/timeline with source/time metadata
2. **Ask Brain / retrieval** — query with traceable local evidence
3. **Decision context** — saved decision + evidence/constraints
4. **Decision lineage** — earlier judgment and later revision/linked judgment
5. **Ownership** — export/restore or local settings / storage surface

Avoid screenshots that visually imply an unreleased public execution or public reopen feature.

## 5. Known launch limitations to state plainly

- Windows is the verified runtime baseline for Goal29.
- Linux/macOS runtime verification was not executed in the Goal29 workstation scope.
- Public `omctx` npm installation is not available unless separately released.
- Goal27 `omctx reopen` / DecisionRevision is **CURRENTLY_VERIFIED_INTERNAL**, not a public npm capability. It requires a short-lived human-only Desktop `control:reopen` session and never executes, retries, rolls back, or reuses old approval/grant/plan state.
- Desktop user-facing reopen UX is not a CURRENTLY_VERIFIED public surface.
- The real GitHub issue-close E2E is internal controlled-runtime evidence, not a public automation surface.
- External memory adapters and multi-runtime adapters remain FUTURE.
- No generic shell execution, LLM judge, or automatic rollback.

## 6. What does NOT block V1 launch

Unless a new release gate says otherwise, do not reopen V1 for:

- another paid LLM benchmark
- cross-provider evaluation
- new memory adapters
- more runtime adapters
- new GitHub write capabilities
- automatic rollback
- a generic shell agent
- a new public/Desktop reopen UX beyond the already-verified internal Goal27 runtime

Those belong to research extension or vNext.

## 7. Public CLI alpha decision

Treat `omctx` alpha as a separate product decision.

Current truth:
- package candidate exists
- `omctx@0.1.0-alpha.0`
- package is private and unpublished
- read-only commands plus human-only `approve`, `verify`, and Goal27 `reopen` control commands have internal verification evidence
- `reopen` only creates a new judgment/revision lifecycle; it does not execute or retry external writes

Go public only after:
- package metadata final audit
- command-level public capability matrix
- install/uninstall smoke
- security/secret scan
- README examples correspond exactly to shipped commands
- explicit owner release decision

Do not publish merely to reserve a name.

## 8. Final release gate

Before publishing or announcing, answer YES to all:

- [ ] Does every public capability claim map to repo + gate evidence?
- [ ] Are INTERNAL capabilities visibly labeled internal?
- [ ] Are TARGET/FUTURE items labeled?
- [ ] Is DRG2 described as SATISFIED but not an automatic release?
- [ ] Does the demo avoid pretending internal GitHub writes are public?
- [ ] Does the demo avoid presenting internal/private Goal27 reopen as a shipped public/Desktop user feature?
- [ ] Are installer/checksums from the chosen fresh release artifact recorded?
- [ ] Is the public GitHub repository description aligned with the Judgment Core positioning and free of the old `fully offline` absolute claim?
- [ ] Are legacy memory-centric marketing files excluded from current launch copy?
- [ ] Are no research claims expanded beyond the frozen paper evidence?
