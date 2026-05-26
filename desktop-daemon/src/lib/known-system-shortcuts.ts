/**
 * 已知系统快捷键列表（用于冲突检测）
 *
 * 覆盖 Windows/macOS/Linux 最常见的 25 个系统级快捷键。
 * 格式统一为小写 + 排序后的修饰符组合，与 omni 快捷键格式一致。
 */

export interface KnownSystemShortcut {
  combo: string;      // 标准化组合键 e.g. "ctrl+c"
  labelZh: string;    // 中文名称
  labelEn: string;    // English name
}

// 排序键位组合为标准形式 "ctrl+shift+p"
function normalize(keys: string[]): string {
  const order = ['ctrl', 'cmd', 'alt', 'shift', 'win'];
  const sorted = [...keys].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return sorted.join('+');
}

// --- Windows / Linux 通用 ---
const COMMON: KnownSystemShortcut[] = [
  { combo: normalize(['ctrl', 'c']), labelZh: '复制', labelEn: 'Copy' },
  { combo: normalize(['ctrl', 'v']), labelZh: '粘贴', labelEn: 'Paste' },
  { combo: normalize(['ctrl', 'x']), labelZh: '剪切', labelEn: 'Cut' },
  { combo: normalize(['ctrl', 'z']), labelZh: '撤销', labelEn: 'Undo' },
  { combo: normalize(['ctrl', 'y']), labelZh: '重做', labelEn: 'Redo' },
  { combo: normalize(['ctrl', 'a']), labelZh: '全选', labelEn: 'Select All' },
  { combo: normalize(['ctrl', 's']), labelZh: '保存', labelEn: 'Save' },
  { combo: normalize(['ctrl', 'f']), labelZh: '查找', labelEn: 'Find' },
  { combo: normalize(['ctrl', 'h']), labelZh: '替换', labelEn: 'Replace' },
  { combo: normalize(['ctrl', 'p']), labelZh: '打印', labelEn: 'Print' },
  { combo: normalize(['ctrl', 'n']), labelZh: '新建', labelEn: 'New' },
  { combo: normalize(['ctrl', 'o']), labelZh: '打开', labelEn: 'Open' },
  { combo: normalize(['ctrl', 'w']), labelZh: '关闭标签', labelEn: 'Close Tab' },
  { combo: normalize(['ctrl', 't']), labelZh: '新建标签', labelEn: 'New Tab' },
  { combo: normalize(['ctrl', 'tab']), labelZh: '切换标签', labelEn: 'Switch Tab' },
  { combo: normalize(['alt', 'f4']), labelZh: '关闭窗口', labelEn: 'Close Window' },
  { combo: normalize(['alt', 'tab']), labelZh: '切换窗口', labelEn: 'Switch Window' },
  { combo: normalize(['win', 'l']), labelZh: '锁屏', labelEn: 'Lock Screen' },
  { combo: normalize(['win', 'd']), labelZh: '显示桌面', labelEn: 'Show Desktop' },
  { combo: normalize(['win', 'r']), labelZh: '运行', labelEn: 'Run' },
  { combo: normalize(['win', 'e']), labelZh: '文件资源管理器', labelEn: 'File Explorer' },
  { combo: normalize(['ctrl', 'alt', 'del']), labelZh: '安全选项', labelEn: 'Security Options' },
  { combo: normalize(['ctrl', 'shift', 'esc']), labelZh: '任务管理器', labelEn: 'Task Manager' },
  { combo: normalize(['ctrl', 'shift', 't']), labelZh: '恢复标签', labelEn: 'Reopen Tab' },
  { combo: normalize(['ctrl', 'd']), labelZh: '书签', labelEn: 'Bookmark' },
];

// macOS 专用：Cmd 替代 Ctrl 的场景
const MAC_SPECIFIC: KnownSystemShortcut[] = [
  { combo: normalize(['cmd', 'q']), labelZh: '退出应用', labelEn: 'Quit App' },
  { combo: normalize(['cmd', 'space']), labelZh: 'Spotlight 搜索', labelEn: 'Spotlight' },
  { combo: normalize(['cmd', 'shift', '3']), labelZh: '全屏截图', labelEn: 'Screenshot' },
  { combo: normalize(['cmd', 'shift', '4']), labelZh: '区域截图', labelEn: 'Area Screenshot' },
  { combo: normalize(['cmd', 'shift', '5']), labelZh: '截图工具', labelEn: 'Screenshot Tool' },
];

// Cmd 等同于 Ctrl 的常用快捷键（macOS 上同时存在，避免未覆盖）
const MAC_CMD_ALIASES: KnownSystemShortcut[] = COMMON
  .filter(s => s.combo.startsWith('ctrl+'))
  .filter(s => !['ctrl+tab', 'ctrl+alt+del', 'ctrl+shift+esc'].includes(s.combo))
  .map(s => ({
    combo: s.combo.replace('ctrl+', 'cmd+'),
    labelZh: s.labelZh,
    labelEn: s.labelEn,
  }));

export const KNOWN_SYSTEM_SHORTCUTS: KnownSystemShortcut[] = [
  ...COMMON,
  ...MAC_SPECIFIC,
  ...MAC_CMD_ALIASES,
];

/**
 * 将快捷键字符串标准化为可比较的形式。
 * macOS 上 Cmd 等价于 Windows/Linux 的 Ctrl。
 */
export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.toLowerCase().split('+').map(p => p.trim());
  // cmd ↔ ctrl 互转
  const mapped = parts.map(p => p === 'cmd' ? 'ctrl' : p);
  return normalize(mapped);
}

/**
 * 查找与给定快捷键冲突的已知系统快捷键。
 * 返回匹配项，或 null。
 */
export function findSystemConflict(shortcut: string): KnownSystemShortcut | null {
  const normalized = normalizeShortcut(shortcut);
  for (const s of KNOWN_SYSTEM_SHORTCUTS) {
    if (normalizeShortcut(s.combo) === normalized) return s;
  }
  return null;
}
