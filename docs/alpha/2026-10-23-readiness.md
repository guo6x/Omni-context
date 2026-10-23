# Alpha 产品审查与交付记录（2026-10-23）

这是实现与证据参考，不是用户满意度报告。提交范围不含论文、匿名投稿资料、研究数据或冻结实验材料。

## 基线和证据边界

- 审查开始及提交前须重新核对 GitHub `main`；本轮起点是 PR #21 合并提交 `dba237d2eaf7fe0eba77801747cbe00f0f4294f3`。
- 用户本轮明确确认桌面安装版已完成验证，作为用户功能验收陈述保留；它不自动覆盖本轮新增原生隐私门禁。
- 既有 Rust 244 PASS/9 ignored、184 项产品回归、两轮 19 项浏览器验收为原基线证据，不重复执行或改写为新版本验收。
- GitHub Actions 不运行，不能标为 PASS；无付费 API、客户端替换、桌面接管、外部试用邀请或公开发布。MSI 不在本轮要求内，安装器口径为 NSIS。

## 实际能力表

| 用户能力 | 当前实现及真实边界 | 本轮判断 |
| --- | --- | --- |
| 首次使用、资料导入 | `OnboardingWizard` 已有模型选择、导入回执、原任务恢复、进入 Ask；`import-submission` / `import-job-recovery` 已处理不确定写入与重复上传 | 复用 PR #21，不重建引导/导入系统 |
| Ask 与连续追问 | `GraphViewer` 调用真实 `graph_answer`，带回多轮消息；Brain 按检索来源编号映射实体 ID | 已存在，不把新 UI 当成新推理能力 |
| 来源核对与不确定性 | 按 ID 读取实体详情；Ask 展示 Brain grounding 状态与估计置信度；缺少证据时提示澄清 | 来源条目不等于原文/事实证明；置信度不是事实核验 |
| 本机讨论历史 | `/api/discussions` 和 SQLite `discussions` 已持久化完整 turns；不自动进入召回库 | 保存原来是静默 best-effort，续用入口不显眼；本轮补可信回执与恢复 |
| 个人决定、结果、谱系 | `save_decision` 保存用户确认的决定；Decision Log 现在可查看并记录后续结果。结果带 `outcome_authority: journal`、`verified: false`，不会自动改变原则；用户选择谱系，相似项仅为待确认候选 | 决定与结果日志不授予 Agent 执行权限，也不构成独立核验 |
| MCP 跨客户端记忆 | HTTP/stdio 共用 dispatcher，记忆与决定可检索；scope 和 Agent Pilot allowlist 分离；server instructions/tool descriptions 指导客户端仅在用户明确要求时调用 `save_conclusion`，写入内容标记为 AI 推导、未经用户确认 | 指引不是服务端可验证的用户同意凭据；客户端可调用其获准工具。不是服务端共享聊天会话；第三方客户端配置不等于已连接 |
| 浏览器捕获 | manifest 限定受支持 AI 域，`privacy.js` 默认关闭自动抓取，预览/暂停/域规则/脱敏；后台先过策略 | 原能力保留；本轮不重复浏览器扩展全套验收 |
| 托盘、HUD、原生捕获 | 托盘/HUD/热键已有；原硬件 UDP 路径认证后直达截屏/剪贴板，绕过 renderer 的暂停判断 | 审查发现真实 P1；本轮在原生动作和旧命令入口共用隐私门禁 |
| CP6/7/8 | 服务端可信证据、授权、执行回执/结果绑定；默认空生产 provider registry 会 fail closed | 高级功能保留，不宣传为普通用户已可自动执行 |

## 本轮最小产品切片

