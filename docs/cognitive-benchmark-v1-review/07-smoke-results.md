# Smoke Results

21 个 Smoke Scenario ID 唯一，七类各 3 个。合成校准后端完成 21/21，仅验证加载、结构化输出、评分、增量写盘、Checkpoint、Resume 和错误处理，不产生质量结论、不产生付费调用。

验收过程：第 1 次在 7 条完成后触发安全中断，Manifest 为 `partial`；Resume 后达到 21/21。独立 Retry Errors 验收先以 `max_retries=0` 注入一次错误，再执行 `retry-errors`，同一目标由 error 恢复为 completed。真实记忆写入、重嵌和检索闭环由随后 Development Full Omni 35/35 验证。

未加载官方 LoCoMo，Conversation 2–10 未访问；Formal 与 Comparison 未运行。Smoke 分数不是 Benchmark 分数。
