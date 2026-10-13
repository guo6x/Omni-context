# 通过 MCP 接入 Omni-Context

Omni-Context 的 Brain Server 提供 MCP 接口，让支持相应 MCP 传输方式的客户端读取和写入当前的长期记忆 / 证据上下文，并调用决策相关工具。

> **定位边界**：MCP 是 Omni-Context 的一个接口面，不是产品本身。当前产品定位是 **Evidence-grounded decision control for long-lived AI agents**。本文只说明已经存在的 MCP 接入路径，不代表 Omni-Context 已与“任意 AI / 任意 runtime”完成兼容性验证。

当前有两种接入方式：

1. **stdio proxy（安装版推荐）**：客户端启动 `mcp-proxy.js`；proxy 读取本机 token，并把 MCP 调用转发到正在运行的 Desktop / Brain Server（`127.0.0.1:3001`）。proxy **不直接打开 SQLite**。
2. **loopback MCP HTTP**：支持 HTTP MCP 传输的客户端可直接连接 `POST http://127.0.0.1:3001/mcp`，使用同一个本地 Bearer token。Desktop / Brain Server 必须正在运行。

当前权威 MCP 工具数为 **26**，以仓库根目录 [`mcp_tool_manifest.json`](../mcp_tool_manifest.json) 为准。

---

## 一、先确认你要用哪条接入路径

### A. 已安装 Windows Desktop：优先用 `mcp-proxy.js`

安装版的 stdio proxy 位于安装资源中的 Brain Server 目录，例如：

```text
<安装目录>\brain-server\dist\mcp-proxy.js
```

实际安装布局可能因安装方式变化；以已安装应用暴露的 MCP 配置 / 实际文件路径为准。

proxy 的行为是：

```text
MCP client
  ↓ stdio
mcp-proxy.js
  ↓ authenticated loopback HTTP
Brain Server :3001
  ↓
Desktop-managed local database
```

因此安装版 proxy **不需要 `DB_PATH`**，也不会另外创建一份数据库。

可以在终端做入口级检查：

```bash
node "<安装目录>\brain-server\dist\mcp-proxy.js" --help
```

正常情况下会打印 proxy 用法说明。真正连接时需要 Omni-Context Desktop / Brain Server 已启动。

### B. 支持 MCP HTTP 的客户端：直接连 `/mcp`

```text
POST http://127.0.0.1:3001/mcp
Authorization: Bearer <local token>
```

Windows Desktop 生成的 token 位于：

```text
%LOCALAPPDATA%\omni-context\local-token.txt
```

localhost 也要求 Bearer token；这用于防止本机恶意网页或无权限进程直接调用 Brain Server。

### C. 源码独立运行 `mcp-server.js`

只有你明确要启动独立的 stdio MCP server、让它自己打开 SQLite 时，才需要考虑 `DB_PATH`：

```bash
DB_PATH=<你的数据库路径> node brain-server/dist/mcp-server.js
```

代码默认值是：

```text
./data/omni-context.db
```

这条“独立 server”路径与安装版 `mcp-proxy.js → Desktop Brain` 是两种不同模式，不要混用数据库配置说明。

---

## 二、数据库与本地状态：安装版不要手动指向安装目录

当前 Desktop 会把 Brain Server 的数据库放在**用户可写的数据目录**，而不是 Program Files / 安装目录；这样可以避免安装目录只读导致 SQLite 打不开。

对 Windows 安装版用户，重要规则只有两条：

- 使用 `mcp-proxy.js` 或 `/mcp` HTTP 时，**不要手动设置 `DB_PATH`**；它们都连接正在运行的 Desktop Brain。
- 本地 API token 与 Desktop 管理的运行时状态位于 `%LOCALAPPDATA%\omni-context\...`。

`DB_PATH` 主要用于源码 / 独立 server / 测试场景。

---

## 三、Claude Desktop：stdio proxy 示例

以下是配置形态示例，实际配置路径和 MCP 配置格式以你使用的 Claude Desktop 版本为准：

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

要点：

- Windows JSON 路径使用双反斜杠 `\\`。
- 安装版使用 `mcp-proxy.js`；它读取本地 token 后转发到 Desktop Brain，不需要 `DB_PATH`。
- 连接前确保 Omni-Context Desktop / Brain Server 正在运行。
- 客户端具体菜单、配置文件位置和 MCP 支持状态可能随客户端版本变化；本文不把客户端 UI 细节当成 Omni-Context 的兼容性保证。

---

## 四、Cursor / IDE 类 stdio 客户端

对于支持 stdio MCP 且允许配置 `command + args` 的客户端，可使用同一 proxy 结构：

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

若安装包内置了 Node，优先指向安装包自己的 `node.exe`，避免依赖系统 PATH。

不同 IDE / 插件对 MCP 配置字段、自动批准、HTTP transport 的支持并不完全一致，因此按客户端实际实现调整，不要把一个客户端的配置直接视为“所有 runtime 都兼容”。

---

## 五、MCP HTTP 直连

Brain Server 提供 loopback MCP HTTP 入口：

```text
http://127.0.0.1:3001/mcp
```

它使用 JSON-RPC MCP 请求，并要求本地 Bearer token。

对支持 HTTP MCP transport 的客户端，配置逻辑是：

```text
URL = http://127.0.0.1:3001/mcp
Authorization = Bearer <local token>
```

这条路径不需要再启动 `mcp-proxy.js`，但仍然要求 Desktop / Brain Server 已运行。

客户端示例（仅作为配置形态示意，具体语法以客户端当前版本为准）：

```toml
[mcp_servers.omni-context]
url = "http://127.0.0.1:3001/mcp"
http_headers = { "Authorization" = "Bearer <你的本地 token>" }
```

