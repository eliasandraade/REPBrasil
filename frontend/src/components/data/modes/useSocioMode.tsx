"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import {
  downloadIndicatorCsv,
  downloadStateCsv,
  getClusters,
  getCorrelation,
  getIndicatorValues,
  getIndicators,
  type ClusterResponse,
  type CorrelationResponse,
  type Indicator,
} from "@/lib/data-intelligence";
import { EXPORT_BULK, EXPORT_CSV } from "@/lib/plans";
import { loadedIndicators } from "@/lib/territory/coverage";
import { formatCoefficient, formatInteger, formatValue } from "@/lib/territory/format";
import { associationSentence, distribution, extremeGroups, rankOf, type Observation } from "@/lib/territory/insights";
import { valueLayer } from "@/lib/territory/layers";
import { isExtensive } from "@/lib/territory/scale";
import type { ExplorerView } from "@/lib/territory/url";
import { ExportAction } from "../ExportActions";
import { CausalityNote, Insights } from "../Insights";
import { MatrixSection } from "../MatrixSection";
import { Scatter } from "../Scatter";
import type { ModeContext, ModeView, ReadingModel } from "../explorer-types";
import { SELECT, emptyChoice, knownState, municipalityRows, ofPlace, pendingReading, ranksOf, relationTo } from "./shared";

/**
 * Modo socioeconômico: um indicador oficial por município, na UF escolhida. Só aparecem como escolha os indicadores
 * com valor carregado na UF (os outros ficam visíveis e desabilitados, "sem dados nesta UF").
 */
