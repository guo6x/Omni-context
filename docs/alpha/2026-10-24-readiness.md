# Omni-Context Alpha 最终试用准入记录（2026-10-24）

## 结论

**当前为 `TRIAL_BLOCKED`，不得邀请外部用户或分发安装包。** 本轮完成原生隐私门禁的源码修复与定向自动化验收，但没有可用的隔离 Windows GUI 环境，无法在真实 NSIS 安装后的 Tauri UI 中完成 P0 验收。模拟 IPC、Rust 单测、浏览器预览和内嵌 Brain `/health` 均不替代该门禁。

## 基线与交付边界

- 仓库：`https://github.com/guo6x/Omni-context`
- 本轮重新获取的 `origin/main`：`17449aaaee389224439e32ff370f913fbd078a74`
- 隔离 worktree：`D:\AI_code\Omni-context\alpha-trial-20261024`
- 分支：`feature/alpha-trial-20261024`，起点与 `origin/main` 相同；没有新 commit，改动仍为本地未提交状态。
- PR：未创建或推送；未合并。本地 P0 尚未通过，且推送可能触发被明确禁止的 GitHub Actions。
- GitHub Actions/CI：未触发。预算不足且本轮明确禁止触发；不能标记为 PASS。
- 未运行付费模型/API、未安装/启动候选 UI、未修改当前客户端、未公开发布、未邀请外部试用者。
- 未修改论文、匿名投稿资料或历史研究证据。

## 本轮修复

1. 原生策略撤销现在先原子地提升 generation 并关闭新操作准入，再等待在途 gate 排空。捕获与上传均持有租约；若撤销先赢，捕获结果或成功回执不能提交。托盘暂停事件只有在撤销完成后才通知 renderer，未确认状态不显示为已暂停。
2. `capture_screen`、`capture_all_screens`、`capture_screen_region`、两种剪贴板读取、硬件沉淀读取以及每次 Brain 上传均经过原生策略/授权检查；未知策略、暂停状态、敏感前台、无法核验的前台和过期 generation 均拒绝。
3. Native IPC 设置同步有超时、generation 绑定和过期回执拒绝。隐私设置保存前先撤销原生授权；写入/回读失败不重新发布旧的宽松策略。原生撤权无法确认时 UI 显示“状态未知”并锁定策略控件，而不是暗示暂停已成功。
4. 设置进行同步时，中英 UI 与一页试用流程明确说明状态尚未确认，已开始的操作可能仍在收尾；确认暂停后才会阻止新的捕获准入。
5. 敏感应用规则的真实范围已写清：只按前台应用名/窗口标题做不区分大小写的子串匹配；它不会遮挡全屏截图里的后台窗口/通知，也不能判断剪贴板文本来源。
6. 本轮已确认的 Brain 日志点不再记录导入标题、洞见标题、失败对话标题/错误明文或完整时间查询；这不是对所有日志内容的脱敏保证，旧日志也可能含历史明文，分享前必须审阅。卸载、数据位置、API key 存储边界、模型数据流和恢复方式在试用材料中如实说明。
7. 移除了 Tauri 对剪贴板的宽泛 capability 声明；原生剪贴板调用仍经过上述捕获授权门禁。

## 本轮新增验证

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| Rust `capture_policy` 定向测试 | PASS，17/17 | 覆盖启动默认拒绝、暂停/敏感前台/未知窗口拒绝、策略更新、前台变化、托盘撤权与捕获/上传准入及提交屏障。 |
| Rust `hardware_actions` 定向测试 | PASS，2/2 | 合成 loopback 服务验证本地 Brain 上传/轮询的 Bearer 授权链；另验证该模块没有数据删除副作用。未接触外网或真实资料。 |
| Brain 隐私/设置定向测试 | PASS，26/26 | 同步 10、设置持久化 11、状态呈现 4、时间查询日志隐私 1。 |
| Brain TypeScript 检查 | PASS | `npm run typecheck`。 |
| Desktop TypeScript 检查 | PASS | `npx tsc --noEmit`。 |
| Rust 格式检查 | PASS | `cargo fmt --check --manifest-path src-tauri/Cargo.toml`。 |
| 受控文件 | PASS | 为本轮有意修改的 `capture_policy.rs` 与 `hardware_actions.rs` 更新快照后，`npm run verify:controlled` 通过。 |
| Diff 与敏感资料 | PASS | `git diff --check` 通过；跟踪文件扫描通过；独立审查扫描全部未跟踪候选文件，未发现凭据、个人资料、数据库、日志、截图、临时文件或论文匿名资料。 |

