"use client";

import type { CSSProperties } from "react";
import { displayName, formatCount, outcomeLabel } from "@/lib/elections/format";
import { CELL_STATE_LABEL, electionLabel, money } from "@/lib/elections/xray";
import type { XrayCandidacy, XrayResponse } from "@/lib/elections/xray-types";
import { ufName } from "@/lib/site";
import type { PoliticianDetail } from "@/lib/types";
import { initialsOf } from "@/motion/identity";
import { Badge } from "@/components/xray/XrayTimeline";
import { byRecency, latestCandidacy } from "@/components/xray/useXray";

/** Estado de cada consulta: "pending" e "error" nunca viram "não encontrado". */
export type LoadState = "pending" | "error" | "ready";

/** Nomes das peças de identidade compartilhadas com a busca e com o resultado eleitoral. */
export const IDENTITY_VT = {
  avatar: { viewTransitionName: "vt-avatar" } as CSSProperties,
  name: { viewTransitionName: "vt-name" } as CSSProperties,
};

export function InitialAvatar({ name }: Readonly<{ name: string }>) {
  return (
    <div
      style={IDENTITY_VT.avatar}
      className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-xl font-black text-brand"
    >
      {initialsOf(name)}
    </div>
  );
}

/** Corpo do cartão por estado: consultar, falhar e não encontrar são afirmações diferentes. */
function FactValue({ state, value, sub, absent }: Readonly<{ state: LoadState; value: string | null; sub?: string; absent: string }>) {
  if (state === "pending")
    return (
      <>
        <div className="skeleton my-1 h-5 w-16" aria-hidden="true" />
        <p className="mt-0.5 text-xs text-slate-600">consultando…</p>
      </>
    );
  if (state === "error")
    return (
      <>
        <p className="truncate text-lg font-bold text-slate-500">—</p>
        <p className="mt-0.5 text-xs text-slate-600">indisponível no momento</p>
      </>
    );
  if (value === null)
    return (
      <>
        <p className="truncate text-lg font-bold text-slate-500">—</p>
        <p className="mt-0.5 text-xs text-slate-600">{absent}</p>
      </>
    );
  return (
    <>
      {/* número nunca cortado: quebra e encolhe no celular */}
      <p className="value-arrive break-words text-base font-bold leading-tight text-slate-100 sm:text-lg">{value}</p>
      {sub && <p className="mt-0.5 text-xs leading-snug text-slate-600">{sub}</p>}
    </>
  );
}

export function Fact({ label, ...rest }: Readonly<{ label: string; state: LoadState; value: string | null; sub?: string; absent: string }>) {
  return (
    <div className="profile-fact min-w-0" aria-busy={rest.state === "pending"}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{label}</p>
      <FactValue {...rest} />
    </div>
  );
}

/** "45.000" · estado explícito sem contagem · votos da chapa para vice/suplente. */
function votesFact(c: XrayCandidacy | undefined): { value: string | null; sub?: string } {
  if (!c) return { value: null };
  // o cargo já está no cabeçalho: aqui, a posição e a eleição (cabe no cartão do celular)
  const when = electionLabel(c.contest.year, c.contest.round);
  if (c.ticket) return { value: c.ticket.headVotes === null ? null : formatCount(c.ticket.headVotes), sub: `votos da chapa · ${when}` };
  const t = c.totals;
  if (t.votes === null) return { value: CELL_STATE_LABEL[t.state], sub: when };
  if (t.rank === null) return { value: formatCount(t.votes), sub: when };
  const of = t.candidatesWithVotes === null ? "" : ` de ${formatCount(t.candidatesWithVotes)}`;
  return { value: formatCount(t.votes), sub: `${t.rank}º${of} · ${when}` };
}

/**
 * Identidade eleitoral: quem é a pessoa nas urnas, pela candidatura oficial mais recente (cargo, lugar, eleição,
 * partido e resultado). O cadastro antigo (cargo/partido avulsos) só aparece quando não há candidatura na camada eleitoral.
 */
