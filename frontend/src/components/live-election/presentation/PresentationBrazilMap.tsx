"use client";

import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { standingOf } from "@/lib/live-election/derive";
import { labelAnchor, type BrazilMapShapes } from "@/lib/live-election/map-shapes";
import type { LiveCandidate, TerritoryResult } from "@/lib/live-election/types";
import { describeState, fillFor } from "../BrazilElectionMap";
import { useLive } from "../LiveContext";

/** Mesma folga à direita da página para os rótulos deslocados das UFs pequenas do litoral. */
const LABEL_PAD = 90;
/** Espessura da placa (unidades da viewBox) e deslocamento da sombra de contato. */
const DEPTH = 9;
const SHADOW = 30;

interface UfPathProps {
  uf: string;
  d: string;
  fill: string;
  hatch: boolean;
  selected: boolean;
  label: string;
  onSelect: (uf: string) => void;
}

/** Uma UF: só renderiza de novo quando a própria cor, a hachura, a seleção ou o rótulo mudam. */
const UfPath = memo(function UfPath({ uf, d, fill, hatch, selected, label, onSelect }: Readonly<UfPathProps>) {
  return (
    <g>
      <path
        d={d}
        className="pm-uf"
        style={{ fill }}
        data-uf={uf}
        data-selected={selected ? "true" : undefined}
        onClick={() => onSelect(uf)}
      >
        <title>{label}</title>
      </path>
      {hatch ? <path d={d} fill="url(#pm-hatch)" pointerEvents="none" /> : null}
    </g>
  );
});

/** Laterais da placa (falsa extrusão): a mesma malha deslocada para baixo, mais escura. */
const UfSide = memo(function UfSide({ d, fill }: Readonly<{ d: string; fill: string }>) {
  return <path d={d} transform={`translate(0 ${DEPTH})`} style={{ fill: `color-mix(in srgb, ${fill} 42%, #01060c)` }} />;
});

/** Sombra de contato: estática (depende só da malha), desenhada uma vez sob o mapa. */
const MapShadow = memo(function MapShadow({ shapes, width, height }: Readonly<{ shapes: BrazilMapShapes; width: number; height: number }>) {
  return (
    <svg className="pm-map-svg pm-map-shadow" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <g transform={`translate(0 ${SHADOW})`} fill="#01060c">
        {shapes.shapes.map((s) => (
          <path key={s.uf} d={s.d} />
        ))}
      </g>
    </svg>
  );
});

interface MapProps {
  shapes: BrazilMapShapes;
  focusedUf: string | null;
  onSelect: (uf: string) => void;
  /** Contador de trocas de liderança nacional: cada novo valor roda a varredura de luz. */
  leadScene: number;
  children?: ReactNode;
}

/**
 * Mapa-herói: cor = candidatura à frente (intensidade = vantagem, B hachurado), rótulo = UF; a UF em foco sobe
 * numa camada própria e a câmera aproxima um pouco na direção dela. Só a malha projetada no servidor.
 */
export const PresentationBrazilMap = memo(function PresentationBrazilMap({ shapes, focusedUf, onSelect, leadScene, children }: Readonly<MapProps>) {
  const states = useLive((s) => s.states?.states ?? null);
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  const width = shapes.width + LABEL_PAD;
  const height = shapes.height;
  const byUf = useMemo(() => {
    const map = new Map<string, TerritoryResult>();
    for (const s of states ?? []) map.set(s.code.toUpperCase(), s);
    return map;
  }, [states]);
  const list: readonly LiveCandidate[] = useMemo(() => candidates ?? [], [candidates]);
  const styled = useMemo(
    () =>
      shapes.shapes.map((shape) => {
        const state = byUf.get(shape.uf);
        const standing = standingOf(state, list);
        return {
          shape,
          fill: fillFor(standing),
          hatch: standing.kind === "lead" && standing.slot === "b",
          label: describeState(shape.name, state, list),
        };
      }),
    [shapes.shapes, byUf, list],
  );
  const focus = focusedUf ? styled.find((s) => s.shape.uf === focusedUf) ?? null : null;
  // Câmera: aproxima ~20% do caminho entre o centro do mapa e a UF em foco (sem tirar o país da tela).
  const pan = focus
    ? { "--pm-fx": `${((0.5 - focus.shape.labelX / width) * 20).toFixed(2)}%`, "--pm-fy": `${((0.5 - focus.shape.labelY / height) * 14).toFixed(2)}%` }
    : {};
  return (
    <div className="pm-map" style={{ "--pm-map-ratio": `${width} / ${height}` } as CSSProperties} data-testid="presentation-map">
      <div className="pm-map-plane" data-focus={focus ? "true" : undefined} style={pan as CSSProperties}>
        <MapShadow shapes={shapes} width={width} height={height} />
        <svg
          className="pm-map-svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Mapa do Brasil por UF: cor da candidatura à frente em cada estado${focus ? `; em foco: ${focus.shape.name}` : ""}`}
        >
          <defs>
            <pattern id="pm-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="3" height="10" fill="var(--live-hatch)" />
            </pattern>
          </defs>
          <g aria-hidden="true">
            {styled.map(({ shape, fill }) => (
              <UfSide key={shape.uf} d={shape.d} fill={fill} />
            ))}
          </g>
          <g>
            {styled.map(({ shape, fill, hatch, label }) => (
              <UfPath key={shape.uf} uf={shape.uf} d={shape.d} fill={fill} hatch={hatch} selected={focusedUf === shape.uf} label={label} onSelect={onSelect} />
            ))}
          </g>
          {focus ? (
            <g key={focus.shape.uf} className="pm-uf-lift" data-on="true" aria-hidden="true">
              <path d={focus.shape.d} transform={`translate(0 ${DEPTH})`} style={{ fill: `color-mix(in srgb, ${focus.fill} 42%, #01060c)` }} />
              <path d={focus.shape.d} className="pm-uf-lift-top" style={{ fill: focus.fill }} />
              {focus.hatch ? <path d={focus.shape.d} fill="url(#pm-hatch)" /> : null}
            </g>
          ) : null}
          <g aria-hidden="true">
            {shapes.shapes.map((shape) => {
              const anchor = labelAnchor(shape);
              const selected = focusedUf === shape.uf;
              return (
                <g key={`label-${shape.uf}`}>
                  {anchor ? <line x1={anchor[0]} y1={anchor[1]} x2={shape.labelX - 12} y2={shape.labelY - 6} className="pm-map-guide" /> : null}
                  <text
                    x={shape.labelX}
                    y={shape.labelY}
                    textAnchor={anchor ? "start" : "middle"}
                    dominantBaseline="middle"
                    className="pm-uf-code"
                    data-selected={selected ? "true" : undefined}
                  >
                    {shape.uf}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div key={leadScene} className="pm-map-sweep" data-run={leadScene > 0 ? "true" : undefined} aria-hidden="true" />
      </div>
      {children}
    </div>
  );
});
