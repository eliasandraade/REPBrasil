"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { displayName, formatCount, formatPercent, outcomeLabel } from "@/lib/elections/format";
import { CELL_STATE_LABEL, MAX_COMPARE, xrayApi, type CandidatesFilters } from "@/lib/elections/xray";

type Sort = NonNullable<CandidatesFilters["sort"]>;

export interface TerritoryCandidatesProps {
  year: number;
  round: number;
  uf: string;
  municipality: string | null;
  zone: number | null;
  /** Seleção de comparação (máx. 5) e ações; o pai guarda a seleção na URL. */
  selection: string[];
  onToggleCompare: (candidacyId: string) => void;
  onShowOnMap: (candidacyId: string) => void;
  limitHit?: boolean;
}

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: "votes", label: "Votos" },
  { id: "share", label: "% válidos" },
  { id: "name", label: "Nome" },
  { id: "number", label: "Número" },
  { id: "party", label: "Partido" },
  { id: "office", label: "Cargo" },
];

function electedOption(elected: boolean | null): string {
  if (elected === null) return "";
  return elected ? "1" : "0";
}

/**
 * Território → candidaturas: todas as candidaturas de disputas que alcançam o território (federal, estadual e as
 * municipais do município), com votos NO território. Filtros e ordenação são da API; nenhum número é calculado aqui.
 */
export function TerritoryCandidates(props: Readonly<TerritoryCandidatesProps>) {
  const { year, round, uf, municipality, zone } = props;
  const [office, setOffice] = useState<number | null>(null);
  const [party, setParty] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [elected, setElected] = useState<boolean | null>(null);
  const [minVotes, setMinVotes] = useState<string>("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<Sort>("votes");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [office, party, status, elected, minVotes, debouncedQ, sort, dir, municipality, zone]);

  const filters: CandidatesFilters = {
    municipality,
    zone,
    office,
    party,
    status,
    elected,
    minVotes: minVotes === "" ? null : Number(minVotes),
    q: debouncedQ || null,
    sort,
    dir,
    page,
    pageSize,
  };
  const query = useQuery({
    queryKey: ["territory-candidates", year, round, uf, filters],
    queryFn: () => xrayApi.candidates(year, round, uf, filters),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const select = "rounded-md border border-white/10 bg-background px-2 py-1 text-xs text-slate-200 focus:border-brand/40 focus:outline-none";

  return (
    <div data-testid="territory-candidates">
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <input
          type="search"
          aria-label="Buscar candidatura"
          placeholder="Nome ou número"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={`${select} col-span-2 py-1.5`}
        />
        <select aria-label="Cargo" className={select} value={office ?? ""} onChange={(e) => setOffice(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Todos os cargos</option>
          {data?.offices.map((f) => (
            <option key={f.value} value={f.value}>
              {displayName(f.label)} ({f.count})
            </option>
          ))}
        </select>
        <select aria-label="Partido" className={select} value={party ?? ""} onChange={(e) => setParty(e.target.value || null)}>
          <option value="">Todos os partidos</option>
          {data?.parties.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label} ({f.count})
            </option>
          ))}
        </select>
        <select aria-label="Situação" className={select} value={status ?? ""} onChange={(e) => setStatus(e.target.value || null)}>
          <option value="">Toda situação</option>
          {data?.statuses.map((f) => (
            <option key={f.value} value={f.value}>
              {displayName(f.label)} ({f.count})
            </option>
          ))}
        </select>
        <select
          aria-label="Eleito"
          className={select}
          value={electedOption(elected)}
          onChange={(e) => setElected(e.target.value === "" ? null : e.target.value === "1")}
        >
          <option value="">Eleitos e não eleitos</option>
          <option value="1">Eleitos</option>
          <option value="0">Não eleitos</option>
        </select>
        <input
          type="number"
          min={0}
          aria-label="Votos mínimos no território"
          placeholder="Votos mín."
          value={minVotes}
          onChange={(e) => setMinVotes(e.target.value)}
          className={select}
        />
        <div className="flex gap-1">
          <select aria-label="Ordenar por" className={`${select} flex-1`} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={dir === "desc" ? "Ordem decrescente" : "Ordem crescente"}
            onClick={() => setDir(dir === "desc" ? "asc" : "desc")}
            className={`${select} w-8`}
          >
            {dir === "desc" ? "↓" : "↑"}
          </button>
        </div>
      </div>

      <p className="mb-2 text-[11px] text-slate-500">
        {data ? `${formatCount(data.total)} candidaturas` : "Carregando…"} · seleção para comparar: {props.selection.length}/{MAX_COMPARE}
        {props.limitHit && <span className="text-amber-300"> · limite atingido</span>}
      </p>
      {data?.freshness.stale && <p className="mb-2 text-[11px] text-amber-300/80">{data.freshness.note}</p>}
      {query.isError && <p className="text-xs text-slate-400">Não foi possível carregar as candidaturas do território.</p>}

      <ul className="max-h-[52vh] space-y-1 overflow-y-auto pr-1" data-testid="candidate-list" aria-busy={query.isFetching}>
        {data?.items.map((c) => {
          const compared = props.selection.includes(c.candidacyId);
          return (
            <li key={c.candidacyId} className="rounded-lg border border-white/8 bg-card-elevated/50 px-3 py-2" data-candidacy={c.candidacyId} data-state={c.state}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">
                    {c.rank !== null && <span className="mr-1 font-mono text-[10px] text-slate-600">{c.rank}º</span>}
                    {c.politicianId ? (
                      <Link href={`/politico/${c.politicianId}?aba=raio-x`} className="hover:text-brand">
                        {displayName(c.ballotName)}
                      </Link>
                    ) : (
                      displayName(c.ballotName)
                    )}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {displayName(c.contest.officeName)}
                    {c.contest.unit.scope === "municipal" ? ` · ${c.contest.unit.name}` : ""} · nº {c.number}
                    {c.party?.acronym ? ` · ${c.party.acronym}` : ""}
                    {c.roundOutcome ? ` · ${outcomeLabel(c.roundOutcome)}` : ""}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-sm font-semibold text-slate-100">
                    {c.votes === null ? <span className="text-[11px] font-normal text-slate-500">{CELL_STATE_LABEL[c.state]}</span> : formatCount(c.votes)}
                  </p>
                  {c.share !== null && <p className="text-[10px] text-slate-500">{formatPercent(c.share)}</p>}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-3 text-[11px]">
                <label className="flex cursor-pointer items-center gap-1 text-slate-400">
                  <input type="checkbox" checked={compared} onChange={() => props.onToggleCompare(c.candidacyId)} className="accent-[#0dd48e]" />
                  <span>comparar</span>
                </label>
                {c.votes !== null && (
                  <button type="button" onClick={() => props.onShowOnMap(c.candidacyId)} className="text-brand hover:underline">
                    ver no mapa
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {data && pages > 1 && (
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-white/10 px-2 py-0.5 disabled:opacity-40">
            ← Anterior
          </button>
          <span>
            Página {page} de {pages}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded border border-white/10 px-2 py-0.5 disabled:opacity-40">
            Próxima →
          </button>
        </div>
      )}
      <p className="mt-2 text-[10px] text-slate-600">
        Votos no território = Boletins de Urna vigentes. Posição dentro da mesma disputa, no território. &ldquo;Sem Boletim de Urna&rdquo; e &ldquo;fora da
        urna&rdquo; nunca viram zero.
      </p>
    </div>
  );
}
