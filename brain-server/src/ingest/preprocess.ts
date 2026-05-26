import { htmlToMarkdown } from './html-to-md.js';
import { dedupParagraphs } from './dedup.js';

export interface PreprocessResult {
  cleaned: string;            // 喂给 LLM 的内容
  originalTokens: number;
  cleanedTokens: number;
  reductionRatio: number;     // 0.7 = 减 70%
  droppedSections: Array<{ reason: string; preview: string }>;
  sourceMap: {
    urls: Record<string, string>;
    dropped: Array<{ reason: string; preview: string }>;
  };
}

/**
 * 启发式估算文本 Token 数量。
 * 汉字字符占 1.2 token，英文单词占 1.3 token，其他字符 0.5 token。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  const cjkCount = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const wordsCount = (text.match(/[a-zA-Z0-9']+/g) || []).length;
  const englishCharsCount = (text.match(/[a-zA-Z0-9']/g) || []).length;
  
  const totalLength = text.length;
  const otherCount = Math.max(0, totalLength - cjkCount - englishCharsCount);
  
  return Math.ceil(cjkCount * 1.2 + wordsCount * 1.3 + otherCount * 0.5);
}

/**
 * 使用 Intl.Segmenter 进行 grapheme 级别的 CJK 边界安全截断。
 */
export function cjkSafeTruncate(text: string, maxGraphemes: number): { truncated: boolean; text: string } {
  try {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
    const segments = segmenter.segment(text);
    let count = 0;
    let truncatedText = '';
    
    for (const segment of segments) {
      if (count >= maxGraphemes) {
        return { truncated: true, text: truncatedText };
      }
      truncatedText += segment.segment;
      count++;
    }
    return { truncated: false, text };
  } catch (e) {
    // 降级：如果运行环境不支持 Intl.Segmenter，使用 String.prototype.slice 截断
    if (text.length > maxGraphemes) {
      return { truncated: true, text: text.slice(0, maxGraphemes) };
    }
    return { truncated: false, text };
  }
}

/**
 * TokenJuice 输入清洗预处理管线
 */
export async function preprocess(
  raw: string,
  opts: { sourceType: 'html' | 'markdown' | 'plain'; maxTokens?: number }
): Promise<PreprocessResult> {
  const maxTokens = opts.maxTokens || 32000;
  const originalTokens = estimateTokens(raw);
  
  let markdown = '';
  const droppedSections: Array<{ reason: string; preview: string }> = [];
  const urlsMap: Record<string, string> = {};

  // 1. 根据输入类型，将内容转换或提取为 Markdown 格式
  if (opts.sourceType === 'html') {
    const res = htmlToMarkdown(raw);
    markdown = res.markdown;
  } else {
    markdown = raw || '';
  }

  // 2. 去除 boilerplate（常见页眉/页脚/版权关键字，以及短行链接高占比列表）
  const paragraphs = markdown.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  
  const BOILERPLATE_KEYWORDS = [
    /copyright/i,
    /版权所有/i,
    /all rights reserved/i,
    /关于我们/i,
    /联系我们/i,
    /使用条款/i,
    /隐私政策/i,
    /友情链接/i,
    /网站地图/i,
    /sitemap/i,
    /京icp备/i,
    /粤icp备/i,
    /沪icp备/i,
    /浙icp备/i,
    /苏icp备/i,
    /蜀icp备/i,
    /icp/i
  ];

  const filteredParagraphs: string[] = [];

  for (const paragraph of paragraphs) {
    let isBoilerplate = false;
    
    // (1) 匹配关键字
    for (const kw of BOILERPLATE_KEYWORDS) {
      if (kw.test(paragraph) && paragraph.length < 250) {
        isBoilerplate = true;
        droppedSections.push({
          reason: 'boilerplate_keyword',
          preview: paragraph.slice(0, 100) + (paragraph.length > 100 ? '...' : '')
        });
        break;
      }
    }
    if (isBoilerplate) continue;

    // (2) 匹配短链接列表：判断段落中链接字符是否高占比且段落整体较短
    // 匹配 Markdown 格式的链接: [text](url)
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    const matches = [...paragraph.matchAll(linkRegex)];
    
    if (matches.length >= 2 && paragraph.length < 350) {
      // 剥离所有的 markdown 链接，并过滤掉常见的标点及空白分隔符，以提取普通文本内容
      const plainTextWithoutLinks = paragraph
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '')
        .replace(/[\s|•·\-\[\]]+/g, '')
        .trim();
      
      // 如果去掉链接及分隔符后，普通文本少于 10 个字符，说明该段落基本上全是链接堆砌（如友情链接、导航栏）
      if (plainTextWithoutLinks.length < 10) {
        droppedSections.push({
          reason: 'boilerplate_links',
          preview: paragraph.slice(0, 100) + (paragraph.length > 100 ? '...' : '')
        });
        continue;
      }
    }

    filteredParagraphs.push(paragraph);
  }

  // 3. 段落相似度去重 (Jaccard > 0.85)
  const dedupRes = dedupParagraphs(filteredParagraphs);
  const dedupedParagraphs = dedupRes.cleanedParagraphs;
  droppedSections.push(...dedupRes.dropped);

  // 4. URL 短缩：检测并替换 Markdown 中的超长链接
  let urlCounter = 0;
  const shortenedParagraphs = dedupedParagraphs.map(paragraph => {
    // 匹配 Markdown 链接中的 HTTP/HTTPS 地址
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    return paragraph.replace(linkRegex, (match, text, url) => {
      // 检查该 URL 是否已存在于映射中
      let shortId = Object.keys(urlsMap).find(key => urlsMap[key] === url);
      if (!shortId) {
        urlCounter++;
        shortId = `short_${String(urlCounter).padStart(3, '0')}`;
        urlsMap[shortId] = url;
      }
      return `[${text}](${shortId})`;
    });
  });

  const mergedText = shortenedParagraphs.join('\n\n');

  // 5. CJK-safe 截断至 maxTokens（使用 grapheme 进行截断，一般 1 grapheme 对应 1~2 tokens）
  const truncateRes = cjkSafeTruncate(mergedText, maxTokens);
  if (truncateRes.truncated) {
    droppedSections.push({
      reason: 'cjk_safe_truncate',
      preview: `截断点在超过第 ${maxTokens} 个字符（grapheme）后。`
    });
  }

  const cleaned = truncateRes.text;
  const cleanedTokens = estimateTokens(cleaned);
  
  const reductionRatio = originalTokens > 0 
    ? parseFloat(((originalTokens - cleanedTokens) / originalTokens).toFixed(4)) 
    : 0;

  return {
    cleaned,
    originalTokens,
    cleanedTokens,
    reductionRatio: Math.max(0, reductionRatio),
    droppedSections,
    sourceMap: {
      urls: urlsMap,
      dropped: droppedSections
    }
  };
}
