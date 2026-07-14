# Baseline Fairness

No Memory, Retrieval-Only, and Full Omni share the same Answer model, Answer prompt, temperature, token limit, retry policy, question, primary judge, and rubric. The only intended difference is memory context.

No Memory receives an empty memory array. Retrieval-Only uses a fixed lexical ranker and fixed Top-K over event text. Full Omni uses the frozen product pipeline. None of the answer modes receives Gold or the Judge rubric.

Development baseline results do not exist because Kimi preflight failed before Development. No comparative quality claim is made.
