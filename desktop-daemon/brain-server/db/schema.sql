-- Omni-Context 数据库 Schema (GraphRAG 范式)

-- Entities 表：知识图谱节点
CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- principle, evidence, concept, tool, person, project, code_snippet
    description TEXT,
    source_file TEXT,
    tags TEXT, -- JSON array
    embedding BLOB, -- vector embedding
    metadata TEXT, -- JSON object
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Relationships 表：知识图谱边
CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    type TEXT NOT NULL, -- derived_from, relates_to, depends_on, conflicts_with, extends, cites
    description TEXT,
    weight REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES entities(id) ON DELETE CASCADE,
    UNIQUE(source_id, target_id, type)
);

-- Principles 表：核心原则
CREATE TABLE IF NOT EXISTS principles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL, -- code_principle, design_pattern, workflow_rule, personal_preference, security_rule, performance_optimization
    is_core BOOLEAN NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Evidence 表：推导依据
CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    principle_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL, -- screenshot, clipboard, log, manual
    source_file TEXT,
    ocr_text TEXT,
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (principle_id) REFERENCES principles(id) ON DELETE CASCADE
);

-- CriticReviews 表：黑客批判审核
CREATE TABLE IF NOT EXISTS critic_reviews (
    id TEXT PRIMARY KEY,
    principle_id TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    vulnerabilities TEXT, -- JSON array
    suggestions TEXT, -- JSON array
    reviewer_model TEXT NOT NULL,
    reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (principle_id) REFERENCES principles(id) ON DELETE CASCADE
);

-- CaptureSnapshots 表：屏幕捕获快照
CREATE TABLE IF NOT EXISTS capture_snapshots (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    screenshot TEXT, -- base64 or file path
    clipboard TEXT,
    active_window TEXT,
    system_logs TEXT, -- JSON array
    source TEXT NOT NULL, -- physical_button, manual, schedule
    button_type TEXT, -- precipitate, decision, reset
    processed BOOLEAN NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CoreMemory 表：Letta 范式的核心内存
CREATE TABLE IF NOT EXISTS core_memory (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL, -- JSON
    category TEXT NOT NULL,
    last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
    access_count INTEGER NOT NULL DEFAULT 0
);

-- ArchivalMemory 表：Letta 范式的归档内存
CREATE TABLE IF NOT EXISTS archival_memory (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    summary TEXT,
    tags TEXT, -- JSON array
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
CREATE INDEX IF NOT EXISTS idx_principles_type ON principles(type);
CREATE INDEX IF NOT EXISTS idx_principles_is_core ON principles(is_core);
CREATE INDEX IF NOT EXISTS idx_evidence_principle_id ON evidence(principle_id);
CREATE INDEX IF NOT EXISTS idx_critic_reviews_principle_id ON critic_reviews(principle_id);
CREATE INDEX IF NOT EXISTS idx_capture_snapshots_processed ON capture_snapshots(processed);
