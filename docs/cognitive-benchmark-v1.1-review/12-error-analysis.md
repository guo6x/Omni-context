# Error Analysis

Adapter v2.1 eliminated the previously observed truncation class: 0 of 33 physical attempts ended with `finish_reason=length`. Two Kimi responses failed exact schema validation and both recovered on the next physical attempt. No logical Judge call failed.

Retrieval-Only initially produced three DeepSeek Answer Schema errors. Retry-only recovered two. The final persistent case contained all required rejected-fact fields plus redundant `source_agents`; a narrow audited normalization removed only that non-schema field, retained the raw response, and still required strict Answer Schema v2 validation. No missing content was invented and the Schema was not widened.

Historical failed attempts remain in append-only JSONL and Ledgers. Final latest-record counts are errors=0 for all modes.
