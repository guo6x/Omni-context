# Omni-Context 产品最终形态文档

> 这份文档是整个项目的「北极星」。所有规划、任务拆分、验收都以它为准。
> 当现实和这份文档冲突时——要么改代码对齐文档，要么改文档对齐新决定，二选一，不允许含糊。
> 最后更新：2026-05-31

---

## 0. 怎么用这份文档

- **规划锚点**：要做什么、做到什么程度，先看第 4 章的特性表。
- **状态真相**：每个特性都有状态标记，✅ 完成 / 🟡 部分 / ⬜ 未开始 / ❌ 明确不做。
- **协作约定**：见第 8 章。代码由外部 AI 写，它写完后产出一份进度文档，我读文档而不是读长总结。

---

## 1. 一句话定位

**Omni-Context 的内核是一张持续生长的知识图谱——它把你在任何设备上捕获的信息结构化成「实体 + 关系」，形成一个可被推理、可被检索、可被外部 AI 接入的「数字大脑」。**

这张图谱有两种用法，缺一不可：
- **对你**：它是你的第二大脑。主动智能引擎会挖掘其中被你遗忘的关联，帮你基于历史做判断。
- **对其他 AI**：通过标准 MCP / HTTP API 把这张图谱挂上去，任何 AI 产品都能获得一个有长期记忆、能基于历史信息做决策判断的「脑子」。换句话说——**Omni-Context 卖的不是又一个笔记软件，是一个可即插即用的 AI 记忆/决策层。**

核心价值四条：
1. **捕获无摩擦** —— 桌面快捷键 / 浏览器插件 / 手机 / 物理按钮，四个入口都能一键沉淀。
2. **记忆会生长** —— 不只是存储，存进去的东西会被抽取成实体+关系，并随时间衰减/归档，图谱本身在演化。
3. **洞见会主动来找你** —— Proactive Agent 定期扫描图谱，发现跨记忆的关联后主动推送。
4. **可被任何 AI 接入** —— 图谱通过标准 MCP 协议对外开放，是其他 AI 产品的即插即用记忆/决策层。

数据全部在本地 SQLite，无云端、无账号、无公网鉴权。这是刻意的设计，不是缺陷。

> **战略判断**：知识图谱 + 对外接口（MCP/API）是这个产品真正的护城河。捕获入口、可视化、HUD 都是「让图谱长起来」的手段。规划取舍时，凡是增强「图谱质量」和「对外可接入性」的事项，优先级天然更高。

---

## 2. 目标用户与场景

- **用户**：开发者、研究者、知识工作者——信息输入量大、且在意数据主权的人。
- **典型场景**：
  - 看技术文章/代码时按快捷键沉淀 → 自动进图谱。
  - 一周后 Proactive Agent 提示「你上周看的 A 和今天的 B 其实是同一个问题」。
  - 手机上随手记一条想法 → 回到电脑图谱里已经在了。
  - 桌上的物理按钮一按 → 触发截图沉淀。
  - 在 Cursor / Claude Desktop / Cherry Studio 里问 AI 时，AI 通过 MCP 自动调用你的图谱做依据。

---

## 3. 系统架构总览

五个组件，一个中心：

```
        [浏览器插件]   [移动端 App]   [ESP32 物理按钮]
              \             |              /
               \            |             /
              HTTP/LAN    HTTP/LAN      UDP:9090
                 \          |           /
                  v         v          v
              ┌─────────────────────────────┐
              │      Brain Server (本地)     │   ← 唯一的大脑
              │  HTTP API · MCP · SQLite     │
              │  向量检索 · 图谱 · Agent Loop │
              └─────────────────────────────┘
                          ^
                          | 内嵌启动 / HTTP
                          v
                  [桌面端 Tauri App]   ← 主控台 + 系统级捕获

                          ↑
                          | mcp-proxy.js (stdio↔HTTP)
                          |
                [Claude Desktop / Cursor / Cline / ...]
                12+ 款 MCP 客户端共享同一份图谱
```

- **Brain Server 是唯一数据权威**，其余四个都是它的「感官」或「界面」。
- 桌面端会内嵌启动 Brain Server（打包时一起带 node.exe）。
- 移动端/插件/硬件通过网络连到 Brain Server，不自带数据库。
- 外部 AI 客户端通过 `mcp-proxy.js` 走 stdio 接入，背后转发到本机 brain-server——保证所有客户端共享同一份 DB + LLM 配置。

