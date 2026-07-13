# 05 — Conversation 1 complete run report

Status: **FIXED**

Run ID: `2026-07-13T16-54-49-815Z-1b9d6c9a`

Only official LoCoMo Conversation 1 was accessed. The run used real `deepseek-v4-flash` extraction, answer, and judge requests plus local semantic embeddings (`Xenova/multilingual-e5-small`). Answer and Judge used the same model and that limitation is disclosed rather than treated as independent validation.

## Exact run accounting

| Field | Value |
|---|---:|
| expected questions | 199 |
| completed questions | 199 |
| error questions | 0 |
| retry records | 6 |
| unique completed question IDs | 199 |
| duplicate completed question IDs | 0 |
| missing question IDs | 0 |
| answerable | 152 |
| adversarial | 47 |
| started at | `2026-07-13T16:54:49.825Z` |
| completed at | `2026-07-13T17:30:15.836Z` |
| duration | 2,126,011 ms |
| manifest status | `completed` |

Category counts are temporal 37, multi-hop 13, single-hop 32, open-domain 70, and adversarial 47. The isolated final database contains 396 entities, 181 relationships, and 423 assertions; extraction failures are zero.

## Metrics

| Metric | Value |
|---|---:|
| composite | 0.672375767727526 |
| binary accuracy | 0.4824120603015075 |
| factual | 0.6007035175879397 |
| temporal | 0.7169346733668343 |
| contextual | 0.5863819095477387 |
| abstention | 0.678391959798995 |
| evidence precision | 0.45184254606365154 |
| stale memory leakage | 0 |

The metrics and independent recomputation files are byte-for-byte equivalent after stable JSON serialization and share SHA-256 `34fe5c47ecb4b841dae2860249adb4bec579d5ba74635c6949513d9242bf10e3`. Low scores are preserved without tuning or exclusion.

Dataset SHA-256: `553cd5a15e25f2ceccc6ed185221eba645080c93e5b91087560a91aa5961f365`. Database SHA-256: `13766bb6afba62a272ff4a5f61753a4b78e73e48fc4b06c2ac596adf317b08d7`.

Evidence: `evidence/benchmark-conv1/manifest.json`, `results.jsonl`, `metrics.json`, `recomputed-metrics.json`, `question-integrity.json`, `database-summary.json`, and `database-hash.txt`.
