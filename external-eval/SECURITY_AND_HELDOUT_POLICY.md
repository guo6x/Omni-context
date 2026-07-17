# Security and held-out policy

## Fixed boundary

- LongMemEval real records: unaccessed in this delivery.
- LoCoMo Conversation 1: adapter validation only if separately authorized by existing evidence.
- LoCoMo Conversations 2--10: sealed held-out; unaccessed in this delivery.
- Formal execution is not authorized by this repository or its preregistration alone.

## Two-phase protocol

Generation receives a custodian-produced file containing only history, timestamps, identifiers, and questions. It rejects fields named `answer`, `gold`, `evidence`, `reference`, or `score`. Its result JSONL is locked by SHA-256 before the process exits. Scoring runs separately, verifies that lock, may open Gold, may not start a product or answer provider, and verifies that the result bytes are unchanged after scoring.

Every formal open is recorded in an append-only JSONL access log without question or answer text. Authorization, dataset hash, product commit, adapter commit, preregistration hash, subset, expiry, and phase must all match. Low scores, retrieval failures, or uneven categories are never grounds to invalidate or rerun a formal evaluation.