---

## 4. 各组件最终形态与当前状态

### 4.1 Brain Server（后台大脑）

技术栈：Node.js + 自实现 HTTP 路由 + SQLite（FTS5 + sqlite-vec）

| 特性 | 最终形态 | 状态 | 备注 |
|---|---|---|---|
| HTTP API 服务 | 实体/关系/图谱/导入导出全套 REST | ✅ | `api-server.ts` |
| SQLite 存储 | 实体·关系·记忆·通知，FTS5 全文索引 | ✅ | `db/sqlite.ts` |
| 向量检索 | sqlite-vec 原生 KNN | ✅ | 未做大数据量压测 |
| 三层融合检索 | 向量+全文+图谱关联，一次查询穿透 | ✅ | 三层均已验证 |
| Embedding 服务 | 本地 Xenova transformers 生成向量 | ✅ | 模型内置仓库；降级到 hash-fallback 时通过 `/api/admin/embedding/status` 暴露状态（task 18） |
| GraphRAG 抽取 | 从文本抽实体+关系 | ✅ | 云端 DeepSeek 实测良好 |
| 截图 → OCR → 抽取 | 沉淀流程真的解析截图文字 | ✅ | task 09：extractor.combineInputs 接入 OCRPipeline + 10s 超时兜底 |
| 文件上传（含 Office/EPUB/HTML/代码） | 拖文件 → 自动解析对应格式 → 抽取 | ✅ | task-01/13：支持 30+ 扩展名，docx/xlsx/pptx/epub/html + 各种代码文件 |
| 上传异步 job + 进度 | POST 立刻返 jobId，前端轮询阶段 | ✅ | task 13：parsing/ocr/extracting/resolving/storing 五阶段，5min TTL |
| 记忆分层 + 衰减 | core / archival + decay-scheduler + 衰减洞见 | ✅ | task 14：anchor 纳入 updated_at，每 6 cycle 检查 decay_warning |
| Proactive Agent | 定期扫图谱、生成 Insights 推送 | ✅ | 桌面 App 入口也已正确传入 decayScheduler |
| MCP Server | 14 个工具（含 get_decision_context、unified_memory_search 等） | ✅ | `mcp-server.ts`（stdio + HTTP 双模） |
| MCP HTTP 代理 | mcp-proxy.js 薄壳，将各客户端 stdio 转 HTTP 到本机 brain-server | ✅ | task 08：彻底解决 DB 隔离 + LLM 配置不共享 + 并发问题 |
| 数据导入/导出 | 整库 JSON 备份/恢复（merge/replace） | ✅ | API 已有，桌面 UI 入口待补 |

### 4.2 桌面端（主控台）

技术栈：Tauri 1.x + Next.js 14（静态导出）+ Tailwind