1. Ask 讨论在首写前生成稳定 ID；回执只对匹配 ID、最新 revision 生效。串行保存失败不毒化后续保存，显式重试不重跑 AI/决定。未复制个人讨论到新的浏览器存储。
2. 显示保存中/已保存/未确认，离开未保存讨论前有明确确认；历史加载失败与空历史分开，保留当前讨论并支持重试。
3. 保存个人决定前确认/编辑措辞，保留原 AI 分析；记录真实 `savedDecisionId`，重开后恢复显式决策关联。旧布尔标记仍能读取，但不会伪造历史 ID。
4. 决定写入回执丢失时保存“结果待核对”状态，禁止该轮盲目重发，提供打开决策日志的恢复入口。决定保存与结果日志均支持稳定幂等键和原子写入，用户可以安全重试同一请求。
5. 原生捕获默认拒绝未知策略，检查暂停与敏感前台；renderer 从同一持久设置串行同步，失败可见且可重试，不弹窗、不发系统通知、不用会被后台节流的短租约心跳。
6. Ask 拒绝调用方 `system/developer/tool/任意 role`，在检索/模型调用前验证。合法 user/assistant 和 query fallback 保留，安全权限不放宽。
7. MCP `save_conclusion` 描述不再鼓励主动沉淀；instructions/tool description 要求客户端只响应用户明确的保存请求，新增实体标记 `authority: ai_derived`、`user_confirmed: false`。此约定不是服务端可验证的用户授权或事实核验；MCP 写入工具应在客户端保留批准门槛。
8. MCP 状态改为“已配置”，引导明确模型的数据流向、默认暂停捕获及跨客户端连续性的真实边界。
9. 本地构建发现 Next.js 16.4.0 安全公告，升级同系列修复版 16.4.2，并更新 `baseline-browser-mapping`。官方 bulk advisory 对这两个新版本返回空告警；不冒称全仓依赖审计清零。
10. Ask 的 `graph_answer` 请求增加 30 秒有界 deadline，并接入父级取消信号；关闭讨论、发起新问题或超时后不会永久停留在 loading，超时状态明确提示用户重试。

## 定向验收

验收只覆盖新切片/发现的问题，不把浏览器、模拟原生 IPC 或受控模型当成新安装版/真人使用。

- `alpha-product-evidence-20261023-run23/alpha-runtime-results.json`：`CONTROLLED_RUNTIME_PASS`，最新 `desktop-daemon/out` bundle SHA-256 为 `1f3f1464ea26fe8ad2036c410926bf2130a04e8447756f3e0c825d00241642dd`；18/18 项通过。该轮使用真实 loopback Brain HTTP/SQLite、确定性本地模型和显式 Tauri IPC 夹具，未产生外部请求或页面错误；Brain 冷启动最多 3 次有界尝试后就绪。runner SHA-256 为 `98486b8d849f39770e2236e0954ece6e23fbf53b62d9c816c17117e58f994794`，证据同时绑定当前 HEAD、分支和 dirty diff SHA。
- run23 覆盖：首次价值/隐私说明、合成资料导入且不自动推断、历史回执丢失后的同 ID 重试、来源实体核对、用户编辑并保存决定、Brain 重启和新 renderer 恢复、MCP HTTP 读取、历史加载失败与显式重试、决定回执丢失后的不确定状态、同 payload/key 显式重试、防重复决定、关闭重开、390px 窄屏和 390×480 短窗口。
- `alpha-product-evidence-20261023-run18-ui/ui-visual-results.json`：历史 bundle 的静态视觉 smoke 通过（startup splash 隐藏、宽屏/390px/短窗口、无横向溢出），但不包含运行时 Brain/SQLite 旅程；当前候选以 run31-ui 为准。
- run17 是旧 bundle 的历史受控 18/18 PASS，不能迁移为最新候选版本证据。run19/run20 是旧 runner 在 Brain 冷启动阶段的失败；run21/run22 已定位为验收脚本过早匹配旧决定回执的时序误报，未作为产品失败计数。run23 修正等待条件后重新通过。
- 原有 Rust 244 PASS/0 FAIL/9 ignored、184 项产品回归和两轮 19 项浏览器验收继续作为既有基线；本轮只重跑受影响路径。

### 最新候选（run31）

