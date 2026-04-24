/**
 * OpenAI 兼容 Embedding API 实现
 *
 * 支持任意 OpenAI 兼容的 Embedding API（OpenAI、Azure、Ollama、智谱、月之暗面等）。
 * 默认复用 OpenClaw 主 LLM 配置的 baseUrl/apiKey，零额外配置成本。
 */

import type { EmbeddingService, KnowledgeEmbeddingConfig } from '../types.js';

/** 默认模型 */
const DEFAULT_MODEL = 'text-embedding-ada-002';
/** 默认维度 */
const DEFAULT_DIMENSIONS = 1536;

export class OpenAIEmbeddingService implements EmbeddingService {
  readonly dimensions: number;
  readonly modelName: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(config?: KnowledgeEmbeddingConfig) {
    this.baseUrl = config?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    this.apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.modelName = config?.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_MODEL;
    this.dimensions = config?.dimensions ?? DEFAULT_DIMENSIONS;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const body: Record<string, unknown> = {
      input: texts,
      model: this.modelName,
    };

    // 某些模型支持指定 dimensions（如 text-embedding-3-*）
    if (this.dimensions !== DEFAULT_DIMENSIONS) {
      body.dimensions = this.dimensions;
    }

    const url = `${this.baseUrl.replace(/\/+$/, '')}/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Embedding API error: ${response.status} ${response.statusText} — ${errorText}`);
    }

    const data = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
      model?: string;
      usage?: { prompt_tokens: number; total_tokens: number };
    };

    // 确保返回顺序与输入一致
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  }

  async health(): Promise<boolean> {
    try {
      const result = await this.embed('health check');
      return Array.isArray(result) && result.length === this.dimensions;
    } catch {
      return false;
    }
  }
}
