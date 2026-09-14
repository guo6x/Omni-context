# Omni-Context V1 Launch Copy

> Release-copy source of truth for the Goal29-frozen V1 launch.
> Every sentence below is written to stay inside current repo + gate evidence.

## 1. One-line positioning

**Evidence-grounded decision control for long-lived AI agents.**

## 2. Short value proposition

Long-lived agents do not only need memory. They need to know which evidence is still valid, what a decision was based on, whether an action actually changed the world, and when an old judgment should be revised.

Omni-Context keeps that judgment trail local-first and inspectable:

**Evidence → Decision → Approval → Read-back → Outcome → Revision**

## 3. Trust line

**Local-first, read-back verified, and owned by you.**

Clarification for privacy claims:

> Persistent product state is stored locally in SQLite and Omni-Context does not require a hosted Omni account/backend. If a user configures a cloud LLM provider for extraction or generation, content sent to that provider follows that provider's data path and policy.

## 4. GitHub / README hero

### Headline

> Evidence-grounded decision control for long-lived AI agents.

### Subheadline

> Keep memory as evidence, bind decisions to what justified them, and verify outcomes by reading the world back — instead of treating tool success as truth.

### Proof line

> Goal29 V1 is feature-frozen on the verified Windows baseline. A controlled real GitHub issue-close E2E demonstrated the full approval → execution → independent read-back → VERIFIED loop; that write path is internal runtime evidence, not a public automation feature.

### CTA

Primary:
> Download for Windows

Secondary:
> See how the judgment loop works

Tertiary:
> Inspect current capability status

## 5. Landing hero

### EN

**Your agent can remember. Can it prove why it acted?**

Omni-Context is a local-first judgment layer for long-lived AI agents. It qualifies evidence before decisions, preserves decision lineage, and separates process success from verified real-world outcomes.

**Qualify → Bind → Read-back → Revise**

CTA:
- Download for Windows
- Watch the 90-second demo
- View the architecture

### ZH

**AI 会记住，但它能证明自己为什么这么做吗？**

Omni-Context 是面向长期 AI Agent 的本地优先判断控制层：行动前先判断证据是否仍然有效，把决策和依据绑定在一起，并通过独立读回确认现实世界是否真的发生了预期变化。

**证据资格 → 绑定 → 读回 → 修订**

CTA：
- 下载 Windows 版
- 看 90 秒演示
- 查看架构

## 6. 90-second demo narration

> Long-lived AI agents accumulate memory, but memory alone is not evidence.
>
> Omni-Context keeps project knowledge, sources, time, and relationships in a local evidence substrate. When a decision is made, the supporting evidence and constraints stay attached to that judgment instead of disappearing into a chat transcript.
>
> When conditions change, the earlier decision remains in the lineage rather than being silently overwritten.
>
> And when an approved action touches the outside world, Omni-Context does not treat a successful process as proof of success. In our controlled runtime proof, the command exited successfully, but the outcome stayed pending until an independent read-back observed the real GitHub issue closed. Only then was the outcome marked verified.
>
> That is the core idea: evidence-grounded decision control for long-lived AI agents.
>
> Local-first, read-back verified, and owned by you.

For the GitHub proof segment, keep a permanent overlay:

> INTERNAL CONTROLLED RUNTIME PROOF — NOT A PUBLIC GITHUB AUTOMATION FEATURE

## 7. GitHub release description

### Title

**Omni-Context V1 — Evidence-grounded decision control for long-lived AI agents**

### Opening

This release freezes the first product baseline around a simple principle:

> An agent should not only remember what happened. It should preserve what evidence justified a decision and verify whether execution actually changed the world as intended.

The Windows V1 baseline includes local persistent memory, knowledge graph and hybrid retrieval, temporal/provenance-aware context, saved decisions and lineage, outcome records, MCP access, and the Desktop application.

Goal29 verified the Windows controlled baseline, including clean installation, onboarding, import, search, QA, decision lineage, restart persistence, export and restore.

A separate controlled internal runtime proof also completed one real approval-gated GitHub issue-close loop with independent read-back. This demonstrates the architecture's execution-verification semantics; it is **not** a claim that public GitHub automation is shipped in this release.

### Known boundaries

- Windows is the verified Goal29 runtime baseline.
- Linux/macOS were not runtime-verified in the Goal29 workstation scope.
- `omctx` is not a public npm install unless separately released.
- user-facing `reopen` UX remains FUTURE.
- external memory adapters and multi-runtime adapters remain FUTURE.
- no generic shell agent, automatic rollback, or LLM judge is claimed.

## 8. Short launch post

### EN

I built Omni-Context because long-lived AI agents have a problem that “more memory” does not solve:

**a remembered fact is not automatically valid evidence, and a successful tool call is not proof that reality changed.**

Omni-Context keeps evidence, decisions, approval boundaries, outcomes, and revision history connected in one local-first judgment layer.

The V1 Windows baseline is now feature-frozen.

The part I care about most is the read-back rule:

`process exit 0 ≠ verified outcome`

In a controlled real GitHub E2E, the action completed successfully, but Omni-Context kept the outcome PENDING until an independent read-back observed the issue actually CLOSED. Only then did the deterministic evaluator mark it VERIFIED.

**Evidence-grounded decision control for long-lived AI agents.**

### ZH

我做 Omni-Context，最后发现长期 AI Agent 真正缺的并不只是“更多记忆”。

**记住过的信息，不等于现在仍然有效的证据；工具返回成功，也不等于现实世界真的按预期改变。**

所以 Omni-Context 把证据、决策、批准边界、结果和修订历史放进同一条本地优先的判断链里。

现在 V1 的 Windows 基线已经进入功能冻结。

我最看重的一条规则是：

`进程 exit 0 ≠ 结果已验证`

在一次真实 GitHub 的受控 E2E 中，执行成功以后结果仍保持 PENDING；直到独立读回确认 issue 确实已经 CLOSED，系统才把结果标成 VERIFIED。

这就是现在 Omni-Context 的定位：

**面向长期 AI Agent 的证据驱动判断控制层。**

## 9. Copy that must not reappear

Do not use:

- "Long-term memory for any AI"
- "one memory shared across every AI"
- "works with every runtime"
- "all data never leaves your machine"
- "public GitHub automation"
- "automatic rollback"
- "reopen is shipped"
- "provider-independent"
- "deployment ready"
