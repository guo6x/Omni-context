# External Review Checklist

- [ ] Formal 250 的语义/领域/语言/时间结构多样性足够。
- [ ] 每条 Gold 不依赖模型答案，允许合理同义表达。
- [ ] Easy/Medium/Hard 由客观结构因素成立。
- [ ] Comparison 70 在运行前固定且分层正确。
- [ ] No Memory 无历史；Retrieval-Only 不含 Gold 或图/演化能力。
- [ ] Full Omni 真正使用冻结版本完整链路。
- [ ] scoring v2 的否定、同义、历史/当前测试充分。
- [ ] Proactive/Decision Judge 可接受范围不窄，JSON Schema 固定。
- [ ] 同模型 Judge 的偏差被独立模型或人工样本量化。
- [ ] Agent provenance 低分的系统/数据原因已厘清。
- [ ] Forgetting 未实现项不计零、不进入综合分。
- [ ] Extraction Token 遥测或代理估算方案被接受。
- [ ] 无 API Key、无 Conversation 2–10、无冻结标签/历史改动。
- [ ] 只有审查全部签字后才授权 Formal Run。
