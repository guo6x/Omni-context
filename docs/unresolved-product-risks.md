# Unresolved Product Risks (未决产品风险)

This is the product-baseline risk register for `product/omni-v3-unified-r1`.
Risks are grouped by phase; each lists impact, evidence, and the required
follow-up. None of these are resolved on this branch.

## 1. Identity & evaluation

| # | Risk | Impact | Status / follow-up |
|---|---|---|---|
| R1 | `evaluation-freeze-candidate-v3.1` tag still points at `17dc1d0` (remote tag untouched) | Tooling/release readers may treat the engineering start as a freeze | Apply `docs/tag-remediation-proposal.md` (owner approval; delete/rename tag). Not done this round by design. |
| R2 | Current evidence selector has no formal performance proof | Any performance claim would be unsupported | New authorized benchmark on this baseline; none run this round. |
| R3 | Archived delivery reports contain "229/229", "272/329" style pass counts | Could be mistaken for product E2E validation | Treated as engineering regression evidence only; README/docs now state the product identity. |

## 2. Unified dispatch

| # | Risk | Impact | Status / follow-up |
|---|---|---|---|
| R4 | Unified implementation is based on the richer HTTP semantics; stdio clients now see `candidatePool`/`finalContext` in `unified_memory_search` | Slightly larger payloads over stdio; behavior change for direct-stdio users | Contract tests pin the shape; acceptable for product unification. |
| R5 | LLM rerank / agentic enrich / sediment call remote LLM when configured | Latency + data egress on MCP paths | Deterministic degradation implemented; users choosing a remote LLM are informed via consent flows. |
| R6 | HTTP adapter logs behavior events; a malformed event can raise a caught SQL error | Noise only (caught + warned) | Consider schema hardening for behavior_events in a later round. |

## 3. Embedding v3 migration

| # | Risk | Impact | Status / follow-up |
|---|---|---|---|
| R7 | Real migration not executed (fixture-only verification) | Production DBs still on old generation until operator runs the gated tool | Run `scripts/re-embed.mjs --profile e5-large --real` after local model install + hash verify. |
| R8 | Remote model download not performed this round | E5-large bundle not present on dev machines | Follow `docs/BUILDING.md` model install + SHA-256 verification steps. |
| R9 | `normalized` default = 1 for legacy rows | Rarely a false "normalized" claim for pre-profile fallback rows | Re-embed rewrites with the real profile flag; `verifyEmbeddingIndexConsistency` checks it. |
| R10 | Shadow build requires sqlite-vec loaded | Migration impossible on sqlite-vec-less environments | Desktop bundles sqlite-vec; documented requirement. |

## 4. Clean-room engineering

| # | Risk | Impact | Status / follow-up |
|---|---|---|---|
| R11 | Desktop `Cargo.lock` tracked but not regenerated this round (cold-build downloaded deps) | Lockfile may drift from a fresh resolve | Regenerate via `cargo generate-lockfile` in CI and diff. |
| R12 | Tauri controlled-file snapshot must be updated on every intentional controlled change | Guard fails until re-snapshotted | By design; `npm run snapshot:controlled` documents intent. |
| R13 | `next build` produced a local `out/` (gitignored) | Fresh CI must run `next build` before `cargo test` | Documented in BUILDING.md; Tauri macro requires `out/`. |
| R14 | Browser/desktop/mobile are Windows-verified only | macOS/Linux packaging untested | Community/CI follow-up. |

## 5. Privacy & device security

| # | Risk | Impact | Status / follow-up |
|---|---|---|---|
| R15 | ESP32 nonce queue bounded (4096) — flooding can evict old nonces | Replay bounded to the 120s timestamp window | Consider a persistent per-device high-watermark nonce (future). |
| R16 | UDP is authenticated (HMAC) but not encrypted; LAN exposure is operator-opt-in | Eavesdropping possible on open LAN | `OMNI_UDP_BIND` loopback default; document remains in PROTOCOL.md. |
| R17 | Browser redaction is pattern-based (best-effort) | Novel secret formats may slip through | Users informed content may leave machine when remote LLM is configured. |
| R18 | Device tokens expire after 90 days with no re-enrollment prompt | Devices silently drop to 401 | Add a renewal/re-enrollment UX in a later round. |
| R19 | Desktop `captureBlocklist` matches foreground window title heuristics | Possible false negatives for renamed windows | Heuristic exclusion; not a security boundary. |

## 6. Process / branch hygiene

| # | Risk | Impact | Status / follow-up |
|---|---|---|---|
| R20 | Product branch not yet pushed to origin | Work is local-only | Push `product/omni-v3-unified-r1` after owner review. |
| R21 | Concurrent goal agents share the repo object DB | Branch/tag churn possible | This branch lives in its own worktree; verify before push. |

## Handling policy

- No risk in this register is treated as "resolved" without evidence.
- R1/R7/R8/R20 require **owner/operator action**; the rest are engineering
  follow-ups tracked on this branch.
- Any future claim about retrieval performance or product readiness must first
  close R2 (formal benchmark on this baseline).
