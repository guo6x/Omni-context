# Task 02: 让用户轻松把 Omni-Context 接到各种 MCP 客户端

> **⚠️ 前置依赖**：本任务依赖 [[task-08-mcp-http-proxy]] 完成。Task 08 会产出 `brain-server/dist/mcp-proxy.js`，本任务里所有 JSON 片段的 `args` 必须指向**这个代理**（不是 `mcp-server.js`）。开工前先确认 Task 08 进度文档已交。

## 背景

`brain-server` 是 MCP server。但**直接让各 AI 客户端 spawn `mcp-server.js`** 会导致 DB 隔离 / LLM 配置不共享 / 并发问题（详见 Task 08 背景）。

**正确架构**：各客户端 spawn 一个**薄代理** `mcp-proxy.js`，代理把 MCP 工具调用通过 HTTP 转发到桌面 App 已经在跑的 brain-server。客户端无感，但所有客户端共享桌面 App 的同一份 DB + LLM 配置。

每个客户端的配置文件路径、字段名、刷新方式都不一样，**让普通用户手动改 JSON 太残忍**。这个任务要做：

- 给桌面应用的设置面板新增"AI 助手接入 (MCP)"区块
- **Claude Desktop**：一键写 config（最完整的支持）
- **其他主流 MCP 客户端**：每个给一份"零摩擦"接入指南——展示要复制的 JSON 片段 + 配置文件路径 + 怎么重载，外加一个"打开该配置文件夹"的快捷按钮和"复制 JSON"按钮
- **不支持 MCP 的产品**（如 ChatGPT 网页、文心一言等）**不要硬塞进来**

## 必须覆盖的 MCP 客户端清单

按用户优先级，下面这些都要在设置面板里有独立卡片：

### 一键写入（自动改配置文件）

1. **Claude Desktop**（官方参考实现）
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - 字段：`mcpServers.omni-context`
   - 刷新：让用户重启 Claude Desktop

### 半自动：复制 JSON + 打开配置目录 + 教用户粘贴的步骤

每个客户端都要在卡片里显示：

- 配置文件路径（按 OS 显示，给"打开"按钮）
- 要粘贴的 JSON 片段（在 UI 上展示 + 一键复制）
- "怎么刷新"的一句话说明
- 注意事项（如果有）

需要支持的客户端：

2. **Cursor** （AI IDE）
   - 配置：项目级 `.cursor/mcp.json` 或全局 `~/.cursor/mcp.json`
   - 同样的 `mcpServers` 结构
   - 刷新：Cursor Settings → MCP → Refresh

3. **Windsurf** （Codeium 的 AI IDE）
   - 配置：`~/.codeium/windsurf/mcp_config.json`（macOS/Linux），`%USERPROFILE%\.codeium\windsurf\mcp_config.json`（Windows）
   - 同样的 `mcpServers` 结构
   - 刷新：重启 Windsurf

4. **Trae** （字节 AI IDE）
   - 配置路径需要执行 AI 现查官方文档（截止 2026-05 字段在 Trae Settings → MCP 里）
   - 如果配置文件路径不公开，就只给"打开 Trae 的 MCP 设置 + 粘贴 JSON"步骤说明

5. **Cline**（VS Code 扩展）
   - 配置：`%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`（Windows），对应路径在 macOS 是 `~/Library/Application Support/Code/...`
   - `mcpServers` 结构
   - 刷新：Cline 侧边栏 → MCP Servers → Refresh

6. **Continue.dev**（VS Code / JetBrains 扩展）
   - 配置：`~/.continue/config.json` 里加 `experimental.modelContextProtocolServers`
   - 字段名不一样（不是 `mcpServers`），注意
   - 刷新：重启 IDE

7. **Roo Code**（Cline 的 fork，VS Code 扩展）
   - 配置：`%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\cline_mcp_settings.json`
   - 同 Cline 结构

