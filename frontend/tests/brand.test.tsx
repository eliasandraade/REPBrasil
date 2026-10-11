import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo, clearSpace, minHeight, symbolAssetFor } from "@/components/brand/Logo";
import manifest from "@/app/manifest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf-8");
const globals = read("src/app/globals.css");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Bloco de declarações de um seletor (primeira ocorrência). */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unclosed ${selector}`);
}

function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].replace(/\/\*.*?\*\//g, "").trim();
  return out;
}

function luminance([r, g, b]: number[]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const rgb = (value: string) => value.split(/\s+/).map(Number);
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const light = tokens(block(globals, ":root {"));
const dark = tokens(block(globals, ':root[data-theme="dark"] {'));
const darkBySystem = tokens(block(globals, ':root:where(:not([data-theme="light"])) {'));
const onSubtleLight = tokens(block(globals, ':root[data-theme="light"] .bg-subtle {'));

describe("Brand Kit — tokens", () => {
  it("usa o teal oficial #00BAA6 e nunca o antigo #00B4A6 nem o verde-menta anterior", () => {
    expect(light["brand-teal"].toLowerCase()).toBe("#00baa6");
    expect(light.focus).toBe("0 186 166");
    const files = [...walk(resolve(root, "src")), resolve(root, "tailwind.config.ts")].filter((f) => /\.(tsx?|css)$/.test(f));
    for (const file of files) {
      const text = readFileSync(file, "utf-8").toLowerCase();
      expect(text.includes("#00b4a6"), file).toBe(false);
      expect(text.includes("#0dd48e"), file).toBe(false);
    }
  });

  it("paleta central e neutros do produto exatamente como no Brand Kit (claro e escuro)", () => {
    expect([light["brand-navy"], light["brand-green"], light["brand-white"]].map((v) => v.toLowerCase())).toEqual(["#0b2d5b", "#0f9d58", "#ffffff"]);
    expect([light.canvas, light.surface, light["surface-subtle"], light["text-primary"], light["text-secondary"], light.border]).toEqual([
      "245 248 251", "255 255 255", "238 243 247", "11 31 51", "95 113 132", "220 229 237",
    ]);
    expect([dark.canvas, dark.surface, dark["surface-subtle"], dark["text-primary"], dark["text-secondary"], dark.border, dark.focus]).toEqual([
      "7 26 46", "13 39 68", "16 47 80", "247 250 252", "169 187 203", "29 58 86", "35 214 194",
    ]);
  });

  it("tema escuro pelo sistema e por data-theme são idênticos (paridade)", () => {
    expect(darkBySystem).toEqual(dark);
  });

  it("todo token de texto passa WCAG AA (4,5:1) sobre canvas, superfície e sutil, nos dois temas", () => {
    for (const theme of [light, { ...light, ...dark }]) {
      const isLight = theme === light;
      for (const text of ["text-primary", "text-soft", "text-secondary", "accent-text", "warn", "danger", "info", "positive"]) {
        for (const bg of ["canvas", "surface", "surface-subtle"]) {
          // sobre a superfície sutil do tema claro vale o passo acessível do texto secundário
          const fg = isLight && bg === "surface-subtle" && onSubtleLight[text] ? onSubtleLight[text] : theme[text];
          expect(contrast(fg, theme[bg]), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(theme["on-action"], theme.action), "ação primária").toBeGreaterThanOrEqual(4.5);
    }
  });

  it("anel de foco: núcleo com contraste ≥ 3:1 sobre os fundos (o teal sozinho não alcança no claro)", () => {
    for (const theme of [light, { ...light, ...dark }]) {
      const ring = Math.max(contrast(theme["focus-inner"], theme.canvas), contrast(theme.focus, theme.canvas));
      expect(ring).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("Brand Kit — logo responsiva", () => {
  it("abaixo de 64px o símbolo usa a versão micro oficial (sem mapa)", () => {
    expect(symbolAssetFor(128)).toBe("symbol");
    expect(symbolAssetFor(64)).toBe("symbol");
    expect(symbolAssetFor(63)).toBe("micro");
    expect(symbolAssetFor(16)).toBe("micro");
  });

  it("tamanhos mínimos oficiais: assinatura completa ≥ 160px, reduzida ≥ 112px de largura", () => {
    expect(Math.round(minHeight("signature") * (950 / 267))).toBeGreaterThanOrEqual(160);
    expect(Math.round(minHeight("horizontal") * (947 / 267))).toBeGreaterThanOrEqual(112);
    const { container } = render(<Logo variant="horizontal" height={10} />);
    const img = container.querySelector("img")!;
    expect(Number(img.getAttribute("width"))).toBeGreaterThanOrEqual(112); // nunca esmagada
  });

  it("assinatura negativa no tema escuro; símbolo único nos dois temas", () => {
    const { container } = render(<Logo variant="horizontal" height={34} alt="" />);
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.map((i) => i.className)).toEqual(["theme-light-only", "theme-dark-only"]);
    expect(imgs[1].getAttribute("src")).toContain("logo-horizontal-negative");
    const symbol = render(<Logo variant="symbol" height={32} alt="" />).container.querySelectorAll("img");
    expect(symbol).toHaveLength(1);
    expect(symbol[0].getAttribute("src")).toContain("symbol-micro");
  });

  it("área de proteção 1X ≈ largura da haste do R", () => {
    expect(clearSpace(34)).toBe(9);
    const { container } = render(<Logo variant="horizontal" height={34} clearSpaceIncluded />);
    expect((container.firstChild as HTMLElement).style.padding).toBe("9px");
  });
});

describe("Brand Kit — assets", () => {
  const meta = JSON.parse(read("public/brand/assets.json"));

  it("assets derivados do quadro oficial, com origem e SHA-256 registrados", () => {
    expect(meta.source.sha256).toBe("1884bd876b9bb1866e4f4a3ccdd4b71ed974269bfd781c1de1eee7761444d0c1");
    expect(meta.method).toMatch(/no redrawing/);
    for (const name of Object.keys(meta.assets)) expect(existsSync(resolve(root, "public/brand", name)), name).toBe(true);
  });

  it("favicon, ícones PWA e Apple existem; nenhum ícone de urna", () => {
    for (const icon of manifest().icons ?? []) expect(existsSync(resolve(root, "public", icon.src.slice(1))), icon.src).toBe(true);
    expect(existsSync(resolve(root, "public/favicon.ico"))).toBe(true);
    expect(existsSync(resolve(root, "public/brand/apple-touch-icon.png"))).toBe(true);
    expect(existsSync(resolve(root, "src/app/icon.svg"))).toBe(false);
    expect(existsSync(resolve(root, "src/components/brand/BrandMark.tsx"))).toBe(false);
  });

  it("manifesto em pt-BR com o nome oficial", () => {
    const m = manifest();
    expect(m.short_name).toBe("REPBrasil");
    expect(m.name).toBe("REPBrasil — Inteligência Eleitoral");
    expect(m.lang).toBe("pt-BR");
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
  });
});
