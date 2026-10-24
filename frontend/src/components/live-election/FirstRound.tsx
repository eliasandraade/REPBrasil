"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchFirstRound, sendProductEvent } from "@/lib/live-election/api";
import { candidateByKey, REGION_LABEL } from "@/lib/live-election/derive";
import { formatPercent, formatPercentagePoints, formatSectionsPct, formatSignedVotes, formatVotes, NA } from "@/lib/live-election/format";
import type { FirstRoundComparison, LiveCandidate, RegionCode } from "@/lib/live-election/types";
import { UF_NAMES, UFS } from "@/lib/site";
import { useLive } from "./LiveContext";
import { SectionHeading, SlotSwatch } from "./primitives";

const TURNOUT_LABEL: Record<FirstRoundComparison["turnout"][number]["metric"], string> = {
  turnout: "Comparecimento",
  abstention: "Abstenção",
  valid: "Votos válidos",
  blank: "Brancos",
  null: "Nulos",
};

/** Tabelas da comparação com o 1º turno (variação, nunca "transferência" de votos). */
export function FirstRoundTables({ comparison, candidates }: Readonly<{ comparison: FirstRoundComparison; candidates: readonly LiveCandidate[] }>) {
  if (!comparison.available) {
    return <p className="text-body-sm text-fg-muted">Comparação com o 1º turno indisponível para este recorte.</p>;
  }
  return (
    <div className="space-y-4" data-testid="live-first-round-tables">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-body-sm">
          <caption className="sr-only">Votos de cada candidatura no 1º e no 2º turno — {comparison.name}</caption>
          <thead>
            <tr className="text-left text-micro uppercase text-fg-muted">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Candidatura
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                1º turno
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                2º turno
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                Diferença
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                % 1º turno
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                % 2º turno
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Variação
              </th>
            </tr>
          </thead>
          <tbody>
            {comparison.candidates.map((row) => {
              const c = candidateByKey(candidates, row.key);
              return (
                <tr key={row.key} className="border-t border-line/70">
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium text-fg">
                    <span className="flex items-center gap-1.5">
                      {c ? <SlotSwatch slot={c.slot} className="h-2.5 w-2.5" /> : null}
                      {c?.ballotName ?? row.key}
                    </span>
                  </th>
                  <td className="py-1.5 pr-3 text-right">{row.firstRound ? formatVotes(row.firstRound.votes) : NA}</td>
                  <td className="py-1.5 pr-3 text-right">{formatVotes(row.secondRound.votes)}</td>
                  <td className="py-1.5 pr-3 text-right">{formatSignedVotes(row.diffVotes)}</td>
                  <td className="py-1.5 pr-3 text-right">{row.firstRound ? formatPercent(row.firstRound.pct) : NA}</td>
                  <td className="py-1.5 pr-3 text-right">{formatPercent(row.secondRound.pct)}</td>
                  <td className="py-1.5 text-right font-semibold">{formatPercentagePoints(row.deltaPp)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-body-sm">
          <caption className="sr-only">Comparecimento, abstenção, válidos, brancos e nulos no 1º e no 2º turno — {comparison.name}</caption>
          <thead>
            <tr className="text-left text-micro uppercase text-fg-muted">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Indicador
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                1º turno
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                2º turno
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                Diferença
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Variação
              </th>
            </tr>
          </thead>
          <tbody>
            {comparison.turnout.map((t) => (
              <tr key={t.metric} className="border-t border-line/70">
                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-fg">
                  {TURNOUT_LABEL[t.metric]}
                </th>
                <td className="py-1.5 pr-3 text-right">
                  {formatVotes(t.firstRound.count)} <span className="text-micro text-fg-muted">{formatPercent(t.firstRound.pct)}</span>
                </td>
                <td className="py-1.5 pr-3 text-right">
                  {formatVotes(t.secondRound.count)} <span className="text-micro text-fg-muted">{formatPercent(t.secondRound.pct)}</span>
                </td>
                <td className="py-1.5 pr-3 text-right">{formatSignedVotes(t.deltaCount)}</td>
                <td className="py-1.5 text-right font-semibold">{formatPercentagePoints(t.deltaPp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-micro text-fg-muted">
        {comparison.note} Com {formatSectionsPct(comparison.secondRoundSectionsPct)} das seções do 2º turno totalizadas. A comparação descreve a
        variação em relação ao 1º turno; não é possível saber para onde os votos de cada eleitor migraram.
      </p>
    </div>
  );
}

type Scope = { scope: FirstRoundComparison["scope"]; code: string };

const REGIONS = Object.keys(REGION_LABEL) as RegionCode[];

/** Comparação com o 1º turno (seções 34 e 35): Brasil, região ou UF. */
export function FirstRoundSection() {
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  const nationalRevision = useLive((s) => s.nationalRevision);
  const [target, setTarget] = useState<Scope>({ scope: "br", code: "br" });
  const query = useQuery({
    queryKey: ["live-election", "first-round", target.scope, target.code, Math.floor(nationalRevision / 4)],
    queryFn: ({ signal }) => fetchFirstRound(target.scope, target.code, { signal }),
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });
  useEffect(() => {
    sendProductEvent("first_round_comparison_open", { once: true });
  }, []);

  const value = `${target.scope}:${target.code}`;
  return (
    <section aria-labelledby="live-first-round" data-testid="live-first-round">
      <SectionHeading
        id="live-first-round"
        eyebrow="Comparação"
        title="Variação em relação ao 1º turno"
        description="Votos e participação no 1º turno (eleição oficial já totalizada) diante do 2º turno, no mesmo recorte."
        action={
          <label className="flex items-center gap-2 text-body-sm text-fg-soft">
            Recorte
            <select
              value={value}
              onChange={(e) => {
                const [scope, code] = e.target.value.split(":") as [FirstRoundComparison["scope"], string];
                setTarget({ scope, code });
              }}
              className="focus-ring rounded-lg border border-line bg-surface px-2 py-1.5 text-body-sm text-fg"
            >
              <option value="br:br">Brasil</option>
              <optgroup label="Regiões">
                {REGIONS.map((r) => (
                  <option key={r} value={`region:${r}`}>
                    {REGION_LABEL[r]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="UFs">
                {UFS.map((uf) => (
                  <option key={uf} value={`uf:${uf}`}>
                    {UF_NAMES[uf]}
                  </option>
                ))}
                <option value="uf:ZZ">Exterior</option>
              </optgroup>
            </select>
          </label>
        }
      />
      <div className="rounded-2xl border border-line bg-surface p-4">
        {query.data ? (
          <FirstRoundTables comparison={query.data.data} candidates={candidates ?? []} />
        ) : query.isError ? (
          <p role="status" className="text-body-sm text-fg-muted">
            Não foi possível carregar a comparação agora.{" "}
            <button type="button" onClick={() => void query.refetch()} className="focus-ring rounded font-medium text-accent-text hover:underline">
              Tentar de novo
            </button>
          </p>
        ) : (
          <div className="skeleton h-48 rounded-xl" aria-busy="true" aria-label="Carregando a comparação" />
        )}
      </div>
    </section>
  );
}
