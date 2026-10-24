"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTimeline, sendProductEvent } from "@/lib/live-election/api";
import { candidateByKey, votesOf } from "@/lib/live-election/derive";
import {
  formatIntegerCompact,
  formatPercent,
  formatPercentagePoints,
  formatSectionsPct,
  formatTimestamp,
  formatVotes,
} from "@/lib/live-election/format";
import type { LeadChange, LiveCandidate, LiveSummary, TimelinePoint } from "@/lib/live-election/types";
import { useLive } from "./LiveContext";
import { SectionHeading, SlotSwatch } from "./primitives";

/** Largura real do contêiner (o SVG é desenhado em pixels: texto nunca encolhe no celular). */
function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? fallback);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return { ref, width: Math.max(280, width) };
}

interface Pt {
  x: number;
  y: number;
}
interface Series {
  key: string;
  label: string;
  className: string;
  dashed: boolean;
  points: Pt[];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function LineChart({
  series,
  xDomain,
  yDomain,
  formatX,
  formatY,
  zero,
  height = 220,
  label,
}: Readonly<{
  series: Series[];
  xDomain: [number, number];
  yDomain: [number, number];
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  zero?: boolean;
  height?: number;
  label: string;
}>) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const pad = { l: 56, r: 12, t: 12, b: 26 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const sx = (v: number) => pad.l + (x1 === x0 ? w / 2 : ((v - x0) / (x1 - x0)) * w);
  const sy = (v: number) => pad.t + (y1 === y0 ? h / 2 : (1 - (v - y0) / (y1 - y0)) * h);
  const xt = niceTicks(x0, x1, width < 420 ? 3 : 5);
  const yt = niceTicks(y0, y1, 4);
  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={height} role="img" aria-label={label} className="block">
        {yt.map((t) => (
          <g key={`y${t}`}>
            <line x1={pad.l} x2={pad.l + w} y1={sy(t)} y2={sy(t)} className="live-chart-grid" />
            <text x={pad.l - 6} y={sy(t)} textAnchor="end" dominantBaseline="middle" className="live-chart-axis">
              {formatY(t)}
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={height - 6} textAnchor="middle" className="live-chart-axis">
            {formatX(t)}
          </text>
        ))}
        {zero && y0 < 0 && y1 > 0 ? <line x1={pad.l} x2={pad.l + w} y1={sy(0)} y2={sy(0)} className="live-chart-zero" /> : null}
        {series.map((s) =>
          s.points.length > 0 ? (
            <g key={s.key}>
              <path
                d={s.points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join("")}
                className={`live-chart-line ${s.className}`}
                stroke="currentColor"
                strokeDasharray={s.dashed ? "6 4" : undefined}
              />
              <circle cx={sx(s.points[s.points.length - 1].x)} cy={sy(s.points[s.points.length - 1].y)} r={3.5} className={s.className} fill="currentColor" />
            </g>
          ) : null,
        )}
      </svg>
    </div>
  );
}

type XAxis = "time" | "sections";
type LeadMetric = "votes" | "pp";

