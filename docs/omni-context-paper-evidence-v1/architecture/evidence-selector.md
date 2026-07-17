# Evidence Selector v2

The selector is implemented in `brain-server/src/retrieval/evidence-selector.ts` and called from `brain-server/src/api/handlers/mcp.ts`. It detects query intent, groups fused evidence, isolates raw-event channels, applies query-aware temporal options, and selects a diverse set while penalizing support-only or relationship-only graph noise. Runtime attestation fixes selector SHA-256 to `a37bbdcf589265db73d639c1b8b6c58a2baabee0e70537d6ecd860c9b928b949`.
