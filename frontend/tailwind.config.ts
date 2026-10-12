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
        // Texto secundário com contraste WCAG AA (≥ 4,5:1) sobre o fundo e os cartões escuros:
        // os tons padrão (#64748b, #475569) davam 4:1 e 2,6:1.
        slate: { 400: "#A9BBCB", 500: "#A9BBCB", 600: "#9CAFC1", 700: "#8FA6BA" },
        background: "#071A2E",
        sidebar: "#071A2E",
        card: "#0D2744",
        "card-elevated": "#102F50",
        brand: {
          DEFAULT: "#00BAA6",
          dark: "#0F9D58",
          light: "#23D6C2",
        },
      },
      boxShadow: {
        brand: "0 4px 20px rgba(7, 26, 46, 0.15)",
        "brand-sm": "0 2px 8px rgba(7, 26, 46, 0.1)",
        card: "0 4px 28px rgba(0, 0, 0, 0.45)",
        "card-hover": "0 8px 36px rgba(0, 0, 0, 0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
