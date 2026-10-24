"use client";

import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { candidateByKey, EXTERIOR_CODE, LEAD_CLASS_LABEL, leadPpOf, leadVotesOf, shareOf, standingOf, votesOf, type TerritoryStanding } from "@/lib/live-election/derive";
import { formatPercent, formatPercentagePoints, formatSectionsPct, formatTimestamp, formatVotes } from "@/lib/live-election/format";
import { labelAnchor, type BrazilMapShapes, type UfShape } from "@/lib/live-election/map-shapes";
import type { LiveCandidate, TerritoryResult } from "@/lib/live-election/types";
import { useLive } from "./LiveContext";
import { SlotSwatch } from "./primitives";

/** Margem à direita da viewBox para os rótulos deslocados das UFs pequenas do litoral. */
const LABEL_PAD = 90;

/** Intensidade (vantagem em p.p.) → proporção da cor do candidato sobre a terra do mapa. */
const INTENSITY_MIX = [42, 62, 80, 100] as const;

export function fillFor(standing: TerritoryStanding): string {
  if (standing.kind === "none") return "var(--live-land)";
  if (standing.kind === "tie") return "var(--live-tie)";
  const color = standing.slot === "a" ? "var(--live-a)" : "var(--live-b)";
  const pct = INTENSITY_MIX[standing.intensity];
  return pct === 100 ? color : `color-mix(in srgb, ${color} ${pct}%, var(--live-land))`;
}

/** Descrição completa de uma UF (rótulo acessível e dica). */
export function describeState(name: string, state: TerritoryResult | undefined, candidates: readonly LiveCandidate[]): string {
  if (!state?.available) return `${name}: sem dados recebidos ainda`;
  const [a, b] = candidates;
  const sections = `${formatSectionsPct(state.sections.totalizedPct)} das seções totalizadas`;
  const standing = standingOf(state, candidates);
  if (standing.kind === "none") return `${name}: sem votos totalizados; ${sections}`;
  const shares = [a && `${a.ballotName} ${formatPercent(shareOf(state, a.key))}`, b && `${b.ballotName} ${formatPercent(shareOf(state, b.key))}`].filter(Boolean).join(", ");
  if (standing.kind === "tie") return `${name}: empate; ${shares}; ${sections}`;
  const leader = candidateByKey(candidates, state.leaderKey);
  return `${name}: ${leader?.ballotName ?? "candidatura"} à frente por ${formatPercentagePoints(state.leadPp)}; ${shares}; ${sections}`;
}

interface Tip {
  uf: string;
  x: number;
  y: number;
}

function Tooltip({ shape, state, candidates }: Readonly<{ shape: UfShape; state: TerritoryResult | undefined; candidates: readonly LiveCandidate[] }>) {
  const [a, b] = candidates;
  return (
    <div className="w-60 rounded-lg border border-line bg-surface p-3 text-body-sm shadow-lg" data-testid="live-map-tooltip">
      <p className="font-semibold text-fg">{shape.name}</p>
      {state?.available ? (
        <dl className="mt-1 space-y-0.5">
          {[a, b].filter((c): c is LiveCandidate => Boolean(c)).map((c) => {
            return (
              <div key={c.key} className="flex items-center justify-between gap-2">
                <dt className="flex min-w-0 items-center gap-1.5 truncate text-fg-soft">
                  <SlotSwatch slot={c.slot} className="h-2.5 w-2.5" />
                  {c.ballotName}
                </dt>
                <dd className="tabular font-semibold text-fg">{formatPercent(shareOf(state, c.key))}</dd>
              </div>
            );
          })}
          <div className="flex justify-between gap-2 text-fg-muted">
            <dt>Diferença</dt>
            <dd className="tabular">
              {formatPercentagePoints(leadPpOf(state))} · {formatVotes(leadVotesOf(state))} votos
            </dd>
          </div>
          <div className="flex justify-between gap-2 text-fg-muted">
            <dt>Votos válidos</dt>
            <dd className="tabular">{formatVotes(state.votes.valid)}</dd>
          </div>
          <div className="flex justify-between gap-2 text-fg-muted">
            <dt>Seções totalizadas</dt>
            <dd className="tabular">{formatSectionsPct(state.sections.totalizedPct)}</dd>
          </div>
          <div className="flex justify-between gap-2 text-fg-muted">
            <dt>Atualizado</dt>
            <dd className="tabular">{formatTimestamp(state.totalizedAt, "time")}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-1 text-fg-muted">Sem dados recebidos ainda.</p>
      )}
    </div>
  );
}