| 特性 | 最终形态 | 状态 | 备注 |
|---|---|---|---|
| 知识图谱可视化 | 2D/3D 力导向图 + size/关系线/Legend 三件套 | ✅ | task 21：size 按 access_count 归一、principle +2；关系线按 type 区分颜色/线型（冲突红、依赖蓝、取代虚线灰）；右上 Legend 可折叠 + 点击高亮筛选 |
| 图谱 · MST 骨架视图 | 裁冗余边只留最强骨架 | ✅ | |
| 图谱 · 时间轴 | 按创建时间回放图谱演化 | ✅ | |
| 节点 编辑/删除/合并 | 详情面板内直接操作 | ✅ | |
| 全窗口拖放上传 | 主窗口任意位置接收文件/文件夹 | ✅ | task 01：Tauri file-drop + Rust 递归扫描（支持 50+ 文件确认弹窗） |
| 常驻上传入口 | header 区固定「上传文件」按钮 | ✅ | task 03 |
| 悬浮 HUD | 独立置顶 Tauri 窗口，主窗口最小化也常驻 | ✅ | task 04：从 DOM 浮层切换到独立窗口 |
| Spotlight 搜索浮层 | Ctrl+K，并发三路搜索 + 跨类别按相关性排序 + 跳图谱聚焦 | ✅ | task 05 + 15 |
| 决策助手独立页面 | Ctrl+Shift+K，5 行输入框 + 三列结果（原则/历史/冲突） | ✅ | task 22：从 SearchPalette 拆出独立全屏覆盖层 |
| 洞见通知中心 | 毛玻璃 Insights 收件箱（含 decay_warning） | ✅ | |
| 系统托盘 + 后台常驻 | 托盘图标 + 关 X 默认最小化 + 菜单（重启 BS / 打开数据目录 / 退出） | ✅ | task 06 |
| MCP 接入面板 | 12 个客户端卡片 + 一键写入（Claude Desktop/Cursor 等）+ 复制 JSON 兜底 + 能力预览（5 个使用场景） | ✅ | task 02 + 20；2026-05-29 诚实化：仅验证过的客户端归「一键（已验证）」，其余归「手动（复制参数）」，不再假装全可一键 |
| Agent Skills 支持 | `skills/omni-context-memory/SKILL.md` 教 AI 正确的 omni-context 工具名 | ✅ | 2026-05-29：避免 AI 猜标准 memory-server 工具名（read_graph 等）导致调用失败 |
| 首启 Wizard + LLM 预设 | 11 家服务商预设（OpenAI/DeepSeek/Moonshot/智谱/通义/火山/Groq/OpenRouter/Ollama 等）+ 测试连接 + LLM 未配横幅引流 | ✅ | task 07 |
| 沉淀真反馈 | HUD 等待真实 await，三分支显示（成功 N 实体 / 0 内容 / 失败原因） | ✅ | task 09 + 10：截图真 OCR + 防重 ref |
| 离线横幅文案 | 简短文案 + 折叠"详细信息"展开技术原因 | ✅ | task 17 |
| 系统自检 Tab | embedding 引擎状态（hash-fallback 时红色警告）+ LLM / OCR / BS 真实状态 | ✅ | task 18 |
| 国际化 | zh/en 全量覆盖（130+ key，UI 0 硬编码中文残留） | ✅ | task 16 |
| 空状态新手引导 | 「加载 Demo 为主 + 逐功能导览」替代平级四按钮，接入 AI 客户端入口置顶 | ✅ | 2026-05-29：EmptyState 重构，降低新手认知负担 |
| 决策复盘时间线 | 按时间线翻历史决策 + 展开看来由/证据链 + 点击跳图谱聚焦 | ✅ | 2026-05-29：DecisionTimeline，补齐 §6 旧口子 |
| 设置面板 | 快捷键/外观/行为/LLM/MCP/数据管理/启动行为/常驻 | ✅ | |
| 浅色主题 | 完整 light 主题适配 | ✅ | |
| 屏幕/剪贴板捕获 | 系统级捕获后入库 | ✅ | task 09 接通后端 OCR，捕获→图谱链路打通 |
| 开机自启 | 跟随系统启动 | ✅ | tauri-plugin-autostart |
| Tauri allowlist + Cargo features | fs.readFile / window / shell / clipboard 全部正确开启 | ✅ | 拖放、HUD、托盘都依赖 |
| Windows 打包 | msi + nsis 安装包 | ✅ | |
| macOS / Linux 打包 | 同等安装包 | ✅ | task 29 + 2026-05-29：CI matrix 全绿，实测产出 Win(msi+nsis) / macOS-arm(dmg) / Linux(deb)。Intel mac（免费 runner 长期分配不到）+ AppImage（runner webkit 过新）走源码构建 |
| 自动更新 | Tauri updater + GitHub Release | 🟡 | task 28：代码就绪，pubkey/endpoint 已填，私钥本地保存待配 GitHub Secret |
| 抓屏隐私控制 | 暂停 toggle + 敏感应用 blocklist | ✅ | task 24 |
| 日志落盘 | %LOCALAPPDATA%\omni-context\logs\ + 轮转 | ✅ | task 25 |

### 4.3 移动端 App 📦 暂搁（Experimental）

技术栈：React Native + Expo + NativeWind

| 特性 | 最终形态 | 状态 | 备注 |
|---|---|---|---|
| 只读搜索 MVP | 搜索框 + 三 API 并发 + 实体/记忆详情 | 🟡 | task 19：代码 + tsc 通过，**未真机/模拟器实测** |
| 设置页 | 配置 Brain Server 地址 + 配对码 | ✅ | task 27 加配对码输入 |
| 实体详情 + 邻居 | 调 /api/graph/context 显示关联 | 🟡 | 代码完成，未真机验证 |
| LAN 同步 + 鉴权 | 配对码 6 位 + Authorization Bearer | ✅ | task 27：127.0.0.1 免鉴权，其他来源需配对码 |
| Android 打包 | 可安装 APK | ⬜ | 只有 `android/` 工程，未出包 |
| iOS 打包 | 可安装 IPA | ⬜ | 连 `ios/` 工程都没有 |
| 截屏沉淀 / 上传 | —— | ❌ | 移动端定位为只读，写入留给桌面 |

