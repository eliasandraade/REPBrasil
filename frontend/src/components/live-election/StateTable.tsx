"use client";

import { useMemo, useState } from "react";
import { candidateByKey, compareNullable, leadPpOf, leadVotesOf, matchesSearch, REGION_LABEL, shareOf, slotOf, type SortDirection } from "@/lib/live-election/derive";
import {
  formatPercent,
  formatPercentagePoints,
  formatSections,
  formatSectionsPct,
  formatTimestamp,
  formatVotes,
} from "@/lib/live-election/format";
import type { LiveCandidate, RegionCode, TerritoryResult } from "@/lib/live-election/types";
import { useLive } from "./LiveContext";
import { SectionHeading, SlotSwatch } from "./primitives";

export type StateSortKey =
  | "uf"
  | "region"
  | "leader"
  | "a"
  | "b"
  | "leadPp"
  | "leadVotes"
  | "valid"
  | "turnout"
  | "abstention"
  | "sections"
  | "sectionsPct"
  | "updated";

type LeaderFilter = "all" | "a" | "b" | "tie";
type ProgressFilter = "all" | "incomplete" | "finished";

function sortValue(s: TerritoryResult, key: StateSortKey, candidates: readonly LiveCandidate[]): number | string | null {
  const [a, b] = candidates;
  switch (key) {
    case "uf":
      return s.name;
    case "region":
      return s.region ? REGION_LABEL[s.region] : null;
    case "leader":
      return candidateByKey(candidates, s.leaderKey)?.ballotName ?? null;
    case "a":
      return a ? shareOf(s, a.key) : null;
    case "b":
      return b ? shareOf(s, b.key) : null;
    case "leadPp":
      return s.leadPp;
    case "leadVotes":
      return s.leadVotes;
    case "valid":
      return s.votes.valid;
    case "turnout":
      return s.electorate.turnoutPct;
    case "abstention":
      return s.electorate.abstentionPct;
    case "sections":
      return s.sections.totalized;
    case "sectionsPct":
      return s.sections.totalizedPct;
    case "updated":
      return s.totalizedAt ? Date.parse(s.totalizedAt) : null;
  }
}

/** Filtra e ordena as UFs (função pura, testada). */
export function filterAndSortStates(
  states: readonly TerritoryResult[],
  candidates: readonly LiveCandidate[],
  options: { query: string; region: RegionCode | "all"; leader: LeaderFilter; progress: ProgressFilter; sort: StateSortKey; dir: SortDirection },
): TerritoryResult[] {
  return states
    .filter((s) => matchesSearch(`${s.code} ${s.name}`, options.query))
    .filter((s) => options.region === "all" || s.region === options.region)
    .filter((s) => {
      if (options.leader === "all") return true;
      const slot = slotOf(candidates, s.leaderKey);
      if (options.leader === "tie") return s.available && !slot && (s.votes.valid ?? 0) > 0;
      return slot === options.leader;
    })
    .filter((s) => {
      if (options.progress === "all") return true;
      const done = s.progress === "finished" || (s.sections.totalizedPct ?? 0) >= 100;
      return options.progress === "finished" ? done : !done;
    })
    .sort((x, y) => compareNullable(sortValue(x, options.sort, candidates), sortValue(y, options.sort, candidates), options.dir) || x.name.localeCompare(y.name, "pt-BR"));
}

const REGIONS = Object.keys(REGION_LABEL) as RegionCode[];

