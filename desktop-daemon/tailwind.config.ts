import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--color-bg)",
        foreground: "var(--color-fg)",
        card: "var(--color-bgSubtle)",
        "card-foreground": "var(--color-fg)",
        primary: "var(--color-accent)",
        secondary: "var(--color-bgSubtle)",
        muted: "var(--color-bgSubtle)",
        "muted-foreground": "var(--color-fgMuted)",
        border: "var(--color-border)",
        accent: "var(--color-accent)",
        "accent-foreground": "var(--color-fg)",
        destructive: "oklch(0.6137 0.2039 25.5645)",
        // 额外的快捷别名映射
        bg: "var(--color-bg)",
        "bg-subtle": "var(--color-bgSubtle)",
        fg: "var(--color-fg)",
        "fg-muted": "var(--color-fgMuted)",
      },
      boxShadow: {
        "neon-cyan": "0 0 20px rgba(34, 211, 238, 0.5), 0 0 40px rgba(34, 211, 238, 0.3)",
        "neon-green": "0 0 20px rgba(52, 211, 153, 0.5), 0 0 40px rgba(52, 211, 153, 0.3)",
      },
      animation: {
        "pulse-glow": "pulse-glow 2s infinite",
        "flow-line": "flow-line 2s linear infinite",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 5px rgba(34, 211, 238, 0.5)" },
          "50%": { boxShadow: "0 0 20px rgba(34, 211, 238, 0.8), 0 0 40px rgba(34, 211, 238, 0.4)" },
        },
        "flow-line": {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "100% 50%" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