### 4.4 浏览器插件

技术栈：原生 Manifest V3（Chrome/Edge）

| 特性 | 最终形态 | 状态 | 备注 |
|---|---|---|---|
| 一键沉淀当前页 | popup/右键发送选中内容 | ✅ | |
| 后台与 Brain Server 通信 | HTTP 调用 | ✅ | |
| 打包产物 | unpacked + zip | ✅ | |
| Firefox 适配 | MV2/兼容版本 | 🟡 | 标称兼容 109+，未实测 |
| 与 task 13 异步 job 协议同步 | 适配 `POST /api/ingest/file` 返回 jobId 的新格式 | ✅ | task 26：chrome.alarms 持久化轮询，SW unload 后恢复 |
| Safari 适配 | —— | ❌ | 明确不做 |

### 4.5 ESP32 物理硬件 📦 暂搁（Experimental）

| 特性 | 最终形态 | 状态 | 备注 |
|---|---|---|---|
| 固件源码 | 按钮触发发 UDP 命令 | 🟡 | `main.ino` 在，未编译验证 |
| 接线/BOM/装配文档 | 完整可复现 | ✅ | |
| 与桌面端联动 | UDP:9090 单向触发 | 🟡 | 桌面侧已就绪，硬件侧未实测 |
| 双向通信 | 硬件显示状态回执 | ❌ | 当前设计就是单向，不做 |

### 4.6 对外 AI 接入接口（「数字脑子」交付层）

这是产品的护城河所在——把知识图谱作为能力开放给其他 AI。

| 特性 | 最终形态 | 状态 | 备注 |
|---|---|---|---|
| MCP Server | 14 个工具（含决策上下文 / 衰减报告 / 统一记忆搜索） | ✅ | |
| MCP HTTP 代理 | mcp-proxy.js 把 stdio 转发到本机 brain-server HTTP | ✅ | task 08：客户端无感，但服务端单点。彻底解决多客户端 DB 隔离 + LLM 配置不共享 + 并发风险 |
| 多客户端一键 / 半自动接入 | Claude Desktop / Cursor / Windsurf / Cline / Continue / Roo Code / Trae / LM Studio / Cherry Studio / ChatBox / Zed / Goose + 兜底 | ✅ | task 02：12 + 1 张卡片在设置面板 |
| 决策支持能力 | `get_decision_context` 工具 + 桌面端独立 UI（Ctrl+Shift+K）+ 保存决策结果回图谱 | ✅ | task 22+33：独立助手页面 + "我已决定"按钮把决策沉淀为 decision 实体；2026-05-29：信息不足时主动反问（questions）+ agentic 自主检索本地图谱补证据；修复深度讨论 500（situation 透传）。联网搜索经评估明确不做 |
| 决策复盘视图 | 按时间线翻历史决策 + 来由/证据链 | ✅ | 2026-05-29：DecisionTimeline，兑现 §6 旧候选 |
| AI 大脑三件套 | MCP instructions 引导 + save_conclusion 工具 + 隐式 access_count | ✅ | task 23：让接入的 AI 主动调记忆、把对话结论写回图谱、被引用的记忆自动加权 |
| HTTP API 对外开放 | 非 MCP 的 AI 产品也能 HTTP 接入 | 🟡 | MCP 为对外主通道；HTTP API 维持产品内部客户端用，暂不作为第三方契约对外 |
| 接入文档 | 第三方「如何把 Omni-Context 当脑子用」指南 | ✅ | `docs/MCP-INTEGRATION.md` |
| 能力预览 UI | 5 个使用场景示例（在 Claude 里怎么说 → 触发什么工具） | ✅ | task 20 |

---

## 5. 当前总体状态快照（2026-05-31）

**本轮增量（2026-05-31）——交互大改：命令栏统一「问 / 搜 / 决策」**

把原来分散的三个入口（Ctrl+K 搜索 / 问大脑 / 决策助手三个按钮+弹层）**合并成图谱顶部一条命令栏**，回答出现在右栏（图谱概览的第三态「答案卡」），核心是让体验从"又一个聊天框"变成"看得见来龙去脉的脑子"：