/** Tabela das UFs (seção 28): ordenação por qualquer coluna, filtros, busca, cabeçalho fixo e versão de celular. */
export function StateResultsTable({ onSelect }: Readonly<{ onSelect: (uf: string) => void }>) {
  const states = useLive((s) => s.states?.states ?? null);
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<RegionCode | "all">("all");
  const [leader, setLeader] = useState<LeaderFilter>("all");
  const [progress, setProgress] = useState<ProgressFilter>("all");
  const [sort, setSort] = useState<StateSortKey>("uf");
  const [dir, setDir] = useState<SortDirection>("asc");
  const list = useMemo(() => candidates ?? [], [candidates]);
  const [a, b] = list;

  const rows = useMemo(
    () => filterAndSortStates(states ?? [], list, { query, region, leader, progress, sort, dir }),
    [states, list, query, region, leader, progress, sort, dir],
  );

  const toggleSort = (key: StateSortKey) => {
    if (key === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "uf" || key === "region" || key === "leader" ? "asc" : "desc");
    }
  };

  const columns: { key: StateSortKey; label: string; numeric: boolean; className?: string }[] = [
    { key: "uf", label: "UF", numeric: false },
    { key: "region", label: "Região", numeric: false },
    { key: "leader", label: "À frente", numeric: false },
    { key: "a", label: a ? `${a.ballotName} %` : "A %", numeric: true },
    { key: "b", label: b ? `${b.ballotName} %` : "B %", numeric: true },
    { key: "leadPp", label: "Dif. p.p.", numeric: true },
    { key: "leadVotes", label: "Dif. votos", numeric: true },
    { key: "valid", label: "Votos válidos", numeric: true },
    { key: "turnout", label: "Comparec.", numeric: true },
    { key: "abstention", label: "Abstenção", numeric: true },
    { key: "sections", label: "Seções tot.", numeric: true },
    { key: "sectionsPct", label: "% totaliz.", numeric: true },
    { key: "updated", label: "Atualização", numeric: true },
  ];

  return (
    <section aria-labelledby="live-state-table" data-testid="live-state-table">
      <SectionHeading id="live-state-table" eyebrow="Estados" title="Resultado por UF" description="Selecione uma UF para abrir o painel com capital, interior, evolução e comparação com o 1º turno." />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-micro font-medium text-fg-muted">
          Buscar UF
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ex.: Bahia ou BA"
            className="focus-ring rounded-lg border border-line bg-surface px-3 py-2 text-body-sm text-fg"
          />
        </label>
        <label className="flex flex-col gap-1 text-micro font-medium text-fg-muted">
          Região
          <select value={region} onChange={(e) => setRegion(e.target.value as RegionCode | "all")} className="focus-ring rounded-lg border border-line bg-surface px-2 py-2 text-body-sm text-fg">
            <option value="all">Todas</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {REGION_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-micro font-medium text-fg-muted">
          À frente
          <select value={leader} onChange={(e) => setLeader(e.target.value as LeaderFilter)} className="focus-ring rounded-lg border border-line bg-surface px-2 py-2 text-body-sm text-fg">
            <option value="all">Todos</option>
            {a ? <option value="a">{a.ballotName}</option> : null}
            {b ? <option value="b">{b.ballotName}</option> : null}
            <option value="tie">Empate</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-micro font-medium text-fg-muted">
          Totalização
          <select value={progress} onChange={(e) => setProgress(e.target.value as ProgressFilter)} className="focus-ring rounded-lg border border-line bg-surface px-2 py-2 text-body-sm text-fg">
            <option value="all">Todas</option>
            <option value="incomplete">Incompleta</option>
            <option value="finished">Finalizada</option>
          </select>
        </label>
        <p className="text-micro text-fg-muted" aria-live="polite">
          {rows.length} {rows.length === 1 ? "UF" : "UFs"}
        </p>
      </div>

      {/* Desktop/tablet: tabela com cabeçalho fixo */}
      <div className="hidden max-h-[640px] overflow-auto rounded-2xl border border-line bg-surface md:block">
        <table className="w-full text-body-sm">
          <caption className="sr-only">Resultado do 2º turno por UF; selecione o nome da UF para abrir o painel</caption>
          <thead className="live-sticky-head">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                  className={`whitespace-nowrap border-b border-line px-3 py-2 text-micro font-semibold uppercase text-fg-muted ${c.numeric ? "text-right" : "text-left"}`}
                >
                  <button type="button" onClick={() => toggleSort(c.key)} className="focus-ring inline-flex items-center gap-1 rounded hover:text-fg">
                    {c.label}
                    <span aria-hidden="true">{sort === c.key ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const leaderC = candidateByKey(list, s.leaderKey);
              return (
                <tr key={s.code} className="border-b border-line/60 hover:bg-subtle/60" data-testid="live-state-row" data-uf={s.code}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <button type="button" onClick={() => onSelect(s.code)} className="focus-ring rounded text-left text-fg hover:text-accent-text hover:underline">
                      <span className="font-semibold">{s.code}</span> <span className="text-fg-muted">{s.name}</span>
                    </button>
                  </th>
                  <td className="px-3 py-2 text-fg-soft">{s.region ? REGION_LABEL[s.region] : "—"}</td>
                  <td className="px-3 py-2">
                    {leaderC ? (
                      <span className="flex items-center gap-1.5 text-fg">
                        <SlotSwatch slot={leaderC.slot} className="h-2.5 w-2.5" />
                        {leaderC.ballotName}
                      </span>
                    ) : (
                      <span className="text-fg-muted">{(s.votes.valid ?? 0) > 0 ? "Empate" : "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{a ? formatPercent(shareOf(s, a.key)) : "—"}</td>
                  <td className="px-3 py-2 text-right">{b ? formatPercent(shareOf(s, b.key)) : "—"}</td>
                  <td className="px-3 py-2 text-right">{formatPercentagePoints(leadPpOf(s))}</td>
                  <td className="px-3 py-2 text-right">{formatVotes(leadVotesOf(s))}</td>
                  <td className="px-3 py-2 text-right">{formatVotes(s.votes.valid)}</td>
                  <td className="px-3 py-2 text-right">{formatPercent(s.electorate.turnoutPct)}</td>
                  <td className="px-3 py-2 text-right">{formatPercent(s.electorate.abstentionPct)}</td>
                  <td className="px-3 py-2 text-right">{formatSections(s.sections.totalized)}</td>
                  <td className="px-3 py-2 text-right">{formatSectionsPct(s.sections.totalizedPct)}</td>
                  <td className="px-3 py-2 text-right text-fg-muted">{formatTimestamp(s.totalizedAt, "time")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Celular: lista com as colunas essenciais (sem rolagem horizontal) */}
      <div className="md:hidden">
        <label className="mb-2 flex items-center gap-2 text-micro font-medium text-fg-muted">
          Ordenar por
          <select
            value={`${sort}:${dir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(":") as [StateSortKey, SortDirection];
              setSort(k);
              setDir(d);
            }}
            className="focus-ring rounded-lg border border-line bg-surface px-2 py-1.5 text-body-sm text-fg"
          >
            <option value="uf:asc">Nome da UF</option>
            <option value="leadPp:desc">Maior diferença</option>
            <option value="leadPp:asc">Menor diferença</option>
            <option value="sectionsPct:asc">Menos totalizada</option>
            <option value="sectionsPct:desc">Mais totalizada</option>
            <option value="valid:desc">Mais votos válidos</option>
          </select>
        </label>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {rows.map((s) => {
            const leaderC = candidateByKey(list, s.leaderKey);
            return (
              <li key={s.code}>
                <button type="button" onClick={() => onSelect(s.code)} className="focus-ring flex w-full items-center justify-between gap-3 px-3 py-3 text-left">
                  <span className="min-w-0">
                    <span className="block truncate text-body-sm font-semibold text-fg">
                      {s.code} · {s.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-micro text-fg-muted">
                      {leaderC ? <SlotSwatch slot={leaderC.slot} className="h-2 w-2" /> : null}
                      {leaderC ? `${leaderC.ballotName} à frente` : (s.votes.valid ?? 0) > 0 ? "Empate" : "Sem votos totalizados"} ·{" "}
                      {formatSectionsPct(s.sections.totalizedPct)} totalizado
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-right text-body-sm">
                    <span className="flex items-center justify-end gap-1.5 font-semibold text-fg">
                      <SlotSwatch slot="a" className="h-2 w-2" />
                      {a ? formatPercent(shareOf(s, a.key)) : "—"}
                    </span>
                    <span className="flex items-center justify-end gap-1.5 text-fg-muted">
                      <SlotSwatch slot="b" className="h-2 w-2" />
                      {b ? formatPercent(shareOf(s, b.key)) : "—"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {rows.length === 0 ? <p className="mt-3 text-body-sm text-fg-muted">Nenhuma UF corresponde aos filtros.</p> : null}
    </section>
  );
}

