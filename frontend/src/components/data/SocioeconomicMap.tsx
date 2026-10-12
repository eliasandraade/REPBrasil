"use client";

import { useMemo } from "react";
import { TerritoryMap } from "@/components/elections/TerritoryMap";
import { useResolvedTheme } from "@/components/theme/theme";
import { mix, SEQUENTIAL } from "@/lib/dataviz/palette";
import type { MapLayerView } from "@/lib/elections/map-layers";
import type { IndicatorValue } from "@/lib/data-intelligence";
import { useReducedMotion } from "@/motion/reduced-motion";

const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

export function SocioeconomicMap({
  values,
  period,
  label,
  unit,
}: Readonly<{
  values: IndicatorValue[];
  period: number;
  label: string;
  unit: string;
}>) {
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();
  const current = useMemo(() => values.filter((row) => row.period === period), [period, values]);

  const layer = useMemo<MapLayerView>(() => {
    const observed = current.map((row) => Number(row.value)).filter(Number.isFinite);
    const min = observed.length ? Math.min(...observed) : 0;
    const max = observed.length ? Math.max(...observed) : 0;
    const span = max - min;
    const palette = SEQUENTIAL[theme];
    const municipalities: MapLayerView["municipalities"] = {};
    const unitSuffix = unit ? ` ${unit}` : "";

    for (const row of current) {
      const value = Number(row.value);
      if (!Number.isFinite(value)) continue;
      const t = span === 0 ? 0.55 : (value - min) / span;
      municipalities[row.municipalityIbgeCode] = {
        color: mix(palette.low, palette.high, t),
        text: `${label}: ${number.format(value)}${unitSuffix}`,
      };
    }

    return {
      kind: "intensity",
      level: "municipality",
      municipalities,
      places: [],
      legend: [],
      gradient: {
        from: palette.low,
        to: palette.high,
        min: `${number.format(min)}${unitSuffix}`,
        max: `${number.format(max)}${unitSuffix}`,
      },
      note: "Escala sequencial do menor ao maior valor observado. Município sem cor não possui observação no recorte; ausência nunca é convertida em zero.",
    };
  }, [current, label, theme, unit]);

  if (current.length === 0) {
    return <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-muted">Sem observações municipais para desenhar o mapa neste período.</div>;
  }

  return (
    <section className="space-y-3" data-testid="socioeconomic-map">
      <div>
        <h2 className="font-semibold text-fg">Mapa socioeconômico</h2>
        <p className="mt-1 text-sm text-fg-muted">{label} · Ceará · {period}. A cor representa magnitude, não partido, ideologia ou avaliação.</p>
      </div>
      <div className="min-h-[420px] sm:min-h-[520px]">
        <TerritoryMap
          level="state"
          routeKey={`dados:${period}:${label}`}
          scope={{
            state: "23",
            municipality: null,
            interactiveStates: [],
            highlightStates: ["23"],
            interactiveMunicipalities: [],
            highlightMunicipalities: current.map((row) => row.municipalityIbgeCode),
          }}
          points={[]}
          reduced={reduced}
          onSelect={() => undefined}
          onSelectPlace={() => undefined}
          layer={layer}
        />
      </div>
      <p className="text-xs leading-5 text-fg-muted">{layer.note}</p>
    </section>
  );
}