- **命令栏**：亲切占位；聚焦弹下拉——空着给「来自你图谱的示例问题」，输入时给「匹配节点（点了跳转）」；Ctrl+K 聚焦。
- **答案卡（右栏第三态，复用概览容器）**：结论 + 依据（每条依据的节点是可点 chip，点了在图上聚焦）+ 多轮继续讨论；问到抉择类问题时自动转「决策态」：先给澄清问题 + ＋/－权衡 + 「我已决定·存回图谱」。
- **图谱原生回答**：新增 `graph_answer` 接口——把命中节点**之间的关系**也喂给 LLM 做推理、结构化输出（结论/依据/引用节点/子图边），答案旁的图谱**高亮命中子图、压暗其余**。这是和大厂记忆/NotebookLM 拉开差距的点（它们没有显式关系图）。
- **清理**：删除搜索/问大脑/决策助手三个旧按钮+快捷键+组件文件，命令栏一步到位。

> 提醒：以上为本会话密集开发，多为「编译通过 + 抽测几轮」，稳定性待真实 dogfood。旧组件已删，命令栏出问题没有后路——发现 bug 直接修命令栏。

---

## 5b. 历史快照（2026-05-29）

**本轮增量（2026-05-29）——产品打磨 + 可发布性**

- **新手引导重构**：空状态从「平级四按钮」改为「加载 Demo 为主 + 逐功能导览」，接入 AI 客户端入口置顶，降低"不知道主次"的认知负担（真实用户反馈驱动）。
- **决策助手补全**：信息不足主动反问 + agentic 自主检索本地图谱补证据 + 修复深度讨论 500；新增决策复盘时间线（兑现 §6 旧候选）。联网搜索评估后明确不做。
- **MCP 接入诚实化**：一键仅保留验证过的客户端，其余转手动；新增 Agent Skill 教 AI 正确工具名，避免猜标准 memory-server 工具名导致调用失败。
- **可发布性**：CI matrix 修绿，实测三平台出包（Win msi+nsis / macOS-arm dmg / Linux deb）；GitHub Pages 落地页重做为中英双语；README 中英双语；文档合并去冗余。
- **桌面端 bug**：右上角 More 菜单被图谱概览遮挡修复（header stacking context）。

> 仍在"卡口"的：Tauri 自动更新私钥待注入 GitHub Secret；移动端 / Intel mac / ESP32 待真机；以及"宣传/分发"这件没人替你写代码的事（见 §6 新增「分发与宣传」）。

---



**当前交付形态：桌面端 v1.2（"AI 大脑"产品化 + 隐私 + 自动更新就绪） + 浏览器插件（异步 job 适配） + 移动端 LAN 鉴权 + 数字脑子（MCP + 代理 + AI 主动调用三件套）对外接口。**

这一轮（task 01-34）把产品从"功能能用"逐步提升到"AI 用得起来的脑子"：

**用户体验**
- 全窗口拖放 + 文件夹递归 + Office/EPUB/HTML/代码文件
- Ctrl+K 搜索 + Ctrl+Shift+K 决策助手 + "我已决定"沉淀
- 系统托盘 + 关 X 最小化 + 抓屏暂停 / 敏感应用排除
- 首启 Wizard + 11 家 LLM 预设
- 沉淀真反馈（截图 OCR 接通 + HUD 等真实结果）+ 异步 job 取消
- 全量 i18n + 离线横幅 + Embedding 降级重载按钮
- 节点视觉三件套（size 映射 + 关系线 + Legend）+ 聚焦脉冲动画 + 时间新鲜度光环
- 图谱节点编辑/删除/合并/批量打标签 + 10 秒撤销

**MCP 接入产品化（"AI 大脑"差异化）**
- 12+ 客户端一键 / 半自动接入卡片
- mcp-proxy 解决 DB 隔离根本问题
- **MCP instructions 引导 AI 主动调记忆**（task 23A）
- **save_conclusion 工具让对话结论写回图谱**（task 23B）
- **隐式 access_count 给被引用记忆加权**（task 23C）
- 设置面板能力预览

**工程基础**
- brain-server 日志落盘 + 轮转 + 一键打开日志目录
- Tauri auto-update 框架 + GitHub Release CI（pubkey 已配，私钥待 Secret）
- macOS / Linux 打包脚本 + matrix CI 就绪（无设备实测）
- 移动端 LAN 鉴权（6 位配对码 + 127.0.0.1 免鉴权）

