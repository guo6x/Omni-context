/** Local-first embedding service with centrally enforced usage profiles. */

import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createAuditedAiFetch } from '../security/audited-ai-fetch.js';
import {
  E5_LARGE_USAGE_PROFILE,
  EmbeddingUsage,
  EmbeddingUsageProfile,
  embeddingProfileFingerprint,
  prepareEmbeddingText,
  resolveEmbeddingUsageProfile,
} from './profiles.js';

const embeddingFetch = createAuditedAiFetch({ purpose: 'embedding.remote', kind: 'embedding' });

export interface EmbeddingConfig {
  mode: 'local' | 'api';
  localModel?: string;
  localModelPath?: string;
  apiUrl?: string;
  apiKey?: string;
  apiModel?: string;
  dimensions?: number;
  usageProfile?: EmbeddingUsageProfile;
  failOnUnavailable?: boolean;
}

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
  usage: EmbeddingUsage;
  usageProfileVersion: string;
  latencyMs: number;
}

const DEFAULT_CONFIG: EmbeddingConfig = {
  mode: 'local',
  localModel: E5_LARGE_USAGE_PROFILE.modelId,
  dimensions: E5_LARGE_USAGE_PROFILE.dimension,
};

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(path);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', resolve);
  });
  return hash.digest('hex');
}

