"use client";

import Link from "next/link";
import { useState } from "react";
import { displayName, formatCount, formatPercent, pad3, sectionLabel, shortHash, sourceDate, zoneLabel, UNAVAILABLE } from "@/lib/elections/format";
import { buildElectionsPath, type ExplorerRoute } from "@/lib/elections/route";
import type { Metrics, SectionResultsResponse, VoteItem } from "@/lib/elections/types";

export type VoteTypeFilter = "todos" | "nominal" | "legenda" | "branco" | "nulo";

const VOTE_TYPES: { value: VoteTypeFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "nominal", label: "Nominal" },
  { value: "legenda", label: "Legenda" },
  { value: "branco", label: "Branco" },
  { value: "nulo", label: "Nulo" },
];

const METRIC_HELP: Record<keyof Metrics, string> = {
  eligible: "Eleitores aptos da urna (principal + agregadas).",
  turnout: "Eleitores que compareceram.",
  abstentions: "Aptos que não compareceram.",
  valid: "Votos nominais + votos de legenda (Lei 9.504/97, art. 5º).",
  blank: "Votos em branco. — quando a fonte não permite confirmar o zero.",
  null: "Votos nulos. — quando a fonte não permite confirmar o zero.",
};

function Metric({ label, value, help }: { label: string; value: number | null; help: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-card-elevated/50 p-3" title={help}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{label}</p>
      <p className="text-lg font-bold text-slate-100" aria-label={value === null ? `${label}: não informado pela fonte` : undefined}>
        {formatCount(value)}
      </p>
    </div>
  );
}

function VoteRow({ v }: { v: VoteItem }) {
  const name = v.voteType === "branco" || v.voteType === "nulo" ? v.votable.name ?? v.voteType : displayName(v.votable.name);
  return (
    <li className="rounded-lg border border-white/8 bg-card-elevated/40 px-3 py-2" data-vote={v.votable.number} data-vote-type={v.voteType}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-200">
            <span className="mr-1.5 font-mono text-xs text-slate-500">{v.votable.number}</span>
            {v.candidacy?.politicianId && v.profileAvailable ? (
              <Link
                href={`/politico/${v.candidacy.politicianId}?aba=eleicoes`}
                className="font-medium text-slate-100 underline-offset-2 hover:text-brand hover:underline"
                data-testid="candidate-profile-link"
              >
                {name}
              </Link>
            ) : (
              <span className="font-medium">{name}</span>
            )}
          </p>
          <p className="text-[11px] text-slate-500">
            {v.voteType === "nominal" ? "Nominal" : v.voteType === "legenda" ? "Legenda" : v.voteType === "branco" ? "Branco" : v.voteType === "nulo" ? "Nulo" : v.voteTypeSource.description}
            {v.party?.acronym ? ` · ${v.party.acronym}` : ""}
            {v.voteType === "nominal" && !v.profileAvailable && <span data-testid="no-profile"> · perfil não vinculado</span>}
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-semibold text-slate-100">{formatCount(v.votes)}</p>
          <p className="text-[11px] text-slate-500">{v.percentage === null ? "" : formatPercent(v.percentage)}</p>
        </div>
      </div>
      {v.percentage !== null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
          <div className="h-full rounded-full bg-slate-400/60" style={{ width: `${Math.min(100, v.percentage)}%` }} />
        </div>
      )}
    </li>
  );
}

/**
 * Resultado oficial de uma seção (urna × cargo). Seção agregada não tem votos
 * próprios: aponta para a urna principal. `—` nunca é zero; nenhum voto,
 * percentual ou candidato é inventado; o vínculo com o perfil é opcional.
 */
