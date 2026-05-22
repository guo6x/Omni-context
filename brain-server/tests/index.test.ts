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
      await db.invalidateRelationship(relationship.id, validUntil);

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

    expect(resolution.entitiesToCreate.length).toBe(1);
    expect(resolution.entitiesToCreate[0].id).toBe('new-other-id');

    expect(resolution.entitiesToUpdate.length).toBe(1);
    expect(resolution.entitiesToUpdate[0].id).toBe(existing.id);
    expect(resolution.entitiesToUpdate[0].description).toBeUndefined();
    expect(resolution.entitiesToUpdate[0].tags).toContain('sqlite');
    expect(resolution.entitiesToUpdate[0].tags).toContain('embedded');

    expect(resolution.idMap['new-sqlite-id']).toBe(existing.id);
    expect(resolution.idMap['new-other-id']).toBe('new-other-id');

    expect(resolution.relationshipsToCreate.length).toBe(1);
    expect(resolution.relationshipsToCreate[0].source_id).toBe(existing.id);
    expect(resolution.relationshipsToCreate[0].target_id).toBe('new-other-id');
  });
});
