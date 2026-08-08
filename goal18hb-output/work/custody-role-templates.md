# Custody Role Templates - Custodian A & Witness B (Fillable)

**Status:** `PHYSICAL_CUSTODY_HANDOFF_PENDING`
**Document type:** fillable templates + share-verification checklist for the official two-person custody handoff (metadata + procedure only)
**Generated:** 2026-08-08
**Design refs:** `../../goal18c-output/two-person-custody-design.md` (sec. 2 roles, sec. 3 split, sec. 4 storage), `../../goal18c-output/official-holdback-ceremony-checklist.md` (A11/A12/A13), `../../goal18c-output/holdback-authorization-contract.json`
**Companion doc:** `../holdback-v2-custody-handoff-pending.md`

## Usage rules

- Print one copy per role. Fill the templates only in a joint A+B session with both human role-holders present.
- Every field below is intentionally blank; do not pre-fill names, timestamps, or signatures.
- Sign with the role's Ed25519 key; a handwritten signature may be captured in addition if the ceremony requires paper evidence.
- Paper-anonymous by design: human names may be withheld; role IDs and key fingerprints are the operative identity.
- These templates are fillable material, not executed records. Execution requires the two human role-holders at the official ceremony.

## 1. Custodian A - Role Acceptance

| Field | Value |
|---|---|
| Role | Custodian A |
| role_id | custodian-a |
| custodian_id |  |
| key_fingerprint (official, record at ceremony) |  |
| role_acceptance_timestamp |  |
| signature (Ed25519) |  |

Rehearsal-provisional reference (from `../../goal18c-output/two-person-custody-design.md` sec. 2): key fingerprint `7bf1fb9151a3020fe562a2aaa2bbf5783730552898cd3371774f16b654573d5a`. If the official ceremony uses a fresh key, record the fresh fingerprint in the table above.

Declaration - Custodian A:

- I accept the role of Custodian A in the Holdback V2 two-person custody scheme.
- I will hold share A on my own device or account only and will not hold share B.
- I will verify the seal manifest and the public hashes before any authorization.
- I will not act alone: decryption, authorization, and the single run require joint action with Witness B.
- I will not participate in Kernel implementation or result analysis (role separation).
- I will not access, copy, or view holdback plaintext outside the isolated run environment.

Handwritten signature (optional, paper-anonymous): ______________________

## 2. Witness B - Role Acceptance

| Field | Value |
|---|---|
| Role | Witness B |
| role_id | witness-b |
| witness_id |  |
| key_fingerprint (official, record at ceremony) |  |
| role_acceptance_timestamp |  |
| signature (Ed25519) |  |

Rehearsal-provisional reference (from `../../goal18c-output/two-person-custody-design.md` sec. 2): key fingerprint `7726f6335d428ef5b7a6c461fb33aed734858c2625085ecb86889c7d3eaed9cc`. If the official ceremony uses a fresh key, record the fresh fingerprint in the table above.

Declaration - Witness B:

- I accept the role of Witness B in the Holdback V2 two-person custody scheme.
- I will hold share B on my own device or account only and will not hold share A.
- I will verify commits, hashes, and config against the frozen checklist before any approval.
- I will jointly approve decryption and the single run with Custodian A; I will not act alone.
- I will record the ceremony in the hash-chained access log and verify the chain.
- I will not access, copy, or view holdback plaintext outside the isolated run environment.

Handwritten signature (optional, paper-anonymous): ______________________

## 3. Share-Verification Checklist (joint A+B session)

| # | Check | Custodian A initial | Witness B initial |
|---|---|---|---|
| S1 | Two distinct humans present; two independent devices or accounts; no person holds both roles. |  |  |
| S2 | Fresh role acceptance records signed above (never fabricated). |  |  |
| S3 | V2 seed present in memory only; seed_id `TBD_AFTER_SEAL_V2_SEED_ID` and seed_hash `TBD_AFTER_SEAL_V2_SEED_HASH` recorded. |  |  |
| S4 | shareA = random bytes (length equals seed length), generated in the joint session. |  |  |
| S5 | shareB = seed XOR shareA, generated in the joint session. |  |  |
| S6 | In-memory reconstruction check: shareA XOR shareB equals the seed; recomputed hash matches the recorded seed hash. |  |  |
| S7 | shareA written only to the Custodian A device/account; shareB written only to the Witness B device/account. |  |  |
| S8 | shareA file sha256 and shareB file sha256 recorded; both parties cross-check the two recorded hashes. |  |  |
| S9 | Seed plaintext destroyed in memory; nothing persisted to commands log, stdout, chat summary, public manifest, or git. |  |  |
| S10 | Custodian A verified the seal manifest and public hashes (A-check). |  |  |
| S11 | Witness B verified commits, hashes, and config per the frozen checklist (B-check). |  |  |
| S12 | Authorization contract signed by project owner + Custodian A + Witness B; authorization_hash recorded. |  |  |
| S13 | Every ceremony event appended to the hash-chained access log; chain verified; tail hash recorded. |  |  |
| S14 | Optional: recovery envelopes sealed and escrowed (joint session). |  |  |

Completion rule: the checklist is complete only when both initials are present for every row and both role acceptance records are signed by the two human role-holders.

## 4. Consistency with Goal 18C

- Role definitions, key separation, and duties: `../../goal18c-output/two-person-custody-design.md` sec. 2.
- XOR 2-of-2 share creation and verification: design sec. 3 (rehearsed in `../../goal18c-output/dummy-ceremony-report.md`).
- Storage and separation requirements: design sec. 4.
- Checklist items A11 (authorization), A12 (two-person custody split), A13 (role acceptance records): `../../goal18c-output/official-holdback-ceremony-checklist.md`.
- Authorization contract template: `../../goal18c-output/holdback-authorization-contract.json`.
- Placeholder tokens (seed_id / seed_hash) match the hash table in `../holdback-v2-custody-handoff-pending.md` sec. 5.
