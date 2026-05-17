"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PoliticianProfile } from "@/components/politicians/PoliticianProfile";
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

function LoadingState() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 h-4 w-24 animate-pulse rounded bg-card-elevated" />
        <div className="mb-4 h-8 w-64 animate-pulse rounded bg-card-elevated" />
        <div className="mb-2 h-4 w-40 animate-pulse rounded bg-card-elevated" />
        <div className="mb-8 h-4 w-32 animate-pulse rounded bg-card-elevated" />
        <div className="grid grid-cols-4 gap-3 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-card-elevated" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg bg-card-elevated" />
      </div>
    </main>
  );
}

export default function PoliticoPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["politician", id],
    queryFn: () => getPolitician(id),
    enabled: !!id,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("404")) return false;
      return failureCount < 2;
    },
  });

  const { data: elections = [] } = useQuery<ElectionResultItem[]>({
    queryKey: ["politician-elections", id],
    queryFn: () => getPoliticianElections(id),
    enabled: !!data,
    retry: 1,
    staleTime: 60_000,
  });

  const { data: assets = [] } = useQuery<AssetDeclarationItem[]>({
    queryKey: ["politician-assets", id],
    queryFn: () => getPoliticianAssets(id),
    enabled: !!data,
    retry: 1,
    staleTime: 60_000,
  });

  const { data: sources = [] } = useQuery<DataSourceItem[]>({
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

  if (isLoading) return <LoadingState />;

  if (isError || !data) {
    return (
      <main className="min-h-screen bg-background px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <Link
            href="/politicos"
            className="mb-8 inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            Voltar à busca
          </Link>
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
        <Link
          href="/politicos"
          className="mb-8 inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          Voltar à busca
        </Link>
        <PoliticianProfile
          politician={data}
          elections={elections}
          assets={assets}
          sources={sources}
          score={score}
        />
      </div>
    </main>
  );
}
