"use client";

import { useQuery } from "@tanstack/react-query";
import { TransitionLink as Link } from "@/motion/navigation";
import { electionsApi } from "@/lib/elections/api";
import { formatCount } from "@/lib/elections/format";
import { buildElectionsPath } from "@/lib/elections/route";
import type { ElectionItem } from "@/lib/elections/types";
import { compactCount, getOverview, listJoin, type CoverageElection } from "@/lib/overview";

/** Uma eleição: o que foi votado, onde há resultado por seção (atalho direto para a UF) e o mapa do Brasil. */
function ElectionCard({ e, coverage }: Readonly<{ e: ElectionItem; coverage: CoverageElection[] }>) {
  const offices = [...new Map(coverage.flatMap((c) => c.offices).map((o) => [o.code, o.name])).values()];
  return (
    <article className="election-entry" data-election={`${e.year}-${e.round}`}>
      <div className="election-year" aria-hidden="true">{e.year}<span>{e.round}º turno</span></div><div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-bold text-slate-100">
          Eleições {e.year} · {e.round}º turno
        </h2>
        <p className="text-xs text-slate-500">{new Date(`${e.electionDate}T12:00:00`).toLocaleDateString("pt-BR")}</p>
      </div>
      {offices.length > 0 && <p className="mt-1 text-sm text-slate-400">{listJoin(offices)}</p>}
      {coverage.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="UFs com resultado por seção">
          {coverage.map((c) => (
            <li key={c.uf}>
              <Link
                href={buildElectionsPath({ year: e.year, round: e.round, state: c.uf.toLowerCase() })}
                className="mi-surface focus-ring inline-flex flex-col rounded-lg border border-brand/25 bg-brand/[0.06] px-3 py-2 hover:border-brand/50"
              >
                <span className="text-sm font-semibold text-slate-100">{c.stateName}</span>
                <span className="text-[11px] text-slate-400">
                  {formatCount(c.municipalities)} {c.municipalities === 1 ? "município" : "municípios"} · {formatCount(c.sections)} seções ·{" "}
                  {compactCount(c.eligible)} de eleitores
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          {e.resultsAvailable ? "Resultados por seção disponíveis." : "Só o cadastro eleitoral importado (sem votos por seção)."}
        </p>
      )}
      <Link
        href={buildElectionsPath({ year: e.year, round: e.round })}
        className="focus-ring mt-3 inline-flex items-center gap-1 rounded text-xs font-medium text-brand hover:text-brand-light"
      >
        <span className="mi-underline">Mapa do Brasil</span>
        <span aria-hidden="true" className="mi-arrow inline-block">
          →
        </span>
      </Link>
    </div></article>
  );
}

/** Eleições disponíveis no catálogo eleitoral (cadastro e resultados oficiais do TSE), com a cobertura de cada uma. */
export default function ElectionsPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["el-elections"], queryFn: electionsApi.elections });
  const overview = useQuery({ queryKey: ["overview"], queryFn: ({ signal }) => getOverview(signal), staleTime: 10 * 60_000 });
  const elections = data?.elections ?? [];
  const coverageOf = (e: ElectionItem) => (overview.data?.elections ?? []).filter((c) => c.year === e.year && c.round === e.round);
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Inteligência eleitoral</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-100">Uma eleição. Muitos territórios.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
          Escolha quando e onde investigar. Cada edição reúne o cadastro e os resultados que já foram importados do TSE.
          No explorador, troque de eleição sem perder o território.
        </p>

        <div className="mt-6 space-y-3" data-testid="election-list">
          {isLoading && (
            <div aria-busy="true" className="rounded-xl border border-white/[0.08] bg-card px-5 py-4">
              <div className="skeleton mb-1.5 h-6 w-56" aria-hidden="true" />
              <div className="skeleton h-3 w-72 max-w-full" aria-hidden="true" />
            </div>
          )}
          {isError && (
            <div className="rounded-xl border border-white/[0.08] bg-card px-5 py-6 text-sm text-slate-400">
              Não foi possível carregar as eleições.{" "}
              <button type="button" onClick={() => refetch()} className="focus-ring rounded text-brand hover:underline">
                Tentar de novo
              </button>
            </div>
          )}
          {!isLoading && !isError && elections.length === 0 && (
            <div className="rounded-xl border border-white/[0.08] bg-card px-5 py-6 text-sm text-slate-400">Nenhuma eleição importada ainda.</div>
          )}
          {elections.map((e) => (
            <ElectionCard key={`${e.year}-${e.round}`} e={e} coverage={coverageOf(e)} />
          ))}
        </div>
      </div>
    </main>
  );
}
