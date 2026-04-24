/**
 * 余弦相似度计算工具
 */

/**
 * 计算两个向量的余弦相似度（结果范围 [0, 1]，值越大越相似）
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: a=${a.length}, b=${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

  if (magnitude === 0) return 0;

  // 归一化到 [0, 1]
  return (dotProduct / magnitude + 1) / 2;
}
