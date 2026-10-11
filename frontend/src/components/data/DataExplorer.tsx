"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getClusters,
  getCorrelation,
  getIndicatorValues,
  getIndicators,
  type ClusterResponse,
  type CorrelationPoint,
  type CorrelationResponse,
  type Indicator,
  type IndicatorValue,
} from "@/lib/data-intelligence";

const format = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

function coefficient(value: number | null) {
  return value === null ? "—" : value.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function Scatter({ points }: Readonly<{ points: CorrelationPoint[] }>) {
  const plotted = useMemo(() => {
    if (points.length === 0) return [];
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    return points.map((p) => ({
      ...p,
      cx: 28 + ((p.x - minX) / dx) * 544,
      cy: 252 - ((p.y - minY) / dy) * 220,
    }));
  }, [points]);

  if (plotted.length === 0) return <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-muted">Sem pares observados para este recorte.</div>;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface p-4" data-testid="data-scatter">
      <svg viewBox="0 0 600 280" className="min-w-[560px]" role="img" aria-label="Gráfico de dispersão dos municípios observados">
        <line x1="28" y1="252" x2="580" y2="252" stroke="currentColor" opacity="0.2" />
        <line x1="28" y1="24" x2="28" y2="252" stroke="currentColor" opacity="0.2" />
        {plotted.map((p) => (
          <circle key={p.municipalityIbgeCode} cx={p.cx} cy={p.cy} r="4" fill="currentColor" opacity="0.65">
            <title>{`${p.municipalityName}: ${format.format(p.x)} × ${format.format(p.y)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

export function DataExplorer() {
  const [catalog, setCatalog] = useState<Indicator[]>([]);
  const [xIndicator, setXIndicator] = useState("");
  const [yIndicator, setYIndicator] = useState("");
  const [period, setPeriod] = useState<number | null>(null);
  const [periods, setPeriods] = useState<number[]>([]);
  const [values, setValues] = useState<IndicatorValue[]>([]);
  const [correlation, setCorrelation] = useState<CorrelationResponse | null>(null);
  const [clusters, setClusters] = useState<ClusterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getIndicators()
      .then((items) => {
        if (!active) return;
        setCatalog(items);
        setXIndicator(items[0]?.code ?? "");
        setYIndicator(items.find((item) => item.code !== items[0]?.code)?.code ?? "");
      })
      .catch(() => active && setError("Não foi possível carregar o catálogo de indicadores."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!xIndicator) return;
    let active = true;
    setError(null);
    getIndicatorValues(xIndicator, undefined, "CE")
      .then((rows) => {
        if (!active) return;
        setValues(rows);
        const available = [...new Set(rows.map((row) => row.period))].sort((a, b) => b - a);
        setPeriods(available);
        setPeriod((current) => current !== null && available.includes(current) ? current : (available[0] ?? null));
      })
      .catch(() => active && setError("Não foi possível carregar os valores do indicador."));
    return () => { active = false; };
  }, [xIndicator]);

  useEffect(() => {
    if (!xIndicator || !yIndicator || period === null) {
      setCorrelation(null);
      setClusters(null);
      return;
    }
    let active = true;
    setError(null);
    Promise.all([
      getCorrelation(xIndicator, yIndicator, period, "CE"),
      getClusters(xIndicator, period, 3, "CE"),
    ])
      .then(([corr, cluster]) => {
        if (!active) return;
        setCorrelation(corr);
        setClusters(cluster);
      })
      .catch(() => active && setError("Não foi possível calcular o recorte selecionado."));
    return () => { active = false; };
  }, [xIndicator, yIndicator, period]);

  const selectedX = catalog.find((item) => item.code === xIndicator);
  const selectedY = catalog.find((item) => item.code === yIndicator);
  const source = values.find((row) => row.period === period);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 lg:px-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent-text">Inteligência de dados</p>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">Dados</h1>
        <p className="max-w-3xl text-sm leading-6 text-fg-muted">
          Indicadores socioeconômicos oficiais por município, com proveniência auditável, correlação exploratória e agrupamentos determinísticos.
        </p>
      </header>

      <section className="rounded-xl border border-line bg-surface p-4" aria-label="Filtros">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm text-fg-muted">
            <span>Indicador X</span>
            <select className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg" value={xIndicator} onChange={(event) => setXIndicator(event.target.value)}>
              {catalog.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm text-fg-muted">
            <span>Indicador Y</span>
            <select className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg" value={yIndicator} onChange={(event) => setYIndicator(event.target.value)}>
              {catalog.filter((item) => item.code !== xIndicator).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm text-fg-muted">
            <span>Período</span>
            <select className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg" value={period ?? ""} onChange={(event) => setPeriod(Number(event.target.value))}>
              {periods.length === 0 && <option value="">Sem período disponível</option>}
              {periods.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </section>

      {loading && <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-muted">Carregando catálogo…</div>}
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">{error}</div>}

      {!loading && catalog.length === 0 && !error && (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-muted">Nenhum indicador cadastrado.</div>
      )}

      {selectedX && (
        <section className="grid gap-3 md:grid-cols-2">
          {[selectedX, selectedY].filter(Boolean).map((item) => item && (
            <article key={item.code} className="rounded-xl border border-line bg-surface p-4">
              <p className="text-xs uppercase tracking-wide text-fg-muted">{item.provider}{item.derived ? " · derivado" : ""}</p>
              <h2 className="mt-1 font-semibold text-fg">{item.name}</h2>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{item.description}</p>
              <p className="mt-2 text-xs text-fg-muted">Unidade: {item.unit}</p>
            </article>
          ))}
        </section>
      )}

      <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4" data-testid="causality-caveat">
        <p className="text-sm font-medium text-fg">Correlação não implica causalidade.</p>
        <p className="mt-1 text-sm text-fg-muted">Os coeficientes descrevem associação nos municípios observados. Não demonstram que um indicador cause o outro.</p>
      </section>

      {period !== null && correlation && (
        <>
          <section className="grid gap-3 sm:grid-cols-3" data-testid="correlation-summary">
            <article className="rounded-xl border border-line bg-surface p-4"><p className="text-xs text-fg-muted">Pearson</p><p className="mt-1 text-2xl font-semibold text-fg">{coefficient(correlation.pearson)}</p></article>
            <article className="rounded-xl border border-line bg-surface p-4"><p className="text-xs text-fg-muted">Spearman</p><p className="mt-1 text-2xl font-semibold text-fg">{coefficient(correlation.spearman)}</p></article>
            <article className="rounded-xl border border-line bg-surface p-4"><p className="text-xs text-fg-muted">N observado</p><p className="mt-1 text-2xl font-semibold text-fg">{correlation.n}</p></article>
          </section>

          <Scatter points={correlation.points} />

          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="border-b border-line px-4 py-3">
              <h2 className="font-semibold text-fg">Municípios observados</h2>
              <p className="text-xs text-fg-muted">Período {period}. Ausência de linha significa ausência de dado; não é convertida em zero.</p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-left text-sm" data-testid="correlation-table">
                <thead className="sticky top-0 bg-surface text-xs text-fg-muted"><tr><th className="px-4 py-2">Município</th><th className="px-4 py-2">X</th><th className="px-4 py-2">Y</th></tr></thead>
                <tbody>{correlation.points.map((point) => <tr key={point.municipalityIbgeCode} className="border-t border-line"><td className="px-4 py-2 text-fg">{point.municipalityName}</td><td className="px-4 py-2 text-fg-muted">{format.format(point.x)}</td><td className="px-4 py-2 text-fg-muted">{format.format(point.y)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {clusters && clusters.items.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4" data-testid="clusters">
          <h2 className="font-semibold text-fg">Agrupamentos</h2>
          <p className="mt-1 text-sm text-fg-muted">{clusters.methodology}</p>
          <div className="mt-3 flex flex-wrap gap-2">{clusters.centroids.map((centroid, index) => <span key={`${index}-${centroid}`} className="rounded-full border border-line px-3 py-1 text-xs text-fg-muted">Grupo {index + 1}: centro {format.format(centroid)}</span>)}</div>
        </section>
      )}

      {source && (
        <footer className="rounded-xl border border-line bg-surface p-4 text-xs leading-5 text-fg-muted">
          Fonte da observação mais recente exibida: <strong className="text-fg-soft">{source.provider}</strong> · {source.dataset} · coletada em {new Date(source.retrievedAt).toLocaleString("pt-BR")}.
        </footer>
      )}
    </main>
  );
}
