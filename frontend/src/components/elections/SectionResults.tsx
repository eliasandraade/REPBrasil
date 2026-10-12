"use client";

import Link from "next/link";
import { displayName, formatCount, formatPercent, pad3, sectionLabel, shortHash, sourceDate, zoneLabel, UNAVAILABLE } from "@/lib/elections/format";
import { buildElectionsPath, type ExplorerRoute } from "@/lib/elections/route";
import type { Metrics, SectionResultsResponse, VoteItem } from "@/lib/elections/types";
import { rememberIdentity } from "@/motion/identity";
import { SourceBadge } from "@/components/ui/SourceBadge";
import { Term } from "@/components/ui/Term";
import type { GlossaryId } from "@/lib/glossary";
import { TransitionLink } from "@/motion/navigation";

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

function Metric({ label, value, help, term }: Readonly<{ label: string; value: number | null; help: string; term?: GlossaryId }>) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-card-elevated/50 p-3" title={term ? undefined : help}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{term ? <Term id={term}>{label}</Term> : label}</p>
      <p className="value-arrive text-lg font-bold text-slate-100" aria-label={value === null ? `${label}: não informado pela fonte` : undefined}>
        {formatCount(value)}
      </p>
    </div>
  );
}

function VoteRow({ v }: { v: VoteItem }) {
  const name = v.voteType === "branco" || v.voteType === "nulo" ? v.votable.name ?? v.voteType : displayName(v.votable.name);
  return (
    <li className="rounded-lg border border-white/[0.08] bg-card-elevated/40 px-3 py-2" data-vote={v.votable.number} data-vote-type={v.voteType}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-200">
            <span className="mr-1.5 font-mono text-xs text-slate-500">{v.votable.number}</span>
            {v.candidacy?.politicianId && v.profileAvailable ? (
              // Do voto à pessoa: o nome é o elemento compartilhado com o cabeçalho do perfil.
              <TransitionLink
                href={`/politicos/${v.candidacy.politicianId}?aba=eleicoes`}
                direction="deeper"
                shareIdentity
                data-vt="name"
                onClick={() => rememberIdentity(v.candidacy?.politicianId, name)}
                className="mi-underline focus-ring rounded font-medium text-slate-100 hover:text-brand"
                data-testid="candidate-profile-link"
              >
                {name}
              </TransitionLink>
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
    // Mesma geometria do resultado real. Rótulos fixos (não são dado), valores
    // ausentes: nada da seção anterior e nenhum número provisório aparece aqui.
    return (
      <section aria-label="Resultados da seção" data-testid="section-results" aria-busy="true">
        {header}
        <div className="mb-3 flex gap-1.5" aria-hidden="true">
          {[72, 88, 64, 112, 120].map((w, i) => (
            <div key={i} className="skeleton h-[26px] rounded-md" style={{ width: w }} />
          ))}
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2" aria-hidden="true">
          {["Aptos", "Comparecimento", "Abstenções", "Válidos", "Brancos", "Nulos"].map((label) => (
            <div key={label} className="rounded-lg border border-white/[0.08] bg-card-elevated/50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{label}</p>
              <div className="skeleton mt-1.5 h-5 w-12" />
            </div>
          ))}
        </div>
        <ul className="space-y-1.5" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="rounded-lg border border-white/[0.08] bg-card-elevated/40 px-3 py-2">
              <div className="skeleton mb-1.5 h-4 w-2/5" />
              <div className="skeleton h-3 w-1/4" />
            </li>
          ))}
        </ul>
        <output className="sr-only">Carregando resultado da {sectionLabel(section)}</output>
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
          Urna com <Term id="secao-agregada">seções agregadas</Term>: {data.aggregatedSections!.map(pad3).join(", ")} (aptos e votos já incluídos).
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
              className={`focus-ring rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-[var(--motion-acknowledge)] ${
                active ? "border-brand bg-brand/10 text-brand" : "border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200"
              }`}
            >
              {o.name ?? `Cargo ${o.code}`}
            </button>
          );
        })}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2" data-testid="metrics">
        <Metric label="Aptos" value={m.eligible} help={METRIC_HELP.eligible} term="aptos" />
        <Metric label="Comparecimento" value={m.turnout} help={METRIC_HELP.turnout} />
        <Metric label="Abstenções" value={m.abstentions} help={METRIC_HELP.abstentions} term="abstencao" />
        <Metric label="Válidos" value={m.valid} help={METRIC_HELP.valid} term="votos-validos" />
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
            className={`focus-ring rounded-full border px-2.5 py-0.5 text-[11px] transition-colors duration-[var(--motion-acknowledge)] ${
              voteType === t.value ? "border-white/30 bg-white/10 text-slate-100" : "border-white/10 text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="mb-2 text-[11px] text-slate-500">
        Percentual sobre os <Term id="votos-validos">votos válidos</Term> da urna no cargo; brancos e nulos não recebem percentual.
      </p>
      {votes.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Nenhum voto deste tipo nesta urna.</p>
      ) : (
        <ul className="list-arrive space-y-1.5" data-testid="vote-list" key={`${section}|${data.selectedOffice?.code}|${voteType}`}>
          {votes.map((v) => (
            <VoteRow key={`${v.voteType}-${v.votable.number}`} v={v} />
          ))}
        </ul>
      )}

      <div className="mt-4">
        <SourceBadge
          testId="source-badge"
          publisher="Tribunal Superior Eleitoral"
          dataset="Boletim de Urna (Dados Abertos)"
          details={[
            { label: "Recurso", value: p.resourceName },
            { label: "Arquivo", value: p.url, href: p.url },
            { label: "SHA-256 ZIP", value: shortHash(p.sourceFileSha256), title: p.sourceFileSha256, mono: true },
            { label: "Checksum oficial", value: p.officialChecksum.verified ? `${p.officialChecksum.algorithm} conferido` : UNAVAILABLE },
            { label: "Gerado pelo TSE", value: sourceDate(p.sourceGeneratedAt) ?? UNAVAILABLE },
            { label: "Lote", value: p.importBatchId, mono: true },
            { label: "Urna", value: `${data.urn?.number ?? UNAVAILABLE}${data.urn?.type ? ` · ${data.urn.type}` : ""}` },
          ]}
        />
      </div>
    </section>
  );
}