function Toggle<T extends string>({ value, options, onChange, label }: Readonly<{ value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="segmented-item focus-ring rounded-md px-2.5 py-1 text-micro font-medium"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Ponto da linha do tempo a partir do snapshot nacional atual (o stream estende o histórico sem nova leitura). */
export function pointFromSummary(summary: LiveSummary, ingestedAt: string | null): TimelinePoint | null {
  const n = summary.national;
  if (!n.available || !n.totalizedAt) return null;
  return {
    at: n.totalizedAt,
    ingestedAt: ingestedAt ?? n.ingestedAt ?? n.totalizedAt,
    sectionsPct: n.sections.totalizedPct,
    electoratePct: n.electorate.inTotalizedPct,
    candidates: n.candidates,
    leaderKey: n.leaderKey,
    leadVotes: n.leadVotes,
    leadPp: n.leadPp,
  };
}

/** Une histórico e pontos novos (sem duplicar pelo horário de totalização), em ordem cronológica. */
export function mergePoints(base: readonly TimelinePoint[], extra: readonly TimelinePoint[]): TimelinePoint[] {
  const byAt = new Map<string, TimelinePoint>();
  for (const p of [...base, ...extra]) byAt.set(p.at ?? p.ingestedAt, p);
  return [...byAt.values()].sort((a, b) => Date.parse(a.at ?? a.ingestedAt) - Date.parse(b.at ?? b.ingestedAt));
}

/** Vantagem com sinal: positiva com A à frente, negativa com B à frente (zero = empate). */
export function signedLead(p: TimelinePoint, candidates: readonly LiveCandidate[], metric: LeadMetric): number | null {
  const value = metric === "votes" ? p.leadVotes : p.leadPp;
  if (value === null) return null;
  if (!p.leaderKey) return 0;
  return candidateByKey(candidates, p.leaderKey)?.slot === "b" ? -Math.abs(value) : Math.abs(value);
}

function domain(values: number[], pad: number, clamp?: [number, number]): [number, number] {
  if (values.length === 0) return clamp ?? [0, 1];
  let lo = Math.min(...values) - pad;
  let hi = Math.max(...values) + pad;
  if (clamp) {
    lo = Math.max(clamp[0], lo);
    hi = Math.min(clamp[1], hi);
  }
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}

/** Evolução da apuração (seções 36 e 37): % dos votos válidos e vantagem ao longo do tempo. */
export function EvolutionCharts() {
  const summary = useLive((s) => s.summary);
  const meta = useLive((s) => s.summaryMeta);
  const storeChanges = useLive((s) => s.leadChanges);
  const [axis, setAxis] = useState<XAxis>("time");
  const [metric, setMetric] = useState<LeadMetric>("votes");
  const [extra, setExtra] = useState<TimelinePoint[]>([]);
  const query = useQuery({
    queryKey: ["live-election", "timeline", "br"],
    queryFn: ({ signal }) => fetchTimeline("br", "br", { signal }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    sendProductEvent("timeline_open", { once: true });
  }, []);

  useEffect(() => {
    if (!summary) return;
    const p = pointFromSummary(summary, meta?.ingestedAt ?? null);
    if (!p) return;
    setExtra((list) => (list.some((x) => x.at === p.at) ? list : [...list.slice(-500), p]));
  }, [summary, meta?.ingestedAt]);

  const candidates = useMemo(() => summary?.candidates ?? [], [summary?.candidates]);
  const points = useMemo(() => mergePoints(query.data?.data.points ?? [], extra), [query.data, extra]);
  const changes = useMemo(() => {
    const map = new Map<number, LeadChange>();
    for (const c of [...(query.data?.data.leadChanges ?? []), ...storeChanges]) map.set(c.id, c);
    return [...map.values()].sort((a, b) => a.id - b.id);
  }, [query.data, storeChanges]);

  if (!summary) return null;
  const [a, b] = candidates;
  const xOf = (p: TimelinePoint) => (axis === "time" ? Date.parse(p.at ?? p.ingestedAt) : p.sectionsPct ?? 0);
  const usable = points.filter((p) => (axis === "time" ? Number.isFinite(Date.parse(p.at ?? p.ingestedAt)) : p.sectionsPct !== null));
  const shareSeries: Series[] = [a, b]
    .filter((c): c is LiveCandidate => Boolean(c))
    .map((c) => ({
      key: c.key,
      label: c.ballotName,
      className: c.slot === "a" ? "live-text-a" : "live-text-b",
      dashed: c.slot === "b",
      points: usable
        .map((p) => ({ x: xOf(p), y: votesOf(p, c.key)?.pct ?? Number.NaN }))
        .filter((p) => Number.isFinite(p.y)),
    }));
  const leadPoints = usable.map((p) => ({ x: xOf(p), y: signedLead(p, candidates, metric) ?? Number.NaN })).filter((p) => Number.isFinite(p.y));
  const xs = usable.map(xOf);
  const xDomain: [number, number] = xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
  const shareValues = shareSeries.flatMap((s) => s.points.map((p) => p.y));
  const shareDomain = domain(shareValues, 2, [0, 100]);
  const leadAbs = Math.max(1, ...leadPoints.map((p) => Math.abs(p.y)));
  const leadDomain: [number, number] = [-leadAbs * 1.1, leadAbs * 1.1];
  const formatX = axis === "time" ? (v: number) => formatTimestamp(new Date(v).toISOString(), "time") : (v: number) => formatPercent(v, 0);

  return (
    <section aria-labelledby="live-evolution" data-testid="live-evolution">
      <SectionHeading
        id="live-evolution"
        eyebrow="Evolução"
        title="Como a apuração evoluiu"
        description="Percentual oficial dos votos válidos de cada candidatura a cada atualização do TSE, e a vantagem de quem esteve à frente. Zero = empate."
        action={
          <Toggle
            label="Eixo horizontal"
            value={axis}
            onChange={setAxis}
            options={[
              { value: "time", label: "Por horário" },
              { value: "sections", label: "Por % de seções" },
            ]}
          />
        }
      />
      {usable.length < 2 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-body-sm text-fg-muted">
          O gráfico aparece a partir da segunda atualização oficial recebida.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <figure className="rounded-2xl border border-line bg-surface p-4">
            <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-fg-soft">
              <span className="font-semibold text-fg">% dos votos válidos</span>
              {shareSeries.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5 text-micro">
                  <SlotSwatch slot={s.dashed ? "b" : "a"} className="h-2.5 w-2.5" />
                  {s.label}
                  {s.dashed ? " (tracejado)" : ""}
                </span>
              ))}
            </figcaption>
            <LineChart
              series={shareSeries}
              xDomain={xDomain}
              yDomain={shareDomain}
              formatX={formatX}
              formatY={(v) => formatPercent(v, 0)}
              label={`Percentual dos votos válidos por ${axis === "time" ? "horário" : "percentual de seções totalizadas"}`}
            />
          </figure>
          <figure className="rounded-2xl border border-line bg-surface p-4">
            <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2 text-body-sm">
              <span className="font-semibold text-fg">Vantagem ao longo da apuração</span>
              <Toggle
                label="Unidade da vantagem"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: "votes", label: "Votos" },
                  { value: "pp", label: "Pontos percentuais" },
                ]}
              />
            </figcaption>
            <LineChart
              series={[{ key: "lead", label: "Vantagem", className: "text-fg-soft", dashed: false, points: leadPoints }]}
              xDomain={xDomain}
              yDomain={leadDomain}
              formatX={formatX}
              formatY={(v) => (metric === "votes" ? formatIntegerCompact(Math.abs(v)) : formatPercentagePoints(Math.abs(v), 1).replace("+", ""))}
              zero
              label="Vantagem de quem esteve à frente; acima do zero, candidatura A à frente; abaixo, candidatura B"
            />
            <p className="mt-1 flex flex-wrap justify-between gap-2 text-micro text-fg-muted">
              <span>Acima da linha: {a?.ballotName ?? "A"} à frente</span>
              <span>Abaixo: {b?.ballotName ?? "B"} à frente</span>
            </p>
          </figure>
        </div>
      )}
      <details className="mt-3 rounded-xl border border-line bg-surface px-4 py-2 text-body-sm">
        <summary className="focus-ring cursor-pointer rounded font-medium text-accent-text">Ver os dados dos gráficos em tabela</summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full text-micro">
            <thead className="live-sticky-head">
              <tr className="text-left text-fg-muted">
                <th scope="col" className="py-1 pr-2">
                  Totalização
                </th>
                <th scope="col" className="py-1 pr-2 text-right">
                  Seções
                </th>
                {[a, b].filter((c): c is LiveCandidate => Boolean(c)).map((c) => (
                  <th key={c.key} scope="col" className="py-1 pr-2 text-right">
                    {c.ballotName}
                  </th>
                ))}
                <th scope="col" className="py-1 text-right">
                  Vantagem
                </th>
              </tr>
            </thead>
            <tbody>
              {[...usable].reverse().slice(0, 200).map((p) => (
                <tr key={p.at ?? p.ingestedAt} className="border-t border-line/60">
                  <td className="py-1 pr-2">{formatTimestamp(p.at ?? p.ingestedAt)}</td>
                  <td className="py-1 pr-2 text-right">{formatSectionsPct(p.sectionsPct)}</td>
                  {[a, b].filter((c): c is LiveCandidate => Boolean(c)).map((c) => (
                    <td key={c.key} className="py-1 pr-2 text-right">
                      {formatPercent(votesOf(p, c.key)?.pct)}
                    </td>
                  ))}
                  <td className="py-1 text-right">{formatVotes(p.leadVotes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <LeadChangeTimeline changes={changes} candidates={candidates} />
    </section>
  );
}

/** Mudanças de liderança (seção 38), sem sensacionalismo: horário, nova liderança, seções. */
export function LeadChangeTimeline({ changes, candidates }: Readonly<{ changes: readonly LeadChange[]; candidates: readonly LiveCandidate[] }>) {
  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface p-4" data-testid="live-lead-changes">
      <h3 className="text-label uppercase text-fg-muted">Mudanças de liderança</h3>
      {changes.length === 0 ? (
        <p className="mt-2 text-body-sm text-fg-muted">Nenhuma mudança de liderança registrada até agora.</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {changes.map((c) => {
            const leader = candidateByKey(candidates, c.newLeaderKey);
            return (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 text-body-sm">
                <span className="tabular font-semibold text-fg">{formatTimestamp(c.at ?? c.detectedAt)}</span>
                <span className="text-fg-soft">— mudança de liderança</span>
                {leader ? (
                  <span className="flex items-center gap-1 text-fg-muted">
                    <SlotSwatch slot={leader.slot} className="h-2.5 w-2.5" /> {leader.ballotName} à frente
                  </span>
                ) : null}
                <span className="text-micro text-fg-muted">({formatSectionsPct(c.sectionsPct)} das seções)</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Mini-série da vantagem de uma UF (painel da UF). */
export function LeadMiniChart({ points, candidates, label }: Readonly<{ points: readonly TimelinePoint[]; candidates: readonly LiveCandidate[]; label: string }>) {
  const usable = points.filter((p) => p.at && p.leadPp !== null);
  if (usable.length < 2) return <p className="text-body-sm text-fg-muted">A evolução aparece a partir da segunda atualização desta abrangência.</p>;
  const pts = usable.map((p) => ({ x: Date.parse(p.at as string), y: signedLead(p, candidates, "pp") ?? 0 }));
  const xs = pts.map((p) => p.x);
  const abs = Math.max(1, ...pts.map((p) => Math.abs(p.y)));
  return (
    <LineChart
      series={[{ key: "lead", label: "Vantagem", className: "text-fg-soft", dashed: false, points: pts }]}
      xDomain={[Math.min(...xs), Math.max(...xs)]}
      yDomain={[-abs * 1.1, abs * 1.1]}
      formatX={(v) => formatTimestamp(new Date(v).toISOString(), "time")}
      formatY={(v) => formatPercentagePoints(Math.abs(v), 0).replace("+", "")}
      zero
      height={160}
      label={label}
    />
  );
}
