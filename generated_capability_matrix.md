# Generated Capability Matrix

> Generated from `brain-server/src/schema/domain.ts` and `brain-server/src/mcp-tools.ts`.
> This is an interface inventory, not a claim that every product workflow is Freeze-ready.

## Domain schema

| Kind | Count | Values |
| --- | ---: | --- |
| Entity types | 19 | `principle`, `evidence`, `concept`, `tool`, `person`, `project`, `code_snippet`, `architecture_pattern`, `bug_vulnerability`, `business_logic`, `critical_review`, `capture_snapshot`, `memory`, `decision`, `goal`, `question`, `preference`, `event`, `task` |
| Relationship types | 30 | `derived_from`, `relates_to`, `depends_on`, `conflicts_with`, `extends`, `cites`, `belongs_to`, `supported_by`, `extracted_from`, `reviewed_by`, `references`, `decision_referenced`, `works_at`, `lives_in`, `studies_at`, `married_to`, `leads_to_conclusion`, `supersedes`, `superseded_by`, `revises`, `invalidates`, `historical_version_of`, `continues`, `reverses`, `opposed_by`, `outcome_of`, `learned_from`, `knows`, `uses`, `created_by` |
| Notification types | 9 | `insight`, `reminder`, `system`, `decay_warning`, `blindspot`, `proactive`, `proactive_question`, `conflict`, `consolidation` |

## MCP tools (25)

| Product line | Tool count | Tools |
| --- | ---: | --- |
| Long-term Memory | 16 | `record_capture`, `get_core_context`, `search_entities`, `add_entity`, `get_entity`, `add_relationship`, `get_graph_neighborhood`, `extract_from_capture`, `update_entity`, `vector_search`, `unified_memory_search`, `save_conclusion`, `ask_memory`, `graph_answer`, `set_core_principle`, `delete_entity` |
| Operations | 3 | `list_entities`, `get_stats`, `merge_entities` |
| Decision Intelligence | 5 | `get_decision_context`, `save_decision`, `analyze_decision`, `discuss_decision`, `get_decision_lineage` |
| Proactive Cognition | 1 | `get_decay_report` |
