# Source and Gold Support Audit

## Result

- Full Omni scenarios audited: 35/35.
- Gold supported by original Events: 35/35.
- Scenarios with Dataset Defects: 5/35.
- Affected family: `cross_agent_transfer` (5/5 scenarios).
- Conflicting structured/text agent records: 7 events.

All required facts, transitions, invalidations, and required source-agent semantics can be located in original Event values, state fields, transition IDs, statuses, agents, or text. However, five Cross-Agent scenarios contain a systematic provenance defect: the structured `agent` field conflicts with the leading source named in Event text.

Examples include Event text beginning with `Agent C updates...` while the structured agent is `Agent-A`, and text beginning with `Agent X incorrectly reports...` while the structured agent is `Agent-B` or `Agent-D`. The generator uses a cycling agent assignment for a hard-coded textual agent, so the defect is not an isolated annotation typo.

This means Gold semantics remain understandable from complete Events, but the structured provenance substrate is internally inconsistent. Because Cross-Agent scoring explicitly requires exact source Agents, this is a Dataset Defect and not merely a product retrieval weakness.

Machine evidence: `evidence/source-gold-support-audit.json`.
