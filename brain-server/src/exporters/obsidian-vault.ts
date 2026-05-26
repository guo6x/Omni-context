import archiver from 'archiver';
import { Database } from '../db/sqlite.js';

/**
 * 安全化文件名，移除非法字符，并限制长度在 200 个字符以内
 */
export function safeFilename(name: string): string {
  if (!name) return 'unnamed';
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200);
}

/**
 * 将整个图谱数据库导出为符合 Obsidian Vault 格式的 ZIP 归档，并流式写入到 outStream
 */
export async function exportToObsidianVault(db: Database, outStream: NodeJS.WritableStream): Promise<void> {
  // 1. 查询数据库中所有的实体和关系
  // 直接通过 SELECT * 绕过访问计数的副作用，避免写放大
  const entities = await db.all<any>('SELECT * FROM entities');
  const relationships = await db.all<any>('SELECT * FROM relationships');

  // 2. 为每个实体生成唯一的物理存储路径，并处理重名情况
  const idToPath = new Map<string, string>();
  const idToName = new Map<string, string>();
  const usedPaths = new Set<string>();

  for (const ent of entities) {
    idToName.set(ent.id, ent.name);
  }

  for (const ent of entities) {
    const dir = ent.type === 'principle' ? 'principles' : `entities/${ent.type}`;
    const baseSafeName = safeFilename(ent.name);
    let relativePath = `${dir}/${baseSafeName}.md`;

    // 冲突时带上短哈希
    if (usedPaths.has(relativePath.toLowerCase())) {
      const shortId = ent.id.slice(0, 5);
      relativePath = `${dir}/${baseSafeName}-${shortId}.md`;
    }

    usedPaths.add(relativePath.toLowerCase());
    idToPath.set(ent.id, relativePath);
  }

  // 3. 构建关系的出向映射
  const sourceToRels = new Map<string, any[]>();
  for (const rel of relationships) {
    if (!sourceToRels.has(rel.source_id)) {
      sourceToRels.set(rel.source_id, []);
    }
    sourceToRels.get(rel.source_id)!.push(rel);
  }

  // 4. 初始化 archiver 归档流
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    throw err;
  });

  archive.pipe(outStream);

  // 5. 写入 README.md 导读文件
  const readmeContent = `# Omni-Context Graph Vault

这是一个由 Omni-Context 自动生成的 Obsidian 兼容知识库（Vault）。

## 📂 目录结构
- \`entities/\`: 包含各类实体，按类型划分成子文件夹。
- \`principles/\`: 单独存放“原则 (principle)”类型的实体。
- \`index/\`: 包含全实体索引、全局关系列表和按创建时间排序的时间线。
- \`.obsidian/\`: 提供基础的 Obsidian 工作区配置。

## ⛓️ 数据与关联关系
- **Wiki-Link 关联**：所有的图谱关系都呈现在实体笔记的「## 关系」章节中，使用 \`[[wiki-link]]\` 表示。
- **历史失效关系**：已失效（如 valid_until 过期，或已明确 invalidated_at 的关系）用 \`~~双波浪线~~\` 标记，便于追溯。
- **元数据**：实体的 ID、类型、标签和访问指标保存在 Markdown 的 Frontmatter (Yaml) 中。
`;
  archive.append(readmeContent, { name: 'README.md' });

  // 6. 写入 .obsidian/workspace.json 默认配置
  const workspaceJson = JSON.stringify({ activeTab: null }, null, 2);
  archive.append(workspaceJson, { name: '.obsidian/workspace.json' });

  // 7. 遍历写入各个实体的 markdown 文件
  const now = new Date();
  for (const ent of entities) {
    const filePath = idToPath.get(ent.id)!;

    // 解析标签 tags
    let tags: string[] = [];
    if (ent.tags) {
      try {
        const parsed = JSON.parse(ent.tags);
        tags = Array.isArray(parsed) ? parsed : [];
      } catch {
        if (typeof ent.tags === 'string') {
          tags = ent.tags
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean);
        }
      }
    }

    // 生成 Frontmatter
    let frontmatter = '---\n';
    frontmatter += `id: ${ent.id}\n`;
    frontmatter += `type: ${ent.type}\n`;
    frontmatter += `created_at: ${ent.created_at || ''}\n`;
    frontmatter += `updated_at: ${ent.updated_at || ''}\n`;
    frontmatter += `tags: [${tags.join(', ')}]\n`;
    frontmatter += `omni_access_count: ${ent.access_count ?? 0}\n`;
    frontmatter += '---\n\n';

    let mdContent = frontmatter;
    mdContent += `# ${ent.name}\n\n`;

    if (ent.description) {
      mdContent += `${ent.description}\n\n`;
    }

    // 关系章节
    mdContent += `## 关系\n\n`;
    const rels = sourceToRels.get(ent.id) || [];
    if (rels.length === 0) {
      mdContent += `暂无出向关系。\n\n`;
    } else {
      for (const rel of rels) {
        const targetName = idToName.get(rel.target_id) || '未知实体';

        // 判断关系是否失效
        const isInvalid =
          !!rel.invalidated_at ||
          (rel.valid_until && new Date(rel.valid_until) <= now);

        const relType = rel.type;
        const validFrom = rel.valid_from ? rel.valid_from.slice(0, 10) : '';
        const invalidatedAt = rel.invalidated_at ? rel.invalidated_at.slice(0, 10) : '';

        let relStr = '';
        if (isInvalid) {
          const detailParts = [];
          detailParts.push(`invalidated ${invalidatedAt || 'unknown'}`);
          if (rel.description) {
            detailParts.push(rel.description);
          }
          relStr = `- ~~${relType}~~ → [[${targetName}]] *(${detailParts.join(', ')})*`;
        } else {
          const detailParts = [];
          if (rel.description) {
            detailParts.push(rel.description);
          }
          if (validFrom) {
            detailParts.push(`since ${validFrom}`);
          }
          const detailStr = detailParts.length > 0 ? ` *(${detailParts.join(', ')})*` : '';
          relStr = `- ${relType} → [[${targetName}]]${detailStr}`;
        }
        mdContent += `${relStr}\n`;
      }
      mdContent += `\n`;
    }

    // 反链备注
    mdContent += `## 引用此实体的笔记\n\n（保留空白让 Obsidian 自动反向链接）\n`;

    archive.append(mdContent, { name: filePath });
  }

  // 8. 写入 index/ 索引文件夹下的聚合文档

  // 8.1 字母序索引 index/all-entities.md
  const sortedEntities = [...entities].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  let allEntitiesMd = `# 全实体索引\n\n`;
  for (const ent of sortedEntities) {
    allEntitiesMd += `- [[${ent.name}]] (${ent.type})\n`;
  }
  archive.append(allEntitiesMd, { name: 'index/all-entities.md' });

  // 8.2 全关系列表 index/relationships.md
  let relationshipsMd = `# 全关系列表\n\n`;
  if (relationships.length === 0) {
    relationshipsMd += `无关系记录。\n`;
  } else {
    const sortedRels = [...relationships].sort((a, b) => {
      const timeA = a.created_at || '';
      const timeB = b.created_at || '';
      return timeB.localeCompare(timeA);
    });
    for (const rel of sortedRels) {
      const sourceName = idToName.get(rel.source_id) || '未知';
      const targetName = idToName.get(rel.target_id) || '未知';

      const isInvalid =
        !!rel.invalidated_at ||
        (rel.valid_until && new Date(rel.valid_until) <= now);

      let line = '';
      if (isInvalid) {
        line = `- [[${sourceName}]] --~~${rel.type}~~--> [[${targetName}]] *(invalidated)*`;
      } else {
        line = `- [[${sourceName}]] --${rel.type}--> [[${targetName}]]`;
      }
      relationshipsMd += `${line}\n`;
    }
  }
  archive.append(relationshipsMd, { name: 'index/relationships.md' });

  // 8.3 按创建时间降序排列的时间轴 index/timeline.md
  const sortedTimeline = [...entities].sort((a, b) => {
    const timeA = a.created_at || '';
    const timeB = b.created_at || '';
    return timeB.localeCompare(timeA);
  });
  let timelineMd = `# 实体创建时间线\n\n`;
  for (const ent of sortedTimeline) {
    const dateStr = ent.created_at ? ent.created_at.slice(0, 10) : '未知日期';
    timelineMd += `- **${dateStr}**: [[${ent.name}]] (${ent.type})\n`;
  }
  archive.append(timelineMd, { name: 'index/timeline.md' });

  // 9. 结束归档
  await archive.finalize();
}
