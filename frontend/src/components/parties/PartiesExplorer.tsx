"use client";

import { useId, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatCount, formatPercent, UNAVAILABLE } from "@/lib/elections/format";
import { points } from "@/lib/elections/base";
import { defaultPick, partiesApi, partyPath, resultFor, type PartiesResponse, type PartyResult, type PartySummary } from "@/lib/parties";
import { DataState, RetryButton } from "@/components/ui/DataState";

const field = "w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-fg focus-ring";
const labelCls = "mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted";

type SortKey = "votes" | "elected" | "candidacies";

const int = (raw: string | null) => (raw && /^\d{1,5}$/.test(raw) ? Number(raw) : null);

/** Partidos de uma UF numa eleição × cargo: votos (nominais + legenda), participação, candidaturas, eleitos, variação. */
export function PartiesExplorer() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = useId();
  const uf = (search.get("uf") ?? "CE").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || "CE";
  const q = useQuery({ queryKey: ["parties", uf], queryFn: () => partiesApi.list(uf), staleTime: 5 * 60_000 });

  const fallback = q.data ? defaultPick(q.data) : null;
  const year = int(search.get("ano")) ?? fallback?.year ?? null;
  const round = int(search.get("turno")) ?? fallback?.round ?? null;
  const election = q.data?.elections.find((e) => e.year === year && e.round === round);
  const office = int(search.get("cargo")) ?? (election ? (election.offices.find((o) => o.covered) ?? election.offices[0])?.code : null) ?? null;
  const sort: SortKey = (["votes", "elected", "candidacies"] as const).find((s) => s === search.get("ordem")) ?? "votes";

  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    router.replace(`${pathname}?${p}`, { scroll: false });
  };

  const rows = useMemo(() => {
    if (!q.data || year === null || round === null || office === null) return [];
    const list = q.data.parties
      .map((p) => ({ party: p, result: resultFor(p, year, round, office) }))
      .filter((x): x is { party: PartySummary; result: PartyResult } => Boolean(x.result));
    const value = (r: PartyResult) => (sort === "elected" ? r.elected : sort === "candidacies" ? r.candidacies : r.votes ?? -1);
    return list.sort((a, b) => value(b.result) - value(a.result) || a.party.acronym.localeCompare(b.party.acronym, "pt-BR"));
  }, [q.data, year, round, office, sort]);

  return (
    <main className="min-h-screen bg-canvas px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Inteligência eleitoral</p>
        <h1 className="text-2xl font-bold text-fg">Partidos</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Força dos partidos em cada eleição e cargo, com os votos do Boletim de Urna (nominais nos números do partido e, nos cargos
          proporcionais, votos de legenda) e as candidaturas oficiais do TSE. Partido sem o dado fica sem número — nunca zero.
        </p>

        {q.isError ? (
          <div className="mt-6">
            <DataState kind="error" title="Não foi possível carregar os partidos." action={<RetryButton onRetry={() => q.refetch()} />} />
          </div>
        ) : !q.data ? (
          <div className="mt-6 space-y-2" aria-busy="true">
            <DataState kind="loading" height="h-16" title="Carregando partidos" />
            <DataState kind="loading" height="h-72" title="Carregando partidos" />
          </div>
        ) : q.data.elections.length === 0 ? (
          <div className="mt-6">
            <DataState kind="empty" title="Nenhuma candidatura importada neste estado." />
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-3">
              <div>
                <label htmlFor={`${id}-election`} className={labelCls}>
                  Eleição
                </label>
                <select
                  id={`${id}-election`}
                  className={field}
                  value={`${year}-${round}`}
                  onChange={(e) => {
                    const [y, r] = e.target.value.split("-");
                    set({ ano: y, turno: r, cargo: null });
                  }}
                >
                  {q.data.elections.map((e) => (
                    <option key={`${e.year}-${e.round}`} value={`${e.year}-${e.round}`}>
                      {e.year} · {e.round}º turno
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-office`} className={labelCls}>
                  Cargo
                </label>
                <select id={`${id}-office`} className={field} value={office ?? ""} onChange={(e) => set({ cargo: e.target.value })}>
                  {(election?.offices ?? []).map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name}
                      {o.covered ? "" : " (sem Boletim de Urna)"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-sort`} className={labelCls}>
                  Ordenar por
                </label>
                <select id={`${id}-sort`} className={field} value={sort} onChange={(e) => set({ ordem: e.target.value === "votes" ? null : e.target.value })}>
                  <option value="votes">Votos</option>
                  <option value="elected">Eleitos</option>
                  <option value="candidacies">Candidaturas</option>
                </select>
              </div>
            </div>
            <PartyList rows={rows} data={q.data} year={year} round={round} office={office} />
          </>
        )}
      </div>
    </main>
  );
}

function PartyList({
  rows,
  data,
  year,
  round,
  office,
}: Readonly<{
  rows: Array<{ party: PartySummary; result: PartyResult }>;
  data: PartiesResponse;
  year: number | null;
  round: number | null;
  office: number | null;
}>) {
  if (rows.length === 0) return <div className="mt-4"><DataState kind="empty" title="Nenhum partido com candidatura ou voto neste cargo." /></div>;
  const noBu = rows.every((r) => r.result.votes === null);
  const query = year !== null && round !== null && office !== null ? `?ano=${year}&turno=${round}&cargo=${office}&uf=${data.uf}` : "";
  return (
    <section className="mt-4 space-y-3" aria-label="Partidos">
      {noBu && (
        <DataState kind="no_coverage" title="Sem Boletim de Urna deste cargo">
          Os partidos aparecem pelas candidaturas oficiais; votos e participação ficam em branco até a importação do Boletim de Urna.
        </DataState>
      )}
      <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" data-testid="party-list">
        {rows.map(({ party, result }) => (
          <li key={party.slug} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_6rem] sm:items-center" data-party={party.slug}>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">
                <Link href={`${partyPath(party.slug)}${query}`} className="focus-ring rounded hover:text-accent-text">
                  {party.acronym}
                </Link>
                <span className="ml-2 text-xs font-normal text-fg-muted">{result.partyNumber}</span>
              </p>
              <p className="truncate text-xs text-fg-muted">
                {party.name ?? UNAVAILABLE}
                {result.federations ? ` · Federação ${result.federations}` : ""}
              </p>
            </div>
            <p className="text-right text-sm font-semibold tabular-nums text-fg sm:text-right">
              {result.votes === null ? UNAVAILABLE : formatCount(result.votes)}
              <span className="block text-xs font-normal text-fg-muted">{result.share === null ? "sem BU" : `${formatPercent(result.share)} dos válidos`}</span>
            </p>
            <p className="text-xs text-fg-muted sm:text-right">
              {result.elected} eleito{result.elected === 1 ? "" : "s"} · {result.candidacies} candidatura{result.candidacies === 1 ? "" : "s"}
            </p>
            <p className="text-xs tabular-nums text-fg-muted sm:text-right" title={result.change?.note}>
              {changeText(result)}
            </p>
          </li>
        ))}
      </ol>
      <details className="rounded-lg border border-line bg-surface/60 px-4 py-3 text-xs text-fg-muted">
        <summary className="cursor-pointer font-medium text-fg-soft">Metodologia e definições</summary>
        <p className="mt-2 leading-relaxed">{data.methodology}</p>
        <dl className="mt-2 space-y-1">
          {Object.entries(data.definitions).map(([k, v]) => (
            <div key={k}>
              <dt className="inline text-fg-soft">{k}: </dt>
              <dd className="inline">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2">{data.freshness.note}</p>
      </details>
    </section>
  );
}

/** "+1,2 p.p. desde 2022" / "sem comparação" — variação só quando comparável. */
export function changeText(r: PartyResult): string {
  const c = r.change;
  if (!c) return "primeira eleição importada";
  if (c.comparability === "absent") return `não disputou em ${c.fromYear}`;
  if (c.deltaSharePoints === null) return `sem comparação com ${c.fromYear}`;
  return `${points(c.deltaSharePoints)} desde ${c.fromYear}`;
}
