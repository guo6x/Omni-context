# Evidence grouping

Evidence is grouped by a scope-safe key: source event ID, sorted source-event IDs hash, document plus source-span hash, then candidate ID. User, tenant, conversation, session, and document scope are included to prevent cross-scope merging.

Each retrieval channel contributes at most once to a group. The group retains normalized assertions, raw events, entities, source agents, states, state keys, transitions, rejected conflicts, confidence, original ranks, and source-event IDs. Distinct states remain visible inside the group.
