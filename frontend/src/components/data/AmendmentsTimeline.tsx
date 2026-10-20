"use client";

import { useEffect, useRef, useState } from "react";
import { useEntitlement } from "@/components/account/PlanGate";
import { MAP_SERIES } from "@/lib/plans";
import { TransitionLink } from "@/motion/navigation";

const STEP_MS = 1600;

/**
 * Linha do tempo das emendas. Escolher um ano é aberto a todos (cada ano é público). Reproduzir a série inteira,
 * ano a ano, usa a série numa consulta só (plano com `data.map_series`): o mapa troca por transição cruzada, sem
 * esperar cada ano carregar. Pausa sozinho no último ano; nunca em laço.
 */
export function AmendmentsTimeline({
  years,
  year,
  onYear,
  onPrepare,
  ready,
}: Readonly<{
  /** Anos com dado, em ordem crescente. */
  years: number[];
  year: number;
  onYear: (year: number) => void;
  /** Busca a série (plano) antes de reproduzir. */
  onPrepare: () => void;
  /** Série carregada no cache: dá para reproduzir sem espera. */
  ready: boolean;
}>) {
  const gate = useEntitlement(MAP_SERIES);
  const [playing, setPlaying] = useState(false);
  const latest = useRef({ years, year, onYear });
  latest.current = { years, year, onYear };

  useEffect(() => {
    if (!playing || !ready) return;
    const timer = setInterval(() => {
      const { years: list, year: current, onYear: go } = latest.current;
      const index = list.indexOf(current);
      if (index < 0 || index >= list.length - 1) {
        setPlaying(false);
        return;
      }
      go(list[index + 1]);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [playing, ready]);

  if (years.length < 2) return null;
  const index = Math.max(0, years.indexOf(year));
  const play = () => {
    if (index >= years.length - 1) onYear(years[0]);
    onPrepare();
    setPlaying(true);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2" data-testid="amendments-timeline">
      {gate.allowed ? (
        <button
          type="button"
          onClick={() => (playing ? setPlaying(false) : play())}
          aria-pressed={playing}
          className="focus-ring mi-press rounded-md border border-line px-2.5 py-1 text-micro font-semibold text-fg hover:bg-fg/5"
        >
          {playing ? "Pausar" : "Reproduzir anos"}
        </button>
      ) : (
        <TransitionLink href="/planos" className="focus-ring rounded text-micro text-fg-muted hover:text-fg" title={gate.description ?? undefined}>
          Reproduzir anos · plano {gate.planName ?? "pago"}
        </TransitionLink>
      )}
      <label className="flex min-w-[14rem] flex-1 items-center gap-2 text-micro text-fg-muted">
        <span className="whitespace-nowrap">Ano</span>
        <input
          type="range"
          min={0}
          max={years.length - 1}
          step={1}
          value={index}
          onChange={(event) => {
            setPlaying(false);
            onYear(years[Number(event.target.value)]);
          }}
          aria-valuetext={String(year)}
          className="focus-ring h-6 w-full accent-[rgb(var(--accent))]"
        />
        <span className="w-10 text-right font-semibold tabular-nums text-fg">{year}</span>
      </label>
      {playing && !ready && <span role="status" className="text-micro text-fg-muted">Carregando a série…</span>}
    </div>
  );
}
