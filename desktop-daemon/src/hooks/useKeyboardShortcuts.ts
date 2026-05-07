"use client";

import { useEffect, useCallback } from "react";

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
  category: string;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
        const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
        const altMatch = shortcut.alt ? event.altKey : !event.altKey;
        const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          event.preventDefault();
          shortcut.action();
          return;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}

export const defaultShortcuts: KeyboardShortcut[] = [
  {
    key: "p",
    ctrl: true,
    shift: true,
    action: () => console.log("触发沉淀操作"),
    description: "捕获当前屏幕并提取知识",
    category: "操作",
  },
  {
    key: "d",
    ctrl: true,
    shift: true,
    action: () => console.log("触发决策查询"),
    description: "查询相关决策建议",
    category: "操作",
  },
  {
    key: "r",
    ctrl: true,
    shift: true,
    action: () => console.log("触发重置"),
    description: "重置当前状态",
    category: "操作",
  },
  {
    key: "g",
    ctrl: true,
    shift: true,
    action: () => console.log("切换到知识图谱视图"),
    description: "切换到知识图谱视图",
    category: "视图",
  },
  {
    key: "c",
    ctrl: true,
    shift: true,
    action: () => console.log("切换到控制台视图"),
    description: "切换到系统控制台",
    category: "视图",
  },
];
