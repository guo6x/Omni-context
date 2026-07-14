# Conversation 1 Candidate v2 run

Accepted run: `2026-07-14T07-34-44-390Z-daef50a5`.

Configuration was `deepseek-v4-flash` for Extraction, Answer, and Judge; thinking disabled; `Xenova/multilingual-e5-large` at the pinned revision; 1024 dimensions. A clean new database ingested all 19 sessions. Session 14 produced two max-token-truncated provider responses and succeeded on the third auditable extraction attempt.

Two fail-fast discoveries preceded the accepted question run and remain archived:

1. an initial clean run stopped at 18/19 when Session 14 returned truncated JSON before extraction retry existed;
2. the next clean database completed 19/19 but preflight found 11 auto-merged aliases still indexed (386 vectors for 375 active entities).

After both production fixes, the 19/19 database was repaired through the explicit shadow rebuild before any question ran. An injected one-time Answer provider failure created a retry record, then a SIGINT acceptance event stopped safely at 15/199. Resume reused the same database and skipped those 15 IDs. The first full pass left two real network errors; `retry-errors` reran only those two.

Final state:

```text
completed=199
errors=0
missing=0
retry_records=14
duplicate_completed=0
entity_vectors=375/375
assertion_vectors=396/396
fallback_count=0
```

Formal metrics: Binary Accuracy 0.5025, Answerable Accuracy 0.4079, Evidence Precision 0.6868. Retrieval/Answer/total latency P50 was 2635/1571/7850 ms; P95 was 4115/3443/12265 ms.

Fifteen manually reviewed Judge decisions (three per category) produced 15 agreements and 0 disagreements. Evidence: `evidence/run/human-judge-review-15.json`.
