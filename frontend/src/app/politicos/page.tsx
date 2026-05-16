"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PoliticianCard } from "@/components/politicians/PoliticianCard";
import { SearchInput } from "@/components/politicians/SearchInput";
import { searchPoliticians } from "@/lib/api";
import type { SearchFilters } from "@/lib/types";

const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA",
  "MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN",
  "RS","RO","RR","SC","SP","SE","TO",
];

function PoliticosContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

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
    router.push(`/politicos?${buildParams({ page: String(newPage) })}`);
  }

  function setFilter(key: keyof SearchFilters, value: string) {
    router.push(`/politicos?${buildParams({ [key]: value || undefined, page: "1" })}`);
  }

  const hasFilters = !!(filters.state || filters.party || filters.office);

  return (
    <main className="min-h-screen px-4 py-12 max-w-3xl mx-auto">
      <div className="mb-8 space-y-4">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-600">
          ← REPBrasil
        </Link>
        <SearchInput defaultValue={q} />

        {/* Filtros */}
        <div className="flex flex-wrap gap-3">
          <select
            value={filters.state ?? ""}
            onChange={(e) => setFilter("state", e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 w-36"
          />

          <input
            type="text"
            placeholder="Cargo (ex: SENADOR)"
            value={filters.office ?? ""}
            onChange={(e) => setFilter("office", e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 w-48"
          />

          {hasFilters && (
            <button
              type="button"
              onClick={() => router.push(`/politicos?${buildParams({ state: undefined, party: undefined, office: undefined })}`)}
              className="text-sm text-slate-400 hover:text-slate-600 px-3 py-2"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <p className="text-slate-500 text-center py-12">Buscando...</p>
      )}

      {isError && (
        <p className="text-red-500 text-center py-12">
          Erro ao buscar políticos. Verifique se a API está rodando.
        </p>
      )}

      {data && (
        <>
          <p className="text-sm text-slate-400 mb-4">
            {data.totalCount} resultado{data.totalCount !== 1 ? "s" : ""}
            {q ? ` para "${q}"` : ""}
          </p>

          {data.items.length === 0 ? (
            <p className="text-slate-500 text-center py-12">
              Nenhum político encontrado{q ? ` para "${q}"` : ""}
              {hasFilters ? " com os filtros selecionados" : ""}.
            </p>
          ) : (
            <div className="space-y-2">
              {data.items.map((p) => (
                <PoliticianCard key={p.id} politician={p} />
              ))}
            </div>
          )}

          {(data.hasPrevious || data.hasNext) && (
            <div className="flex justify-between mt-8">
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={!data.hasPrevious}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >
                ← Anterior
              </button>
              <span className="text-sm text-slate-400 self-center">
                Página {data.page} de {data.totalPages}
              </span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={!data.hasNext}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default function PoliticosPage() {
  return (
    <Suspense fallback={<p className="text-slate-500 text-center py-12">Carregando...</p>}>
      <PoliticosContent />
    </Suspense>
  );
}
