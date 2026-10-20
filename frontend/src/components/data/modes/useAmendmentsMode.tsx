"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PlanGateNote, useEntitlement } from "@/components/account/PlanGate";
import { getAmendmentMap, getAmendmentMapSeries, getParliamentAmendments, type AmendmentMunicipality } from "@/lib/parliament";
import { MAP_SERIES } from "@/lib/plans";
import { amendmentYears } from "@/lib/territory/coverage";
import { formatInteger, formatValue } from "@/lib/territory/format";
import { valueLayer } from "@/lib/territory/layers";
import { classedScale } from "@/lib/territory/scale";
import type { AmendmentMetric, ExplorerView } from "@/lib/territory/url";
import { TransitionLink } from "@/motion/navigation";
import { AmendmentsTimeline } from "../AmendmentsTimeline";
import { Insights } from "../Insights";
import type { ModeContext, ModeView, ReadingModel } from "../explorer-types";
import { SELECT, emptyChoice, knownState, municipalityRows, municipios, ofPlace, pendingReading, ranksOf } from "./shared";

interface Metric {
  label: string;
  unit: string;
  value: (row: AmendmentMunicipality) => number | null;
  missing: (row: AmendmentMunicipality) => number;
}

/** Valor só entra na cor quando é total completo; soma parcial (emenda sem valor publicado) fica sem cor e é dita. */
const METRICS: Record<AmendmentMetric, Metric> = {
  empenhado: { label: "Valor empenhado", unit: "R$", value: (r) => r.committedAmount, missing: (r) => r.committedAmountMissing },
  pago: { label: "Valor pago", unit: "R$", value: (r) => r.paidAmount, missing: (r) => r.paidAmountMissing },
  quantidade: { label: "Quantidade de emendas", unit: "emendas", value: (r) => r.amendmentCount, missing: () => 0 },
};

const PROVIDER_LABEL: Record<string, string> = { transparencia: "Portal da Transparência (CGU)" };
const SORT_KEY: Record<AmendmentMetric, string> = { empenhado: "committed", pago: "paid", quantidade: "count" };

const complete = (metric: Metric) => (r: AmendmentMunicipality) => metric.value(r) != null && metric.missing(r) === 0;

/**
 * Modo emendas: destino das emendas parlamentares por município e ano (edição vigente). Só emendas com código IBGE
 * oficial do município entram no mapa; nada é inferido de texto.
 */
