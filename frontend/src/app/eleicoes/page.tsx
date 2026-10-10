"use client";

import { useQuery } from "@tanstack/react-query";
import { TransitionLink as Link } from "@/motion/navigation";
import { electionsApi } from "@/lib/elections/api";
import { buildElectionsPath } from "@/lib/elections/route";

/** Eleições disponíveis no catálogo eleitoral (cadastro e resultados oficiais do TSE). */
export default function ElectionsPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["el-elections"], queryFn: electionsApi.elections });
  const elections = data?.elections ?? [];
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Inteligência eleitoral</p>
        <h1 className="text-2xl font-bold text-slate-100">Eleições</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Resultados oficiais por seção eleitoral, do Brasil à urna, a partir dos Boletins de Urna e do cadastro eleitoral
          publicados pelo Tribunal Superior Eleitoral. Cada número é rastreável até o arquivo oficial. Dados eleitorais são
          descritivos: não alteram o Score.
        </p>

        <div className="mt-6 space-y-3" data-testid="election-list">
          {isLoading && (
            <div aria-busy="true" className="rounded-xl border border-white/8 bg-card px-5 py-4">
              <div className="skeleton mb-1.5 h-6 w-56" aria-hidden="true" />
              <div className="skeleton h-3 w-72 max-w-full" aria-hidden="true" />
            </div>
          )}
          {isError && (
            <div className="rounded-xl border border-white/8 bg-card px-5 py-6 text-sm text-slate-400">
              Não foi possível carregar as eleições.{" "}
              <button type="button" onClick={() => refetch()} className="text-brand hover:underline">
                Tentar novamente
              </button>
            </div>
          )}
          {!isLoading && !isError && elections.length === 0 && (
            <div className="rounded-xl border border-white/8 bg-card px-5 py-6 text-sm text-slate-400">
              Nenhuma eleição importada ainda.
            </div>
          )}
          {elections.map((e) => (
            <Link
              key={`${e.year}-${e.round}`}
              href={buildElectionsPath({ year: e.year, round: e.round })}
              data-election={`${e.year}-${e.round}`}
              className="group mi-surface focus-ring flex items-center justify-between rounded-xl border border-white/8 bg-card px-5 py-4 hover:border-brand/30 hover:bg-card-elevated/60"
            >
              <div>
                <p className="text-lg font-bold text-slate-100">
                  Eleições {e.year} · {e.round}º turno
                </p>
                <p className="text-xs text-slate-500">
                  {new Date(`${e.electionDate}T12:00:00`).toLocaleDateString("pt-BR")}
                  {e.cadasterAvailable ? " · cadastro eleitoral" : ""}
                  {e.resultsAvailable ? " · resultados por seção" : ""}
                </p>
              </div>
              <span className="flex items-center gap-1 text-sm font-semibold text-brand">
                <span>Explorar</span>
                <span aria-hidden="true" className="mi-arrow inline-block">→</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
