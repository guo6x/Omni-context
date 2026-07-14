# Kimi Judge Rubric

The primary judge is fixed to `kimi-k2.6` and is independent from the DeepSeek answer model. `judge-v2-kimi.txt` defines ten positive dimensions with common 0/0.25/0.5/0.75/1 anchors plus unsupported, overreach, and redundancy rates.

The adapter requests JSON Schema first and permits an explicitly logged JSON Object fallback only after a server response proves schema-format incompatibility. Usage, cache tokens, latency, response format, errors, and fallbacks are persisted without the API key. The 40-call and three-consecutive-error limits are enforced across processes.

Real preflight status is blocked because the endpoint rejected the task-required temperature. No model substitution or silent parameter change occurred.
