# 09 — 文本序列化质量审计

Embedding 模型和 Answer 模型看到的都不是数据库结构，而是序列化文本。本报告审计三处序列化。

## 1. Entity Embedding 文本（唯一被向量化的文本）

位置：`entity-resolver.ts:176`、`admin.ts:621`、`mcp.ts:977`、`mcp-server.ts:253`。

```
${entity.name}: ${entity.description || ''}
```

| 要素 | 是否包含 |
|---|---|
| Subject 名称 | ✓（就是实体名） |
| Predicate 语义 | ✗ |
| Object | ✗ |
| Literal 类型 | ✗ |
| Source span | ✗ |
| Session 时间 | ✗ |
| Valid from/until | ✗ |
| Speaker | ✗（除非 description 恰好提到） |
| Conversation 归属 | ✗ |
| Entity description | ✓ |
| Alias | ✗ |
| Historical/current 标记 | ✗ |

时间型问题（LoCoMo 37/152 可答题是 temporal）在向量空间中**完全不可区分**：查询 "When did Caroline go to the LGBTQ support group?" 的时间意图在实体文本里没有任何对应物。

## 2. Assertion 文本 —— 不存在

Assertion 从未被序列化为可嵌入文本（0/423 有向量，报告 01 §4 Q15/16）。其 `source_span`（原话引文，中位 47 字符，P95 89 字符，100% 非空）质量尚可，但只作为字段存储，从未进入向量空间。**大量 predicate 坍缩为 `relates_to`（正式 evidence 中 86.0%，见下）目前对 embedding 没影响——因为 assertion 根本不参与 embedding；但它直接伤害 Answer 层（见 §3）和未来任何基于 predicate 的检索/重排。**

正式 evidence 中 predicate 分布（199 题 5663 次 assertion 引用）：
`relates_to` 86.0%，`knows` 7.5%，`created_by` 1.7%，`uses` 1.5%，其余 <1%。

## 3. Answer 上下文序列化 —— 最严重的问题

`benchmark/src/llm-client.mjs:82-90`：Answer 模型收到的 Evidence 是 GroundingEvidence 的原样 JSON：

```json
{"id":"a522ef25-…","type":"assertion",
 "source_span":"I'm keen on counseling or working in mental health",
 "temporal_status":"current","valid_from":"2023-05-08T13:56:00.000Z",
 "subjectId":"68f99455-…","predicate":"relates_to","objectId":"90a7c4bb-…","confidence":0.9}
```

- **Subject/Object 是裸 UUID**——Answer 模型不知道这条话是谁说的、关于谁，除非 source_span 里恰好出现名字（LoCoMo 对话第一人称居多，通常不出现）。
- predicate=`relates_to` 提供零语义。
- 没有 speaker、没有 session 语境；`valid_from` 是 session 时间，算是唯一的时间线索。
- 30 条这样的 JSON 拼在一起就是全部上下文。

这直接解释了报告 03 的 F 类错误（24 题，占错误 27%）和"gold 全在上下文仍只有 0.569 正确率"：把
`{"subjectId":"<uuid>","predicate":"relates_to","source_span":"I ran it last Sunday!"}`
变成
`On 2023-05-25, Melanie said: "I ran it last Sunday!" (about: charity race)`
不需要改任何检索代码，预期对 F 类错误的修复价值高于任何 embedding 升级。

## 4. 判定：低 Recall 有多少来自输入文本贫乏？

- 检索侧：向量空间里只有"实体名: 描述"，事实粒度、时间、speaker 全部缺失 → 报告 04 显示同模型在"带时间戳的对话原文"底座上 R@10 高出正式系统最终命中 13 个百分点。**输入文本贫乏（含 assertion 不入向量）解释的召回损失 ≥ embedding 模型本身可解释的损失。**
- 生成侧：UUID+relates_to 的 JSON 是 F 类错误的直接肇因。

## 5. 建议的目标序列化（供 Candidate v2 设计参考，本轮未实施）

```
passage: [2023-05-08] Caroline: attended a seminar about transgender rights.
Source: "Just went to a seminar about trans rights - so worth it!"
Subject: Caroline | Relation: attended | Object: seminar on transgender rights
Status: current (valid from 2023-05-08)
```

- 对每条 assertion 生成上述文本并**入向量库**（valid_from + speaker 名 + source_span + 原始谓词短语）。
- Answer 上下文用同一序列化替换裸 JSON（保留 id 供引用）。
- 抽取端保留原始谓词短语（另设 `predicate_raw`），不必等 predicate 归一化问题彻底解决。