/**
 * Mapa das 27 UFs (exterior fora do mapa, em componente próprio). Cor = candidato à frente (A × B da paleta
 * validada), intensidade = vantagem em p.p.; B também leva hachura e cada UF tem rótulo — nunca só cor.
 * Teclado: Tab entra no mapa, setas percorrem as UFs, Enter/Espaço abre o painel. A tabela das UFs é a
 * alternativa tabular completa.
 */
export function BrazilElectionMap({ shapes, onSelect }: Readonly<{ shapes: BrazilMapShapes; onSelect: (uf: string) => void }>) {
  const states = useLive((s) => s.states?.states ?? null);
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const [tip, setTip] = useState<Tip | null>(null);
  const ordered = useMemo(() => [...shapes.shapes].sort((x, y) => x.name.localeCompare(y.name, "pt-BR")), [shapes.shapes]);
  const [active, setActive] = useState(ordered[0]?.uf ?? "");

  const byUf = useMemo(() => {
    const map = new Map<string, TerritoryResult>();
    for (const s of states ?? []) map.set(s.code.toUpperCase(), s);
    return map;
  }, [states]);
  const list = useMemo(() => candidates ?? [], [candidates]);

  const placeAt = useCallback((uf: string, clientX: number, clientY: number) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ uf, x: clientX - box.left, y: clientY - box.top });
  }, []);

  const onMouseMove = (e: MouseEvent<SVGPathElement>, uf: string) => placeAt(uf, e.clientX, e.clientY);

  const onFocus = (uf: string) => {
    setActive(uf);
    const el = pathRefs.current.get(uf);
    const r = el?.getBoundingClientRect();
    if (r) placeAt(uf, r.left + r.width / 2, r.top + r.height / 2);
  };

  const move = (from: string, delta: number) => {
    const i = ordered.findIndex((s) => s.uf === from);
    const next = ordered[(i + delta + ordered.length) % ordered.length];
    if (!next) return;
    setActive(next.uf);
    pathRefs.current.get(next.uf)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<SVGPathElement>, uf: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(uf);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(uf, 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(uf, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(ordered[0].uf, 0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(ordered[ordered.length - 1].uf, 0);
    } else if (e.key === "Escape") {
      setTip(null);
    }
  };

  const tipShape = tip ? shapes.shapes.find((s) => s.uf === tip.uf) : null;
  const containerWidth = containerRef.current?.clientWidth ?? 0;

  return (
    <div className="flex flex-col gap-3" data-testid="live-brazil-map">
      <div ref={containerRef} className="relative mx-auto w-full max-w-[720px]" onMouseLeave={() => setTip(null)}>
        <svg
          viewBox={`0 0 ${shapes.width + LABEL_PAD} ${shapes.height}`}
          className="h-auto w-full"
          role="group"
          aria-label="Mapa do Brasil por UF: candidatura à frente em cada estado. Use as setas para navegar e Enter para abrir o painel da UF."
        >
          <defs>
            <pattern id="live-hatch-pattern" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="3" height="10" fill="var(--live-hatch)" />
            </pattern>
          </defs>
          {shapes.shapes.map((shape) => {
            const state = byUf.get(shape.uf);
            const standing = standingOf(state, list);
            const label = describeState(shape.name, state, list);
            return (
              <g key={shape.uf}>
                <path
                  ref={(el) => {
                    if (el) pathRefs.current.set(shape.uf, el);
                    else pathRefs.current.delete(shape.uf);
                  }}
                  d={shape.d}
                  className="live-map-uf"
                  style={{ fill: fillFor(standing) }}
                  role="button"
                  tabIndex={active === shape.uf ? 0 : -1}
                  aria-label={label}
                  data-uf={shape.uf}
                  data-standing={standing.kind === "lead" ? standing.slot : standing.kind}
                  data-active={tip?.uf === shape.uf ? "true" : undefined}
                  onClick={() => onSelect(shape.uf)}
                  onKeyDown={(e) => onKeyDown(e, shape.uf)}
                  onFocus={() => onFocus(shape.uf)}
                  onBlur={() => setTip(null)}
                  onMouseMove={(e) => onMouseMove(e, shape.uf)}
                />
                {standing.kind === "lead" && standing.slot === "b" ? (
                  <path d={shape.d} fill="url(#live-hatch-pattern)" pointerEvents="none" aria-hidden="true" />
                ) : null}
              </g>
            );
          })}
          {shapes.shapes.map((shape) => {
            const anchor = labelAnchor(shape);
            return (
              <g key={`label-${shape.uf}`} aria-hidden="true">
                {anchor ? <line x1={anchor[0]} y1={anchor[1]} x2={shape.labelX - 12} y2={shape.labelY - 6} className="live-map-guide" /> : null}
                <text x={shape.labelX} y={shape.labelY} textAnchor={anchor ? "start" : "middle"} dominantBaseline="middle" className="live-map-label">
                  {shape.uf}
                </text>
              </g>
            );
          })}
        </svg>
        {tip && tipShape ? (
          <div
            className="pointer-events-none absolute z-20"
            style={{
              left: Math.min(Math.max(8, tip.x + 14), Math.max(8, containerWidth - 248)),
              top: Math.max(8, tip.y - 12),
            }}
          >
            <Tooltip shape={tipShape} state={byUf.get(tipShape.uf)} candidates={list} />
          </div>
        ) : null}
      </div>
      <MapLegend candidates={list} />
    </div>
  );
}

function MapLegend({ candidates }: Readonly<{ candidates: readonly LiveCandidate[] }>) {
  const [a, b] = candidates;
  return (
    <div className="flex flex-col gap-2 text-micro text-fg-muted" data-testid="live-map-legend">
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {a ? (
          <li className="flex items-center gap-1.5">
            <SlotSwatch slot="a" /> {a.ballotName} à frente
          </li>
        ) : null}
        {b ? (
          <li className="flex items-center gap-1.5">
            <SlotSwatch slot="b" /> {b.ballotName} à frente (hachurado)
          </li>
        ) : null}
        <li className="flex items-center gap-1.5">
          <SlotSwatch slot="tie" /> Empate
        </li>
        <li className="flex items-center gap-1.5">
          <SlotSwatch slot="none" /> Sem votos totalizados
        </li>
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <span>Intensidade = vantagem:</span>
        {LEAD_CLASS_LABEL.map((label, i) => (
          <span key={label} className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm" style={{ background: fillFor({ kind: "lead", slot: "a", intensity: i as 0 | 1 | 2 | 3 }) }} />
            <span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm" style={{ background: fillFor({ kind: "lead", slot: "b", intensity: i as 0 | 1 | 2 | 3 }) }} />
            {label}
          </span>
        ))}
      </div>
      <a href="#live-state-table" className="focus-ring self-start rounded text-accent-text hover:underline">
        Ver os mesmos dados em tabela
      </a>
    </div>
  );
}

/** Eleitorado no exterior (fora do mapa, seção 30). */
export function ExteriorCard({ onSelect }: Readonly<{ onSelect: (uf: string) => void }>) {
  const exterior = useLive((s) => s.states?.exterior ?? null);
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  if (!exterior) return null;
  const list = candidates ?? [];
  return (
    <section aria-labelledby="live-exterior" className="rounded-2xl border border-line bg-surface p-4" data-testid="live-exterior">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-label uppercase text-fg-muted">Fora do mapa</p>
          <h3 id="live-exterior" className="text-body-lg font-semibold text-fg">
            Exterior
          </h3>
        </div>
        <button type="button" onClick={() => onSelect(EXTERIOR_CODE)} className="focus-ring rounded-lg border border-line px-3 py-1.5 text-body-sm font-medium text-fg-soft hover:bg-subtle">
          Detalhes
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm">
        {list.map((c) => {
          const v = votesOf(exterior, c.key);
          return (
            <div key={c.key}>
              <dt className="flex items-center gap-1.5 text-fg-muted">
                <SlotSwatch slot={c.slot} className="h-2.5 w-2.5" />
                {c.ballotName}
              </dt>
              <dd className="tabular font-semibold text-fg">
                {formatPercent(shareOf(exterior, c.key))} <span className="text-micro font-normal text-fg-muted">{formatVotes(v?.votes)}</span>
              </dd>
            </div>
          );
        })}
        <div>
          <dt className="text-fg-muted">Diferença</dt>
          <dd className="tabular font-semibold text-fg">{formatPercentagePoints(leadPpOf(exterior))}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Seções totalizadas</dt>
          <dd className="tabular font-semibold text-fg">{formatSectionsPct(exterior.sections.totalizedPct)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Eleitorado</dt>
          <dd className="tabular font-semibold text-fg">{formatVotes(exterior.electorate.total)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Comparecimento</dt>
          <dd className="tabular font-semibold text-fg">{formatPercent(exterior.electorate.turnoutPct)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Abstenção</dt>
          <dd className="tabular font-semibold text-fg">{formatPercent(exterior.electorate.abstentionPct)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Seções</dt>
          <dd className="tabular font-semibold text-fg">{formatVotes(exterior.sections.total)}</dd>
        </div>
      </dl>
    </section>
  );
}