export function useAmendmentsMode(ctx: ModeContext): ModeView {
  const { state, coverage, coverageStatus, enabled, theme, level, municipalities, update } = ctx;
  const queryClient = useQueryClient();
  const uf = state.uf;
  const years = amendmentYears(coverage);
  const year = state.year && years.includes(state.year) ? state.year : (years[0] ?? null);
  const metric = METRICS[state.metric];
  const atState = enabled && level !== "country" && !!uf && year !== null;

  const mapQ = useQuery({
    queryKey: ["amendment-map", uf, year],
    queryFn: () => getAmendmentMap(year, uf!),
    enabled: atState,
    staleTime: 5 * 60_000,
  });
  const provenanceQ = useQuery({
    queryKey: ["amendment-provenance", uf, year],
    queryFn: () => getParliamentAmendments({ uf: uf!, year, limit: 1 }),
    enabled: atState,
    staleTime: 10 * 60_000,
  });

  // série anual (plano): pedida ao reproduzir a linha do tempo ou ao abrir um município; semeia o cache de cada ano
  const series = useEntitlement(MAP_SERIES);
  const [seriesWanted, setSeriesWanted] = useState(false);
  const seriesQ = useQuery({
    queryKey: ["amendment-series", uf],
    queryFn: () => getAmendmentMapSeries(uf!),
    enabled: enabled && !!uf && series.allowed === true && (seriesWanted || level === "municipality"),
    staleTime: 10 * 60_000,
  });
  useEffect(() => {
    if (!seriesQ.data || !uf) return;
    for (const entry of seriesQ.data.years) queryClient.setQueryData(["amendment-map", uf, entry.year], entry.municipalities);
  }, [queryClient, seriesQ.data, uf]);

  const ascending = [...years].sort((a, b) => a - b);
  // "antes" é sempre um ano anterior ao escolhido; sem pedido, o mais próximo
  const earlier = year === null ? [] : years.filter((y) => y < year).sort((a, b) => b - a);
  const asked = state.before && /^\d{4}$/.test(state.before) ? Number(state.before) : null;
  const beforeYear = asked !== null && earlier.includes(asked) ? asked : (earlier[0] ?? null);
  const comparing = state.view === "comparar" && beforeYear !== null;
  const beforeQ = useQuery({
    queryKey: ["amendment-map", uf, beforeYear],
    queryFn: () => getAmendmentMap(beforeYear, uf!),
    enabled: atState && comparing,
    staleTime: 5 * 60_000,
  });

  const rows = mapQ.data;
  const beforeRows = beforeQ.data;
  const { layer, beforeLayer } = useMemo(() => {
    if (!rows || year === null) return { layer: null, beforeLayer: null };
    const isComplete = complete(metric);
    const current = rows.filter(isComplete).map((r) => ({ code: r.municipalityIbgeCode, value: metric.value(r)! }));
    const previous = comparing && beforeRows ? beforeRows.filter(isComplete).map((r) => ({ code: r.municipalityIbgeCode, value: metric.value(r)! })) : [];
    // antes/depois do mesmo indicador: escala comum, para as duas metades serem comparáveis
    const scale = comparing ? classedScale([...current, ...previous].map((r) => r.value), theme) : null;
    const build = (data: typeof current, source: AmendmentMunicipality[], y: number) => {
      const built = valueLayer({
        key: `emendas:${uf}:${y}:${state.metric}:${theme}:${comparing ? "comum" : "ano"}`,
        level: "state",
        rows: data,
        unit: metric.unit,
        title: `${metric.label} · ${comparing ? `${beforeYear} e ${year}` : y}`,
        caption: `${metric.label} · ${y}`,
        theme,
        extensive: true,
        scale,
      });
      for (const r of source) {
        if (isComplete(r)) continue;
        const partial = metric.value(r);
        built.texts[r.municipalityIbgeCode] =
          partial == null
            ? `${formatInteger(r.amendmentCount)} emendas sem valor publicado`
            : `soma parcial: ${formatValue(partial, metric.unit)} (${formatInteger(metric.missing(r))} sem valor publicado)`;
      }
      if (built.legend?.kind === "classes") built.legend.note = "Cada cor reúne uma parte igual dos municípios. Sem cor: sem emenda identificada ou soma parcial.";
      return built;
    };
    return {
      layer: build(current, rows, year),
      beforeLayer: comparing && beforeRows && beforeYear !== null ? build(previous, beforeRows, beforeYear) : null,
    };
  }, [beforeRows, beforeYear, comparing, metric, rows, state.metric, theme, uf, year]);

  const place = ofPlace(coverage, uf);
  const selected = state.municipality;
  const chosen = selected ? rows?.find((r) => r.municipalityIbgeCode === selected) : undefined;
  const observed = (rows ?? []).filter(complete(metric)).map((r) => ({ code: r.municipalityIbgeCode, name: r.municipalityName, value: metric.value(r)! }));
  const ranks = ranksOf(observed);
  const totals = summarize(rows ?? []);
  const partialRows = (rows ?? []).filter((r) => !complete(metric)(r)).length;
  const provenance = provenanceQ.data?.[0];
  const source = provenance
    ? { provider: PROVIDER_LABEL[provenance.provider] ?? provenance.provider, dataset: provenance.dataset, retrievedAt: provenance.retrievedAt }
    : null;

  const controls =
    level === "country" ? null : (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-body-sm text-fg-muted">
            <span>Ano</span>
            <select className={SELECT} value={year ?? ""} onChange={(e) => update({ year: Number(e.target.value) })} disabled={years.length === 0}>
              {years.length === 0 && <option value="">{emptyChoice(coverageStatus, "Sem emendas carregadas")}</option>}
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-body-sm text-fg-muted">
            <span>Medida</span>
            <select className={SELECT} value={state.metric} onChange={(e) => update({ metric: e.target.value as AmendmentMetric })}>
              {(Object.keys(METRICS) as AmendmentMetric[]).map((key) => (
                <option key={key} value={key}>{METRICS[key].label}</option>
              ))}
            </select>
          </label>
          {state.view === "comparar" && earlier.length > 0 && (
            <label className="space-y-1 text-body-sm text-fg-muted sm:col-span-2">
              <span>Comparar com o ano</span>
              <select className={SELECT} value={beforeYear ?? ""} onChange={(e) => update({ before: e.target.value })}>
                {earlier.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {year !== null && (
          <AmendmentsTimeline
            years={ascending}
            year={year}
            onYear={(y) => update({ year: y })}
            onPrepare={() => setSeriesWanted(true)}
            ready={!!seriesQ.data}
            failed={seriesQ.isError && !seriesQ.data}
            onRetry={() => void seriesQ.refetch()}
          />
        )}
      </div>
    );

  const reading: ReadingModel = (() => {
    if (coverageStatus !== "ready") return pendingReading(coverageStatus);
    if (year === null) return { what: `Nenhuma emenda com município identificado foi carregada para os municípios ${place}.`, facts: [], notice: "A malha municipal (IBGE) continua disponível para navegar." };
    const what = `${metric.label} das emendas parlamentares com destino nos municípios ${place}, ${year}. Só entram emendas com o código IBGE oficial do município.`;
    if (level === "municipality" && selected) {
      const value = chosen ? metric.value(chosen) : null;
      const rank = ranks.get(selected);
      return {
        what,
        value: chosen && value != null && complete(metric)(chosen) ? { label: metric.label, text: formatValue(value, metric.unit), swapKey: `${selected}:${year}:${state.metric}` } : null,
        notice: municipalityNotice(chosen, metric, year),
        facts: chosen
          ? [
              { label: "Emendas", text: formatInteger(chosen.amendmentCount) },
              ...(rank ? [{ label: "Posição na UF", text: `${rank}º de ${formatInteger(observed.length)} com valor completo` }] : []),
            ]
          : [],
        source,
      };
    }
    return {
      what,
      facts: [
        { label: "Municípios", text: `${formatInteger(totals.municipalities)} de ${formatInteger(coverage?.municipalities ?? totals.municipalities)} com emenda identificada` },
        { label: "Emendas", text: formatInteger(totals.amendments) },
        ...(state.metric === "quantidade" ? [] : [{ label: "Soma dos valores completos", text: completeSumText(sumComplete(rows ?? [], metric), partialRows) }]),
      ],
      source,
    };
  })();

  const sentences: string[] = [];
  if (year !== null && rows) {
    if (level === "municipality" && selected) {
      const name = municipalities.find((m) => m.ibgeCode === selected)?.name ?? chosen?.municipalityName ?? selected;
      sentences.push(
        chosen
          ? `${name}: ${formatInteger(chosen.amendmentCount)} ${chosen.amendmentCount === 1 ? "emenda identificada" : "emendas identificadas"} em ${year}.`
          : `${name}: nenhuma emenda identificada por código IBGE em ${year}.`,
      );
    } else if (rows.length) {
      const destination = totals.municipalities === 1 ? "foi destino" : "foram destino";
      const amendments = totals.amendments === 1 ? "emenda identificada" : "emendas identificadas";
      sentences.push(`Em ${year}, ${municipios(totals.municipalities, formatInteger)} ${place} ${destination} de ${formatInteger(totals.amendments)} ${amendments} por código IBGE.`);
      const top = [...observed].sort((a, b) => b.value - a.value)[0];
      if (top && state.metric !== "quantidade") sentences.push(`${top.name} teve o maior ${metric.label.toLowerCase()} completo do ano: ${formatValue(top.value, metric.unit)}.`);
      if (partialRows === 1) sentences.push("1 município tem emenda sem valor publicado: aparece sem cor e com a soma parcial no detalhe.");
      else if (partialRows > 1) sentences.push(`${formatInteger(partialRows)} municípios têm emenda sem valor publicado: aparecem sem cor e com a soma parcial no detalhe.`);
    }
  }

  const evolution = level === "municipality" && selected && (
    <section aria-labelledby="evolution-title" className="rounded-xl border border-line bg-surface p-4" data-testid="amendments-evolution">
      <h2 id="evolution-title" className="font-semibold text-fg">Evolução ano a ano</h2>
      {series.allowed === false && <PlanGateNote capability={MAP_SERIES} className="mt-3" />}
      {series.allowed && seriesQ.data && (
        <table className="mt-2 w-full text-body-sm">
          <thead className="text-micro text-fg-muted">
            <tr>
              <th scope="col" className="py-1 text-left font-medium">Ano</th>
              <th scope="col" className="py-1 text-right font-medium">Emendas</th>
              <th scope="col" className="py-1 text-right font-medium">Empenhado</th>
              <th scope="col" className="py-1 text-right font-medium">Pago</th>
            </tr>
          </thead>
          <tbody>
            {seriesQ.data.years.map((entry) => {
              const row = entry.municipalities.find((m) => m.municipalityIbgeCode === selected);
              return (
                <tr key={entry.year} className={`border-t border-line ${entry.year === year ? "font-semibold" : ""}`}>
                  <td className="py-1">{entry.year}</td>
                  <td className="py-1 text-right tabular-nums">{row ? formatInteger(row.amendmentCount) : "—"}</td>
                  <td className="py-1 text-right tabular-nums">{row ? moneyText(row.committedAmount, row.committedAmountMissing) : "—"}</td>
                  <td className="py-1 text-right tabular-nums">{row ? moneyText(row.paidAmount, row.paidAmountMissing) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );

  const views: ExplorerView[] = ["mapa", "relevo", "intensidade", "comparar"];
  return {
    controls,
    layer: atState ? layer : null,
    compare: comparing && beforeLayer && beforeYear !== null ? { before: { layer: beforeLayer, label: `Antes: ${beforeYear}` }, afterLabel: `Depois: ${year}` } : null,
    compareNote: coverageStatus === "ready" ? amendmentsCompareNote(years.length, earlier.length, year) : undefined,
    compareError:
      comparing && beforeQ.isError && !beforeRows ? { message: `Não foi possível carregar as emendas de ${beforeYear}.`, retry: () => void beforeQ.refetch() } : null,
    views,
    reading,
    table:
      atState && rows
        ? {
            caption: `Emendas · ${year} · municípios ${place}`,
            columns: [
              { key: "count", label: "Emendas", numeric: true },
              { key: "committed", label: "Empenhado", numeric: true },
              { key: "paid", label: "Pago", numeric: true },
            ],
            rows: municipalityRows(
              municipalities,
              rows.map((r) => ({ code: r.municipalityIbgeCode, name: r.municipalityName, row: r })),
              ({ row }) => ({
                cells: {
                  count: formatInteger(row.amendmentCount),
                  committed: moneyText(row.committedAmount, row.committedAmountMissing),
                  paid: moneyText(row.paidAmount, row.paidAmountMissing),
                },
                sort: { count: row.amendmentCount, committed: row.committedAmount, paid: row.paidAmount },
              }),
              "count",
              "nenhuma identificada",
            ),
            missingLabel: "sem emenda identificada por código IBGE",
            initialSort: { key: SORT_KEY[state.metric], dir: "desc" },
            status: knownState(mapQ),
          }
        : null,
    analysis: !atState ? null : (
      <>
        <Insights sentences={sentences} contextKey={`${uf}:${selected}:${year}:${state.metric}`} />
        {evolution}
        <p className="text-body-sm">
          <TransitionLink href={`/parlamento?uf=${uf}&ano=${year}`} className="focus-ring mi-underline rounded font-medium text-accent-text">
            Ver emendas, autores e valores em Parlamento →
          </TransitionLink>
        </p>
      </>
    ),
    loading: atState && mapQ.isPending,
    error: mapQ.isError && !rows ? "Não foi possível carregar o mapa de emendas." : null,
    retry: () => void mapQ.refetch(),
  };
}

function amendmentsCompareNote(loaded: number, earlier: number, year: number | null): string | undefined {
  if (loaded < 2) return "Só há um ano de emendas carregado nesta UF; a comparação precisa de dois.";
  if (earlier === 0 && year !== null) return `Não há ano anterior a ${year} carregado nesta UF. Escolha um ano mais recente para comparar.`;
  return undefined;
}

/** Soma só dos municípios com valor completo; os de soma parcial ficam fora e a frase diz quantos. */
function completeSumText(sum: number, partialRows: number): string {
  const text = formatValue(sum, "R$");
  return partialRows > 0 ? `${text} (fora ${municipios(partialRows, formatInteger)} com soma parcial)` : text;
}

function municipalityNotice(chosen: AmendmentMunicipality | undefined, metric: Metric, year: number): string | null {
  if (!chosen) return `Nenhuma emenda identificada para este município em ${year}.`;
  return complete(metric)(chosen) ? null : "Soma parcial: há emenda sem valor publicado; o total não é exibido como completo.";
}

function summarize(rows: AmendmentMunicipality[]) {
  return { municipalities: rows.length, amendments: rows.reduce((sum, r) => sum + r.amendmentCount, 0) };
}

function sumComplete(rows: AmendmentMunicipality[], metric: Metric): number {
  return rows.filter(complete(metric)).reduce((sum, r) => sum + (metric.value(r) ?? 0), 0);
}

/** Valor monetário: completo, soma parcial (com aviso) ou sem valor publicado. */
function moneyText(value: number | null, missing: number): string {
  if (value == null) return "sem valor publicado";
  const text = formatValue(value, "R$");
  return missing > 0 ? `${text} (parcial)` : text;
}
