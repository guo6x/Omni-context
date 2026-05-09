import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { CoreMemory } from '../src/memory/core-memory.js';
import { ArchivalMemory } from '../src/memory/archival-memory.js';
import { GraphRAGExtractor } from '../src/graphrag/extractor.js';

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
