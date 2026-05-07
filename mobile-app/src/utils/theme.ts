export const colors = {
  primary: '#00ffff',
  secondary: '#ff00ff',
  accent: '#ffff00',
  success: '#00ff88',
  warning: '#ffaa00',
  error: '#ff4444',
  
  background: '#0a0a0f',
  backgroundSecondary: '#12121a',
  backgroundTertiary: '#1a1a25',
  
  text: '#ffffff',
  textSecondary: '#a0a0b0',
  textMuted: '#606070',
  
  border: '#2a2a3a',
  borderLight: '#3a3a4a',
  
  neonGlow: {
    cyan: 'rgba(0, 255, 255, 0.5)',
    magenta: 'rgba(255, 0, 255, 0.5)',
    yellow: 'rgba(255, 255, 0, 0.5)',
  },
  
  nodeTypes: {
    concept: '#00ffff',
    entity: '#ff00ff',
    topic: '#ffff00',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const typography = {
  fontSizes: {
    xs: 10,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
  fontWeights: {
    normal: '400' as const,
    medium: '500' as const,
    bold: '700' as const,
  },
};

export const shadows = {
  neon: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
  },
  glow: {
    shadowColor: colors.secondary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 15,
    elevation: 15,
  },
};

export const gradients = {
  primary: ['#0a0a0f', '#12121a'],
  neon: ['rgba(0, 255, 255, 0.1)', 'rgba(255, 0, 255, 0.1)'],
};
