import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { CoreMemory } from '../src/memory/core-memory.js';
import { ArchivalMemory } from '../src/memory/archival-memory.js';
import { GraphRAGExtractor } from '../src/graphrag/extractor.js';
import { resolveConflicts } from '../src/graphrag/conflict-resolver.js';
import { toCompactEntity } from '../src/mcp-server.js';
import { resolveEntities, normalizeName } from '../src/graphrag/entity-resolver.js';

describe('Database', () => {
  let db: Database;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Entity Operations', () => {
    it('should add an entity', async () => {
      const entity = await db.addEntity({
        name: 'TestEntity',
        type: 'concept',
        description: 'A test entity',
        tags: ['test'],
      });

      expect(entity.id).toBeDefined();
      expect(entity.name).toBe('TestEntity');
      expect(entity.type).toBe('concept');
    });

    it('should get an entity by id', async () => {
      const created = await db.addEntity({
        name: 'TestEntity2',
        type: 'tool',
      });

      const found = await db.getEntity(created.id);
      expect(found).not.toBeNull();
      expect(found?.name).toBe('TestEntity2');
    });

    it('should get entities by type', async () => {
      await db.addEntity({ name: 'Concept1', type: 'concept' });
      await db.addEntity({ name: 'Concept2', type: 'concept' });

      const entities = await db.getEntitiesByType('concept');
      expect(entities.length).toBeGreaterThan(0);
      expect(entities.every(e => e.type === 'concept')).toBe(true);
    });

    it('should search entities', async () => {
      await db.addEntity({ name: 'SearchableEntity', type: 'tool', description: 'This is searchable' });

      const results = await db.searchEntities('Searchable');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should update an entity', async () => {
      const entity = await db.addEntity({ name: 'ToUpdate', type: 'concept' });
      await db.updateEntity(entity.id, { description: 'Updated description' });

      const updated = await db.getEntity(entity.id);
      expect(updated?.description).toBe('Updated description');
    });

    it('should delete an entity', async () => {
      const entity = await db.addEntity({ name: 'ToDelete', type: 'concept' });
      await db.deleteEntity(entity.id);

      const found = await db.getEntity(entity.id);
      expect(found).toBeNull();
    });
  });

  describe('Relationship Operations', () => {
    it('should add a relationship', async () => {
      const source = await db.addEntity({ name: 'Source', type: 'concept' });
      const target = await db.addEntity({ name: 'Target', type: 'concept' });

      const relationship = await db.addRelationship({
        source_id: source.id,
        target_id: target.id,
        type: 'relates_to',
        description: 'Test relationship',
      });

      expect(relationship.id).toBeDefined();
      expect(relationship.type).toBe('relates_to');
    });

    it('should get relationships for an entity', async () => {
      const source = await db.addEntity({ name: 'RelSource', type: 'concept' });
      const target = await db.addEntity({ name: 'RelTarget', type: 'concept' });
      await db.addRelationship({
        source_id: source.id,
        target_id: target.id,
        type: 'depends_on',
      });

      const relationships = await db.getRelationshipsForEntity(source.id);
      expect(relationships.length).toBeGreaterThan(0);
    });

    it('should add relationship with temporal fields and support historical query', async () => {
      const source = await db.addEntity({ name: 'TempSource', type: 'concept' });
      const target = await db.addEntity({ name: 'TempTarget', type: 'concept' });

      const validFrom = new Date(Date.now() - 10000).toISOString();
      const relationship = await db.addRelationship({
        source_id: source.id,
        target_id: target.id,
        type: 'relates_to',
        valid_from: validFrom,
      });

      expect(relationship.valid_from).toBe(validFrom);
      expect(relationship.valid_until).toBeUndefined();
      expect(relationship.invalidated_at).toBeUndefined();

      const found = await db.getRelationshipsForEntity(source.id);
      expect(found[0].valid_from).toBe(validFrom);
    });

    it('should invalidate a relationship and exclude it by default', async () => {
      const source = await db.addEntity({ name: 'TempSource2', type: 'concept' });
      const target = await db.addEntity({ name: 'TempTarget2', type: 'concept' });

      const relationship = await db.addRelationship({
        source_id: source.id,
        target_id: target.id,
        type: 'relates_to',
      });

      let found = await db.getRelationshipsForEntity(source.id);
      expect(found.length).toBe(1);

      const validUntil = new Date().toISOString();
      await db.invalidateRelationship(relationship.id, undefined, validUntil);

      found = await db.getRelationshipsForEntity(source.id);
      expect(found.length).toBe(0);

      const allRels = await db.getRelationships();
      expect(allRels.some(r => r.id === relationship.id)).toBe(false);

      found = await db.getRelationshipsForEntity(source.id, true);
      expect(found.length).toBe(1);
      expect(found[0].valid_until).toBe(validUntil);
      expect(found[0].invalidated_at).toBeDefined();

      const allRelsWithHist = await db.getRelationships(200, true);
      expect(allRelsWithHist.some(r => r.id === relationship.id)).toBe(true);
    });
  });

  describe('Principle Operations (as entities of type=principle)', () => {
    it('should store principle as entity', async () => {
      const principle = await db.addEntity({
        name: 'Test Principle',
        type: 'principle',
        description: 'This is a test principle',
        metadata: { isCore: true },
      });

      expect(principle.id).toBeDefined();
      expect(principle.type).toBe('principle');
    });

    it('should list core principles via getCorePrinciples', async () => {
      await db.addEntity({
        name: 'Core Rule',
        type: 'principle',
        description: 'Core',
        metadata: { isCore: true },
      });
      const core = await db.getCorePrinciples();
      expect(core.length).toBeGreaterThan(0);
      expect(core.every(p => p.type === 'principle')).toBe(true);
    });
  });

  describe('Vector Search', () => {
    it('should perform vector search', async () => {
      // sqlite-vec 的 vec0 虚拟表声明为 FLOAT[384]，向量维度必须匹配 schema
      const embedding = Array.from({ length: 384 }, (_, i) => (i % 7) * 0.01);

      await db.addEntity({
        name: 'VectorEntity',
        type: 'concept',
        embedding,
      });

      const results = await db.vectorSearch(embedding, 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].similarity).toBeCloseTo(1.0, 1);
    });
  });
});

