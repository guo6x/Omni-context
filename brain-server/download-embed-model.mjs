// 下载中文 embedding 模型到 repo 的 models 目录，供桌面端离线加载。
// 用法（切到通畅的代理节点后，在 brain-server 目录）：
//   node download-embed-model.mjs
// 可选：换端口/镜像/模型
//   $env:OMNI_PROXY="http://127.0.0.1:7897"; $env:OMNI_HF="https://huggingface.co"; node download-embed-model.mjs Xenova/multilingual-e5-small
import path from 'path';
import { fileURLToPath } from 'url';

// node 默认不读系统代理，显式指向 Clash（你的端口是 7897）
const PROXY = process.env.OMNI_PROXY || 'http://127.0.0.1:7897';
try {
  const { ProxyAgent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new ProxyAgent(PROXY));
  console.log('走代理:', PROXY);
} catch { console.log('未用代理（undici 不可用），直连'); }

const { pipeline, env } = await import('@xenova/transformers');
const MODELS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'models');
const MODEL = process.argv[2] || 'Xenova/multilingual-e5-small';

env.remoteHost = process.env.OMNI_HF || 'https://hf-mirror.com'; // 国内镜像；节点好可改 https://huggingface.co
env.cacheDir = MODELS;        // 下载直接落到本地加载布局
env.localModelPath = MODELS;
env.allowRemoteModels = true;

console.log(`下载模型: ${MODEL}  ->  models/${MODEL}`);
let dim = 0;
for (let i = 1; i <= 10; i++) {
  try {
    const ext = await pipeline('feature-extraction', MODEL, { quantized: true });
    const out = await ext('query: 测试', { pooling: 'mean', normalize: true });
    dim = out.data.length;
    break;
  } catch (e) {
    console.log(`  尝试 ${i} 失败: ${(e.cause && e.cause.code) || e.message}（已下的会续传，自动重试）`);
  }
}
if (!dim) {
  console.error('\n下载未完成。换个更稳的节点再跑一次本命令即可（已下载的文件会续传，不会重头来）。');
  process.exit(1);
}

// 验证：关掉联网，纯本地加载一遍
env.allowRemoteModels = false;
const ext2 = await pipeline('feature-extraction', MODEL, { quantized: true });
const o2 = await ext2('query: 验证本地加载', { pooling: 'mean', normalize: true });
console.log(`\n✅ 完成。维度=${dim}，本地离线加载验证 OK（${o2.data.length} 维）。`);
console.log(`   目录: brain-server/models/${MODEL}`);
console.log(`   下好后告诉我，我接着把代码切到这个模型并重灌你的 507 条向量。`);
