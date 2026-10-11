import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * Imagem social (Open Graph, 1200×630) com a identidade do REPBrasil — base de todos os modelos (político,
 * partido, município, estado, eleição, ranking, insight). Visual neutro: canvas claro, assinatura oficial
 * (asset derivado do Brand Kit, nunca recomposto), título em Inter, fonte dos dados no rodapé. Sem cor de
 * partido, sem foto de político, sem gradiente, sem marca d'água agressiva.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

export interface OgContent {
  /** Linha curta acima do título (ex.: "Eleições 2024 · Ceará"). */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Rodapé: fonte e recorte (ex.: "Fonte: TSE — Boletins de Urna"). */
  footnote?: string;
}

const root = process.cwd();
const asset = (path: string) => readFile(join(root, path));

async function brandFonts() {
  const dir = "node_modules/@fontsource/inter/files";
  const [regular, semibold, bold] = await Promise.all([
    asset(`${dir}/inter-latin-400-normal.woff`),
    asset(`${dir}/inter-latin-600-normal.woff`),
    asset(`${dir}/inter-latin-700-normal.woff`),
  ]);
  return [
    { name: "Inter", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Inter", data: semibold, weight: 600 as const, style: "normal" as const },
    { name: "Inter", data: bold, weight: 700 as const, style: "normal" as const },
  ];
}

/** Limita o título para caber em até 3 linhas sem cortar palavras no meio. */
export function fitTitle(title: string, max = 90): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 12)).trim()}…`;
}

export async function brandOgImage(content: OgContent): Promise<ImageResponse> {
  const [logo, fonts] = await Promise.all([asset("public/brand/logo-horizontal.png"), brandFonts()]);
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  const title = fitTitle(content.title);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#F5F8FB",
          padding: "56px 72px",
          fontFamily: "Inter",
          color: "#0B1F33",
          borderBottom: "12px solid #0B2D5B",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- satori só aceita <img> */}
        <img src={logoSrc} width={213} height={60} alt="REPBrasil" />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {content.eyebrow ? (
            <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#00756A" }}>
              {content.eyebrow}
            </div>
          ) : null}
          <div style={{ fontSize: title.length > 48 ? 56 : 68, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.02em" }}>{title}</div>
          {content.subtitle ? <div style={{ fontSize: 30, fontWeight: 400, color: "#5F7184", lineHeight: 1.3 }}>{content.subtitle}</div> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 22, color: "#5F7184" }}>
          <span style={{ fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>Inteligência Eleitoral</span>
          <span>{content.footnote ?? "Dados públicos oficiais"}</span>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
