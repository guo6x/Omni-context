import { v4 as uuidv4 } from 'uuid';
import { Entity, Relationship, EntityType, RelationshipType } from '../shared-types.js';

export interface ExtractionInput {
  screenshot?: string;
  clipboard?: string;
  textContent?: string;
  timestamp: string;
  sourceType?: 'screenshot' | 'clipboard' | 'log' | 'manual';
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

export class GraphRAGExtractor {
  private config: ExtractionConfig;
  private entityCache: Map<string, Entity>;
  private relationshipCache: Map<string, Relationship>;

  constructor(config: ExtractionConfig = {}) {
    this.config = config;
    this.entityCache = new Map();
    this.relationshipCache = new Map();
  }

  async extract(input: ExtractionInput): Promise<GraphRAGOutput> {
    const textContent = this.combineInputs(input);
    
    const entities = await this.extractEntities(textContent, input);
    const relationships = await this.extractRelationships(textContent, entities);
    const principles = await this.extractPrinciples(textContent, input);

    return {
      entities,
      relationships,
      principles,
    };
  }

  private combineInputs(input: ExtractionInput): string {
    const parts: string[] = [];
    
    if (input.textContent) {
      parts.push(input.textContent);
    }
    
    if (input.clipboard) {
      parts.push(`[Clipboard]\n${input.clipboard}`);
    }
    
    if (input.screenshot) {
      parts.push(`[Screenshot available]`);
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

    return entities;
  }

  private async extractSemanticEntities(text: string, input: ExtractionInput): Promise<Entity[]> {
    const entities: Entity[] = [];
    const now = new Date().toISOString();

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
          metadata: { url }
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
      });
    }

    const versionPattern = /v?\d+\.\d+\.\d+/g;
    let versionMatch;
    while ((versionMatch = versionPattern.exec(text)) !== null) {
      entities.push({
        id: uuidv4(),
        name: `version-${versionMatch[0]}`,
        type: 'concept',
        description: `版本号: ${versionMatch[0]}`,
        created_at: now,
        updated_at: now,
        last_accessed: now,
        access_count: 0,
        tags: ['version'],
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

    const codeEntities = entities.filter(e => e.type === 'code_snippet');
    const projectEntities = entities.filter(e => e.type === 'project');
    
    for (const project of projectEntities) {
      for (const code of codeEntities) {
        if (code.name.toLowerCase().includes(project.name.toLowerCase())) {
          relationships.push({
            id: uuidv4(),
            source_id: code.id,
            target_id: project.id,
            type: 'belongs_to',
            description: '代码属于项目',
            weight: 0.8,
            created_at: now,
            last_activated: now,
          });
        }
      }
    }

    const principles = entities.filter(e => e.type === 'principle');
    const concepts = entities.filter(e => e.type === 'concept');
    
    for (const principle of principles) {
      for (const concept of concepts) {
        if (principle.name.toLowerCase().includes(concept.name.toLowerCase())) {
          relationships.push({
            id: uuidv4(),
            source_id: principle.id,
            target_id: concept.id,
            type: 'relates_to',
            description: '原则与概念相关',
            weight: 0.6,
            created_at: now,
            last_activated: now,
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

  clearCache(): void {
    this.entityCache.clear();
    this.relationshipCache.clear();
  }
}

export default GraphRAGExtractor;
