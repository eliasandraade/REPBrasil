"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { displayName, formatCount } from "@/lib/elections/format";
import { buildElectionsPath } from "@/lib/elections/route";
import { comparisonCsv, downloadText } from "@/lib/elections/compare-csv";
import { electionLabel, MAX_COMPARE, xrayApi } from "@/lib/elections/xray";
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

/** Candidaturas de uma pessoa, para escolher qual entra na comparação (só as com voto próprio). */
function PersonCandidacies({
  person,
  selected,
  full,
  onAdd,
}: Readonly<{ person: SearchPolitician; selected: string[]; full: boolean; onAdd: (candidacyId: string, uf: string | null) => void }>) {
  const q = useQuery({ queryKey: ["xray", person.id], queryFn: () => xrayApi.xray(person.id), staleTime: 60_000 });
  if (q.isLoading) return <div className="skeleton mt-2 h-10 rounded-md" role="status" aria-busy="true" aria-label="Carregando candidaturas" />;
  if (q.isError || !q.data) return <p className="mt-2 text-xs text-slate-400">Não foi possível carregar as candidaturas.</p>;
  const own = byRecency(q.data.candidacies).filter((c) => !c.ticket && c.totals.votes !== null);
  if (own.length === 0) return <p className="mt-2 text-xs text-slate-500">Sem candidatura com votos apurados na base.</p>;
  return (
    <ul className="mt-2 space-y-1" aria-label={`Candidaturas de ${displayName(person.ballotName ?? person.name)}`}>
      {own.map((c) => {
        const already = selected.includes(c.candidacyId);
        return (
          <li key={c.candidacyId} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-slate-300">
              {electionLabel(c.contest.year, c.contest.round)} · {displayName(c.contest.officeName)} · {displayName(c.contest.unit.name)}
              <span className="text-slate-500"> · {formatCount(c.totals.votes)} votos</span>
            </span>
            <button
              type="button"
              disabled={already || full}
              onClick={() => onAdd(c.candidacyId, c.contest.unit.uf)}
              className="focus-ring flex-shrink-0 rounded border border-brand/30 px-2 py-0.5 text-brand hover:bg-brand/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-600"
            >
              {already ? "Na comparação" : "Adicionar"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Montar a comparação aqui mesmo: procurar a pessoa pelo nome e escolher a candidatura. */
export function AddCandidacy({
  selected,
  onAdd,
}: Readonly<{ selected: string[]; onAdd: (candidacyId: string, uf: string | null) => void }>) {
  const inputId = useId();
  const [text, setText] = useState("");
  const [person, setPerson] = useState<SearchPolitician | null>(null);
  const query = searchableQuery(useDebounced(text, 200));
  const full = selected.length >= MAX_COMPARE;
  const results = useQuery({
    queryKey: ["search", query],
    queryFn: ({ signal }) => searchAll(query as string, signal),
    enabled: query !== null && !person,
    staleTime: 5 * 60_000,
  });
  const people = results.data?.politicians ?? [];
  return (
    <div className="rounded-xl border border-white/[0.08] bg-card p-4" data-testid="compare-add">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-200">
        Adicionar candidatura{" "}
        <span className="font-normal text-slate-500">
          ({selected.length} de {MAX_COMPARE})
        </span>
      </label>
      {full ? (
        <p className="mt-2 text-xs text-amber-300">Limite de {MAX_COMPARE} candidaturas: remova uma para adicionar outra.</p>
      ) : (
        <>
          <input
            id={inputId}
            type="search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPerson(null);
            }}
            placeholder="Nome de urna (ex.: Camilo)"
            autoComplete="off"
            className="focus-ring mt-2 w-full rounded-md border border-white/10 bg-background/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          {person ? (
            <div className="mt-3">
              <p className="flex items-center justify-between gap-2 text-sm text-slate-200">
                {displayName(person.ballotName ?? person.name)}
                <button type="button" onClick={() => setPerson(null)} className="focus-ring rounded text-xs text-brand hover:underline">
                  outra pessoa
                </button>
              </p>
              <PersonCandidacies person={person} selected={selected} full={full} onAdd={onAdd} />
            </div>
          ) : (
            query !== null && (
              <ul className="mt-2 space-y-1" aria-label="Pessoas encontradas">
                {results.isLoading && <li className="skeleton h-8 rounded-md" aria-hidden="true" />}
                {people.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPerson(p)}
                      className="focus-ring w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/[0.04]"
                    >
                      <span className="text-slate-200">{displayName(p.ballotName ?? p.name)}</span>
                      {p.candidacy && (
                        <span className="text-slate-500">
                          {" "}
                          · {p.candidacy.officeName} {p.candidacy.year}
                          {p.candidacy.party ? ` · ${p.candidacy.party}` : ""}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {results.data && people.length === 0 && <li className="px-2 text-xs text-slate-500">Ninguém encontrado com esse nome.</li>}
              </ul>
            )
          )}
        </>
      )}
    </div>
  );
}

/** Link compartilhável, mapa A × B (duas candidaturas da mesma eleição) e CSV da matriz. */
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
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="compare-actions">
      <button
        type="button"
        onClick={() =>
          navigator.clipboard
            ?.writeText(window.location.href)
            .then(() => setCopied("ok"))
            .catch(() => setCopied("fail"))
        }
        className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-slate-300 hover:border-white/30"
      >
        Copiar link
      </button>
      <button
        type="button"
        onClick={() => downloadText(`repbrasil-comparacao-${level}.csv`, comparisonCsv(data, columns, level))}
        className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-slate-300 hover:border-white/30"
      >
        Baixar CSV
      </button>
      {mapHref && (
        <Link href={mapHref} className="focus-ring rounded-md border border-brand/30 bg-brand/10 px-2.5 py-1 font-medium text-brand hover:bg-brand/15">
          Ver A × B no mapa →
        </Link>
      )}
      <span role="status" aria-live="polite" className="text-slate-500">
        {copied === "ok" && "Link copiado."}
        {copied === "fail" && "Não foi possível copiar; use a barra de endereço."}
      </span>
    </div>
  );
}
