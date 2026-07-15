# Candidate v3 failure root cause

Candidate v3 completed Targeted-7 at `0.5026785714`, while 30 expected key values were present at Candidate Pool `27/30`, Product Final-20 `11/30`, and Answer Top-10 `3/30`. The bounded v3.1 patch therefore targets loss after candidate generation: duplicate source-channel contribution, source-event representation competition, structure-poor reranker summaries, and single-rank truncation.

The v3.1 formal Targeted-7 run did not reach this pipeline. All seven scenarios failed embedding preflight because the supplied local-model root already contained the model ID, which produced a duplicated runtime path. This is recorded as an evaluation-infrastructure P0, not as retrieval, answer, Judge, or scoring evidence.