**仍为实验性 / 暂缓**
- 移动端 task 19/27 仅 typecheck 通过，未真机验证（无设备）
- macOS / Linux 打包等社区贡献者实测
- ESP32 真机仍暂缓
- 屏幕抓取首启默认关闭（capturePaused=true），用户可在设置面板手动开启

---

## 6. 仍欠的事（v1.2 后的路线）

task 01-34 完成后，原 P1/P2/P3 清单（除社区贡献类）全部消化。剩下的口子按价值/迫切度排：

### 待真机验证（无设备阻塞）

- **移动端真机**（Android / iOS）：task 19 + 27 代码就绪 + 配对码鉴权就绪，等社区在真机/模拟器跑通沉淀→搜索全链路。
- **macOS / Linux 打包**：task 29 脚本 + matrix CI 就绪，等社区在真机出包 + 安装验证。
- **ESP32 物理按钮真机**：固件源码 + 桌面 UDP 监听都在，等焊板验证。

### 待外部配置（私钥 / Secret）

- **Tauri auto-update 私钥注入 GitHub Secret**：本地 `desktop-daemon/.tauri-signing/omni.key` 已生成（gitignored），需手动到 GitHub repo Settings → Secrets 设置 `TAURI_PRIVATE_KEY` + `TAURI_KEY_PASSWORD`（空字符串）。完成后下次打 tag 即触发 CI 签名发版。

### 看市场反馈再决定

- **桌面 v1.3+ 主要候选**：图谱时间轴回放、节点笔记附件、Letta 风格的多层 memory tiering 在 UI 暴露、批量重建 embedding 进度条。
- **HTTP API 对外契约化**：当前 MCP 为主、HTTP 内部用；若有第三方需要 HTTP 直连，再补稳定契约文档。
- ~~**决策审计 / 复盘视图**~~ ✅ 2026-05-29 完成（DecisionTimeline）。

### 分发与宣传（1→100 的真正战场，非开发量）

> 产品本身 0→1 已基本完成。继续往前不是堆功能，而是"让人看得到、用得上、留得下"。这部分没人能替你写代码，但有方法可循。下面是按"低成本→高投入"排的可执行项，不是必须全做，是给自己一张清单别再空想。

- **一句话价值主张**：对外只说一句——"给任何 AI 装一个有长期记忆、能基于你历史做判断的本地大脑"。落地页 / README / 发帖标题都用这一句，不要罗列功能。
- **首发渠道**（开发者向产品的典型路径）：GitHub README 打磨（截图 + 30s GIF + 一键安装）→ 发 Show HN / Reddit (r/LocalLLaMA, r/selfhosted) / V2EX / 即刻 → MCP 生态目录收录（Claude/Cursor 社区的 MCP server 列表）。
- **宣传文案的写法**：先痛点（"和 AI 聊过的东西它转头就忘"）→ 再反差（"换成有记忆的脑子会怎样"）→ 给一个可复现的 30 秒 demo（在 Cursor 里问，它自动调出你上周的笔记）→ 强调本地/无云/数据主权这条差异化。**别一上来列 14 个 MCP 工具**，没人关心。
- **降低首用门槛**：安装包要无脑（已就绪）、首启即有 Demo（已就绪）、接入第一个 AI 客户端三步内完成（接入面板已就绪）。这三点是转化率命门，比加功能重要。
- **可信度素材**：一个 90 秒录屏（脚本已有 `docs/DEMO_SCRIPT.md`）、几张真实图谱截图、一句"为什么我做这个"的故事。

### 明确暂缓（不在 v1.x 范围）

- 多用户 / 账号体系
- 云同步
- 公网部署 / 鉴权
- 落盘加密
- Safari 插件
- ESP32 双向通信
- 移动端写入（截屏沉淀、上传）—— 定位为只读

---

## 7. 通往最终形态的历史路线图

> 排序原则（2026-05-21 定）：知识图谱 + 对外接口是护城河，路线图围绕它排。
> 先保证图谱「抽得准」，再把它打磨成能对外的「数字脑子」；桌面收尾类小活穿插进行。

### 阶段 1 —— 图谱地基：抽得准 ✅（2026-05-21 完成）
- ✅ 1.1 LLM 抽取管线端到端验证。
- ✅ 1.2 OCR → 入图谱链路。
- ✅ 1.3 Embedding 模型内置 + 离线加载。

