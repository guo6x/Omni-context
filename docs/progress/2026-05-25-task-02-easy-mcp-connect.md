# Task 02 进度报告: AI 助手一键/半自动 MCP 接入功能

## 1. 任务目标
本项目标是为 Omni-Context 桌面应用提供“零摩擦”的 MCP 客户端接入能力，使得各种主流大模型客户端（如 Claude Desktop、Cursor、Cline、Windsurf 等）能够一键或通过极简手动粘贴方式，将工具与上下文接入到本地的 `brain-server` (共享同一个知识图谱、缓存与大模型设置)。
为了实现该功能，前端新增了 “AI助手接入 (MCP)” 页面，并在此页提供了 12 款主流 AI 客户端的自动检测、一键写入或半自动复制步骤，以及一款通用兜底卡片。

---

## 2. 改动文件清单
- **Tauri Rust 侧**:
  - [mcp_helper.rs](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/src/mcp_helper.rs): 核心逻辑实现，包含路径推导、客户端检测、JSON 配置安全修改合并、系统配置文件夹调起，以及新增的单元/集成测试用例。
  - [commands.rs](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/src/commands.rs): 注册 Tauri 调用命令。
  - [main.rs](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src-tauri/src/main.rs): 注册 `invoke_handler` 列表。
- **React 前端侧**:
  - [SettingsPanel.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/components/SettingsPanel.tsx): 修复了 `activeTab === 'diagnostics'` 的 JSX 标签与大括号不闭合错误；挂载并适配了新 MCP 栏目。
  - [McpClientCard.tsx](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/components/McpClientCard.tsx): 修改了 `client.id === 'other'`（兜底客户端）卡片的按钮，支持复制 Node 命令和 Proxy 路径；完成卡片 UI 渲染。
  - [mcp-clients.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/lib/mcp-clients.ts): 维护前端的客户端配置 Meta 数据。
  - [zh.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/zh.ts) & [en.ts](file:///d:/AI_code/Omni-context/omni-context-release/desktop-daemon/src/locales/en.ts): 添加了相关的多语言 Key。

---

## 3. 实际覆盖的客户端清单

| 客户端 | 接入模式 | 配置文件路径 (Windows 示例) | 状态检测 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Desktop** | 一键自动写入 | `%APPDATA%\Claude\claude_desktop_config.json` | 支持 | 修改 `mcpServers.omni-context` |
| **Cursor** | 一键自动写入 | `~/.cursor/mcp.json` | 支持 | 修改 `mcpServers.omni-context` |
| **Windsurf** | 一键自动写入 | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` | 支持 | 修改 `mcpServers.omni-context` |
| **Trae** | 一键自动写入 | `~/.trae/mcp.json` | 支持 | 写入全局配置文件 |
| **LM Studio** | 一键自动写入 | `%USERPROFILE%\.lmstudio\mcp.json` | 支持 | 修改 `mcpServers.omni-context` |
| **Cline** | 一键自动写入 | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` | 支持 | 修改 `mcpServers.omni-context` |
| **Roo Code** | 一键自动写入 | `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\cline_mcp_settings.json` | 支持 | 修改 `mcpServers.omni-context` |
| **Continue.dev** | 一键自动写入 | `%USERPROFILE%\.continue\config.json` | 支持 | 修改 `experimental.modelContextProtocolServers` 结构 |
| **Zed** | 半自动 (复制 + 调起路径) | `~/.config/zed/settings.json` | 不支持 | 复制 `context_servers` 结构的 JSON |
| **Goose** | 半自动 (复制 + 调起路径) | `~/.config/goose/config.yaml` | 不支持 | 复制 YAML 格式的配置项 |
| **Cherry Studio** | 半自动 (复制命令/参数) | UI 内部存储 | 不支持 | 复制命令和参数，在 UI 手动添加 |
| **ChatBox** | 半自动 (复制命令/参数) | UI 内部存储 | 不支持 | 复制命令和参数，在 UI 手动添加 |
| **其他客户端** | 半自动 (复制命令/参数) | 视具体客户端而定 | 不支持 | 通用兜底，复制启动命令和代理路径 |

---

## 4. 关键取舍与架构决策
1. **轻量代理 (mcp-proxy.js)**: 所有生成的 JSON/YAML 片段以及一键写入的命令中，`command` 指向 `node` 可执行文件，`args` 指向 `mcp-proxy.js`。这实现了 stdio 和 HTTP 协议的桥接，避免了数据库隔离与 LLM 配置不共享的多实例冲突。
2. **路径推导机制**: 在 Rust 后端，使用 `std::env::current_exe()` 来动态获取程序当前运行目录，并在 dev 开发模式下自动通过 `cfg!(debug_assertions)` 降级并定位到 `./brain-server/dist/mcp-proxy.js` 以便无缝自测。
3. **安全写入与备份**: 一键写入文件前会自动调用 `fs::create_dir_all` 补全父级目录，解析原 JSON 并追加写入 `omni-context` 条目，保证保留用户原配置文件中的所有其他字段（如原有其他 MCP 服务等）。
4. **兜底卡片优化**: 将通用兜底卡片的复制 JSON 改为提供 “复制命令” 与 “复制参数” 的按钮组合，完全符合大多数通过 UI 进行手动添加的未知 MCP 客户端的操作流程。

---

## 5. 自测结果
在 `desktop-daemon/src-tauri` 目录下运行 `cargo test -- --nocapture`，3 个测试用例全部以 `ok` 状态通过：
- **`test_get_mcp_server_command`**: 成功，在 Windows 开发环境自动推导出了 Node executable 路径 (`node`) 以及 proxy js 的路径。
- **`test_get_mcp_clients_status`**: 成功，正确扫描了当前机器上的配置。在我的开发机上，成功探测到 `cursor`、`cline`、`trae`、`continue`、`cherrystudio`、`chatbox` 已经安装，且均报告为 `configured = false`。
- **`test_install_mcp_to_claude`**: 成功，验证了一键自动写入的机制。自动创建了 `%APPDATA%\Claude` 目录，生成了结构正确的 JSON 配置文件，验证后成功恢复/清理了测试产生的文件。

---

## 6. 遗留问题
- 某些使用 Electron IndexedDB 的客户端（如 Cherry Studio，ChatBox）未暴露明文 JSON 配置文件，因此保持通过复制命令/参数半自动接入的策略。当前自测已表明此方式是最具兼容性的方案。
