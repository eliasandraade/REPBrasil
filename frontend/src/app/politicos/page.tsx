"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { PoliticianCard } from "@/components/politicians/PoliticianCard";
import { TransitionLink, useNavigate } from "@/motion/navigation";
import { SearchInput } from "@/components/politicians/SearchInput";
import { searchPoliticians } from "@/lib/api";
import type { SearchFilters } from "@/lib/types";

const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA",
  "MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN",
  "RS","RO","RR","SC","SP","SE","TO",
];

const selectCls =
  "rounded-lg border border-white/10 bg-card-elevated px-3 py-2 text-sm text-slate-300 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/20 hover:border-white/20 transition-colors duration-[var(--motion-acknowledge)]";

/** Esqueleto com a geometria exata do PoliticianCard (sem salto de layout ao chegar). */
function ResultSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-2" data-testid="results-skeleton">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border border-white/8 bg-card p-4">
          <div className="skeleton h-10 w-10 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-4 w-44" />
            <div className="skeleton h-3 w-64 max-w-full" />
            <div className="skeleton h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PoliticosContent() {
  const searchParams = useSearchParams();
  const navigate = useNavigate();

  const q = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const filters: SearchFilters = {
    state: searchParams.get("state") ?? undefined,
    party: searchParams.get("party") ?? undefined,
    office: searchParams.get("office") ?? undefined,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["politicians", q, page, filters.state, filters.party, filters.office],
    queryFn: () => searchPoliticians(q, page, 20, filters),
  });

  function buildParams(overrides: Record<string, string | undefined>) {
    const next = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q,
      page: "1",
      state: filters.state,
      party: filters.party,
      office: filters.office,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v) next.set(k, v);
    }
    return next.toString();
  }

  function goToPage(newPage: number) {
    navigate(`/politicos?${buildParams({ page: String(newPage) })}`);
  }

  function setFilter(key: keyof SearchFilters, value: string) {
    navigate(`/politicos?${buildParams({ [key]: value || undefined, page: "1" })}`);
  }

  const hasFilters = !!(filters.state || filters.party || filters.office);

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl">
        {/* Back */}
        <TransitionLink
          href="/"
          className="focus-ring mb-6 inline-flex items-center gap-1.5 rounded text-xs text-slate-500 transition-colors hover:text-slate-300"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          REPBrasil
        </TransitionLink>

        <div className="mb-6">
          <h1 className="mb-4 text-xl font-bold text-slate-100">Buscar políticos</h1>
          <SearchInput defaultValue={q} />

          {/* Filtros */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={filters.state ?? ""}
              onChange={(e) => setFilter("state", e.target.value)}
              className={selectCls}
            >
              <option value="">Todos os estados</option>
              {ESTADOS_BR.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Partido (ex: PT)"
              value={filters.party ?? ""}
              onChange={(e) => setFilter("party", e.target.value)}
              className={`${selectCls} w-36 placeholder:text-slate-600`}
            />

            <input
              type="text"
              placeholder="Cargo (ex: SENADOR)"
              value={filters.office ?? ""}
              onChange={(e) => setFilter("office", e.target.value)}
              className={`${selectCls} w-48 placeholder:text-slate-600`}
            />

            {hasFilters && (
              <button
                type="button"
                onClick={() =>
                  navigate(`/politicos?${buildParams({ state: undefined, party: undefined, office: undefined })}`)
                }
                className="value-arrive mi-press focus-ring rounded-lg border border-white/8 px-3 py-2 text-xs text-slate-500 transition-colors hover:border-white/20 hover:text-slate-300"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </div>

        {/* Info banner */}
        <div className="mb-5 flex items-center gap-2 rounded-md border border-white/8 bg-card/50 px-3 py-2 text-xs text-slate-500">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-brand" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          Base inicial: 1.000 políticos indexados — dados do TSE 2024. Em expansão.
        </div>

        {isLoading && (
          <div aria-busy="true">
            <output className="mb-4 flex items-center gap-2 text-xs text-slate-500">
              <span className="query-trace w-10" aria-hidden="true" />
              <span>Consultando a base{q ? ` por "${q}"` : ""}…</span>
            </output>
            <ResultSkeleton />
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-center text-sm text-red-400">
            Erro ao conectar com a API. Verifique sua conexão.
          </div>
        )}

        {data && (
          <>
            <p className="mb-4 text-xs text-slate-500">
              <span className="font-medium text-slate-300">{data.totalCount}</span>{" "}
              resultado{data.totalCount !== 1 ? "s" : ""}
              {q ? ` para "${q}"` : ""}
              {hasFilters ? " com filtros aplicados" : ""}
            </p>

            {data.items.length === 0 ? (
              <div className="rounded-lg border border-white/8 bg-card py-16 text-center">
                <p className="text-slate-400 font-medium">
                  Nenhum político encontrado{q ? ` para "${q}"` : ""}
                  {hasFilters ? " com os filtros selecionados" : ""}.
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  A base inicial cobre 1.000 políticos do TSE 2024.
                </p>
              </div>
            ) : (
              <div className="list-arrive space-y-2" key={`${q}|${page}|${filters.state}|${filters.party}|${filters.office}`}>
                {data.items.map((p) => (
                  <PoliticianCard key={p.id} politician={p} />
                ))}
              </div>
            )}

            {(data.hasPrevious || data.hasNext) && (
              <div className="mt-8 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => goToPage(page - 1)}
                  disabled={!data.hasPrevious}
                  className="mi-press focus-ring inline-flex items-center gap-2 rounded-lg border border-white/10 bg-card px-4 py-2 text-sm text-slate-300 transition-colors hover:border-white/20 hover:bg-card-elevated disabled:opacity-30"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
                  Anterior
                </button>
                <span className="text-xs text-slate-500">
                  Página {data.page} de {data.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => goToPage(page + 1)}
                  disabled={!data.hasNext}
                  className="mi-press focus-ring inline-flex items-center gap-2 rounded-lg border border-white/10 bg-card px-4 py-2 text-sm text-slate-300 transition-colors hover:border-white/20 hover:bg-card-elevated disabled:opacity-30"
                >
                  Próxima
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function PoliticosPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-background px-4 py-8 sm:px-6" aria-busy="true">
          <div className="mx-auto max-w-3xl pt-24">
            <ResultSkeleton />
          </div>
        </main>
      }
    >
      <PoliticosContent />
    </Suspense>
  );
}