export function useSocioMode(ctx: ModeContext): ModeView {
  const { state, coverage, coverageStatus, enabled, theme, level, municipalities, update, hovered, onHover } = ctx;
  const uf = state.uf;
  const atState = enabled && level !== "country" && !!uf;
  const catalogQ = useQuery({ queryKey: ["data-indicators"], queryFn: getIndicators, staleTime: 10 * 60_000, enabled });
  // o que está carregado só é conhecido com a cobertura e o catálogo em mãos
  const known = coverageStatus === "ready" ? knownState(catalogQ) : coverageStatus;
  const loaded = useMemo(() => loadedIndicators(coverage), [coverage]);
  const catalog = catalogQ.data ?? [];
  const available = catalog.filter((i) => loaded.has(i.code));
  const x = available.find((i) => i.code === state.x) ?? available[0] ?? null;
  const periods = x ? (loaded.get(x.code) ?? []) : [];
  const period = state.period && periods.includes(state.period) ? state.period : (periods[0] ?? null);
  const partners = available.filter((i) => i.code !== x?.code && period !== null && (loaded.get(i.code) ?? []).includes(period));
  const y = partners.find((i) => i.code === state.y) ?? partners[0] ?? null;
  const ready = atState && !!x && period !== null;

  const valuesQ = useQuery({
    queryKey: ["data-values", x?.code, period, uf],
    queryFn: () => getIndicatorValues(x!.code, period!, uf!),
    enabled: ready,
    staleTime: 5 * 60_000,
  });
  const comparing = state.view === "comparar";
  const yValuesQ = useQuery({
    queryKey: ["data-values", y?.code, period, uf],
    queryFn: () => getIndicatorValues(y!.code, period!, uf!),
    enabled: ready && comparing && !!y,
    staleTime: 5 * 60_000,
  });
  const correlationQ = useQuery({
    queryKey: ["data-correlation", x?.code, y?.code, period, uf],
    queryFn: () => getCorrelation(x!.code, y!.code, period!, uf!),
    enabled: ready && !!y,
    staleTime: 5 * 60_000,
  });
  const clustersQ = useQuery({
    queryKey: ["data-clusters", x?.code, period, uf],
    queryFn: () => getClusters(x!.code, period!, 3, uf!),
    enabled: ready,
    staleTime: 5 * 60_000,
  });

  const values = valuesQ.data;
  const observations = useMemo<Observation[]>(
    () => (values ?? []).map((r) => ({ code: r.municipalityIbgeCode, name: r.municipalityName, value: Number(r.value) })),
    [values],
  );
  const layer = useMemo(() => {
    if (!x || period === null || observations.length === 0) return null;
    return valueLayer({
      key: `socio:${uf}:${x.code}:${period}:${theme}`,
      level: "state",
      rows: observations,
      unit: x.unit,
      title: `${x.name} (${x.unit})`,
      caption: `${x.name} · ${period}`,
      theme,
      extensive: isExtensive(x.unit),
    });
  }, [observations, period, theme, uf, x]);
  const yObservations = useMemo(
    () => (yValuesQ.data ?? []).map((r) => ({ code: r.municipalityIbgeCode, value: Number(r.value) })),
    [yValuesQ.data],
  );
  const beforeLayer = useMemo(() => {
    if (!y || period === null || yObservations.length === 0) return null;
    return valueLayer({
      key: `socio:${uf}:${y.code}:${period}:${theme}`,
      level: "state",
      rows: yObservations,
      unit: y.unit,
      title: `${y.name} (${y.unit})`,
      caption: `${y.name} · ${period}`,
      theme,
      extensive: isExtensive(y.unit),
    });
  }, [period, theme, uf, y, yObservations]);

  const dist = distribution(observations);
  const selected = state.municipality;
  const selectedValue = selected ? observations.find((o) => o.code === selected) : undefined;
  const rank = selected ? rankOf(observations, selected) : null;
  const fmt = (value: number) => (x ? formatValue(value, x.unit) : String(value));
  const source = values?.[0];
  const name = (code: string) => municipalities.find((m) => m.ibgeCode === code)?.name ?? observations.find((o) => o.code === code)?.name ?? code;

  const views: ExplorerView[] = ["mapa", "relevo", ...(x && isExtensive(x.unit) ? (["intensidade"] as const) : []), "comparar"];

  const controls = level === "country" ? null : (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <label className="space-y-1 text-body-sm text-fg-muted">
        <span>Indicador</span>
        <select className={SELECT} value={x?.code ?? ""} onChange={(e) => update({ x: e.target.value, period: null, y: null })} disabled={available.length === 0}>
          {available.length === 0 && <option value="">{emptyChoice(known, "Sem indicadores carregados")}</option>}
          {catalog.map((i) => (
            <option key={i.code} value={i.code} disabled={!loaded.has(i.code)}>
              {i.name}
              {loaded.has(i.code) || known !== "ready" ? "" : " — sem dados nesta UF"}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-body-sm text-fg-muted">
        <span>Período</span>
        <select className={SELECT} value={period ?? ""} onChange={(e) => update({ period: Number(e.target.value) })} disabled={periods.length < 2}>
          {periods.length === 0 && <option value="">—</option>}
          {periods.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>
    </div>
  );

  const reading: ReadingModel = (() => {
    if (known !== "ready") return pendingReading(known);
    if (!x || period === null)
      return { what: `Nenhum indicador socioeconômico carregado para os municípios ${ofPlace(coverage, uf)} até agora.`, facts: [], notice: "A malha municipal (IBGE) continua disponível para navegar." };
    const what = `${x.name} em ${period}, por município. ${x.description}`.trim();
    if (level === "municipality" && selected) {
      return {
        what,
        value: selectedValue ? { label: x.name, text: fmt(selectedValue.value), swapKey: `${selected}:${x.code}:${period}` } : null,
        notice: selectedValue ? null : `Sem dado de ${x.name} para ${name(selected)} em ${period}. Ausência não vira zero.`,
        facts: [
          ...(rank ? [{ label: "Posição na UF", text: `${rank.rank}º de ${formatInteger(rank.n)} (do maior para o menor)` }] : []),
          ...(dist ? [{ label: "Mediana da UF", text: fmt(dist.median) }] : []),
        ],
        source: source ? { provider: source.provider, dataset: source.dataset, retrievedAt: source.retrievedAt } : null,
      };
    }
    const total = coverage?.municipalities ?? 0;
    return {
      what,
      facts: dist
        ? [
            { label: "Com dado", text: total ? `${formatInteger(dist.n)} de ${formatInteger(total)} municípios` : `${formatInteger(dist.n)} municípios` },
            { label: "Mediana", text: fmt(dist.median) },
            { label: "Maior", text: `${dist.max.name} · ${fmt(dist.max.value)}` },
            { label: "Menor", text: `${dist.min.name} · ${fmt(dist.min.value)}` },
          ]
        : [],
      source: source ? { provider: source.provider, dataset: source.dataset, retrievedAt: source.retrievedAt } : null,
    };
  })();

  const sentences: string[] = [];
  if (x && period !== null && dist) {
    const place = ofPlace(coverage, uf);
    if (level === "municipality" && selected && selectedValue && rank) {
      const relation = relationTo(selectedValue.value, dist.median);
      sentences.push(`${name(selected)}: ${fmt(selectedValue.value)}, ${rank.rank}º de ${formatInteger(rank.n)} municípios ${place} (do maior para o menor).`);
      sentences.push(relation === "igual" ? `Igual à mediana estadual (${fmt(dist.median)}).` : `Fica ${relation} da mediana estadual, que é ${fmt(dist.median)}.`);
    } else {
      sentences.push(`Em ${period}, nos municípios ${place}, ${x.name} vai de ${fmt(dist.min.value)} (${dist.min.name}) a ${fmt(dist.max.value)} (${dist.max.name}).`);
      sentences.push(`Metade dos municípios fica abaixo de ${fmt(dist.median)} e metade acima.`);
    }
    const missing = (coverage?.municipalities ?? 0) - dist.n;
    if (missing === 1) sentences.push(`1 município ${place} não tem este dado em ${period} e fica sem cor no mapa.`);
    else if (missing > 1) sentences.push(`${formatInteger(missing)} municípios ${place} não têm este dado em ${period} e ficam sem cor no mapa.`);
  }

  const analysis = !ready ? null : (
    <>
      <Insights sentences={sentences} contextKey={`${uf}:${selected}:${x?.code}:${period}`} />
      <CorrelationPanel
        x={x!}
        y={y}
        partners={partners}
        period={period!}
        correlation={correlationQ.data}
        loading={correlationQ.isPending && !!y}
        failed={correlationQ.isError && !correlationQ.data}
        retry={() => void correlationQ.refetch()}
        onPick={(code) => update({ y: code })}
        selected={selected}
        hovered={hovered}
        onHover={onHover}
      />
      <ClustersPanel x={x!} clusters={clustersQ.data} />
      <MatrixSection uf={uf!} period={period!} theme={theme} />
    </>
  );

  const ranks = ranksOf(observations);
  const rows = municipalityRows(
    municipalities,
    observations,
    (o) => ({ cells: { value: fmt(o.value), rank: `${ranks.get(o.code)}º` }, sort: { value: o.value, rank: -(ranks.get(o.code) ?? 0) } }),
    "value",
  );

  return {
    controls,
    layer: ready ? layer : null,
    compare: beforeLayer && y ? { before: { layer: beforeLayer, label: y.name }, afterLabel: x?.name ?? "" } : null,
    compareNote: y || known !== "ready" ? undefined : "A comparação precisa de um segundo indicador com dado no mesmo período.",
    compareError:
      comparing && y && yValuesQ.isError && !yValuesQ.data ? { message: `Não foi possível carregar ${y.name}.`, retry: () => void yValuesQ.refetch() } : null,
    // os dois lados são do mesmo período: é comparação lado a lado, não antes e depois
    viewLabels: { comparar: "Lado a lado" },
    views,
    reading,
    table: ready
      ? {
          caption: `${x!.name} · ${period} · municípios ${ofPlace(coverage, uf)}`,
          columns: [
            { key: "value", label: x!.name, numeric: true },
            { key: "rank", label: "Posição", numeric: true },
          ],
          rows,
          initialSort: { key: "value", dir: "desc" },
          status: knownState(valuesQ),
          actions: (
            <>
              <ExportAction capability={EXPORT_CSV} label="Baixar CSV do recorte" run={() => downloadIndicatorCsv(x!.code, uf!, period)} />
              <ExportAction capability={EXPORT_BULK} label="CSV com todos os indicadores" run={() => downloadStateCsv(uf!, null)} />
            </>
          ),
        }
      : null,
    analysis,
    loading: (catalogQ.isPending && enabled) || (ready && valuesQ.isPending),
    error: socioError(valuesQ.isError && !values, catalogQ.isError && !catalogQ.data),
    retry: () => {
      void catalogQ.refetch();
      void valuesQ.refetch();
    },
  };
}

function socioError(valuesFailed: boolean, catalogFailed: boolean): string | null {
  if (valuesFailed) return "Não foi possível carregar os valores do indicador.";
  if (catalogFailed) return "Não foi possível carregar o catálogo de indicadores.";
  return null;
}

function CorrelationPanel({
  x,
  y,
  partners,
  period,
  correlation,
  loading,
  failed,
  retry,
  onPick,
  selected,
  hovered,
  onHover,
}: Readonly<{
  x: Indicator;
  y: Indicator | null;
  partners: Indicator[];
  period: number;
  correlation: CorrelationResponse | undefined;
  loading: boolean;
  failed: boolean;
  retry: () => void;
  onPick: (code: string) => void;
  selected: string | null;
  hovered: string | null;
  onHover: (code: string | null) => void;
}>) {
  const groups = correlation ? extremeGroups(correlation.points) : null;
  const fx = (v: number) => formatValue(v, x.unit);
  const fy = (v: number) => (y ? formatValue(v, y.unit) : String(v));
  return (
    <section aria-labelledby="xy-title" className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="correlation-section">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="xy-title" className="font-semibold text-fg">Comparar dois indicadores</h2>
          <p className="text-body-sm text-fg-muted">{x.name} × outro indicador do mesmo período ({period}), município a município.</p>
        </div>
        {partners.length > 0 && (
          <label className="min-w-[16rem] space-y-1 text-body-sm text-fg-muted">
            <span>Comparar com</span>
            <select className={SELECT} value={y?.code ?? ""} onChange={(e) => onPick(e.target.value)}>
              {partners.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!y && <p className="text-body-sm text-fg-muted">Só há um indicador com dado neste período; a comparação precisa de dois.</p>}
      {y && loading && <DataState kind="loading" title="Calculando a comparação" height="h-32" />}
      {y && failed && <DataState kind="error" title="Não foi possível calcular a comparação" action={<RetryButton onRetry={retry} />} />}
      {y && correlation && (
        <>
          <p className="text-body leading-7 text-fg" data-testid="association-sentence">{associationSentence(x.name, y.name, correlation.spearman, correlation.n)}</p>
          {groups && (
            <p className="text-body-sm leading-6 text-fg-soft">
              Entre os {formatInteger(groups.low.n)} municípios com menor {x.name} ({fx(groups.low.xFrom)} a {fx(groups.low.xTo)}), a média de {y.name} fica em {fy(groups.low.meanY)};
              entre os {formatInteger(groups.high.n)} com maior {x.name} ({fx(groups.high.xFrom)} a {fx(groups.high.xTo)}), em {fy(groups.high.meanY)}.
            </p>
          )}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-micro text-fg-muted" data-testid="correlation-summary">
            <div><dt className="inline">Spearman </dt><dd className="inline font-semibold text-fg">{formatCoefficient(correlation.spearman)}</dd></div>
            <div><dt className="inline">Pearson </dt><dd className="inline font-semibold text-fg">{formatCoefficient(correlation.pearson)}</dd></div>
            <div><dt className="inline">Municípios (N) </dt><dd className="inline font-semibold text-fg">{formatInteger(correlation.n)}</dd></div>
          </dl>
          <Scatter
            points={correlation.points.map((p) => ({ code: p.municipalityIbgeCode, name: p.municipalityName, x: p.x, y: p.y }))}
            xLabel={`${x.name} (${x.unit})`}
            yLabel={`${y.name} (${y.unit})`}
            formatX={fx}
            formatY={fy}
            selected={selected}
            hovered={hovered}
            onHover={onHover}
            summary={`Dispersão de ${correlation.n} municípios: ${x.name} no eixo horizontal e ${y.name} no vertical.`}
          />
          <CausalityNote />
          <p className="text-micro leading-5 text-fg-muted">{correlation.methodology}</p>
        </>
      )}
    </section>
  );
}

function ClustersPanel({ x, clusters }: Readonly<{ x: Indicator; clusters: ClusterResponse | undefined }>) {
  if (!clusters || clusters.items.length === 0) return null;
  const counts = clusters.centroids.map((_, index) => clusters.items.filter((i) => i.cluster === index).length);
  const labels = ["menores valores", "valores intermediários", "maiores valores"];
  return (
    <section aria-labelledby="clusters-title" className="rounded-xl border border-line bg-surface p-4" data-testid="clusters">
      <h2 id="clusters-title" className="font-semibold text-fg">Grupos de municípios parecidos</h2>
      <p className="mt-1 text-body-sm text-fg-muted">Três grupos pelo valor de {x.name}: cada município entra no grupo cujo centro está mais perto.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {clusters.centroids.map((centroid, index) => (
          <li key={`${index}:${centroid}`} className="rounded-lg border border-line px-3 py-2">
            <p className="text-micro uppercase text-fg-muted">Grupo {index + 1} · {labels[index] ?? ""}</p>
            <p className="mt-0.5 text-body-sm text-fg">Centro em {formatValue(centroid, x.unit)}</p>
            <p className="text-micro text-fg-muted">{formatInteger(counts[index])} {counts[index] === 1 ? "município" : "municípios"}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-micro text-fg-muted">{clusters.methodology}</p>
    </section>
  );
}
