/**
 * 对中英文进行分词：
 * CJK 字符（中日韩字符）按单字切分；
 * 英文单词、数字按完整词切分。
 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = text.toLowerCase();
  
  // 匹配 CJK 字符或者英文单词/数字
  const regex = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]|[a-zA-Z0-9']+/g;
  let match: RegExpExecArray | null;
  
  while ((match = regex.exec(normalized)) !== null) {
    tokens.add(match[0]);
  }
  
  return tokens;
}

/**
 * 计算两个 Set 之间的 Jaccard 相似度：
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  
  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionSize++;
    }
  }
  
  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize > 0 ? intersectionSize / unionSize : 0;
}

export interface DedupResult {
  cleanedParagraphs: string[];
  dropped: Array<{ reason: string; preview: string }>;
}

/**
 * 对段落列表进行完全相同及相似度去重。
 * @param paragraphs 原始段落列表
 * @param threshold Jaccard 相似度去重阈值，默认 0.85
 * @returns 包含清洗后段落和过滤掉的段落信息的对象
 */
export function dedupParagraphs(paragraphs: string[], threshold = 0.85): DedupResult {
  const cleanedParagraphs: string[] = [];
  const tokenizedList: Array<{ text: string; tokens: Set<string> }> = [];
  const seenParagraphs = new Set<string>();
  const dropped: Array<{ reason: string; preview: string }> = [];

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // 1. 完全相同去重
    if (seenParagraphs.has(trimmed)) {
      dropped.push({
        reason: 'duplicate_hash',
        preview: trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : '')
      });
      continue;
    }

    const tokens = tokenize(trimmed);

    // 2. 相似度去重（仅对较长段落做 Jaccard 相似度去重，避免对短句/词组误伤）
    if (trimmed.length < 20) {
      cleanedParagraphs.push(trimmed);
      tokenizedList.push({ text: trimmed, tokens });
      seenParagraphs.add(trimmed);
      continue;
    }

    let isDuplicate = false;
    for (const existing of tokenizedList) {
      // 只有当已有段落长度也足够时，才计算相似度
      if (existing.text.length < 20) continue;

      const similarity = jaccardSimilarity(tokens, existing.tokens);
      if (similarity > threshold) {
        isDuplicate = true;
        dropped.push({
          reason: `duplicate_jaccard (sim: ${similarity.toFixed(2)})`,
          preview: trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : '')
        });
        break;
      }
    }

    if (!isDuplicate) {
      cleanedParagraphs.push(trimmed);
      tokenizedList.push({ text: trimmed, tokens });
      seenParagraphs.add(trimmed);
    }
  }

  return {
    cleanedParagraphs,
    dropped
  };
}
