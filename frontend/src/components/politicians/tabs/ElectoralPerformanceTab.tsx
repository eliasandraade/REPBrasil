"use client";

import { useQuery } from "@tanstack/react-query";
import { TransitionLink as Link } from "@/motion/navigation";
import { electionsApi } from "@/lib/elections/api";
import { displayName, formatCount, formatPercent } from "@/lib/elections/format";
import { buildElectionsPath } from "@/lib/elections/route";
import type { CandidacyItem } from "@/lib/elections/types";

function Outcome({ c }: { c: CandidacyItem }) {
  const label = c.roundOutcome ?? "Situação não publicada";
  return (
    <span
      className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
        c.elected === true ? "border-brand/30 bg-brand/10 text-brand" : "border-white/10 bg-white/5 text-slate-400"
      }`}
      data-testid="candidacy-outcome"
    >
      {displayName(label)}
    </span>
  );
}

function CandidacyCard({ c }: { c: CandidacyItem }) {
  const perf = c.performance;
  const unitLabel = c.contest.electoralUnit === "BR" ? "Brasil" : c.contest.electoralUnit;
  return (
    <article className="rounded-lg border border-white/8 bg-card-elevated/40 p-4" data-candidacy={c.tseCandidateId}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Eleições {c.contest.year} · {c.contest.round}º turno
          </p>
          <h3 className="text-base font-bold text-slate-100">
            {displayName(c.contest.officeName)} · {unitLabel}
          </h3>
          <p className="text-xs text-slate-400">
            {displayName(c.ballotName)} · nº {c.candidateNumber}
            {c.party?.acronym ? ` · ${c.party.acronym}` : ""}
            {c.federationAcronym ? ` · federação ${c.federationAcronym}` : ""}
          </p>
        </div>
        <Outcome c={c} />
      </div>

      {perf ? (
        <div>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-white/8 bg-card p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Votos apurados</p>
              <p className="text-lg font-bold text-slate-100" data-testid="candidacy-votes">
                {formatCount(perf.votes)}
              </p>
              <p className="text-[10px] text-slate-600">fato · Boletins de Urna</p>
            </div>
            <div className="rounded-lg border border-white/8 bg-card p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Municípios com votos</p>
              <p className="text-lg font-bold text-slate-100">{formatCount(perf.municipalitiesWithVotes)}</p>
            </div>
            <div className="col-span-2 rounded-lg border border-white/8 bg-card p-3 sm:col-span-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Abrangência</p>
              <p className="text-xs text-slate-300" data-testid="candidacy-coverage">
                {perf.coverage.complete ? "Completa" : "Parcial"}
              </p>
              <p className="text-[10px] text-slate-600">{perf.coverage.note}</p>
            </div>
          </div>

          {perf.municipalities.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Municípios de maior votação</p>
              <ul className="space-y-1">
                {perf.municipalities.map((m) => (
                  <li key={`${m.uf}-${m.municipalityTseCode}`} className="flex items-center justify-between gap-3 text-sm">
                    {m.municipalitySlug ? (
                      <Link
                        href={buildElectionsPath({ year: c.contest.year, round: c.contest.round, state: m.uf.toLowerCase(), municipality: m.municipalitySlug })}
                        className="mi-underline focus-ring truncate rounded text-slate-300 hover:text-brand"
                      >
                        {m.municipalityName}/{m.uf}
                      </Link>
                    ) : (
                      <span className="truncate text-slate-300">
                        {m.municipalityName ?? m.municipalityTseCode}/{m.uf}
                      </span>
                    )}
                    <span className="flex-shrink-0 text-xs text-slate-400">
                      {formatCount(m.votes)} <span className="text-slate-600">· {formatPercent(m.shareOfValidVotes)} dos válidos</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-slate-600">
                Percentual = métrica derivada (votos ÷ válidos do cargo no município). Não é avaliação do político.
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Sem votação própria vinculada no Boletim de Urna importado (ex.: vice ou suplente, ou UF ainda não importada).
        </p>
      )}

      <p className="mt-3 border-t border-white/5 pt-2 text-[10px] text-slate-600">
        Fonte: Tribunal Superior Eleitoral — candidatura SQ {c.tseCandidateId} ({c.source.member}, linha {c.source.line}).
      </p>
    </article>
  );
}

/**
 * Candidaturas oficiais (TSE) desta pessoa e o desempenho territorial a partir
 * dos Boletins de Urna. Partido e cargo são os DAQUELA eleição. Descritivo:
 * nada aqui entra no Score.
 */
export function ElectoralPerformanceTab({ politicianId }: { politicianId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["politician-candidacies", politicianId],
    queryFn: () => electionsApi.politicianCandidacies(politicianId, 5),
    staleTime: 60_000,
  });

  if (isLoading)
    return (
      <div aria-busy="true" className="space-y-3">
        <div className="skeleton h-3 w-3/4" aria-hidden="true" />
        <div className="rounded-lg border border-white/8 bg-card-elevated/40 p-4" aria-hidden="true">
          <div className="skeleton mb-1.5 h-2.5 w-28" />
          <div className="skeleton mb-1 h-5 w-36" />
          <div className="skeleton mb-4 h-3 w-64 max-w-full" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-white/8 bg-card p-3">
                <div className="skeleton mb-1.5 h-2.5 w-20" />
                <div className="skeleton h-5 w-16" />
              </div>
            ))}
          </div>
        </div>
        <output className="sr-only">Carregando desempenho eleitoral</output>
      </div>
    );
  if (isError)
    return (
      <p className="text-sm text-slate-400">
        Não foi possível carregar o desempenho eleitoral.{" "}
        <button type="button" onClick={() => refetch()} className="text-brand hover:underline">
          Tentar novamente
        </button>
      </p>
    );
  const candidacies = data?.candidacies ?? [];
  return (
    <div className="space-y-3" data-testid="electoral-performance">
      <p className="text-xs text-slate-500">
        Candidaturas oficiais vinculadas por identificadores do TSE (nunca por nome). Dados eleitorais são descritivos e não
        alteram o Score.
      </p>
      {candidacies.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Nenhuma candidatura da camada eleitoral vinculada a este perfil.</p>
      ) : (
        candidacies.map((c) => <CandidacyCard key={c.id} c={c} />)
      )}
      <Link href="/eleicoes" className="mi-underline focus-ring inline-block rounded text-xs text-brand">
        Abrir o explorador eleitoral →
      </Link>
    </div>
  );
}
