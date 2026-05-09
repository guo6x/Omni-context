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
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-cyan`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f2fe" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id={`${id}-purple`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7000ff" />
        </linearGradient>
        <radialGradient id={`${id}-core`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#7df9ff" />
          <stop offset="100%" stopColor="#00bcd4" />
        </radialGradient>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g transform="translate(256 256)">
        <circle r="172" fill="none" stroke={`url(#${id}-cyan)`} strokeWidth="14" opacity="0.95" />
        <g stroke={`url(#${id}-cyan)`} strokeWidth="3" opacity="0.4" strokeLinecap="round">
          <line x1="0" y1="-172" x2="0" y2="-58" />
          <line x1="149" y1="-86" x2="50" y2="-29" />
          <line x1="149" y1="86" x2="50" y2="29" />
          <line x1="0" y1="172" x2="0" y2="58" />
          <line x1="-149" y1="86" x2="-50" y2="29" />
          <line x1="-149" y1="-86" x2="-50" y2="-29" />
        </g>
        <g filter={`url(#${id}-glow)`}>
          <circle cx="0" cy="-172" r="22" fill={`url(#${id}-cyan)`} />
          <circle cx="149" cy="-86" r="20" fill={`url(#${id}-purple)`} />
          <circle cx="149" cy="86" r="20" fill={`url(#${id}-purple)`} />
          <circle cx="0" cy="172" r="22" fill={`url(#${id}-cyan)`} />
          <circle cx="-149" cy="86" r="20" fill={`url(#${id}-purple)`} />
          <circle cx="-149" cy="-86" r="20" fill={`url(#${id}-purple)`} />
        </g>
        <circle r="58" fill={`url(#${id}-core)`} filter={`url(#${id}-glow)`} />
        <circle r="22" fill="#ffffff" opacity="0.95" />
      </g>
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
