export interface Theme {
  id: string;
  name: string; // locale key
  bg: string;
  bgSubtle: string;
  fg: string;
  fgMuted: string;
  accent: string;
  accentHover: string;
  border: string;
  focusRing?: string;
  graphNodeColors: {
    person: string;
    concept: string;
    project: string;
    code_snippet: string;
    decision: string;
    principle: string;
  };
}

export type ThemeId = 'neutral-dark' | 'cyberpunk' | 'soft-light' | 'sepia' | 'high-contrast';

export const THEMES: Record<ThemeId, Theme> = {
  'neutral-dark': {
    id: 'neutral-dark',
    name: 'settings.theme_neutral_dark',
    bg: '#0d0d0f',
    bgSubtle: '#1a1a1c',
    fg: '#e8e8ea',
    fgMuted: '#9090a0',
    accent: '#3b82f6',   // blue
    accentHover: '#60a5fa',
    border: '#2a2a2e',
    graphNodeColors: { person: '#60a5fa', concept: '#a78bfa', project: '#34d399', code_snippet: '#fbbf24', decision: '#f472b6', principle: '#94a3b8' }
  },
  'cyberpunk': {
    id: 'cyberpunk',
    name: 'settings.theme_cyberpunk',
    bg: '#0a0b12',
    bgSubtle: '#161726',
    fg: '#e8e8e8',
    fgMuted: '#9aa0b0',
    accent: '#7df9ff',   // cyan
    accentHover: '#7c3aed', // purple
    border: '#2b2c3d',
    graphNodeColors: { person: '#22d3ee', concept: '#a78bfa', project: '#34d399', code_snippet: '#fbbf24', decision: '#f472b6', principle: '#94a3b8' }
  },
  'soft-light': {
    id: 'soft-light',
    name: 'settings.theme_soft_light',
    bg: '#fafafa',
    bgSubtle: '#f0f0f0',
    fg: '#1a1a1a',
    fgMuted: '#666666',
    accent: '#2563eb',
    accentHover: '#3b82f6',
    border: '#e5e5e5',
    graphNodeColors: { person: '#2563eb', concept: '#7c3aed', project: '#059669', code_snippet: '#d97706', decision: '#db2777', principle: '#475569' }
  },
  'sepia': {
    id: 'sepia',
    name: 'settings.theme_sepia',
    bg: '#f4ecd8',
    bgSubtle: '#e8dfc0',
    fg: '#3d2c14',
    fgMuted: '#7a6650',
    accent: '#a0522d',
    accentHover: '#cd853f',
    border: '#d4c8a8',
    graphNodeColors: { person: '#a0522d', concept: '#8b4513', project: '#556b2f', code_snippet: '#b8860b', decision: '#b22222', principle: '#6b8e23' }
  },
  'high-contrast': {
    id: 'high-contrast',
    name: 'settings.theme_high_contrast',
    bg: '#000000',
    bgSubtle: '#1a1a1a',
    fg: '#ffffff',
    fgMuted: '#cccccc',
    accent: '#ffff00',
    accentHover: '#ffff33',
    border: '#ffffff',
    focusRing: '#ffff00 solid 3px',
    graphNodeColors: { person: '#55ff55', concept: '#ff55ff', project: '#55ffff', code_snippet: '#ffff55', decision: '#ff5555', principle: '#ffffff' }
  }
};

// 15种实体类型到6种核心配色的映射，其余类型可以平滑降级
export const NODE_TYPE_TO_THEME_KEY: Record<string, keyof Theme['graphNodeColors']> = {
  person: 'person',
  project: 'project',
  concept: 'concept',
  code_snippet: 'code_snippet',
  decision: 'decision',
  principle: 'principle',
  
  // 映射其它类型：
  tool: 'code_snippet',
  evidence: 'principle',
  security_rule: 'decision',
  performance_optimization: 'concept',
  architecture_pattern: 'principle',
  bug_vulnerability: 'decision',
  business_logic: 'concept',
  critical_review: 'decision',
  capture_snapshot: 'principle',
  memory: 'concept',
  goal: 'decision',
  task: 'project',
  question: 'concept',
  preference: 'principle',
  event: 'person',
};
