"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { getCandidacyCorrelation, getIndicators, type StateCoverage } from "@/lib/data-intelligence";
import { displayName } from "@/lib/elections/format";
import { xrayApi } from "@/lib/elections/xray";
import { loadedIndicators } from "@/lib/territory/coverage";
import { formatCoefficient, formatInteger, formatValue } from "@/lib/territory/format";
import { STRENGTH_LABEL, extremeGroups, strengthOf } from "@/lib/territory/insights";
import { CausalityNote } from "./Insights";
import { Scatter } from "./Scatter";
import { SELECT } from "./modes/shared";
import { inUf, ofUf } from "@/lib/territory/places";

const percent = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const share = (value: number) => `${percent.format(value)}%`;
/** Cargos municipais: cada município tem a própria disputa, sem uma candidatura comum ao estado inteiro. */
const MUNICIPAL_OFFICES = new Set([11, 12, 13]);

/**
 * Perfil socioeleitoral: onde cada candidatura teve mais ou menos votos válidos, comparado a um indicador oficial do
 * mesmo ano. Responde perguntas como "os municípios com mais analfabetos votaram mais em A ou em B?" — sempre por
 * município, nunca por pessoa, e sem afirmar causa.
 */
export function SocioElectoralCrossing({
  uf,
  ufName,
  year,
  round,
  office,
  officeLabel,
  coverage,
  selected,
  hovered,
  onHover,
}: Readonly<{
  uf: string;
  ufName: string;
  year: number;
  round: number;
  office: number;
  officeLabel: string;
  coverage: StateCoverage | null;
  selected: string | null;
  hovered: string | null;
  onHover: (code: string | null) => void;
}>) {
  const loaded = useMemo(() => loadedIndicators(coverage), [coverage]);
  const catalog = useQuery({ queryKey: ["data-indicators"], queryFn: getIndicators, staleTime: 10 * 60_000 });
  const sameYear = (catalog.data ?? []).filter((i) => (loaded.get(i.code) ?? []).includes(year));
  const otherPeriods = [...new Set([...loaded.values()].flat())].sort((a, b) => b - a);
  const [indicatorCode, setIndicatorCode] = useState<string | null>(null);
  const indicator = sameYear.find((i) => i.code === indicatorCode) ?? sameYear.find((i) => i.code === "derived.illiteracy_rate_15_plus") ?? sameYear[0] ?? null;
  const municipal = MUNICIPAL_OFFICES.has(office);

  const candidates = useQuery({
    queryKey: ["crossing-candidates", year, round, uf, office],
    queryFn: () => xrayApi.candidates(year, round, uf, { office, sort: "votes", dir: "desc", pageSize: 4 }),
    enabled: !municipal && !!indicator,
    staleTime: 10 * 60_000,
  });
  const top = (candidates.data?.items ?? []).filter((c) => (c.votes ?? 0) > 0);
  const [picked, setPicked] = useState<[string | null, string | null]>([null, null]);
  const a = top.find((c) => c.candidacyId === picked[0]) ?? top[0] ?? null;
  const b = top.find((c) => c.candidacyId === picked[1] && c.candidacyId !== a?.candidacyId) ?? top.find((c) => c.candidacyId !== a?.candidacyId) ?? null;
  const pair = [a, b].filter((c): c is NonNullable<typeof c> => !!c);

  const correlations = useQueries({
    queries: pair.map((c) => ({
      queryKey: ["crossing", c.candidacyId, indicator?.code, year, round, office, uf],
      queryFn: () => getCandidacyCorrelation({ xIndicator: indicator!.code, period: year, candidacyId: c.candidacyId, year, round, office, uf }),
      enabled: !!indicator,
      staleTime: 5 * 60_000,
    })),
  });

  const header = (
    <div>
      <h2 id="crossing-title" className="font-semibold text-fg">Perfil socioeleitoral</h2>
      <p className="mt-1 text-body-sm text-fg-muted">
        Onde cada candidatura a {officeLabel.toLowerCase()} teve mais ou menos votos válidos {inUf(uf, ufName)}, ao lado de um indicador oficial do mesmo ano.
      </p>
    </div>
  );

  if (municipal) {
    return (
      <section aria-labelledby="crossing-title" className="space-y-2 rounded-xl border border-line bg-surface p-4" data-testid="socioelectoral-crossing">
        {header}
        <p className="text-body-sm text-fg-soft">Cargo municipal: cada município tem a própria disputa, então não existe uma candidatura comum ao estado inteiro para cruzar com os indicadores.</p>
      </section>
    );
  }
  if (!indicator) {
    return (
      <section aria-labelledby="crossing-title" className="space-y-2 rounded-xl border border-line bg-surface p-4" data-testid="socioelectoral-crossing">
        {header}
        <p className="text-body-sm text-fg-soft">
          O cruzamento exige indicador do mesmo ano do pleito ({year}).{" "}
          {otherPeriods.length
            ? `Os indicadores carregados para os municípios ${ofUf(uf, ufName)} são de ${otherPeriods.join(", ")}: escolha um pleito desse ano para ver esta leitura.`
            : `Não há indicadores socioeconômicos carregados para os municípios ${ofUf(uf, ufName)}.`}
        </p>
      </section>
    );
  }

  const results = correlations.map((q) => q.data);
  const groups = results.map((r) => (r ? extremeGroups(r.points) : null));
  const fx = (v: number) => formatValue(v, indicator.unit);
  const name = (ballot: string) => displayName(ballot);
  const ready = pair.length > 0 && results.every(Boolean);
  const failed = correlations.some((q) => q.isError && !q.data) || (candidates.isError && !candidates.data);

  return (
    <section aria-labelledby="crossing-title" className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="socioelectoral-crossing">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {header}
        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
          <label className="space-y-1 text-body-sm text-fg-muted">
            <span>Indicador ({year})</span>
            <select className={SELECT} value={indicator.code} onChange={(e) => setIndicatorCode(e.target.value)}>
              {sameYear.map((i) => (
                <option key={i.code} value={i.code}>{i.name}</option>
              ))}
            </select>
          </label>
          {[0, 1].map((slot) => (
            <label key={slot} className="space-y-1 text-body-sm text-fg-muted">
              <span>Candidatura {slot === 0 ? "A" : "B"}</span>
              <select
                className={SELECT}
                value={(slot === 0 ? a : b)?.candidacyId ?? ""}
                onChange={(e) => setPicked((current) => (slot === 0 ? [e.target.value, current[1]] : [current[0], e.target.value]))}
                disabled={top.length < 2}
              >
                {top.map((c) => (
                  <option key={c.candidacyId} value={c.candidacyId} disabled={c.candidacyId === (slot === 0 ? b : a)?.candidacyId}>
                    {name(c.ballotName)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      {failed && <DataState kind="error" title="Não foi possível calcular o cruzamento" action={<RetryButton onRetry={() => { void candidates.refetch(); correlations.forEach((q) => void q.refetch()); }} />} />}
      {!failed && !ready && <DataState kind="loading" title="Cruzando votos e indicador" height="h-32" />}
      {ready && (
        <>
          <ul className="space-y-1.5 text-body leading-7 text-fg" data-testid="crossing-sentences">
            {pair.map((c, index) => {
              const r = results[index]!;
              const strength = strengthOf(r.spearman);
              if (!strength || strength === "sem_associacao")
                return <li key={c.candidacyId}>Para {name(c.ballotName)}, não há associação clara entre {indicator.name} e a parcela de votos válidos (ρ = {formatCoefficient(r.spearman)}).</li>;
              const direction = (r.spearman ?? 0) > 0 ? "maior" : "menor";
              return (
                <li key={c.candidacyId}>
                  Nos municípios com maior {indicator.name}, {name(c.ballotName)} tende a ter parcela {direction} dos votos válidos ({STRENGTH_LABEL[strength]}, ρ = {formatCoefficient(r.spearman)}, {formatInteger(r.n)} municípios).
                </li>
              );
            })}
          </ul>
          {groups.every(Boolean) && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-body-sm" data-testid="crossing-table">
                <caption className="sr-only">Média da parcela de votos válidos por grupo de municípios</caption>
                <thead className="text-micro text-fg-muted">
                  <tr>
                    <th scope="col" className="py-1.5 text-left font-medium">Municípios (20% de cada ponta)</th>
                    {pair.map((c) => (
                      <th key={c.candidacyId} scope="col" className="py-1.5 text-right font-medium">{name(c.ballotName)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(["high", "low"] as const).map((side) => (
                    <tr key={side} className="border-t border-line">
                      <th scope="row" className="py-1.5 text-left font-normal text-fg-soft">
                        {side === "high" ? "Maior" : "Menor"} {indicator.name} ({fx(groups[0]![side].xFrom)} a {fx(groups[0]![side].xTo)})
                      </th>
                      {pair.map((c, index) => (
                        <td key={c.candidacyId} className="py-1.5 text-right tabular-nums text-fg">{share(groups[index]![side].meanY)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-micro text-fg-muted">Média simples da parcela de votos válidos de cada candidatura nos municípios de cada grupo ({formatInteger(groups[0]!.high.n)} municípios por grupo).</p>
            </div>
          )}
          <Scatter
            points={results[0]!.points.map((p) => ({ code: p.municipalityIbgeCode, name: p.municipalityName, x: p.x, y: p.y }))}
            xLabel={`${indicator.name} (${indicator.unit})`}
            yLabel={`${name(pair[0].ballotName)}: % dos votos válidos`}
            formatX={fx}
            formatY={share}
            selected={selected}
            hovered={hovered}
            onHover={onHover}
            summary={`Dispersão por município: ${indicator.name} e a parcela de votos válidos de ${name(pair[0].ballotName)}.`}
          />
          <CausalityNote territorial />
          <p className="text-micro leading-5 text-fg-muted">
            Fontes: votos do TSE (Boletim de Urna, {year}, {round}º turno) e {indicator.provider} ({year}). Só entram municípios com os dois dados. {results[0]!.methodology}
          </p>
        </>
      )}
    </section>
  );
}
