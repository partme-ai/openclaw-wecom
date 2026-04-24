/**
 * 文档索引器 — 文本切分策略
 *
 * 支持基于文本长度和段落结构的智能切分。
 */

import type { TextChunk } from '../types.js';

/** 切分配置 */
export type ChunkerConfig = {
  /** 每块最大字符数 */
  maxChars: number;
  /** 块间重叠字符数 */
  overlapChars: number;
  /** 最小块字符数（小于此的块被合并到前一块） */
  minChars: number;
};

/** 默认切分配置 */
const DEFAULT_CONFIG: ChunkerConfig = {
  maxChars: 1000,
  overlapChars: 200,
  minChars: 100,
};

const PARAGRAPH_BREAK = /\n\s*\n/;
const SENTENCE_BREAK = /[。！？.!?\n]/;

/**
 * 将纯文本切分为块
 */
export function chunkText(
  text: string,
  sourceId: string,
  config?: Partial<ChunkerConfig>,
): TextChunk[] {
  const { maxChars, overlapChars, minChars } = { ...DEFAULT_CONFIG, ...config };
  const chunks: TextChunk[] = [];
  let startOffset = 0;

  // 如果文本很短，直接作为一块
  if (text.length <= maxChars) {
    chunks.push({
      text: text.trim(),
      index: 0,
      sourceId,
      startOffset: 0,
      endOffset: text.length,
    });
    return chunks;
  }

  let index = 0;

  while (startOffset < text.length) {
    const endOffset = findSplitPoint(text, startOffset, maxChars);
    const chunkText = text.slice(startOffset, endOffset).trim();

    if (chunkText.length >= minChars || index === 0) {
      chunks.push({ text: chunkText, index, sourceId, startOffset, endOffset });
      index++;
    }

    // 计算下一次起始位置（含重叠）
    startOffset = endOffset - overlapChars;
    if (startOffset < 0) startOffset = 0;
  }

  return chunks;
}

/**
 * 在[maxChars]范围内找到合适的分割点
 * 优先：段落边界 → 句子边界 → 字符边界（兜底）
 */
function findSplitPoint(text: string, start: number, maxChars: number): number {
  const end = Math.min(start + maxChars, text.length);
  if (end === text.length) return end;

  // 查找段落边界（从 end 向前找最近的段落分隔符）
  const segment = text.slice(start, end);
  const paraMatch = [...segment.matchAll(PARAGRAPH_BREAK)].pop();
  if (paraMatch && paraMatch.index && paraMatch.index > maxChars * 0.3) {
    return start + paraMatch.index + paraMatch[0].length;
  }

  // 查找句子边界
  const sentenceMatch = [...segment.matchAll(SENTENCE_BREAK)].pop();
  if (sentenceMatch && sentenceMatch.index && sentenceMatch.index > maxChars * 0.3) {
    return start + sentenceMatch.index + sentenceMatch[0].length;
  }

  // 兜底：直接截断
  return end;
}