describe('CoreMemory', () => {
  let db: Database;
  let coreMemory: CoreMemory;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    coreMemory = new CoreMemory(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('should set and get memory', async () => {
    await coreMemory.set('test-key', { value: 'test' }, 'test');
    const item = await coreMemory.get('test-key');

    expect(item).not.toBeNull();
    expect(item?.value).toEqual({ value: 'test' });
    expect(item?.category).toBe('test');
  });

  it('should get all memory items', async () => {
    await coreMemory.set('key1', 'value1', 'cat1');
    await coreMemory.set('key2', 'value2', 'cat2');

    const items = await coreMemory.getAll();
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it('should get items by category', async () => {
    await coreMemory.set('cat-key1', 'val', 'category-a');
    await coreMemory.set('cat-key2', 'val', 'category-a');
    await coreMemory.set('cat-key3', 'val', 'category-b');

    const items = await coreMemory.getByCategory('category-a');
    expect(items.every(i => i.category === 'category-a')).toBe(true);
  });

  it('should delete memory', async () => {
    await coreMemory.set('to-delete', 'value', 'test');
    await coreMemory.delete('to-delete');

    const item = await coreMemory.get('to-delete');
    expect(item).toBeNull();
  });

  it('should search memory', async () => {
    await coreMemory.set('searchable', { text: 'searchable content' }, 'test');

    const results = await coreMemory.search('searchable');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should get memory stats', async () => {
    await coreMemory.set('stats-key', 'value', 'stats-cat');

    const stats = await coreMemory.getStats();
    expect(stats.totalItems).toBeGreaterThan(0);
  });

  it('should compress memory', async () => {
    const longValue = 'x'.repeat(2000);
    await coreMemory.set('compress-key', longValue, 'test');

    const result = await coreMemory.compress();
    expect(result.itemsProcessed).toBeGreaterThanOrEqual(0);
  });
});

describe('ArchivalMemory', () => {
  let db: Database;
  let archivalMemory: ArchivalMemory;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    archivalMemory = new ArchivalMemory(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('should add archival item', async () => {
    const item = await archivalMemory.add('Test content', {
      tags: ['test', 'archive'],
      importance: 5,
    });

    expect(item.id).toBeDefined();
    expect(item.content).toBe('Test content');
    expect(item.tags).toEqual(['test', 'archive']);
  });

  it('should get archival item', async () => {
    const created = await archivalMemory.add('Content to get');
    const found = await archivalMemory.get(created.id);

    expect(found).not.toBeNull();
    expect(found?.content).toBe('Content to get');
  });

  it('should search archival items', async () => {
    await archivalMemory.add('Unique searchable content here');

    const results = await archivalMemory.search('Unique searchable');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should search by tags', async () => {
    await archivalMemory.add('Tagged content', { tags: ['tag1', 'tag2'] });

    const items = await archivalMemory.searchByTags(['tag1']);
    expect(items.length).toBeGreaterThan(0);
  });

  it('should update archival item', async () => {
    const item = await archivalMemory.add('Original content');
    const updated = await archivalMemory.update(item.id, {
      content: 'Updated content',
      importance: 8,
    });

    expect(updated?.content).toBe('Updated content');
    expect(updated?.importance).toBe(8);
  });

  it('should delete archival item', async () => {
    const item = await archivalMemory.add('To delete');
    const deleted = await archivalMemory.delete(item.id);

    expect(deleted).toBe(true);
    const found = await archivalMemory.get(item.id);
    expect(found).toBeNull();
  });

  it('should get archival summary', async () => {
    await archivalMemory.add('Summary test', { tags: ['summary'] });

    const summary = await archivalMemory.summarize();
    expect(summary.totalItems).toBeGreaterThan(0);
  });
});

describe('GraphRAGExtractor', () => {
  let extractor: GraphRAGExtractor;

  beforeAll(() => {
    extractor = new GraphRAGExtractor();
  });

  it('should extract entities from text', async () => {
    const result = await extractor.extract({
      textContent: 'class UserService { } function processData() { }',
      timestamp: new Date().toISOString(),
    });

    expect(result.entities.length).toBeGreaterThan(0);
  });

  it('should extract relationships', async () => {
    const result = await extractor.extract({
      textContent: 'UserService extends BaseService',
      timestamp: new Date().toISOString(),
    });

    expect(result.relationships.length).toBeGreaterThanOrEqual(0);
  });

  it('should extract principles', async () => {
    const result = await extractor.extract({
      textContent: 'Always validate user input before processing. Never trust external data.',
      timestamp: new Date().toISOString(),
    });

    expect(result.principles.length).toBeGreaterThan(0);
  });

  it('should extract URLs as entities', async () => {
    const result = await extractor.extract({
      textContent: 'Visit https://example.com for more info',
      timestamp: new Date().toISOString(),
    });

    const urlEntity = result.entities.find(e => e.type === 'tool' && e.name.includes('example.com'));
    expect(urlEntity).toBeDefined();
  });

  it('should summarize entities', async () => {
    const result = await extractor.extract({
      textContent: 'class Test { } function hello() { }',
      timestamp: new Date().toISOString(),
    });

    const summary = await extractor.summarizeEntities(result.entities);
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('should handle empty input', async () => {
    const result = await extractor.extract({
      textContent: '',
      timestamp: new Date().toISOString(),
    });

    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
    expect(result.principles).toEqual([]);
  });
});

describe('Conflict Resolution', () => {
  let db: Database;
  let extractor: GraphRAGExtractor;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    extractor = new GraphRAGExtractor();
    
    // 设置环境变量，使得 LLM 判定被激活
    process.env.LLM_API_URL = 'http://localhost:11434/v1';
  });

  afterAll(async () => {
    await db.close();
  });

  it('should handle superseded status: invalidate old relationship', async () => {
    // 准备测试实体
    const source = await db.addEntity({ name: 'ProjectX', type: 'project' });
    const target = await db.addEntity({ name: 'Architecture', type: 'concept' });

    // 添加旧关系
    const oldRel = await db.addRelationship({
      source_id: source.id,
      target_id: target.id,
      type: 'uses',
      description: '选用方案A开发',
      weight: 1.0,
    });

    // 新增一条候选关系（目前还未入库，仅传入 resolveConflicts 进行消解判断）
    const newRel = {
      id: 'new-rel-uuid',
      source_id: source.id,
      target_id: target.id,
      type: 'uses',
      description: '选用方案B开发，方案A已废弃',
      weight: 1.0,
      created_at: new Date().toISOString(),
      last_activated: new Date().toISOString(),
      valid_from: new Date().toISOString(),
    };

    // Mock fetch 返回 superseded 决策
    vi.stubGlobal('fetch', async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  resolutions: [
                    {
                      oldRelationshipId: oldRel.id,
                      status: 'superseded',
                    },
                  ],
                }),
              },
            },
          ],
        }),
      } as any;
    });

    try {
      await resolveConflicts([newRel], db, extractor);

      // 验证旧关系是否已失效
      const activeRels = await db.getRelationshipsForEntity(source.id, false);
      // 应该查不到了
      expect(activeRels.some(r => r.id === oldRel.id)).toBe(false);

      // 包含历史记录时应该能查到
      const allRels = await db.getRelationshipsForEntity(source.id, true);
      const foundOld = allRels.find(r => r.id === oldRel.id);
      expect(foundOld).toBeDefined();
      expect(foundOld?.valid_until).toBeDefined();
      expect(foundOld?.invalidated_at).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('should handle conflict status: generate conflicts_with relationship', async () => {
    const source = await db.addEntity({ name: 'ProjectY', type: 'project' });
    const target = await db.addEntity({ name: 'Framework', type: 'concept' });

    const oldRel = await db.addRelationship({
      source_id: source.id,
      target_id: target.id,
      type: 'uses',
      description: '开发必须使用 TailwindCSS',
      weight: 1.0,
    });

    const newRel = {
      id: 'new-rel-uuid-2',
      source_id: source.id,
      target_id: target.id,
      type: 'uses',
      description: '开发必须使用 Vanilla CSS',
      weight: 1.0,
      created_at: new Date().toISOString(),
      last_activated: new Date().toISOString(),
      valid_from: new Date().toISOString(),
    };

    // Mock fetch 返回 conflict 决策
    vi.stubGlobal('fetch', async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  resolutions: [
                    {
                      oldRelationshipId: oldRel.id,
                      status: 'conflict',
                    },
                  ],
                }),
              },
            },
          ],
        }),
      } as any;
    });

    try {
      await resolveConflicts([newRel], db, extractor);

      // 验证是否生成了 conflicts_with 关系
      const activeRels = await db.getRelationshipsForEntity(source.id, false);
      const conflictRel = activeRels.find(r => r.type === 'conflicts_with');
      expect(conflictRel).toBeDefined();
      expect(conflictRel?.source_id).toBe(source.id);
      expect(conflictRel?.target_id).toBe(target.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('should handle independent status: do nothing', async () => {
    const source = await db.addEntity({ name: 'ProjectZ', type: 'project' });
    const target = await db.addEntity({ name: 'Author', type: 'concept' });

    const oldRel = await db.addRelationship({
      source_id: source.id,
      target_id: target.id,
      type: 'created_by',
      description: '项目创作者是 Alice',
      weight: 1.0,
    });

    const newRel = {
      id: 'new-rel-uuid-3',
      source_id: source.id,
      target_id: target.id,
      type: 'maintained_by',
      description: '项目维护者是 Bob',
      weight: 1.0,
      created_at: new Date().toISOString(),
      last_activated: new Date().toISOString(),
      valid_from: new Date().toISOString(),
    };

    vi.stubGlobal('fetch', async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  resolutions: [
                    {
                      oldRelationshipId: oldRel.id,
                      status: 'independent',
                    },
                  ],
                }),
              },
            },
          ],
        }),
      } as any;
    });

    try {
      await resolveConflicts([newRel], db, extractor);

      // 验证旧关系仍有效
      const activeRels = await db.getRelationshipsForEntity(source.id, false);
      const foundOld = activeRels.find(r => r.id === oldRel.id);
      expect(foundOld).toBeDefined();
      expect(foundOld?.valid_until).toBeUndefined();

      // 验证没有生成 conflicts_with
      const conflictRel = activeRels.find(r => r.type === 'conflicts_with');
      expect(conflictRel).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('should gracefully degrade when LLM is unavailable', async () => {
    const source = await db.addEntity({ name: 'ProjectW', type: 'project' });
    const target = await db.addEntity({ name: 'Database', type: 'concept' });

    const oldRel = await db.addRelationship({
      source_id: source.id,
      target_id: target.id,
      type: 'uses',
      description: 'MySQL',
      weight: 1.0,
    });

    const newRel = {
      id: 'new-rel-uuid-4',
      source_id: source.id,
      target_id: target.id,
      type: 'uses',
      description: 'PostgreSQL',
      weight: 1.0,
      created_at: new Date().toISOString(),
      last_activated: new Date().toISOString(),
      valid_from: new Date().toISOString(),
    };

    // Mock fetch 请求超时/报错
    vi.stubGlobal('fetch', async () => {
      throw new Error('Connection timeout');
    });

    try {
      // 应该优雅通过，不抛出异常
      await expect(resolveConflicts([newRel], db, extractor)).resolves.not.toThrow();

      // 验证旧关系依然有效
      const activeRels = await db.getRelationshipsForEntity(source.id, false);
      const foundOld = activeRels.find(r => r.id === oldRel.id);
      expect(foundOld).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('toCompactEntity', () => {
  it('should retain basic fields and discard embedding and metadata', () => {
    const original = {
      id: 'entity-1',
      name: 'Test Name',
      type: 'concept',
      tags: ['tag1'],
      created_at: '2026-05-21T00:00:00Z',
      access_count: 5,
      embedding: Array.from({ length: 384 }, () => 0.1),
      metadata: { isCore: true, detail: 'some metadata' },
      description: 'Simple description',
      similarity: 0.95,
    };

    const compacted = toCompactEntity(original);

    expect(compacted.id).toBe('entity-1');
    expect(compacted.name).toBe('Test Name');
    expect(compacted.type).toBe('concept');
    expect(compacted.tags).toEqual(['tag1']);
    expect(compacted.created_at).toBe('2026-05-21T00:00:00Z');
    expect(compacted.access_count).toBe(5);
    expect(compacted.description).toBe('Simple description');
    expect(compacted.similarity).toBe(0.95);

    expect(compacted.embedding).toBeUndefined();
    expect(compacted.metadata).toBeUndefined();
  });

  it('should truncate description if it exceeds 200 characters', () => {
    const longDesc = 'a'.repeat(250);
    const original = {
      id: 'entity-2',
      name: 'Long Description Entity',
      type: 'concept',
      description: longDesc,
    };

    const compacted = toCompactEntity(original);

    expect(compacted.description.length).toBe(203); // 200 chars + '...'
    expect(compacted.description.endsWith('...')).toBe(true);
    expect(compacted.description.substring(0, 200)).toBe('a'.repeat(200));
  });

  it('should handle entity without description or similarity gracefully', () => {
    const original = {
      id: 'entity-3',
      name: 'Minimal Entity',
      type: 'concept',
    };

    const compacted = toCompactEntity(original);

    expect(compacted.id).toBe('entity-3');
    expect(compacted.name).toBe('Minimal Entity');
    expect(compacted.type).toBe('concept');
    expect(compacted.description).toBeUndefined();
    expect(compacted.similarity).toBeUndefined();
  });
});

describe('Entity Resolution & Remapping', () => {
  let db: Database;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  it('should normalize entity names correctly', () => {
    expect(normalizeName('  SQLite  ')).toBe('sqlite');
    expect(normalizeName('Brain   Server')).toBe('brain server');
    expect(normalizeName('brain\nserver')).toBe('brain server');
  });

  it('should resolve entities in-batch (batch folding)', async () => {
    const rawEntities: any[] = [
      { id: '1', name: '  Brain  Server ', type: 'tool', description: 'A server component' },
      { id: '2', name: 'brain server', type: 'tool', tags: ['ts'] },
      { id: '3', name: 'brain server', type: 'concept', description: 'A concept name' },
    ];

    const rawRels: any[] = [
      { id: 'r1', source_id: '1', target_id: '3', type: 'depends_on', weight: 1.0 },
    ];

    const resolution = await resolveEntities(rawEntities, rawRels, db);

    expect(resolution.entitiesToCreate.length).toBe(2);
    const toolEntity = resolution.entitiesToCreate.find(e => e.type === 'tool');
    const conceptEntity = resolution.entitiesToCreate.find(e => e.type === 'concept');
    expect(toolEntity).toBeDefined();
    expect(conceptEntity).toBeDefined();

    expect(toolEntity?.description).toBe('A server component');
    expect(toolEntity?.tags).toEqual(['ts']);

    expect(resolution.idMap['1']).toBe('1');
    expect(resolution.idMap['2']).toBe('1');
    expect(resolution.idMap['3']).toBe('3');

    expect(resolution.relationshipsToCreate.length).toBe(1);
    expect(resolution.relationshipsToCreate[0].source_id).toBe('1');
    expect(resolution.relationshipsToCreate[0].target_id).toBe('3');
  });

  it('should resolve against existing database entities', async () => {
    const existing = await db.addEntity({
      name: 'SQLite Database',
      type: 'tool',
      description: 'SQLite database engine',
      tags: ['sqlite'],
    });

    const newEntities: any[] = [
      {
        id: 'new-sqlite-id',
        name: 'sqlite database',
        type: 'tool',
        description: 'New extracted sqlite description',
        tags: ['embedded', 'sqlite'],
      },
      {
        id: 'new-other-id',
        name: 'New Tool',
        type: 'tool',
        description: 'New tool desc',
        tags: ['new'],
      }
    ];

    const newRels: any[] = [
      { id: 'r2', source_id: 'new-sqlite-id', target_id: 'new-other-id', type: 'relates_to', weight: 1.0 },
      { id: 'r3', source_id: 'new-sqlite-id', target_id: 'new-sqlite-id', type: 'self_loop', weight: 1.0 },
    ];

    const resolution = await resolveEntities(newEntities, newRels, db);

    expect(resolution.entitiesToCreate.length).toBe(2);
    const newOther = resolution.entitiesToCreate.find(e => e.id === 'new-other-id');
    const aliasSqlite = resolution.entitiesToCreate.find(e => e.id === 'new-sqlite-id');
    expect(newOther).toBeDefined();
    expect(aliasSqlite).toBeDefined();
    expect(aliasSqlite?.metadata?.merged_into).toBe(existing.id);

    expect(resolution.entitiesToUpdate.length).toBe(1);
    expect(resolution.entitiesToUpdate[0].id).toBe(existing.id);
    expect(resolution.entitiesToUpdate[0].description).toBe('New extracted sqlite description');
    expect(resolution.entitiesToUpdate[0].tags).toContain('sqlite');
    expect(resolution.entitiesToUpdate[0].tags).toContain('embedded');

    expect(resolution.idMap['new-sqlite-id']).toBe(existing.id);
    expect(resolution.idMap['new-other-id']).toBe('new-other-id');

    expect(resolution.relationshipsToCreate.length).toBe(1);
    expect(resolution.relationshipsToCreate[0].source_id).toBe(existing.id);
    expect(resolution.relationshipsToCreate[0].target_id).toBe('new-other-id');
  });
});

describe('Bitemporal Edges & Single-Valued Relation Invalidation', () => {
  let db: Database;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  it('should invalidate old single-valued relationships automatically and record invalidation_reason', async () => {
    const user = await db.addEntity({ name: 'ZhangSan', type: 'person' });
    const acme = await db.addEntity({ name: 'Acme Corp', type: 'project' });
    const globex = await db.addEntity({ name: 'Globex Corp', type: 'project' });

    // 1. 张三在 Acme 工作
    const rel1 = await db.addRelationship({
      source_id: user.id,
      target_id: acme.id,
      type: 'works_at',
      weight: 1.0,
    });

    // 验证一开始有效
    let activeRels = await db.getRelationshipsForEntity(user.id);
    expect(activeRels.some(r => r.id === rel1.id)).toBe(true);

    // 2. 事实变更：张三现在在 Globex 工作
    const rel2 = await db.addRelationship({
      source_id: user.id,
      target_id: globex.id,
      type: 'works_at',
      weight: 1.0,
    });

    // 验证 Acme 的关系被自动失效
    activeRels = await db.getRelationshipsForEntity(user.id, false);
    expect(activeRels.some(r => r.id === rel1.id)).toBe(false);
    expect(activeRels.some(r => r.id === rel2.id)).toBe(true);

    // 包含历史记录应可查出 rel1，且包含 invalidation_reason
    const allRels = await db.getRelationshipsForEntity(user.id, true);
    const oldRel = allRels.find(r => r.id === rel1.id);
    expect(oldRel).toBeDefined();
    expect(oldRel?.valid_until).toBeDefined();
    expect(oldRel?.invalidated_at).toBeDefined();
    expect(oldRel?.invalidation_reason).toContain('superseded by extraction');
  });

  it('should allow multiple targets for multi-valued relationships without invalidation', async () => {
    const user = await db.addEntity({ name: 'Lisi', type: 'person' });
    const science = await db.addEntity({ name: 'Science', type: 'concept' });
    const art = await db.addEntity({ name: 'Art', type: 'concept' });

    // 1. 李四 relates to Science (多值关系)
    const rel1 = await db.addRelationship({
      source_id: user.id,
      target_id: science.id,
      type: 'relates_to',
      weight: 1.0,
    });

    // 2. 李四 relates to Art (多值关系)
    const rel2 = await db.addRelationship({
      source_id: user.id,
      target_id: art.id,
      type: 'relates_to',
      weight: 1.0,
    });

    // 验证两者皆同时有效，未发生任何失效
    const activeRels = await db.getRelationshipsForEntity(user.id, false);
    expect(activeRels.some(r => r.id === rel1.id)).toBe(true);
    expect(activeRels.some(r => r.id === rel2.id)).toBe(true);
  });
});

describe('Similarity Deduplication (Task 44)', () => {
  let db: Database;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  it('should deduplicate and merge entities based on embedding similarity > 0.92', async () => {
    const mockEmbeddingService = {
      embed: async (text: string) => {
        let vec = Array.from({ length: 384 }, () => 0.0);
        const lower = text.toLowerCase();
        if (lower.includes('omni')) {
          // High similarity vectors
          vec = Array.from({ length: 384 }, (_, i) => (i === 0 ? 0.99 : 0.01));
        } else {
          vec = Array.from({ length: 384 }, (_, i) => (i === 1 ? 0.99 : 0.01));
        }
        return { embedding: vec };
      }
    };

    // 1. Ingest first entity: "OmniContext 项目"
    const e1 = {
      id: 'e1',
      name: 'OmniContext 项目',
      type: 'project' as const,
      description: 'First description',
      created_at: '2026-05-26T12:00:00Z',
      access_count: 5,
    } as any;

    const res1 = await resolveEntities([e1], [], db, mockEmbeddingService);
    expect(res1.entitiesToCreate.length).toBe(1);
    await db.addEntity(res1.entitiesToCreate[0]);

    // 2. Ingest second entity: "omni-context" (different name, same type, similar embedding)
    const e2 = {
      id: 'e2',
      name: 'omni-context',
      type: 'project' as const,
      description: 'Second longer description here',
      created_at: '2026-05-26T11:00:00Z',
      access_count: 10,
    } as any;

    const res2 = await resolveEntities([e2], [], db, mockEmbeddingService);
    
    // Should merge into e1:
    // - entitiesToCreate has 1 alias (e2) with merged_into = e1 canonical ID
    expect(res2.entitiesToCreate.length).toBe(1);
    expect(res2.entitiesToCreate[0].metadata?.merged_into).toBe(res1.entitiesToCreate[0].id);
    expect(res2.entitiesToCreate[0].tags).toContain('merged-alias');

    // - entitiesToUpdate has 1 update (e1) with:
    //   - description: 'Second longer description here' (keeps longer)
    //   - created_at: '2026-05-26T11:00:00Z' (keeps earliest)
    //   - access_count: 15 (5 + 10)
    expect(res2.entitiesToUpdate.length).toBe(1);
    const update = res2.entitiesToUpdate[0];
    expect(update.id).toBe(res1.entitiesToCreate[0].id);
    expect(update.description).toBe('Second longer description here');
    expect(update.created_at).toBe('2026-05-26T11:00:00Z');
    expect(update.access_count).toBe(15);
    
    // Add the alias and run updates
    await db.addEntity(res2.entitiesToCreate[0]);
    await db.updateEntity(update.id, update);

    // 3. Query entities list
    const activeEntities = await db.getEntitiesByType('project');
    // The alias entity is excluded by metadata.merged_into IS NULL, so only e1 is returned
    expect(activeEntities.length).toBe(1);
    expect(activeEntities[0].id).toBe(res1.entitiesToCreate[0].id);
    expect(activeEntities[0].description).toBe('Second longer description here');
    expect(activeEntities[0].created_at).toBe('2026-05-26T11:00:00Z');
    expect(activeEntities[0].access_count).toBe(15);

    // 4. Detail query redirects to canonical
    const detailedAlias = await db.getEntity('e2');
    expect(detailedAlias).not.toBeNull();
    expect(detailedAlias?.id).toBe(res1.entitiesToCreate[0].id); // Redirected to canonical ID!
    expect(detailedAlias?.name).toBe('OmniContext 项目');
  });
});

describe('GraphRAG Fact Mapping (Task 44)', () => {
  it('should map facts with confidence and source_span to relationships with weight and description', async () => {
    const extractor = new GraphRAGExtractor();
    
    // Mock LLM Pipeline response
    vi.spyOn((extractor as any).llmPipeline, 'extract').mockResolvedValue({
      entities: [
        { name: 'Alice', type: 'person', description: 'A person' },
        { name: 'Bob', type: 'person', description: 'Another person' }
      ],
      facts: [
        {
          subject: 'Alice',
          predicate: 'married_to',
          object: 'Bob',
          confidence: 0.98,
          source_span: 'Alice is happily married to Bob.'
        }
      ],
      principles: []
    });

    const output = await extractor.extract({
      textContent: 'Alice is happily married to Bob.',
      timestamp: new Date().toISOString(),
    });

    expect(output.entities.length).toBe(2);
    expect(output.relationships.length).toBe(1);
    const rel = output.relationships[0];
    expect(rel.type).toBe('married_to');
    expect(rel.weight).toBe(0.98);
    expect(rel.description).toBe('Alice is happily married to Bob.');
    
    vi.restoreAllMocks();
  });
});

describe('Notification / Insight Promotion Operations', () => {
  let db: Database;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  it('should promote an insight notification to the knowledge graph', async () => {
    // 1. 创建两个锚点实体
    const entityA = await db.addEntity({ name: 'NodeA', type: 'concept' });
    const entityB = await db.addEntity({ name: 'NodeB', type: 'concept' });

    // 2. 写入一条未读通知
    const notification = await db.addNotification({
      title: '💡 这是一条测试智能洞见',
      content: '通过NodeA与NodeB的关联，发现了一条全新的技术选型洞察。',
      type: 'insight',
      related_entities: [entityA.id, entityB.id],
    } as any);

    // 3. 验证可以 getNotification
    const retrieved = await db.getNotification(notification.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(notification.id);
    expect(retrieved?.type).toBe('insight');
    expect(retrieved?.related_entities).toEqual([entityA.id, entityB.id]);
    expect(retrieved?.read_status).toBe(false);

    // 4. 调用 promoteInsightToGraph
    const result = await db.promoteInsightToGraph(notification.id);
    expect(result).not.toBeNull();
    expect(result?.entity).toBeDefined();
    expect(result?.linked).toBe(2);

    const promotedEntity = result!.entity;
    expect(promotedEntity.name).toBe('💡 这是一条测试智能洞见');
    expect(promotedEntity.type).toBe('concept');
    expect(promotedEntity.tags).toEqual(['insight', 'agent-loop']);
    expect(promotedEntity.metadata?.provenance?.source).toBe('agent-loop');

    // 5. 验证创建的 derived_from 关系
    const activeRels = await db.getRelationshipsForEntity(promotedEntity.id);
    expect(activeRels.length).toBe(2);
    expect(activeRels.every(r => r.type === 'derived_from')).toBe(true);

    // 6. 验证通知状态已被标记为已读（已处理）
    const updatedNotification = await db.getNotification(notification.id);
    expect(updatedNotification?.read_status).toBe(true);

    // 7. 防重复物化：再次调用 promoteInsightToGraph 应该返回 null
    const duplicateResult = await db.promoteInsightToGraph(notification.id);
    expect(duplicateResult).toBeNull();
  });

  it('should return null if trying to promote non-insight or already read notification', async () => {
    // 1. 创建非 insight 通知的 proactive 类型
    const notification = await db.addNotification({
      title: 'proactive notification',
      content: 'content',
      type: 'proactive',
      related_entities: [],
    } as any);

    const res = await db.promoteInsightToGraph(notification.id);
    expect(res).toBeNull();
  });
});

describe('Consolidation Watermark Operations', () => {
  let db: Database;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  it('should select unconsolidated entities, exclude them after marking, and re-include after update', async () => {
    // 1. 新增三个实体
    const e1 = await db.addEntity({ name: 'ConsolidateNode1', type: 'concept', description: 'Desc1' });
    const e2 = await db.addEntity({ name: 'ConsolidateNode2', type: 'concept', description: 'Desc2' });
    const e3 = await db.addEntity({ name: 'ConsolidateNode3', type: 'concept', description: 'Desc3' });

    // 2. getEntitiesForConsolidation 能够选出未整合实体
    let toConsolidate = await db.getEntitiesForConsolidation(5);
    const ids = toConsolidate.map(e => e.id);
    expect(ids).toContain(e1.id);
    expect(ids).toContain(e2.id);
    expect(ids).toContain(e3.id);

    // 3. 标记已整合
    await db.markEntitiesConsolidated([e1.id, e2.id, e3.id]);

    // 4. consolidated_at 被写入且不改变 updated_at
    const savedE1 = await db.getEntity(e1.id);
    expect(savedE1?.metadata?.consolidated_at).toBeDefined();
    expect(savedE1?.updated_at).toBe(e1.updated_at);

    // 5. 从 consolidation 池中排除
    toConsolidate = await db.getEntitiesForConsolidation(5);
    const idsAfter = toConsolidate.map(e => e.id);
    expect(idsAfter).not.toContain(e1.id);
    expect(idsAfter).not.toContain(e2.id);
    expect(idsAfter).not.toContain(e3.id);

    // 6. 手动更新 e1 的 updated_at 使其大于 consolidated_at，模拟其在稍后被更新
    await db.run("UPDATE entities SET updated_at = datetime('now', '+2 seconds'), description = 'Updated Desc1' WHERE id = ?", [e1.id]);

    // 7. e1 重新进池，而 e2 和 e3 依旧排除
    toConsolidate = await db.getEntitiesForConsolidation(5);
    const idsFinal = toConsolidate.map(e => e.id);
    expect(idsFinal).toContain(e1.id);
    expect(idsFinal).not.toContain(e2.id);
    expect(idsFinal).not.toContain(e3.id);
  });

  it('should not mark consolidated when LLM is offline or error (ok = false) during AgentLoop run', async () => {
    // 1. 创建干净的测试数据库，防止受其它测试实体干扰
    const testDb = initDatabase({ dbPath: ':memory:' });
    await testDb.runMigrations();

    // 2. 创建 2 个实体
    const ea = await testDb.addEntity({ name: 'NodeA', type: 'concept' });
    const eb = await testDb.addEntity({ name: 'NodeB', type: 'concept' });

    // 3. 初始化 AgentLoop 并故意不配 apiUrl，使其 generateInsight 返回 ok: false
    const { AgentLoop: TestAgentLoop } = await import('../src/agent/agent-loop.js');
    const agent = new TestAgentLoop(testDb);
    agent.setLlmConfig({ apiUrl: '', model: 'test' });

    // 4. 调用 runCycle
    await (agent as any).runCycle();

    // 5. 验证这批实体没有被打上 consolidated_at 标记
    const activeEA = await testDb.getEntity(ea.id);
    const activeEB = await testDb.getEntity(eb.id);
    expect(activeEA?.metadata?.consolidated_at).toBeUndefined();
    expect(activeEB?.metadata?.consolidated_at).toBeUndefined();

    await testDb.close();
  });
});

describe('Entity Importance Scoring Operations', () => {
  let db: Database;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  it('should extract entities with importance (LLM path has parsed value, regex path has type defaults)', async () => {
    // 1. 测试 LLM 抽取管道解析 importance
    const { LLMExtractorPipeline } = await import('../src/graphrag/llm-pipeline.js');
    const pipeline = new LLMExtractorPipeline({ apiUrl: 'http://mock', model: 'test' });
    
    // Mock fetch 返回带 importance 的 JSON 字符串
    vi.stubGlobal('fetch', async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  entities: [
                    { name: 'CoreService', type: 'decision', description: 'Core design decision', importance: 0.85 },
                    { name: 'random term', type: 'concept', description: 'Just a term', importance: 0.15 },
                    { name: 'invalid importance term', type: 'concept', description: 'Invalid value', importance: 'not-a-number' }
                  ],
                  facts: [],
                  principles: []
                }),
              },
            },
          ],
        }),
      } as any;
    });

    const result = await pipeline.extract('mock text');
    expect(result.entities.length).toBe(3);
    expect(result.entities[0].importance).toBe(0.85);
    expect(result.entities[1].importance).toBe(0.15);
    expect(result.entities[2].importance).toBeUndefined(); // 非法值应该过滤掉

    vi.unstubAllGlobals();

    // 2. 测试 Extractor 落库后的 metadata.importance
    const { GraphRAGExtractor } = await import('../src/graphrag/extractor.js');
    const extractor = new GraphRAGExtractor();
    
    vi.spyOn((extractor as any).llmPipeline, 'extract').mockResolvedValue({
      entities: [
        { name: 'CoreService', type: 'decision', description: 'Core design decision', importance: 0.85 },
        { name: 'random term', type: 'concept', description: 'Just a term', importance: 0.15 },
        { name: 'invalid importance term', type: 'concept', description: 'Invalid value', importance: undefined }
      ],
      facts: [],
      principles: []
    });

    const out = await extractor.extract({
      textContent: 'project omni tool react',
      timestamp: new Date().toISOString(),
      sourceType: 'manual'
    });

    // 3. 验证落库实体数量和 importance
    const coreService = out.entities.find(e => e.name === 'CoreService');
    const randomTerm = out.entities.find(e => e.name === 'random term');
    const invalidTerm = out.entities.find(e => e.name === 'invalid importance term');
    const omniProject = out.entities.find(e => e.name === 'omni');
    const reactTool = out.entities.find(e => e.name === 'react');

    expect(coreService?.metadata?.importance).toBe(0.85);
    expect(randomTerm?.metadata?.importance).toBe(0.15);
    expect(invalidTerm?.metadata?.importance).toBe(0.5);
    expect(omniProject?.metadata?.importance).toBe(0.60);
    expect(reactTool?.metadata?.importance).toBe(0.45);

    vi.restoreAllMocks();
  });

  it('should rank higher importance entities first in getEntitiesForConsolidation when updated_at is identical', async () => {
    const testDb = initDatabase({ dbPath: ':memory:' });
    await testDb.runMigrations();

    // 1. 创建两个实体，设置相同的 updated_at
    const now = new Date().toISOString();
    const eLow = await testDb.addEntity({ name: 'LowNode', type: 'concept' });
    const eHigh = await testDb.addEntity({ name: 'HighNode', type: 'concept' });

    // 2. 将低重要度实体的 metadata.importance 设为 0.2，高重要度设为 0.9，并且拥有完全相同的 updated_at
    await testDb.run(
      `UPDATE entities
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.importance', 0.2), updated_at = ?
       WHERE id = ?`,
      [now, eLow.id]
    );
    await testDb.run(
      `UPDATE entities
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.importance', 0.9), updated_at = ?
       WHERE id = ?`,
      [now, eHigh.id]
    );

    // 3. 捞出待整合实体，验证 HighNode 排在 LowNode 前面 (即使 updated_at 一模一样)
    const batch = await testDb.getEntitiesForConsolidation(5);
    const firstNode = batch[0];
    const secondNode = batch[1];

    expect(firstNode.id).toBe(eHigh.id);
    expect(secondNode.id).toBe(eLow.id);

    await testDb.close();
  });

  it('should delay decay based on importance in _markStaleEntities', async () => {
    const testDb = initDatabase({ dbPath: ':memory:' });
    await testDb.runMigrations();

    // 1. 创建两个实体，设置相同的 last_accessed
    const eLow = await testDb.addEntity({ name: 'LowStaleNode', type: 'concept' });
    const eHigh = await testDb.addEntity({ name: 'HighStaleNode', type: 'concept' });

    const nineDaysAgo = new Date();
    nineDaysAgo.setDate(nineDaysAgo.getDate() - 9);
    const lastAccessedStr = nineDaysAgo.toISOString();

    await testDb.run(
      `UPDATE entities
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.importance', 0.2), last_accessed = ?
       WHERE id = ?`,
      [lastAccessedStr, eLow.id]
    );

    await testDb.run(
      `UPDATE entities
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.importance', 0.9), last_accessed = ?
       WHERE id = ?`,
      [lastAccessedStr, eHigh.id]
    );

    // 2. 使用 staleDays = 10 初始化 MemoryDecayScheduler 并调用私有方法 _markStaleEntities
    const { MemoryDecayScheduler: TestDecayScheduler } = await import('../src/memory/decay-scheduler.js');
    const scheduler = new TestDecayScheduler(testDb, { staleDays: 10, autoStart: false });

    const report = {
      relationshipsProcessed: 0,
      relationshipsDecayed: 0,
      relationshipsDormant: 0,
      entitiesStale: 0,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    };

    await (scheduler as any)._markStaleEntities(report);

    // 3. 验证报告和数据库状态
    expect(report.entitiesStale).toBe(1);

    const savedLow = await testDb.getEntity(eLow.id);
    const savedHigh = await testDb.getEntity(eHigh.id);

    expect(savedLow?.metadata?.stale).toBe(1);
    expect(savedHigh?.metadata?.stale).toBeUndefined();

    await testDb.close();
  });
});



