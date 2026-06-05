import { z } from 'zod';

export const RecordCaptureSchema = z.object({
  screenshot: z.string().optional(),
  clipboard: z.string().optional(),
  activeWindow: z.string().optional(),
  systemLogs: z.string().optional(),
  source: z.enum(['physical_button', 'keyboard_shortcut', 'manual', 'automated']),
  buttonType: z.enum(['precipitate', 'decision', 'reset']).optional(),
});

export const AddEntitySchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  type: z.enum([
    'principle',
    'evidence',
    'concept',
    'tool',
    'person',
    'project',
    'code_snippet',
    'architecture_pattern',
    'bug_vulnerability',
    'business_logic',
    'critical_review',
    'capture_snapshot',
    'memory',
    'decision',
    'goal',
    'question',
    'preference',
    'event',
    'task',
  ]),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.any().optional(),
});

export const AddRelationshipSchema = z.object({
  sourceId: z.string().min(1, '源实体ID不能为空'),
  targetId: z.string().min(1, '目标实体ID不能为空'),
  type: z.enum([
    'derived_from',
    'relates_to',
    'depends_on',
    'conflicts_with',
    'extends',
    'cites',
    'belongs_to',
    'supported_by',
    'extracted_from',
    'reviewed_by',
    'references',
    'decision_referenced',
  ]),
  description: z.string().optional(),
  weight: z.number().min(0).optional(),
});

export const GetGraphNeighborhoodSchema = z.object({
  entityId: z.string(),
  depth: z.number().min(1).max(3).optional().default(2),
});

export const ExtractFromCaptureSchema = z.object({
  text: z.string().optional(),
  screenshot: z.string().optional(),
  clipboard: z.string().optional(),
  captureId: z.string().optional(),
});

export const GetDecisionContextSchema = z.object({
  situation: z.string().min(1, 'situation 不能为空'),
  limit: z.number().min(1).max(20).optional().default(5),
});

export const SearchEntitiesSchema = z.object({
  query: z.string().min(1, '搜索查询不能为空'),
  type: z.string().optional(),
  limit: z.number().min(1).optional().default(10),
});

export const GetEntitySchema = z.object({
  id: z.string().min(1, '实体ID不能为空'),
});

export const ListEntitiesSchema = z.object({
  type: z.string().optional(),
  limit: z.number().min(1).optional().default(50),
});

export const UpdateEntitySchema = z.object({
  id: z.string().min(1, '实体ID不能为空'),
  name: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.any().optional(),
});

export const VectorSearchSchema = z.object({
  query: z.string().min(1, 'query 不能为空'),
  limit: z.number().min(1).optional().default(10),
});

export const UnifiedMemorySearchSchema = z.object({
  query: z.string().min(1, 'query 不能为空'),
  limit: z.number().min(1).optional().default(5),
  includeRelationships: z.boolean().optional().default(true),
  include_invalidated: z.boolean().optional().default(false),
});

export const SaveConclusionSchema = z.object({
  summary: z.string().min(1, 'summary 不能为空'),
  related_entity_ids: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export const SaveDecisionSchema = z.object({
  situation: z.string().min(1, 'situation 不能为空'),
  conclusion: z.string().min(1, 'conclusion 不能为空'),
  cited_entity_ids: z.array(z.string()).optional().default([]),
  confidence: z.enum(['high', 'medium', 'low']).optional().default('medium'),
  alternatives: z.string().optional().default(''),
  previous_decision_id: z.string().optional(),
});

export const AnalyzeDecisionSchema = z.object({
  situation: z.string().min(1, 'situation 不能为空'),
});

export const DiscussDecisionSchema = z.object({
  situation: z.string().min(1, 'situation 不能为空'),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })),
});

export const GetDecisionLineageSchema = z.object({
  decision_id: z.string().min(1, 'decision_id 不能为空'),
});

export const EmptySchema = z.object({});

export interface McpToolConfig {
  name: string;
  description: string;
  inputSchema: any;
  zodSchema: z.ZodSchema<any>;
}

