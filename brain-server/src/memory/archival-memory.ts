import { Database, VectorSearchResult } from '../db/sqlite.js';
import { v4 as uuidv4 } from 'uuid';
import { cosineSimilarity, encodeEmbedding, decodeEmbedding } from '../utils/math.js';

export interface ArchivalMemoryItem {
  id: string;
  content: string;
  summary?: string;
  tags?: string[];
  embedding?: number[];
  createdAt: string;
  archivedAt: string;
  compressed?: boolean;
  importance?: number;
}

export interface ArchivalSearchResult {
  item: ArchivalMemoryItem;
  relevanceScore: number;
  matchType: 'text' | 'semantic' | 'tag';
}

export interface ArchivalSummary {
  totalItems: number;
  totalSize: number;
  oldestItem: string;
  newestItem: string;
  topTags: { tag: string; count: number }[];
  averageImportance: number;
}

export interface CompressionOptions {
  threshold?: number;
  preserveOriginal?: boolean;
  generateSummary?: boolean;
}

export class ArchivalMemory {
  private db: Database;
  private compressionThreshold: number;
  private summaryMaxLength: number;

  constructor(db: Database, options: { 
    compressionThreshold?: number;
    summaryMaxLength?: number;
  } = {}) {
    this.db = db;
    this.compressionThreshold = options.compressionThreshold || 2048;
    this.summaryMaxLength = options.summaryMaxLength || 500;
  }

  async add(content: string, options: {
    summary?: string;
    tags?: string[];
    embedding?: number[];
    importance?: number;
  } = {}): Promise<ArchivalMemoryItem> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const tagsStr = options.tags ? JSON.stringify(options.tags) : null;
    const embeddingBlob = options.embedding 
      ? encodeEmbedding(options.embedding) 
      : null;

    const shouldCompress = content.length > this.compressionThreshold;
    let finalContent = content;
    let finalSummary = options.summary;

    if (shouldCompress && !finalSummary) {
      finalSummary = await this.generateSummary(content);
    }

    await this.db.run(
      `INSERT INTO archival_memory (id, content, summary, tags, embedding, created_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, finalContent, finalSummary || null, tagsStr, embeddingBlob, now, now]
    );

    return {
      id,
      content: finalContent,
      summary: finalSummary,
      tags: options.tags,
      embedding: options.embedding,
      createdAt: now,
      archivedAt: now,
      compressed: shouldCompress,
      importance: options.importance,
    };
  }

  async get(id: string): Promise<ArchivalMemoryItem | null> {
    const row = await this.db.get<any>('SELECT * FROM archival_memory WHERE id = ?', [id]);
    
    if (!row) {
      return null;
    }

    return this.rowToItem(row);
  }

  async update(id: string, updates: {
    content?: string;
    summary?: string;
    tags?: string[];
    importance?: number;
  }): Promise<ArchivalMemoryItem | null> {
    const existing = await this.get(id);
    if (!existing) {
      return null;
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
      
      if (updates.content.length > this.compressionThreshold && !updates.summary) {
        fields.push('summary = ?');
        values.push(await this.generateSummary(updates.content));
      }
    }

    if (updates.summary !== undefined) {
      fields.push('summary = ?');
      values.push(updates.summary);
    }

    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }

    if (updates.importance !== undefined) {
      fields.push('importance = ?');
      values.push(updates.importance);
    }

    if (fields.length === 0) {
      return existing;
    }

    values.push(id);
    await this.db.run(
      `UPDATE archival_memory SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return this.get(id);
  }

  async search(query: string, options: {
    limit?: number;
    tags?: string[];
    minImportance?: number;
    useSemantic?: boolean;
  } = {}): Promise<ArchivalSearchResult[]> {
    const limit = options.limit || 10;
    const searchTerm = `%${query}%`;
    
    let sql = `SELECT * FROM archival_memory WHERE (content LIKE ? OR summary LIKE ?)`;
    const params: any[] = [searchTerm, searchTerm];

    if (options.tags && options.tags.length > 0) {
      const tagConditions = options.tags.map(() => `tags LIKE ?`).join(' OR ');
      sql += ` AND (${tagConditions})`;
      params.push(...options.tags.map(tag => `%"${tag}"%`));
    }

    if (options.minImportance !== undefined) {
      sql += ' AND importance >= ?';
      params.push(options.minImportance);
    }

    sql += ' ORDER BY archived_at DESC LIMIT ?';
    params.push(limit);

    const rows = await this.db.all<any>(sql, params);

    return rows.map(row => {
      const item = this.rowToItem(row);
      const relevanceScore = this.calculateRelevance(query, item);
      
      return {
        item,
        relevanceScore,
        matchType: 'text' as const,
      };
    });
  }

  async semanticSearch(embedding: number[], options: {
    limit?: number;
    threshold?: number;
  } = {}): Promise<ArchivalSearchResult[]> {
    const limit = options.limit || 10;
    const threshold = options.threshold || 0.5;

    const rows = await this.db.all<any>(
      'SELECT * FROM archival_memory WHERE embedding IS NOT NULL'
    );

    const results: ArchivalSearchResult[] = [];

    for (const row of rows) {
      if (!row.embedding) continue;

      const storedEmbedding = decodeEmbedding(row.embedding);
      const similarity = cosineSimilarity(embedding, storedEmbedding);

      if (similarity >= threshold) {
        results.push({
          item: this.rowToItem(row),
          relevanceScore: similarity,
          matchType: 'semantic',
        });
      }
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, limit);
  }

