# Remote AI controls and audit log

All brain-server calls to LLM providers, remote embedding APIs, and cloud OCR pass through one outbound policy layer.

## Disable remote AI

Set the environment variable below before starting Omni-Context:

```text
OMNI_REMOTE_AI_ENABLED=false
```

Requests to non-loopback hosts then fail with `REMOTE_AI_DISABLED`. Loopback providers such as Ollama or LM Studio on `localhost`, `127.0.0.1`, or `::1` remain available.

## Audit records

The default JSONL audit file is:

- Windows: `%LOCALAPPDATA%\omni-context\logs\ai-calls.jsonl`
- macOS/Linux: `~/.omni-context/logs/ai-calls.jsonl`

Override it with `OMNI_AI_AUDIT_PATH`. Each record contains the timestamp, product purpose, call kind, provider origin, local/remote classification, model, request character count, message count, status, duration, and a sanitized error category.

The audit layer deliberately does not record prompts, document text, API keys, Authorization headers, response bodies, full provider paths, or query strings.
