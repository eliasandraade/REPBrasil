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
        background: "#0a0f16",
        sidebar: "#070b12",
        card: "#0d1520",
        "card-elevated": "#111d2e",
        brand: {
          DEFAULT: "#0dd48e",
          dark: "#09a870",
          light: "#38e8b0",
        },
      },
      boxShadow: {
        brand: "0 0 28px rgba(13, 212, 142, 0.3)",
        "brand-sm": "0 0 14px rgba(13, 212, 142, 0.18)",
        card: "0 4px 28px rgba(0, 0, 0, 0.45)",
        "card-hover": "0 8px 36px rgba(0, 0, 0, 0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
