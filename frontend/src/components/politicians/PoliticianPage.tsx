"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";
import { IDENTITY_VT, InitialAvatar, PoliticianProfile, type LoadState } from "@/components/politicians/PoliticianProfile";
import { useOpenSearch } from "@/components/search/search-context";
import {
  ApiError,
  getPolitician,
  getPoliticianAssets,
  getPoliticianBySlug,
  getPoliticianElections,
  getPoliticianScore,
  getPoliticianSources,
} from "@/lib/api";
import { isUuid, politicianPath } from "@/lib/paths";
import type { AssetDeclarationItem, DataSourceItem, ElectionResultItem, PoliticianDetail, ScoreStatusItem } from "@/lib/types";
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
      Voltar aos políticos
    </TransitionLink>
  );
}

/**
 * Carregamento com a geometria do perfil real (sem salto de layout). Se o
 * usuário veio de um card ou de um voto, a identidade de origem (mesma chave da
 * URL) já ocupa o cabeçalho — é onde a transição compartilhada pousa. Nenhum
 * outro dado é antecipado: cargo, partido, números e abas aguardam a fonte.
 */
function LoadingState({ hintKey }: Readonly<{ hintKey: string }>) {
  const hint = identityHint(hintKey);
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6" aria-busy="true">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 h-4" />
        <div className="space-y-6">
          <div className="skeleton h-[46px] rounded-lg" aria-hidden="true" />
          <div className="rounded-xl border border-white/[0.08] bg-card p-6">
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
                <div key={i} className="rounded-lg border border-white/[0.08] bg-card p-4">
                  <div className="skeleton mb-2 h-2.5 w-20" />
                  <div className="skeleton h-5 w-14" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-card" aria-hidden="true">
            <div className="flex gap-6 border-b border-white/[0.08] px-4 py-4">
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
        <output className="sr-only">Carregando perfil</output>
      </div>
    </main>
  );
}

function stateOf(q: UseQueryResult<unknown>): LoadState {
  if (q.isError) return "error";
  if (q.isPending) return "pending";
  return "ready";
}

/** Perfil não existe (404) ≠ não foi possível carregar agora (rede/servidor): mensagens e saídas diferentes. */
function Unavailable({ notFound, onRetry }: Readonly<{ notFound: boolean; onRetry: () => void }>) {
  const openSearch = useOpenSearch();
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <BackToSearch />
        <div className="rounded-lg border border-white/[0.08] bg-card px-6 py-14 text-center">
          <h1 className="font-medium text-slate-200">{notFound ? "Perfil não encontrado." : "Não foi possível carregar o perfil agora."}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            {notFound
              ? "Este endereço não corresponde a nenhum político na base atual. Procure pelo nome de urna."
              : "A base não respondeu. Seus dados não se perderam — tente de novo em instantes."}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
            {notFound ? (
              <button type="button" onClick={openSearch} className="mi-press focus-ring rounded-lg bg-brand px-4 py-2 font-semibold text-slate-900 hover:bg-brand-light">
                Buscar político
              </button>
            ) : (
              <button type="button" onClick={onRetry} className="mi-press focus-ring rounded-lg bg-brand px-4 py-2 font-semibold text-slate-900 hover:bg-brand-light">
                Tentar de novo
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Perfil pelo endereço público (/politicos/&lt;slug&gt;) ou pelo id (links antigos e listas que só conhecem o id).
 * Aberto pelo id, a barra de endereço passa para o slug sem recarregar (histórico substituído, não acrescentado).
 */
export function PoliticianPage({ idOrSlug, initial }: Readonly<{ idOrSlug: string; initial?: PoliticianDetail }>) {
  const byId = isUuid(idOrSlug);
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["politician", idOrSlug],
    queryFn: () => (byId ? getPolitician(idOrSlug) : getPoliticianBySlug(idOrSlug)),
    initialData: initial,
    retry: (failureCount, err) => !(err instanceof ApiError && err.status === 404) && failureCount < 2,
  });
  const id = data?.id;

  useEffect(() => {
    if (!data?.slug || data.slug === idOrSlug) return;
    window.history.replaceState(window.history.state, "", `${politicianPath(data)}${window.location.search}${window.location.hash}`);
  }, [data, idOrSlug]);

  const electionsQ = useQuery<ElectionResultItem[]>({
    queryKey: ["politician-elections", id],
    queryFn: () => getPoliticianElections(id!),
    enabled: !!id,
    retry: 1,
    staleTime: 60_000,
  });

  const assetsQ = useQuery<AssetDeclarationItem[]>({
    queryKey: ["politician-assets", id],
    queryFn: () => getPoliticianAssets(id!),
    enabled: !!id,
    retry: 1,
    staleTime: 60_000,
  });

  const sourcesQ = useQuery<DataSourceItem[]>({
    queryKey: ["politician-sources", id],
    queryFn: () => getPoliticianSources(id!),
    enabled: !!id,
    retry: 1,
    staleTime: 60_000,
  });

  const { data: score } = useQuery<ScoreStatusItem>({
    queryKey: ["politician-score", id],
    queryFn: () => getPoliticianScore(id!),
    enabled: !!id,
    retry: 1,
    staleTime: 300_000,
  });

  if (isPending && !isError) return <LoadingState hintKey={idOrSlug} />;
  if (isError || !data) return <Unavailable notFound={error instanceof ApiError && error.status === 404} onRetry={() => refetch()} />;

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
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