8. **Cherry Studio**
   - 配置：在 UI 里加，但底层文件大约在 `%APPDATA%\Cherry Studio\config\` 下
   - 执行 AI 实查最新路径
   - 推荐方式：UI 添加 MCP server → 粘贴命令 + args

9. **ChatBox**
   - 配置：UI 里加，路径 `%APPDATA%\xyz.chatboxapp.app\` 下
   - 同上，UI 操作为主

10. **LM Studio**
    - 截止 2026-05 LM Studio 也在加 MCP 客户端能力，按官方文档给路径
    - 执行 AI 实查最新支持情况

11. **Zed editor**
    - 配置：`~/.config/zed/settings.json` 里 `context_servers` 字段
    - macOS / Linux 为主

12. **Goose**（Block 的 CLI agent）
    - 配置：`~/.config/goose/config.yaml`
    - 字段是 YAML 不是 JSON，注意格式

### 兜底卡片

13. **其他 MCP 客户端**
    - 一张通用卡片，仅显示 stdio 启动命令和 args 片段（不绑定任何客户端的字段名）
    - 文案：「你的 AI 客户端如果支持 MCP，把下面的命令粘到它的 MCP server 配置里就行：…」

### 明确不做

- ChatGPT（OpenAI 还没接入 MCP）→ 不显示
- 文心一言、通义千问、智谱清言、豆包这类网页 AI（截止 2026-05 不支持 MCP）→ 不显示
- Gemini → 截止 2026-05 不支持 MCP → 不显示
- 如果执行 AI 调研时发现某个客户端已加入 MCP，可以追加；但**不要凭印象列**

## UI 设计要点

- 设置面板里加一个 "AI 助手接入 (MCP)" Tab 或 Section
- 顶部一段总说明（一两句话，告诉用户 MCP 是什么、能干什么）
- 下面是客户端卡片网格 / 列表，每张卡片：
  - logo + 名字
  - 状态徽章（"已接入" / "未接入"）—— 只对能检测的客户端展示（如 Claude Desktop、Cursor、Cline）
  - 主按钮：「一键接入」(Claude Desktop) / 「复制 JSON 片段」(其他)
  - 副按钮：「打开配置文件夹」(已知配置路径的客户端)
  - 展开「查看接入步骤」(每个客户端 3-5 行的步骤说明)
- 风格跟现有设置面板分区保持一致（glass-panel + cyan 强调）
- 不要做过度动画 / 粒子

## 涉及文件

- `desktop-daemon/src-tauri/src/mcp_helper.rs`（新建）
  - 路径推断：`std::env::current_exe()` → 安装目录 → 拼出 `<install>/brain-server/node.exe` 和 `<install>/brain-server/dist/mcp-proxy.js`（dev 模式 fallback 到仓库根目录）
  - 通用 JSON 文件读 / 改 / 写函数（保留用户已有的其他字段）
  - 各客户端的配置文件路径常量（按 OS）
- `desktop-daemon/src-tauri/src/commands.rs`
  - 新增 Tauri command（建议命名）：
    - `mcp_get_server_command()` → 返回 `{ command, args, env? }`
    - `mcp_get_clients_status()` → 返回每个客户端的 `{ id, name, config_path, installed, configured }`
    - `mcp_install_to(client_id: String)` → 仅对支持一键写入的客户端有效（Claude Desktop、Cursor、Cline、Roo Code、Continue）
    - `mcp_open_config_folder(client_id: String)` → 用 `tauri::api::shell::open` 打开
    - `mcp_copy_snippet(client_id: String)` → 后端生成片段返回，前端复制到剪贴板（也可以前端组装）
  - 注册到 `invoke_handler!`
- `desktop-daemon/src/components/SettingsPanel.tsx`
  - 加 "AI 助手接入 (MCP)" 区块
- `desktop-daemon/src/components/McpClientCard.tsx`（新建）
  - 单张客户端卡片组件，传入 client meta + status，按按钮调对应 command
- `desktop-daemon/src/lib/mcp-clients.ts`（新建）
  - 前端的客户端 meta 表：`{ id, name, logo, supports: 'auto' | 'manual', config_path_template, json_field, reload_hint, steps[] }`
  - 这张表跟 Rust 端的常量是镜像关系，**两边都要维护**或者考虑让 Rust 通过 command 把这张表 export 给前端（更干净，二选一）
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 新 i18n key

## 约束

- **生成的 JSON 片段格式（Claude Desktop / Cursor / Cline / Roo Code 通用）**：
  ```json
  {
    "mcpServers": {
      "omni-context": {
        "command": "C:\\Program Files\\Omni-Context\\brain-server\\node.exe",
        "args": [
          "C:\\Program Files\\Omni-Context\\brain-server\\dist\\mcp-proxy.js"
        ]
      }
    }
  }
  ```

  ⚠️ **args 指向 `mcp-proxy.js`**，不是 `mcp-server.js`。原因见 Task 08 背景：代理把所有调用走 HTTP 转发到桌面 App 的 brain-server，避免 DB 隔离 + LLM 配置不共享 + 并发问题。

  **不要塞 `env.DB_PATH` 或 `env.LLM_API_KEY`**——代理不需要这些，所有状态在桌面 App 那边。

  **Continue.dev 是不同结构**（字段名是 `experimental.modelContextProtocolServers`，不是 `mcpServers`），注意区分。

  **Goose 是 YAML**，结构不同，单独处理。

  **Zed** 用 `context_servers`（不是 `mcpServers`），单独处理。

- **每张客户端卡片在 UI 上要明显提示**："使用前请确保 Omni-Context 桌面应用正在运行"（代理依赖 localhost:3001）

- 路径不能写死，必须用 `current_exe()` 推断，安装目录可能是 Program Files / 用户目录 / 任意盘符。

- 写入用户配置文件时**保留所有其他字段**。读 → 改 → 写。

- 用户配置文件如果有 JSON 语法错误，按钮给友好报错 toast，不要崩。

- macOS / Linux 用户的路径必须用对应 OS 的，不要硬塞 `%APPDATA%`。

- **不要把 LLM API key 塞进 MCP 配置**。所有 LLM 调用都发生在桌面 App 的 brain-server 里，代理只是 stdio↔HTTP 翻译。

- Tauri allowlist：`fs.readFile`、`fs.writeFile`、`fs.exists`、`fs.createDir`、`path.all`、`shell.open` 需要打开。如果当前是 `"all": true` 就不用改。**不允许把 `shell.execute` 全开**。

- **检测"已接入"状态的逻辑**：只对能解析配置文件的客户端做（如 Claude Desktop、Cursor、Cline）。读到他们的 config 文件 + 看到 `omni-context` 这条 entry，就标"已接入"。其他靠 UI 添加的（Cherry Studio / ChatBox）不做检测。

- **brain-server 那边什么都不要动**。

## 验收标准

1. ✅ 桌面应用打开 → 设置 → 看到"AI 助手接入 (MCP)"区块
2. ✅ 区块里能看到上面列的至少 12 个客户端卡片（按一键 / 半自动分组）
3. ✅ Claude Desktop 卡片初始状态显示"未接入"，点「一键接入」→ 写入成功 toast → 状态变成"已接入"
4. ✅ 用记事本打开 `%APPDATA%\Claude\claude_desktop_config.json` 看到正确 entry，路径指向当前安装目录
5. ✅ 用户原有的 `mcpServers` 其他 entry 不会丢
6. ✅ Cursor 卡片：点「打开配置文件夹」打开 `~/.cursor/`，点「复制 JSON」剪贴板里有正确片段
7. ✅ Continue.dev 卡片：复制出来的片段是 `experimental.modelContextProtocolServers` 结构，不是 `mcpServers`
8. ✅ Zed 卡片：复制出来的片段是 `context_servers` 结构
9. ✅ Goose 卡片：复制出来是 YAML 格式
10. ✅ 用 Claude Desktop 实测：重启后能看到 omni-context MCP server 已连接，能调用工具
11. ✅ 用 Claude Desktop 调一个 `search_entities` 工具，**真的拿到桌面 App 里抓的实体数据**（验证代理生效、共享 DB）
12. ✅ 把桌面 App 关掉再让 Claude Desktop 调工具：**返回友好错误信息**（"Omni-Context 桌面应用未启动"），不是无响应或乱码
13. ✅ 用 Cursor 实测：粘贴片段后能看到 omni-context 出现在工具列表
14. ✅ "其他 MCP 客户端"兜底卡片显示纯命令 + args，不绑客户端字段名
15. ✅ macOS / Linux 上路径正确
16. ✅ `cd desktop-daemon && npm run build` 无 type 错误
17. ✅ `cd desktop-daemon/src-tauri && cargo check` 无错误

## 构建与运行

```powershell
cd D:\AI_code\Omni-context\omni-context-release\desktop-daemon
npm run tauri:dev
```

dev 模式下 `current_exe()` 拼出来不是真实安装目录，用 `cfg!(debug_assertions)` fallback 到仓库根目录的 `brain-server\dist\mcp-proxy.js`（注意：proxy 不是 server）。

## 进度文档

完成后写到 `docs/progress/2026-05-25-task-02-easy-mcp-connect.md`，包含：

1. **任务目标**
2. **改动文件清单**
3. **实际覆盖的客户端清单**（哪些做了一键、哪些做了半自动、哪些没找到资料跳过 → 解释）
4. **关键取舍**（特别是：Rust 端 path 推断、JSON 合并策略、Tauri allowlist 改了哪些、客户端 meta 表放前端还是后端）
5. **自测结果**（上面 15 条验收的实测情况）
6. **遗留问题**（哪些客户端的"配置路径"靠官方文档查不到，留作 TODO）

## 不要做的事

- 不要把 MCP server 改成 stdio 之外的协议
- 不要在 brain-server 那边为 MCP 加任何鉴权 / token
- 不要为了"自动检测用户装了哪些 AI 产品"做注册表 / Spotlight 之类的扫描——按"是否能写入预设路径"判断就够
- 不要硬塞 ChatGPT、Gemini、文心一言等不支持 MCP 的产品
- 不要重写 SettingsPanel 整个组件