---

## 六、当前 MCP 工具：权威数量 26

工具数量不要手工维护。权威来源：

```text
mcp_tool_manifest.json
```

当前 `toolCount = 26`。完整 input schema 由 `brain-server/src/mcp-tools.ts` 生成到该 manifest。

下面只列常用工具，不把这张表当成完整 26 项清单。

### 决策与检索

| 工具 | 用途 |
|---|---|
| `get_decision_context` | 取得与当前情境相关的原则、历史、冲突和图谱上下文；不替用户做最终决定 |
| `get_core_context` | 获取与当前主题相关的核心原则 |
| `unified_memory_search` | 全文 + 向量 + 图谱融合检索 |
| `vector_search` | 语义向量检索 |
| `ask_memory` | 基于已检索记忆生成回答 |
| `graph_answer` | 基于图谱证据回答并返回来源实体 |
| `search_entities` | 按名称 / 描述检索实体 |
| `get_entity` | 获取单个实体完整信息与关系 |
| `get_graph_neighborhood` | 获取实体周围 N 跳子图 |
| `list_entities` | 浏览 / 按类型列出实体 |

### 捕获与写入

| 工具 | 用途 |
|---|---|
| `record_capture` | 保存捕获快照 |
| `extract_from_capture` | 从文本 / 捕获内容抽取实体、关系和原则 |
| `add_entity` | 新增实体 |
| `add_relationship` | 新增关系 |
| `update_entity` | 修改实体 |
| `set_core_principle` | 记录或更新核心原则 |

### 决策沉淀与维护

| 工具 | 用途 |
|---|---|
| `save_conclusion` | 保存值得长期保留的结论 |
| `save_decision` | 保存决策及其上下文 |
| `analyze_decision` | 分析决策一致性 / 冲突；需要配置相应 LLM 能力时会受当前 provider 配置约束 |
| `discuss_decision` | 多角度讨论决策；同样受当前 LLM 配置约束 |
| `get_decision_lineage` | 查看决策谱系 |
| `record_decision_outcome` | 记录决策后的观察结果 |
| `merge_entities` | 合并重复实体 |
| `delete_entity` | 删除实体 |
| `get_stats` | 查看实体 / 关系统计 |
| `get_decay_report` | 查看衰减 / 清理候选 |

> 若工具表和本文文字发生冲突，以 `mcp_tool_manifest.json` 与运行中 Brain Server 的 `tools/list` 为准。

---

## 七、推荐调用方式

一个保守的使用模式：

1. 只有当历史上下文会实质影响回答时，再调用 `unified_memory_search` / `get_core_context`。
2. 用户在做重要选择、且历史原则 / 先例相关时，调用 `get_decision_context`。
3. 把检索到的记忆视为**候选证据**，结合来源、时间和当前状态判断，不把“被记住”自动当成“现在仍然有效”。
4. 只有对长期有价值的结论或明确决策才调用 `save_conclusion` / `save_decision`，避免把短期闲聊和猜测写成长记忆。

---

## 八、和 Desktop 同时运行会冲突吗

### 安装版 `mcp-proxy.js`

默认不会出现“两个进程同时打开同一 SQLite”的问题，因为 proxy **不访问数据库**：

```text
client → stdio proxy → HTTP :3001 → Desktop Brain → SQLite
```

### HTTP `/mcp`

同样直接进入正在运行的 Desktop Brain，也不会额外创建数据库连接进程。

### 独立 `mcp-server.js`

这是另一种运行模式，它会根据 `DB_PATH` 自己打开 SQLite。只有在你明确选择该模式时，才需要自己承担数据库路径、并发和生命周期管理。

---

## 九、常见故障排查

| 现象 | 排查 |
|---|---|
| 客户端看不到 `omni-context` 工具 | 先确认 Desktop / Brain 正在运行；stdio 模式再检查 proxy 路径与 Node 路径 |
| proxy 报 Brain unreachable / fetch failed | 检查 `127.0.0.1:3001` 的 Brain Server 是否启动 |
| HTTP `/mcp` 返回 401/403 | 检查 Bearer token；Windows token 文件为 `%LOCALAPPDATA%\omni-context\local-token.txt` |
| 独立 `mcp-server.js` 返回空数据 | 检查独立模式的 `DB_PATH` 是否指向了预期数据库；不要把这个问题套到安装版 proxy 上 |
| AI 猜出不存在的 memory-server 工具名 | 以运行时 `tools/list` / `mcp_tool_manifest.json` 为准，不要假定 Omni-Context 等同于其它 memory server |

---

## 十、仓库内的记忆使用 Skill

仓库包含：

```text
skills/omni-context-memory/SKILL.md
```

它用于告诉支持相应 Skill 机制的 AI 如何选择 Omni-Context 的真实工具名和调用时机。Skill 本身不能替代 MCP 连接，也不意味着所有客户端都支持同一种 Skill 安装机制。

在使用前，请同时满足：

- Omni-Context Desktop / Brain Server 已运行；
- 客户端已通过 stdio proxy 或 HTTP MCP 正确连接；
- 客户端本身支持你所使用的 Skill / instruction 机制。

---

## 证据与状态边界

- Goal29 的验证基线是 Windows；Linux/macOS 不应从本文推导为已完成同等 runtime 验证。
- MCP 当前是公开接口面，但内部受控执行 / GitHub write proof 不因此自动变成公共 MCP 自动化能力。
- `omctx` CLI 是否公开发布是另一条 release decision；本文不把它当成已公开 npm 产品。
- 用户侧 `reopen` UX 仍为 FUTURE。
