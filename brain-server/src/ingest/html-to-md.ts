import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

export interface HtmlToMarkdownResult {
  title: string;
  markdown: string;
  byline: string;
}

export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  if (!html || !html.trim()) {
    return { title: '', markdown: '', byline: '' };
  }

  // 1. 使用 JSDOM 解析 HTML
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // 2. 清洗噪音 DOM 节点以去除 boilerplate 元素
  const selectorsToRemove = [
    'script', 'style', 'iframe', 'noscript', 'link',
    'nav', 'footer', 'aside',
    '.sidebar', '#sidebar',
    '.footer', '#footer',
    '.nav', '#nav',
    '.menu', '#menu',
    '.ad', '.ads', '.advertisement',
    '#ad', '#ads',
    '.recommend', '.related', // 推荐阅读/相关推荐
    '.comment', '#comment', // 评论区
    '.reply', '#reply'
  ];

  selectorsToRemove.forEach(selector => {
    try {
      const elements = doc.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    } catch (e) {
      // 忽略选择器异常
    }
  });

  // 3. 使用 Mozilla Readability 抽取正文
  let article: ReturnType<Readability['parse']> = null;
  try {
    const reader = new Readability(doc);
    article = reader.parse();
  } catch (e) {
    console.warn('[htmlToMarkdown] Readability parse failed:', e);
  }

  // 4. 初始化 Turndown 转换器
  // 处理 ES Module 兼容
  const Turndown = (TurndownService as any).default || TurndownService;
  const turndownService = new Turndown({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
  });

  // 5. 提取内容并进行 Markdown 转换
  if (article && article.content) {
    try {
      const markdown = turndownService.turndown(article.content);
      return {
        title: article.title || '',
        markdown: markdown,
        byline: article.byline || ''
      };
    } catch (e) {
      console.warn('[htmlToMarkdown] Turndown conversion failed for article content:', e);
    }
  }

  // 降级：如果 readability 失败或返回空，将清理过的整个 body 内容转为 Markdown
  try {
    const bodyContent = doc.body ? doc.body.innerHTML : html;
    const markdown = turndownService.turndown(bodyContent);
    return {
      title: doc.title || '',
      markdown: markdown,
      byline: ''
    };
  } catch (e) {
    // 最终降级：直接以纯文本形式返回去 html 标签的内容
    return {
      title: '',
      markdown: html.replace(/<[^>]+>/g, ' '),
      byline: ''
    };
  }
}
