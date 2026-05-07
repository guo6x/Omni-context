/**
 * [通用] 数学工具函数 — 向量运算
 * 提取自 sqlite.ts 和 archival-memory.ts 的重复实现
 */

/**
 * 计算两个向量的余弦相似度
 * @param a 向量 A
 * @param b 向量 B
 * @returns 余弦相似度值 [-1, 1]，0 表示不相关，1 表示完全一致
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * 将 number[] 向量编码为 Float64Array Buffer（用于 entities 表 BLOB 存储）
 */
export function encodeEmbedding(embedding: number[]): Buffer {
  return Buffer.from(new Float64Array(embedding).buffer);
}

/**
 * 将 entities 表 BLOB 解码为 number[] 向量
 */
export function decodeEmbedding(blob: Buffer): number[] {
  return Array.from(new Float64Array(blob.buffer, blob.byteOffset, blob.byteLength / 8));
}

/**
 * 将 number[] 向量编码为 Float32Array Buffer（用于 sqlite-vec vec0 虚拟表）
 * sqlite-vec 要求 Float32 格式
 */
export function encodeEmbeddingF32(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/**
 * 将 sqlite-vec BLOB 解码为 number[] 向量
 */
export function decodeEmbeddingF32(blob: Buffer): number[] {
  return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
}
