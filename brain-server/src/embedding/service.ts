/**
 * [核心壁垒] Embedding 生成服务
 * 
 * 支持两种模式：
 * 1. 本地模式（默认）: 使用 @xenova/transformers 在本地生成 embedding
 * 2. API 模式: 调用 OpenAI / 其他兼容 API
 * 
 * 设计原则：本地优先，可插拔切换
 */

export interface EmbeddingConfig {
  /** 模式: 'local' 使用 transformers.js, 'api' 使用远程 API */
  mode: 'local' | 'api';
  /** 本地模型名称（默认 all-MiniLM-L6-v2，384 维，轻量高效） */
  localModel?: string;
  /** API 端点 URL */
  apiUrl?: string;
  /** API Key */
  apiKey?: string;
  /** API 模型名称 */
  apiModel?: string;
  /** 向量维度（由模型决定，用于验证） */
  dimensions?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
  latencyMs: number;
}

const DEFAULT_CONFIG: EmbeddingConfig = {
  mode: 'local',
  localModel: 'Xenova/all-MiniLM-L6-v2', // 384 维，22MB，速度快
  dimensions: 384,
};

export class EmbeddingService {
  private config: EmbeddingConfig;
  private pipeline: any = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 延迟初始化 — 首次使用时才加载模型
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    await this.initPromise;
  }

  private async _initialize(): Promise<void> {
    if (this.config.mode === 'local') {
      try {
        // 动态导入 @xenova/transformers（避免在不使用本地模式时也要求安装）
        const { pipeline } = await import('@xenova/transformers');
        console.log(`[EmbeddingService] 正在加载本地模型: ${this.config.localModel}...`);
        this.pipeline = await pipeline('feature-extraction', this.config.localModel, {
          quantized: true, // 使用量化版本，更小更快
        });
        console.log(`[EmbeddingService] 本地模型加载完成`);
      } catch (error) {
        console.warn(`[EmbeddingService] 本地模型加载失败，回退到简单哈希 embedding:`, error);
        // 回退到简单的哈希 embedding（用于无法安装 transformers.js 的环境）
        this.pipeline = null;
      }
    }
    this.initialized = true;
  }

  /**
   * 为文本生成 embedding 向量
   */
  async embed(text: string): Promise<EmbeddingResult> {
    await this.ensureInitialized();
    const start = Date.now();

    if (this.config.mode === 'api' && this.config.apiUrl) {
      return this.embedViaApi(text, start);
    }

    if (this.pipeline) {
      return this.embedLocal(text, start);
    }

    // 回退：简单的文本哈希 embedding（比没有好）
    return this.embedFallback(text, start);
  }

  /**
   * 批量生成 embedding
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // 串行执行，避免内存压力（本地模型占用较大）
    const results: EmbeddingResult[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  /**
   * 本地 transformers.js embedding
   */
  private async embedLocal(text: string, startTime: number): Promise<EmbeddingResult> {
    const output = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });

    // output.data 是 Float32Array
    const embedding = Array.from(output.data as Float32Array);

    return {
      embedding,
      dimensions: embedding.length,
      model: this.config.localModel || 'unknown',
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * 远程 API embedding（兼容 OpenAI 格式）
   */
  private async embedViaApi(text: string, startTime: number): Promise<EmbeddingResult> {
    const response = await fetch(`${this.config.apiUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.apiModel || 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API 错误: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };
    const embedding = data.data[0].embedding;

    return {
      embedding,
      dimensions: embedding.length,
      model: this.config.apiModel || 'api',
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * 回退方案：基于字符频率的简单哈希 embedding
   * 质量远不如真实模型，但至少提供基本的相似度比较能力
   */
  private embedFallback(text: string, startTime: number): EmbeddingResult {
    const dims = this.config.dimensions || 384;
    const embedding = new Array(dims).fill(0);

    // 基于字符 n-gram 的简单哈希散列
    const normalized = text.toLowerCase().trim();
    for (let i = 0; i < normalized.length; i++) {
      const charCode = normalized.charCodeAt(i);
      // 使用多个哈希函数分散到不同维度
      for (let j = 0; j < 3; j++) {
        const idx = ((charCode * (j + 1) * 31 + i * 17) % dims + dims) % dims;
        embedding[idx] += 1.0 / (normalized.length + 1);
      }

      // 考虑 bigram
      if (i < normalized.length - 1) {
        const nextCode = normalized.charCodeAt(i + 1);
        const bigramIdx = ((charCode * 37 + nextCode * 41) % dims + dims) % dims;
        embedding[bigramIdx] += 0.5 / (normalized.length + 1);
      }
    }

    // L2 归一化
    const norm = Math.sqrt(embedding.reduce((sum: number, val: number) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < dims; i++) {
        embedding[i] /= norm;
      }
    }

    return {
      embedding,
      dimensions: dims,
      model: 'fallback-hash',
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * 获取当前配置信息
   */
  getInfo(): { mode: string; model: string; dimensions: number; initialized: boolean } {
    return {
      mode: this.config.mode,
      model: (this.config.mode === 'local' ? this.config.localModel : this.config.apiModel) || 'unknown',
      dimensions: this.config.dimensions || 384,
      initialized: this.initialized,
    };
  }
}

export default EmbeddingService;
