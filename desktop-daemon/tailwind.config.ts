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
        background: "oklch(0.1363 0.0364 259.2010)",
        foreground: "oklch(0.9288 0.0126 255.5078)",
        card: "oklch(0.1721 0.0324 268.8777)",
        "card-foreground": "oklch(0.9288 0.0126 255.5078)",
        primary: "oklch(0.8758 0.2303 152.0212)",
        secondary: "oklch(0.2795 0.0368 260.0310)",
        muted: "oklch(0.2795 0.0368 260.0310)",
        "muted-foreground": "oklch(0.7107 0.0351 256.7878)",
        border: "oklch(0.2795 0.0368 260.0310)",
        accent: "oklch(0.2795 0.0368 260.0310)",
        "accent-foreground": "oklch(0.9288 0.0126 255.5078)",
        destructive: "oklch(0.6137 0.2039 25.5645)",
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
