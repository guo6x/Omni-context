# Temporal Assertion Design

Status: PARTIALLY_FIXED

## Canonical model

An Entity identifies a durable subject. An Assertion records a claim about that subject and carries its own validity, confidence, source span, and provenance. Relationships remain available for graph traversal during migration, but factual state and change over time are represented by Assertions.

Each Assertion contains exactly one of `object_id` or `literal_value`. Its temporal axes are deliberately distinct:

- `observed_at`: when the source observed the fact.
- `recorded_at`: when Omni-Context stored it.
- `event_time`: when the described event occurred.
- `valid_from` / `valid_until`: the interval in which the fact is true.
- `invalidated_at`: when Omni-Context learned that the assertion should no longer be treated as current.
- `temporal_confidence`, `temporal_source`, and `timezone`: uncertainty and parsing provenance.

Current-state queries apply `valid_from <= now < valid_until` (with an open upper bound allowed). Historical queries apply the same interval rule at an explicit `asOf` timestamp. Invalidating a fact closes its interval and retains the row; it never deletes the old assertion.

## Provenance

`source_span` stores the supporting excerpt or span reference. `provenance` is structured JSON intended to carry document, chunk, capture, tool, and operator identifiers. Migration v15 creates a provenance-linked assertion for every existing relationship.

## Uncertainty and conflicts

Multiple assertions for the same subject and predicate may coexist when time ordering or truth cannot be determined. Automatic replacement is not part of this foundation migration. The conflict layer must later make replacement transactional, preserve evidence/model output, and require confirmation below its confidence threshold.

## Remaining work

- Integrate Assertion creation into chunked extraction and strict LLM output validation.
- Add brain-server relative-time parsing, including unknown timezone and conflicting dates.
- Move conflict resolution and single-valued replacement from Relationship to Assertion transactions.
- Make retrieval and answer grounding consume current or historical Assertions explicitly.
- Cover decision changes, goal pause/resume, same-day ordering, and uncertain dates end to end.
