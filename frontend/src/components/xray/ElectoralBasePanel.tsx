"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ApiError, apiErrorMessage } from "@/lib/api";
import {
  BASE_CLASSES,
  BASE_CLASS_LABEL,
  DEFAULT_UF,
  baseApi,
  baseClassColor,
  HIGHLIGHT_LABEL,
  points,
  scoreText,
  type ElectoralBaseHighlights,
  type ElectoralBaseResponse,
  type TerritoryBase,
} from "@/lib/elections/base";
import { displayName, formatCount, formatPercent } from "@/lib/elections/format";
import { buildElectionsPath } from "@/lib/elections/route";
import { CELL_STATE_LABEL, LEVEL_LABEL, LEVEL_PLURAL } from "@/lib/elections/xray";
import type { TerritoryLevel, XrayCandidacy } from "@/lib/elections/xray-types";
import { UF_NAMES, UFS } from "@/lib/site";
import { useResolvedTheme } from "@/components/theme/theme";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { InsightList } from "./InsightList";
import { Stat } from "./CandidacyPanels";

const LEVELS: TerritoryLevel[] = ["municipality", "zone", "section", "place"];
const HIGHLIGHT_ORDER: Array<keyof ElectoralBaseHighlights> = [
  "strongest", "competitive", "critical", "growth", "decline", "gainedPosition", "lostPosition", "highestShare", "highestVolume", "weakest",
];

function label(t: TerritoryBase, level: TerritoryLevel): string {
  const v = t.territory;
  if (level === "zone") return `${v.municipalityName ?? v.municipalityTseCode} · zona ${v.zone}`;
  if (level === "section") {
    const extra = v.sectionMembers && v.sectionMembers.length > 1 ? ` (+${v.sectionMembers.length - 1} agregada)` : "";
    return `Zona ${v.zone} · seção ${v.section}${extra}`;
  }
  if (level === "place") return `${v.placeName ? displayName(v.placeName) : `Local ${v.placeCode}`} · zona ${v.zone}`;
  return v.municipalityName ?? v.municipalityTseCode ?? v.uf;
}

type SortKey = "score" | "votes" | "share" | "rank";

