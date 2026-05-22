import { EntityType } from './shared-types.js';

export interface DemoConcept {
  name: string;
  desc: string;
  tags: string[];
}

export interface DemoTool {
  name: string;
  desc: string;
  tags: string[];
}

export interface DemoPrinciple {
  name: string;
  desc: string;
  tags: string[];
}

export interface DemoMixed {
  name: string;
  type: EntityType;
  desc: string;
  tags: string[];
}

export interface DemoArchival {
  content: string;
  tags: string[];
  importance: number;
}

export interface DemoCoreMemory {
  key: string;
  value: string;
  category: string;
}

export interface DemoNotification {
  title: string;
  content: string;
}

export const CONCEPTS: DemoConcept[] = [
  { name: '知识图谱 (Knowledge Graph)', desc: '以实体—关系—属性三元组形式表征领域知识的结构化记忆形态，支持多跳推理与上下文压缩。', tags: ['graph', 'memory', 'core'] },
  { name: '记忆衰减 (Memory Decay)', desc: '基于 last_accessed 与 access_count 的时间指数衰减，用于自动降权陈旧记忆并触发归档。', tags: ['memory', 'decay'] },
  { name: '向量检索 (Vector Retrieval)', desc: 'Embedding 余弦相似度召回 + 重排序的语义搜索范式，配合 sqlite-vec 实现 SQL 层 KNN。', tags: ['retrieval', 'vector'] },
  { name: 'Letta 范式', desc: 'Core Memory（热）+ Archival Memory（冷）的双层 LLM Agent 记忆架构，源自 MemGPT。', tags: ['agent', 'memory-arch'] },
  { name: 'GraphRAG', desc: '微软提出的 RAG 增强方案：先对语料抽实体关系建图，再按子图召回上下文，显著提升多跳问答效果。', tags: ['rag', 'graph'] },
  { name: 'Cyberpunk Glassmorphism', desc: '深色 + 高饱和霓虹 + 毛玻璃模糊的 UI 视觉语言，常用于 AI / 加密 / 工具类产品塑造未来感。', tags: ['design', 'ui'] },
  { name: 'Prompt Injection', desc: '攻击者通过用户输入夹带指令覆盖系统 prompt 的注入攻击，是 LLM 应用 OWASP Top 10 之首。', tags: ['security', 'llm'] },
];

export const TOOLS: DemoTool[] = [
  { name: 'sqlite-vec', desc: 'SQLite 原生向量扩展，提供 vec0 虚拟表与 KNN 查询，单文件零部署。', tags: ['db', 'vector'] },
  { name: 'FTS5', desc: 'SQLite 内建全文检索引擎，支持 BM25 排序与 Unicode 分词，作为 vector 的 lexical 互补。', tags: ['db', 'search'] },
  { name: 'Tauri', desc: 'Rust + WebView 的轻量桌面框架，包体 < 10MB，被 desktop-daemon 用作壳。', tags: ['desktop', 'rust'] },
  { name: 'Next.js 14', desc: 'React 全栈框架，App Router + RSC，desktop-daemon 内嵌 UI 使用。', tags: ['frontend', 'react'] },
  { name: 'Expo', desc: 'React Native 工具链，mobile-app 用其管理跨平台构建与 OTA 更新。', tags: ['mobile', 'react-native'] },
  { name: 'MCP SDK', desc: 'Anthropic Model Context Protocol 官方 SDK，brain-server 通过它向 Claude Desktop 暴露 tools。', tags: ['mcp', 'protocol'] },
  { name: 'lucide-react', desc: '轻量开源图标库，全 SVG 单色，与 Tailwind 配合默契。', tags: ['ui', 'icons'] },
];

export const PRINCIPLES: DemoPrinciple[] = [
  { name: '代码改动用 git 管理时优先 commit 不 amend', desc: '修改后立即 git commit，不 amend 既有 commit，避免破坏共享历史与丢失中间状态。', tags: ['git', 'workflow'] },
  { name: '对 internal code 做简化假设', desc: '内部模块只在系统边界做严格校验，内部信任不做防御性 if/throw，避免噪音放大。', tags: ['code-quality'] },
  { name: '不添加非必要的错误处理', desc: '错误处理只在恢复路径明确时编写，否则让其崩溃以暴露真问题，而不是 try/catch 吞掉。', tags: ['code-quality', 'errors'] },
  { name: '不做需求之外的改进 and 重构', desc: '保持 PR 范围最小，重构与功能改动分开提交，便于 review 与回退。', tags: ['workflow', 'pr'] },
  { name: '代码安全性优先 OWASP Top 10', desc: '在每次涉及 input/auth/storage 的 PR 中先过一遍 Top 10 清单：注入、XSS、CSRF、认证、配置错误等。', tags: ['security'] },
];