export function ProfileHeader({
  politician,
  xray,
  xrayState,
}: Readonly<{ politician: PoliticianDetail; xray: XrayResponse | undefined; xrayState: LoadState }>) {
  const latest = latestCandidacy(xray);
  const candidacies = xray ? byRecency(xray.candidacies) : [];
  const withOutcome = candidacies.filter((c) => c.elected !== null && !c.ticket);
  const elected = withOutcome.filter((c) => c.elected).length;
  const years = [...new Set(candidacies.map((c) => c.contest.year))].sort((a, b) => a - b);
  const withAssets = candidacies.find((c) => c.assets);
  const withFinance = candidacies.find((c) => c.finance && c.finance.revenues !== null);
  const legacy = xrayState === "ready" && candidacies.length === 0;
  const votes = votesFact(latest);
  const ballot = displayName(politician.ballotName || politician.name);
  const civil = displayName(politician.name);

  return (
    <div className="profile-document">
      <div className="flex items-start gap-4">
        <InitialAvatar name={politician.ballotName || politician.name} />
        <div className="min-w-0 flex-1">
          <h1 style={IDENTITY_VT.name} className="text-2xl font-bold leading-tight text-slate-100">
            {ballot}
          </h1>
          {civil !== ballot && <p className="mt-0.5 text-sm text-slate-400">{civil}</p>}

          {latest && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-300" data-testid="profile-current">
              <span>
                {displayName(latest.contest.officeName)} · {displayName(latest.contest.unit.name)} · Eleições{" "}
                {electionLabel(latest.contest.year, latest.contest.round)}
              </span>
              {latest.party?.acronym && <Badge>{latest.party.acronym}</Badge>}
              {latest.roundOutcome && <Badge tone="muted">{outcomeLabel(latest.roundOutcome)}</Badge>}
            </div>
          )}
          {!latest && xrayState === "pending" && politician.latestCandidacy && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-300" data-testid="profile-current">
              <span>
                {politician.latestCandidacy.officeName}
                {politician.latestCandidacy.unitName ? ` · ${displayName(politician.latestCandidacy.unitName)}` : ""} · Eleições{" "}
                {electionLabel(politician.latestCandidacy.year, politician.latestCandidacy.round)}
              </span>
              {politician.latestCandidacy.party && <Badge>{politician.latestCandidacy.party}</Badge>}
              {politician.latestCandidacy.outcome && (
                <Badge tone="muted">{outcomeLabel(politician.latestCandidacy.outcome)}</Badge>
              )}
            </div>
          )}
          {!latest && xrayState === "pending" && !politician.latestCandidacy && (
            <div className="skeleton mt-2 h-5 w-64 max-w-full" aria-hidden="true" />
          )}
          {legacy && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400" data-testid="profile-legacy">
              {[politician.office ? displayName(politician.office) : null, politician.partyAcronym, ufName(politician.state)]
                .filter(Boolean)
                .map((chip) => (
                  <span key={chip} className="rounded border border-white/10 bg-white/5 px-2 py-0.5">
                    {chip}
                  </span>
                ))}
              <span className="text-slate-600">cadastro anterior, sem candidatura na camada eleitoral</span>
            </div>
          )}
          {years.length > 0 && (
            <p className="mt-1.5 text-xs text-slate-500">
              {candidacies.length} {candidacies.length === 1 ? "candidatura" : "candidaturas"} na base ·{" "}
              {years.length === 1 ? years[0] : `${years[0]}–${years.at(-1)}`}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="profile-facts">
        <Fact label="Votação mais recente" state={xrayState} value={votes.value} sub={votes.sub} absent="sem votação importada" />
        <Fact
          label="Eleito(a)"
          state={xrayState}
          value={withOutcome.length > 0 ? `${elected} de ${withOutcome.length}` : null}
          sub="candidaturas com resultado"
          absent="sem resultado oficial"
        />
        <Fact
          label="Bens declarados"
          state={xrayState}
          value={withAssets?.assets ? money(withAssets.assets.total) : null}
          sub={withAssets ? `em ${withAssets.contest.year} · ${withAssets.assets?.items} itens` : undefined}
          absent="não declarados"
        />
        <Fact
          label="Receitas de campanha"
          state={xrayState}
          value={withFinance?.finance ? money(withFinance.finance.revenues) : null}
          sub={withFinance ? `em ${withFinance.contest.year}` : undefined}
          absent="sem prestação importada"
        />
      </div>
    </div>
  );
}