### 阶段 2 —— 数字脑子：可对外的决策层 ✅（2026-05-21）
- ✅ 2.1 MCP 工具集按决策支持视角打磨。
- ✅ 2.2 MCP 定为对外主通道。
- ✅ 2.3 接入文档 `docs/MCP-INTEGRATION.md`。

### 阶段 3 —— 主动智能引擎验证 ✅（2026-05-21）

### 阶段 4 / 5 —— 暂缓（2026-05-21 范围决定）
当前交付形态锁定为 **桌面端 + 浏览器插件 + 数字脑子（MCP）对外接口**。

### 阶段 6 —— 产品深化（审查驱动）✅（2026-05-22 完成）
- ✅ 6.1 时序知识图谱
- ✅ 6.2 自动冲突检测
- ✅ 6.3 检索 token 效率
- ✅ 6.4 系统可观测性（自检 Tab）
- ✅ 6.5 工程治理（配置收敛）
- ✅ 6.6 首次体验（demo 图谱）
- ✅ 6.7 README 据实重写

### 阶段 7 —— 用户体验产品化（2026-05-25 → 2026-05-26 完成）

34 个 task 让产品从"功能能用"升级到"AI 用得起来的脑子"。

**第一批：基础 UX 修复（task 01-08）**
- ✅ 01 拖放修复 + 全窗口 + 文件夹递归
- ✅ 02 12+ MCP 客户端接入卡片
- ✅ 03 header 常驻上传按钮
- ✅ 04 HUD 独立窗口
- ✅ 05 Spotlight 搜索浮层 + 真实 API 接通
- ✅ 06 系统托盘 + 后台常驻
- ✅ 07 LLM 预设 + 首启 Wizard
- ✅ 08 MCP HTTP 代理薄壳

**第二批：产品最大 bug 修复 + 体验深化（task 09-20）**
- ✅ 09 截图真 OCR（产品最大功能 bug fix）
- ✅ 10 沉淀反馈对齐真实结果
- ✅ 11 triggerReset 实装
- ✅ 12 决策上下文接入（后被 22 重构）
- ✅ 13 文件上传异步 job + 进度
- ✅ 14 AgentLoop 锚点纳入 updated_at + 衰减洞见
- ✅ 15 搜索结果跨类别按分数排序
- ✅ 16 i18n 全量扫描（130+ key）
- ✅ 17 离线横幅文案友好化
- ✅ 18 Embedding 降级状态在 UI 暴露
- ✅ 19 移动端只读搜索 MVP（typecheck 通过）
- ✅ 20 MCP 接入页能力预览

**第三批：视觉 + 决策助手独立化（task 21-22）**
- ✅ 21 图谱节点视觉三件套
- ✅ 22 决策助手独立页面 + Ctrl+Shift+K

**第四批：AI 大脑产品化 + 工程基础（task 23-34）**
- ✅ 23 AI 大脑三件套（instructions + save_conclusion + access_count）
- ✅ 24 抓屏隐私控制（暂停 + 敏感应用 blocklist）
- ✅ 25 brain-server 日志落盘 + 轮转
- ✅ 26 浏览器扩展适配 task 13 异步 job 协议（chrome.alarms）
- ✅ 27 移动端真机配套 + LAN 配对码鉴权
- ✅ 28 Tauri 自动更新（pubkey 已配，私钥待 Secret）
- ✅ 29 macOS / Linux 打包脚本 + matrix CI（待真机验证）
- ✅ 30 图谱节点编辑/删除/批量/10 秒撤销 UX
- ✅ 31 图谱聚焦脉冲动画 + 时间新鲜度光环
- ✅ 32 快捷键冲突检测 + Embedding 模型重载按钮
- ✅ 33 决策助手"我已决定"沉淀回图谱
- ✅ 34 异步 job 协作式取消

### 阶段 7.5 —— 打磨 + 可发布性（2026-05-29）

真实用户（含非技术用户）试用反馈驱动的一轮收尾，把产品从"能用"推向"敢发"：

- ✅ CI matrix 修绿，三平台实测出包（Win/macOS-arm/Linux）
- ✅ GitHub Pages 落地页中英双语重做 + README 中英双语 + 文档合并去冗余
- ✅ MCP 接入诚实化（一键仅限验证客户端）+ Agent Skill 教正确工具名
- ✅ 决策助手：主动反问 + agentic 自主检索 + 深度讨论 500 修复 + 复盘时间线
- ✅ 空状态新手引导重构（加载 Demo 为主 + 逐功能导览）
- ✅ 桌面端 More 菜单遮挡修复

