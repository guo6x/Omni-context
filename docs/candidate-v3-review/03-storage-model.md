# Storage model

The implementation reuses the existing versioned assertion schema; no destructive database migration was required. Structured provenance is stored in `assertions.provenance`, including `fidelity_version`, `evidence_kind`, source event IDs, verified source agent, state key, exact value, and transition metadata.

Raw events are stored as assertions with `evidence_kind=raw_event`, `state=observed`, a stable source event reference, and a participant entity derived only from the event envelope. Assertion serialization is versioned as `assertion-passage-v3`, which forces explicit re-embedding rather than reusing v2 vectors.

All rerun databases remain under `D:/OmniContext-candidate-v3/targeted-7/rerun-2/runs/`; none were reused between attempts.
