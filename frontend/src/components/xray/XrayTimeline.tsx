"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { displayName, formatCount, formatPercent, outcomeLabel, UNAVAILABLE } from "@/lib/elections/format";
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
} from "@/lib/elections/xray";
import type { XrayCandidacy, XrayResponse } from "@/lib/elections/xray-types";
import { DataState } from "@/components/ui/DataState";
import { SourceBadge } from "@/components/ui/SourceBadge";
import { Term } from "@/components/ui/Term";
import { outcomeTerm } from "@/lib/glossary";
import { byRecency } from "./useXray";

const ROLE_LABEL = { vice: "Vice", first_substitute: "1º suplente", second_substitute: "2º suplente" } as const;

const BADGE_TONES = {
  brand: "border-brand/30 bg-brand/10 text-brand",
  warn: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  muted: "border-white/10 bg-white/5 text-slate-400",
} as const;

export function Badge({ children, tone = "muted" }: Readonly<{ children: ReactNode; tone?: keyof typeof BADGE_TONES }>) {
  const cls = BADGE_TONES[tone];
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

export function TotalsLine({ c }: Readonly<{ c: XrayCandidacy }>) {
  const t = c.totals;
  if (c.ticket) {
    return (
      <p className="text-xs text-slate-400" data-testid="xray-ticket">
        <Term id="chapa">{ROLE_LABEL[c.ticket.role]}</Term> · {c.ticket.note}
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
        <p className="text-[10px] uppercase tracking-wider text-slate-600">
          % dos <Term id="votos-validos">válidos</Term>
        </p>
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

export function CandidacyCard({
  c,
  compared,
  onOpen,
  onCompare,
}: Readonly<{
  c: XrayCandidacy;
  /** Undefined: o cartão não oferece comparação (ex.: visão geral). */
  compared?: boolean;
  onOpen?: () => void;
  onCompare?: () => void;
}>) {
  return (
    <article
      className="rounded-lg border border-white/8 bg-card-elevated/40 p-4"
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
          {c.roundOutcome && (
            <Badge tone={c.elected ? "brand" : "muted"}>
              {outcomeTerm(c.roundOutcome) ? <Term id={outcomeTerm(c.roundOutcome)!}>{outcomeLabel(c.roundOutcome)}</Term> : outcomeLabel(c.roundOutcome)}
            </Badge>
          )}
          {c.candidacyStatus && <Badge>{outcomeLabel(c.candidacyStatus)}</Badge>}
          {c.identityStatus === "resolved_tse_link" && <Badge>vínculo oficial TSE</Badge>}
        </div>
      </div>
      <TotalsLine c={c} />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        {c.assets && <span>Bens declarados: {money(c.assets.total)} ({c.assets.items} itens)</span>}
        {c.finance && <span>Receitas: {money(c.finance.revenues)} · Despesas: {money(c.finance.expensesContracted)}</span>}
        <span className="flex-1" />
        {onOpen && (
          <button type="button" onClick={onOpen} className="focus-ring rounded text-brand hover:underline">
            Território, bens e contas →
          </button>
        )}
        {!c.ticket && compared !== undefined && onCompare && (
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={compared} onChange={onCompare} className="accent-[#0dd48e]" />
            <span>comparar</span>
          </label>
        )}
      </div>
      <div className="mt-2">
        <SourceBadge
          publisher="TSE"
          dataset="Candidaturas (Dados Abertos)"
          details={[
            { label: "Candidatura (SQ)", value: String(c.tseCandidateId), mono: true },
            { label: "Arquivo", value: `${c.source.member}, linha ${c.source.line}` },
            { label: "Pacote oficial", value: c.source.url, href: c.source.url },
            { label: "SHA-256 ZIP", value: `${c.source.zipSha256.slice(0, 12)}…`, title: c.source.zipSha256, mono: true },
          ]}
        />
      </div>
    </article>
  );
}

export function EvolutionList({ data }: Readonly<{ data: XrayResponse }>) {
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
 * Histórico eleitoral do perfil: todas as candidaturas oficiais da pessoa (identidade canônica), da mais recente à
 * mais antiga, com votação em estado explícito (nunca zero inventado), chapa de vice/suplente, seleção para comparar
 * (até 5) e o histórico oficial do TSE.
 */
export function XrayTimeline({ data, onOpen }: Readonly<{ data: XrayResponse; onOpen: (candidacyId: string) => void }>) {
  const [compare, setCompare] = useState<string[] | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const candidacies = useMemo(() => byRecency(data.candidacies), [data]);
  const own = candidacies.filter((c) => !c.ticket && c.totals.votes !== null);
  const selection = compare ?? own.slice(0, MAX_COMPARE).map((c) => c.candidacyId);
  const uf = own[0]?.contest.unit.uf ?? candidacies.find((c) => c.contest.unit.uf)?.contest.unit.uf ?? "CE";

  return (
    <div className="space-y-4" data-testid="xray">
      <p className="text-xs text-slate-500">
        Candidaturas oficiais do TSE ligadas por identificadores oficiais (CPF só como HMAC; histórico oficial de candidaturas) — nunca por nome.
      </p>
      {data.freshness.stale && <DataState kind="processing">{data.freshness.note}</DataState>}
      <div className="space-y-2" data-testid="xray-timeline">
        {candidacies.map((c) => (
          <CandidacyCard
            key={c.candidacyId}
            c={c}
            compared={selection.includes(c.candidacyId)}
            onOpen={() => onOpen(c.candidacyId)}
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
                  {outcomeLabel(h.outcome)} · {h.imported ? "importada" : "não importada nesta base"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-slate-600">
            Fonte: TSE, &ldquo;Histórico de candidaturas&rdquo; — vínculo oficial entre candidaturas da mesma pessoa.
          </p>
        </div>
      )}
    </div>
  );
}
