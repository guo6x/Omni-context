/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0a0b12",
        foreground: "#e8e8e8",
        cyan: {
          400: "#22d3ee",
          900: "#164e63",
        },
        purple: {
          400: "#c084fc",
          600: "#9333ea",
          900: "#581c87",
        }
      }
    },
  },
  plugins: [],
}
