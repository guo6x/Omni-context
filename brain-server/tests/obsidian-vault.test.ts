import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { exportToObsidianVault, safeFilename } from '../src/exporters/obsidian-vault.js';
import { Writable } from 'stream';
import JSZip from 'jszip';

// 一个内存 Writable 流，用于捕获 archiver 导出的 ZIP 二进制数据
class BufferWritable extends Writable {
  private chunks: Buffer[] = [];
  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }
  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

describe('Obsidian Vault Exporter', () => {
  let db: Database;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();

    // 1. 添加普通实体
    const userA = await db.addEntity({
      name: '张三',
      type: 'person',
      description: '软件开发工程师。',
      tags: ['developer', 'team-lead'],
    });

    const company = await db.addEntity({
      name: 'Acme 公司',
      type: 'project',
      description: '前沿科技公司。',
    });

    // 2. 添加重名实体（测试重名短 ID 拼接）
    const userB = await db.addEntity({
      name: '张三',
      type: 'person',
      description: '同名的第二个人。',
      tags: ['intern'],
    });

    // 3. 添加原则类型实体
    const rule = await db.addEntity({
      name: '不重复造轮子',
      type: 'principle',
      description: '尽量使用成熟的开源库。',
      metadata: { isCore: true },
    });

    // 4. 添加有效关系
    await db.addRelationship({
      source_id: userA.id,
      target_id: company.id,
      type: 'works_at',
      description: '自2026年起任职',
      weight: 1.2,
      valid_from: '2026-05-26T10:00:00Z',
    });

    // 5. 添加失效关系
    const invalidatedRel = await db.addRelationship({
      source_id: userA.id,
      target_id: userB.id,
      type: 'knows',
      description: '曾短期共事',
      weight: 0.5,
    });
    // 手动使该关系失效
    await db.invalidateRelationship(invalidatedRel.id, '2026-05-26T11:00:00Z');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('safeFilename', () => {
    it('should strip invalid path characters', () => {
      expect(safeFilename('hello/world\\test?')).toBe('hello_world_test_');
      expect(safeFilename('张三:李四*王五|赵六')).toBe('张三_李四_王五_赵六');
      expect(safeFilename('<tag>')).toBe('_tag_');
    });

    it('should limit filename length to 200 characters', () => {
      const longName = 'a'.repeat(250);
      expect(safeFilename(longName).length).toBe(200);
    });

    it('should return unnamed for empty inputs', () => {
      expect(safeFilename('')).toBe('unnamed');
    });
  });

  describe('exportToObsidianVault', () => {
    it('should export graph to an Obsidian compatible zip vault', async () => {
      const writeStream = new BufferWritable();
      await exportToObsidianVault(db, writeStream);
      
      const zipBuffer = writeStream.toBuffer();
      expect(zipBuffer.length).toBeGreaterThan(0);

      // 解压并验证 zip 内容
      const zip = await JSZip.loadAsync(zipBuffer);

      // 验证核心文件存在
      expect(zip.file('README.md')).not.toBeNull();
      expect(zip.file('.obsidian/workspace.json')).not.toBeNull();
      
      // 验证实体写入 principles 单独目录与 entities 类型子目录
      expect(zip.file('principles/不重复造轮子.md')).not.toBeNull();
      expect(zip.file('entities/person/张三.md')).not.toBeNull();
      expect(zip.file('entities/project/Acme 公司.md')).not.toBeNull();
      
      // 验证重名实体带 ID 后缀
      const files = Object.keys(zip.files);
      const duplicateFile = files.find(f => f.startsWith('entities/person/张三-') && f.endsWith('.md'));
      expect(duplicateFile).toBeDefined();

      // 验证索引文件
      expect(zip.file('index/all-entities.md')).not.toBeNull();
      expect(zip.file('index/relationships.md')).not.toBeNull();
      expect(zip.file('index/timeline.md')).not.toBeNull();

      // 验证实体 Markdown 内容（Frontmatter、Wiki-Link 与关系）
      const zhangSanContent = await zip.file('entities/person/张三.md')!.async('string');
      expect(zhangSanContent).toContain('type: person');
      expect(zhangSanContent).toContain('tags: [developer, team-lead]');
      expect(zhangSanContent).toContain('# 张三');
      
      // 验证有效关系
      expect(zhangSanContent).toContain('works_at → [[Acme 公司]]');
      expect(zhangSanContent).toContain('since 2026-05-26');
      expect(zhangSanContent).toContain('自2026年起任职');
      
      // 验证失效关系带 strikethrough 样式
      expect(zhangSanContent).toContain('~~knows~~ → [[张三]]');
      const todayStr = new Date().toISOString().slice(0, 10);
      expect(zhangSanContent).toContain(`invalidated ${todayStr}`);

      // 验证索引文件内容
      const allEntitiesContent = await zip.file('index/all-entities.md')!.async('string');
      expect(allEntitiesContent).toContain('- [[张三]] (person)');
      expect(allEntitiesContent).toContain('- [[Acme 公司]] (project)');
      expect(allEntitiesContent).toContain('- [[不重复造轮子]] (principle)');

      const timelineContent = await zip.file('index/timeline.md')!.async('string');
      expect(timelineContent).toContain('[[张三]] (person)');
    });
  });
});