/** Base Eleitoral de uma candidatura: forte, fraca, competitiva; crescimento e queda; classificação com decomposição. */
export function ElectoralBasePanel({ c }: Readonly<{ c: XrayCandidacy }>) {
  const theme = useResolvedTheme();
  const municipal = c.contest.unit.scope === "municipal";
  // disputa nacional (Presidente) não tem UF própria: a base é vista estado a estado
  const national = !c.contest.unit.uf;
  const [uf, setUf] = useState<string>(c.contest.unit.uf ?? DEFAULT_UF);
  const [level, setLevel] = useState<TerritoryLevel>(municipal ? "section" : "municipality");
  const [municipality, setMunicipality] = useState<{ code: string; uf: string | null } | null>(
    municipal ? { code: c.contest.unit.code, uf: c.contest.unit.uf } : null,
  );
  const [sort, setSort] = useState<SortKey>("score");
  const [open, setOpen] = useState<string | null>(null);
  const needsMunicipality = level === "section" || level === "place";
  const q = useQuery({
    queryKey: ["electoral-base", c.candidacyId, level, municipality?.code, uf],
    queryFn: () => baseApi.base(c.candidacyId, level, { uf: municipality?.uf ?? uf, municipality: municipality?.code }),
    enabled: !needsMunicipality || !!municipality,
    staleTime: 5 * 60_000,
    retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 1,
  });

  const header = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <fieldset className="flex flex-wrap gap-1">
        <legend className="sr-only">Nível territorial</legend>
        {LEVELS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={level === l}
            onClick={() => setLevel(l)}
            className={`focus-ring min-h-9 rounded-lg border px-3 py-1 text-xs ${level === l ? "border-accent bg-accent/15 text-accent-text" : "border-line text-fg-muted hover:border-line-strong"}`}
          >
            {LEVEL_LABEL[l]}
          </button>
        ))}
      </fieldset>
      {national && (
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <span>Estado</span>
          <select
            value={uf}
            onChange={(e) => {
              setUf(e.target.value);
              setMunicipality(null);
              setLevel("municipality");
            }}
            className="focus-ring min-h-9 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg"
          >
            {UFS.map((u) => (
              <option key={u} value={u}>
                {UF_NAMES[u]}
              </option>
            ))}
          </select>
        </label>
      )}
      {municipality && !municipal && (
        <button type="button" onClick={() => { setMunicipality(null); setLevel("municipality"); }} className="focus-ring rounded text-xs text-accent-text hover:underline">
          Todos os municípios
        </button>
      )}
    </div>
  );

  if (needsMunicipality && !municipality)
    return (
      <div data-testid="electoral-base">
        {header}
        <DataState kind="empty" title="Escolha um município">
          Seções e locais de votação são vistos dentro de um município: abra a Base por município e escolha um.
        </DataState>
      </div>
    );
  if (q.isPending) return <div data-testid="electoral-base">{header}<DataState kind="loading" title="Calculando a base eleitoral" height="h-48" /></div>;
  if (q.isError) {
    const e = q.error;
    const body =
      e instanceof ApiError && e.status === 400 ? (
        <DataState kind="not_comparable" title="Base eleitoral não se aplica">{apiMessage(e)}</DataState>
      ) : e instanceof ApiError && e.status === 503 ? (
        <DataState kind="unavailable" title="Dados arquivados indisponíveis no momento" action={<RetryButton onRetry={() => q.refetch()} />}>
          A votação detalhada desta eleição está no arquivo eleitoral, que não respondeu agora. Não é ausência de votos.
        </DataState>
      ) : (
        <DataState kind="error" title="Não foi possível calcular a base eleitoral." action={<RetryButton onRetry={() => q.refetch()} />}>
          Falha de comunicação não é ausência de dados.
        </DataState>
      );
    return <div data-testid="electoral-base">{header}{body}</div>;
  }

  const data = q.data;
  return (
    <div data-testid="electoral-base" className="space-y-4">
      {header}
      <Summary data={data} level={level} theme={theme} />
      <InsightList insights={data.insights} />
      {data.freshness.stale && <p className="text-micro text-warn">{data.freshness.note}</p>}
      {data.comparedWith && (
        <p className="text-xs text-fg-muted" data-testid="base-compared-with">
          Comparada com {data.comparedWith.year}
          {data.comparedWith.round === 2 ? " (2º turno)" : ""}: {data.comparedWith.note}
        </p>
      )}
      <Highlights data={data} level={level} onPick={(key) => setOpen(key)} />
      <TerritoryTable
        data={data}
        level={level}
        sort={sort}
        onSort={setSort}
        open={open}
        onToggle={(key) => setOpen((o) => (o === key ? null : key))}
        onDrill={
          level === "municipality" && !municipal
            ? (t) => {
                if (!t.territory.municipalityTseCode) return;
                setMunicipality({ code: t.territory.municipalityTseCode, uf: t.territory.uf });
                setLevel("zone");
              }
            : undefined
        }
        theme={theme}
      />
      <FormulaBox data={data} />
      {uf && (
        <Link
          href={`${buildElectionsPath({ year: c.contest.year, round: c.contest.round, state: uf.toLowerCase() })}?camada=base&candidatura=${c.candidacyId}`}
          className="focus-ring inline-block rounded text-xs text-accent-text hover:underline"
        >
          Ver a base no mapa do explorador →
        </Link>
      )}
    </div>
  );
}

function apiMessage(e: ApiError): string {
  return apiErrorMessage(e) ?? "Este recorte não pode ser classificado.";
}

function Summary({ data, level, theme }: Readonly<{ data: ElectoralBaseResponse; level: TerritoryLevel; theme: "light" | "dark" }>) {
  const s = data.summary;
  const classified = BASE_CLASSES.reduce((n, k) => n + (s.classCounts[k] ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Votos no recorte" value={formatCount(s.votes)} />
        <Stat label="Capilaridade" value={s.capillarity === null ? "—" : `${formatPercent(s.capillarity)} (${s.territoriesWithVotes}/${s.territories})`} />
        <Stat label={`Mais votada em`} value={`${formatCount(s.leading)} ${LEVEL_PLURAL[level].toLowerCase()}`} />
        <Stat label="Concentração (HHI)" value={s.hhi === null ? "—" : s.hhi.toLocaleString("pt-BR")} />
      </div>
      {classified > 0 && (
        <figure aria-label="Distribuição das classes" className="space-y-1.5">
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded" aria-hidden="true">
            {BASE_CLASSES.filter((k) => (s.classCounts[k] ?? 0) > 0).map((k) => (
              <span key={k} style={{ width: `${((s.classCounts[k] ?? 0) / classified) * 100}%`, background: baseClassColor(k, theme) }} />
            ))}
          </div>
          <figcaption>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
              {BASE_CLASSES.map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: baseClassColor(k, theme) }} aria-hidden="true" />
                  {BASE_CLASS_LABEL[k]}: <span className="tabular text-fg-soft">{s.classCounts[k] ?? 0}</span>
                </li>
              ))}
            </ul>
          </figcaption>
        </figure>
      )}
    </div>
  );
}

