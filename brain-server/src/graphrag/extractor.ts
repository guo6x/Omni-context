import { v4 as uuidv4 } from 'uuid';
import { Entity, Relationship, EntityType, RelationshipType } from '../shared-types.js';
import { LLMExtractorPipeline } from './llm-pipeline.js';
import { OCRPipeline } from '../ocr/pipeline.js';
import { sanitizeForExtraction } from './sanitize.js';

const DEFAULT_IMPORTANCE_MAP: Record<EntityType, number> = {
  principle: 0.75,
  decision: 0.75,
  goal: 0.75,
  bug_vulnerability: 0.70,
  critical_review: 0.70,
  project: 0.60,
  person: 0.60,
  architecture_pattern: 0.60,
  concept: 0.50,
  memory: 0.50,
  business_logic: 0.50,
  task: 0.50,
  question: 0.50,
  preference: 0.50,
  tool: 0.45,
  code_snippet: 0.45,
  event: 0.40,
  evidence: 0.40,
  capture_snapshot: 0.30,
};

function clamp01(x: any): number {
  const num = Number(x);
  if (isNaN(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}

export interface ExtractionInput {
  screenshot?: string;
  clipboard?: string;
  textContent?: string;
  timestamp: string;
  sourceType?: 'screenshot' | 'clipboard' | 'log' | 'manual';
  sourceMap?: {
    urls?: Record<string, string>;
    [key: string]: any;
  };
}

export interface ExtractionConfig {
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  useLocalExtraction?: boolean;
}

export interface EntityPattern {
  patterns: RegExp[];
  type: EntityType;
  extractName: (match: RegExpMatchArray) => string;
  description?: string;
}

export interface RelationshipPattern {
  patterns: RegExp[];
  type: RelationshipType;
  extractEntities: (match: RegExpMatchArray) => { source: string; target: string };
  description?: string;
}

export interface ExtractedPrinciple {
  title: string;
  content: string;
  type: string;
  isCore: boolean;
  version: number;
}

export interface GraphRAGOutput {
  entities: Entity[];
  relationships: Relationship[];
  principles: ExtractedPrinciple[];
  suspicious?: string[];
}

const ENTITY_PATTERNS: EntityPattern[] = [
  {
    patterns: [
      /class\s+([A-Z][a-zA-Z0-9_]*)/g,
      /interface\s+([A-Z][a-zA-Z0-9_]*)/g,
      /type\s+([A-Z][a-zA-Z0-9_]*)/g,
    ],
    type: 'code_snippet',
    extractName: (match) => match[1],
    description: '代码类型定义'
  },
  {
    patterns: [
      /function\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      /const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g,
      /def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    ],
    type: 'code_snippet',
    extractName: (match) => match[1],
    description: '函数或变量定义'
  },
  {
    patterns: [
      /@([a-zA-Z_][a-zA-Z0-9_]*)/g,
    ],
    type: 'person',
    extractName: (match) => match[1],
    description: '用户提及'
  },
  {
    patterns: [
      /project[:\s]+([a-zA-Z0-9_-]+)/gi,
      /repo[:\s]+([a-zA-Z0-9_-]+)/gi,
    ],
    type: 'project',
    extractName: (match) => match[1],
    description: '项目名称'
  },
  {
    patterns: [
      /principle[:\s]+([^.!\n]+)/gi,
      /rule[:\s]+([^.!\n]+)/gi,
    ],
    type: 'principle',
    extractName: (match) => match[1].trim(),
    description: '原则或规则'
  },
  {
    patterns: [
      /tool[:\s]+([a-zA-Z0-9_-]+)/gi,
      /using\s+([a-zA-Z0-9_-]+)/gi,
    ],
    type: 'tool',
    extractName: (match) => match[1],
    description: '工具或库'
  },
  {
    patterns: [
      /concept[:\s]+([a-zA-Z0-9_\s]+)/gi,
      /idea[:\s]+([a-zA-Z0-9_\s]+)/gi,
    ],
    type: 'concept',
    extractName: (match) => match[1].trim(),
    description: '概念或想法'
  }
];

const RELATIONSHIP_PATTERNS: RelationshipPattern[] = [
  {
    patterns: [
      /([a-zA-Z_][a-zA-Z0-9_]*)\s+extends\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      /([a-zA-Z_][a-zA-Z0-9_]*)\s+implements\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    ],
    type: 'extends',
    extractEntities: (match) => ({ source: match[1], target: match[2] }),
    description: '继承或实现关系'
  },
  {
    patterns: [
      /([a-zA-Z_][a-zA-Z0-9_]*)\s+depends\s+on\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
      /([a-zA-Z_][a-zA-Z0-9_]*)\s+requires\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
      /import\s+.*from\s+['"]([^'"]+)['"]/g,
    ],
    type: 'depends_on',
    extractEntities: (match) => ({ source: match[1], target: match[2] || match[1] }),
    description: '依赖关系'
  },
  {
    patterns: [
      /([a-zA-Z_][a-zA-Z0-9_]*)\s+relates\s+to\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
      /([a-zA-Z_][a-zA-Z0-9_]*)\s+connects\s+with\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
    ],
    type: 'relates_to',
    extractEntities: (match) => ({ source: match[1], target: match[2] }),
    description: '关联关系'
  },
  {
    patterns: [
      /([a-zA-Z_][a-zA-Z0-9_]*)\s+conflicts\s+with\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
      /([a-zA-Z_][a-zA-Z0-9_]*)\s+contradicts\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
    ],
    type: 'conflicts_with',
    extractEntities: (match) => ({ source: match[1], target: match[2] }),
    description: '冲突关系'
  },
  {
    patterns: [
      /([a-zA-Z_][a-zA-Z0-9_]*)\s+derived\s+from\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
      /([a-zA-Z_][a-zA-Z0-9_]*)\s+based\s+on\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
    ],
    type: 'derived_from',
    extractEntities: (match) => ({ source: match[1], target: match[2] }),
    description: '派生关系'
  }
];

const PRINCIPLE_PATTERNS = [
  {
    patterns: [
      /always\s+([^.!\n]+)/gi,
      /never\s+([^.!\n]+)/gi,
      /should\s+([^.!\n]+)/gi,
      /must\s+([^.!\n]+)/gi,
    ],
    type: 'code_principle' as const
  },
  {
    patterns: [
      /security[:\s]+([^.!\n]+)/gi,
      /vulnerability[:\s]+([^.!\n]+)/gi,
      /protect\s+([^.!\n]+)/gi,
    ],
    type: 'security_rule' as const
  },
  {
    patterns: [
      /performance[:\s]+([^.!\n]+)/gi,
      /optimize\s+([^.!\n]+)/gi,
      /efficient\s+([^.!\n]+)/gi,
    ],
    type: 'performance_optimization' as const
  },
  {
    patterns: [
      /pattern[:\s]+([^.!\n]+)/gi,
      /design\s+pattern[:\s]+([^.!\n]+)/gi,
    ],
    type: 'design_pattern' as const
  },
  {
    patterns: [
      /workflow[:\s]+([^.!\n]+)/gi,
      /process[:\s]+([^.!\n]+)/gi,
      /procedure[:\s]+([^.!\n]+)/gi,
    ],
    type: 'workflow_rule' as const
  },
  {
    patterns: [
      /prefer\s+([^.!\n]+)/gi,
      /like\s+([^.!\n]+)/gi,
      /my\s+([^.!\n]+)/gi,
    ],
    type: 'personal_preference' as const
  }
];

const VALID_ENTITY_TYPES: Set<EntityType> = new Set([
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
]);

const VALID_RELATIONSHIP_TYPES: Set<RelationshipType> = new Set([
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
  'works_at',
  'lives_in',
  'studies_at',
  'married_to',
  'leads_to_conclusion',
]);

const ENTITY_CACHE_LIMIT = 5_000;

function trimMapToLimit<K, V>(map: Map<K, V>, limit: number) {
  if (map.size <= limit) return;
  const overflow = map.size - Math.floor(limit / 2);
  const iter = map.keys();
  for (let i = 0; i < overflow; i++) {
    const next = iter.next();
    if (next.done) break;
    map.delete(next.value);
  }
}

export class GraphRAGExtractor {
  private config: ExtractionConfig;
  private entityCache: Map<string, Entity>;
  private relationshipCache: Map<string, Relationship>;
  private llmPipeline: LLMExtractorPipeline;
  // 复用 OCR 管道：worker 懒创建后常驻，避免每张截图重新加载 wasm/语言包
  private ocrPipeline: OCRPipeline | null = null;

  constructor(config: ExtractionConfig = {}) {
    this.config = config;
    this.entityCache = new Map();
    this.relationshipCache = new Map();
    // [核心壁垒] LLM 提取管道
    this.llmPipeline = new LLMExtractorPipeline({
      apiUrl: config.llmBaseUrl || process.env.LLM_API_URL || 'http://localhost:11434/v1',
      apiKey: config.llmApiKey || process.env.LLM_API_KEY,
      model: config.llmModel || process.env.LLM_MODEL || 'qwen2.5:7b',
    });
  }

  async extract(input: ExtractionInput): Promise<GraphRAGOutput> {
    const textContent = await this.combineInputs(input);
    const { cleaned, suspicious } = sanitizeForExtraction(textContent);
    
    // 第一层：正则提取（快速，确定性高）
    const entities = await this.extractEntities(cleaned, input);
    const relationships = await this.extractRelationships(cleaned, entities);
    const principles = await this.extractPrinciples(cleaned, input);

    // 第二层：LLM 语义提取（深度理解，补充正则的盲区）
    if (this.llmPipeline.isEnabled() && !this.config.useLocalExtraction) {
      try {
        const llmResult = await this.llmPipeline.extract(cleaned);
        const llmEntities = Array.isArray(llmResult.entities) ? llmResult.entities : [];
        const llmFacts = Array.isArray(llmResult.facts) ? llmResult.facts : [];
        const llmPrinciples = Array.isArray(llmResult.principles) ? llmResult.principles : [];
        const now = new Date().toISOString();
        const seenNames = new Set(entities.map(e => e.name.toLowerCase()));

        // 合并 LLM 提取的实体（去重 + 类型白名单）
        for (const llmEntity of llmEntities) {
          const lowerName = llmEntity.name?.toLowerCase();
          if (!lowerName || seenNames.has(lowerName)) continue;
          const candidateType = llmEntity.type as EntityType;
          // LLM 偶尔会编造没见过的 type，落库前先白名单过滤，
          // 否则后续按 type 查询、统计、UI 颜色映射都会出现脏值
          const safeType: EntityType = VALID_ENTITY_TYPES.has(candidateType)
            ? candidateType
            : 'concept';
          seenNames.add(lowerName);
          const entity: Entity = {
            id: uuidv4(),
            name: llmEntity.name,
            type: safeType,
            description: llmEntity.description,
            created_at: now,
            updated_at: now,
            last_accessed: now,
            access_count: 0,
            tags: ['llm-extracted'],
            metadata: {
              source: 'llm',
              model: this.config.llmModel,
              importance: clamp01(llmEntity.importance ?? (DEFAULT_IMPORTANCE_MAP[safeType] || 0.5)),
              ...(safeType !== candidateType ? { originalType: candidateType } : {}),
            },
          };
          entities.push(entity);
          this.entityCache.set(lowerName, entity);
        }
        trimMapToLimit(this.entityCache, ENTITY_CACHE_LIMIT);

        // [核心壁垒] 合并 LLM 提取的 Fact 事实（映射到 Relationships 表中，Confidence 对应 Weight，SourceSpan 对应 Description，且类型走白名单）
        const entityMap = new Map(entities.map(e => [e.name.toLowerCase(), e]));
        const seenRels = new Set(relationships.map(r => `${r.source_id}-${r.type}-${r.target_id}`));
        for (const fact of llmFacts) {
          const src = entityMap.get(fact.subject?.toLowerCase());
          const tgt = entityMap.get(fact.object?.toLowerCase());
          if (!src || !tgt) continue;
          const candidateType = fact.predicate as RelationshipType;
          const safeType: RelationshipType = VALID_RELATIONSHIP_TYPES.has(candidateType)
            ? candidateType
            : 'relates_to';
          const key = `${src.id}-${safeType}-${tgt.id}`;
          if (seenRels.has(key)) continue;
          seenRels.add(key);
          relationships.push({
            id: uuidv4(),
            source_id: src.id,
            target_id: tgt.id,
            type: safeType,
            description: fact.source_span || '',
            weight: typeof fact.confidence === 'number' ? fact.confidence : 1.0,
            created_at: now,
            last_activated: now,
            valid_from: fact.valid_from || fact.event_time || now,
            valid_until: fact.valid_until,
            observed_at: fact.observed_at,
            event_time: fact.event_time,
            temporal_confidence: fact.temporal_confidence,
            temporal_source: fact.temporal_source,
            timezone: fact.timezone,
            provenance: {
              extractor: 'llm',
              model: this.config.llmModel,
            },
          });
        }

        // 合并 LLM 提取的原则
        const seenPrinciples = new Set(principles.map(p => p.content.toLowerCase()));
        for (const llmP of llmPrinciples) {
          if (!seenPrinciples.has(llmP.content.toLowerCase())) {
            principles.push({
              title: llmP.title,
              content: llmP.content,
              type: llmP.type || 'code_principle',
              isCore: llmP.isCore || false,
              version: 1,
            });
          }
        }
      } catch (e) {
        // LLM 提取失败不影响主流程
        console.warn('[GraphRAGExtractor] LLM 提取失败，仅使用正则结果:', e);
      }
    }

    // 记录 suspicious 到实体的 metadata 中
    if (suspicious.length > 0) {
      for (const entity of entities) {
        if (!entity.metadata) {
          entity.metadata = {};
        }
        entity.metadata.suspicious_patterns = suspicious;
      }
    }

    // 后处理：URL 短缩反查还原
    if (input.sourceMap?.urls) {
      const urls = input.sourceMap.urls;
      for (const entity of entities) {
        for (const [short, long] of Object.entries(urls)) {
          if (entity.name === short) {
            entity.name = this.extractDomain(long) || long;
            if (entity.metadata) {
              entity.metadata.url = long;
            }
          } else if (entity.name.includes(short)) {
            entity.name = entity.name.replaceAll(short, long);
          }
          
          if (entity.description) {
            entity.description = entity.description.replaceAll(short, long);
          }
          
          if (entity.metadata?.url === short) {
            entity.metadata.url = long;
          }
        }
      }

      for (const rel of relationships) {
        if (rel.description) {
          for (const [short, long] of Object.entries(urls)) {
            rel.description = rel.description.replaceAll(short, long);
          }
        }
      }

      for (const p of principles) {
        for (const [short, long] of Object.entries(urls)) {
          p.title = p.title.replaceAll(short, long);
          p.content = p.content.replaceAll(short, long);
        }
      }
    }

    return {
      entities,
      relationships,
      principles,
      ...(suspicious.length > 0 ? { suspicious } : {}),
    };
  }

  private async combineInputs(input: ExtractionInput): Promise<string> {
    const parts: string[] = [];

    if (input.textContent) {
      parts.push(input.textContent);
    }

    if (input.clipboard) {
      parts.push(`[Clipboard]\n${input.clipboard}`);
    }

    if (input.screenshot) {
      try {
        const normalized = input.screenshot.startsWith('data:')
          ? input.screenshot
          : `data:image/png;base64,${input.screenshot}`;

        // 复用常驻 OCR 实例（worker 懒创建后保留），不再每张截图 new + dispose
        const ocr = (this.ocrPipeline ??= new OCRPipeline());
        const ocrPromise = ocr.extractText(normalized);
        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 10_000);
        });
        const result = await Promise.race([ocrPromise, timeoutPromise]);

        if (result && result.text.trim()) {
          console.log(`[Extract] OCR identified ${result.text.length} characters from screenshot`);
          parts.push(`[Screenshot OCR]\n${result.text}`);
        } else {
          parts.push('[Screenshot OCR failed]');
        }
      } catch (e) {
        console.warn('[Extract] OCR failed, falling back:', e);
        parts.push('[Screenshot OCR failed]');
      }
    }

    return parts.join('\n\n');
  }

  private async extractEntities(text: string, input: ExtractionInput): Promise<Entity[]> {
    const entities: Entity[] = [];
    const seenNames = new Set<string>();
    const now = new Date().toISOString();

    for (const pattern of ENTITY_PATTERNS) {
      for (const regex of pattern.patterns) {
        let match;
        const globalRegex = new RegExp(regex.source, regex.flags);
        
        while ((match = globalRegex.exec(text)) !== null) {
          const name = pattern.extractName(match);
          
          if (name && !seenNames.has(name.toLowerCase())) {
            seenNames.add(name.toLowerCase());
            
            const entity: Entity = {
              id: uuidv4(),
              name,
              type: pattern.type,
              description: pattern.description || `从内容中提取的${pattern.type}`,
              created_at: now,
              updated_at: now,
              last_accessed: now,
              access_count: 0,
              tags: ['auto-extracted'],
              metadata: {
                source: input.sourceType || 'manual',
                timestamp: input.timestamp,
                importance: DEFAULT_IMPORTANCE_MAP[pattern.type] || 0.5,
              }
            };
            
            entities.push(entity);
            this.entityCache.set(name.toLowerCase(), entity);
          }
        }
      }
    }

    const additionalEntities = await this.extractSemanticEntities(text, input);
    for (const entity of additionalEntities) {
      if (!seenNames.has(entity.name.toLowerCase())) {
        seenNames.add(entity.name.toLowerCase());
        entities.push(entity);
      }
    }

    trimMapToLimit(this.entityCache, ENTITY_CACHE_LIMIT);
    return entities;
  }

  private async extractSemanticEntities(text: string, input: ExtractionInput): Promise<Entity[]> {
    const entities: Entity[] = [];
    const now = new Date().toISOString();

    // 如果提供了 sourceMap.urls，优先从中抽取实体
    if (input.sourceMap?.urls) {
      for (const [short, long] of Object.entries(input.sourceMap.urls)) {
        if (text.includes(short)) {
          const domain = this.extractDomain(long);
          if (domain) {
            entities.push({
              id: uuidv4(),
              name: domain,
              type: 'tool',
              description: `网站或服务: ${long}`,
              created_at: now,
              updated_at: now,
              last_accessed: now,
              access_count: 0,
              tags: ['url', 'web'],
              metadata: {
                url: long,
                importance: DEFAULT_IMPORTANCE_MAP['tool'] || 0.5,
              }
            });
          }
        }
      }
    }

    const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
    let urlMatch;
    while ((urlMatch = urlPattern.exec(text)) !== null) {
      const url = urlMatch[0];
      const domain = this.extractDomain(url);
      
      if (domain) {
        entities.push({
          id: uuidv4(),
          name: domain,
          type: 'tool',
          description: `网站或服务: ${url}`,
          created_at: now,
          updated_at: now,
          last_accessed: now,
          access_count: 0,
          tags: ['url', 'web'],
          metadata: {
            url,
            importance: DEFAULT_IMPORTANCE_MAP['tool'] || 0.5,
          }
        });
      }
    }

    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    let emailMatch;
    while ((emailMatch = emailPattern.exec(text)) !== null) {
      entities.push({
        id: uuidv4(),
        name: emailMatch[0],
        type: 'person',
        description: `邮箱地址`,
        created_at: now,
        updated_at: now,
        last_accessed: now,
        access_count: 0,
        tags: ['email'],
        metadata: {
          importance: DEFAULT_IMPORTANCE_MAP['person'] || 0.5,
        }
      });
    }

    // 版本号识别：要求前面有 version / v / @ 这类语义提示，
    // 否则 "git checkout 1.2.3" / "192.168.0.1" 会被错误抽成实体
    const versionPattern = /(?:^|[\s(=])(?:version[:\s]+|v(?=\d)|@)(\d+\.\d+(?:\.\d+)?)/gi;
    let versionMatch;
    const seenVersions = new Set<string>();
    while ((versionMatch = versionPattern.exec(text)) !== null) {
      const ver = versionMatch[1];
      if (seenVersions.has(ver)) continue;
      seenVersions.add(ver);
      entities.push({
        id: uuidv4(),
        name: `version-${ver}`,
        type: 'concept',
        description: `版本号: ${ver}`,
        created_at: now,
        updated_at: now,
        last_accessed: now,
        access_count: 0,
        tags: ['version'],
        metadata: {
          importance: DEFAULT_IMPORTANCE_MAP['concept'] || 0.5,
        }
      });
    }

    return entities;
  }

  private extractDomain(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return null;
    }
  }

  private async extractRelationships(text: string, entities: Entity[]): Promise<Relationship[]> {
    const relationships: Relationship[] = [];
    const entityMap = new Map(entities.map(e => [e.name.toLowerCase(), e]));
    const now = new Date().toISOString();
    const seenRelationships = new Set<string>();

    for (const pattern of RELATIONSHIP_PATTERNS) {
      for (const regex of pattern.patterns) {
        let match;
        const globalRegex = new RegExp(regex.source, regex.flags);
        
        while ((match = globalRegex.exec(text)) !== null) {
          try {
            const { source, target } = pattern.extractEntities(match);
            const sourceEntity = entityMap.get(source.toLowerCase());
            const targetEntity = entityMap.get(target.toLowerCase());
            
            if (sourceEntity && targetEntity && sourceEntity.id !== targetEntity.id) {
              const relKey = `${sourceEntity.id}-${pattern.type}-${targetEntity.id}`;
              
              if (!seenRelationships.has(relKey)) {
                seenRelationships.add(relKey);
                
                relationships.push({
                  id: uuidv4(),
                  source_id: sourceEntity.id,
                  target_id: targetEntity.id,
                  type: pattern.type,
                  description: pattern.description,
                  weight: 1.0,
                  created_at: now,
                  last_activated: now,
                  valid_from: now,
                });
              }
            }
          } catch {
            continue;
          }
        }
      }
    }

    const inferredRelationships = this.inferRelationships(entities);
    for (const rel of inferredRelationships) {
      const relKey = `${rel.source_id}-${rel.type}-${rel.target_id}`;
      if (!seenRelationships.has(relKey)) {
        seenRelationships.add(relKey);
        relationships.push(rel);
      }
    }

    return relationships;
  }

  private inferRelationships(entities: Entity[]): Relationship[] {
    const relationships: Relationship[] = [];
    const now = new Date().toISOString();

    // 子串匹配会让短名（如 "API"、"db"）跟所有实体都互相连接，制造垃圾边。
    // 加入最小长度门槛 + 全词边界匹配，过滤明显的噪音组合。
    const MIN_LEN = 4;
    const isMeaningful = (name: string) =>
      name && name.length >= MIN_LEN && !/^(the|and|for|with|api|app|db|js|ts)$/i.test(name);

    const wordBoundary = (haystack: string, needle: string) => {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
    };

    const codeEntities = entities.filter(e => e.type === 'code_snippet');
    const projectEntities = entities.filter(e => e.type === 'project');

    for (const project of projectEntities) {
      if (!isMeaningful(project.name)) continue;
      for (const code of codeEntities) {
        if (wordBoundary(code.name, project.name)) {
          relationships.push({
            id: uuidv4(),
            source_id: code.id,
            target_id: project.id,
            type: 'belongs_to',
            description: '代码属于项目',
            weight: 0.8,
            created_at: now,
            last_activated: now,
            valid_from: now,
          });
        }
      }
    }

    const principles = entities.filter(e => e.type === 'principle');
    const concepts = entities.filter(e => e.type === 'concept');

    for (const concept of concepts) {
      if (!isMeaningful(concept.name)) continue;
      for (const principle of principles) {
        if (wordBoundary(principle.name, concept.name)) {
          relationships.push({
            id: uuidv4(),
            source_id: principle.id,
            target_id: concept.id,
            type: 'relates_to',
            description: '原则与概念相关',
            weight: 0.6,
            created_at: now,
            last_activated: now,
            valid_from: now,
          });
        }
      }
    }

    return relationships;
  }

  private async extractPrinciples(text: string, input: ExtractionInput): Promise<ExtractedPrinciple[]> {
    const principles: ExtractedPrinciple[] = [];

    for (const patternGroup of PRINCIPLE_PATTERNS) {
      for (const pattern of patternGroup.patterns) {
        let match;
        const globalRegex = new RegExp(pattern.source, pattern.flags);
        
        while ((match = globalRegex.exec(text)) !== null) {
          const content = match[1].trim();
          
          if (content.length > 10 && content.length < 500) {
            const title = this.generatePrincipleTitle(content, patternGroup.type);
            principles.push({
              title,
              content,
              type: patternGroup.type,
              isCore: false,
              version: 1,
            });
          }
        }
      }
    }

    const deduplicatedPrinciples = this.deduplicatePrinciples(principles);
    
    return deduplicatedPrinciples;
  }

  private generatePrincipleTitle(content: string, type: string): string {
    const words = content.split(/\s+/).slice(0, 5);
    const title = words.join(' ');
    
    const typeNames: Record<string, string> = {
      'code_principle': '代码原则',
      'security_rule': '安全规则',
      'performance_optimization': '性能优化',
      'design_pattern': '设计模式',
      'workflow_rule': '工作流规则',
      'personal_preference': '个人偏好',
    };
    
    return `[${typeNames[type] || '原则'}] ${title}...`;
  }

  private deduplicatePrinciples(principles: ExtractedPrinciple[]): ExtractedPrinciple[] {
    const seen = new Map<string, ExtractedPrinciple>();
    
    for (const principle of principles) {
      const key = principle.content.toLowerCase().trim();
      
      if (!seen.has(key)) {
        seen.set(key, principle);
      }
    }
    
    return Array.from(seen.values());
  }

  async summarizeEntities(entities: Entity[]): Promise<string> {
    const typeGroups = new Map<EntityType, Entity[]>();
    
    for (const entity of entities) {
      const group = typeGroups.get(entity.type) || [];
      group.push(entity);
      typeGroups.set(entity.type, group);
    }

    const summaryParts: string[] = [];
    
    for (const [type, group] of typeGroups) {
      const names = group.map(e => e.name).join(', ');
      summaryParts.push(`${type}: ${names}`);
    }

    return summaryParts.join('\n');
  }

  async setLlmConfig(config: { apiUrl: string; apiKey?: string; model: string }): Promise<boolean> {
    this.config.llmBaseUrl = config.apiUrl;
    this.config.llmApiKey = config.apiKey;
    this.config.llmModel = config.model;

    this.llmPipeline.setConfig({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      model: config.model,
    });

    const healthy = await this.llmPipeline.healthCheck();
    this.llmPipeline.setEnabled(healthy);
    if (!healthy) this.llmPipeline.scheduleHealthRecheck();
    return healthy;
  }

  getLlmConfig(): { apiUrl: string; apiKey: string; model: string } {
    return {
      apiUrl: this.config.llmBaseUrl || process.env.LLM_API_URL || 'http://localhost:11434/v1',
      apiKey: this.config.llmApiKey || process.env.LLM_API_KEY || '',
      model: this.config.llmModel || process.env.LLM_MODEL || 'qwen2.5:7b',
    };
  }

  isLlmEnabled(): boolean {
    return this.llmPipeline.isEnabled();
  }

  clearCache(): void {
    this.entityCache.clear();
    this.relationshipCache.clear();
  }
}

export default GraphRAGExtractor;
