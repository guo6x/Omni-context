# Kimi LongMemEval Judge Preregistration v1

## Status

NOT AUTHORIZED / NOT RUN

## Supersession

This scoring preregistration is created as part of LongMemEval preregistration v3. It defines the Kimi-K2.6 judging protocol that replaces the official GPT-4o scorer.

## Rationale

The project elected not to use OpenAI API or GPT-4o as the judge. Kimi-K2.6 (Moonshot) is the designated judge model. This decision was made before any formal dataset access.

## Judge Configuration

- Provider: Moonshot
- Model: kimi-k2.6
- Max logical calls: 500
- Max retries after initial: 2
- Score-based retry: forbidden
- Max output tokens: 10
- Temperature control: provider_default_non_configurable
- Temperature parameter sent: false

## Judge Input Fields

Only the following fields are sent to the judge:
- question_id
- question_type
- question
- reference_answer
- hypothesis
- abstained (abstention flag)

## Judge Output

Fixed binary output:
- {"label":"yes"}
- {"label":"no"}

No other fields are permitted.

## Sanitized Logging

Git-tracked sanitized logs contain only:
- question_id
- label
- attempts
- usage
- latency_ms
- error_type

Prohibited in Git:
- question text
- gold
- reference_answer
- full hypothesis

Full logs are stored locally outside the repository.

## Metrics

Metric name: Kimi-K2.6-judged LongMemEval-S QA accuracy

- official_gpt4o_scoring_performed = false
- leaderboard_comparable = false

This score must NOT be called:
- official LongMemEval score
- official GPT-4o score
- leaderboard-comparable score

## Task Type Semantics

The judge rubric implements official LongMemEval task type semantics from commit 9e0b455f4ef0e2ab8f2e582289761153549043fc:
- single-session-user
- single-session-assistant
- single-session-preference
- multi-session
- temporal-reasoning (off-by-one allowed)
- knowledge-update
- abstention
- no-answer
- conflict-update
- same-name-entity
- multiple-timestamps
- long-session-chunking

## File Hashes

- Judge prompt SHA-256: 6d4cfa724d722553ea79511769fd842afdadfa4cc412de4852dd43ade17448af
- Judge schema SHA-256: e5bab488fa6872c2d4383da61a97509f8fca4d3d16985b96af939508fcd2429f
- Scorer module SHA-256: d137a0c2a4bc2f062041b6484964eb46fccd73422b0b896e282301f9b86fe938

## Pre-Access Guarantees

- created_before_dataset_access = true
- created_before_gold_access = true
- created_before_formal_run = true
