import type { CSSProperties } from "react";
/** Original pixels extracted from the supplied official sheet.
 * No reconstructed lettering, geometry or colors. Micro symbol has no map.
 * No resizing at extraction. Use independent official masters when supplied. */
export function BrandSymbol({
  size = 32,
  className = "",
}: Readonly<{ size?: number; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={`official-symbol ${className}`}
      style={{ "--symbol-size": `${size}px` } as CSSProperties}
    />
  );
}
export function BrandMark({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <span
      role="img"
      aria-label="REPBrasil, Inteligência Eleitoral"
      className={`official-brand ${compact ? "official-brand-compact" : ""}`}
    >
      <BrandSymbol size={32} />
      <span aria-hidden="true" className="official-wordmark" />
    </span>
  );
}
