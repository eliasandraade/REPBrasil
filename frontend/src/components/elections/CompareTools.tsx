"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { ExportActions } from "@/components/export/ExportActions";
import { displayName, formatCount } from "@/lib/elections/format";
import { buildElectionsPath } from "@/lib/elections/route";
import { candidacyComparisonReport } from "@/lib/elections/comparison-report";
import { electionLabel, xrayApi } from "@/lib/elections/xray";
import { useCompareMax } from "@/lib/elections/useCompareMax";
import type { ComparisonResponse, TerritoryLevel } from "@/lib/elections/xray-types";
import { searchAll, searchableQuery, type SearchPolitician } from "@/lib/search";
import { byRecency } from "@/components/xray/useXray";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function PersonCandidacies({
  person,
  selected,
  full,
  onAdd,
}: Readonly<{ person: SearchPolitician; selected: string[]; full: boolean; onAdd: (candidacyId: string, uf: string | null) => void }>) {
  const q = useQuery({ queryKey: ["xray", person.id], queryFn: () => xrayApi.xray(person.id), staleTime: 60_000 });
  if (q.isLoading) return <div className="skeleton mt-2 h-10 rounded-md" aria-busy="true" aria-label="Carregando candidaturas" />;
  if (q.isError || !q.data) return <p className="mt-2 text-xs text-fg-muted">Não foi possível carregar as candidaturas.</p>;
  const own = byRecency(q.data.candidacies).filter((c) => !c.ticket && c.totals.votes !== null);
  if (own.length === 0) return <p className="mt-2 text-xs text-fg-muted">Sem candidatura com votos apurados na base.</p>;
  return (
    <ul className="mt-2 space-y-1" aria-label={`Candidaturas de ${displayName(person.ballotName ?? person.name)}`}>
      {own.map((c) => {
        const already = selected.includes(c.candidacyId);
        return (
          <li key={c.candidacyId} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-fg-soft">
              {electionLabel(c.contest.year, c.contest.round)} · {displayName(c.contest.officeName)} · {displayName(c.contest.unit.name)}
              <span className="text-fg-muted"> · {formatCount(c.totals.votes)} votos</span>
            </span>
            <button
              type="button"
              disabled={already || full}
              onClick={() => onAdd(c.candidacyId, c.contest.unit.uf)}
              className="focus-ring flex-shrink-0 rounded border border-accent/30 px-2 py-0.5 text-accent-text hover:bg-accent/10 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-muted"
            >
              {already ? "Na comparação" : "Adicionar"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function AddCandidacy({
  selected,
  onAdd,
}: Readonly<{ selected: string[]; onAdd: (candidacyId: string, uf: string | null) => void }>) {
  const inputId = useId();
  const [text, setText] = useState("");
  const [person, setPerson] = useState<SearchPolitician | null>(null);
  const query = searchableQuery(useDebounced(text, 200));
  const { max } = useCompareMax();
  const full = selected.length >= max;
  const results = useQuery({
    queryKey: ["search", query],
    queryFn: ({ signal }) => searchAll(query as string, signal),
    enabled: query !== null && !person,
    staleTime: 5 * 60_000,
  });
  const people = results.data?.politicians ?? [];
  return (
    <div className="rounded-xl border border-line bg-surface p-4" data-testid="compare-add">
      <label htmlFor={inputId} className="text-sm font-medium text-fg-soft">
        Adicionar candidatura <span className="font-normal text-fg-muted">({selected.length} de {max})</span>
      </label>
      {full ? (
        <p className="mt-2 text-xs text-warn">Limite de {max} candidaturas: remova uma para adicionar outra.</p>
      ) : (
        <>
          <input
            id={inputId}
            type="search"
            value={text}
            onChange={(e) => { setText(e.target.value); setPerson(null); }}
            placeholder="Nome de urna (ex.: Camilo)"
            autoComplete="off"
            className="focus-ring mt-2 w-full rounded-md border border-line bg-canvas/60 px-3 py-2 text-sm text-fg placeholder:text-fg-muted"
          />
          {person ? (
            <div className="mt-3">
              <p className="flex items-center justify-between gap-2 text-sm text-fg-soft">
                {displayName(person.ballotName ?? person.name)}
                <button type="button" onClick={() => setPerson(null)} className="focus-ring rounded text-xs text-accent-text hover:underline">outra pessoa</button>
              </p>
              <PersonCandidacies person={person} selected={selected} full={full} onAdd={onAdd} />
            </div>
          ) : query !== null ? (
            <ul className="mt-2 space-y-1" aria-label="Pessoas encontradas">
              {results.isLoading && <li className="skeleton h-8 rounded-md" aria-hidden="true" />}
              {people.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setPerson(p)} className="focus-ring w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-fg/[0.04]">
                    <span className="text-fg-soft">{displayName(p.ballotName ?? p.name)}</span>
                    {p.candidacy && <span className="text-fg-muted"> · {p.candidacy.officeName} {p.candidacy.year}{p.candidacy.party ? ` · ${p.candidacy.party}` : ""}</span>}
                  </button>
                </li>
              ))}
              {results.data && people.length === 0 && <li className="px-2 text-xs text-fg-muted">Ninguém encontrado com esse nome.</li>}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

export function CompareActions({
  data,
  columns,
  level,
  uf,
}: Readonly<{ data: ComparisonResponse; columns: ComparisonResponse["candidacies"]; level: TerritoryLevel; uf: string }>) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [a, b] = columns;
  const sameElection = columns.length === 2 && a.contest.year === b.contest.year && a.contest.round === b.contest.round;
  const mapHref = sameElection
    ? `${buildElectionsPath({ year: a.contest.year, round: a.contest.round, state: uf.toLowerCase() })}?camada=ab&a=${a.candidacyId}&b=${b.candidacyId}`
    : null;
  const report = useMemo(
    () => candidacyComparisonReport(data, columns, level, typeof window === "undefined" ? "" : window.location.href),
    [columns, data, level],
  );
  return (
    <div className="space-y-2" data-testid="compare-actions">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => setCopied("ok")).catch(() => setCopied("fail"))}
          className="focus-ring rounded-md border border-line-strong px-2.5 py-1 text-fg-soft hover:border-line-strong"
        >
          Copiar link
        </button>
        {mapHref && <Link href={mapHref} className="focus-ring rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 font-medium text-accent-text hover:bg-accent/15">Ver A × B no mapa →</Link>}
        <span role="status" aria-live="polite" className="text-fg-muted">
          {copied === "ok" && "Link copiado."}
          {copied === "fail" && "Não foi possível copiar; use a barra de endereço."}
        </span>
      </div>
      <ExportActions report={report} />
    </div>
  );
}
