"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { displayName, formatCount, formatPercent, UNAVAILABLE } from "@/lib/elections/format";
import {
  CELL_STATE_LABEL,
  CONTEST_COMPARABILITY_LABEL,
  MAX_COMPARE,
  electionLabel,
  money,
  serializeSelection,
  signed,
  signedPercent,
  toggleSelection,
  xrayApi,
} from "@/lib/elections/xray";
import type { XrayCandidacy, XrayResponse } from "@/lib/elections/xray-types";
import { CandidacyDetail } from "./CandidacyDetail";
import { InsightList } from "./InsightList";

const ROLE_LABEL = { vice: "Vice", first_substitute: "1º suplente", second_substitute: "2º suplente" } as const;

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "brand" | "muted" | "warn" }) {
  const cls =
    tone === "brand" ? "border-brand/30 bg-brand/10 text-brand" : tone === "warn" ? "border-amber-400/30 bg-amber-400/10 text-amber-300" : "border-white/10 bg-white/5 text-slate-400";
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

function TotalsLine({ c }: { c: XrayCandidacy }) {
  const t = c.totals;
  if (c.ticket) {
    return (
      <p className="text-xs text-slate-400" data-testid="xray-ticket">
        {ROLE_LABEL[c.ticket.role]} · {c.ticket.note}
        {c.ticket.headVotes !== null && (
          <span className="text-slate-300">
            {" "}
            Chapa: {formatCount(c.ticket.headVotes)} votos ({formatPercent(c.ticket.headShare)}).
          </span>
        )}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-state={t.state}>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-600">Votos</p>
        <p className="text-base font-bold text-slate-100" data-testid="xray-votes">
          {t.votes === null ? <span className="text-xs font-normal text-slate-500">{CELL_STATE_LABEL[t.state]}</span> : formatCount(t.votes)}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-600">% dos válidos</p>
        <p className="text-base font-bold text-slate-100">{formatPercent(t.shareOfValidVotes)}</p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-600">Posição</p>
        <p className="text-base font-bold text-slate-100">
          {t.rank === null ? UNAVAILABLE : `${t.rank}º`}
          {t.candidatesWithVotes !== null && <span className="text-xs font-normal text-slate-500"> de {t.candidatesWithVotes}</span>}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-600">Cobertura</p>
        <p className="text-xs text-slate-300" title={t.coverage.note}>
          {t.coverage.complete ? "completa" : `${t.coverage.zonesImported}/${t.coverage.zonesExpected} zonas`}
        </p>
      </div>
    </div>
  );
}

function CandidacyCard({
  c,
  selected,
  compared,
  onSelect,
  onCompare,
}: {
  c: XrayCandidacy;
  selected: boolean;
  compared: boolean;
  onSelect: () => void;
  onCompare: () => void;
}) {
  return (
    <article
      className={`rounded-lg border p-4 ${selected ? "border-brand/40 bg-card-elevated/70" : "border-white/8 bg-card-elevated/40"}`}
      data-candidacy={c.candidacyId}
      data-testid="xray-candidacy"
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Eleições {electionLabel(c.contest.year, c.contest.round)} · {c.contest.unit.name}
          </p>
          <h3 className="text-base font-bold text-slate-100">{displayName(c.contest.officeName)}</h3>
          <p className="text-xs text-slate-400">
            {displayName(c.ballotName)} · nº {c.number}
            {c.party?.acronym ? ` · ${c.party.acronym}` : ""}
            {c.federationAcronym ? ` · federação ${c.federationAcronym}` : ""}
            {c.coalitionName && c.coalitionName !== "PARTIDO ISOLADO" ? ` · ${displayName(c.coalitionName)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {c.roundOutcome && <Badge tone={c.elected ? "brand" : "muted"}>{displayName(c.roundOutcome)}</Badge>}
          {c.candidacyStatus && <Badge>{displayName(c.candidacyStatus)}</Badge>}
          {c.identityStatus === "resolved_tse_link" && <Badge>vínculo oficial TSE</Badge>}
        </div>
      </div>
      <TotalsLine c={c} />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        {c.assets && <span>Bens declarados: {money(c.assets.total)} ({c.assets.items} itens)</span>}
        {c.finance && <span>Receitas: {money(c.finance.revenues)} · Despesas: {money(c.finance.expensesContracted)}</span>}
        <span className="flex-1" />
        <button type="button" onClick={onSelect} aria-pressed={selected} className="text-brand hover:underline">
          {selected ? "Detalhe aberto" : "Ver detalhe"}
        </button>
        {!c.ticket && (
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={compared} onChange={onCompare} className="accent-[#0dd48e]" />
            comparar
          </label>
        )}
      </div>
      <p className="mt-2 border-t border-white/5 pt-1.5 text-[10px] text-slate-600">
        TSE · SQ {c.tseCandidateId} · {c.source.member}, linha {c.source.line}
      </p>
    </article>
  );
}

function EvolutionList({ data }: { data: XrayResponse }) {
  const byId = useMemo(() => new Map(data.candidacies.map((c) => [c.candidacyId, c])), [data]);
  if (data.evolution.length === 0 && data.assetsEvolution.length === 0) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="xray-evolution">
      {data.evolution.length > 0 && (
        <div className="rounded-lg border border-white/8 bg-card p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Evolução de votos</p>
          <ul className="space-y-1.5">
            {data.evolution.map((s) => {
              const from = byId.get(s.fromCandidacyId);
              const to = byId.get(s.toCandidacyId);
              return (
                <li key={`${s.fromCandidacyId}-${s.toCandidacyId}`} className="text-xs" data-comparability={s.comparability}>
                  <span className="text-slate-400">
                    {from ? electionLabel(from.contest.year, from.contest.round) : "?"} → {to ? electionLabel(to.contest.year, to.contest.round) : "?"}
                  </span>{" "}
                  {s.comparability === "comparable_contest" ? (
                    <span className="text-slate-200">
                      {signed(s.deltaVotes)} votos ({signedPercent(s.deltaPercent)}){s.deltaSharePoints !== null && ` · ${signed(s.deltaSharePoints)} p.p.`}
                    </span>
                  ) : (
                    <span className="text-slate-500">{CONTEST_COMPARABILITY_LABEL[s.comparability]}: sem delta direto</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {data.assetsEvolution.length > 0 && (
        <div className="rounded-lg border border-white/8 bg-card p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Bens declarados por eleição</p>
          <ul className="space-y-1.5">
            {data.assetsEvolution.map((s) => {
              const from = byId.get(s.fromCandidacyId);
              const to = byId.get(s.toCandidacyId);
              return (
                <li key={`${s.fromCandidacyId}-${s.toCandidacyId}`} className="text-xs text-slate-300">
                  {from?.contest.year} → {to?.contest.year}: {money(s.fromTotal)} → {money(s.toTotal)}{" "}
                  <span className="text-slate-400">
                    ({signedPercent(s.deltaPercent)}) · {s.added} novos, {s.removed} não declarados de novo, {s.kept} mantidos
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[10px] text-slate-600">Variação de bens declarados ao TSE não indica irregularidade.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Raio X eleitoral do perfil: todas as candidaturas oficiais da pessoa (identidade canônica), votação com estado
 * explícito (nunca zero inventado), chapa de vice/suplente, evolução, bens, contas, registros e histórico oficial.
 */
export function XrayTab({ politicianId }: { politicianId: string }) {
  const q = useQuery({ queryKey: ["xray", politicianId], queryFn: () => xrayApi.xray(politicianId), staleTime: 60_000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[] | null>(null);
  const [limitHit, setLimitHit] = useState(false);

  if (q.isLoading)
    return (
      <div aria-busy="true" className="space-y-3">
        <div className="skeleton h-4 w-2/3" aria-hidden="true" />
        <div className="skeleton h-28 rounded-lg" aria-hidden="true" />
        <output className="sr-only">Carregando Raio X</output>
      </div>
    );
  if (q.isError || !q.data)
    return (
      <p className="text-sm text-slate-400">
        Não foi possível carregar o Raio X eleitoral.{" "}
        <button type="button" onClick={() => q.refetch()} className="text-brand hover:underline">
          Tentar novamente
        </button>
      </p>
    );

  const data = q.data;
  const own = data.candidacies.filter((c) => !c.ticket && c.totals.votes !== null);
  const defaultCompare = own.slice(0, MAX_COMPARE).map((c) => c.candidacyId);
  const selection = compare ?? defaultCompare;
  const selected = data.candidacies.find((c) => c.candidacyId === (selectedId ?? own[0]?.candidacyId ?? data.candidacies[0]?.candidacyId));
  const uf = selected?.contest.unit.uf ?? data.candidacies.find((c) => c.contest.unit.uf)?.contest.unit.uf ?? "CE";

  return (
    <div className="space-y-4" data-testid="xray">
      <p className="text-xs text-slate-500">
        Candidaturas oficiais do TSE vinculadas por identificadores oficiais (CPF só como HMAC; histórico oficial de candidaturas). Nunca por nome.
        Dados eleitorais são descritivos e não alteram o Score.
      </p>
      {data.freshness.stale && <p className="text-[11px] text-amber-300/80">{data.freshness.note}</p>}
      {data.candidacies.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Nenhuma candidatura da camada eleitoral vinculada a este perfil.</p>
      ) : (
        <>
          <InsightList insights={data.insights} />
          <EvolutionList data={data} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-2" data-testid="xray-timeline">
              {data.candidacies.map((c) => (
                <CandidacyCard
                  key={c.candidacyId}
                  c={c}
                  selected={selected?.candidacyId === c.candidacyId}
                  compared={selection.includes(c.candidacyId)}
                  onSelect={() => setSelectedId(c.candidacyId)}
                  onCompare={() => {
                    const r = toggleSelection(selection, c.candidacyId);
                    setLimitHit(r.rejected);
                    setCompare(r.ids);
                  }}
                />
              ))}
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/8 bg-card px-3 py-2 text-xs">
                <span className="text-slate-400">
                  {selection.length} de {MAX_COMPARE} candidaturas para comparar
                </span>
                {limitHit && <span className="text-amber-300">Limite de {MAX_COMPARE} candidaturas.</span>}
                {selection.length > 0 && (
                  <Link
                    href={`/eleicoes/comparar?c=${serializeSelection(selection)}&uf=${uf}&nivel=municipality`}
                    className="ml-auto rounded-md border border-brand/30 bg-brand/10 px-2.5 py-1 font-medium text-brand hover:bg-brand/15"
                  >
                    Comparar evolução →
                  </Link>
                )}
              </div>
            </div>
            <div>{selected && <CandidacyDetail key={selected.candidacyId} c={selected} />}</div>
          </div>
          {data.officialHistory.length > 0 && (
            <div className="rounded-lg border border-white/8 bg-card p-3" data-testid="xray-history">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Histórico oficial de candidaturas (TSE)</p>
              <ul className="space-y-1">
                {data.officialHistory.map((h) => (
                  <li key={`${h.year}-${h.round}-${h.tseCandidateId}`} className="flex flex-wrap justify-between gap-2 text-xs">
                    <span className="text-slate-300">
                      {electionLabel(h.year, h.round)} · {displayName(h.officeName)} · {h.unitName ? displayName(h.unitName) : h.unit}
                      {h.number !== null && ` · nº ${h.number}`}
                      {h.partyAcronym && ` · ${h.partyAcronym}`}
                    </span>
                    <span className="text-slate-500">
                      {h.outcome ? displayName(h.outcome) : UNAVAILABLE} · {h.imported ? "importada" : "não importada nesta base"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-slate-600">
                Fonte: TSE, &ldquo;Histórico de candidaturas&rdquo; — vínculo oficial entre candidaturas da mesma pessoa.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
