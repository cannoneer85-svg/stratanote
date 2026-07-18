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
          DEFAULT: "#121212",
          panel: "#181818",
          editor: "#1c1c1c",
          hover: "#262626",
          active: "#323232",
        },
        border: {
          DEFAULT: "rgba(255, 255, 255, 0.08)",
          hover: "rgba(255, 255, 255, 0.15)",
        },
        primary: {
          DEFAULT: "#9d4edd", // Beautiful Obsidian Purple
          hover: "#b5179e",
          glow: "rgba(157, 78, 221, 0.2)",
        },
        text: {
          DEFAULT: "#e0e0e0",
          muted: "#a0a0a0",
          disabled: "#626262",
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