没有重跑未受影响的完整 Brain/Rust/浏览器基线、184 项回归或既有受控 Alpha 旅程。它们沿用 PR #22 / 2026-10-23 的有效证据，不作为本轮安装版验收结果；底层 `ALPHA_ENGINEERING_READY` 的既有结论仍保留，但不覆盖本轮试用准入阻断。

## 安装器与真实 GUI

- 应用版本仍为 `0.1.1`。本轮没有生成可批准的、与精确已提交源代码 commit 绑定的候选包。
- 工作目录里可见的 `Omni-Context_0.1.1_x64-setup.exe` SHA-256：`0665A61F74239BF809CF680F5E31B30D0694EC1B15B6B5960C6F972B63B1E6F2`，Authenticode：`NotSigned`。它是源码仍在变化时生成的本地构建，不绑定本轮最终工作树，不是交付候选；不要运行、转发或重新命名为 Alpha 新版。
- 没有真实安装、首次启动、正常退出、卸载、安装路径/数据保留验证，也没有安装后 UI 截图或日志。本轮没有通过 MSI、NSIS、浏览器模拟或旧版截图冒充验收。
- 当前环境没有可用的 Hyper-V 管理命令，也没有可用的 WSL 发行版输出；Windows Sandbox 状态查询要求提升权限，本轮不提权或启用系统功能。不能安全启动当前用户桌面应用来代替隔离 GUI。
- 未签名安装器可能触发未知发布者/SmartScreen 警告；不得关闭 Defender、SmartScreen 或实时防护。SHA-256 只能核对文件完整性，不能证明发布者身份或 Windows 信任。

## 试用材料

- [一页试用流程](ONE-PAGE-TRIAL.md)：安装条件、导入、提问、来源核对、决定保存、退出重开及停止试用。
- [Windows 安装与隐私说明](INSTALL-WINDOWS.md)：候选包核验规则、数据/配置/日志范围、云端模型费用边界、备份、卸载和日志脱敏。
- [试用反馈表](TRIAL-FEEDBACK.md)：首次理解、困惑步骤、导入/Ask、回答帮助、第二次连续性和继续使用顾虑；允许完全不提供个人资料。
- [问题反馈模板](ISSUE-TEMPLATE.md)：版本/环境、步骤、预期与实际、严重程度，以及经同意提供的脱敏材料。
- 尚未配置私下反馈邮箱、工单或上传入口。当前表单只能本地填写；不要把敏感资料提交到公开 GitHub issue。正式邀请前必须由发布负责人提供经过确认的安全反馈渠道。

## 剩余风险与门禁

**P0 阻断：**缺少真实 NSIS 安装后 Tauri UI 的原生隐私门禁验收。自动测试不能证明 Windows 前台窗口识别、真实 Tauri IPC、首启设置恢复、多次快速切换及真实退出/重开交互符合预期，因此 P0 仍为 BLOCKED。

其他已知边界：

