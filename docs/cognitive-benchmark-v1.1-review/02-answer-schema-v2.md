# Answer Schema v2

`answer-schema-v2` separates current, historical, supported, and uncertain facts. It adds structured transitions, used constraints, rejected facts with fixed reasons, source IDs, and source Agents.

Validation rejects unknown keys, invisible evidence IDs, invented Agents, invalid states/reasons, and a value that is both rejected and current. No Memory may use empty sources only for question-supported facts and may not invent an Agent.

Machine schema: `evidence/answer-schema-v2.json`. Prompt: `benchmark/cognitive/prompts/answer-v2.txt`.
