# Dataset Schema

每行是独立 JSON 场景：

```json
{
  "schema_version": 1,
  "scenario_id": "development-memory_evolution-001",
  "split": "development",
  "category": "memory_evolution",
  "difficulty": "easy",
  "seed": 20260714,
  "persona": "Avery",
  "official_locomo": false,
  "synthetic_curated": true,
  "events": [{
    "id": "...-e1",
    "timestamp": "2025-01-02T09:00:00Z",
    "agent": "Agent-A",
    "text": "...",
    "state_key": "stack",
    "value": "Python",
    "status": "historical",
    "confidence": 1,
    "importance": "normal",
    "source_type": "user_statement"
  }],
  "question": "...",
  "gold": { "required_facts": [], "forbidden_facts": [] }
}
```

`gold` 只进入评分器和 Judge 输入，绝不进入 Answer、No Memory、Retrieval-Only 或 Full Omni 上下文。结果行保存原始与结构化 Answer/Judge、可见上下文、Token、延迟、调用次数、分数和状态。状态词限定为 `completed`、`partial`、`blocked`、`not_implemented`；运行错误作为可重试记录保存。
