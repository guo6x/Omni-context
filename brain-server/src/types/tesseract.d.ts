/**
 * tesseract.js 类型声明（最小子集）
 */
declare module 'tesseract.js' {
  export function createWorker(languages: string): Promise<Worker>;

  interface Worker {
    recognize(input: string): Promise<{ data: RecognizeResult }>;
    terminate(): Promise<void>;
  }

  interface RecognizeResult {
    text: string;
    confidence: number;
    blocks: Array<{
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
  }
}
