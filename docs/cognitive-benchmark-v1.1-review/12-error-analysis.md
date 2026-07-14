# Error Analysis

The sole runtime blocker is a configuration incompatibility reported by the provider:

- Requested: model `kimi-k2.6`, temperature `0`, thinking disabled.
- HTTP result: 400, temperature invalid; service allows only `0.6` for this model.
- Attempts: 3; all classified as provider errors.
- Stop condition: three consecutive provider errors.

The adapter was hardened after diagnosis so this deterministic HTTP 400 is non-retryable in future fresh ledgers. Malformed model JSON is now classified as schema failure rather than provider failure, with a regression test for the three-failure stop.
