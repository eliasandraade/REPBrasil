"use client";

import { useQuery } from "@tanstack/react-query";
import { displayName, formatCount, formatPercent } from "@/lib/elections/format";
import { buildElectionsPath } from "@/lib/elections/route";
import { xrayApi } from "@/lib/elections/xray";
import type { XrayCandidacy, XrayResponse } from "@/lib/elections/xray-types";
import { TransitionLink } from "@/motion/navigation";
import { InsightList } from "@/components/xray/InsightList";
import { CandidacyCard, EvolutionList } from "@/components/xray/XrayTimeline";
import { latestCandidacy } from "@/components/xray/useXray";

function SectionHeading({ id, children }: Readonly<{ id: string; children: string }>) {
  return (
    <h2 id={id} className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
      {children}
    </h2>
  );
}

/** Onde a candidatura mais teve votos (5 municípios), com a parte de cada um — a distribuição completa fica na aba Território. */
function TopPlaces({ c, onMore }: Readonly<{ c: XrayCandidacy; onMore: () => void }>) {
  const q = useQuery({
    queryKey: ["xray-territory", c.candidacyId, "municipality", undefined],
    queryFn: () => xrayApi.territory(c.candidacyId, "municipality", {}),
    staleTime: 60_000,
  });
  if (q.isLoading) return <div className="skeleton h-32 rounded-lg" aria-busy="true" aria-label="Carregando onde teve mais votos" />;
  if (q.isError || !q.data) return <p className="text-xs text-slate-400">Não foi possível carregar a distribuição por município.</p>;
  const top = q.data.territories.filter((t) => t.votes !== null && t.votes > 0).slice(0, 5);
  if (top.length === 0) return <p className="text-xs text-slate-500">Sem votos apurados por município nesta candidatura.</p>;
  const max = Math.max(1, ...top.map((t) => t.votes ?? 0));
  return (
    <div>
      <ol className="space-y-1.5" data-testid="profile-top-places">
        {top.map((t) => (
          <li key={`${t.uf}-${t.municipalityTseCode}`} className="text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-slate-200">
                {t.municipalityName ? displayName(t.municipalityName) : "—"}
                {c.contest.unit.scope !== "state" && c.contest.unit.scope !== "municipal" && <span className="text-slate-600"> · {t.uf}</span>}
              </span>
              <span className="flex-shrink-0 text-slate-400">
                {formatCount(t.votes)}
                {t.share !== null && <span className="text-slate-600"> · {formatPercent(t.share)} dos válidos</span>}
              </span>
            </div>
            <div className="mt-1 h-1 rounded bg-white/5" aria-hidden="true">
              <div className="h-1 rounded bg-brand/60" style={{ width: `${Math.max(2, ((t.votes ?? 0) / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ol>
      <button type="button" onClick={onMore} className="focus-ring mt-2 rounded text-xs text-brand hover:underline">
        Distribuição completa: municípios, zonas, seções e locais →
      </button>
    </div>
  );
}

/**
 * Visão geral do perfil, na ordem de leitura: o que os dados mostram (insights determinísticos da API), a candidatura
 * mais recente, como a votação mudou e onde ela se concentra.
 */
export function ProfileOverview({
  data,
  onOpenTerritory,
}: Readonly<{ data: XrayResponse; onOpenTerritory: (candidacyId: string) => void }>) {
  const latest = latestCandidacy(data);
  return (
    <div className="space-y-6" data-testid="profile-overview">
      {data.insights.length > 0 && (
        <section aria-labelledby="ov-insights">
          <SectionHeading id="ov-insights">O que os dados mostram</SectionHeading>
          <InsightList insights={data.insights} prominent />
        </section>
      )}

      {latest && (
        <section aria-labelledby="ov-latest">
          <SectionHeading id="ov-latest">Candidatura mais recente</SectionHeading>
          <CandidacyCard c={latest} onOpen={() => onOpenTerritory(latest.candidacyId)} />
          {latest.contest.unit.uf && (
            <TransitionLink
              href={`${buildElectionsPath({
                year: latest.contest.year,
                round: latest.contest.round,
                state: latest.contest.unit.uf.toLowerCase(),
              })}?camada=intensity&candidatura=${latest.candidacyId}`}
              className="focus-ring mt-2 inline-block rounded text-xs text-brand hover:underline"
            >
              Ver no mapa da eleição →
            </TransitionLink>
          )}
        </section>
      )}

      {(data.evolution.length > 0 || data.assetsEvolution.length > 0) && (
        <section aria-labelledby="ov-evolution">
          <SectionHeading id="ov-evolution">Evolução entre eleições</SectionHeading>
          <EvolutionList data={data} />
        </section>
      )}

      {latest && !latest.ticket && latest.totals.votes !== null && (
        <section aria-labelledby="ov-places">
          <SectionHeading id="ov-places">Onde teve mais votos</SectionHeading>
          <TopPlaces c={latest} onMore={() => onOpenTerritory(latest.candidacyId)} />
        </section>
      )}
    </div>
  );
}
