# Holdback V2 - Two-Person Custody Handoff (Pending)

**Status:** `PHYSICAL_CUSTODY_HANDOFF_PENDING`
**Document type:** custody handoff pending material (metadata + procedure only; contains no holdback plaintext)
**Generated:** 2026-08-08
**Spec refs:** Goal 18HB spec sec. 15 (2-of-2 custody prep), sec. 22 (final statuses)
**Design refs:** Goal 18C custody package (see sec. 9 References)

## 1. Purpose

This document is the pending-material deliverable required by Goal 18HB spec sec. 15 for the sealed Holdback V2 two-person custody handoff. It records:

- why the physical custody handoff is still pending;
- the verified Goal 18C 2-of-2 custody design that the handoff will follow;
- fillable role templates (nothing pre-filled);
- the V2 artifact hash table (filled post-seal on 2026-08-08 from the actual sealed V2 outputs);
- the ceremony steps that must be executed before Goal 22;
- the anti-fabrication statement and the sealed/plaintext status.

This document contains no holdback plaintext, no seed material, and no real human identities or signatures.

## 2. Why this document is PENDING

Per spec sec. 15, this round may prepare custody handoff instructions, the share creation mechanism, role templates, hashes, and dummy verification, but must not fabricate real Custodian A / Witness B signatures:

- Two real human role-holders are not present in this environment, so no genuine role acceptance can be captured.
- Fabricating acceptance records is forbidden; therefore every identity and signature field in this package is empty.
- The custody-handoff status is recorded as `PHYSICAL_CUSTODY_HANDOFF_PENDING`.

Implications (per spec sec. 15):

- `PHYSICAL_CUSTODY_HANDOFF_PENDING` does not grant any access to holdback plaintext.
- The encrypted Holdback V2 remains sealed.
- The real two-person physical handoff and authorization must be completed before the official Goal 22 run.

The machine-side final status per spec sec. 22 is recorded by the V2 build itself and must be one of: `HOLDBACK_V2_SEALED`, `HOLDBACK_V2_READY_WITH_CUSTODY_PENDING`, `HOLDBACK_V2_BLOCKED`, `HOLDBACK_V2_INVALID`. The ideal outcome is `HOLDBACK_V2_READY_WITH_CUSTODY_PENDING` (machine work complete; only the physical custody handoff remains). This document is the custody-handoff companion to that machine status.

## 3. Goal 18C 2-of-2 custody design (summary)

The handoff follows the already-verified design in `../goal18c-output/two-person-custody-design.md`. The mechanism was rehearsed end-to-end with a fully fake artifact (`../goal18c-output/dummy-ceremony-report.md`); the official ceremony has not been executed.

### 3.1 Roles

| Role | Id | Duties | Separation |
|---|---|---|---|
| Custodian A | `custodian-a` | Holds share A of the secret material; verifies the seal manifest; initiates the authorization flow; never participates in Kernel implementation or result analysis. | Does not hold share B; cannot run without B. |
| Witness B | `witness-b` | Holds share B; verifies commits/hashes/config against the frozen checklist; jointly approves decryption and the single run; records the ceremony in the hash-chained access log. | Does not hold share A; cannot run without A. |

- The same person MUST NOT play both roles.
- Acceptance records are paper-anonymous by design; human identities are withheld. Two distinct Ed25519 keys sign the records (rehearsal fingerprints: custodian-a `7bf1fb9151a3020fe562a2aaa2bbf5783730552898cd3371774f16b654573d5a`, witness-b `7726f6335d428ef5b7a6c461fb33aed734858c2625085ecb86889c7d3eaed9cc`; see design sec. 2).
- Existing acceptance records are `rehearsal-provisional`; the official ceremony requires fresh records signed by the two human role-holders (checklist A13).

### 3.2 Share creation mechanism (XOR 2-of-2 additive secret sharing)

- `shareA = random bytes` (same length as the seed); `shareB = seed XOR shareA`; reconstruction `seed = shareA XOR shareB`.
- Either share alone is uniformly random and reveals nothing about the seed (perfect secrecy for 2-of-2).
- The split is executed only at the official ceremony in a joint A+B session; the seed exists in memory only and is never persisted, printed, or written to any log, stdout, chat summary, public manifest, or git.
- The two shares must reside on two independent devices or accounts (or equivalent physical separation). A single machine with two directories is the rehearsal-grade minimum and is NOT sufficient for the official ceremony (design sec. 4).
- Recovery: sealed recovery envelopes (each share printed/QR-encoded, sealed, stored with the other party plus a third escrow, opened only in a joint session), or joint re-issuance (new share set, re-seal, new authorization) (design sec. 6).
- Revocation: any unauthorized access attempt or tamper appends an `invalidate` event to the access log and destroys both shares in a joint session; full regeneration is then required (design sec. 9).

