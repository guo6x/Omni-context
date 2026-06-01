// Logo / Wordmark 组件
// 内联 SVG 避免在 Next static export 模式下还要管 public/ 资源；
// 设计源在 src-tauri/icons/{icon,wordmark}.svg，二者保持一致。

import React from 'react';

type Size = number | string;

export function LogoMark({ size = 32, className }: { size?: Size; className?: string }) {
  const id = React.useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-ink`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7df9ff" />
          <stop offset="55%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#0ea5c4" />
        </linearGradient>
        <radialGradient id={`${id}-core`} cx="50%" cy="45%" r="58%">
          <stop offset="0%" stopColor="#e6fdff" />
          <stop offset="100%" stopColor="#19c4e0" />
        </radialGradient>
      </defs>
      {/* 圆相：一笔书法墨圆（右侧留缺口、三段渐变笔锋：右细 → 左厚） */}
      <path d="M84.2 38.9 A36 36 0 1 0 84.2 61.1" fill="none" stroke={`url(#${id}-ink)`} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M62.3 16.2 A36 36 0 1 0 62.3 83.8" fill="none" stroke={`url(#${id}-ink)`} strokeWidth="6.5" strokeLinecap="round" />
      <path d="M26.9 22.4 A36 36 0 0 0 26.9 77.6" fill="none" stroke={`url(#${id}-ink)`} strokeWidth="8.5" strokeLinecap="round" />
      {/* 内部几何图谱：核心 + 三节点（西式精准，与墨环的柔形成对比） */}
      <g stroke="#7df9ff" strokeWidth="2.6" opacity="0.6" strokeLinecap="round">
        <line x1="50" y1="51" x2="50" y2="32" />
        <line x1="50" y1="51" x2="68" y2="61" />
        <line x1="50" y1="51" x2="33" y2="61" />
      </g>
      <circle cx="50" cy="32" r="5" fill="#00f2fe" />
      <circle cx="68" cy="61" r="4.5" fill="#a855f7" />
      <circle cx="33" cy="61" r="4.5" fill="#22d3ee" />
      <circle cx="50" cy="51" r="9" fill={`url(#${id}-core)`} />
    </svg>
  );
}

export function Wordmark({ height = 32, className }: { height?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`} aria-label="Omni-Context">
      <LogoMark size={height} />
      <span
        className="font-bold tracking-wider bg-clip-text text-transparent"
        style={{
          fontSize: Math.round(height * 0.6),
          backgroundImage:
            'linear-gradient(90deg, #7df9ff 0%, #00f2fe 60%, #a855f7 100%)',
        }}
      >
        OMNI-CONTEXT
      </span>
    </span>
  );
}

export default LogoMark;
