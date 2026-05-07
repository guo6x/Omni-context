/**
 * @xenova/transformers 类型声明
 * 仅声明本项目使用的 API 子集
 */
declare module '@xenova/transformers' {
  export function pipeline(
    task: 'feature-extraction' | 'text-classification' | 'text-generation' | string,
    model: string,
    options?: {
      quantized?: boolean;
      progress_callback?: (progress: any) => void;
    }
  ): Promise<FeatureExtractionPipeline>;

  interface FeatureExtractionPipeline {
    (text: string, options?: {
      pooling?: 'mean' | 'cls' | 'none';
      normalize?: boolean;
    }): Promise<{ data: Float32Array }>;
  }
}
