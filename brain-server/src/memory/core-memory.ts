import { Database } from '../db/sqlite.js';

export interface CoreMemoryItem {
  key: string;
  value: any;
  category: string;
  lastAccessed: string;
  accessCount: number;
  compressed?: boolean;
  summary?: string;
}

export interface MemoryCategory {
  name: string;
  count: number;
  totalAccessCount: number;
  lastUpdated: string;
}

export interface CompressionResult {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  itemsProcessed: number;
}

export interface MemorySummary {
  totalItems: number;
  categories: MemoryCategory[];
  topAccessed: CoreMemoryItem[];
  recentItems: CoreMemoryItem[];
  compressionStats?: CompressionResult;
}

export class CoreMemory {
  private db: Database;
  private cache: Map<string, CoreMemoryItem>;
  private maxCacheSize: number;
  private compressionThreshold: number;

  constructor(db: Database, options: { maxCacheSize?: number; compressionThreshold?: number } = {}) {
    this.db = db;
    this.cache = new Map();
    this.maxCacheSize = options.maxCacheSize || 1000;
    this.compressionThreshold = options.compressionThreshold || 1024;
  }

  async set(key: string, value: any, category: string = 'general'): Promise<void> {
    const valueStr = JSON.stringify(value);
    const shouldCompress = valueStr.length > this.compressionThreshold;
    
    await this.db.run(
      `INSERT OR REPLACE INTO core_memory (key, value, category, last_accessed, access_count)
       VALUES (?, ?, ?, datetime('now'), 
               COALESCE((SELECT access_count FROM core_memory WHERE key = ?), 0) + 1)`,
      [key, valueStr, category, key]
    );

    const item: CoreMemoryItem = {
      key,
      value,
      category,
      lastAccessed: new Date().toISOString(),
      accessCount: 1,
      compressed: shouldCompress,
    };

    this.updateCache(key, item);
  }

  async get(key: string): Promise<CoreMemoryItem | null> {
    const cached = this.cache.get(key);
    if (cached) {
      cached.accessCount++;
      cached.lastAccessed = new Date().toISOString();
      this.updateAccess(key).catch(() => {});
      return cached;
    }

    const row = await this.db.get<any>('SELECT * FROM core_memory WHERE key = ?', [key]);
    
    if (!row) {
      return null;
    }

    this.updateAccess(key).catch(() => {});

    const item: CoreMemoryItem = {
      key: row.key,
      value: JSON.parse(row.value),
      category: row.category,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
    };

    this.updateCache(key, item);
    return item;
  }

  async getByCategory(category: string): Promise<CoreMemoryItem[]> {
    const rows = await this.db.all<any>('SELECT * FROM core_memory WHERE category = ?', [category]);
    
    return rows.map(row => ({
      key: row.key,
      value: JSON.parse(row.value),
      category: row.category,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
    }));
  }

  async getAll(): Promise<CoreMemoryItem[]> {
    const rows = await this.db.all<any>('SELECT * FROM core_memory ORDER BY access_count DESC');
    
    return rows.map(row => ({
      key: row.key,
      value: JSON.parse(row.value),
      category: row.category,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
    }));
  }

  async delete(key: string): Promise<void> {
    await this.db.run('DELETE FROM core_memory WHERE key = ?', [key]);
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    await this.db.run('DELETE FROM core_memory');
    this.cache.clear();
  }

  async getCategories(): Promise<MemoryCategory[]> {
    const rows = await this.db.all<any>(
      `SELECT category, COUNT(*) as count, SUM(access_count) as total_access_count, 
              MAX(last_accessed) as last_updated
       FROM core_memory 
       GROUP BY category 
       ORDER BY count DESC`
    );

    return rows.map(row => ({
      name: row.category,
      count: row.count,
      totalAccessCount: row.total_access_count || 0,
      lastUpdated: row.last_updated,
    }));
  }

  async compress(category?: string): Promise<CompressionResult> {
    const items = category 
      ? await this.getByCategory(category)
      : await this.getAll();

    let originalSize = 0;
    let compressedSize = 0;
    let itemsProcessed = 0;

    for (const item of items) {
      const valueStr = JSON.stringify(item.value);
      originalSize += valueStr.length;

      if (valueStr.length > this.compressionThreshold) {
        const summary = await this.summarizeValue(item.value);
        const compressedValue = { _compressed: true, summary, original: item.value };
        const compressedStr = JSON.stringify(compressedValue);
        
        if (compressedStr.length < valueStr.length) {
          await this.db.run(
            'UPDATE core_memory SET value = ? WHERE key = ?',
            [compressedStr, item.key]
          );
          compressedSize += compressedStr.length;
          itemsProcessed++;
        } else {
          compressedSize += valueStr.length;
        }
      } else {
        compressedSize += valueStr.length;
      }
    }

    return {
      originalSize,
      compressedSize,
      compressionRatio: originalSize > 0 ? compressedSize / originalSize : 1,
      itemsProcessed,
    };
  }

