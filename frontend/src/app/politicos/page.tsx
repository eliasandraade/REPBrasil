"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PoliticianCard } from "@/components/politicians/PoliticianCard";
import { SearchInput } from "@/components/politicians/SearchInput";
import { searchPoliticians } from "@/lib/api";

function PoliticosContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const q = searchParams.get("q") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["politicians", q, page],
    queryFn: () => searchPoliticians(q, page),
  });

  function goToPage(newPage: number) {
    const params = new URLSearchParams({ q, page: String(newPage) });
    router.push(`/politicos?${params}`);
  }

  return (
    <main className="min-h-screen px-4 py-12 max-w-3xl mx-auto">
      <div className="mb-8 space-y-4">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-600">
          ← REPBrasil
        </Link>
        <SearchInput defaultValue={q} />
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
              Nenhum político encontrado{q ? ` para "${q}"` : ""}.
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
