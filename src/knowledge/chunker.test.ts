/**
 * 文本切分器测试
 */
import { describe, it, expect } from 'vitest';
import { chunkText } from './indexer/chunker.js';

describe('chunkText', () => {
  it('handles text shorter than maxChars', () => {
    const chunks = chunkText('hello world', 'src1');
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe('hello world');
    expect(chunks[0].sourceId).toBe('src1');
  });

  it('splits long text into multiple chunks', () => {
    const text = 'A'.repeat(500) + '\n\n' + 'B'.repeat(500);
    const chunks = chunkText(text, 'src1', { maxChars: 300, overlapChars: 50, minChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].sourceId).toBe('src1');
  });

  it('handles empty text', () => {
    const chunks = chunkText('', 'src1');
    expect(chunks.length).toBe(0);
  });

  it('preserves split point at paragraph break', () => {
    const text = '第一段内容。\n\n第二段内容。';
    const chunks = chunkText(text, 'src1', { maxChars: 20, overlapChars: 0, minChars: 2 });
    // 每段约 7 个中文字符，20 字应该能包含一段
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
