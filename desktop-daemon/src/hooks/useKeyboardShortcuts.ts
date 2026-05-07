"use client";

import { useEffect, useRef } from "react";

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
  category: string;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  // 调用方一般传字面量数组，每次渲染都是新引用；
  // 用 ref 持有最新值，避免 listener 每次渲染都重新挂载
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 用户在输入框 / 文本域里打字时不应触发全局快捷键，否则 preventDefault 会吃掉字符
      if (isEditableTarget(event.target)) return;

      for (const shortcut of shortcutsRef.current) {
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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
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
