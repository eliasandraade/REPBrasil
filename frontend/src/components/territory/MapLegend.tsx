import type { CanvasLegend } from "@/lib/territory/layers";

/** Legenda do mapa: classes, categorias ou gradiente, sempre com o que a cor significa. Só texto e amostras. */
export function MapLegend({ legend, heading }: Readonly<{ legend: CanvasLegend; heading?: string }>) {
  return (
    <div className="text-micro text-fg-soft" data-testid="map-legend">
      <p className="font-semibold text-fg">
        {heading && <span className="text-fg-muted">{heading} · </span>}
        {legend.title}
      </p>
      {legend.kind === "gradient" ? (
        <div className="mt-1">
          <div className="h-1.5 w-40 rounded-sm" style={{ background: `linear-gradient(90deg, ${legend.from}, ${legend.to})` }} />
          <div className="mt-0.5 flex w-40 justify-between text-fg-muted">
            <span>{legend.min}</span>
            <span>{legend.max}</span>
          </div>
        </div>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {legend.items.slice(0, 8).map((item) => (
            <li key={`${item.color}:${item.label}`} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-[2px] border border-fg/10" style={{ background: item.color }} aria-hidden="true" />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
      {legend.note && <p className="mt-1 max-w-[16rem] text-fg-muted">{legend.note}</p>}
    </div>
  );
}
