/**
 * [核心壁垒] 防 Prompt Injection 预过滤模块
 * 
 * 功能：
 * - 针对已知常见的中英文 Prompt 注入攻击模式、ChatML 标记和 Llama 格式进行正则静态拦截。
 * - 采取替换占位符（[redacted-suspicious-pattern]）的温和方式，防止攻击者跳出 XML 标签围栏，同时不破坏文本的整体结构和后续正则抽取。
 */

export const INJECTION_PATTERNS = [
  // 忽略指令（中英文）
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|existing|system)?\s*(?:instructions?|rules?|guidelines?|prompts?|constraints?)/gi,
  /忽略(?:之前|以上|所有|现有)的?(?:指令|提示|要求|规则|命令|约束)/gi,
  
  // 角色扮演 / 切换（中英文）
  /you\s+(?:are|will)\s+now\s+(?:be\s+|act\s+as\s+|start\s+acting\s+as\s+)?/gi,
  /你现在(?:是|开始扮演|扮演|需要担任|成为)/gi,
  
  // 忘记设定（中英文）
  /forget\s+(?:everything|all|previous|prior|any|your)?\s*(?:instructions?|rules?|guidelines?|role)?/gi,
  /忘记(?:之前|所有|一切|你的角色|设定)/gi,
  
  // 任务变更
  /结束(?:抽取)?任务/gi,
  /新任务\s*[：:]/gi,
  /new\s+task\s*[:：]/gi,
  
  // 格式逃逸 / 系统级别标记
  /system\s*instruction\s*[:：]/gi,
  /system\s*[:：]/gi,
  /assistant\s*[:：]/gi,
  /<\|im_(start|end)\|>/gi,    // ChatML 标记
  /\[INST\]|\[\/INST\]/gi,     // Llama instruct 标记
  /<\/?USER_CONTENT>/gi,
  /<\/?USER_TEXT>/gi,
];

/**
 * 扫描并过滤输入文本中的潜在注入指令
 * @param content 输入文本
 * @returns 过滤后的文本 (cleaned) 和匹配到的可疑片段 (suspicious)
 */
export function sanitizeForExtraction(content: string): { cleaned: string; suspicious: string[] } {
  const suspicious: string[] = [];
  let cleaned = content || '';
  for (const pattern of INJECTION_PATTERNS) {
    const matches = cleaned.match(pattern);
    if (matches) {
      suspicious.push(...matches);
      // 将命中的模式替换为无害占位符
      cleaned = cleaned.replace(pattern, '[redacted-suspicious-pattern]');
    }
  }
  return { cleaned, suspicious };
}
