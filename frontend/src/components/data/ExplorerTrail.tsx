"use client";

/**
 * Trilha territorial Brasil › UF › município. Cada nível acima volta o mapa para lá (câmera e camada); o novo
 * segmento entra estendendo o caminho (`crumb-extend`).
 */
export function ExplorerTrail({
  stateName,
  municipalityName,
  onCountry,
  onState,
}: Readonly<{
  stateName: string | null;
  municipalityName: string | null;
  onCountry: () => void;
  onState: () => void;
}>) {
  const step = "focus-ring mi-underline rounded text-fg-soft hover:text-fg";
  return (
    <nav aria-label="Trilha territorial" data-testid="explorer-trail">
      <ol className="flex flex-wrap items-center gap-1.5 text-body-sm">
        <li>
          {stateName ? (
            <button type="button" onClick={onCountry} className={step}>Brasil</button>
          ) : (
            <span aria-current="location" className="font-semibold text-fg">Brasil</span>
          )}
        </li>
        {stateName && (
          <li key={`uf:${stateName}`} className="crumb-extend flex items-center gap-1.5">
            <span aria-hidden="true" className="text-fg-muted">›</span>
            {municipalityName ? (
              <button type="button" onClick={onState} className={step}>{stateName}</button>
            ) : (
              <span aria-current="location" className="font-semibold text-fg">{stateName}</span>
            )}
          </li>
        )}
        {municipalityName && (
          <li key={`mun:${municipalityName}`} className="crumb-extend flex items-center gap-1.5">
            <span aria-hidden="true" className="text-fg-muted">›</span>
            <span aria-current="location" className="font-semibold text-fg">{municipalityName}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}
