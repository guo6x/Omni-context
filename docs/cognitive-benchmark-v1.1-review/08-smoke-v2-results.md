# Smoke v2 Results

Synthetic Smoke v2 completed 21/21 framework calibrations with zero final errors. A real interrupt was injected after 7 completions and resume finished the remaining 14 without duplicate completion. A separate one-item run recorded an injected terminal error; `retry-errors` then reran only that item and restored the manifest to 1/1 completed.

This validates orchestration, checkpoint, resume, and retry behavior only. It is not an Answer-quality or official LoCoMo result.
