# Post-Goal29 Release Claim Audit

> Initial audit date: 2026-09-10
> Last release-truth refresh: 2026-09-15
> Truth baseline: `main@d4d61f1c9b73d8a127023129adc3376ec6d7db13` plus evidence-preserving release/security maintenance on PR #5
> Scope: public/release-facing narrative. This audit does not alter research artifacts, Holdback data, research protocols, or evaluation results. PR #5 also contains separately documented dependency and Windows execution-broker security maintenance; those changes preserve the frozen product claim boundary and add no new product feature.

## 1. Authoritative facts

The current release narrative must respect the repository truth chain:

`remote SHA / protected refs > checkpoint gate + manifest > execution ledger > executor report > chat memory`.

Verified facts relevant to release claims:

- Goal29 V1 feature freeze is active.
- Goal29 added no new product feature and changed no product semantics.
- Windows controlled V1 evidence is PASS: Brain 1336/0, CLI 44/0, Rust 236/0 (9 ignored), browser extension 14/0, installed Desktop E2E 11/11.
- DRG1 is SATISFIED.
- DRG2 is SATISFIED by one real, non-synthetic, approval-gated GitHub issue-close E2E with independent read-back.
- In that E2E, process exit 0 did not equal semantic success: outcome remained PENDING until trusted read-back observed CLOSED, then the deterministic evaluator returned VERIFIED.
- DRG2 satisfaction is not an automatic public release.
- `omctx@0.1.0-alpha.0` is implemented and internally verified/private; it is not an npm user install today.
- Goal27 human-only `omctx reopen` / DecisionRevision runtime is **CURRENTLY_VERIFIED_INTERNAL**. It requires a short-lived Desktop `control:reopen` session, requalifies current evidence through the trusted Evidence Surface, runs the same deterministic Decision Kernel, and may create a fresh unapproved plan. It never executes, retries, rolls back, verifies reality itself, or reuses old approval/grant/plan authority.
- Agent Pilot cannot reopen. Desktop/public user-facing reopen UX is not a CURRENTLY_VERIFIED public surface.
- Goal27 Gate evidence is PASS: reopen authority, revision evidence, and revision integrity. Goal29 also records Goal27 regression/adversarial PASS.
- The current MCP manifest exposes 26 tools.
- Browser-extension capture is a CURRENTLY_VERIFIED user-facing surface.
- Local-first does not mean every optional data path is offline: if a cloud LLM provider is configured for extraction or generation, data sent to that provider follows its data path and policy.
- The installed stdio MCP proxy forwards to the running loopback Brain Server and does not directly open the SQLite database; `DB_PATH` belongs to standalone/server scenarios, not the normal installed-proxy path.
- No claim of working with any memory OS or any runtime is permitted.
- No claim of generic shell execution, LLM judge, automatic rollback, public GitHub automation, or public/Desktop reopen UX is permitted without separate release evidence.

## 2. Findings

### MUST FIX — resolved on this branch

1. `docs/PRODUCT-VISION.md` still listed a real non-synthetic E2E as FUTURE and described DRG2 in pre-pass language.
2. `docs/index.html` still showed a pre-pass DRG2 gate card even though the authoritative DRG2 gate is PASS.
3. README EN/ZH described the capability vocabulary as exactly three labels while also using `CURRENTLY_VERIFIED_INTERNAL`; this is now separated into three public capability classes plus claim-governance qualifiers.
4. README.zh-CN.md retained pre-DRG2 wording saying claims were frozen until a real E2E existed; it now records DRG2 as satisfied without treating that as automatic release authorization.
5. README EN/ZH installer copy said `Fully offline / 完全离线`; this is now narrowed to the supported local-first storage/authority claim and explicitly discloses optional cloud LLM data paths.
6. README EN/ZH omitted the browser-extension capture surface from the current user-facing list even though it is in the current claim matrix; it is now listed.
7. `docs/goal24/narrative/claim-audit.md` contained an accurate but stale 2026-08-16 snapshot whose counts and pre-DRG2 next actions could be mistaken for current truth; it is now explicitly marked historical and points here.
8. `docs/ARCHITECTURE.md` used an unmaintained `12+ MCP clients` count. It now describes the concrete stdio-proxy / loopback-HTTP architecture without turning client examples into a universal compatibility claim.
9. `docs/MCP-INTEGRATION.md` said the current MCP count was 25 even though the generated manifest says 26. The document now delegates the canonical count to `mcp_tool_manifest.json` and treats its tables as selected/common tools rather than a complete hand-maintained list.
10. `docs/MCP-INTEGRATION.md` incorrectly described the installed proxy as a second database-using Node process and pointed users toward an install-directory database. It now reflects the actual installed path: stdio proxy → authenticated loopback Brain Server → Desktop-managed local database; `DB_PATH` is documented only for standalone/source-server use.
11. MCP integration prose previously used broad “any compatible AI client” wording as if it were an Omni compatibility guarantee. It now says compatibility depends on the client’s implemented MCP transport/configuration and explicitly does not claim “any AI / any runtime”.
12. Post-Goal29 narrative inherited a pre-Goal27 assumption that `omctx reopen` runtime was not implemented. Direct repo/gate audit shows the opposite: Goal27 `control:reopen`, DecisionRevision service, CLI command, adversarial tests and three Goal27 gates are present on `main` and are included in the Goal29 regression/freeze evidence. Release copy is corrected to classify this as **CURRENTLY_VERIFIED_INTERNAL** while keeping public npm/Desktop UX unshipped.

