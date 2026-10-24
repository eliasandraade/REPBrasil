"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchCapitals, fetchLargest } from "@/lib/live-election/api";
import { candidateByKey, compareNullable, leadPpOf, shareOf, type SortDirection } from "@/lib/live-election/derive";
import { formatInteger, formatPercent, formatPercentagePoints, formatSectionsPct } from "@/lib/live-election/format";
import type { LiveCandidate, TerritoryResult } from "@/lib/live-election/types";
import { useLive } from "./LiveContext";
import { SectionHeading, SlotSwatch } from "./primitives";

type Tab = "capitals" | "largest";
type SortKey = "name" | "a" | "b" | "leadPp" | "sectionsPct" | "electorate";

function sortValue(t: TerritoryResult, key: SortKey, candidates: readonly LiveCandidate[]): number | string | null {
  const [a, b] = candidates;
  switch (key) {
    case "name":
      return t.name;
    case "a":
      return a ? shareOf(t, a.key) : null;
    case "b":
      return b ? shareOf(t, b.key) : null;
    case "leadPp":
      return t.leadPp;
    case "sectionsPct":
      return t.sections.totalizedPct;
    case "electorate":
      return t.electorate.total;
  }
}

/** Capitais (seção 32) e maiores eleitorados (seção 33), ordenáveis. */
export function RankingsPanel() {
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  const [tab, setTab] = useState<Tab>("capitals");
  const [limit, setLimit] = useState<20 | 50 | 100>(20);
  const [sort, setSort] = useState<SortKey>("electorate");
  const [dir, setDir] = useState<SortDirection>("desc");
  const query = useQuery({
    queryKey: ["live-election", "ranking", tab, tab === "largest" ? limit : 0],
    queryFn: ({ signal }) => (tab === "capitals" ? fetchCapitals({ signal }) : fetchLargest(limit, { signal })),
    refetchInterval: 30_000,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
  const list = useMemo(() => candidates ?? [], [candidates]);
  const [a, b] = list;
  const rows = useMemo(
    () => [...(query.data?.data.items ?? [])].sort((x, y) => compareNullable(sortValue(x, sort, list), sortValue(y, sort, list), dir)),
    [query.data, sort, dir, list],
  );

  const header = (key: SortKey, label: string, numeric = true) => (
    <th scope="col" aria-sort={sort === key ? (dir === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-2 text-micro font-semibold uppercase text-fg-muted ${numeric ? "text-right" : "text-left"}`}>
      <button
        type="button"
        className="focus-ring inline-flex items-center gap-1 rounded hover:text-fg"
        onClick={() => {
          if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
          else {
            setSort(key);
            setDir(key === "name" ? "asc" : "desc");
          }
        }}
      >
        {label}
        <span aria-hidden="true">{sort === key ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  return (
    <section aria-labelledby="live-rankings" data-testid="live-rankings">
      <SectionHeading
        id="live-rankings"
        eyebrow="Municípios"
        title={tab === "capitals" ? "Capitais" : "Maiores eleitorados"}
        description={query.data ? `Base: ${query.data.data.basis}. Resultados recebidos: ${formatPercent(query.data.data.coveragePct, 1)} da lista.` : undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="segmented" role="group" aria-label="Lista">
              {(["capitals", "largest"] as Tab[]).map((t) => (
                <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className="segmented-item focus-ring rounded-md px-2.5 py-1 text-micro font-medium">
                  {t === "capitals" ? "Capitais" : "Maiores eleitorados"}
                </button>
              ))}
            </div>
            {tab === "largest" ? (
              <label className="flex items-center gap-1 text-micro text-fg-muted">
                Top
                <select value={limit} onChange={(e) => setLimit(Number(e.target.value) as 20 | 50 | 100)} className="focus-ring rounded-md border border-line bg-surface px-2 py-1 text-body-sm text-fg">
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            ) : null}
          </div>
        }
      />
      {query.isError && !query.data ? (
        <p role="status" className="rounded-2xl border border-line bg-surface p-4 text-body-sm text-fg-muted">
          Não foi possível carregar a lista agora.{" "}
          <button type="button" onClick={() => void query.refetch()} className="focus-ring rounded font-medium text-accent-text hover:underline">
            Tentar de novo
          </button>
        </p>
      ) : !query.data ? (
        <div className="skeleton h-72 rounded-2xl" aria-busy="true" aria-label="Carregando a lista" />
      ) : (
        <div className="max-h-[560px] overflow-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[560px] text-body-sm">
            <caption className="sr-only">{tab === "capitals" ? "Resultado nas capitais" : "Resultado nos municípios de maior eleitorado"}</caption>
            <thead className="live-sticky-head">
              <tr className="border-b border-line">
                {header("name", "Município", false)}
                {header("a", a ? a.ballotName : "A")}
                {header("b", b ? b.ballotName : "B")}
                {header("leadPp", "Diferença")}
                {header("sectionsPct", "Totalização")}
                {header("electorate", "Eleitorado")}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const leader = candidateByKey(list, t.leaderKey);
                return (
                  <tr key={t.code} className="border-b border-line/60 last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left">
                      <span className="block font-semibold text-fg">
                        {t.name}
                        {t.uf ? <span className="font-normal text-fg-muted"> · {t.uf}</span> : null}
                      </span>
                      <span className="flex items-center gap-1 text-micro text-fg-muted">
                        {leader ? <SlotSwatch slot={leader.slot} className="h-2 w-2" /> : null}
                        {t.available ? (leader ? `${leader.ballotName} à frente` : (t.votes.valid ?? 0) > 0 ? "Empate" : "Sem votos totalizados") : "Resultado ainda não recebido"}
                      </span>
                    </th>
                    <td className="px-3 py-2 text-right">{a && t.available ? formatPercent(shareOf(t, a.key)) : "—"}</td>
                    <td className="px-3 py-2 text-right">{b && t.available ? formatPercent(shareOf(t, b.key)) : "—"}</td>
                    <td className="px-3 py-2 text-right">{t.available ? formatPercentagePoints(leadPpOf(t)) : "—"}</td>
                    <td className="px-3 py-2 text-right">{t.available ? formatSectionsPct(t.sections.totalizedPct) : "—"}</td>
                    <td className="px-3 py-2 text-right">{formatInteger(t.electorate.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
