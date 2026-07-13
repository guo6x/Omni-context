# LoCoMo datetime parser report

Status: `FIXED`

## Production change

`benchmark/src/dataset.mjs` now uses parser version `locomo-datetime-v2`. It parses explicit fields with regular expressions and numeric validation; it does not pass input strings to `new Date(string)`.

Supported inputs include:

- `YYYY-MM-DD HH:mm:ss`
- `YYYY-MM-DDTHH:mm:ss`
- ISO timestamps with `Z`, numeric offsets, and fractional seconds
- `h:mm am on D Month, YYYY`
- `h:mm pm on D Month, YYYY`
- full and abbreviated English month names
- date-only ISO, day-first English, and month-first English forms

For LoCoMo values without a timezone, the documented assumption is UTC. Explicit offsets are normalized and applied deterministically.

## Failure behavior

- Every parse failure emits a message containing the session ID and original value.
- Evaluation ingestion enables fail-fast behavior, so an invalid or missing session timestamp stops the run.
- Non-evaluation callers receive structured metadata with `parsed_timestamp: null` only after the warning is emitted.

## Persisted metadata and ordering

Every session now carries:

- `raw_date_time`
- `parsed_timestamp`
- `parser_version`
- `timezone_assumption`

Sessions are sorted by parsed timestamp. If parsed time order differs from session-number order, the runner emits an audit warning containing both orders. The run manifest records the parser version and timezone assumption.

## Verification

- 25 table-driven valid-format cases cover SQL, ISO, offsets, the official natural-language form, full/abbreviated months, date-only values, and leap day.
- Additional tests cover UTC documentation, invalid-date warnings, evaluation fail-fast, ordering conflicts, and per-session metadata.
- Full benchmark result: 146 tests passed, 0 failed.
- Official Conversation 1 check: 19 sessions, 199 questions, 0 timestamp parse failures, 0 order warnings.
- Conversation 2-10 were not read by the audit reader and were not executed.

## Evidence

- `docs/delivery-v3.1/evidence/datetime-parser/official-conversation1-parse.json`
- `docs/delivery-v3.1/evidence/datetime-parser/benchmark-tests.log`

## Remaining risk

This closes the datetime-parser P0. End-to-end benchmark readiness still depends on the isolated runtime, extraction, structured citation/metric, resume/retry, and external E2E tasks tracked separately.

