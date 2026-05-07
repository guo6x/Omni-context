"use client";

import { X, Keyboard } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action?: () => void;
  description: string;
  category: string;
}

interface ShortcutsHelpProps {
  shortcuts: KeyboardShortcut[];
  onClose: () => void;
}

export default function ShortcutsHelp({ shortcuts, onClose }: ShortcutsHelpProps) {
  const { t } = useTranslation();
  
  const groupedShortcuts = shortcuts.reduce((acc, shortcut) => {
    const category = shortcut.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(shortcut);
    return acc;
  }, {} as Record<string, KeyboardShortcut[]>);

  const formatKey = (shortcut: KeyboardShortcut) => {
    const keys: string[] = [];
    if (shortcut.ctrl) keys.push("Ctrl");
    if (shortcut.shift) keys.push("Shift");
    if (shortcut.alt) keys.push("Alt");
    keys.push(shortcut.key.toUpperCase());
    return keys.join(" + ");
  };

  return (
    <div className="absolute top-4 right-4 z-50 w-96 glass-panel p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Keyboard className="w-5 h-5 text-cyan-400" />
          <h3 className="text-lg font-semibold text-cyan-400">{t('shortcuts.help')}</h3>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-6">
        {Object.entries(groupedShortcuts).map(([category, items]) => (
          <div key={category}>
            <h4 className="text-sm font-medium text-gray-400 mb-2 uppercase tracking-wider">
              {category}
            </h4>
            <div className="space-y-2">
              {items.map((shortcut, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-2 px-3 bg-black/20 rounded-lg border border-white/5 hover:border-cyan-900/50 transition-colors"
                >
                  <span className="text-sm text-gray-300">{shortcut.description}</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-cyan-900/30 text-cyan-400 border border-cyan-800 rounded">
                    {formatKey(shortcut)}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-white/10">
        <p className="text-xs text-gray-500 text-center">
          {t('shortcuts.help_desc')}
        </p>
      </div>
    </div>
  );
}