export const MIXED: DemoMixed[] = [
  { name: 'SQL Injection in dynamic ORDER BY', type: 'bug_vulnerability', desc: '用户传入的列名直接拼到 ORDER BY 后产生注入，需用白名单映射。', tags: ['security', 'sql'] },
  { name: 'XSS via dangerouslySetInnerHTML', type: 'bug_vulnerability', desc: 'React 直接渲染未转义的用户 HTML，应用 DOMPurify。', tags: ['security', 'react'] },
  { name: 'Missing rate limit on /api/login', type: 'bug_vulnerability', desc: '登录接口无速率限制，易被密码喷洒，需加 IP+账号双维度限流。', tags: ['security', 'auth'] },
  { name: 'Race condition in core_memory.update', type: 'bug_vulnerability', desc: '并发写 core_memory 同 key 时 last_accessed 错乱，需事务包住 read-modify-write。', tags: ['concurrency', 'db'] },
  { name: 'Memory leak in HUD particles', type: 'bug_vulnerability', desc: '粒子系统未在 unmount 时取消 requestAnimationFrame 句柄。', tags: ['frontend', 'leak'] },
  { name: 'Hexagonal Architecture', type: 'architecture_pattern', desc: '六边形（端口-适配器）架构，brain-server 通过 ports/ 隔离 SQLite/MCP/HTTP。', tags: ['arch'] },
  { name: 'CQRS', type: 'architecture_pattern', desc: '命令-查询职责分离，写模型用关系表，读模型用物化的图视图。', tags: ['arch', 'data'] },
  { name: 'Event Sourcing', type: 'architecture_pattern', desc: '所有状态变化以追加日志记录，便于审计与时间旅行。', tags: ['arch', 'data'] },
  { name: 'Circuit Breaker', type: 'architecture_pattern', desc: '依赖故障时熔断降级，保护下游不被雪崩。', tags: ['arch', 'reliability'] },
  { name: 'Repository Pattern', type: 'architecture_pattern', desc: '数据访问统一通过 repository 接口，便于切换存储与单测 mock。', tags: ['arch'] },
];

export const ARCHIVAL: DemoArchival[] = [
  { content: '今天和老板讨论 Q3 OKR：核心目标是把 Omni-Context 的桌面端 DAU 从 200 推到 1500，关键路径是把 onboarding 的「图谱空白」问题解决——决定做一个 demo seed 命令；次要目标是上线 Pro 订阅，定价 $9.9/月，含云同步与多设备。', tags: ['okr', 'q3', 'meeting'], importance: 0.9 },
  { content: '复盘 Letta 范式：core_memory 写入要 < 2KB / 条以避免 LLM 上下文炸；archival_memory 用 importance 分位数 80% 阈值再回流到 entities 表做实体抽取；衰减系数 lambda=0.05/day 在我们的数据上拟合最好。', tags: ['letta', 'memory', 'tuning'], importance: 0.85 },
  { content: '调研 GraphRAG vs 朴素 RAG：在内部 200 篇笔记的多跳问答测试集上，GraphRAG 的 EM 从 0.42 → 0.61，但索引构建时间慢了 4x。当前方案：写入时异步建图，查询时图召回 + 向量召回 union。', tags: ['rag', 'graph', 'benchmark'], importance: 0.8 },
  { content: '阅读《Designing Data-Intensive Applications》第 5 章，复制部分。同步复制延迟敏感、异步可能丢数据、半同步是折中。我们 brain-server 单机 SQLite 暂不需要，但 Pro 订阅的云同步要按 last-write-wins + vector clock 设计。', tags: ['reading', 'ddia', 'replication'], importance: 0.6 },
  { content: '用户访谈 #7（产品经理 L）：他每天打开 Notion 30+ 次，痛点是搜不到三个月前的会议纪要。我们的卖点要强化「时间维度」——侧边栏要有时间轴 scrubber，能看到记忆密度热力图。', tags: ['user-research', 'pmf'], importance: 0.75 },
  { content: '修了 sqlite-vec 在 macOS arm64 下的加载错误：原因是 prebuild 包没带 universal binary，临时方案是 fall back 到 JS 余弦计算。已在 issue #42 跟踪，等上游修。', tags: ['bug', 'macos', 'sqlite-vec'], importance: 0.55 },
  { content: 'Cyberpunk Glassmorphism 设计稿 v3：背景 #0a0414，主色 violet-400 #a78bfa，辅色 cyan-300 #67e8f9，玻璃层 backdrop-blur-xl + bg-white/5 + border-white/10。HUD 节点用径向渐变描边。', tags: ['design', 'ui', 'palette'], importance: 0.7 },
  { content: '今天读完了 Anthropic 的 Computer Use 论文，核心 insight 是把屏幕截图直接喂给多模态模型并让它输出像素坐标。我们浏览器扩展的 capture 流程可以借鉴：定期截图 + OCR + 实体抽取，写入 archival_memory。', tags: ['paper', 'multimodal', 'ideas'], importance: 0.8 },
  { content: '面试候选人 J，全栈 + Rust 背景，5 年 React 经验。技术轮过：手写 LRU O(1)、设计 url shortener、解释 React fiber 调度。文化轮约下周一。', tags: ['hiring', 'interview'], importance: 0.5 },
  { content: '客户 Acme 反馈：他们的合规部门要求所有 AI 写入数据库的内容必须可审计。我们要加 audit_log 表记录每条 entity 的创建来源（user / agent / import），并支持导出 CSV。', tags: ['enterprise', 'compliance', 'roadmap'], importance: 0.85 },
  { content: '研究 prompt injection 防御：当前流派——分隔符（脆）、双 LLM（贵）、宪法 AI（最稳）。决定 brain-server 的 MCP tool 入参做白名单 schema + 输出做敏感字段红队测试。', tags: ['security', 'llm', 'prompt-injection'], importance: 0.75 },
  { content: '周会决定砍掉 mobile-app 的离线编辑功能 —— 用户调研显示 < 5% 的人需要，但开发成本占当 sprint 40%。改为只做只读浏览 + 语音速记。', tags: ['planning', 'sprint'], importance: 0.6 },
];

