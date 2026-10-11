"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { ApiError } from "@/lib/api";
import { displayName, formatCount, formatPercent } from "@/lib/elections/format";
import {
  CELL_STATE_LABEL,
  comparabilityLabel,
  CONTEST_COMPARABILITY_LABEL,
  electionLabel,
  LEVEL_LABEL,
  levelCount,
  MAX_COMPARE,
  parseSelection,
  serializeSelection,
  signed,
  signedPercent,
  TERRITORY_COMPARABILITY_LABEL,
  xrayApi,
} from "@/lib/elections/xray";
import type { CompareTerritory, ComparisonResponse, TerritoryLevel } from "@/lib/elections/xray-types";
import { InsightList } from "@/components/xray/InsightList";
import { compareTerritoryLabel } from "@/lib/elections/compare-csv";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { Term } from "@/components/ui/Term";
import { AddCandidacy, CompareActions } from "./CompareTools";
import { useResolvedTheme } from "@/components/theme/theme";
import { CATEGORICAL, type DataTheme } from "@/lib/dataviz/palette";

const LEVELS: TerritoryLevel[] = ["state", "municipality", "zone", "section", "place"];
/** Cor da candidatura comparada = slot categórico pela ORDEM na comparação (≤ 5, pares adjacentes validados). */
const subjectColor = (subject: number, theme: DataTheme) => CATEGORICAL[theme][subject % CATEGORICAL[theme].length];

const territoryLabel = compareTerritoryLabel;

/** As definições vêm da API com chave técnica; aqui, o nome em português. */
const DEFINITION_LABEL: Record<string, string> = {
  subject: "Pessoa",
  comparable: "Território comparável",
  section_composition_changed: "Composição da seção mudou",
  coverage_or_section_missing: "Sem cobertura",
  overtake: "Superação",
  leader: "Mais votada no território",
};
const definitionLabel = (key: string) => DEFINITION_LABEL[key] ?? key.replaceAll("_", " ");

/** Comparação vazia: o que é, como montar aqui mesmo e por onde mais dá para chegar. */
function EmptyComparison({ onAdd }: Readonly<{ onAdd: (candidacyId: string, uf: string | null) => void }>) {
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2" data-testid="compare-empty">
      <div className="rounded-xl border border-line bg-surface p-5 text-sm text-fg-muted">
        <p className="font-medium text-fg-soft">Escolha até {MAX_COMPARE} candidaturas</p>
        <p className="mt-2">
          Da mesma eleição (quem teve mais votos em cada lugar) ou de eleições diferentes (como a votação de alguém mudou). Município, zona,
          seção e local de votação, lado a lado.
        </p>
        <p className="mt-2">
          Também dá para marcar &ldquo;comparar&rdquo; na lista de candidaturas do{" "}
          <Link href="/eleicoes" className="text-accent-text hover:underline">
            explorador de eleições
          </Link>{" "}
          ou no histórico eleitoral de um perfil.
        </p>
      </div>
      <AddCandidacy selected={[]} onAdd={onAdd} />
    </div>
  );
}

/**
 * Comparação de até 5 candidaturas (mesma eleição ou eleições diferentes), do estado à seção. Os números, estados,
 * comparabilidades, evolução, líderes, superações e insights vêm da API — nada é inferido no cliente.
 */
