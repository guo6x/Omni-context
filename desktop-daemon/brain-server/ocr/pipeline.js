/**
 * [核心壁垒] OCR 文本提取管道
 *
 * 从截图/图片中提取文字内容，作为知识图谱提取的输入源。
 *
 * 支持：
 * 1. 基于 Tesseract.js 的本地 OCR（无需服务端）
 * 2. 可选的云端 OCR API 回退
 */
const DEFAULT_OCR_CONFIG = {
    engine: 'local',
    languages: 'eng+chi_sim', // 英文 + 简体中文
};
export class OCRPipeline {
    constructor(config = {}) {
        this.worker = null;
        this.initialized = false;
        this.config = { ...DEFAULT_OCR_CONFIG, ...config };
    }
    /**
     * 从 base64 编码的图片中提取文字
     */
    async extractText(imageBase64) {
        const start = Date.now();
        if (this.config.engine === 'api' && this.config.apiUrl) {
            return this._extractViaApi(imageBase64, start);
        }
        return this._extractLocal(imageBase64, start);
    }
    /**
     * 从文件路径提取文字
     */
    async extractFromFile(filePath) {
        const start = Date.now();
        return this._extractLocal(filePath, start);
    }
    /**
     * 本地 Tesseract.js OCR
     */
    async _extractLocal(input, startTime) {
        try {
            // 动态导入 tesseract.js
            const Tesseract = await import('tesseract.js');
            if (!this.worker) {
                this.worker = await Tesseract.createWorker(this.config.languages);
                this.initialized = true;
            }
            const { data } = await this.worker.recognize(input);
            const blocks = (data.blocks || []).map((block) => ({
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
        }
        catch (error) {
            console.warn('[OCR] Tesseract.js 提取失败:', error);
            return this._emptyResult(startTime);
        }
    }
    /**
     * 云端 API OCR（兼容通用 OCR API 格式）
     */
    async _extractViaApi(imageBase64, startTime) {
        try {
            const response = await fetch(`${this.config.apiUrl}/ocr`, {
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
            const data = await response.json();
            return {
                text: data.text,
                confidence: data.confidence || 0.5,
                latencyMs: Date.now() - startTime,
                engine: 'api',
                blocks: data.blocks || [],
            };
        }
        catch (error) {
            console.warn('[OCR] API 提取失败, 回退到本地:', error);
            return this._extractLocal(imageBase64, startTime);
        }
    }
    /**
     * 释放 worker 资源
     */
    async dispose() {
        if (this.worker) {
            try {
                await this.worker.terminate();
            }
            catch (e) {
                // 终止失败不报错
            }
            this.worker = null;
            this.initialized = false;
        }
    }
    _emptyResult(startTime) {
        return {
            text: '',
            confidence: 0,
            latencyMs: Date.now() - startTime,
            engine: 'none',
            blocks: [],
        };
    }
}
