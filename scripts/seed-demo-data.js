#!/usr/bin/env node
/**
 * Omni-Context Demo Data Seeder
 *
 * Inserts a realistic-looking corpus (entities, relationships, memories,
 * notifications) into the SQLite database so a freshly-installed app shows
 * a populated knowledge graph for demos / screenshots / screen recordings.
 *
 * Usage:
 *   node scripts/seed-demo-data.js           (interactive confirm)
 *   node scripts/seed-demo-data.js --force   (skip confirm)
 *
 * Env:
 *   DB_PATH - override database path (default: ./data/omni-context.db)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ----- Resolve sqlite3 + uuid from brain-server/node_modules ---------------
const ROOT = path.resolve(__dirname, '..');
const BRAIN_NM = path.join(ROOT, 'brain-server', 'node_modules');

function loadFromBrainServer(name) {
  const pkgPath = path.join(BRAIN_NM, name);
  if (!fs.existsSync(pkgPath)) {
    console.error('\n[seed-demo] ERROR: Could not find ' + name + ' at ' + pkgPath);
    console.error('[seed-demo] Run `cd brain-server && npm install` (and ideally `npm run build`) first, then retry.\n');
    process.exit(1);
  }
  return require(pkgPath);
}

const sqlite3 = loadFromBrainServer('sqlite3').verbose();
const { v4: uuidv4 } = loadFromBrainServer('uuid');

// ----- CLI args --------------------------------------------------------------
const args = process.argv.slice(2);
const FORCE = args.includes('--force') || args.includes('-y');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(ROOT, 'data', 'omni-context.db');

// ----- Promise wrappers ------------------------------------------------------
function pRun(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params || [], function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function pGet(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params || [], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}
function pExec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}
function pClose(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

// ----- Random helpers --------------------------------------------------------
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.random() * (max - min) + min; }
function pastIso(maxDaysAgo) {
  const ms = Date.now() - randInt(0, maxDaysAgo * 24 * 3600) * 1000;
  return new Date(ms).toISOString();
}

// ----- Minimal idempotent schema (matches brain-server migrations) ----------
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  source_file TEXT,
  tags TEXT,
  embedding BLOB,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activated TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, target_id, type)
);
CREATE TABLE IF NOT EXISTS core_memory (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL,
  last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS archival_memory (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  summary TEXT,
  tags TEXT,
  embedding BLOB,
  importance REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL,
  related_entities TEXT,
  read_status BOOLEAN NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ============================================================================
// SEED CONTENT
// ============================================================================

// 5-8 concept entities
const CONCEPTS = [
  { name: '知识图谱 (Knowledge Graph)', desc: '以实体—关系—属性三元组形式表征领域知识的结构化记忆形态，支持多跳推理与上下文压缩。', tags: ['graph', 'memory', 'core'] },
  { name: '记忆衰减 (Memory Decay)', desc: '基于 last_accessed 与 access_count 的时间指数衰减，用于自动降权陈旧记忆并触发归档。', tags: ['memory', 'decay'] },
  { name: '向量检索 (Vector Retrieval)', desc: 'Embedding 余弦相似度召回 + 重排序的语义搜索范式，配合 sqlite-vec 实现 SQL 层 KNN。', tags: ['retrieval', 'vector'] },
  { name: 'Letta 范式', desc: 'Core Memory（热）+ Archival Memory（冷）的双层 LLM Agent 记忆架构，源自 MemGPT。', tags: ['agent', 'memory-arch'] },
  { name: 'GraphRAG', desc: '微软提出的 RAG 增强方案：先对语料抽实体关系建图，再按子图召回上下文，显著提升多跳问答效果。', tags: ['rag', 'graph'] },
  { name: 'Cyberpunk Glassmorphism', desc: '深色 + 高饱和霓虹 + 毛玻璃模糊的 UI 视觉语言，常用于 AI / 加密 / 工具类产品塑造未来感。', tags: ['design', 'ui'] },
  { name: 'Prompt Injection', desc: '攻击者通过用户输入夹带指令覆盖系统 prompt 的注入攻击，是 LLM 应用 OWASP Top 10 之首。', tags: ['security', 'llm'] },
];

// 5-8 tool entities
const TOOLS = [
  { name: 'sqlite-vec', desc: 'SQLite 原生向量扩展，提供 vec0 虚拟表与 KNN 查询，单文件零部署。', tags: ['db', 'vector'] },
  { name: 'FTS5', desc: 'SQLite 内建全文检索引擎，支持 BM25 排序与 Unicode 分词，作为 vector 的 lexical 互补。', tags: ['db', 'search'] },
  { name: 'Tauri', desc: 'Rust + WebView 的轻量桌面框架，包体 < 10MB，被 desktop-daemon 用作壳。', tags: ['desktop', 'rust'] },
  { name: 'Next.js 14', desc: 'React 全栈框架，App Router + RSC，desktop-daemon 内嵌 UI 使用。', tags: ['frontend', 'react'] },
  { name: 'Expo', desc: 'React Native 工具链，mobile-app 用其管理跨平台构建与 OTA 更新。', tags: ['mobile', 'react-native'] },
  { name: 'MCP SDK', desc: 'Anthropic Model Context Protocol 官方 SDK，brain-server 通过它向 Claude Desktop 暴露 tools。', tags: ['mcp', 'protocol'] },
  { name: 'lucide-react', desc: '轻量开源图标库，全 SVG 单色，与 Tailwind 配合默契。', tags: ['ui', 'icons'] },
];

// 3-5 core principles (metadata.isCore=true)
const PRINCIPLES = [
  { name: '代码改动用 git 管理时优先 commit 不 amend', desc: '修改后立即 git commit，不 amend 既有 commit，避免破坏共享历史与丢失中间状态。', tags: ['git', 'workflow'] },
  { name: '对 internal code 做简化假设', desc: '内部模块只在系统边界做严格校验，内部信任不做防御性 if/throw，避免噪音放大。', tags: ['code-quality'] },
  { name: '不添加非必要的错误处理', desc: '错误处理只在恢复路径明确时编写，否则让其崩溃以暴露真问题，而不是 try/catch 吞掉。', tags: ['code-quality', 'errors'] },
  { name: '不做需求之外的改进和重构', desc: '保持 PR 范围最小，重构与功能改动分开提交，便于 review 与回退。', tags: ['workflow', 'pr'] },
  { name: '代码安全性优先 OWASP Top 10', desc: '在每次涉及 input/auth/storage 的 PR 中先过一遍 Top 10 清单：注入、XSS、CSRF、认证、配置错误等。', tags: ['security'] },
];

// Mixed bug_vulnerability / architecture_pattern (8-12)
const MIXED = [
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

// Possible relationship types — DB column is unconstrained TEXT so we mix
// canonical brain-server types with the spec-requested demo types for variety.
const REL_TYPES = [
  'uses_tech', 'depends_on', 'similar_to', 'contradicts', 'referenced_by',
  'relates_to', 'derived_from', 'extends', 'cites', 'supported_by',
];

// Archival memory long content (10-15)
const ARCHIVAL = [
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

// Core memory key/values (10)
const CORE_MEMORIES = [
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

// Notifications (5, type='insight')
const NOTIFICATIONS = [
  { title: '发现新关联：sqlite-vec ↔ FTS5', content: 'Agent 注意到你最近频繁同时查询 vector 与 FTS5 的实体，可能值得抽象一个 hybrid-search 工具函数。' },
  { title: '记忆密度峰值', content: '过去 7 天写入了 18 条记忆，是上一周（5 条）的 3.6 倍。建议考虑做一次主题聚类回顾。' },
  { title: '潜在矛盾检测', content: '原则「不添加非必要错误处理」与最近一条 archival_memory 中"为合规加 audit_log"存在表面冲突，建议人工裁定优先级。' },
  { title: '陈旧记忆触发归档', content: '检测到 4 条 last_accessed > 30 天的低权重 entity，已建议批量归档至 archival_memory。' },
  { title: '新概念候选', content: '"GraphRAG" 与 "Letta 范式" 在 12 条 archival_memory 中共现，建议提取为 concept 实体。' },
];

// ----- Insertion logic -------------------------------------------------------
async function confirm() {
  if (FORCE) return true;
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('warning: this will INSERT 50+ rows of demo data into ' + DB_PATH + ', continue? [y/N] ', (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

async function tableCount(db, table) {
  try {
    const row = await pGet(db, 'SELECT COUNT(*) AS c FROM ' + table);
    return row ? row.c : 0;
  } catch (_) { return 0; }
}

async function seed() {
  // Make sure data dir exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  console.log('[seed-demo] DB path: ' + DB_PATH);
  const ok = await confirm();
  if (!ok) {
    console.log('[seed-demo] aborted.');
    process.exit(0);
  }

  const db = new sqlite3.Database(DB_PATH);
  await pRun(db, 'PRAGMA foreign_keys = ON');
  await pExec(db, SCHEMA_SQL);

  const inserted = {
    entities: 0, relationships: 0,
    core_memory: 0, archival_memory: 0, notifications: 0,
  };

  // ---- entities --------------------------------------------------------
  const allEntities = [];

  function pushEntity(name, type, description, tags, metadata) {
    const id = uuidv4();
    const created = pastIso(30);
    const updated = pastIso(15);
    const lastAcc = pastIso(7);
    allEntities.push({
      id, name, type, description,
      tags: JSON.stringify(tags || []),
      metadata: metadata ? JSON.stringify(metadata) : null,
      created_at: created,
      updated_at: updated,
      last_accessed: lastAcc,
      access_count: randInt(0, 35),
    });
  }

  CONCEPTS.forEach((c) => pushEntity(c.name, 'concept', c.desc, c.tags));
  TOOLS.forEach((t) => pushEntity(t.name, 'tool', t.desc, t.tags));
  PRINCIPLES.forEach((p) => pushEntity(p.name, 'principle', p.desc, p.tags, { isCore: true }));
  MIXED.forEach((m) => pushEntity(m.name, m.type, m.desc, m.tags));

  await pRun(db, 'BEGIN');
  try {
    for (const e of allEntities) {
      await pRun(
        db,
        'INSERT OR IGNORE INTO entities (id, name, type, description, tags, metadata, created_at, updated_at, last_accessed, access_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [e.id, e.name, e.type, e.description, e.tags, e.metadata, e.created_at, e.updated_at, e.last_accessed, e.access_count]
      );
      inserted.entities++;
    }

    // ---- relationships -------------------------------------------------
    // Aim ~35 relationships, mostly cross-type for visual graph density.
    const ids = allEntities.map((e) => e.id);
    const seen = new Set();
    let relCount = 0;
    let attempts = 0;
    while (relCount < 36 && attempts < 400) {
      attempts++;
      const a = pick(ids);
      const b = pick(ids);
      if (a === b) continue;
      const t = pick(REL_TYPES);
      const key = a + '->' + b + ':' + t;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = uuidv4();
      const created = pastIso(28);
      try {
        await pRun(
          db,
          'INSERT OR IGNORE INTO relationships (id, source_id, target_id, type, description, weight, created_at, last_activated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, a, b, t, null, randFloat(0.4, 1.6).toFixed(2), created, pastIso(5)]
        );
        inserted.relationships++;
        relCount++;
      } catch (_) { /* unique conflict, skip */ }
    }

    // ---- archival_memory ----------------------------------------------
    for (const a of ARCHIVAL) {
      const id = uuidv4();
      const created = pastIso(30);
      await pRun(
        db,
        'INSERT INTO archival_memory (id, content, summary, tags, importance, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, a.content, a.content.slice(0, 60) + '…', JSON.stringify(a.tags), a.importance, created, created]
      );
      inserted.archival_memory++;
    }

    // ---- core_memory --------------------------------------------------
    for (const c of CORE_MEMORIES) {
      await pRun(
        db,
        'INSERT OR REPLACE INTO core_memory (key, value, category, last_accessed, access_count, summary) VALUES (?, ?, ?, ?, ?, ?)',
        [c.key, c.value, c.category, pastIso(3), randInt(1, 50), null]
      );
      inserted.core_memory++;
    }

    // ---- notifications ------------------------------------------------
    for (const n of NOTIFICATIONS) {
      const id = uuidv4();
      // Pick 2-3 random related entities
      const rel = [];
      for (let i = 0; i < randInt(2, 3); i++) rel.push(pick(ids));
      await pRun(
        db,
        'INSERT INTO notifications (id, title, content, type, related_entities, read_status, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [id, n.title, n.content, 'insight', JSON.stringify(rel), pastIso(5)]
      );
      inserted.notifications++;
    }

    await pRun(db, 'COMMIT');
  } catch (err) {
    await pRun(db, 'ROLLBACK').catch(() => {});
    throw err;
  }

  // ---- Stats -----------------------------------------------------------
  const totals = {
    entities: await tableCount(db, 'entities'),
    relationships: await tableCount(db, 'relationships'),
    core_memory: await tableCount(db, 'core_memory'),
    archival_memory: await tableCount(db, 'archival_memory'),
    notifications: await tableCount(db, 'notifications'),
  };

  await pClose(db);

  console.log('\n[seed-demo] inserted this run:');
  Object.entries(inserted).forEach(([k, v]) => console.log('  + ' + k.padEnd(18) + ' ' + v));
  console.log('\n[seed-demo] current totals in DB:');
  Object.entries(totals).forEach(([k, v]) => console.log('  = ' + k.padEnd(18) + ' ' + v));
  console.log('\n[seed-demo] done. Open the desktop app to see a populated graph.');
}

seed().catch((err) => {
  console.error('[seed-demo] FAILED:', err);
  process.exit(1);
});
