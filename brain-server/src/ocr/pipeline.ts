/**
 * [核心壁垒] OCR 文本提取管道
 *
 * 从截图/图片中提取文字内容，作为知识图谱提取的输入源。
 *
 * 支持：
 * 1. 基于 Tesseract.js 的本地 OCR（无需服务端）
 * 2. 可选的云端 OCR API 回退
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createAuditedAiFetch } from '../security/audited-ai-fetch.js';

const ocrFetch = createAuditedAiFetch({ purpose: 'ocr.remote-fallback', kind: 'ocr' });

export interface OCRConfig {
  /** OCR 引擎: 'local' 使用 tesseract.js, 'api' 使用云端 */
  engine: 'local' | 'api';
  /** 识别语言（tesseract 格式），默认中英混合 */
  languages: string;
  /** API URL（仅 api 模式） */
  apiUrl?: string;
  /** API Key（仅 api 模式） */
  apiKey?: string;
}

export interface OCRResult {
  /** 提取的文本 */
  text: string;
  /** 识别置信度 (0~1) */
  confidence: number;
  /** 处理耗时 (ms) */
  latencyMs: number;
  /** 使用的引擎 */
  engine: string;
  /** 识别到的文本块 */
  blocks: OCRTextBlock[];
}

export interface OCRTextBlock {
  text: string;
  confidence: number;
  /** 文本区域边界框 */
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

const DEFAULT_OCR_CONFIG: OCRConfig = {
  engine: 'local',
  languages: 'eng+chi_sim', // 英文 + 简体中文
};

export class OCRPipeline {
  private config: OCRConfig;
  private worker: any = null;
  private initialized = false;

  constructor(config: Partial<OCRConfig> = {}) {
    this.config = { ...DEFAULT_OCR_CONFIG, ...config };
  }

  /**
   * 从 base64 编码的图片中提取文字
   */
  async extractText(imageBase64: string): Promise<OCRResult> {
    const start = Date.now();

    if (this.config.engine === 'api' && this.config.apiUrl) {
      return this._extractViaApi(imageBase64, start);
    }

    return this._extractLocal(imageBase64, start);
  }

  /**
   * 从文件路径提取文字
   */
  async extractFromFile(filePath: string): Promise<OCRResult> {
    const start = Date.now();
    return this._extractLocal(filePath, start);
  }

  /**
   * 本地 Tesseract.js OCR
   */
  private async _extractLocal(input: string, startTime: number): Promise<OCRResult> {
    try {
      // 动态导入 tesseract.js
      const Tesseract = await import('tesseract.js');

      if (!this.worker) {
        const langPath = join(dirname(fileURLToPath(import.meta.url)), '../../models/tessdata');
        // tesseract.js v7 类型声明对动态 import 返回的签名偏窄，
        // 运行时 createWorker(langs, oem, options) 三点都是有效的
        const createWorker = (Tesseract as any).createWorker || Tesseract.createWorker;
        this.worker = await createWorker(this.config.languages, 1, {
          langPath,
          gzip: true,
          cacheMethod: 'none',
        });
        this.initialized = true;
      }

      const { data } = await this.worker.recognize(input);

      const blocks: OCRTextBlock[] = (data.blocks || []).map((block: any) => ({
        text: block.text,
        confidence: block.confidence / 100,
        bbox: block.bbox,
      }));

      return {
        text: data.text,
        confidence: data.confidence / 100,
        latencyMs: Date.now() - startTime,
        engine: 'tesseract.js',
        blocks,
      };
    } catch (error) {
      console.warn('[OCR] Tesseract.js 提取失败:', error);
      return this._emptyResult(startTime);
    }
  }

  /**
   * 云端 API OCR（兼容通用 OCR API 格式）
   */
  private async _extractViaApi(imageBase64: string, startTime: number): Promise<OCRResult> {
    try {
      const response = await ocrFetch(`${this.config.apiUrl}/ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          image: imageBase64,
          language: this.config.languages,
        }),
      });

      if (!response.ok) {
        throw new Error(`OCR API 错误: ${response.status}`);
      }

      const data = await response.json() as {
        text: string;
        confidence: number;
        blocks?: OCRTextBlock[];
      };

      return {
        text: data.text,
        confidence: data.confidence || 0.5,
        latencyMs: Date.now() - startTime,
        engine: 'api',
        blocks: data.blocks || [],
      };
    } catch (error) {
      console.warn('[OCR] API 提取失败, 回退到本地:', error);
      return this._extractLocal(imageBase64, startTime);
    }
  }

  /**
   * 释放 worker 资源
   */
  async dispose(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.terminate();
      } catch (e) {
        // 终止失败不报错
      }
      this.worker = null;
      this.initialized = false;
    }
  }

  private _emptyResult(startTime: number): OCRResult {
    return {
      text: '',
      confidence: 0,
      latencyMs: Date.now() - startTime,
      engine: 'none',
      blocks: [],
    };
  }
}