export class EmbeddingService {
  private config: EmbeddingConfig;
  private profile: EmbeddingUsageProfile;
  private pipeline: any = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private actualDimension: number | null = null;
  private verifiedModelSha256: string | null = null;

  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const model = (this.config.mode === 'local' ? this.config.localModel : this.config.apiModel)
      || E5_LARGE_USAGE_PROFILE.modelId;
    this.profile = resolveEmbeddingUsageProfile(model, this.config.usageProfile);
    if (this.config.dimensions != null && this.config.dimensions !== this.profile.dimension) {
      throw new Error(`Embedding dimension config ${this.config.dimensions} does not match profile ${this.profile.dimension}`);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initialize();
    try {
      await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  private mustFailClosed(): boolean {
    return this.config.failOnUnavailable === true || process.env.OMNI_EVALUATION_MODE === '1';
  }

  private async verifyLocalArtifact(root: string): Promise<void> {
    if (!this.profile.modelSha256) return;
    const modelPath = join(root, this.profile.modelId, this.profile.onnxFile);
    const actual = await sha256File(modelPath);
    if (actual !== this.profile.modelSha256) {
      throw new Error(`Embedding model SHA-256 mismatch for ${this.profile.modelId}`);
    }
    this.verifiedModelSha256 = actual;
  }

  private async _initialize(): Promise<void> {
    if (this.config.mode === 'local') {
      try {
        const transformers = await import('@xenova/transformers');
        const env = (transformers as any).env;
        const localModelPath = this.config.localModelPath
          || process.env.EMBEDDING_LOCAL_MODEL_PATH
          || join(dirname(fileURLToPath(import.meta.url)), '../../models');
        env.allowRemoteModels = false;
        env.localModelPath = localModelPath;
        await this.verifyLocalArtifact(localModelPath);
        console.log(`[EmbeddingService] Loading pinned local model ${this.profile.modelId}@${this.profile.modelRevision}`);
        this.pipeline = await transformers.pipeline('feature-extraction', this.profile.modelId, {
          quantized: this.profile.quantization !== 'none',
        });
        console.log('[EmbeddingService] Pinned local model loaded');
      } catch (error) {
        this.pipeline = null;
        if (this.mustFailClosed()) {
          throw new Error(`EMBEDDING_PREFLIGHT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
        }
        console.warn('[EmbeddingService] Local model unavailable; non-evaluation hash fallback enabled:', error);
      }
    }
    this.initialized = true;
  }

  async embedQuery(text: string): Promise<EmbeddingResult> {
    return this.embedWithUsage(text, 'query');
  }

  async embedPassage(text: string): Promise<EmbeddingResult> {
    return this.embedWithUsage(text, 'passage');
  }

  /** Backward-compatible write-path default. New query callers must use embedQuery(). */
  async embed(text: string): Promise<EmbeddingResult> {
    return this.embedPassage(text);
  }

  async embedBatch(texts: string[], usage: EmbeddingUsage = 'passage'): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    for (const text of texts) results.push(await this.embedWithUsage(text, usage));
    return results;
  }

  private async embedWithUsage(text: string, usage: EmbeddingUsage): Promise<EmbeddingResult> {
    const prepared = prepareEmbeddingText(text, usage, this.profile);
    await this.ensureInitialized();
    const start = Date.now();
    let result: EmbeddingResult;
    if (this.config.mode === 'api' && this.config.apiUrl) {
      result = await this.embedViaApi(prepared, usage, start);
    } else if (this.pipeline) {
      result = await this.embedLocal(prepared, usage, start);
    } else {
      result = this.embedFallback(prepared, usage, start);
    }
    if (result.dimensions !== this.profile.dimension) {
      throw new Error(`Embedding dimension mismatch: expected ${this.profile.dimension}, actual ${result.dimensions}`);
    }
    if (result.embedding.some((value) => !Number.isFinite(value))) {
      throw new Error('Embedding contains NaN or non-finite values');
    }
    const norm = Math.sqrt(result.embedding.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(norm) || norm === 0) throw new Error('Embedding is a zero vector');
    this.actualDimension = result.dimensions;
    return result;
  }

  private async embedLocal(text: string, usage: EmbeddingUsage, startTime: number): Promise<EmbeddingResult> {
    const output = await this.pipeline(text, {
      pooling: this.profile.pooling,
      normalize: this.profile.normalize,
      truncation: true,
      padding: true,
    });
    const embedding = Array.from(output.data as Float32Array);
    return this.result(embedding, usage, startTime, this.profile.modelId);
  }

  private async embedViaApi(text: string, usage: EmbeddingUsage, startTime: number): Promise<EmbeddingResult> {
    const response = await embeddingFetch(`${this.config.apiUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model: this.config.apiModel, input: text }),
    });
    if (!response.ok) throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return this.result(data.data[0].embedding, usage, startTime, this.config.apiModel || 'api');
  }

  private embedFallback(text: string, usage: EmbeddingUsage, startTime: number): EmbeddingResult {
    if (this.mustFailClosed()) throw new Error('EVALUATION_EMBEDDING_UNAVAILABLE: hash fallback is forbidden');
    const embedding = new Array(this.profile.dimension).fill(0);
    const normalized = text.toLowerCase().trim();
    for (let i = 0; i < normalized.length; i++) {
      const charCode = normalized.charCodeAt(i);
      for (let j = 0; j < 3; j++) {
        const idx = ((charCode * (j + 1) * 31 + i * 17) % embedding.length + embedding.length) % embedding.length;
        embedding[idx] += 1 / (normalized.length + 1);
      }
    }
    const norm = Math.sqrt(embedding.reduce((sum: number, value: number) => sum + value * value, 0));
    for (let i = 0; i < embedding.length; i++) embedding[i] /= norm || 1;
    return this.result(embedding, usage, startTime, 'fallback-hash');
  }

  private result(embedding: number[], usage: EmbeddingUsage, startTime: number, model: string): EmbeddingResult {
    return {
      embedding,
      dimensions: embedding.length,
      model,
      usage,
      usageProfileVersion: this.profile.usageProfileVersion,
      latencyMs: Date.now() - startTime,
    };
  }

  getStatus(): 'local' | 'api' | 'hash-fallback' | 'pending' {
    if (!this.initialized) return 'pending';
    if (this.config.mode === 'api') return 'api';
    return this.pipeline ? 'local' : 'hash-fallback';
  }

  async reload(): Promise<void> {
    this.pipeline = null;
    this.initialized = false;
    this.initPromise = null;
    this.actualDimension = null;
    await this._initialize();
  }

  getUsageProfile(): EmbeddingUsageProfile & { fingerprint: string } {
    return { ...this.profile, fingerprint: embeddingProfileFingerprint(this.profile) };
  }

  getInfo() {
    return {
      mode: this.config.mode,
      model: this.profile.modelId,
      modelRevision: this.profile.modelRevision,
      dimensions: this.profile.dimension,
      actualDimension: this.actualDimension,
      initialized: this.initialized,
      status: this.getStatus(),
      apiUrl: this.config.apiUrl,
      usageProfile: this.getUsageProfile(),
      modelSha256Verified: this.verifiedModelSha256 === this.profile.modelSha256,
    };
  }
}

export default EmbeddingService;
