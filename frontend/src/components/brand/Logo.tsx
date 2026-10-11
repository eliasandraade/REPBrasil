import Image from "next/image";

/**
 * Marca oficial do REPBrasil (Brand Kit Oficial — docs/BRAND.md).
 *
 * Os arquivos em /public/brand são DERIVADOS do quadro oficial de diretrizes (recorte + transparência,
 * scripts/brand/derive_assets.py): nada é redesenhado, nem o símbolo, nem o mapa, nem o wordmark.
 *
 * Regras aplicadas aqui (não em cada tela):
 * - responsivo: símbolo com mapa só a partir de 64px; abaixo disso, a versão micro oficial sem mapa;
 * - tamanhos mínimos: assinatura completa ≥ 160px de largura; reduzida ≥ 112px; micro ≥ 24px;
 * - área de proteção: 1X ao redor (X = largura da haste vertical do R ≈ 0,26 da largura do símbolo);
 * - tema escuro: assinatura negativa (wordmark/descriptor brancos), símbolo sem alteração de cor.
 */

export type LogoVariant = "signature" | "horizontal" | "symbol";

interface Asset {
  light: string;
  dark?: string;
  /** largura ÷ altura do arquivo derivado */
  ratio: number;
  minWidth: number;
}

const ASSETS: Record<"signature" | "horizontal" | "symbol" | "micro", Asset> = {
  signature: { light: "/brand/logo-primary.png", dark: "/brand/logo-primary-negative.png", ratio: 950 / 267, minWidth: 160 },
  horizontal: { light: "/brand/logo-horizontal.png", dark: "/brand/logo-horizontal-negative.png", ratio: 947 / 267, minWidth: 112 },
  symbol: { light: "/brand/symbol.png", ratio: 283 / 267, minWidth: 64 },
  micro: { light: "/brand/symbol-micro.png", ratio: 62 / 59, minWidth: 24 },
};

/** X da área de proteção, em px, para uma altura de logo (largura do símbolo = altura × 283/267). */
export const clearSpace = (height: number) => Math.round(height * (283 / 267) * (74 / 283));

/** Qual arquivo oficial usar para um símbolo de `size` px (regra responsiva do Brand Kit). */
export function symbolAssetFor(size: number): "symbol" | "micro" {
  return size >= 64 ? "symbol" : "micro";
}

/** Altura mínima (px) para que a variante respeite a largura mínima oficial. */
export function minHeight(variant: LogoVariant): number {
  const asset = ASSETS[variant];
  return Math.ceil(asset.minWidth / asset.ratio);
}

interface LogoProps {
  variant: LogoVariant;
  /** Altura em px CSS. É elevada ao mínimo oficial da variante, nunca reduzida abaixo dele. */
  height: number;
  /** Texto alternativo; vazio quando o logo está dentro de um link/rótulo que já diz "REPBrasil". */
  alt?: string;
  /** Carregamento prioritário (logo acima da dobra). */
  priority?: boolean;
  /** Inclui a área de proteção (1X) como padding. */
  clearSpaceIncluded?: boolean;
  className?: string;
}

export function Logo({ variant, height, alt = "REPBrasil", priority = false, clearSpaceIncluded = false, className }: Readonly<LogoProps>) {
  const key = variant === "symbol" ? symbolAssetFor(height) : variant;
  const asset = ASSETS[key];
  const h = Math.max(height, Math.ceil(asset.minWidth / asset.ratio));
  const w = Math.round(h * asset.ratio);
  const pad = clearSpaceIncluded ? clearSpace(h) : 0;
  const common = { width: w, height: h, priority, sizes: `${w}px`, draggable: false } as const;

  return (
    <span
      className={`inline-flex shrink-0 items-center ${className ?? ""}`}
      style={pad ? { padding: pad } : undefined}
      data-logo={key}
    >
      {asset.dark ? (
        <>
          <Image src={asset.light} alt={alt} className="theme-light-only" {...common} />
          <Image src={asset.dark} alt={alt} className="theme-dark-only" {...common} />
        </>
      ) : (
        <Image src={asset.light} alt={alt} {...common} />
      )}
    </span>
  );
}
