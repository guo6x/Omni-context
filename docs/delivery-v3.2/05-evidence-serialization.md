# Evidence serialization

Versions:

- entity: `entity-passage-v2`
- assertion: `assertion-passage-v1`

Assertion passages lead with a readable fact and include human subject/object, recoverable original predicate, source quote, speaker/session provenance, event/validity time, and status. `original_predicate` is persisted separately from the graph-compatible normalized predicate, so values such as `attended`, `prefers`, `has_goal`, `moved_from`, `married`, `experienced`, `learning`, and `plans_to` survive retrieval and display.

Entity passages contain name, type, description, aliases, limited relevant source text, and temporal status. UUID-only facts, metadata dumps, internal audit fields, and repeated source JSON are excluded.

Golden tests assert stable readable output, original-predicate preservation, UUID exclusion from fact text, and serialization-version invalidation.
