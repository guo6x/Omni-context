# 进度：检索精度修复

## 当前状态
待审查

## 已完成
- [x] 4.1 retrieveDecisionContext 核心原则限量+相关性筛选
- [x] 4.2 ask_memory prompt 分区
- [x] 4.3 graph_answer prompt 分区
- [x] 4.4 mcp-server.ts 活路径判定（结论：`mcp-server.ts` 仍是 `brain-server` 的 `main` / `start` / `dev` 入口；桌面端当前走 `mcp-proxy -> HTTP API`，但 stdio 直连路径仍可达，因此已加核心原则硬上限）
- [x] 6.1 新增单测
- [x] typecheck / test 全绿（结果贴在下面）

## 关键决策记录
- `retrieveDecisionContext` 复用现有 `rerankByLlm` 筛核心原则，并设置 `CORE_PRINCIPLE_CAP = 3`。LLM 不可用时保持现有降级行为，但从“全量核心原则”降为“最多 3 条”。
- `ask_memory` 与 `graph_answer` 不改外部返回结构，只把 prompt 中的「相关记忆」和「核心原则」分区，并明确要求无关原则忽略、不引用。
- `mcp-server.ts` 旧 stdio 路径没有共享 `rerankByLlm`，本次按任务边界只加硬上限，不做重构。

## 验证结果
- `brain-server npm run typecheck`：通过。
- `brain-server npm test -- --run tests/api.smoke.test.ts`：通过，1 个测试文件，20 个用例通过。
- `brain-server npm test`：通过，5 个测试文件，89 个用例通过。
- 人工冒烟：未在桌面端执行。原因是当前桌面端运行的是安装目录 `E:\app_update\omni-context` 下的已编译包，不是本工作区刚修改的源码构建；避免把旧包行为误记为本次修复结果。

## 待确认（留给指挥）
暂无。

## 改动文件清单
- `brain-server/src/api/handlers/mcp.ts` -> 核心原则限量相关性筛选；`ask_memory` / `graph_answer` prompt 分区。
- `brain-server/src/mcp-server.ts` -> 旧 stdio 路径核心原则硬上限。
- `brain-server/tests/api.smoke.test.ts` -> 新增 MCP 检索精度回归测试。