  async searchByTags(tags: string[], options: {
    limit?: number;
    matchAll?: boolean;
  } = {}): Promise<ArchivalMemoryItem[]> {
    const limit = options.limit || 10;
    const matchAll = options.matchAll || false;

    let sql = 'SELECT * FROM archival_memory WHERE ';
    const params: any[] = [];

    if (matchAll) {
      const conditions = tags.map(() => `tags LIKE ?`).join(' AND ');
      sql += conditions;
      params.push(...tags.map(tag => `%"${tag}"%`));
    } else {
      const conditions = tags.map(() => `tags LIKE ?`).join(' OR ');
      sql += conditions;
      params.push(...tags.map(tag => `%"${tag}"%`));
    }

    sql += ' ORDER BY archived_at DESC LIMIT ?';
    params.push(limit);

    const rows = await this.db.all<any>(sql, params);
    return rows.map(row => this.rowToItem(row));
  }

  async getAll(options: {
    limit?: number;
    offset?: number;
    orderBy?: 'created_at' | 'archived_at' | 'importance';
    order?: 'ASC' | 'DESC';
  } = {}): Promise<ArchivalMemoryItem[]> {
    const limit = options.limit || 100;
    const offset = options.offset || 0;
    const orderBy = options.orderBy || 'archived_at';
    const order = options.order || 'DESC';

    const rows = await this.db.all<any>(
      `SELECT * FROM archival_memory ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return rows.map(row => this.rowToItem(row));
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.run('DELETE FROM archival_memory WHERE id = ?', [id]);
    return result.changes > 0;
  }

  async clear(): Promise<void> {
    await this.db.run('DELETE FROM archival_memory');
  }

  async compress(options: CompressionOptions = {}): Promise<{
    itemsProcessed: number;
    originalSize: number;
    compressedSize: number;
  }> {
    const threshold = options.threshold || this.compressionThreshold;
    const preserveOriginal = options.preserveOriginal ?? true;
    const generateSummary = options.generateSummary ?? true;

    const items = await this.getAll({ limit: 1000 });
    let itemsProcessed = 0;
    let originalSize = 0;
    let compressedSize = 0;

    for (const item of items) {
      if (item.content.length > threshold && !item.summary) {
        originalSize += item.content.length;

        const summary = generateSummary 
          ? await this.generateSummary(item.content)
          : item.content.slice(0, this.summaryMaxLength);

        await this.db.run(
          'UPDATE archival_memory SET summary = ? WHERE id = ?',
          [summary, item.id]
        );

        if (!preserveOriginal) {
          await this.db.run(
            'UPDATE archival_memory SET content = ? WHERE id = ?',
            [summary, item.id]
          );
          compressedSize += summary.length;
        } else {
          compressedSize += item.content.length;
        }

        itemsProcessed++;
      }
    }

    return { itemsProcessed, originalSize, compressedSize };
  }

  async summarize(): Promise<ArchivalSummary> {
    const stats = await this.db.get<{
      total: number;
      totalSize: number;
      oldestDate: string;
      newestDate: string;
      avgImportance: number;
    }>(
      `SELECT 
        COUNT(*) as total,
        SUM(LENGTH(content)) as totalSize,
        MIN(created_at) as oldestDate,
        MAX(created_at) as newestDate,
        AVG(importance) as avgImportance
       FROM archival_memory`
    );

    const tagRows = await this.db.all<{ tags: string }>(
      'SELECT tags FROM archival_memory WHERE tags IS NOT NULL'
    );

    const tagCounts = new Map<string, number>();
    for (const row of tagRows) {
      try {
        const tags = JSON.parse(row.tags) as string[];
        for (const tag of tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      } catch {
        continue;
      }
    }

    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    return {
      totalItems: stats?.total || 0,
      totalSize: stats?.totalSize || 0,
      oldestItem: stats?.oldestDate || '',
      newestItem: stats?.newestDate || '',
      topTags,
      averageImportance: stats?.avgImportance || 0,
    };
  }

  async archiveFromCoreMemory(keys: string[], tags?: string[]): Promise<ArchivalMemoryItem[]> {
    const archivedItems: ArchivalMemoryItem[] = [];

    for (const key of keys) {
      const coreItem = await this.db.get<any>(
        'SELECT * FROM core_memory WHERE key = ?',
        [key]
      );

      if (coreItem) {
        const content = JSON.stringify({
          key: coreItem.key,
          value: JSON.parse(coreItem.value),
          category: coreItem.category,
        });

        const item = await this.add(content, {
          tags: tags || ['core-memory', coreItem.category],
          importance: coreItem.access_count / 10,
        });

        archivedItems.push(item);
      }
    }

    return archivedItems;
  }

  async batchAdd(items: Array<{
    content: string;
    summary?: string;
    tags?: string[];
    importance?: number;
  }>): Promise<ArchivalMemoryItem[]> {
    const results: ArchivalMemoryItem[] = [];

    await this.db.withTransaction(async () => {
      for (const item of items) {
        const result = await this.add(item.content, {
          summary: item.summary,
          tags: item.tags,
          importance: item.importance,
        });
        results.push(result);
      }
    });

    return results;
  }

  async prune(options: {
    olderThan?: Date;
    minImportance?: number;
    keepCount?: number;
  } = {}): Promise<number> {
    let sql = 'DELETE FROM archival_memory WHERE 1=1';
    const params: any[] = [];

    if (options.olderThan) {
      sql += ' AND archived_at < ?';
      params.push(options.olderThan.toISOString());
    }

    if (options.minImportance !== undefined) {
      sql += ' AND importance < ?';
      params.push(options.minImportance);
    }

    if (options.keepCount) {
      sql = `
        DELETE FROM archival_memory WHERE id IN (
          SELECT id FROM archival_memory 
          ORDER BY importance DESC, archived_at DESC 
          LIMIT -1 OFFSET ?
        )
      `;
      params.push(options.keepCount);
    }

    const result = await this.db.run(sql, params);
    return result.changes;
  }

  async export(format: 'json' | 'csv' = 'json'): Promise<string> {
    const items = await this.getAll({ limit: 10000 });

    if (format === 'json') {
      return JSON.stringify(items, null, 2);
    }

    const headers = ['id', 'content', 'summary', 'tags', 'createdAt', 'archivedAt', 'importance'];
    const rows = items.map(item => [
      item.id,
      item.content.replace(/"/g, '""').slice(0, 1000),
      item.summary?.replace(/"/g, '""') || '',
      item.tags?.join(';') || '',
      item.createdAt,
      item.archivedAt,
      item.importance?.toString() || '0',
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');
  }

  async import(data: string, format: 'json' | 'csv' = 'json'): Promise<number> {
    let items: Partial<ArchivalMemoryItem>[];

    if (format === 'json') {
      items = JSON.parse(data);
    } else {
      const lines = data.split('\n').slice(1);
      items = lines.map(line => {
        const parts = line.slice(1, -1).split('","');
        return {
          id: parts[0],
          content: parts[1]?.replace(/""/g, '"') || '',
          summary: parts[2]?.replace(/""/g, '"') || undefined,
          tags: parts[3] ? parts[3].split(';') : undefined,
          createdAt: parts[4],
          archivedAt: parts[5],
          importance: parseFloat(parts[6]) || 0,
        };
      });
    }

    let imported = 0;
    for (const item of items) {
      if (item.content) {
        await this.add(item.content, {
          summary: item.summary,
          tags: item.tags,
          importance: item.importance,
        });
        imported++;
      }
    }

    return imported;
  }

  private async generateSummary(content: string): Promise<string> {
    const paragraphs = content.split(/\n\n+/);
    
    if (paragraphs.length === 1) {
      const sentences = content.split(/[.!?。！？]+/).filter(s => s.trim());
      
      if (sentences.length <= 3) {
        return content.slice(0, this.summaryMaxLength);
      }

      const firstSentence = sentences[0].trim();
      const lastSentence = sentences[sentences.length - 1].trim();
      const middleSummary = `... [${sentences.length - 2}句省略] ...`;
      
      return `${firstSentence}${middleSummary}${lastSentence}`.slice(0, this.summaryMaxLength);
    }

    const firstParagraph = paragraphs[0].trim();
    const lastParagraph = paragraphs[paragraphs.length - 1].trim();
    
    let summary = firstParagraph;
    if (paragraphs.length > 1) {
      summary += `\n... [${paragraphs.length - 1}段省略] ...\n${lastParagraph}`;
    }
    
    return summary.slice(0, this.summaryMaxLength);
  }

  private calculateRelevance(query: string, item: ArchivalMemoryItem): number {
    const queryLower = query.toLowerCase();
    let score = 0;

    if (item.content.toLowerCase().includes(queryLower)) {
      const matches = (item.content.toLowerCase().match(new RegExp(queryLower, 'g')) || []).length;
      score += Math.min(matches * 0.1, 0.5);
    }

    if (item.summary && item.summary.toLowerCase().includes(queryLower)) {
      score += 0.3;
    }

    if (item.tags) {
      const matchingTags = item.tags.filter(tag => 
        tag.toLowerCase().includes(queryLower)
      );
      score += matchingTags.length * 0.1;
    }

    if (item.importance) {
      score += Math.min(item.importance * 0.1, 0.2);
    }

    return Math.min(score, 1);
  }

  // cosineSimilarity 已移至 utils/math.ts 公共模块


  private rowToItem(row: any): ArchivalMemoryItem {
    return {
      id: row.id,
      content: row.content,
      summary: row.summary,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      embedding: row.embedding ? decodeEmbedding(row.embedding) : undefined,
      createdAt: row.created_at,
      archivedAt: row.archived_at,
      importance: row.importance,
    };
  }
}

export default ArchivalMemory;