### 阶段 8 —— 见 § 6 路线图

剩下的事按"真机验证 / 外部配置 / 市场反馈"三类拆分。

---

## 8. 明确不做的（防止范围蔓延）

- ❌ 多用户 / 账号体系 / 密码
- ❌ 云端存储 / 云同步
- ❌ 公网部署 / 公网鉴权
- ❌ 落盘加密
- ❌ Safari 插件
- ❌ ESP32 双向通信
- ❌ 移动端写入能力（移动端定位为只读）

这些不是「以后做」，是这个产品形态**刻意不要**。要加需先改这份文档第 1 章的定位。

---

## 9. 附：技术参考

> 本节整合自旧的 `ECOSYSTEM.md`（已删除）。只保留与现状一致的事实性内容。

### 9.1 组件间通信协议（实际实现）

| From → To | 协议 | 说明 |
|---|---|---|
| 桌面端 UI → Brain Server | HTTP (3001) | fetch 调用 |
| 浏览器插件 → Brain Server | HTTP (3001) | 同 LAN，CORS 允许 |
| 移动端 → Brain Server | HTTP (3001) | LAN 内可达即可，无鉴权 |
| ESP32 → 桌面端 | UDP (9090) | 单向触发；远程需设 `OMNI_UDP_BIND=0.0.0.0:9090` |
| MCP 客户端（IDE）→ mcp-proxy.js → Brain Server | stdio + HTTP (3001) | 代理转发，所有客户端共享同一份 DB |

> 不存在跨进程 WebSocket 推送通道。旧文档里的 `WebSocket 9999` / `mDNS` 只是早期草稿，从未实现。各客户端是各自轮询 Brain Server 的 HTTP API。UDP 9090 默认仅监听 `127.0.0.1`。

### 9.2 项目结构

```
omni-context-release/
├── brain-server/        # 后台大脑：HTTP API + MCP + MCP 代理 + SQLite + Agent
│   ├── src/mcp-server.ts    # MCP stdio + HTTP 双模（桌面 App 内嵌入口）
│   ├── src/mcp-proxy.ts     # MCP 代理薄壳（各客户端 spawn 这个）
│   ├── src/mcp-tools.ts     # 14 个 MCP 工具的共享定义
│   └── src/api/handlers/    # 所有 HTTP 端点
├── desktop-daemon/      # 桌面端：Tauri(Rust) + Next.js 前端
│   └── src-tauri/       # Rust 侧：屏幕/剪贴板捕获、UDP、硬件、内嵌 Brain Server、托盘、MCP 配置写入
├── browser-extension/   # 浏览器插件（Manifest V3）
├── mobile-app/          # 移动端 React Native（只读搜索 MVP）
├── hardware/esp32-firmware/  # ESP32 固件源码 + 接线/BOM 文档
├── shared/              # 跨端共享的 types / constants
├── scripts/             # 打包脚本（build-desktop-only.js 等）
└── docs/
    ├── PRODUCT-VISION.md      # 本文档（北极星）
    ├── ARCHITECTURE.md        # 详细技术架构（README 不再展开）
    ├── MCP-INTEGRATION.md     # 第三方接入指南
    ├── BUILDING.md            # 打包、运行与发布（合并自原 PACKAGE/RELEASING）
    ├── EXPERIMENTAL.md        # 移动端 / ESP32 / 抓屏现状
    ├── DEMO_SCRIPT.md         # 90 秒 demo 拍摄脚本
    ├── index.html            # GitHub Pages 首页（landing，中英双语）
    └── landing/assets/        # 首页素材（social-preview 等）
```

### 9.3 权限用途

| 组件 | 权限 | 用途 |
|---|---|---|
| 桌面端 | 屏幕捕获 / 剪贴板 / UDP 监听 / fs.readFile / window 控制 / shell.open | 沉淀屏幕内容、读写剪贴板、接 ESP32、拖放读文件、HUD 独立窗口、打开数据目录 |
| 浏览器插件 | 标签页 / 右键菜单 / 通知 | 捕获网页、入口、HUD 提示 |
| 移动端 | 本地网络 | 与 Brain Server 同步（只读） |
