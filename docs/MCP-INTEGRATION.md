# 把 Omni-Context 当作 AI 的「记忆 / 决策脑子」接入（MCP）

Brain Server 暴露了一个 **Model Context Protocol** 服务（stdio 传输）。任何兼容 MCP 的 AI 客户端
都可以接上它，从而获得一个**有长期记忆、能基于历史做决策判断的外挂大脑**——这正是 Omni-Context
的核心定位：它不只是个笔记库，而是一个可即插即用的 AI 记忆 / 决策层。

接进来之后，你的 AI 能做到：
- 在给建议前，先查用户的**核心原则**和**历史先例**（`get_decision_context` / `get_core_context`）；
- 用自然语言**语义检索**整张知识图谱（`unified_memory_search` / `vector_search`）；
- 把新发现**写回图谱**，让记忆持续生长（`extract_from_capture` / `add_entity`）。

下面给出 Claude Desktop / Cursor / Cline 三个最常见客户端的接入方式。

---

## 一、确认入口路径

MCP 入口是 `mcp-server.js`，路径取决于你怎么用 Omni-Context：

| 场景 | 路径（请改成你机器上的实际值） |
|---|---|
| 装了桌面安装包 (Windows MSI/NSIS) | `<安装目录>\brain-server\dist\mcp-proxy.js`（推荐，与桌面端共用正在运行的 Brain Server） |
| macOS .app | `/Applications/Omni-Context.app/Contents/Resources/brain-server/dist/mcp-proxy.js` |
| 直接从源码跑 | `<repo>\brain-server\dist\mcp-server.js`（独立模式，要先构建并正确设置 `DB_PATH`） |

打开终端验证入口能跑：

```bash
node "<安装目录>\brain-server\dist\mcp-proxy.js"
```

会卡住等 stdio 输入，**没有报错就说明路径对**。Ctrl+C 退出。

---

## 二、关于数据库路径（`DB_PATH`）

MCP 服务通过环境变量 **`DB_PATH`** 决定用哪个 SQLite 数据库文件：

- **不设** → MCP 服务在自己的工作目录下新建 `./data/omni-context.db`（一个空库）。
- **想和桌面应用共用同一份记忆** → 把 `DB_PATH` 指向桌面应用的数据库文件
  （桌面应用默认用其安装目录下 `brain-server/data/omni-context.db`）。
- **想完全隔离** → 给 MCP 单独指一个路径即可。

> ⚠️ 早期文档曾把这个变量写成 `OMNI_DB_PATH`，那是错的——代码读的是 `DB_PATH`。

---

## 三、Claude Desktop

配置文件位置：

