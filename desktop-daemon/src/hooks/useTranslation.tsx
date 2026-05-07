'use client';

import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import zh from '@/locales/zh';
import en from '@/locales/en';

type Language = 'zh' | 'en';

interface TranslationContextType {
  t: (key: string) => string;
  language: Language;
  setLanguage: (lang: Language) => void;
}

const languages = {
  zh,
  en,
};

const TranslationContext = React.createContext<TranslationContextType | null>(null);

export function useTranslation() {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error('useTranslation must be used within a TranslationProvider');
  }
  return context;
}

function detectInitialLanguage(): Language {
  // SSR 阶段没有 window —— 静态返回默认值，
  // useEffect 阶段再切换到真正的语言，避免 hydration 报错
  if (typeof window === 'undefined') return 'zh';
  try {
    const saved = window.localStorage.getItem('omnicontext_language');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // localStorage 不可用（隐私模式 / file://）
  }
  const browserLang = (navigator.language || 'zh').toLowerCase();
  return browserLang.startsWith('zh') ? 'zh' : 'en';
}

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  // 服务端渲染时强制 'zh'，客户端 hydrate 完毕后再用 effect 同步真实偏好。
  // 这样首屏 HTML 与 first client render 都是 'zh'，避免 React hydration mismatch。
  const [language, setLanguage] = useState<Language>('zh');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const detected = detectInitialLanguage();
    if (detected !== language) setLanguage(detected);
    // 只在挂载后跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem('omnicontext_language', language);
    } catch {
      /* ignore */
    }
  }, [language, hydrated]);

  const t = useCallback(
    (key: string) => {
      const keys = key.split('.');
      let value: any = languages[language];
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          return key;
        }
      }
      return value || key;
    },
    [language],
  );

  return React.createElement(
    TranslationContext.Provider,
    { value: { t, language, setLanguage } },
    children
  );
}
