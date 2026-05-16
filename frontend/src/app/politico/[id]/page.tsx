"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PoliticianProfile } from "@/components/politicians/PoliticianProfile";
import { getPolitician } from "@/lib/api";

export default function PoliticoPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["politician", id],
    queryFn: () => getPolitician(id),
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("404")) return false;
      return failureCount < 2;
    },
  });

  if (isLoading) {
    return (
      <main className="min-h-screen px-4 py-12 max-w-2xl mx-auto">
        <p className="text-slate-400 text-center py-24">Carregando...</p>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="min-h-screen px-4 py-12 max-w-2xl mx-auto">
        <Link href="/politicos" className="text-sm text-slate-400 hover:text-slate-600 block mb-8">
          ← Voltar à busca
        </Link>
        <div className="text-center py-24">
          <p className="text-slate-500 text-lg font-medium">Político não encontrado.</p>
          <p className="text-slate-400 text-sm mt-2">
            O ID informado não corresponde a nenhum registro.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-12 max-w-2xl mx-auto">
      <Link href="/politicos" className="text-sm text-slate-400 hover:text-slate-600 block mb-8">
        ← Voltar à busca
      </Link>
      <PoliticianProfile politician={data} />
    </main>
  );
}
