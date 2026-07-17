# LongMemEval-V2 feasibility for Omni-Context

Evidence boundary: this assessment uses only the public README at official repository commit `be15ea6e995462f3391c1a610892df3f67dfa7bd`. No dataset, trajectory, question, answer, screenshot bundle, or environment state was downloaded or opened. Official source: <https://github.com/xiaowu0162/LongMemEval-V2>.

1. **Evaluation target.** V2 measures whether a memory system can retain experience from long multimodal web-agent trajectories and retrieve useful context for downstream questions, with accuracy and query latency both material.
2. **Difference from classic LongMemEval.** Classic LongMemEval is timestamped chat-assistant memory over sessions. V2 is agentic experience memory: states, actions, workflows, local gotchas, premise awareness, and optional images.
3. **Scale.** Public documentation reports 451 curated questions, five memory abilities, up to 500 trajectories per haystack, and up to 115M tokens in the largest haystacks, across web and enterprise domains.
4. **Backend fit.** Omni-Context could implement the documented `Memory.insert(trajectory)` and `Memory.query(query, query_image)` boundary for text-derived trajectory events and notes. Its current assertion/entity store is a plausible text memory backend, not yet a complete V2 backend.
5. **Required inputs.** A serious adapter must preserve ordered trajectory steps, action/observation pairs, page or application state, workflow boundaries, error outcomes, timestamps, and image references; query-time context may contain text and image items.
6. **Missing product interfaces.** The frozen product lacks a first-class trajectory schema, screenshot/image embeddings, environment-state identity, action-result linkage, 100M-token resumable bulk ingestion controls, and the V2 context-item contract.
7. **Estimated cost.** Even the small tier would require substantial local indexing and repeated reader calls. The medium tier and largest histories add storage, image preparation, embedding, and latency costs well beyond classic S-scale chat evaluation. A numeric budget requires authorized metadata and is deliberately not invented here.
8. **Main-paper suitability.** It is not suitable as a new main experiment in this delivery: the modality and agentic-state gap would expand the product and experimental scope rather than independently validate the frozen system.
9. **Follow-up suitability.** It is a strong follow-up for an Agentic Memory extension after a trajectory/state schema and multimodal evidence path exist.
10. **Priority.** Complete classic LongMemEval-S cleaned and LoCoMo QA held-out first. Treat V2 as subsequent work; do not place a V2 score in the current paper.

Recommendation: **FEASIBLE AS FOLLOW-UP, NOT IN CURRENT FORMAL SCOPE**.
