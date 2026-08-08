# Holdback V2 - ACTIVE (SEALED_PRE_VALIDATION)

- Status: `SEALED_PRE_VALIDATION` (machine-side complete; physical custody handoff pending)
- Sealed artifact: `../holdback-v2-sealed.bin` (sha256 4737bc7746825cac27938682f1a82ada28044d8122a5c2b6c35a67efb54adbd3)
- Public manifest: `../holdback-v2-public-manifest.json` (sha256 4e4239d4170b56286eb33cd832e66c3aa1c2c2ba3bb7053e050af7c7a4319d7a)
- Access log: `../holdback-v2-access-log.jsonl` (sha256 472294af320c20d335366e4f81a6374248d15bed1a09a987c228103d5705818c)
- Plaintext: OFFLINE CUSTODY ONLY (`C:/Users/00/.codex/goal18hb-holdback-custody/holdback-v2-fixtures.jsonl`, sha256 005aa51f1d030dae2019a70f2de705ac2b2a5480a9f2ce043930eef29057050a)
- Seed: offline custody (`seed.txt`); public record only seed_hash c627039c6930c35cbc62bd256bba89f8daab6278840b4af8ac4f1e8b43a2caa1
- Generator: goal18-generator/v2.1.0 @ cd53eaea538ac2992012e21e94370e918b166dde
- Verification: verify-seal-v2.mjs 34/34 PASS; integrity suite post-seal 18/18 PASS; no test-decrypt of formal V2 performed.
- Next human step: physical two-person custody handoff (Custodian A + Witness B) before any authorized run (Goal 22).