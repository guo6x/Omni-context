/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{html,js}"],
  theme: {
    extend: {
      colors: {
        background: "#0a0b12",
        foreground: "#e8e8e8",
      },
      animation: {
        'flow-line': 'flow-line 2s linear infinite',
      },
      keyframes: {
        'flow-line': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        }
      }
    },
  },
  plugins: [],
}