  private async summarizeValue(value: any): Promise<string> {
    if (typeof value === 'string') {
      return this.summarizeText(value);
    }

    if (Array.isArray(value)) {
      return `数组(${value.length}项): ${value.slice(0, 3).map(v => 
        typeof v === 'object' ? JSON.stringify(v).slice(0, 50) : String(v)
      ).join(', ')}${value.length > 3 ? '...' : ''}`;
    }

    if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value);
      return `对象(${keys.length}属性): ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`;
    }

    return String(value);
  }

  private summarizeText(text: string): string {
    const sentences = text.split(/[.!?。！？]+/).filter(s => s.trim());
    
    if (sentences.length <= 2) {
      return text.slice(0, 200) + (text.length > 200 ? '...' : '');
    }

    const firstSentence = sentences[0].trim();
    const lastSentence = sentences[sentences.length - 1].trim();
    
    return `${firstSentence}... [${sentences.length - 2}句省略] ...${lastSentence}`;
  }

  async getSummary(): Promise<MemorySummary> {
    const allItems = await this.getAll();
    const categories = await this.getCategories();

    const sortedByAccess = [...allItems].sort((a, b) => b.accessCount - a.accessCount);
    const sortedByRecent = [...allItems].sort((a, b) => 
      new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime()
    );

    return {
      totalItems: allItems.length,
      categories,
      topAccessed: sortedByAccess.slice(0, 10),
      recentItems: sortedByRecent.slice(0, 10),
    };
  }

  async search(query: string, options: { 
    category?: string; 
    limit?: number;
    fuzzy?: boolean;
  } = {}): Promise<CoreMemoryItem[]> {
    const limit = options.limit || 10;
    const searchTerm = options.fuzzy ? `%${query}%` : query;
    
    let sql = 'SELECT * FROM core_memory WHERE (key LIKE ? OR value LIKE ?)';
    const params: any[] = [searchTerm, searchTerm];

    if (options.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }

    sql += ' ORDER BY access_count DESC LIMIT ?';
    params.push(limit);

    const rows = await this.db.all<any>(sql, params);

    return rows.map(row => ({
      key: row.key,
      value: JSON.parse(row.value),
      category: row.category,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
    }));
  }

  async merge(keys: string[], newKey: string, category?: string): Promise<CoreMemoryItem> {
    const items = await Promise.all(keys.map(k => this.get(k)));
    const validItems = items.filter((item): item is CoreMemoryItem => item !== null);

    if (validItems.length === 0) {
      throw new Error('没有找到有效的内存项进行合并');
    }

    const mergedValue = validItems.map(item => ({
      key: item.key,
      value: item.value,
      category: item.category,
    }));

    const totalAccessCount = validItems.reduce((sum, item) => sum + item.accessCount, 0);
    const mergedCategory = category || validItems[0].category;

    await this.set(newKey, mergedValue, mergedCategory);

    await this.db.run(
      'UPDATE core_memory SET access_count = ? WHERE key = ?',
      [totalAccessCount, newKey]
    );

    for (const key of keys) {
      await this.delete(key);
    }

    const result = await this.get(newKey);
    if (!result) {
      throw new Error('合并后无法获取结果');
    }
    
    return result;
  }

  async export(format: 'json' | 'csv' = 'json'): Promise<string> {
    const items = await this.getAll();

    if (format === 'json') {
      return JSON.stringify(items, null, 2);
    }

    const headers = ['key', 'value', 'category', 'lastAccessed', 'accessCount'];
    const rows = items.map(item => [
      item.key,
      JSON.stringify(item.value).replace(/"/g, '""'),
      item.category,
      item.lastAccessed,
      item.accessCount.toString(),
    ]);

    return [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');
  }

  async import(data: string, format: 'json' | 'csv' = 'json'): Promise<number> {
    let items: CoreMemoryItem[];

    if (format === 'json') {
      items = JSON.parse(data);
    } else {
      const lines = data.split('\n').slice(1);
      items = lines.map(line => {
        const [key, value, category, lastAccessed, accessCount] = line
          .slice(1, -1)
          .split('","')
          .map(cell => cell.replace(/""/g, '"'));
        
        return {
          key,
          value: JSON.parse(value),
          category,
          lastAccessed,
          accessCount: parseInt(accessCount, 10),
        };
      });
    }

    let imported = 0;
    for (const item of items) {
      await this.set(item.key, item.value, item.category);
      imported++;
    }

    return imported;
  }

  async getStats(): Promise<{
    totalItems: number;
    totalSize: number;
    categories: number;
    avgAccessCount: number;
    oldestItem: string | null;
    newestItem: string | null;
  }> {
    const items = await this.getAll();
    
    if (items.length === 0) {
      return {
        totalItems: 0,
        totalSize: 0,
        categories: 0,
        avgAccessCount: 0,
        oldestItem: null,
        newestItem: null,
      };
    }

    const totalSize = items.reduce((sum, item) => 
      sum + JSON.stringify(item.value).length, 0
    );

    const categories = new Set(items.map(item => item.category)).size;
    const avgAccessCount = items.reduce((sum, item) => sum + item.accessCount, 0) / items.length;

    const sortedByDate = [...items].sort((a, b) => 
      new Date(a.lastAccessed).getTime() - new Date(b.lastAccessed).getTime()
    );

    return {
      totalItems: items.length,
      totalSize,
      categories,
      avgAccessCount,
      oldestItem: sortedByDate[0]?.key || null,
      newestItem: sortedByDate[sortedByDate.length - 1]?.key || null,
    };
  }

  private updateCache(key: string, item: CoreMemoryItem): void {
    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, item);
  }

  private async updateAccess(key: string): Promise<void> {
    await this.db.run(
      'UPDATE core_memory SET last_accessed = datetime("now"), access_count = access_count + 1 WHERE key = ?',
      [key]
    );
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export default CoreMemory;