### 3.3 Hash cross-checks

- Custodian A verifies the seal manifest and the public hashes (sealed artifact, plaintext aggregate, seed hash) before initiating authorization.
- Witness B verifies commits, hashes, and config against the frozen checklist (`../goal18c-output/official-holdback-ceremony-checklist.md`).
- Authorization requires signatures from the project owner, Custodian A, and Witness B over the contract template (`../goal18c-output/holdback-authorization-contract.json`); `authorization_hash = sha256(canonical contract without signature fields)`.
- The one-shot runner refuses to start unless the authorization hash matches the access log entry and the output directory is non-overwritable (design sec. 5).

### 3.4 Access log

- Every ceremony and run event is appended to the hash-chained, append-only access log (`../goal18c-output/holdback-access-log-schema.json`); each entry `curr_log_hash` links to the previous entry via `prev_log_hash`.
- Verification recomputes the whole chain and records the tail hash; any tamper is detectable (design sec. 9).
- Dummy rehearsal evidence: 11 entries, chain verify '{"ok":true,"entries":11,"tail_hash":"3be1eaf5b9a11cd2939d82465e755088261dc5302115dbe39136181b5a9eb4ef"}' (`../goal18c-output/dummy-ceremony-report.md`).

## 4. Role templates (blank)

Fillable acceptance templates are provided in `work/custody-role-templates.md` (Custodian A and Witness B) together with the share-verification checklist. The identity fields are:

| Field | Value |
|---|---|
| custodian_id | (empty) |
| witness_id | (empty) |
| role_acceptance_timestamp | (empty) |
| signature (Ed25519) | (empty) |

All identity fields are intentionally empty; nothing in this package is pre-filled with fabricated human names or signatures.

## 5. V2 artifact hash table (filled post-seal 2026-08-08)

Every V2 artifact hash below was filled ONLY from the actual sealed V2 outputs (seal run 2026-08-08 01:31 local; see holdback-v2-seal-report.md and verify-seal-v2.mjs 34/34 PASS).

| Artifact | Intended location (confirm with V2 build) | Field | Placeholder value |
|---|---|---|---|
| Sealed artifact | `goal18hb-output/holdback-v2-sealed.bin` (repo ciphertext; active marker in `holdback-v2-active/`) | sha256 | `4737bc7746825cac27938682f1a82ada28044d8122a5c2b6c35a67efb54adbd3` |
| Plaintext aggregate hash | V2 fixtures plaintext (180 samples) | sha256 | `005aa51f1d030dae2019a70f2de705ac2b2a5480a9f2ce043930eef29057050a` |
| Fixture hash | V2 fixtures file | sha256 | `005aa51f1d030dae2019a70f2de705ac2b2a5480a9f2ce043930eef29057050a` |
| Gold hash | V2 gold file (scorer v1.1 contract) | sha256 | `80ab80ecb4784f783a4ba38d5511f5f10d16452b130a006a724c39d40209e45b` |
| Schema hash | V2 schema (frozen before generation) | sha256 | `aad31f90203322b2f71c586f21379eb991b5faa1ceeddf4185b92577293264f4` |
| Generator hash | generator identity record (spec sec. 5) | sha256 | `080930e01a96e42b1473327b471e7b20e35084a9f0da5f6621cd911977c13d78` |
| Integrity-suite hash | integrity test suite (RI-01..RI-04 + semantic audits) | sha256 | `47f643b1e9f1b067faef0f296ef4c8908f375748b73252c96353f7824bb644b1` |
| Seed hash identifier | new independent seed (offline custody only) | seed_hash / seed_id | `c627039c6930c35cbc62bd256bba89f8daab6278840b4af8ac4f1e8b43a2caa1` / `goal18hb-formal-seed-v1` |
| Manifest hash | V2 public manifest `goal18hb-output/holdback-v2-public-manifest.json` (frozen) | sha256 | `4e4239d4170b56286eb33cd832e66c3aa1c2c2ba3bb7053e050af7c7a4319d7a` |

Notes:

- Intended storage root for V2 artifacts is `goal18hb-output/holdback-v2-active/`; exact file names are confirmed against the V2 build outputs when the hashes are recorded.
- If the plaintext aggregate is defined over the single fixtures file, `005aa51f1d030dae2019a70f2de705ac2b2a5480a9f2ce043930eef29057050a` and `005aa51f1d030dae2019a70f2de705ac2b2a5480a9f2ce043930eef29057050a` resolve to the same value; both are recorded as defined by the V2 seal manifest.
- No hash is invented in this document.

