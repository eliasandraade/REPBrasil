"use client";

import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, apiErrorMessage } from "@/lib/api";
import { formatCount, formatPercent, UNAVAILABLE } from "@/lib/elections/format";
import { buildElectionsPath } from "@/lib/elections/route";
import { politicianPath } from "@/lib/paths";
import { partiesApi, type PartyDetail, type PartyProfileResponse, type PartyResult, type PartyTerritory } from "@/lib/parties";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { changeText } from "./PartiesExplorer";

const int = (raw: string | null) => (raw && /^\d{1,5}$/.test(raw) ? Number(raw) : null);

/** Perfil de um partido numa UF: identidade oficial, resultados por eleição × cargo, municípios e candidaturas. */
export function PartyProfile({ slug }: Readonly<{ slug: string }>) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const uf = (search.get("uf") ?? "CE").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || "CE";
  const pick = { year: int(search.get("ano")), round: int(search.get("turno")), office: int(search.get("cargo")) };
  const q = useQuery({
    queryKey: ["party", slug, uf, pick.year, pick.round, pick.office],
    queryFn: () => partiesApi.profile(slug, uf, pick),
    staleTime: 5 * 60_000,
    retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
  });
  const choose = (r: PartyResult) => {
    const p = new URLSearchParams(search.toString());
    p.set("ano", String(r.year));
    p.set("turno", String(r.round));
    p.set("cargo", String(r.officeCode));
    router.replace(`${pathname}?${p}`, { scroll: false });
  };

  return (
    <main className="min-h-screen bg-canvas px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          <Link href="/partidos" className="focus-ring rounded hover:text-accent-text">
            Partidos
          </Link>
        </p>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="space-y-3" aria-busy="true">
            <DataState kind="loading" height="h-12" title="Carregando partido" />
            <DataState kind="loading" height="h-64" title="Carregando partido" />
          </div>
        ) : (
          <Profile data={q.data} onChoose={choose} />
        )}
      </div>
    </main>
  );
}

function ErrorState({ error, onRetry }: Readonly<{ error: unknown; onRetry: () => void }>) {
  if (error instanceof ApiError && error.status === 404)
    return <DataState kind="empty" title="Partido não encontrado neste estado.">{apiErrorMessage(error) ?? "Sem candidaturas importadas com essa sigla."}</DataState>;
  if (error instanceof ApiError && error.status === 400)
    return <DataState kind="not_comparable" title="Recorte indisponível">{apiErrorMessage(error) ?? "O partido não disputou essa eleição e cargo."}</DataState>;
  return <DataState kind="error" title="Não foi possível carregar o partido." action={<RetryButton onRetry={onRetry} />} />;
}