- `alpha-product-evidence-20261023-run31/alpha-runtime-results.json`：当前工作树最新 bundle 的受控核心旅程 `CONTROLLED_RUNTIME_PASS`，18/18 项通过。证据绑定 `git_head=dba237d2eaf7fe0eba77801747cbe00f0f4294f3`、dirty diff SHA `844a7317e05f0e50b46825fd77e444e1d2459a56dd9be1b32227afe211820667`、runner SHA `f2ad0d02481de0b3beb38065dac1920d956d909a779c83d02bb52f293b4fdc36`、bundle SHA `8f1702f5ed60c6f785a4608306ed8545861cb57ffd066f5437f40d3eda87e7ef`。首次使用 15 个脚本动作，第二次打开并继续任务 2 个动作，后续连续提问/决定 8 个脚本动作；无外部请求、无页面错误。
- run31 覆盖：首次价值与隐私说明、合成资料导入且不自动推断、历史回执丢失后的同 ID 重试、来源实体核对、用户编辑并保存决定、Brain 重启和新 renderer 恢复、MCP HTTP 读取、历史失败显式重试、决定回执丢失后的不确定状态、同 payload/key 显式重试、防重复决定、关闭重开、390px 窄屏和 390×480 短窗口。
- `alpha-product-evidence-20261023-run31-ui/ui-visual-results.json`：与 run31 同 bundle 的静态视觉 smoke 通过；startup splash 隐藏，390×640 与 390×480 面板不越界，无横向溢出、无外部请求。
- run25/run26：Brain 在旧 30 秒启动界限内未发布 READY；run27：Brain 已启动但旧 bundle 将请求发往默认 `127.0.0.1:3001`，受控 runner 监听 `39123`，因此出现 `ERR_CONNECTION_REFUSED`；run29：同一冷启动边界再次超时。上述均保留为验收边界，不计作当前产品旅程 PASS，也不被旧 run23 替代。随后将 runner 冷启动上限改为 90 秒并保留 stderr 尾部诊断，run30 首次恢复 18/18，run31 在恢复 39123 bundle 后再次通过。
- NSIS 本地构建与隔离资源验证：`D:\AI_code\Omni-context\alpha-product-evidence-20261023-nsis\nsis-installed-runtime.json` 记录安装器 SHA-256 `E6E032603CDD243692873CB730C19CDF567803EEEAABF8B666EF3732C0F3B9F8`，隔离安装成功，嵌入 `node.exe`/`api-server.js` 在隔离数据目录返回 `/health {ok:true, service:omni-context-brain-server, product_version:0.1.1}`，随后使用隔离卸载器清理安装路径。为遵守不抢占用户桌面的约束，未启动安装后的 Tauri UI；这不是完整安装版 UI 验收。

## 尚未验证和残余风险

- 真实提供方的回答质量、不同模型的证据忠实性、第三方客户端真实握手与接力。
- 本轮新增原生隐私设置同步在真实 NSIS Tauri UI 运行时的门禁验收；本轮只证明了 NSIS 资源可安装且内嵌 Brain 可健康启动，用户既有桌面确认不能代替这个增量。
- 已确认策略在原生进程生命周期内保留；完整 IPC 故障时新暂停设置无法保证已同步，UI 必须保留明确警告。
- `graph_answer` 不再把多轮 AI 结论静默写入长期 memory。导入抽取内容与 AI 回答仍需用户核对；来源关联不等于逐 claim 独立核验。
- 最新回执前硬退出、存储硬件故障、远程备份、长期多设备同步、签名/SmartScreen 分发信任未证明。
- 没有新增真人试用反馈，不能声称满意、留存改善或产品市场契合。

## 就绪状态与 GitHub

当前状态：`ALPHA_ENGINEERING_READY`。run31 最新候选 bundle 的受控核心旅程和同 bundle 静态视觉 smoke 已通过，NSIS 安装器及内嵌 Brain 资源也已在隔离目录验证；这不等于安装后 Tauri UI、真实模型、第三方客户端或真人试用通过，因此暂不升级为 `ALPHA_USER_TRIAL_READY` / `ALPHA_USER_VALIDATED`。

GitHub Actions 不运行，也不将远程检查伪装为 PASS；本轮提交与交付使用 `[skip ci]` 约定避免消耗 CI 预算，远程门禁状态仍单独标记为未运行。GitHub `main` 当前未启用分支保护；是否合并只取决于本地门禁、PR 审查与用户授权，不把缺失的远程 CI 当成通过。

下一阶段优先级：先完成候选 NSIS 的隔离原生隐私增量验收；再验证一个真实已授权模型与一个 MCP 客户端的连续性；最后进行少量知情真人试用，记录步骤、误解与回访结果。
