# Extraction changes

Candidate v3 preserves exact values, normalized values, state keys, source event IDs, source agents, and explicit transitions in the extraction schema. Provenance is accepted only when the LLM source span can be matched back to the raw transcript envelope.

The one allowed post-Targeted fix added bounded first-class raw-event evidence assertions. They preserve verbatim source text without interpreting an observation as a normalized current fact, allowing semantic retrieval to recover evidence omitted by the LLM extractor.

No scenario ID, Development value, Gold value, or benchmark-specific branch was added to product logic.
