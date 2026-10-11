"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  getCandidacyCorrelation,
  getIndicators,
  type CorrelationPoint,
  type Indicator,
} from "@/lib/data-intelligence";
import type { XrayCandidacy } from "@/lib/elections/xray-types";
import { DataState, RetryButton } from "@/components/ui/DataState";

const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const coefficient = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

function Scatter({ points, indicator }: Readonly<{ points: CorrelationPoint[]; indicator: Indicator }>) {
  const plotted = useMemo(() => {
    if (points.length === 0) return [];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    return points.map((point) => ({
      ...point,
      cx: 54 + ((point.x - minX) / dx) * 506,
      cy: 244 - ((point.y - minY) / dy) * 198,
    }));
  }, [points]);

  if (plotted.length === 0) {
    return <DataState kind="no_coverage">Sem municípios comparáveis para este recorte.</DataState>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface p-4">
      <svg viewBox="0 0 600 285" className="min-w-[560px]" role="img" aria-label={`${indicator.name} e participação eleitoral por município`}>
        <line x1="54" y1="244" x2="570" y2="244" stroke="currentColor" opacity="0.2" />
        <line x1="54" y1="32" x2="54" y2="244" stroke="currentColor" opacity="0.2" />
        <text x="312" y="276" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.65">{indicator.name}</text>
        <text transform="translate(13 145) rotate(-90)" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.65">Participação nos votos válidos (%)</text>
        {plotted.map((point) => (
          <circle key={point.municipalityIbgeCode} cx={point.cx} cy={point.cy} r="4" fill="currentColor" opacity="0.64">
            <title>{`${point.municipalityName}: ${number.format(point.x)} ${indicator.unit} · ${number.format(point.y)}% dos votos válidos`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function quintiles(points: CorrelationPoint[]) {
  const ordered = [...points].sort((a, b) => a.x - b.x || a.municipalityIbgeCode.localeCompare(b.municipalityIbgeCode));
  if (ordered.length < 5) return [];
  return Array.from({ length: 5 }, (_, index) => {
    const start = Math.floor((index * ordered.length) / 5);
    const end = Math.floor(((index + 1) * ordered.length) / 5);
    const rows = ordered.slice(start, end);
    return {
      index: index + 1,
      n: rows.length,
      indicatorMean: rows.reduce((sum, row) => sum + row.x, 0) / rows.length,
      voteShareMean: rows.reduce((sum, row) => sum + row.y, 0) / rows.length,
    };
  });
}

export function SocioElectoralPanel({ candidacy }: Readonly<{ candidacy: XrayCandidacy }>) {
  const uf = candidacy.contest.unit.uf;
  const year = candidacy.contest.year;
  const [indicatorCode, setIndicatorCode] = useState("derived.illiteracy_rate_15_plus");

  const catalogQ = useQuery({
    queryKey: ["socioelectoral-indicators"],
    queryFn: getIndicators,
    staleTime: 300_000,
  });

  const available = useMemo(
    () => (catalogQ.data ?? []).filter((item) => item.code !== "derived.gdp_per_capita" || year !== 2022),
    [catalogQ.data, year],
  );
  const selected = available.find((item) => item.code === indicatorCode) ?? available[0];

  const correlationQ = useQuery({
    queryKey: ["socioelectoral", candidacy.candidacyId, selected?.code, year, uf],
    queryFn: () => getCandidacyCorrelation({
      xIndicator: selected!.code,
      period: year,
      candidacyId: candidacy.candidacyId,
      year,
      round: candidacy.contest.round,
      office: candidacy.contest.officeCode,
      uf: uf!,
    }),
    enabled: !!selected && !!uf,
    retry: 1,
    staleTime: 120_000,
  });

  if (!uf) {
    return <DataState kind="no_coverage">Este recorte ainda exige uma UF auditável para cruzar municípios.</DataState>;
  }
  if (catalogQ.isPending) return <DataState kind="loading" title="Carregando indicadores" height="h-40" />;
  if (catalogQ.isError) {
    return <DataState kind="error" title="Não foi possível carregar os indicadores." action={<RetryButton onRetry={() => catalogQ.refetch()} />} />;
  }
  if (!selected) return <DataState kind="no_coverage">Nenhum indicador socioeconômico disponível.</DataState>;

  const correlation = correlationQ.data;
  const buckets = correlation ? quintiles(correlation.points) : [];
  const strongest = correlation
    ? [...correlation.points].sort((a, b) => b.y - a.y || a.municipalityName.localeCompare(b.municipalityName)).slice(0, 5)
    : [];

  return (
    <div className="space-y-4" data-testid="socioelectoral-panel">
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent-text">Perfil socioeleitoral municipal</p>
            <h2 className="mt-1 text-lg font-semibold text-fg">Onde esta candidatura teve maior ou menor participação?</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">
              Cruza a participação desta candidatura nos votos válidos de cada município com indicadores oficiais do mesmo período quando disponíveis.
            </p>
          </div>
          <label className="min-w-[260px] space-y-1 text-sm text-fg-muted">
            <span>Indicador</span>
            <select
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg"
              value={selected.code}
              onChange={(event) => setIndicatorCode(event.target.value)}
            >
              {available.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <p className="text-sm font-medium text-fg">Leitura territorial, não individual.</p>
        <p className="mt-1 text-sm leading-6 text-fg-muted">
          Uma associação entre votação e uma característica municipal não permite concluir que pessoas com essa característica votaram nesta candidatura. Isso evita a falácia ecológica. Correlação também não implica causalidade.
        </p>
      </section>

      {correlationQ.isPending && <DataState kind="loading" title="Calculando perfil socioeleitoral" height="h-40" />}
      {correlationQ.isError && (
        <DataState kind="no_coverage" title="Sem cruzamento comparável para esta candidatura.">
          O indicador precisa ter observações municipais no mesmo ano da eleição e a candidatura precisa ter vínculo auditável com os votos da UF.
        </DataState>
      )}

      {correlation && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <article className="rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-fg-muted">Pearson</p>
              <p className="mt-1 text-2xl font-semibold text-fg">{correlation.pearson === null ? "—" : coefficient.format(correlation.pearson)}</p>
            </article>
            <article className="rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-fg-muted">Spearman</p>
              <p className="mt-1 text-2xl font-semibold text-fg">{correlation.spearman === null ? "—" : coefficient.format(correlation.spearman)}</p>
            </article>
            <article className="rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-fg-muted">Municípios observados</p>
              <p className="mt-1 text-2xl font-semibold text-fg">{correlation.n}</p>
            </article>
          </section>

          <Scatter points={correlation.points} indicator={selected} />

          {buckets.length === 5 && (
            <section className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="border-b border-line px-4 py-3">
                <h3 className="font-semibold text-fg">Votação por quintil do indicador</h3>
                <p className="text-xs text-fg-muted">Municípios ordenados pelo indicador e divididos em cinco grupos de tamanho semelhante.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-fg-muted"><tr><th className="px-4 py-2">Quintil</th><th className="px-4 py-2">Média do indicador</th><th className="px-4 py-2">Média da participação eleitoral</th><th className="px-4 py-2">N</th></tr></thead>
                  <tbody>
                    {buckets.map((bucket) => (
                      <tr key={bucket.index} className="border-t border-line">
                        <td className="px-4 py-2 text-fg">Q{bucket.index}</td>
                        <td className="px-4 py-2 text-fg-muted">{number.format(bucket.indicatorMean)} {selected.unit}</td>
                        <td className="px-4 py-2 text-fg-muted">{number.format(bucket.voteShareMean)}%</td>
                        <td className="px-4 py-2 text-fg-muted">{bucket.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {strongest.length > 0 && (
            <section className="rounded-xl border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg">Maior participação municipal da candidatura</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {strongest.map((point) => (
                  <div key={point.municipalityIbgeCode} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <p className="font-medium text-fg">{point.municipalityName}</p>
                    <p className="mt-1 text-xs text-fg-muted">{number.format(point.y)}% dos votos válidos · {selected.name}: {number.format(point.x)} {selected.unit}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
