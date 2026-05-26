"use client";

import { useState, useEffect, useCallback } from 'react';
import { THEMES, ThemeId, Theme } from '@/lib/themes';

export function useTheme() {
  const [themeId, setThemeIdState] = useState<ThemeId>(() => {
    if (typeof window === 'undefined') return 'neutral-dark';
    
    // 平滑升级过渡：老用户升级
    const storedSettings = localStorage.getItem('omnicontext-settings');
    if (storedSettings) {
      try {
        const parsed = JSON.parse(storedSettings);
        const oldTheme = parsed?.appearance?.theme;
        if (oldTheme === 'dark' || oldTheme === 'auto') return 'cyberpunk';
        if (oldTheme === 'light') return 'soft-light';
        if (oldTheme) return oldTheme as ThemeId;
      } catch (e) {}
    }
    
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'auto') return 'cyberpunk';
    if (stored === 'light') return 'soft-light';
    return (stored as ThemeId) ?? 'neutral-dark';
  });

  const applyTheme = useCallback((id: ThemeId) => {
    if (typeof document === 'undefined') return;
    const theme = THEMES[id] || THEMES['neutral-dark'];
    const root = document.documentElement;
    
    // 写入 CSS 自定义属性
    for (const [k, v] of Object.entries(theme)) {
      if (typeof v === 'string') {
        root.style.setProperty(`--color-${k}`, v);
      }
    }
    root.dataset.theme = id;
    
    // 浅色主题挂 `light` 样式以使用 globals.css 中的白底反转逻辑
    root.classList.remove('dark', 'light');
    if (id === 'soft-light' || id === 'sepia') {
      root.classList.add('light');
    } else {
      root.classList.add('dark');
    }
    
    localStorage.setItem('theme', id);
  }, []);

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    applyTheme(id);
    
    // 广播同步消息到其他 Tauri 窗口
    import('@tauri-apps/api/event').then(({ emit }) => {
      emit('theme-changed', { themeId: id }).catch(() => {});
    }).catch(() => {});
  }, [applyTheme]);

  // 初始化应用并配置跨窗口监听
  useEffect(() => {
    applyTheme(themeId);

    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ themeId: ThemeId }>('theme-changed', (event) => {
          const newThemeId = event.payload.themeId;
          setThemeIdState(newThemeId);
          applyTheme(newThemeId);
        });
      } catch (e) {
        // 非 Tauri 环境下静默
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [themeId, applyTheme]);

  return { 
    themeId, 
    setThemeId, 
    themes: THEMES, 
    currentTheme: THEMES[themeId] || THEMES['neutral-dark'] 
  };
}
