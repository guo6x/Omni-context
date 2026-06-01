// [通用] LLM 服务商快速配置预设数据

export interface LlmPreset {
  id: string;
  name: string;
  emoji: string;
  apiUrl: string;
  defaultModel: string;
  speed: string;
  cost: string;
  /** 获取 API Key 的控制台地址（本地服务商如 Ollama 无需） */
  apiKeyUrl?: string;
}

/** 各服务商获取 API Key 的页面，供设置里「获取 API Key →」跳转 */
export const LLM_API_KEY_URLS: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  siliconflow: 'https://cloud.siliconflow.cn/account/ak',
  moonshot: 'https://platform.moonshot.cn/console/api-keys',
  zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
  qwen: 'https://dashscope.console.aliyun.com/apiKey',
  volcengine: 'https://console.volcengine.com/ark',
  deepinfra: 'https://deepinfra.com/dash/api_keys',
  groq: 'https://console.groq.com/keys',
  openrouter: 'https://openrouter.ai/keys',
};

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    emoji: '🤖',
    apiUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    speed: 'llm_presets.speed_fast',
    cost: 'llm_presets.cost_low',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    emoji: '🐳',
    apiUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    speed: 'llm_presets.speed_medium',
    cost: 'llm_presets.cost_ultra_low',
  },
  {
    id: 'siliconflow',
    name: 'llm_presets.name_siliconflow',
    emoji: '⚡',
    apiUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    speed: 'llm_presets.speed_ultra_fast',
    cost: 'llm_presets.cost_free',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    emoji: '🌙',
    apiUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    speed: 'llm_presets.speed_medium',
    cost: 'llm_presets.cost_standard',
  },
  {
    id: 'zhipu',
    name: 'llm_presets.name_zhipu',
    emoji: '🧠',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    speed: 'llm_presets.speed_fast',
    cost: 'llm_presets.cost_low',
  },
  {
    id: 'qwen',
    name: 'llm_presets.name_qwen',
    emoji: '☁️',
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    speed: 'llm_presets.speed_fast',
    cost: 'llm_presets.cost_low',
  },
  {
    id: 'volcengine',
    name: 'llm_presets.name_volcengine',
    emoji: '🌋',
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: '请填入 endpoint id',
    speed: 'llm_presets.speed_fast',
    cost: 'llm_presets.cost_ultra_low',
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    emoji: '🧬',
    apiUrl: 'https://api.deepinfra.com/v1/openai',
    defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    speed: 'llm_presets.speed_ultra_fast',
    cost: 'llm_presets.cost_ultra_low',
  },
  {
    id: 'groq',
    name: 'Groq',
    emoji: '🚀',
    apiUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.1-8b-instant',
    speed: 'llm_presets.speed_extreme',
    cost: 'llm_presets.cost_quota_free',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    emoji: '🌐',
    apiUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    speed: 'llm_presets.speed_medium',
    cost: 'llm_presets.cost_quota_free',
  },
  {
    id: 'ollama',
    name: 'llm_presets.name_ollama_local',
    emoji: '🏠',
    apiUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    speed: 'llm_presets.speed_depends_local',
    cost: 'llm_presets.cost_free_full',
  },
  {
    id: 'custom',
    name: 'llm_presets.name_custom',
    emoji: '⚙️',
    apiUrl: '',
    defaultModel: '',
    speed: '—',
    cost: '—',
  },
];
