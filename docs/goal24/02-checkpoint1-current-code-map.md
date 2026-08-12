# Goal24 Checkpoint 1 — Current Code Map

Date: 2026-08-12
Status: CHECKPOINT_1_COMPLETE
Base: `product/omni-v3-unified-r1` @ `d89675a2e9f60cf8b7f9221dd19ca224b9a103e9`

This checkpoint is read-only analysis of the product baseline plus Goal24 documentation. No production behavior has been changed yet.

## 1. Existing Brain Server integration points

### `brain-server/src/mcp/dispatch.ts`

Current role: a large shared business-dispatch implementation used beneath MCP protocol adapters. It already owns retrieval, evidence selection, decision-context operations, decision save/analyze/discuss operations, and many memory tools.

Important observation: the product baseline has already moved protocol logic toward a shared dispatch layer. Goal24 should continue this decoupling by moving semantic actions above transport, not by adding CLI branches inside MCP-specific handlers.

Goal24 rule:

- keep `mcp/dispatch.ts` working for backward compatibility;
- do not make it the Capability Registry;
- extract/introduce transport-independent capability contracts in a new product namespace;
- MCP should become one adapter consumer of those contracts over time.

### `brain-server/src/decision/decision-store.ts`

Current role:

- persists structured decisions;
- stores supporting/opposing evidence IDs and evidence metadata;
- stores risks, confidence, assumptions, uncertainties, expected outcomes;
- supports decision lineage (`continues`, `revises`, `supersedes`, `reverses`, `invalidates`);
- records observed outcomes as linked event entities.

Goal24 rule:

- preserve this persistence/lineage behavior;
- add execution/approval/outcome linkage adjacent to it rather than rewriting the existing decision-store semantics;
- an `ExecutionPlan` should reference a persisted decision ID.

## 2. Existing Desktop/Tauri integration points

### `desktop-daemon/src-tauri/src/mcp_helper.rs`

Current role:

- uses native filesystem/environment inspection;
- already imports `std::process::Command`;
- resolves client config locations;
- discovers bundled/local Node and MCP proxy paths;
- manages MCP client configuration.

Implication: the native shell already has the correct trust boundary for local executable discovery and process interaction. However, Goal24 must NOT expand `mcp_helper.rs` into a generic shell executor.

Planned direction:

- keep MCP installation/configuration logic in `mcp_helper.rs`;
- create a separate restricted execution module such as `execution_broker.rs`;
- enforce executable/argument/cwd/env/timeout/output policies there.

### `desktop-daemon/src-tauri/src/commands.rs`

Current role includes Tauri commands for:

- screen capture;
- clipboard;
- Brain Server lifecycle;
- global shortcuts;
- local token/pairing operations;
- MCP status/install/config actions;
- foreground-window inspection.

Planned Goal24 additions should be thin Tauri command wrappers over the broker, e.g.:

- `execution_discover_adapter`
- `execution_validate_plan`
- `execution_run_plan`
- `execution_cancel`

Do not expose `exec(command: string)` or equivalent unrestricted commands.

### `desktop-daemon/src-tauri/src/main.rs`

Current role:

- declares native modules;
- starts/stops Brain Server;
- handles hardware events;
- registers all Tauri invoke commands in one explicit `generate_handler!` list.

Goal24 integration:

- add `mod execution_broker;`;
- register only narrow broker commands;
- preserve existing Brain Server lifecycle/hardware/MCP commands.

## 3. Existing Desktop UI integration point

### `desktop-daemon/src/hooks/useDecisionContext.ts`

Current role:

- retrieves decision context;
- calls AI decision analysis/discussion through `/api/mcp/tool/...`;
- saves structured decisions;
- tracks current decision ID and lineage;
- loads decision lineage.

This is the cleanest existing UI bridge between decision state and the desktop product.

Goal24 direction:

- do not overload this hook with process execution details;
- add separate hooks such as `useCapabilities`, `useSkills`, `useApprovals`, `useExecutions`;
- only connect execution to `useDecisionContext` through stable IDs (`decision_id`, `plan_id`, `outcome_id`).

## 4. New product namespaces proposed for Checkpoint 2+

Brain Server:

- `brain-server/src/capabilities/types.ts`
- `brain-server/src/capabilities/registry.ts`
- `brain-server/src/capabilities/execution-plan.ts`
- `brain-server/src/skills/types.ts`
- `brain-server/src/skills/registry.ts`
- `brain-server/src/evidence/coverage.ts` (or a clearly named equivalent outside frozen evaluation code)
- `brain-server/src/execution/approval-policy.ts`
- `brain-server/src/execution/outcome-service.ts`

Desktop native:

- `desktop-daemon/src-tauri/src/execution_broker.rs`
- optionally `desktop-daemon/src-tauri/src/adapters/github_cli.rs` after the generic restricted broker contract is tested

Desktop UI:

- `desktop-daemon/src/hooks/useCapabilities.ts`
- `desktop-daemon/src/hooks/useSkills.ts`
- `desktop-daemon/src/hooks/useApprovals.ts`
- `desktop-daemon/src/hooks/useExecutions.ts`
- additive UI panels/components for Connections, Skills, Approvals, Activity

## 5. Critical boundaries

1. No arbitrary shell command string from model output.
2. No execution without a normalized capability and `ExecutionPlan`.
3. No destructive/gated action without approval-policy satisfaction.
4. No mandatory-evidence omission silently treated as complete evidence.
5. No removal of MCP compatibility during Goal24.
6. No edits to frozen benchmark/Gold/scorer/raw/Holdback artifacts.
7. No main-branch movement during implementation.

## 6. First implementation order

Checkpoint 2 should start with **types/contracts only**:

1. `CapabilityDefinition`
2. `EvidenceRequirement`
3. `SkillManifest`
4. `ExecutionPlan`
5. `ExecutionResult`
6. `ApprovalRequirement`

Then add contract validation/tests before any Tauri process execution code.

This ordering prevents the CLI runtime from becoming an unrestricted shell feature before policy semantics exist.
