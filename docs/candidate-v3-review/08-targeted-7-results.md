# Targeted-7 results

The first run completed 6/7 with one DeepSeek JSON-truncation error and an overall score of 0.5189814814814815. Per the task, one generic fix was applied and all seven scenarios were rerun from clean databases.

The only allowed rerun completed 7/7 with errors=0, two retained retry records, Kimi 2/2 successful logical calls, and overall score 0.5026785714285714. Cross-Agent isolation was 0, exact duplicate context items were 0, raw-event cross-scenario leakage was 0, and context length remained bounded.

The mandatory gate still failed:

- Memory Evolution did not have all required current and historical values in final context.
- Conflict Resolution did not have both the current and low-confidence historical value in final context.

Therefore the final Targeted status is `FAILED_TARGETED_GATE`, despite 7/7 completion. Development-35 was not authorized.