// 问大脑 / 决策助手：接受单个 query（外部 MCP 客户端）或多轮 messages（应用内命令栏）
export const AskMemorySchema = z.object({
  query: z.string().optional(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
}).refine((data) => data.query || data.messages, {
  message: '必须提供 query 或 messages 中至少一个参数',
});
export const GraphAnswerSchema = AskMemorySchema;

// 整理 / curation
export const DeleteEntitySchema = z.object({ id: z.string().min(1) });
export const SetCoreSchema = z.object({ id: z.string().min(1), isCore: z.boolean() });
export const MergeEntitiesSchema = z.object({ keepId: z.string().min(1), dropId: z.string().min(1) });

export const tools: McpToolConfig[] = [
  {
    name: 'record_capture',
    description: 'Store a capture event (screenshot, clipboard content, system logs) into the knowledge graph. Use when the user explicitly wants to save a moment or piece of context for future reference.',
    zodSchema: RecordCaptureSchema,
    inputSchema: {
      type: 'object',
      properties: {
        screenshot: { type: 'string', description: '截图数据（base64）' },
        clipboard: { type: 'string', description: '剪贴板内容' },
        activeWindow: { type: 'string', description: '当前活动窗口' },
        systemLogs: { type: 'string', description: '系统日志' },
        source: {
          type: 'string',
          enum: ['physical_button', 'keyboard_shortcut', 'manual', 'automated'],
          description: '触发源',
        },
        buttonType: {
          type: 'string',
          enum: ['precipitate', 'decision', 'reset'],
          description: '按钮类型',
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'get_core_context',
    description: 'Get the user\'s core principles—their fundamental rules, preferences, and guidelines for how they work. Call this at the start of a conversation to understand the user\'s values and constraints before giving advice.',
    zodSchema: EmptySchema,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_entities',
    description: 'Search for entities in the knowledge graph by name or description. Use when you need to find specific concepts, tools, people, projects, or code the user has encountered before.',
    zodSchema: SearchEntitiesSchema,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询' },
        type: { type: 'string', description: '实体类型过滤' },
        limit: { type: 'number', description: '结果限制', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_entity',
    description: 'Add a new entity to the knowledge graph. Use when you discover a concept, tool, person, pattern, or piece of information worth remembering for future conversations.',
    zodSchema: AddEntitySchema,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '实体名称' },
        type: {
          type: 'string',
          enum: [
            'principle',
            'evidence',
            'concept',
            'tool',
            'person',
            'project',
            'code_snippet',
            'architecture_pattern',
            'bug_vulnerability',
            'business_logic',
            'critical_review',
            'capture_snapshot',
            'memory',
            'decision',
          ],
          description: '实体类型',
        },
        description: { type: 'string', description: '实体描述' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        metadata: { type: 'object', description: '扩展元数据（原则的 isCore、version 等）' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'get_entity',
    description: 'Retrieve full details and all relationships for a specific entity by its ID. Use when you have an entity ID from search results and need to explore its connections.',
    zodSchema: GetEntitySchema,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '实体ID' } },
      required: ['id'],
    },
  },
  {
    name: 'add_relationship',
    description: 'Create a relationship edge between two entities in the knowledge graph (e.g. depends_on, conflicts_with, extends, belongs_to). Use when you discover a meaningful connection between two concepts.',
    zodSchema: AddRelationshipSchema,
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: '源实体ID' },
        targetId: { type: 'string', description: '目标实体ID' },
        type: {
          type: 'string',
          enum: [
            'derived_from',
            'relates_to',
            'depends_on',
            'conflicts_with',
            'extends',
            'cites',
            'belongs_to',
            'supported_by',
            'extracted_from',
            'reviewed_by',
            'references',
            'decision_referenced',
          ],
          description: '关系类型',
        },
        description: { type: 'string', description: '关系描述' },
        weight: { type: 'number', description: '权重（记忆衰减机制）' },
      },
      required: ['sourceId', 'targetId', 'type'],
    },
  },
  {
    name: 'get_graph_neighborhood',
    description: 'Get the graph neighborhood around a specific entity—its directly related entities and their connections. Use when you need to understand the context and ecosystem surrounding a concept, rather than just its properties.',
    zodSchema: GetGraphNeighborhoodSchema,
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: '起始实体ID' },
        depth: { type: 'number', description: '遍历深度 1-3', default: 2 },
      },
      required: ['entityId'],
    },
  },
  {
    name: 'extract_from_capture',
    description: 'Analyze raw text or captured content and automatically extract entities, relationships, and principles into the knowledge graph. Use when processing a saved capture or analyzing a block of user-provided content.',
    zodSchema: ExtractFromCaptureSchema,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '文本内容' },
        screenshot: { type: 'string', description: '截图数据' },
        clipboard: { type: 'string', description: '剪贴板内容' },
        captureId: { type: 'string', description: '关联的capture_snapshot实体ID' },
      },
    },
  },
  {
    name: 'list_entities',
    description: 'List all entities in the knowledge graph, optionally filtered by type. Use to get an overview of what the user has stored, or to browse entities of a specific category.',
    zodSchema: ListEntitiesSchema,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '按类型过滤' },
        limit: { type: 'number', description: '结果限制', default: 50 },
      },
    },
  },
  {
    name: 'update_entity',
    description: 'Update an existing entity\'s name, description, tags, or metadata. Use when you need to correct or enrich information about something already in the knowledge graph.',
    zodSchema: UpdateEntitySchema,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '实体ID' },
        name: { type: 'string', description: '新名称' },
        description: { type: 'string', description: '新描述' },
        tags: { type: 'array', items: { type: 'string' }, description: '新标签' },
        metadata: { type: 'object', description: '新元数据' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_stats',
    description: 'Get system statistics: total entity count, relationship count, entity type distribution, and memory usage. Use when you need a high-level overview of the knowledge graph\'s size and composition.',
    zodSchema: EmptySchema,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'vector_search',
    description: 'Search the knowledge graph by semantic similarity using vector embeddings. Unlike text search, this finds conceptually related entities even when they use different words. Use when a keyword search misses relevant results.',
    zodSchema: VectorSearchSchema,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (natural language, converted to embedding on the server)' },
        limit: { type: 'number', description: 'Max results', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'unified_memory_search',
    description: 'Fused memory search combining text search, vector similarity, and graph traversal. Returns the most relevant entities for a given query across all three methods, deduplicated. This is the recommended go-to search when you want the most complete results.',
    zodSchema: UnifiedMemorySearchSchema,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询（自然语言）' },
        limit: { type: 'number', description: '每类搜索的结果限制', default: 5 },
        includeRelationships: { type: 'boolean', description: '是否包含关联关系', default: true },
        include_invalidated: { type: 'boolean', description: '是否包含已失效的历史关系', default: false },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_decision_context',
    description: 'When you are facing a specific situation or decision and need context from the user\'s knowledge graph to inform your judgment. Returns relevant principles, related memories, historical conflicts, and graph neighborhood — but does NOT make the decision for you. Call this before giving advice that depends on the user\'s past patterns or preferences.',
    zodSchema: GetDecisionContextSchema,
    inputSchema: {
      type: 'object',
      properties: {
        situation: { type: 'string', description: 'The situation or decision you are facing (natural language)' },
        limit: { type: 'number', description: 'Max items per result category', default: 5 },
      },
      required: ['situation'],
    },
  },
  {
    name: 'save_conclusion',
    description: 'Call this when the conversation reaches a meaningful conclusion, a decision is made, or the user learns something worth remembering. ALWAYS proactively call this at the end of a substantive conversation to save key takeaways into long-term memory. Pass a short summary and (if relevant) related entity IDs from earlier search results.',
    zodSchema: SaveConclusionSchema,
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One-paragraph summary of the conclusion or insight' },
        related_entity_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of entities this conclusion references (from prior search results)' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary'],
    },
  },
  {
    name: 'save_decision',
    description: 'Save a decision the user just made into the knowledge graph. Creates a decision entity linked to cited principles/memories via decision_referenced edges, and archives the full context for future retrieval. Use when the user has made a concrete choice and wants it remembered.',
    zodSchema: SaveDecisionSchema,
    inputSchema: {
      type: 'object',
      properties: {
        situation: { type: 'string', description: 'The situation/context that prompted the decision' },
        conclusion: { type: 'string', description: 'The final decision (1-2 sentences)' },
        cited_entity_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of principles/history entities this decision references' },
      },
      required: ['situation', 'conclusion'],
    },
  },
  {
    name: 'analyze_decision',
    description: 'Analyze a decision situation using the knowledge graph as context. Retrieves relevant principles, history, and conflicts, then feeds them to an LLM for structured analysis including pros/cons, risks, recommendation, and evidence citations. Use when the user wants AI-assisted decision analysis, not just raw data.',
    zodSchema: AnalyzeDecisionSchema,
    inputSchema: {
      type: 'object',
      properties: {
        situation: { type: 'string', description: 'The decision situation to analyze (natural language)' },
      },
      required: ['situation'],
    },
  },
  {
    name: 'discuss_decision',
    description: 'Continue a decision discussion with AI. Takes the conversation history and returns a follow-up response grounded in the knowledge graph context. Use for multi-turn decision refinement.',
    zodSchema: DiscussDecisionSchema,
    inputSchema: {
      type: 'object',
      properties: {
        situation: { type: 'string', description: 'The original decision situation' },
        messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } }, description: 'Conversation history' },
      },
      required: ['situation', 'messages'],
    },
  },
  {
    name: 'get_decision_lineage',
    description: 'Trace the lineage of a decision — what sources it cited and what other decisions form a chain with it. Useful for understanding how past decisions connect to form a reasoning path.',
    zodSchema: GetDecisionLineageSchema,
    inputSchema: {
      type: 'object',
      properties: {
        decision_id: { type: 'string', description: 'The decision entity ID to trace' },
      },
      required: ['decision_id'],
    },
  },
  {
    name: 'get_decay_report',
    description: 'Get the memory decay report showing which entities have decayed over time and may need reinforcement or cleanup. Use when maintaining the knowledge graph\'s health.',
    zodSchema: EmptySchema,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ask_memory',
    description: 'Ask the user\'s second brain a natural-language question. Retrieves relevant memories from the local knowledge graph and answers grounded in them, citing sources. Use for "what do I know/think about X" style questions.',
    zodSchema: AskMemorySchema,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question to ask, in natural language' },
        messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } }, description: 'Conversation history for multi-turn dialogue' },
      },
    },
  },
  {
    name: 'graph_answer',
    description: 'Answer a question or help with a decision using the user\'s knowledge graph. Returns a structured result: a one-line conclusion, supporting reasons (each citing memory nodes), the cited sub-graph edges, and—for decisions—clarifying questions. Prefer for decisions ("should I…", "which…") and whenever grounded, citable reasoning is wanted.',
    zodSchema: GraphAnswerSchema,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question or decision to reason about, in natural language' },
        messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } }, description: 'Conversation history for multi-turn dialogue' },
      },
    },
  },
  {
    name: 'merge_entities',
    description: 'Soft-merge two duplicate entities: keep one, fold the other into it (relationships repointed, the other hidden). Reversible. Use to consolidate duplicates instead of deleting.',
    zodSchema: MergeEntitiesSchema,
    inputSchema: {
      type: 'object',
      properties: {
        keepId: { type: 'string', description: '保留的实体 ID' },
        dropId: { type: 'string', description: '并入并隐藏的实体 ID' },
      },
      required: ['keepId', 'dropId'],
    },
  },
  {
    name: 'set_core_principle',
    description: 'Mark a principle as core (injected into every AI conversation) or demote it from core. Keep core to the user few distinctive operating principles; demote generic or bulk-imported ones.',
    zodSchema: SetCoreSchema,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '实体 ID' },
        isCore: { type: 'boolean', description: 'true=设为核心；false=降出核心' },
      },
      required: ['id', 'isCore'],
    },
  },
  {
    name: 'delete_entity',
    description: 'Permanently delete an entity and its relationships. Irreversible — prefer merge_entities for duplicates. Use only for clearing genuine junk/wrong memories.',
    zodSchema: DeleteEntitySchema,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '要删除的实体 ID' } },
      required: ['id'],
    },
  },
];