### MUST FIX BEFORE PUBLIC RELEASE — repository metadata

The GitHub repository description remains legacy metadata and is outside this branch's file diff. At the time of this audit it still uses the old memory-OS positioning, says `25 MCP tools`, and says `fully offline`. Before a public release announcement, update the repository description to current evidence-bounded positioning and the canonical 26-tool count. Do not copy the legacy description into release material.

The current GitHub Latest Release is also still the 2026-07-14 `evaluation-freeze-candidate-v2` with old `0.1.1` installer assets and evaluation-era release notes. It is not the Goal29 V1 artifact. A new versioned artifact and release decision remain required.

### MUST NOT SHIP AS CURRENT COPY

The following files remain historically useful but contain pre-O1 / memory-centric launch language and must not be copied into current release material without a rewrite:

- `docs/MARKETING.md`
- `docs/SOCIAL-POST-READY.md`
- `docs/DEMO_SCRIPT.md`

Examples of stale positioning include "跨所有 AI 通用", "one memory, shared across every AI", "Long-term memory for any AI", and a demo centered on cross-client shared memory rather than the current Judgment / Authority Core thesis.

These files are marked LEGACY on this branch.

### REVIEWED FOR RELEASE CONTEXT

- `docs/ARCHITECTURE.md` — reviewed and corrected for MCP transport/count/compatibility wording; it remains an implementation document, not a capability-completeness claim.
- `docs/MCP-INTEGRATION.md` — reviewed against `mcp-proxy.ts`, Desktop Brain launch/data-path code, `/mcp` transport evidence, and `mcp_tool_manifest.json`; stale installed-DB and tool-count instructions are corrected on this branch.
- Goal27 reopen/revision — reviewed against `brain-server/src/revision/service.ts`, `packages/omctx/src/commands/locked.js`, `packages/omctx/src/cli.js`, `packages/omctx/test/reopen-command.test.js`, `docs/goal27/gates/*.json`, and `docs/goal29/proof/v1-freeze-proof.json`. Correct interpretation: internal/private and human-only, not public/Desktop-shipped.

## 3. Current launch-safe product story

Category headline:

> Evidence-grounded decision control for long-lived AI agents.

Trust anchor:

> Local-first, read-back verified, and owned by you.

Mechanism:

> Qualify evidence before action → bind execution to the decision → read the world back → reopen/revise when reality disagrees.

Current public evidence must distinguish:

- CURRENTLY_VERIFIED user-facing capabilities;
- CURRENTLY_VERIFIED_INTERNAL runtime evidence;
- TARGET architecture;
- FUTURE user surfaces / ecosystem capabilities;
- DO_NOT_CLAIM governance prohibitions.

For reopen specifically:

> **Internal Goal27 correction runtime exists; public user-facing reopen does not.**

That distinction must survive README, Landing, demo, release notes, CLI documentation, and screenshots.

## 4. Release sequence after Goal29

DRG2 is no longer the blocker. The remaining release work is:

1. Packaging and clean release CI
2. Repository metadata truth sync
3. Release version + fresh Windows artifact
4. Public CLI alpha decision
5. Public demo
6. Launch package
7. Final release claim audit

No new paid model evaluation is required for this release sequence.