function Highlights({ data, level, onPick }: Readonly<{ data: ElectoralBaseResponse; level: TerritoryLevel; onPick: (key: string) => void }>) {
  const byKey = useMemo(() => new Map(data.territories.map((t) => [t.key, t])), [data]);
  const groups = HIGHLIGHT_ORDER.filter((g) => data.highlights[g].length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="base-highlights">
      {groups.map((g) => (
        <section key={g} className="rounded-lg border border-line bg-surface p-3" aria-label={HIGHLIGHT_LABEL[g]}>
          <h4 className="mb-1.5 text-label uppercase text-fg-muted">{HIGHLIGHT_LABEL[g]}</h4>
          <ol className="space-y-1 text-xs">
            {data.highlights[g].map((key) => {
              const t = byKey.get(key);
              if (!t) return null;
              return (
                <li key={key} className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => onPick(key)} className="focus-ring truncate rounded text-left text-fg-soft hover:text-accent-text">
                    {label(t, level)}
                  </button>
                  <span className="tabular flex-shrink-0 text-fg-muted">{highlightValue(g, t)}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function highlightValue(g: keyof ElectoralBaseHighlights, t: TerritoryBase): string {
  switch (g) {
    case "competitive":
      return points(t.marginPoints);
    case "growth":
    case "decline":
      return t.change?.deltaVotes === null || t.change?.deltaVotes === undefined ? "—" : `${t.change.deltaVotes > 0 ? "+" : "−"}${formatCount(Math.abs(t.change.deltaVotes))}`;
    case "gainedPosition":
    case "lostPosition":
      return t.change?.fromRank && t.rank ? `${t.change.fromRank}º → ${t.rank}º` : "—";
    case "highestShare":
      return formatPercent(t.territory.share);
    case "highestVolume":
      return `${formatCount(t.territory.votes)} votos`;
    default:
      return t.class ? BASE_CLASS_LABEL[t.class] : "—";
  }
}

function TerritoryTable({
  data,
  level,
  sort,
  onSort,
  open,
  onToggle,
  onDrill,
  theme,
}: Readonly<{
  data: ElectoralBaseResponse;
  level: TerritoryLevel;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  open: string | null;
  onToggle: (key: string) => void;
  onDrill?: (t: TerritoryBase) => void;
  theme: "light" | "dark";
}>) {
  const rows = useMemo(() => {
    const value = (t: TerritoryBase) =>
      sort === "votes" ? t.territory.votes ?? -1 : sort === "share" ? t.territory.share ?? -1 : sort === "rank" ? -(t.rank ?? 1e9) : t.score ?? -1;
    return [...data.territories].sort((a, b) => value(b) - value(a) || label(a, level).localeCompare(label(b, level), "pt-BR"));
  }, [data, sort, level]);
  const sorts: Array<[SortKey, string]> = [["score", "Classificação"], ["votes", "Votos"], ["share", "%"], ["rank", "Posição"]];
  return (
    <section aria-label={`${LEVEL_PLURAL[level]} da base eleitoral`}>
      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-fg-muted">
        <span>Ordenar por</span>
        {sorts.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={sort === k} onClick={() => onSort(k)}
            className={`focus-ring min-h-8 rounded border px-2 ${sort === k ? "border-accent bg-accent/15 text-accent-text" : "border-line"}`}>
            {l}
          </button>
        ))}
      </div>
      <ol className="max-h-[520px] space-y-1 overflow-y-auto pr-1" data-testid="base-territories">
        {rows.map((t) => {
          const expanded = open === t.key;
          return (
            <li key={t.key} className="rounded-lg border border-line bg-surface" data-class={t.class ?? "none"} data-state={t.territory.state}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {t.class ? (
                    <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: baseClassColor(t.class, theme) }} aria-hidden="true" />
                  ) : (
                    <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-sm border border-dashed border-line-strong" aria-hidden="true" />
                  )}
                  {onDrill && t.territory.municipalityTseCode ? (
                    <button type="button" onClick={() => onDrill(t)} className="focus-ring truncate rounded text-left text-fg-soft hover:text-accent-text" title="Ver zonas, seções e locais">
                      {label(t, level)}
                    </button>
                  ) : (
                    <span className="truncate text-fg-soft">{label(t, level)}</span>
                  )}
                </span>
                <span className="tabular text-fg-muted">
                  {t.territory.votes === null ? CELL_STATE_LABEL[t.territory.state] : `${formatCount(t.territory.votes)} · ${formatPercent(t.territory.share)}`}
                </span>
                {t.rank !== null && <span className="tabular text-fg-muted">{t.rank}º de {t.contestants}</span>}
                <span className="font-medium text-fg-soft">{t.class ? BASE_CLASS_LABEL[t.class] : "Não classificado"}</span>
                {t.score !== null && (
                  <button type="button" aria-expanded={expanded} aria-controls={`base-${t.key}`} onClick={() => onToggle(t.key)}
                    className="focus-ring min-h-8 rounded border border-line px-2 text-fg-muted hover:border-line-strong">
                    {expanded ? "Ocultar cálculo" : "Por quê?"}
                  </button>
                )}
              </div>
              {expanded && <Decomposition id={`base-${t.key}`} t={t} data={data} />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Decomposition({ id, t, data }: Readonly<{ id: string; t: TerritoryBase; data: ElectoralBaseResponse }>) {
  const labels = new Map(data.formula.components.map((c) => [c.key, c.label]));
  return (
    <div id={id} className="border-t border-line px-3 py-2 text-xs" data-testid="base-decomposition">
      <table className="w-full">
        <caption className="sr-only">Decomposição da classificação</caption>
        <thead>
          <tr className="text-left text-fg-muted">
            <th scope="col" className="py-1 font-medium">Componente</th>
            <th scope="col" className="py-1 text-right font-medium">Valor</th>
            <th scope="col" className="py-1 text-right font-medium">Peso</th>
            <th scope="col" className="py-1 text-right font-medium">Contribuição</th>
          </tr>
        </thead>
        <tbody>
          {t.components.map((c) => (
            <tr key={c.key} className="border-t border-line/60">
              <th scope="row" className="py-1 text-left font-normal text-fg-soft">{labels.get(c.key) ?? c.key}</th>
              <td className="py-1 text-right">{scoreText(c.value)}</td>
              <td className="py-1 text-right">{scoreText(c.weight)}</td>
              <td className="py-1 text-right">{scoreText(c.contribution)}</td>
            </tr>
          ))}
          <tr className="border-t border-line-strong font-medium text-fg">
            <th scope="row" className="py-1 text-left">Pontuação</th>
            <td colSpan={3} className="py-1 text-right">{scoreText(t.score)} → {t.class ? BASE_CLASS_LABEL[t.class] : "—"}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-fg-muted">
        Margem: {points(t.marginPoints)}
        {t.change && (
          <>
            {" · "}Em {t.change.fromYear}:{" "}
            {t.change.deltaVotes === null
              ? `sem variação (${t.change.comparability === "section_composition_changed" ? "seção recomposta" : "território sem comparação"})`
              : `${t.change.deltaVotes > 0 ? "+" : "−"}${formatCount(Math.abs(t.change.deltaVotes))} votos (${points(t.change.deltaSharePoints)})`}
          </>
        )}
      </p>
    </div>
  );
}

function FormulaBox({ data }: Readonly<{ data: ElectoralBaseResponse }>) {
  const f = data.formula;
  return (
    <details className="rounded-lg border border-line bg-surface p-3 text-xs" data-testid="base-formula">
      <summary className="focus-ring cursor-pointer rounded font-medium text-fg-soft">Como a classificação é calculada ({f.version})</summary>
      <ul className="mt-2 space-y-1 text-fg-muted">
        {f.components.map((c) => (
          <li key={c.key}>
            <span className="text-fg-soft">{c.label}</span> — peso {scoreText(c.weight)}: {c.definition}.
          </li>
        ))}
      </ul>
      <p className="mt-2 text-fg-muted">
        Classes: {f.classes.map((c) => `${c.label} ≥ ${scoreText(c.minScore)}`).join(" · ")}.
      </p>
      <p className="mt-2 text-fg-muted">{f.note}</p>
      <dl className="mt-2 space-y-1 text-fg-muted">
        {Object.entries(data.definitions).map(([k, v]) => (
          <div key={k}>
            <dt className="inline text-fg-soft">{k}: </dt>
            <dd className="inline">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
