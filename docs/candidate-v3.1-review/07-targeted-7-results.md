# Targeted-7 results

The original run remains archived unchanged:

- Expected: 7
- Completed: 0
- Errors: 7
- Retry records: 14
- Overall: not computed

Its duplicated model path was corrected as an evaluation-environment exception. A standalone preflight then passed with root `D:\OmniContext-models-v3.2`, verified model SHA-256, local model status, and 1024 output dimensions.

The authorized fresh run is separately archived:

- Expected: 7
- Completed: 5
- Errors: 1
- Retry records: 3
- Partial completed-category overall: `0.6783333333333333`
- Completed-scenario Gold values: Candidate Pool `21/21`, Final-20 `18/21`, Answer Top-10 `9/21`
- Full Targeted denominator: 30; two scenarios were not completed

The sixth scenario exhausted its fixed retries after a truncated structured response and Kimi provider overload; the seventh did not start. The Targeted gate therefore failed. No Resume, retuning, Development 35, ablation, or tag creation was performed.