export const CORE_MEMORIES: DemoCoreMemory[] = [
  { key: 'current_project', value: 'Omni-Context — 全域物理级 AI 记忆操作系统', category: 'context' },
  { key: 'coding_style', value: 'TypeScript strict + ESM + 函数式优先；不写不必要的类；错误向上抛不本地吞。', category: 'preferences' },
  { key: 'today_focus', value: '修 desktop-daemon 启动时图谱空白问题，写 demo seed 脚本。', category: 'context' },
  { key: 'user_name', value: '老白', category: 'identity' },
  { key: 'preferred_lang', value: '中文（技术名词保留英文）', category: 'preferences' },
  { key: 'editor', value: 'VS Code + Cursor，Claude Code CLI', category: 'preferences' },
  { key: 'os', value: 'Windows 11 主用 + macOS arm64 副机', category: 'environment' },
  { key: 'work_hours', value: '10:00–13:00 深度编码 / 14:00–17:00 会议 / 21:00–24:00 阅读和原型', category: 'schedule' },
  { key: 'reading_now', value: 'Designing Data-Intensive Applications, ch.5 / Anthropic Computer Use paper', category: 'context' },
  { key: 'next_milestone', value: 'v3.1 发布：seed demo + 云同步 + Pro 订阅', category: 'goals' },
];

export const NOTIFICATIONS: DemoNotification[] = [
  { title: '发现新关联：sqlite-vec ↔ FTS5', content: 'Agent 注意到你最近频繁同时查询 vector 与 FTS5 的实体，可能值得抽象一个 hybrid-search 工具函数。' },
  { title: '记忆密度峰值', content: '过去 7 天写入了 18 条记忆，是上一周（5 条）的 3.6 倍。建议考虑做一次主题聚类回顾。' },
  { title: '潜在矛盾检测', content: '原则「不添加非必要错误处理」与最近一条 archival_memory 中"为合规加 audit_log"存在表面冲突，建议人工裁定优先级。' },
  { title: '陈旧记忆触发归档', content: '检测到 4 条 last_accessed > 30 天的低权重 entity，已建议批量归档至 archival_memory。' },
  { title: '新概念候选', content: '"GraphRAG" 与 "Letta 范式" 在 12 条 archival_memory 中共现，建议提取为 concept 实体。' },
];

export const REL_TYPES = [
  'uses_tech', 'depends_on', 'similar_to', 'contradicts', 'referenced_by',
  'relates_to', 'derived_from', 'extends', 'cites', 'supported_by',
];
