import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from '../src/ingest/html-to-md.js';
import { dedupParagraphs, tokenize, jaccardSimilarity } from '../src/ingest/dedup.js';
import { preprocess, estimateTokens, cjkSafeTruncate } from '../src/ingest/preprocess.js';

describe('html-to-md 模块测试', () => {
  it('应当能正常抽取正文并移除 boilerplate', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>深入理解 TypeScript</title></head>
        <body>
          <header>
            <nav>
              <a href="/home">首页</a> | <a href="/about">关于</a>
            </nav>
          </header>
          <div class="sidebar">
            <h3>侧边栏链接</h3>
            <ul>
              <li><a href="/link1">链接1</a></li>
              <li><a href="/link2">链接2</a></li>
            </ul>
          </div>
          <main>
            <article>
              <h1>深入理解 TypeScript</h1>
              <p class="byline">作者: 张三</p>
              <p>TypeScript 是一种由微软开发的自由和开源的编程语言。它是 JavaScript 的一个超集，本质上向这个语言添加了可选的静态类型和基于类的面向对象编程。TypeScript 的设计目的主要是为了开发大型应用，它可以编译成纯 JavaScript，从而运行在任何浏览器、Node.js 或者是任何支持 ECMAScript 的引擎中。这样可以提供强大的编译时静态检查。</p>
              <pre><code>const a: string = "hello";</code></pre>
              <p>在传统的 JavaScript 开发中，随着代码规模 of 增长，缺乏类型检查往往会导致很多运行时错误，这极大地降低了开发效率和维护体验。TypeScript 通过引入类型注解和静态检查，使得开发人员可以在编写代码的阶段就发现潜在的问题，并获得极其强大的智能补全和代码重构支持，这极大地改善了整体开发生产力。</p>
            </article>
          </main>
          <footer>
            <p>Copyright 2026. All rights reserved.</p>
          </footer>
        </body>
      </html>
    `;

    const result = htmlToMarkdown(html);
    
    expect(result.title).toBe('深入理解 TypeScript');
    expect(result.byline).toBe('作者: 张三');
    
    // 应该包含正文和代码块
    expect(result.markdown).toContain('TypeScript 是一种由微软开发的自由和开源的编程语言');
    expect(result.markdown).toContain('const a: string = "hello"');
    
    // 不应该包含 nav/footer / sidebar 的文字
    expect(result.markdown).not.toContain('首页');
    expect(result.markdown).not.toContain('侧边栏链接');
    expect(result.markdown).not.toContain('Copyright 2026');
  });
});

describe('dedup 模块测试', () => {
  it('tokenize 应当对中英文正确分词', () => {
    const text = 'Hello 世界! This is a test.';
    const tokens = tokenize(text);
    // 世界两个字应该被拆成单字
    expect(tokens.has('世')).toBe(true);
    expect(tokens.has('界')).toBe(true);
    expect(tokens.has('hello')).toBe(true);
    expect(tokens.has('test')).toBe(true);
  });

  it('jaccardSimilarity 应当正确计算相似度', () => {
    const setA = new Set(['hello', 'world', 'test']);
    const setB = new Set(['hello', 'world', 'demo']);
    
    // 交集为 2，并集为 4，相似度为 0.5
    expect(jaccardSimilarity(setA, setB)).toBe(0.5);
  });

  it('dedupParagraphs 应当去除完全相同和相似的段落，但不误伤短句', () => {
    const paragraphs = [
      '这是一个用来测试段落去重功能的很长很长的段落，我们需要确保它能够被正确地分词并计算 Jaccard 相似度。',
      '这是一个用来测试段落去重功能的很长很长的段落，我们需要确保它能够被正确地分词并计算 Jaccard 相似度。', // 完全重复
      '这是一个用来测试段落去重功能的很长很长段落，我们需要确保它能够被正确地分词并计算 Jaccard 相似度。', // 高度相似 (只少了一个 "的" 字)
      '谢谢', // 短句
      '谢谢', // 完全重复短句
      '你好', // 不同短句
    ];

    const result = dedupParagraphs(paragraphs, 0.85);
    
    // 应该保留：
    // 1. 第一个长段落
    // 2. 一个 "谢谢"（完全重复被删）
    // 3. 一个 "你好"
    expect(result.cleanedParagraphs.length).toBe(3);
    expect(result.cleanedParagraphs[0]).toContain('这是一个用来测试段落去重功能的很长很长');
    expect(result.cleanedParagraphs[1]).toBe('谢谢');
    expect(result.cleanedParagraphs[2]).toBe('你好');
    
    expect(result.dropped.length).toBe(3);
    expect(result.dropped[0].reason).toBe('duplicate_hash');
    expect(result.dropped[1].reason).toContain('duplicate_jaccard');
    expect(result.dropped[2].reason).toBe('duplicate_hash');
  });
});

describe('preprocess 模块与截断测试', () => {
  it('estimateTokens 应当给出合理的 token 估算值', () => {
    const text = 'Hello World';
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
  });

  it('cjkSafeTruncate 应当安全截断 CJK 与 Emoji', () => {
    const text = '你好😊世界！'; // graphemes: 你, 好, 😊, 世, 界, ！ (共 6 个)
    
    const res1 = cjkSafeTruncate(text, 3);
    expect(res1.truncated).toBe(true);
    expect(res1.text).toBe('你好😊'); // 完美保留，Emoji 没有被腰斩
    
    const res2 = cjkSafeTruncate(text, 10);
    expect(res2.truncated).toBe(false);
    expect(res2.text).toBe(text);
  });

  it('preprocess 应当实现完整的清洗和 URL 短缩管线', async () => {
    const raw = `
      # 标题
      
      请访问 [GitHub 官网](https://github.com/github/hub) 或者 [Google](https://www.google.com) 获取更多信息。
      
      这是一个普通的段落，没有 URL。
      
      请访问 [GitHub 官网](https://github.com/github/hub) 或者 [Google](https://www.google.com) 获取更多信息。
    `;

    const result = await preprocess(raw, { sourceType: 'markdown' });
    
    // 应该去重重复段落
    expect(result.cleaned).toContain('这是一个普通的段落');
    
    // 应该短缩链接
    expect(result.cleaned).toContain('[GitHub 官网](short_001)');
    expect(result.cleaned).toContain('[Google](short_002)');
    
    // sourceMap 应该有映射
    expect(result.sourceMap.urls['short_001']).toBe('https://github.com/github/hub');
    expect(result.sourceMap.urls['short_002']).toBe('https://www.google.com');
    
    // 减小率大于 0
    expect(result.reductionRatio).toBeGreaterThanOrEqual(0);
  });
});