export function SectionResults({
  route,
  municipalityName,
  data,
  status,
  isAggregatedInCadaster,
  principalNumber,
  voteType,
  onOffice,
  onVoteType,
  closeHref,
  onRetry,
}: {
  route: ExplorerRoute;
  municipalityName: string;
  data: SectionResultsResponse | null;
  status: "loading" | "error" | "ready";
  isAggregatedInCadaster: boolean;
  principalNumber: number;
  voteType: VoteTypeFilter;
  onOffice: (code: number) => void;
  onVoteType: (v: VoteTypeFilter) => void;
  closeHref: string;
  onRetry: () => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const section = route.section!;
  const header = (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          {zoneLabel(route.zone!)} · {municipalityName}
        </p>
        <h2 className="text-lg font-bold text-slate-100">{sectionLabel(section)}</h2>
      </div>
      <Link href={closeHref} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400 hover:border-white/25 hover:text-slate-200" aria-label="Fechar resultado da seção">
        Fechar
      </Link>
    </div>
  );

  if (isAggregatedInCadaster) {
    return (
      <section aria-label="Resultados da seção" data-testid="section-results" data-aggregated="true">
        {header}
        <div className="rounded-lg border border-white/10 bg-card-elevated/50 p-4 text-sm text-slate-300">
          <p className="mb-1 font-medium text-slate-100">Seção agregada</p>
          <p className="mb-3 text-slate-400">
            Os eleitores da {sectionLabel(section)} votaram na urna da seção principal {pad3(principalNumber)}. A seção agregada não
            tem votos próprios — o resultado é o da urna principal (nunca somado em duplicidade).
          </p>
          <Link
            href={buildElectionsPath({ ...route, section: principalNumber })}
            className="inline-flex rounded-lg border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/15"
            aria-label={`Ver seção principal ${pad3(principalNumber)}`}
          >
            Ver seção principal {pad3(principalNumber)} →
          </Link>
        </div>
      </section>
    );
  }

  if (status === "loading") {
    return (
      <section aria-label="Resultados da seção" data-testid="section-results" aria-busy="true">
        {header}
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-card-elevated" />
          ))}
        </div>
      </section>
    );
  }

  if (status === "error" || !data) {
    return (
      <section aria-label="Resultados da seção" data-testid="section-results" data-status="error">
        {header}
        <div className="rounded-lg border border-white/10 bg-card-elevated/50 p-4 text-sm">
          <p className="font-medium text-slate-200">Não foi possível carregar o resultado.</p>
          <p className="mb-3 text-slate-500">Falha de comunicação não significa zero votos: nenhum número é exibido.</p>
          <button type="button" onClick={onRetry} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:border-white/30">
            Tentar novamente
          </button>
        </div>
      </section>
    );
  }

  if (data.status !== "available") {
    return (
      <section aria-label="Resultados da seção" data-testid="section-results" data-status={data.status}>
        {header}
        <div className="rounded-lg border border-white/10 bg-card-elevated/50 p-4 text-sm text-slate-400">
          {data.status === "not_ingested"
            ? "O Boletim de Urna desta zona ainda não foi importado. Sem resultado não há números — nem zero."
            : "O cadastro eleitoral deste município ainda não foi importado."}
        </div>
      </section>
    );
  }

  const m = data.metrics!;
  const votes = data.votes ?? [];
  const p = data.provenance!;
  return (
    <section aria-label="Resultados da seção" data-testid="section-results" data-status="available">
      {header}

      {(data.aggregatedSections?.length ?? 0) > 0 && (
        <p className="mb-3 text-[11px] text-slate-500">
          Urna com seções agregadas: {data.aggregatedSections!.map(pad3).join(", ")} (aptos e votos já incluídos).
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Cargo">
        {(data.availableOffices ?? []).map((o) => {
          const active = o.code === data.selectedOffice?.code;
          return (
            <button
              key={o.code}
              type="button"
              role="tab"
              aria-selected={active}
              data-office={o.code}
              onClick={() => onOffice(o.code)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                active ? "border-brand bg-brand/10 text-brand" : "border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200"
              }`}
            >
              {o.name ?? `Cargo ${o.code}`}
            </button>
          );
        })}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2" data-testid="metrics">
        <Metric label="Aptos" value={m.eligible} help={METRIC_HELP.eligible} />
        <Metric label="Comparecimento" value={m.turnout} help={METRIC_HELP.turnout} />
        <Metric label="Abstenções" value={m.abstentions} help={METRIC_HELP.abstentions} />
        <Metric label="Válidos" value={m.valid} help={METRIC_HELP.valid} />
        <Metric label="Brancos" value={m.blank} help={METRIC_HELP.blank} />
        <Metric label="Nulos" value={m.null} help={METRIC_HELP.null} />
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Tipo de voto">
        {VOTE_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={voteType === t.value}
            data-vote-filter={t.value}
            onClick={() => onVoteType(t.value)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
              voteType === t.value ? "border-white/30 bg-white/10 text-slate-100" : "border-white/10 text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="mb-2 text-[11px] text-slate-500">Percentual sobre os votos válidos da urna no cargo; brancos e nulos não recebem percentual.</p>
      {votes.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Nenhum voto deste tipo nesta urna.</p>
      ) : (
        <ul className="space-y-1.5" data-testid="vote-list">
          {votes.map((v) => (
            <VoteRow key={`${v.voteType}-${v.votable.number}`} v={v} />
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-lg border border-white/8 bg-card/60 px-3 py-2 text-[11px] text-slate-500" data-testid="source-badge">
        <div className="flex items-center justify-between gap-2">
          <span>
            Fonte: <span className="text-slate-300">Tribunal Superior Eleitoral</span> · Boletim de Urna (Dados Abertos)
          </span>
          <button type="button" onClick={() => setShowSource((s) => !s)} className="text-brand underline-offset-2 hover:underline" aria-expanded={showSource}>
            {showSource ? "ocultar" : "proveniência"}
          </button>
        </div>
        {showSource && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>Recurso</dt>
            <dd className="text-slate-300">{p.resourceName}</dd>
            <dt>Arquivo</dt>
            <dd>
              <a href={p.url} className="break-all text-slate-300 hover:text-brand" rel="noopener noreferrer" target="_blank">
                {p.url}
              </a>
            </dd>
            <dt>SHA-256 ZIP</dt>
            <dd className="font-mono text-slate-300" title={p.sourceFileSha256}>{shortHash(p.sourceFileSha256)}</dd>
            <dt>Checksum oficial</dt>
            <dd className="text-slate-300">{p.officialChecksum.verified ? `${p.officialChecksum.algorithm} conferido` : UNAVAILABLE}</dd>
            <dt>Gerado pelo TSE</dt>
            <dd className="text-slate-300">{sourceDate(p.sourceGeneratedAt) ?? UNAVAILABLE}</dd>
            <dt>Lote</dt>
            <dd className="font-mono text-slate-300">{p.importBatchId}</dd>
            <dt>Urna</dt>
            <dd className="text-slate-300">
              {data.urn?.number ?? UNAVAILABLE}
              {data.urn?.type ? ` · ${data.urn.type}` : ""}
            </dd>
          </dl>
        )}
      </div>
    </section>
  );
}
