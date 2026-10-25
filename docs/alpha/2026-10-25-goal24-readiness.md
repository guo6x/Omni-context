# Goal 24：Alpha 交付记录（2026-10-25）

## 结论

`TRIAL_BLOCKED` / **NO-GO**。修复已提交，新的可追溯 NSIS 已构建，真实 Tauri UI 和内嵌 Brain 已在当前主机隔离运行；这不是 NSIS 安装验收。没有公开发布或邀请试用者。

本记录取代 [10 月 24 日记录](2026-10-24-readiness.md) 中关于当前包、sqlite3、环境与反馈渠道的旧状态；旧日志和失败记录保留，不回写成 PASS。

## Git 与候选包

| 项目 | 本次实际结果 |
| --- | --- |
| 重新 fetch 的 `origin/main` | `17449aaaee389224439e32ff370f913fbd078a74` |
| PR | [#23](https://github.com/guo6x/Omni-context/pull/23)，保持 Draft、未合并 |
| 隐私修复 | `bd8aad06abdaa4704d4b410edc608d3d8ad1c182` |
| 日志脱敏修复 | `2d41fa237a8f1161256318855d4c99c5c7f958cc` |
| 本轮构建修复 / 候选源码 | `ab70c63789ba7463ffd643342c2c7c335c40c123` |
| 构建源码 tree | `c6699ebc0c93f9e014f528f95c6c63032ce1e05e` |
| 包名 / 版本 | `Omni-Context_0.1.1_x64-setup.exe` / `0.1.1`，Windows x64 NSIS |
| 文件大小 | `100442864` bytes |
| SHA-256 | `6F58AC8BB2B652768CD1B8D7F272593CFD5B1B00FA0E34C6C5F0964CBB20D36D` |
| Authenticode | `NotSigned`；没有发布者身份或 Windows 信任保证 |
| 原生 EXE SHA-256 | `BCF7FE42A1DD6232748E0EAD8E6FAD8AF62C84021C2C8F70C95A68F2115E9787` |
| Brain manifest SHA-256 | `7B0A8D1A2D6E5489F64A56FAE24680DEC22DCCF4AFA01D9E5F682A85C7BACDBE` |
| GitHub CI | **NOT_RUN**：预算不足且明确禁止；提交带 `[skip ci]`，不能写作 PASS |

本地候选路径：`desktop-daemon/src-tauri/target/release/bundle/nsis/Omni-Context_0.1.1_x64-setup.exe`（相对于本 worktree）。它不是历史 `F9AB6CE4…59F8D` 包的改名。

`npm run tauri:build` 从干净的上述提交执行，退出码 0。预钩子重新编译 127 份 Brain 输出，验证锁定生产依赖，并用内嵌 Node 实际加载 sqlite3；生成的 `brain-server/bundle-inputs.json` 绑定 commit/tree、Node/SQLite 与源码/输出哈希。staging 和 Release 资源中的 manifest 一致。后续提交仅更新文档；产品代码与打包输入不变，不重包。

## 本轮实际修复与定向验证

- **修复陈旧内嵌 Brain。** 旧包仍包含修改前的洞见/导入日志代码。新增打包前准备和失败闭锁，不再把旧 dist 当作新候选；准备脚本测试 **7/7 PASS**。
- **修复 sqlite3 局部环境。** Node `v22.23.2` / ABI 127，sqlite3 `5.1.7`，本 worktree 缺少 `.node`，不是已证实的 ABI 冲突。仅在本项目重建依赖；没有修改全局 Node。
- 新日志断言使用真实的 `GraphRAGExtractionError` 类型。fork 定向测试 **1 PASS、17 skipped**，证明本地失败恢复信息保留而标题/错误标记不进入日志。最初断言失败和一次 hook timeout 都保留；不是 18 项全部通过。
- **默认拒绝先于前台读取。** 未确认/暂停策略不调用前台窗口回调或内容读取；受影响的 `capture_policy` 模块 **21/21 PASS**。
- 精确 `OMNI_EVALUATION_MODE=1` 仅抑制启动抢焦点和全局热键注册，普通启动不变；新增定向测试 **3/3 PASS**（独立审查任务记录）。未削弱捕获或 CP6/7/8 授权。
- 格式、受控文件检查、差异检查及敏感资料扫描通过；独立增量复审未发现新增 P0/P1 问题。

PR #22 的 Brain/Rust/扩展基线、18/18 Alpha 旅程以及用户确认的 Desktop/MCP 历史验证继续继承；没有重跑，也没有将它们换算为本候选的安装验收。

## 真实 Windows 原生运行：方案 A

只运行上述候选对应的 EXE 与完整 Brain 资源副本，没有执行安装器或卸载器。

启动前核实无 Omni 进程、3001/3002 与调试端口空闲、Omni 开机启动登记为 0、硬件注册文件不存在。使用单个原生进程及其子进程，未创建 VM、Sandbox、Windows 用户或提权。

进程级 `LOCALAPPDATA/APPDATA/USERPROFILE/TEMP/TMP` 指向空的合成目录；WebView2 另用 `WEBVIEW2_USER_DATA_FOLDER`。KnownFolder 路径也检查了合成 profile 的常规 AppData 子目录；未配对硬件。Brain 使用空闲 3001，Native bridge/UDP 由系统分配端口，禁用远程 AI 与预热，不导入个人资料、不启用捕获。

通过现有 WebView2 CDP 连接实际 `https://tauri.localhost/` 主窗口，未启动替代浏览器、fixture 页面或桌面输入工具。只对合成应用内容截图，未读取系统屏幕或剪贴板正文。只读打开隐私页，没有操作捕获或执行授权开关。

| 验收项 | 证据及边界 |
| --- | --- |
| 真实 UI / 内嵌 Brain | 首启、重启均实际运行并健康；真实 UI 截图已保存 |
| 默认暂停与原生拒绝 | 整屏、多屏、区域、两种剪贴板、硬件沉淀命令均返回暂停拒绝 |
| 持久撤权 / 重启 | 写入闭锁后，隐式同步 active 被拒；合成 stale active 偏好在重启后不能恢复屏幕/剪贴板/硬件授权 |
| 错误状态呈现 | 真实隐私页显示“捕获已撤销”及“保存并保持暂停”；这是 stale 偏好恢复观察，不是实际存储失败注入验收 |
| 正常退出 | 第一次 `quit_app` 退出码 0，Brain/调试端口释放；第二次观察等待超时后通过 `quit_app` 清理，日志记录 Brain 已停止，事后无测试进程、端口释放 |
| 既有数据与安装 | 四个保护根的文件元数据前后相同，旧 EXE 哈希、安装登记仍与历史记录一致；未读取个人数据库/配置内容，不宣称做过内容级备份比对 |
| 云端/付费调用 | 审计 14 条均为失败的合成 localhost Ollama 健康探测；远程记录 0、成功模型调用 0；没有真实资料发送 |
| NSIS 安装 / 卸载 | **NOT_RUN**，不能用以上 EXE 运行替代 |

原始运行脚本 **不是整轮 PASS**：第一次因合成 USERPROFILE 缺少 AppData 子目录退出，修正测试目录后启动成功；第二次在完成重启拒绝和截图后，观察确认信号超过脚本 120 秒截止时间，原始状态保留 `NATIVE_CHECK_FAILED`。事后检查单独记录，不篡改失败日志。

## 证据位置

本地证据根：`D:/AI_code/Omni-context/alpha-trial-evidence-20261025-goal24`。未把运行 profile、token、数据库、安装器或日志上传至仓库。

- `goal24-evidence.json`：候选来源/哈希、16 个已完成原生检查、未验证项与文件校验值。
- `candidate-bundle-inputs-ab70c63.json`：实际内嵌 Brain 构建清单。
- `capture-policy-targeted.log`、`brain-bundle-targeted.log`、`desktop-import-log-privacy-fork.log`：定向通过日志；早期失败日志也保留。
- `native-results.json`：第一次失败；`native-attempt02/native-results.json`：第二次的逐项结果及观察超时。
- `native-attempt02/native-default.png`、`native-revoked-restart.png`、`native-revoked-privacy-ui.png`：真实原生界面；后两文件同在 `native-attempt02/`。
- `native-attempt02/native-*-stdout.log` / `stderr.log` 与合成 profile 下的 Brain 日志：启动、拒绝及退出记录。不要整目录转发，里面含测试本地连接凭据。

## 真正剩余的门禁

1. **安装/卸载冲突尚未安全解除。** 已证实旧登记来自历史测试，但当前 NSIS 会共用 HKCU 安装/卸载键、同名进程检测、快捷方式、jump list 和 app-id 清理目标；旧个人 Brain/WebView 数据更早已存在。`/D` 或 `/NS` 不能隔离这些副作用。默认安装根与 Brain 根仅大小写不同，在 Windows 上也不能视作隔离。没有可靠零覆盖/回滚授权，故不运行安装器。
2. **原生隐私 P0 尚非全覆盖。** 未实际执行设置写失败/恢复按钮、明确重新启用/快速切换、敏感/未知前台及采集竞态、IPC 传输故障/超时、托盘菜单交互。它们有相关定向自动化和源码证据，但不能冒称本候选真实交互 PASS。

最小解除路径不是新建验收环境：只有用户明确允许在维护窗口中把现有安装作为受控升级/卸载目标，并先完成原客户端导出、安装/注册与数据的可恢复保护，才可在本机继续安装验收；仍需由用户在无敏感内容的窗口中确认捕获权限相关交互。当前“不修改现有安装和个人数据”的边界不变时，以上操作不执行。无需再跑完整 Brain/Rust/MCP 或 Alpha 旅程。

非阻断风险：未签名可能触发未知发布者/SmartScreen，SHA-256 不替代发布者认证；保留 Defender/SmartScreen，阻止时停止。API key 仍存于 WebView 设置，未证明凭据库加密；前台核验与系统采集不能原子化，敏感规则不能遮挡后台窗口/通知或确认剪贴板来源。设置标题仍显示旧 `v0.1.0`，实际候选为 `0.1.1`，识别候选以完整 SHA 为准。没有真人满意度或留存证据。

## 已备好的私人试用材料

[安装与隐私说明](INSTALL-WINDOWS.md) → [一页旅程](ONE-PAGE-TRIAL.md) → [本地反馈表](TRIAL-FEEDBACK.md) / [故障模板](ISSUE-TEMPLATE.md)。反馈可由本人通过既有、双方确认的私人渠道自行发送；没有专用邮箱不是阻断。未授权上传完整聊天、数据库、密钥或未脱敏截图。

当前不退出 Draft、不合并、不分发。只有上述实际门禁通过后才可改为 `ALPHA_USER_TRIAL_READY`；本轮不使用 `ALPHA_USER_VALIDATED`。
