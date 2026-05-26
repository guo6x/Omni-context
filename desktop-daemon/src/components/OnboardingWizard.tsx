// [通用] 首次启动新手引导 Wizard 组件
"use client";

import { useState } from 'react';
import { LLM_PRESETS, LlmPreset } from '@/lib/llm-presets';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/useToast';
import { AppSettings } from '@/hooks/useSettings';
import { BRAIN_URL } from '@/lib/config';
import { X, Play, Key, Database, ChevronRight, ChevronLeft, Check, Upload, HelpCircle } from 'lucide-react';

interface OnboardingWizardProps {
  settings: AppSettings;
  onUpdateBehavior: (updates: Partial<AppSettings['behavior']>) => void;
  onUpdateLlmProvider: (updates: Partial<AppSettings['llmProvider']>) => void;
  onLoadDemo: () => void;
  isLoadingDemo: boolean;
  onOpenUpload: () => void;
  onClose: () => void;
}

export default function OnboardingWizard({
  settings,
  onUpdateBehavior,
  onUpdateLlmProvider,
  onLoadDemo,
  isLoadingDemo,
  onOpenUpload,
  onClose,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const { t } = useTranslation();
  const toast = useToast();

  const [selectedPresetId, setSelectedPresetId] = useState<string>('custom');
  const [localApiUrl, setLocalApiUrl] = useState(settings.llmProvider.apiUrl);
  const [localApiKey, setLocalApiKey] = useState(settings.llmProvider.apiKey);
  const [localModel, setLocalModel] = useState(settings.llmProvider.model);

  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testError, setTestError] = useState<string>('');

  const handleSelectPreset = (preset: LlmPreset) => {
    setSelectedPresetId(preset.id);
    if (preset.id !== 'custom') {
      setLocalApiUrl(preset.apiUrl);
      setLocalModel(preset.defaultModel);
    } else {
      setLocalApiUrl('');
      setLocalModel('');
    }
    setTestState('idle');
    setTestError('');
  };

  const handleTestConnection = async () => {
    setTestState('testing');
    setTestError('');
    try {
      const res = await fetch(`${BRAIN_URL}/api/settings/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: localApiUrl,
          apiKey: localApiKey,
          model: localModel,
        }),
      });
      const data = await res.json();
      if (res.ok && data.healthy) {
        setTestState('success');
        // 保存配置到 Settings 上下文
        onUpdateLlmProvider({
          apiUrl: localApiUrl,
          apiKey: localApiKey,
          model: localModel,
        });
        toast.success(t('onboarding.test_success'));
      } else {
        setTestState('failed');
        setTestError(data.warning || t('onboarding.test_failed'));
      }
    } catch (err) {
      setTestState('failed');
      setTestError(String(err));
    }
  };

  const handleNext = () => {
    if (step === 2 && testState !== 'success') {
      return; // 必须测试通过
    }
    setStep(prev => prev + 1);
  };

  const handlePrev = () => {
    setStep(prev => prev - 1);
  };

  const handleComplete = () => {
    onUpdateBehavior({ onboarded: true });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="glass-panel w-full max-w-2xl rounded-2xl border border-white/10 overflow-hidden flex flex-col max-h-[90vh]">
        {/* 顶部指示栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/20">
          <div className="flex items-center gap-2">
            <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
              Omni-Context Wizard
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4].map(s => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step
                    ? 'w-6 bg-cyan-400'
                    : s < step
                    ? 'w-2 bg-cyan-600/40'
                    : 'w-2 bg-white/10'
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleComplete}
            className="text-gray-400 hover:text-white text-xs transition-colors flex items-center gap-1"
          >
            {t('onboarding.skip')} <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 步骤内容区域 */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
          {step === 1 && (
            <div className="space-y-6 text-center py-6">
              <div className="w-20 h-20 bg-gradient-to-tr from-cyan-500 to-purple-500 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-cyan-500/20 animate-pulse-glow">
                <Play className="w-10 h-10 text-white fill-white ml-1" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white tracking-wide">
                  {t('onboarding.welcome_title')}
                </h2>
                <p className="text-gray-400 text-sm leading-relaxed max-w-md mx-auto">
                  {t('onboarding.welcome_desc')}
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Key className="w-5 h-5 text-cyan-400" />
                  {t('onboarding.llm_title')}
                </h2>
                <p className="text-xs text-gray-400">
                  {t('onboarding.llm_desc')}
                </p>
              </div>

              {/* 推荐服务商预设 */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
                  {t('onboarding.preset_label')}
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-36 overflow-y-auto pr-1">
                  {LLM_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={`p-2 rounded-lg border text-left transition-all ${
                        selectedPresetId === preset.id
                          ? 'bg-cyan-900/40 border-cyan-400 text-white shadow-md shadow-cyan-500/10'
                          : 'bg-black/30 border-white/5 text-gray-400 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-bold truncate flex items-center gap-1.5">
                        <span>{preset.emoji}</span>
                        <span>{preset.name}</span>
                      </div>
                      <div className="text-[10px] text-gray-500 truncate mt-0.5">
                        {preset.cost}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 配置表单 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">API URL</label>
                  <input
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500 font-mono"
                    value={localApiUrl}
                    onChange={(e) => {
                      setLocalApiUrl(e.target.value);
                      setSelectedPresetId('custom');
                      setTestState('idle');
                    }}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">模型名称 (Model)</label>
                  <input
                    type="text"
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500 font-mono"
                    value={localModel}
                    onChange={(e) => {
                      setLocalModel(e.target.value);
                      setSelectedPresetId('custom');
                      setTestState('idle');
                    }}
                    placeholder="gpt-4o-mini"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
                  {t('onboarding.apikey_label')}
                </label>
                <input
                  type="password"
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500 font-mono"
                  value={localApiKey}
                  onChange={(e) => {
                    setLocalApiKey(e.target.value);
                    setTestState('idle');
                  }}
                  placeholder={t('onboarding.apikey_placeholder')}
                />
              </div>

              {/* 测试连接与提示 */}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testState === 'testing' || (!localApiUrl && selectedPresetId === 'custom')}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 border transition-all ${
                    testState === 'success'
                      ? 'bg-emerald-950/30 border-emerald-500 text-emerald-400'
                      : testState === 'failed'
                      ? 'bg-rose-950/30 border-rose-500 text-rose-400 hover:bg-rose-900/20'
                      : 'bg-cyan-600 hover:bg-cyan-500 text-white border-transparent'
                  }`}
                >
                  {testState === 'testing' ? (
                    <span>{t('onboarding.testing')}</span>
                  ) : testState === 'success' ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{t('onboarding.test_success')}</span>
                    </>
                  ) : (
                    <span>{t('onboarding.test_btn')}</span>
                  )}
                </button>

                {testState === 'failed' && (
                  <p className="text-xs text-rose-400 mt-1 leading-relaxed text-center">
                    {testError}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Database className="w-5 h-5 text-cyan-400" />
                  {t('onboarding.experience_title')}
                </h2>
                <p className="text-xs text-gray-400">
                  {t('onboarding.experience_desc')}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 导入示例图谱 */}
                <button
                  onClick={() => {
                    onLoadDemo();
                    handleNext();
                  }}
                  disabled={isLoadingDemo}
                  className="p-5 bg-black/30 border border-white/5 hover:border-cyan-500/40 rounded-xl text-left space-y-3 transition-all hover:bg-cyan-950/10 group disabled:opacity-50"
                >
                  <div className="w-10 h-10 bg-cyan-900/30 border border-cyan-800 rounded-lg flex items-center justify-center text-cyan-400 group-hover:scale-110 transition-transform">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-sm">{t('onboarding.import_demo')}</h3>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      {t('onboarding.import_demo_desc')}
                    </p>
                  </div>
                </button>

                {/* 上传本地文件 */}
                <button
                  onClick={() => {
                    onOpenUpload();
                    handleNext();
                  }}
                  className="p-5 bg-black/30 border border-white/5 hover:border-purple-500/40 rounded-xl text-left space-y-3 transition-all hover:bg-purple-950/10 group"
                >
                  <div className="w-10 h-10 bg-purple-900/30 border border-purple-800 rounded-lg flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-sm">{t('onboarding.upload_file')}</h3>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      {t('onboarding.upload_file_desc')}
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-cyan-400" />
                  {t('onboarding.done_title')}
                </h2>
                <p className="text-xs text-gray-400">
                  {t('onboarding.done_desc')}
                </p>
              </div>

              <div className="space-y-3 bg-black/20 p-4 rounded-xl border border-white/5">
                <div className="flex gap-3 text-sm text-gray-300">
                  <div className="text-cyan-400 font-bold">⌨️</div>
                  <p className="leading-relaxed">{t('onboarding.tip_1')}</p>
                </div>
                <div className="flex gap-3 text-sm text-gray-300">
                  <div className="text-cyan-400 font-bold">📁</div>
                  <p className="leading-relaxed">{t('onboarding.tip_2')}</p>
                </div>
                <div className="flex gap-3 text-sm text-gray-300">
                  <div className="text-cyan-400 font-bold">🔒</div>
                  <p className="leading-relaxed">{t('onboarding.tip_3')}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部控制区 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-black/20">
          <div>
            {step > 1 && (
              <button
                onClick={handlePrev}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" /> {t('onboarding.prev')}
              </button>
            )}
          </div>
          <div>
            {step < 4 ? (
              <button
                onClick={handleNext}
                disabled={step === 2 && testState !== 'success'}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600 text-white rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all"
              >
                {t('onboarding.next')} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                className="px-6 py-2 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white rounded-lg text-sm font-semibold shadow-lg shadow-cyan-500/10 flex items-center gap-1.5 transition-all"
              >
                <Check className="w-4 h-4" /> {t('onboarding.start_app')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