export function ComparisonView() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/eleicoes/comparar";
  const rawIds = (search.get("c") ?? "").split(",").filter(Boolean);
  const ids = parseSelection(search.get("c"));
  const uf = (search.get("uf") ?? "CE").toUpperCase();
  const level = (LEVELS.includes(search.get("nivel") as TerritoryLevel) ? search.get("nivel") : "municipality") as TerritoryLevel;
  const municipality = search.get("municipio");
  const zone = Number(search.get("zona")) || null;
  const needsMunicipality = (level === "section" || level === "place") && !municipality;

  const set = useCallback(
    (updates: Record<string, string | null>) => {
      const p = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) p.delete(k);
        else p.set(k, v);
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [pathname, router, search],
  );

  const q = useQuery({
    queryKey: ["compare", ids.join(","), uf, level, municipality, zone],
    queryFn: () => xrayApi.compare(ids, { uf, level, municipality, zone }),
    enabled: ids.length > 0 && !needsMunicipality,
    staleTime: 60_000,
  });
  const data = q.data;

  const columns = useMemo(
    () =>
      data
        ? [...data.candidacies].sort((a, b) => a.subject - b.subject || a.election - b.election)
        : [],
    [data],
  );

  const add = (candidacyId: string, candidacyUf: string | null) =>
    set({
      c: serializeSelection([...ids, candidacyId]),
      ...(search.get("uf") || !candidacyUf ? {} : { uf: candidacyUf }),
    });

  const drill = (t: CompareTerritory) => {
    if (level === "state") set({ nivel: "municipality", municipio: null, zona: null });
    else if (level === "municipality") set({ nivel: "zone", municipio: t.municipalityTseCode, zona: null });
    else if (level === "zone") set({ nivel: "section", municipio: t.municipalityTseCode, zona: t.zone ? String(t.zone) : null });
  };

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 sm:px-6" data-testid="comparison">
      <div className="mx-auto max-w-7xl">
        <nav className="mb-3 text-xs text-fg-muted" aria-label="Navegação">
          <Link href="/eleicoes" className="hover:text-fg-soft">
            Eleições
          </Link>{" "}
          / <span className="text-fg-soft">Comparar candidaturas</span>
        </nav>
        <h1 className="text-2xl font-bold text-fg">Comparar candidaturas</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Até {MAX_COMPARE} candidaturas, da mesma eleição ou de eleições diferentes. Evolução só entre disputas comparáveis (mesmo cargo e mesma
          unidade) e territórios comparáveis (seção com a mesma composição). Ausência de dado nunca vira zero.
        </p>

        {rawIds.length > MAX_COMPARE && (
          <p className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn" role="alert">
            Limite de {MAX_COMPARE} candidaturas: apenas as {MAX_COMPARE} primeiras foram consideradas.
          </p>
        )}

        <fieldset className="mt-4 flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Nível territorial</legend>
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={level === l}
              onClick={() => set({ nivel: l, ...(l === "state" || l === "municipality" ? { municipio: null, zona: null } : {}) })}
              className={`rounded border px-2.5 py-1 text-xs ${level === l ? "border-accent bg-accent/15 text-accent-text" : "border-line text-fg-muted hover:border-line-strong"}`}
            >
              {LEVEL_LABEL[l]}
            </button>
          ))}
          {municipality && (
            <span className="ml-2 text-xs text-fg-muted">
              município TSE {municipality}
              {zone ? ` · zona ${zone}` : ""}{" "}
              <button type="button" onClick={() => set({ nivel: "municipality", municipio: null, zona: null })} className="text-accent-text hover:underline">
                limpar
              </button>
            </span>
          )}
        </fieldset>

        {ids.length === 0 && <EmptyComparison onAdd={add} />}
        {needsMunicipality && (
          <div className="mt-6">
            <DataState kind="empty" title="Escolha um município">
              Seção e local de votação exigem um município: escolha-o no nível Município.
            </DataState>
          </div>
        )}
        {q.isLoading && (
          <div className="mt-6">
            <DataState kind="loading" title="Carregando comparação" height="h-40" />
          </div>
        )}
        {q.isError && (
          <div className="mt-6">
            <DataState
              kind="error"
              title={q.error instanceof ApiError && q.error.status === 400 ? "Pedido inválido para a comparação." : "Não foi possível carregar a comparação."}
              action={<RetryButton onRetry={() => q.refetch()} />}
            />
          </div>
        )}

        {data && (
          <>
            <div className="mt-4">
              <CompareActions data={data} columns={columns} level={level} uf={uf} />
            </div>
            <ComparisonBody
              data={data}
              columns={columns}
              level={level}
              onDrill={drill}
              onRemove={(id) => set({ c: serializeSelection(ids.filter((x) => x !== id)) || null })}
            />
          </>
        )}
        {ids.length > 0 && ids.length < MAX_COMPARE && (
          <div className="mt-4 max-w-xl">
            <AddCandidacy selected={ids} onAdd={add} />
          </div>
        )}
      </div>
    </main>
  );
}

