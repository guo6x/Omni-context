# Holdback V1 - RETIRED (never evaluated)

- Status: `RETIRED_BEFORE_EVALUATION` (record: `../legacy-holdback-retirement-record.json`)
- Reason: GLOBAL_BENCHMARK_DEFECT_DISCOVERED_PRE_EVALUATION (RI-02 generator-level dangling supports in TT15)
- Never scored, never used for model selection, never used for prompt tuning.
- V1 sealed artifacts are preserved UNMODIFIED as historical audit evidence in `../goal18-output/`:
  - holdback-public-manifest.json (sha256 d433bfa5edd9a10d361dd478a3b4a68a4e8271766b17e07f0c7976d6bdbb0fd8)
  - holdback-sealed.bin (sha256 f0d08a12731299fd0246492babc2edd118a08c836588ad0aa841b84543333ea3)
  - holdback-access-log.jsonl (sha256 1c39c97ec9077b439cfede437dd9973dcb7fe6aa566b16709114541783f5d151)
- V1 plaintext/seed were never accessed during retirement (offline custody, not listed/read/decrypted).
- Replacement: Holdback V2 (`../holdback-v2-sealed.bin`, `../holdback-v2-public-manifest.json`) - SEALED_PRE_VALIDATION.