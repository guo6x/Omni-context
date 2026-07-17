# Failure cases

All three terminal errors are retained. None entered scoring; each affects the corresponding completion/error count.

## formal-v2-memory_evolution-039 (full_omni)

- Attempts: 3; requested max_tokens: 1200
- Completion tokens: 1200|1200|1200; finish_reason: length|length|length
- Error: Unterminated string in JSON at position 3710 (line 76 column 31) | Unterminated string in JSON at position 3786 (line 78 column 66) | Unterminated string in JSON at position 3710 (line 76 column 31)
- Scoring: not entered; retained as an error.
- Classification: Provider structured-output truncation; not scored as product capability.
- Paper reporting: Report as a final error after three allowed attempts; do not impute a score.

## formal-v2-memory_evolution-040 (full_omni)

- Attempts: 3; requested max_tokens: 1200
- Completion tokens: 1200|1200|1200; finish_reason: length|length|length
- Error: Unterminated string in JSON at position 3645 (line 80 column 119) | Unterminated string in JSON at position 3677 (line 84 column 12) | Unterminated string in JSON at position 3677 (line 84 column 12)
- Scoring: not entered; retained as an error.
- Classification: Provider structured-output truncation; not scored as product capability.
- Paper reporting: Report as a final error after three allowed attempts; do not impute a score.

## formal-v2-conflict_resolution-014 (retrieval_only)

- Attempts: 3; requested max_tokens: 1200
- Completion tokens: 490|346|336; finish_reason: stop|stop|stop
- Error: schema validation failure | schema validation failure | schema validation failure
- Scoring: not entered; retained as an error.
- Classification: Provider/schema robustness at the benchmark boundary; not a Full Omni product-core failure.
- Paper reporting: Report as a final error after three allowed attempts; do not impute a score.

