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

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('zh');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('omnicontext_language');
    if (saved && (saved === 'zh' || saved === 'en')) {
      setLanguage(saved);
    } else {
      const browserLang = navigator.language.toLowerCase();
      if (browserLang.startsWith('zh')) {
        setLanguage('zh');
      } else {
        setLanguage('en');
      }
    }
  }, []);

  useEffect(() => {
    if (mounted) {
      localStorage.setItem('omnicontext_language', language);
    }
  }, [language, mounted]);

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
