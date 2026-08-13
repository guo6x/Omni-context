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
  /** 推荐的排名前列的主流模型列表 */
  recommendedModels?: string[];
}

/** 各服务商获取 API Key 的页面，供设置里「获取 API Key →」跳转。
 * CP3 shell-open closure: URLs are opened only by the Rust command
 * open_trusted_external_url (desktop-daemon/src-tauri/src/commands.rs), which
 * maps the same target ids below to hard-coded https URLs. */
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
  gemini: 'https://aistudio.google.com/app/apikey',
};

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: 'ollama',
    name: 'llm_presets.name_ollama_local',
    emoji: '🏠',
    apiUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    speed: 'llm_presets.speed_depends_local',
    cost: 'llm_presets.cost_free_full',
    recommendedModels: ['qwen2.5:7b', 'deepseek-r1:7b', 'llama3.3:8b'],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio（本地）',
    emoji: '🏠',
    apiUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    speed: 'llm_presets.speed_depends_local',
    cost: 'llm_presets.cost_free_full',
    recommendedModels: ['local-model'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    emoji: '🐳',
    apiUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-pro',
    speed: 'llm_presets.speed_fast',
    cost: 'llm_presets.cost_ultra_low',
    recommendedModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    emoji: '🤖',
    apiUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    speed: 'llm_presets.speed_fast',
    cost: 'llm_presets.cost_low',
    recommendedModels: ['gpt-4o-mini', 'gpt-4o', 'o1-mini', 'gpt-4-turbo'],
  },
  {
    id: 'gemini',
    name: 'Gemini (Google AI Studio)',
    emoji: '♊',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-3.5-flash',
    speed: 'llm_presets.speed_fast',
    cost: 'llm_presets.cost_free',
    recommendedModels: ['gemini-3.5-flash', 'gemini-3.1-pro', 'gemini-3.1-flash-lite'],
  },
  {
    id: 'siliconflow',
    name: 'llm_presets.name_siliconflow',
    emoji: '⚡',
    apiUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Pro',
    speed: 'llm_presets.speed_ultra_fast',
    cost: 'llm_presets.cost_free',
    recommendedModels: ['deepseek-ai/DeepSeek-V4-Pro', 'deepseek-ai/DeepSeek-V4-Flash', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-7B-Instruct'],
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    emoji: '🌙',
    apiUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    speed: 'llm_presets.speed_medium',
    cost: 'llm_presets.cost_standard',
    recommendedModels: ['moonshot-v1-8k', 'moonshot-v1-32k'],
  },
  {
    id: 'zhipu',
    name: 'llm_presets.name_zhipu',
    emoji: '🧠',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    speed: 'llm_presets.speed_fast',
    cost: 'llm_presets.cost_low',
    recommendedModels: ['glm-4-flash', 'glm-4-plus', 'glm-4-air'],
  },
  {
    id: 'qwen',
    name: 'llm_presets.name_qwen',
    emoji: '☁️',
    apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    speed: 'llm_presets.speed_fast',
    cost: 'llm_presets.cost_low',
    recommendedModels: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
  },
  {
    id: 'volcengine',
    name: 'llm_presets.name_volcengine',
    emoji: '🌋',
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: '请填入 endpoint id',
    speed: 'llm_presets.speed_fast',
    cost: 'llm_presets.cost_ultra_low',
    recommendedModels: ['请填入 endpoint id'],
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    emoji: '🧬',
    apiUrl: 'https://api.deepinfra.com/v1/openai',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    speed: 'llm_presets.speed_ultra_fast',
    cost: 'llm_presets.cost_ultra_low',
    recommendedModels: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V4-Pro', 'deepseek-ai/DeepSeek-V4-Flash', 'Qwen/Qwen2.5-72B-Instruct'],
  },
  {
    id: 'groq',
    name: 'Groq',
    emoji: '🚀',
    apiUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    speed: 'llm_presets.speed_extreme',
    cost: 'llm_presets.cost_quota_free',
    recommendedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    emoji: '🌐',
    apiUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-3.5-flash',
    speed: 'llm_presets.speed_medium',
    cost: 'llm_presets.cost_quota_free',
    recommendedModels: ['google/gemini-3.5-flash', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-v4-pro', 'anthropic/claude-sonnet-4-6'],
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
