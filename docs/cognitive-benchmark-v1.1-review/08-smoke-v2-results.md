# Smoke v2 Results

Synthetic Smoke v2 completed 21/21 framework calibrations with zero final errors. A real interrupt was injected after 7 completions and resume finished the remaining 14 without duplicate completion. A separate one-item run recorded an injected terminal error; `retry-errors` then reran only that item and restored the manifest to 1/1 completed.

This validates orchestration, checkpoint, resume, and retry behavior only. It is not an Answer-quality or official LoCoMo result.

The corrected real Kimi preflight separately completed 6/6 calls. Its mean absolute repeat delta was 0.04179, maximum per-dimension delta was 0.5, rank ordering was consistent, and schema success was 1.0.
