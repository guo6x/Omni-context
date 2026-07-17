# Success cases

These five compact cases are selected across different capabilities. Snippets are intentionally bounded; the raw supplemental results remain the machine source.

## formal-v2-memory_evolution-001

- Category: Memory Evolution
- Question: At checkpoint-1, what is Blair's current technology stack, which earlier states were historical, and what transitions occurred during cycle 1?
- Key event: passage: Blair: "the technology stack is Rust" Exact value: Rust | Blair now confirms the technology stack is Rust. State: current | observed State key: raw_event:formal-v2-memory_evolution-001-e02 | technology_stack Transition: Python -> Rust (corrected) Rejected conflicts: Python Source Agent: Agent-B Source Event ID: formal-v2-memory_evolution-001-e02 Raw…
- Answer summary: At checkpoint-1, Blair's current technology stack is Rust. The earlier state was Python, which is now historical. The transition during cycle 1 was from Python to Rust.
- Core score: 1
- Why successful: Completed with core_score=1; selected evidence and structured answer retained source identifiers.
- Evidence: `case-evidence/formal-v2-memory_evolution-001.json`

## formal-v2-conflict_resolution-001

- Category: Conflict Resolution
- Question: Resolve Casey's work arrangement conflict for checkpoint-1: give the current value, preserve history, and explicitly reject invalid or low-confidence claims.
- Key event: passage: A low-confidence import says Casey's work arrangement is onsite every day. Exact value: A low-confidence import says Casey's work arrangement is onsite every day. State: observed State key: raw_event:formal-v2-conflict_resolution-001-e02 Transition: Rejected conflicts: Source Agent: Agent-B Source Event ID: formal-v2-conflict_resolution-001-e02 Raw …
- Answer summary: hybrid two days onsite
- Core score: 0.8333333333333334
- Why successful: Completed with core_score=0.8333333333333334; selected evidence and structured answer retained source identifiers.
- Evidence: `case-evidence/formal-v2-conflict_resolution-001.json`

## formal-v2-cross_agent_transfer-001

- Category: Cross-Agent Transfer
- Question: As a shared-memory agent in cycle 1, summarize Devon's long-term goal, preference, and latest checkpoint-1 status with exact source Agents, isolating incorrect reports.
- Key event: passage: Devon: "Devon's long-term goal: launch a community workshop." Exact value: Agent-A records Devon's long-term goal: launch a community workshop. | launch a community workshop State: current | observed State key: devon_long_term_goal | raw_event:formal-v2-cross_agent_transfer-001-e01 Transition: Rejected conflicts: Source Agent: Agent-A Source Event I…
- Answer summary: Devon's long-term goal is to launch a community workshop (Agent-A). Devon prefers written weekly summaries (Agent-B). Checkpoint-1 status is implementation (Agent-A). Agent-B's low-confidence report that checkpoint-1 is cancelled is incorrect and rejected.
- Core score: 1
- Why successful: Completed with core_score=1; selected evidence and structured answer retained source identifiers.
- Evidence: `case-evidence/formal-v2-cross_agent_transfer-001.json`

## formal-v2-human_like_forgetting-005

- Category: Human-like Forgetting
- Question: For Avery's checkpoint-5 planning, identify the memory that should remain influential and structurally reject stale, invalidated, or noisy items.
- Key event: passage: important Exact value: Avery repeats that opened the settings page for cycle 5 remains important. | important State: current | observed State key: importance | raw_event:formal-v2-human_like_forgetting-005-e02 Transition: Rejected conflicts: Source Agent: Agent-A Source Event ID: formal-v2-human_like_forgetting-005-e02 Raw Source Quote: Avery repeat…
- Answer summary: The memory that should remain influential for Avery's checkpoint-5 planning is that Avery opened the settings page for cycle 5, which is a high-value long-term low-value repetition. The drone purchase plan is withdrawn and should be rejected. The blue button click is noise and should be rejected. The temporary headache is resolved and historical, not influential.
- Core score: 1
- Why successful: Completed with core_score=1; selected evidence and structured answer retained source identifiers.
- Evidence: `case-evidence/formal-v2-human_like_forgetting-005.json`

## formal-v2-decision_quality-014

- Category: Decision Quality
- Question: For Nova's budget allocation decision in cycle 14, compare Option A and Option B, respect the budget and stable-income constraint, and recommend a risk-aware next step.
- Key event: passage: Nova: "Nova has 981 dollars of risk budget and needs stable income." Exact value: 981 dollars | needs stable income | Nova has 981 dollars of risk budget and needs stable income. State: current | observed State key: Nova:has_budget | Nova:needs | raw_event:formal-v2-decision_quality-014-e02 Transition: Rejected conflicts: Source Agent: Agent-A Sourc…
- Answer summary: Given Nova's $981 risk budget and need for stable income, Option A (stability but limited autonomy) aligns with the stable-income constraint, while Option B (high autonomy but uncertain income) does not. A risk-aware next step is to take the reversible four-week test before checkpoint-14 to evaluate Option A's performance without committing fully.
- Core score: 0.925925925925926
- Why successful: Completed with core_score=0.925925925925926; selected evidence and structured answer retained source identifiers.
- Evidence: `case-evidence/formal-v2-decision_quality-014.json`