## 6. Ceremony steps to be executed before Goal 22

### Part A - physical handoff and authorization (before Goal 22)

| # | Step | Ref |
|---|---|---|
| A0 | Two distinct human role-holders present (Custodian A and Witness B, not the same person) on two independent devices or accounts. | design sec. 2, sec. 4 |
| A1 | Project owner signs the authorization contract (template `../goal18c-output/holdback-authorization-contract.json`). | checklist A11 |
| A2 | Custodian A verifies the seal manifest and public hashes; Witness B verifies commits/hashes/config per the frozen checklist; open gates A3/A5/A8/A9 resolved. | checklist A1-A10 |
| A3 | Joint A+B session: fresh role acceptance records signed by the two human role-holders; acceptance key fingerprints recorded. | checklist A13 |
| A4 | Joint A+B session: XOR 2-of-2 split of the real V2 seed into shareA (Custodian A device) and shareB (Witness B device); in-memory check shareA XOR shareB equals the seed hash; seed plaintext never persisted. | checklist A12 |
| A5 | Both parties complete the share-verification checklist (`work/custody-role-templates.md`); share file hashes cross-checked and recorded. | checklist A12 |
| A6 | Custodian A and Witness B sign the authorization contract with their distinct keys; authorization_hash recorded in the access log. | checklist A11 |
| A7 | Optional: recovery envelopes sealed and escrowed in a joint session. | design sec. 6 |
| A8 | Every ceremony event appended to the hash-chained access log; chain verified; tail hash recorded. | checklist A10; design sec. 8 |

### Part B - official run (at Goal 22 only)

| # | Step | Ref |
|---|---|---|
| B1 | Pre-run checklist A1-A13 all PASS; B items were rehearsed in Goal 18C (B1-B8). | checklist A/B |
| B2 | One-shot run: decrypt only into the isolated run environment; no copying, viewing, debugging, or code/config modification; output to a non-overwritable directory. | checklist B1-B8 |
| B3 | Post-run: re-verify output hash; clear plaintext from the run environment; seal raw output; both parties sign the completion record; only aggregate results plus pre-registered error analysis enter the paper. | checklist C1-C6 |

Invalid-run rules (immutable, checklist sec. D): on infrastructure failure, hash mismatch, log tamper, or unauthorized access, append an `invalidate` event to the access log; do not repair in place; the split is void and requires full regeneration via seed-custody release plus new authorization. Any single-party attempt to decrypt/authorize/run invalidates the official holdback.

## 7. Anti-fabrication statement

- No real human signatures or names were fabricated; every identity and signature field in this package is empty.
- No hashes were invented; every V2 artifact hash in sec. 5 was filled from the actual sealed V2 outputs on 2026-08-08 (recorded in the seal report and verified by verify-seal-v2.mjs).
- No holdback plaintext was read, listed, or opened for this documentation work - including the offline custody location recorded in `../goal18c-output/physical-custody-manifest.json` and any holdback-fixtures.jsonl or raw seed material.
- Hashes and key fingerprints quoted from Goal 18C files are copied verbatim from those files.
- This package is metadata and procedure only; it grants no plaintext access and no authority to run models.

## 8. Sealed / plaintext status

- The encrypted Holdback V2 remains sealed.
- Holdback V2 plaintext stays in offline custody only (outside the repository) and is never written to the workspace, commands log, stdout, chat summary, public manifest, or git.
- `PHYSICAL_CUSTODY_HANDOFF_PENDING` is a custody status, not a plaintext-access status: pending handoff does not make the plaintext accessible.

## 9. References

- `../goal18c-output/two-person-custody-design.md` - verified 2-of-2 design (roles, split, storage, recovery, revocation)
- `../goal18c-output/official-holdback-ceremony-checklist.md` - immutable ceremony checklist (A/B/C/D)
- `../goal18c-output/physical-custody-manifest.json` - machine-readable custody inventory
- `../goal18c-output/holdback-authorization-contract.json` - authorization contract template
- `../goal18c-output/holdback-procedural-readiness.json` - readiness record (blockers B1-B3)
- `../goal18c-output/holdback-access-log-schema.json` - hash-chained access log schema
- `../goal18c-output/dummy-ceremony-report.md` - dummy rehearsal evidence
- `../goal18-output/holdback-public-manifest.json` - legacy holdback public manifest (metadata only)
- `work/custody-role-templates.md` - fillable role acceptance templates + share-verification checklist