- 某项捕获/上传已经获得租约并把请求交给本地 Brain 后，其外部副作用无法撤回；暂停操作先关闭新准入，等待在途 gate 排空后才确认。用户应等待确认，不应把切换中的状态当作已暂停。
- Native IPC 故障时，UI 明确显示状态未知并要求停止捕获/退出；仍需真实 Tauri UI 验证该错误呈现和恢复路径。
- 设置中的服务商 API key 当前保存在 WebView 用户设置存储中，本轮没有证明它受 Windows 凭据库加密。
- 该构建无代码签名；反馈渠道尚未建立；没有真实安装/卸载和外部用户试用证据。
- GitHub CI 未运行；真实模型回答质量、第三方 MCP 客户端接力和真人产品价值均未在本轮验证。

## 最终判定

`ALPHA_USER_TRIAL_READY`：**NO**。`ALPHA_USER_VALIDATED`：**NO**。当前试用准入状态：**`TRIAL_BLOCKED`**。不要分发当前本地安装器。待有安全隔离的 Windows GUI 环境后，使用与精确源 commit 绑定的 NSIS 包完成安装版 P0；再完成安装/退出/卸载与数据保留检查、签名与 SHA 发布记录及私下反馈渠道，方可重新评估 GO。

## 2026-10-25 补充验收记录

原生策略残余审查发现：暂停/收紧隐私设置时，如果 Native 撤权成功但 WebView `localStorage.setItem` 失败，旧的 `capturePaused=false` 仍留在偏好中；原先的内存撤权在重启后可能被启动同步覆盖。界面也曾把该旧偏好显示为 `active`。这两项属于同一 P1 隐私状态缺陷，本轮已完成最小修复：

- Native 撤权可在 `%LOCALAPPDATA%\omni-context\data\capture-policy-revoked` 写入无个人内容的持久闭锁；隐私设置写入失败、策略同步失败或未确认的托盘撤权后，启动时仅凭旧偏好不能恢复捕获授权。
- 只有明确的隐私设置保存/用户重试才能重新确认策略。失败保存的恢复按钮先保存“保持暂停”；确认后用户再通过独立操作选择是否恢复捕获。若无法确认撤权或持久闭锁写入失败，界面显示未知状态并提供退出入口。
- 设置页将此情况显示为“捕获已撤销”，禁用 stale toggle/blocklist，不输出 `aria-pressed` 的旧 active 值；旧授权不会被通用重试隐式恢复。
- 托盘撤权只有在持久闭锁成功后才通知 renderer；闭锁失败会发布显式安全错误事件。
- `desktop-daemon/package.json` 的构建命令现在显式限制为 NSIS (`--bundles nsis`)；没有实际运行 bundle build，也没有生成新候选。

针对性验证：Rust `capture_policy` 18/18 PASS（新增临时文件重启用例）；Brain 隐私同步/设置持久化/状态呈现 28/28 PASS；Desktop `npx tsc --noEmit` PASS；Rust `cargo fmt --check` PASS；受控文件快照更新后 `verify:controlled` PASS；tracked-tree 和 8 个新增未跟踪文件 secret scan PASS；`git diff --check` PASS。没有重跑未受影响的全量基线。GitHub CI 仍未运行，也没有真实安装、真实 Tauri UI、截图、安装/卸载或外部试用证据。

当前重新 fetch 后 `HEAD` 与 `origin/main` 均为 `17449aaaee389224439e32ff370f913fbd078a74`。本地修复仍未提交，未推送/创建 PR/合并；这既避免把未验收修复标成发布，也避免本轮触发 GitHub Actions。此前记录的未签名 0.1.1 安装器 SHA 是历史构建证据；截至本补充记录，工作区和仓库根目录的预期文件位置均没有该安装器，且它不绑定当前源代码，不能交付。

最终状态仍为 **`TRIAL_BLOCKED`**。下一道硬门禁仍是使用隔离环境，对与精确干净 commit 绑定的 NSIS 候选实际安装并运行 Tauri UI，完成原生隐私同步/重启交互并保存真实截图与日志；之后还需安装、退出、卸载/数据保留核验、候选 SHA/来源记录和私下反馈渠道。自动化闭锁回归不代表 Windows GUI P0 已通过。
