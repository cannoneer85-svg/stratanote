/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "var(--bg-main)",
          panel: "var(--bg-panel)",
          editor: "var(--bg-editor)",
          hover: "var(--bg-hover)",
          active: "var(--bg-active)",
        },
        border: {
          DEFAULT: "var(--border-color)",
          hover: "var(--border-hover)",
        },
        primary: {
          DEFAULT: "rgb(var(--primary-rgb) / <alpha-value>)",
          hover: "var(--primary-hover)",
          glow: "var(--primary-glow)",
        },
        text: {
          DEFAULT: "var(--text-main)",
          muted: "var(--text-muted)",
          disabled: "var(--text-disabled)",
        }
      },
      fontFamily: {
        sans: ["Outfit", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      backdropBlur: {
        glass: "12px",
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        glow: "0 0 15px rgba(157, 78, 221, 0.4)",
      }
    },
  },
  plugins: [],
}