- Windows：`%APPDATA%\Claude\claude_desktop_config.json`
- macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`

加一段 `mcpServers`：

```json
{
  "mcpServers": {
    "omni-context": {
      "command": "C:\\path\\to\\Omni-Context\\brain-server\\node.exe",
      "args": [
        "C:\\path\\to\\Omni-Context\\brain-server\\dist\\mcp-proxy.js"
      ]
    }
  }
}
```

注意：

- Windows 路径用双反斜杠 `\\`
- 安装版优先使用 `mcp-proxy.js`，它读取本地 token 并转发到桌面端的 3001 服务，不需要配置 `DB_PATH`
- 只有源码独立运行 `mcp-server.js` 时才需要配置 `DB_PATH`
- 重启 Claude Desktop（任务栏右键退出再启动），会话里就能用 `omni-context` 工具

---

## 四、Cursor

设置 → MCP（或编辑 `~/.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "omni-context": {
      "command": "node",
      "args": ["C:\\path\\to\\Omni-Context\\brain-server\\dist\\mcp-proxy.js"]
    }
  }
}
```

保存后在 Cursor 里 `@omni-context` 就能调用工具。

---

## 五、Cline (VS Code)

VS Code 里装 Cline 扩展，打开 Cline 面板 → 设置 → MCP Servers，添加：

```json
{
  "omni-context": {
    "command": "node",
    "args": ["C:\\path\\to\\Omni-Context\\brain-server\\dist\\mcp-proxy.js"],
    "disabled": false,
    "autoApprove": ["get_decision_context", "search_entities", "get_core_context", "get_stats"]
  }
}
```

`autoApprove` 列出的工具不需每次手动批准，读类工具放进去比较省事。

---

## 五·五、HTTP 直连（streamable HTTP，免代理、免写配置文件）

除了上面 stdio 代理那套，brain-server 现在直接暴露**标准 MCP 的 HTTP 传输端点**：

```
POST http://localhost:3001/mcp
Authorization: Bearer <你的本地 token>
```

支持 HTTP 传输的客户端（Claude Code、Codex 等）**不用启 stdio 进程、不用往各家配置文件里写路径**（也就没有 Claude Desktop MSIX 路径那类坑），连一个网址即可。token 在 `%LOCALAPPDATA%\omni-context\local-token.txt`。

> 仍需桌面应用开着（brain-server 在跑）。端点和其它接口一样要 Bearer token（localhost 也不豁免，防恶意网页扫端口）。

**Claude Code：**
```bash
claude mcp add --transport http omni-context http://localhost:3001/mcp --header "Authorization: Bearer <你的本地 token>"
```

**Codex（`~/.codex/config.toml`）：**
```toml
[mcp_servers.omni-context]
url = "http://localhost:3001/mcp"
http_headers = { "Authorization" = "Bearer <你的本地 token>" }
```

> 不支持 HTTP 传输的客户端（部分 IDE 插件、Claude Desktop 当前版本）继续用上面的 stdio 代理方式。两套并存、互补。

---

## 六、常用工具（当前共 25 个）

### 决策与检索 —— 当「脑子」用的核心

| 工具 | 用途 |
|---|---|
| **`get_decision_context`** | **头牌工具。** 给一个处境 / 待决问题，一次性返回相关原则、历史先例、历史冲突和图谱邻域。在你要给出依赖用户历史的建议前调它 |
| `unified_memory_search` | 三层融合检索（全文 + 向量 + 图谱遍历），一次自然语言查询穿透整张图谱 |
| `vector_search` | 纯语义向量检索：传一段文本，找概念相近的实体（即使用词不同） |
| `search_entities` | 按名称 / 描述关键词找实体 |
| `get_core_context` | 按当前主题取相关核心原则；不传主题时只返回精简概览 |
| `get_entity` | 按 ID 取单个实体的完整信息和全部关系 |
| `get_graph_neighborhood` | 取某实体周围 N 跳的子图，理解一个概念所处的生态 |
| `list_entities` | 列出实体（可按类型过滤），用于概览 |

### 写入 —— 让记忆持续生长

| 工具 | 用途 |
|---|---|
| `extract_from_capture` | 给一段文本，自动抽取实体 + 关系 + 原则入图谱 |
| `add_entity` | 新增一个实体 |
| `add_relationship` | 在两个已存在实体间建关系 |
| `update_entity` | 修改实体的名称 / 描述 / 标签 / 元数据 |
| `record_capture` | 存一条捕获快照（截屏 / 剪贴板 / 文本） |

### 元信息

| 工具 | 用途 |
|---|---|
| `get_stats` | 实体 / 关系数量、类型分布等统计 |
| `get_decay_report` | 哪些记忆已超过衰减阈值（候选清理） |

全部工具及完整入参 schema 见 `brain-server/src/mcp-tools.ts`。

---

## 七、推荐起手式

把 Omni-Context 当决策脑子用时，一个典型流程：

1. 对话开始 → `get_core_context`，先了解用户的原则与偏好。
2. 遇到需要判断的具体处境 → `get_decision_context`，拿到相关历史 + 冲突。
3. 基于返回的材料给建议——**判断由你做，Omni-Context 只负责把对的历史喂给你**。
4. 产生了值得记住的新结论 → `add_entity` / `extract_from_capture` 写回图谱。

---

## 八、和桌面应用同时跑会冲突吗

**默认不冲突**。桌面应用的 brain-server 走 HTTP 听 `127.0.0.1:3001`；MCP 客户端启动的是另一个
Node 进程，走 stdio 通信。两者用同一个 SQLite 文件（前提是 `DB_PATH` 指向同一个）。

SQLite 的 WAL 模式支持多进程读写，但注意：

- 同时开两个客户端做 `add_entity` 会偶发 `SQLITE_BUSY`，重试一次即可。
- 想完全隔离，给 MCP 客户端单独指一个 `DB_PATH`。

---

## 九、连不上怎么排查

| 现象 | 排查 |
|---|---|
| 客户端启动后看不到 omni-context 工具 | 检查路径是否绝对、Windows 双反斜杠、`node -v` 在 PATH 里 |
| `MCP error: command failed` | 终端手动跑 `node <path>` 看真实报错；常见是缺 native binding，重装一次依赖 |
| 工具返回但永远空 | 检查 `DB_PATH`——指向了新文件，里面就是空的 |
| 任务管理器里 node.exe 越积越多 | MCP 客户端没正确发 shutdown 信号；偶尔 kill 掉无主 node 进程即可 |
| AI 报 `Tool's name ... is not available in given tool list` | AI 套用了标准 memory server 的工具名（`read_graph` / `search_nodes`），本服务没有这些。用实际工具名（`unified_memory_search` / `search_entities` …），或安装下方的使用 Skill 让 AI 自动用对 |

> 顺带一提：MCP 客户端配置里给本服务**起名别叫 `Memory`**——AI 一看是 "Memory" 就容易默认它是标准 memory server 去猜工具名。建议命名为 `omni-context`。

---

## 十、推荐：安装记忆使用 Skill（Claude Code / Claude）

仓库里附带了一个 Agent Skill：`skills/omni-context-memory/SKILL.md`。它会告诉 AI 本服务的**正确工具名**和调用时机（对话开始先 `get_core_context` + `unified_memory_search`，结束 `save_conclusion`…），从根本上避免 AI 瞎猜 `read_graph` 这类不存在的工具。

安装（任选其一）：

- **Claude Code（项目级）**：把 `skills/omni-context-memory/` 整个目录复制到项目的 `.claude/skills/` 下。
- **Claude Code（全局）**：复制到 `~/.claude/skills/`。
- **Claude 桌面 / claude.ai**：在 Skills 设置里上传该目录（含 `SKILL.md`）。

装好后无需手动触发——当对话涉及"回忆/沉淀长期记忆"时，Claude 会按 `description` 自动加载。
