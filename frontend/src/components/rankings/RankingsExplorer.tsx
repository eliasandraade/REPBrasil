"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, apiErrorMessage } from "@/lib/api";
import { electionsApi } from "@/lib/elections/api";
import { formatCount, formatPercent, UNAVAILABLE } from "@/lib/elections/format";
import { politicianPath } from "@/lib/paths";
import {
  KIND_GROUPS,
  RANKING_PAGE_SIZE,
  missingSelection,
  officesFor,
  parseRankingQuery,
  rankingSearch,
  rankingsApi,
  type RankingItem,
  type RankingKind,
  type RankingQuery,
  type RankingResponse,
} from "@/lib/rankings";
import { DataState, RetryButton } from "@/components/ui/DataState";

const field = "w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-fg focus-ring";
const labelCls = "mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted";

/**
 * Rankings: ordenações determinísticas de dados oficiais, com filtros obrigatórios na URL (fonte da verdade).
 * Cada tipo diz o que mede, a fonte e o que não compara; recortes incompatíveis não são consultados.
 */
export function RankingsExplorer() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = useMemo(() => parseRankingQuery(new URLSearchParams(search.toString())), [search]);

  const kindsQ = useQuery({ queryKey: ["ranking-kinds"], queryFn: rankingsApi.kinds, staleTime: Infinity });
  const electionsQ = useQuery({ queryKey: ["elections"], queryFn: electionsApi.elections, staleTime: 10 * 60_000 });
  const elections = useMemo(() => electionsQ.data?.elections ?? [], [electionsQ.data]);
  const kind = kindsQ.data?.find((k) => k.key === q.kind);

  const navigate = (next: Partial<RankingQuery>) => {
    const merged = { ...q, page: 1, ...next };
    router.replace(`${pathname}?${rankingSearch(merged)}`, { scroll: false });
  };

  // Sem eleição na URL: a eleição padrão do catálogo (a URL passa a dizer qual é).
  useEffect(() => {
    if (q.kind === "recurrence" || (q.year !== null && q.round !== null) || elections.length === 0) return;
    const preferred = elections.find((e) => e.default && e.resultsAvailable) ?? elections.find((e) => e.resultsAvailable) ?? elections[0];
    navigate({ year: preferred.year, round: preferred.round });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.kind, q.year, q.round, elections]);

  const offices = officesFor(q.year, q.uf);
  const statesQ = useQuery({
    queryKey: ["states", q.year, q.round],
    queryFn: () => electionsApi.states(q.year!, q.round!),
    enabled: q.year !== null && q.round !== null,
    staleTime: 10 * 60_000,
  });
  const municipalitiesQ = useQuery({
    queryKey: ["municipalities", q.year, q.round, q.uf],
    queryFn: () => electionsApi.municipalities(q.year!, q.round!, q.uf),
    enabled: q.year !== null && q.round !== null,
    staleTime: 10 * 60_000,
  });

  const missing = kindsQ.data ? missingSelection(q, kind) : null;
  const rankQ = useQuery({
    queryKey: ["ranking", rankingSearch(q)],
    queryFn: () => rankingsApi.rank(q),
    enabled: Boolean(kindsQ.data) && missing === null,
    staleTime: 5 * 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });

  return (
    <main className="min-h-screen bg-canvas px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Inteligência eleitoral</p>
        <h1 className="text-2xl font-bold text-fg">Rankings</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Ordenações de dados oficiais do TSE, sempre dentro de uma disputa comparável. Cada ranking diz o que mede, a fonte e o que deixa de
          fora — candidatura sem o dado fica fora da lista, nunca entra como zero.
        </p>

        <Filters
          q={q}
          kinds={kindsQ.data}
          elections={elections}
          offices={offices}
          states={statesQ.data?.states.filter((s) => s.cadasterAvailable || s.resultsAvailable) ?? []}
          municipalities={municipalitiesQ.data?.municipalities ?? []}
          onChange={navigate}
        />

        <section aria-labelledby="ranking-title" className="mt-6">
          {kindsQ.isError ? (
            <DataState kind="error" title="Não foi possível carregar os tipos de ranking." action={<RetryButton onRetry={() => kindsQ.refetch()} />} />
          ) : !kind ? (
            <DataState kind="loading" height="h-28" title="Carregando rankings" />
          ) : (
            <>
              <KindCard kind={kind} />
              <div className="mt-4">
                {missing !== null ? (
                  <DataState kind="not_comparable" title="Escolha o recorte">
                    {missing}
                  </DataState>
                ) : (
                  <Results q={q} query={rankQ} onPage={(page) => navigate({ page })} />
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

// ── Filtros ──────────────────────────────────────────────────────────────────

function Filters({
  q,
  kinds,
  elections,
  offices,
  states,
  municipalities,
  onChange,
}: Readonly<{
  q: RankingQuery;
  kinds: RankingKind[] | undefined;
  elections: Array<{ year: number; round: number }>;
  offices: Array<{ code: number; label: string }>;
  states: Array<{ uf: string; name: string }>;
  municipalities: Array<{ tseCode: string; name: string }>;
  onChange: (next: Partial<RankingQuery>) => void;
}>) {
  const id = useId();
  const [party, setParty] = useState(q.party ?? "");
  useEffect(() => setParty(q.party ?? ""), [q.party]);
  const byKey = new Map((kinds ?? []).map((k) => [k.key, k]));
  const needsElection = q.kind !== "recurrence";

  return (
    <form
      className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Filtros do ranking"
      onSubmit={(e) => {
        e.preventDefault();
        onChange({ party: party.trim().toUpperCase() || null });
      }}
    >
      <div>
        <label htmlFor={`${id}-kind`} className={labelCls}>
          Ranking
        </label>
        <select id={`${id}-kind`} className={field} value={q.kind} onChange={(e) => onChange({ kind: e.target.value as RankingQuery["kind"] })}>
          {KIND_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.kinds.map((k) => (
                <option key={k} value={k}>
                  {byKey.get(k)?.label ?? k}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {needsElection && (
        <div>
          <label htmlFor={`${id}-election`} className={labelCls}>
            Eleição
          </label>
          <select
            id={`${id}-election`}
            className={field}
            value={q.year !== null && q.round !== null ? `${q.year}-${q.round}` : ""}
            onChange={(e) => {
              const [year, round] = e.target.value.split("-").map(Number);
              const sameKind = q.year !== null && q.year % 4 === year % 4;
              onChange({ year, round, office: sameKind ? q.office : null, municipality: null });
            }}
          >
            {q.year === null && <option value="">Carregando…</option>}
            {elections.map((e) => (
              <option key={`${e.year}-${e.round}`} value={`${e.year}-${e.round}`}>
                {e.year} · {e.round}º turno
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor={`${id}-office`} className={labelCls}>
          Cargo
        </label>
        <select
          id={`${id}-office`}
          className={field}
          value={q.office ?? ""}
          onChange={(e) => onChange({ office: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{byKey.get(q.kind)?.requires.includes("office") ? "Escolha o cargo" : "Todos os cargos"}</option>
          {offices.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${id}-uf`} className={labelCls}>
          Estado
        </label>
        <select id={`${id}-uf`} className={field} value={q.uf} onChange={(e) => onChange({ uf: e.target.value, municipality: null })}>
          {!states.some((s) => s.uf === q.uf) && <option value={q.uf}>{q.uf}</option>}
          {states.map((s) => (
            <option key={s.uf} value={s.uf}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {needsElection && (
        <div>
          <label htmlFor={`${id}-mun`} className={labelCls}>
            Município
          </label>
          <select
            id={`${id}-mun`}
            className={field}
            value={q.municipality ?? ""}
            onChange={(e) => onChange({ municipality: e.target.value || null })}
          >
            <option value="">Todo o estado</option>
            {municipalities.map((m) => (
              <option key={m.tseCode} value={m.tseCode}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {needsElection && (
        <div>
          <label htmlFor={`${id}-party`} className={labelCls}>
            Partido (sigla)
          </label>
          <div className="flex gap-2">
            <input
              id={`${id}-party`}
              className={field}
              value={party}
              maxLength={20}
              autoComplete="off"
              placeholder="Todos"
              onChange={(e) => setParty(e.target.value)}
            />
            <button type="submit" className="mi-press focus-ring shrink-0 rounded-md border border-line-strong px-3 text-sm font-medium text-fg-soft hover:border-accent/50">
              Filtrar
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

// ── Definição do tipo ────────────────────────────────────────────────────────

function KindCard({ kind }: Readonly<{ kind: RankingKind }>) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <h2 id="ranking-title" className="text-lg font-semibold text-fg">
        {kind.label}
      </h2>
      <dl className="mt-1 grid gap-x-6 gap-y-1 text-xs text-fg-muted sm:grid-cols-[auto_1fr]">
        <dt className="font-medium text-fg-soft">Mede</dt>
        <dd>
          {kind.definition} ({kind.unit})
        </dd>
        <dt className="font-medium text-fg-soft">Compara</dt>
        <dd>{kind.comparability}</dd>
        <dt className="font-medium text-fg-soft">Fonte</dt>
        <dd>{kind.source}</dd>
      </dl>
    </div>
  );
}

// ── Resultado ────────────────────────────────────────────────────────────────

function Results({
  q,
  query,
  onPage,
}: Readonly<{
  q: RankingQuery;
  query: { data?: RankingResponse; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  onPage: (page: number) => void;
}>) {
  if (query.isLoading || (!query.data && !query.isError)) {
    return (
      <div className="space-y-2" aria-busy="true">
        <DataState kind="loading" height="h-10" title="Carregando ranking" />
        <DataState kind="loading" height="h-64" title="Carregando ranking" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    const error = query.error;
    if (error instanceof ApiError && error.status === 400)
      return (
        <DataState kind="not_comparable" title="Recorte não comparável">
          {apiErrorMessage(error) ?? "Este recorte compararia disputas diferentes."}
        </DataState>
      );
    if (error instanceof ApiError && error.status === 503)
      return (
        <DataState kind="unavailable" title="Dados temporariamente indisponíveis" action={<RetryButton onRetry={() => query.refetch()} />}>
          Parte dos dados históricos está em manutenção. Tente de novo em instantes.
        </DataState>
      );
    return <DataState kind="error" title="Não foi possível carregar o ranking." action={<RetryButton onRetry={() => query.refetch()} />} />;
  }

  const data = query.data;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="space-y-3">
      {data.coverage && !data.coverage.complete && (
        <DataState kind={data.coverage.zonesCovered === 0 ? "no_coverage" : "partial"} title={data.coverage.zonesCovered === 0 ? "Sem cobertura" : "Cobertura parcial"}>
          {data.coverage.note}
        </DataState>
      )}
      {data.items.length === 0 ? (
        <DataState kind="empty" title="Nenhum item com o dado neste recorte.">
          {data.excludedNote || "Tente outro cargo, município ou eleição."}
        </DataState>
      ) : (
        <>
          <p className="text-xs text-fg-muted" aria-live="polite">
            {formatCount(data.total)} {data.total === 1 ? "item" : "itens"} no ranking
            {data.coverage?.complete ? " · cobertura completa do Boletim de Urna" : ""}
          </p>
          <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" data-testid="ranking-list">
            {data.items.map((item) => (
              <Row key={`${item.entityKind}-${item.candidacyId ?? item.politicianId ?? item.name}-${item.position}`} item={item} q={q} />
            ))}
          </ol>
          {pages > 1 && (
            <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Páginas do ranking">
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => onPage(data.page - 1)}
                className="focus-ring rounded-md border border-line px-3 py-1.5 text-fg-soft disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-xs text-fg-muted">
                Página {data.page} de {pages} · {RANKING_PAGE_SIZE} por página
              </span>
              <button
                type="button"
                disabled={data.page >= pages}
                onClick={() => onPage(data.page + 1)}
                className="focus-ring rounded-md border border-line px-3 py-1.5 text-fg-soft disabled:opacity-40"
              >
                Próxima
              </button>
            </nav>
          )}
        </>
      )}
      {data.excluded > 0 && data.items.length > 0 && <p className="text-xs text-fg-muted">{data.excludedNote}</p>}
      <details className="rounded-lg border border-line bg-surface/60 px-4 py-3 text-xs text-fg-muted">
        <summary className="cursor-pointer font-medium text-fg-soft">Metodologia e atualização</summary>
        <p className="mt-2 leading-relaxed">{data.methodology}</p>
        {data.freshness && <p className="mt-1">{data.freshness.note}</p>}
      </details>
    </div>
  );
}

function detailLine(item: RankingItem, q: RankingQuery): string {
  const d = item.details;
  const parts: string[] = [];
  if (item.entityKind === "party") {
    if (typeof d.share === "number") parts.push(`${formatPercent(d.share)} dos válidos`);
    if (typeof d.legendVotes === "number") parts.push(`${formatCount(Number(d.nominalVotes))} nominais + ${formatCount(d.legendVotes)} de legenda`);
    if (typeof d.elected === "number") parts.push(`${d.elected} eleito${d.elected === 1 ? "" : "s"} de ${d.candidacies}`);
    return parts.join(" · ");
  }
  if (item.entityKind === "person") {
    parts.push(`${d.firstYear}–${d.lastYear}`);
    if (typeof d.electedCount === "number") parts.push(`${d.electedCount} candidatura${d.electedCount === 1 ? "" : "s"} eleita${d.electedCount === 1 ? "" : "s"}`);
    if (typeof d.offices === "string" && d.offices) parts.push(d.offices);
    return parts.join(" · ");
  }
  if (typeof d.office === "string" && q.office === null) parts.push(d.office);
  if (item.unit) parts.push(item.unit);
  if (q.kind !== "votes" && typeof d.votes === "number") parts.push(`${formatCount(d.votes)} votos`);
  if (q.kind !== "share" && typeof d.share === "number") parts.push(`${formatPercent(d.share)} dos válidos`);
  if (typeof d.outcome === "string") parts.push(d.outcome);
  return parts.join(" · ");
}

function Row({ item, q }: Readonly<{ item: RankingItem; q: RankingQuery }>) {
  const href = item.politicianId ? politicianPath({ id: item.politicianId, slug: item.slug }) : null;
  const name = item.entityKind === "party" ? item.name : item.name || UNAVAILABLE;
  return (
    <li className="grid grid-cols-[2.5rem_1fr] gap-x-3 px-4 py-3 sm:grid-cols-[3rem_1fr_auto] sm:items-center" data-position={item.position}>
      <span className="row-span-2 text-right font-mono text-sm tabular-nums text-fg-muted sm:row-span-1">{item.position}º</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-fg">
          {href ? (
            <Link href={href} className="focus-ring rounded hover:text-accent-text">
              {name}
            </Link>
          ) : (
            name
          )}
          {item.party && item.entityKind !== "party" && <span className="ml-2 text-xs font-normal text-fg-muted">{item.party}</span>}
        </p>
        <p className="truncate text-xs text-fg-muted">{detailLine(item, q)}</p>
      </div>
      <p className="mt-1 text-sm font-semibold tabular-nums text-fg sm:mt-0 sm:text-right">{item.valueText}</p>
    </li>
  );
}