function ComparisonBody({
  data,
  columns,
  level,
  onDrill,
  onRemove,
}: Readonly<{
  data: ComparisonResponse;
  columns: ComparisonResponse["candidacies"];
  level: TerritoryLevel;
  onDrill: (t: CompareTerritory) => void;
  onRemove: (id: string) => void;
}>) {
  const theme = useResolvedTheme();
  const subjectName = (i: number) => data.subjects[i]?.name ?? `Sujeito ${i + 1}`;
  // posição entre as selecionadas da mesma eleição (só quem tem votos apurados)
  const position = new Map<string, number>();
  for (const c of columns) {
    if (c.votes === null) continue;
    const ahead = columns.filter(
      (o) => o.votes !== null && o.contest.year === c.contest.year && o.contest.round === c.contest.round && o.votes > c.votes!,
    ).length;
    position.set(c.candidacyId, ahead + 1);
  }
  const contestsOf = (c: ComparisonResponse["candidacies"][number]) =>
    columns.filter((o) => o.contest.year === c.contest.year && o.contest.round === c.contest.round && o.votes !== null).length;
  const byCandidacy = new Map(data.candidacies.map((c) => [c.candidacyId, c]));
  const canDrill = level === "state" || level === "municipality" || level === "zone";
  return (
    <div className="mt-4 space-y-4">
      {data.freshness.stale && <p className="text-[11px] text-warn/80">{data.freshness.note}</p>}
      <div className="flex flex-wrap gap-2" data-testid="compare-candidacies">
        {columns.map((c) => (
          <div key={c.candidacyId} className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-fg-soft">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: subjectColor(c.subject, theme) }} />
              {displayName(c.ballotName)}
              <button
                type="button"
                aria-label={`Remover ${displayName(c.ballotName)} da comparação`}
                onClick={() => onRemove(c.candidacyId)}
                className="focus-ring ml-1 rounded px-1 text-fg-muted hover:text-fg-soft"
              >
                ×
              </button>
            </p>
            <p className="text-fg-muted">
              {displayName(c.contest.officeName)} · {c.contest.unit.name} · {electionLabel(c.contest.year, c.contest.round)}
              {c.party?.acronym ? ` · ${c.party.acronym}` : ""}
            </p>
            <p className="text-fg-soft">
              {c.votes === null ? CELL_STATE_LABEL[c.state] : `${formatCount(c.votes)} votos`}
              {c.share !== null && <span className="text-fg-muted"> · {formatPercent(c.share)}</span>}
              {position.has(c.candidacyId) && contestsOf(c) > 1 && (
                <span className="text-fg-muted"> · {position.get(c.candidacyId)}º entre as selecionadas</span>
              )}
            </p>
          </div>
        ))}
      </div>

      {data.pairs.some((p) => p.comparability !== "comparable_contest") && (
        <ul className="flex flex-wrap gap-1.5 text-[11px]" data-testid="compare-pairs">
          {data.pairs
            .filter((p) => p.comparability !== "comparable_contest")
            .map((p) => (
              <li key={`${p.first}-${p.second}`} className="rounded border border-line bg-fg/5 px-2 py-0.5 text-fg-muted">
                {displayName(byCandidacy.get(p.first)?.ballotName)} × {displayName(byCandidacy.get(p.second)?.ballotName)}: {CONTEST_COMPARABILITY_LABEL[p.comparability]}
              </li>
            ))}
        </ul>
      )}

      <InsightList insights={data.insights} />

      <div className="overflow-x-auto rounded-xl border border-line bg-surface" data-testid="compare-matrix">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="border-b border-line text-[10px] uppercase tracking-wider text-fg-muted">
            <tr>
              <th className="sticky left-0 z-10 bg-surface px-3 py-2">{LEVEL_LABEL[level]}</th>
              {columns.map((c) => (
                <th key={c.candidacyId} className="px-3 py-2 text-right">
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: subjectColor(c.subject, theme) }} />
                  {displayName(c.ballotName).split(" ")[0]} {electionLabel(c.contest.year, c.contest.round)}
                </th>
              ))}
              {data.subjects.some((s) => s.candidacyIds.length > 1) && <th className="px-3 py-2">Evolução</th>}
              <th className="px-3 py-2">
                <Term id="comparavel">Comparabilidade</Term>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.territories.map((t) => (
              <tr key={t.key} className="border-b border-line align-top" data-comparability={t.comparability}>
                <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-fg-soft">
                  {canDrill ? (
                    <button type="button" onClick={() => onDrill(t)} className="text-left hover:text-accent-text">
                      {territoryLabel(t, level)}
                    </button>
                  ) : (
                    territoryLabel(t, level)
                  )}
                </td>
                {columns.map((c) => {
                  const cell = t.cells.find((x) => x.candidacyId === c.candidacyId);
                  const leader = t.leaders.find((l) => l.election === c.election)?.candidacyId === c.candidacyId;
                  return (
                    <td key={c.candidacyId} className="px-3 py-1.5 text-right" data-state={cell?.state}>
                      {cell?.votes === null || cell === undefined ? (
                        <span className="text-[10px] text-fg-muted">{cell ? CELL_STATE_LABEL[cell.state] : "—"}</span>
                      ) : (
                        <span className={leader ? "font-semibold text-accent-text" : "text-fg-soft"} title={leader ? "Mais votado(a) entre as selecionadas" : undefined}>
                          {formatCount(cell.votes)}
                        </span>
                      )}
                      {cell?.share !== null && cell?.share !== undefined && <span className="block text-[10px] text-fg-muted">{formatPercent(cell.share)}</span>}
                    </td>
                  );
                })}
                {data.subjects.some((s) => s.candidacyIds.length > 1) && (
                  <td className="px-3 py-1.5">
                    {t.evolution.map((e) => (
                      <span key={`${e.fromCandidacyId}-${e.toCandidacyId}`} className="block whitespace-nowrap">
                        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: subjectColor(e.subject, theme) }} />
                        {e.deltaVotes === null ? (
                          <span className="text-[10px] text-fg-muted">{comparabilityLabel(e.comparability)}</span>
                        ) : (
                          <span className={e.deltaVotes >= 0 ? "text-accent-text" : "text-warn"}>
                            {signed(e.deltaVotes)} ({signedPercent(e.deltaPercent)})
                          </span>
                        )}
                      </span>
                    ))}
                  </td>
                )}
                <td className="px-3 py-1.5 text-[10px] text-fg-muted">{TERRITORY_COMPARABILITY_LABEL[t.comparability]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(data.overtakes.length > 0 || data.extremes.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.overtakes.length > 0 && (
            <div className="rounded-lg border border-line bg-surface p-3" data-testid="compare-overtakes">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Superações</p>
              <ul className="space-y-1 text-xs text-fg-soft">
                {data.overtakes.map((o) => (
                  <li key={`${o.subject}-${o.overtakenSubject}-${o.fromElection}-${o.toElection}`}>
                    {subjectName(o.subject)} passou à frente de {subjectName(o.overtakenSubject)} em {levelCount(level, o.territories)} de{" "}
                    {electionLabel(data.elections[o.fromElection].year, data.elections[o.fromElection].round)} para{" "}
                    {electionLabel(data.elections[o.toElection].year, data.elections[o.toElection].round)}.
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.extremes.length > 0 && (
            <div className="rounded-lg border border-line bg-surface p-3" data-testid="compare-extremes">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Maiores variações</p>
              <ul className="space-y-1 text-xs text-fg-soft">
                {data.extremes.map((x) => (
                  <li key={`${x.subject}-${x.kind}-${x.key}-${x.fromCandidacyId}-${x.toCandidacyId}`}>
                    {x.kind === "growth" ? "▲" : "▼"} {subjectName(x.subject)}: {x.label} — {signed(x.deltaVotes)} votos ({signedPercent(x.deltaPercent)})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <details className="rounded-lg border border-line bg-surface p-3 text-xs text-fg-muted">
        <summary className="cursor-pointer text-fg-soft">Como ler esta comparação</summary>
        <dl className="mt-2 space-y-1">
          {Object.entries(data.definitions).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-medium text-fg-soft">{definitionLabel(k)}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
