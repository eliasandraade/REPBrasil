"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { IDENTITY_VT, InitialAvatar, PoliticianProfile, type LoadState } from "@/components/politicians/PoliticianProfile";
import {
  getPolitician,
  getPoliticianElections,
  getPoliticianAssets,
  getPoliticianSources,
  getPoliticianScore,
} from "@/lib/api";
import type {
  AssetDeclarationItem,
  DataSourceItem,
  ElectionResultItem,
  ScoreStatusItem,
} from "@/lib/types";
import { identityHint } from "@/motion/identity";
import { TransitionLink } from "@/motion/navigation";

function BackToSearch() {
  return (
    <TransitionLink
      href="/politicos"
      direction="shallower"
      className="focus-ring mb-8 inline-flex items-center gap-1.5 rounded text-xs text-slate-500 transition-colors hover:text-slate-300"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      Voltar à busca
    </TransitionLink>
  );
}

/**
 * Carregamento com a geometria do perfil real (sem salto de layout). Se o
 * usuário veio de um card ou de um voto, a identidade de origem (mesmo id) já
 * ocupa o cabeçalho — é onde a transição compartilhada pousa. Nenhum outro dado
 * é antecipado: cargo, partido, números e abas aguardam a fonte.
 */
function LoadingState({ id }: { id: string }) {
  const hint = identityHint(id);
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6" aria-busy="true">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 h-4" />
        <div className="space-y-6">
          <div className="skeleton h-[46px] rounded-lg" aria-hidden="true" />
          <div className="rounded-xl border border-white/8 bg-card p-6">
            <div className="flex items-start gap-4">
              {hint ? <InitialAvatar name={hint.name} /> : <div className="skeleton h-16 w-16 flex-shrink-0 rounded-xl" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                {hint ? (
                  <h1 style={IDENTITY_VT.name} className="mb-1 text-2xl font-bold leading-tight text-slate-100">
                    {hint.name}
                  </h1>
                ) : (
                  <div className="skeleton mb-2 h-7 w-56" aria-hidden="true" />
                )}
                <div className="skeleton mb-2 h-4 w-40" aria-hidden="true" />
                <div className="skeleton h-5 w-48" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-lg border border-white/8 bg-card p-4">
                  <div className="skeleton mb-2 h-2.5 w-20" />
                  <div className="skeleton h-5 w-14" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-card" aria-hidden="true">
            <div className="flex gap-6 border-b border-white/8 px-4 py-4">
              {[72, 56, 132, 72, 48, 44].map((w, i) => (
                <div key={i} className="skeleton h-3.5" style={{ width: w }} />
              ))}
            </div>
            <div className="space-y-3 p-5">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton h-24" />
            </div>
          </div>
        </div>
        <p className="sr-only" role="status">Carregando perfil</p>
      </div>
    </main>
  );
}

const stateOf = (q: UseQueryResult<unknown>): LoadState => (q.isError ? "error" : q.isPending ? "pending" : "ready");

export default function PoliticoPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const { data, isPending, isError } = useQuery({
    queryKey: ["politician", id],
    queryFn: () => getPolitician(id),
    enabled: !!id,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("404")) return false;
      return failureCount < 2;
    },
  });

  const electionsQ = useQuery<ElectionResultItem[]>({
    queryKey: ["politician-elections", id],
    queryFn: () => getPoliticianElections(id),
    enabled: !!data,
    retry: 1,
    staleTime: 60_000,
  });

  const assetsQ = useQuery<AssetDeclarationItem[]>({
    queryKey: ["politician-assets", id],
    queryFn: () => getPoliticianAssets(id),
    enabled: !!data,
    retry: 1,
    staleTime: 60_000,
  });

  const sourcesQ = useQuery<DataSourceItem[]>({
    queryKey: ["politician-sources", id],
    queryFn: () => getPoliticianSources(id),
    enabled: !!data,
    retry: 1,
    staleTime: 60_000,
  });

  const { data: score } = useQuery<ScoreStatusItem>({
    queryKey: ["politician-score", id],
    queryFn: () => getPoliticianScore(id),
    enabled: !!data,
    retry: 1,
    staleTime: 300_000,
  });

  if (isPending && !isError) return <LoadingState id={id} />;

  if (isError || !data) {
    return (
      <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <BackToSearch />
          <div className="rounded-lg border border-white/8 bg-card px-6 py-16 text-center">
            <p className="text-slate-300 font-medium">Político não encontrado.</p>
            <p className="mt-1 text-sm text-slate-500">
              O ID informado não corresponde a nenhum registro na base atual.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <BackToSearch />
        <PoliticianProfile
          politician={data}
          elections={electionsQ.data ?? []}
          assets={assetsQ.data ?? []}
          sources={sourcesQ.data ?? []}
          score={score}
          status={{ elections: stateOf(electionsQ), assets: stateOf(assetsQ), sources: stateOf(sourcesQ) }}
        />
      </div>
    </main>
  );
}