function Profile({ data, onChoose }: Readonly<{ data: PartyProfileResponse; onChoose: (r: PartyResult) => void }>) {
  const numbers = [...new Set(data.identity.map((i) => i.number))];
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-fg">
          {data.acronym}
          <span className="ml-2 text-base font-medium text-fg-muted">{numbers.join(" / ")}</span>
        </h1>
        <p className="mt-1 text-sm text-fg-muted">{data.name ?? UNAVAILABLE} · resultados em {data.uf}</p>
        {data.notes.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-fg-muted">
            {data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </header>

      <Results data={data} onChoose={onChoose} />
      {data.detail ? <Detail detail={data.detail} uf={data.uf} acronym={data.acronym} /> : (
        <DataState kind="empty" title="Sem eleição com resultado para detalhar." />
      )}
      <Identity data={data} />

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
    </div>
  );
}

function Results({ data, onChoose }: Readonly<{ data: PartyProfileResponse; onChoose: (r: PartyResult) => void }>) {
  const selected = data.detail;
  return (
    <section aria-labelledby="party-results">
      <h2 id="party-results" className="mb-2 text-sm font-semibold text-fg">
        Resultados por eleição e cargo
      </h2>
      <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" data-testid="party-results">
        {data.results.map((r) => {
          const active = selected?.year === r.year && selected.round === r.round && selected.officeCode === r.officeCode;
          return (
            <li key={`${r.year}-${r.round}-${r.officeCode}`} className={active ? "bg-accent/5" : undefined}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onChoose(r)}
                className="focus-ring grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 text-left sm:grid-cols-[minmax(0,1fr)_8rem_8rem_9rem] sm:items-center"
              >
                <span className="min-w-0 text-sm text-fg">
                  <span className="font-semibold">{r.officeName}</span> · {r.year}
                  {r.round === 2 ? " (2º turno)" : ""}
                  {r.federations && <span className="block truncate text-xs text-fg-muted">Federação {r.federations}</span>}
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-fg">
                  {r.votes === null ? UNAVAILABLE : formatCount(r.votes)}
                  <span className="block text-xs font-normal text-fg-muted">{r.share === null ? "sem BU" : `${formatPercent(r.share)} dos válidos`}</span>
                </span>
                <span className="text-xs text-fg-muted sm:text-right">
                  {r.elected} eleito{r.elected === 1 ? "" : "s"} de {r.candidacies}
                </span>
                <span className="text-xs tabular-nums text-fg-muted sm:text-right" title={r.change?.note}>
                  {changeText(r)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Detail({ detail, uf, acronym }: Readonly<{ detail: PartyDetail; uf: string; acronym: string }>) {
  const mapHref = `${buildElectionsPath({ year: detail.year, round: detail.round, state: uf.toLowerCase() })}?camada=party&cargo=${detail.officeCode}&partido=${detail.partyNumbers[0]}`;
  return (
    <section aria-labelledby="party-detail" className="space-y-4" data-testid="party-detail">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="party-detail" className="text-sm font-semibold text-fg">
          {acronym} · {detail.officeName} · {detail.year}
          {detail.round === 2 ? " (2º turno)" : ""}
        </h2>
        <Link href={mapHref} className="focus-ring rounded text-xs text-accent-text hover:underline">
          Ver no mapa →
        </Link>
      </div>
      {detail.coverage && !detail.coverage.complete && (
        <DataState kind={detail.coverage.zonesCovered === 0 ? "no_coverage" : "partial"} title="Cobertura do Boletim de Urna">
          {detail.coverage.note}
        </DataState>
      )}
      <p className="text-xs text-fg-muted">
        {detail.note} Votos em {formatCount(detail.territoriesWithVotes)} de {formatCount(detail.territoriesConsidered)} municípios considerados.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TerritoryList title="Maior participação" items={detail.strongest} testId="party-strongest" />
        <TerritoryList title="Menor participação" items={detail.weakest} testId="party-weakest" />
      </div>
      <section aria-labelledby="party-candidates">
        <h3 id="party-candidates" className="mb-2 text-label uppercase text-fg-muted">
          Candidaturas com mais votos (cada uma na própria disputa)
        </h3>
        {detail.candidates.length === 0 ? (
          <DataState kind="empty" title="Nenhuma candidatura do partido neste cargo." />
        ) : (
          <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface text-sm" data-testid="party-candidates">
            {detail.candidates.map((c) => {
              const href = c.politicianId ? politicianPath({ id: c.politicianId, slug: c.slug }) : null;
              return (
                <li key={c.candidacyId} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2">
                  <span className="min-w-0">
                    {href ? (
                      <Link href={href} className="focus-ring rounded font-medium text-fg hover:text-accent-text">
                        {c.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-fg">{c.name}</span>
                    )}
                    <span className="ml-2 text-xs text-fg-muted">
                      {c.number}
                      {c.unit ? ` · ${c.unit}` : ""}
                      {c.outcome ? ` · ${c.outcome}` : ""}
                    </span>
                  </span>
                  <span className="tabular-nums text-fg-soft">{c.votes === null ? "sem vínculo com o BU" : `${formatCount(c.votes)} votos`}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </section>
  );
}

function TerritoryList({ title, items, testId }: Readonly<{ title: string; items: PartyTerritory[]; testId: string }>) {
  return (
    <section className="rounded-lg border border-line bg-surface p-3" aria-label={title} data-testid={testId}>
      <h3 className="mb-1.5 text-label uppercase text-fg-muted">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-fg-muted">—</p>
      ) : (
        <ol className="space-y-1 text-xs">
          {items.map((t) => (
            <li key={`${t.municipalityTseCode}-${t.zone ?? ""}`} className="flex items-center justify-between gap-2">
              <span className="truncate text-fg-soft">{t.name}</span>
              <span className="tabular flex-shrink-0 text-fg-muted">
                {formatPercent(t.share)} · {formatCount(t.votes)} votos
                {t.elected ? ` · ${t.elected} eleito${t.elected === 1 ? "" : "s"}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Identity({ data }: Readonly<{ data: PartyProfileResponse }>) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-sm font-semibold text-fg">
        Registro oficial por eleição
      </h2>
      <ul className="space-y-1 text-xs text-fg-muted">
        {data.identity.map((i) => (
          <li key={`${i.year}-${i.round}-${i.number}-${i.acronym}`}>
            {i.year}
            {i.round === 2 ? " (2º turno)" : ""}: {i.acronym} · número {i.number}
            {i.name ? ` · ${i.name}` : ""}
            {i.federations ? ` · Federação ${i.federations}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
