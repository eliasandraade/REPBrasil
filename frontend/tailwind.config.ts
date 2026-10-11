import type { Config } from "tailwindcss";

/** Token semântico (canais RGB em globals.css) com suporte a opacidade: `bg-surface`, `text-fg/80`. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

/**
 * Design system do REPBrasil (Brand Kit Oficial — docs/BRAND.md).
 *
 * Espaçamento: a escala padrão do Tailwind já é a escala de 4px da marca
 * (1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40, 12=48, 16=64, 20=80, 24=96).
 * Raios: rounded-lg=8 (sm), rounded-xl=12 (md), rounded-2xl=16 (lg), rounded-3xl=24 (xl), rounded-full (pill).
 */
const config: Config = {
  darkMode: ["variant", ["&:is([data-theme='dark'] *)", "@media (prefers-color-scheme: dark) { &:is(:root:not([data-theme='light']) *) }"]],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Superfícies
        canvas: token("canvas"),
        surface: token("surface"),
        subtle: token("surface-subtle"),
        // Texto
        fg: {
          DEFAULT: token("text-primary"),
          soft: token("text-soft"),
          muted: token("text-secondary"),
        },
        // Bordas
        line: {
          DEFAULT: token("border"),
          strong: token("border-strong"),
        },
        focus: token("focus"),
        // Interação
        accent: {
          DEFAULT: token("accent"),
          text: token("accent-text"),
          fg: token("on-accent"),
        },
        action: {
          DEFAULT: token("action"),
          fg: token("on-action"),
        },
        // Estados (sempre com rótulo/ícone)
        warn: token("warn"),
        danger: token("danger"),
        info: token("info"),
        positive: token("positive"),
        // Marca bruta — só para aplicações de marca (nunca dado, partido ou vencedor)
        brand: {
          navy: "#0B2D5B",
          green: "#0F9D58",
          teal: "#00BAA6",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      fontSize: {
        "display-xl": ["56px", { lineHeight: "64px", letterSpacing: "-0.02em", fontWeight: "750" }],
        "display-lg": ["44px", { lineHeight: "52px", letterSpacing: "-0.02em", fontWeight: "750" }],
        "heading-xl": ["36px", { lineHeight: "44px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "heading-lg": ["30px", { lineHeight: "38px", letterSpacing: "-0.015em", fontWeight: "700" }],
        "heading-md": ["24px", { lineHeight: "32px", letterSpacing: "-0.015em", fontWeight: "650" }],
        "heading-sm": ["20px", { lineHeight: "28px", letterSpacing: "-0.01em", fontWeight: "650" }],
        "body-lg": ["18px", { lineHeight: "28px" }],
        "body-md": ["16px", { lineHeight: "24px" }],
        "body-sm": ["14px", { lineHeight: "20px" }],
        label: ["12px", { lineHeight: "16px", letterSpacing: "0.06em", fontWeight: "600" }],
        micro: ["11px", { lineHeight: "14px" }],
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        card: "var(--shadow-md)",
        "card-hover": "var(--shadow-lg)",
      },
    },
  },
  plugins: [],
};

export default config;
