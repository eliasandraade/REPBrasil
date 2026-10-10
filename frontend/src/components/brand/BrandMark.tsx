/**
 * Marca do REPBrasil: urna estilizada com três barras de resultado (a última, mais alta, na cor da marca).
 * Desenhada em SVG inline — sem arquivo externo, nítida em qualquer tamanho e sem requisição extra.
 */
export function BrandSymbol({ size = 28, className }: Readonly<{ size?: number; className?: string }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0dd48e" fillOpacity="0.1" stroke="#0dd48e" strokeOpacity="0.35" />
      <path d="M9 9.5h14" stroke="#0dd48e" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="8.5" y="17" width="3.6" height="7" rx="1" fill="#94a3b8" fillOpacity="0.55" />
      <rect x="14.2" y="14" width="3.6" height="10" rx="1" fill="#94a3b8" fillOpacity="0.8" />
      <rect x="19.9" y="11.5" width="3.6" height="12.5" rx="1" fill="#0dd48e" />
    </svg>
  );
}

/** Símbolo + nome. O nome é texto (acessível e selecionável), não imagem. */
export function BrandMark({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandSymbol size={compact ? 26 : 30} />
      <span className={`${compact ? "text-[15px]" : "text-base"} leading-none tracking-tight`}>
        <span className="font-black text-slate-50">REP</span>
        <span className="font-semibold text-slate-300">Brasil</span>
      </span>
    </span>
  );
}
