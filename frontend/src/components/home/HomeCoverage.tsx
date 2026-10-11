"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { formatCount } from "@/lib/elections/format";
import {
  byYear,
  compactCount,
  coverageHref,
  formatDay,
  getOverview,
  listJoin,
  type CoverageElection,
  type OverviewResponse,
} from "@/lib/overview";
import { TransitionLink } from "@/motion/navigation";
import { DataState, RetryButton } from "@/components/ui/DataState";

function Arrow() {
  return (
    <svg className="mi-arrow inline-block" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function SectionTitle({ id, title, children }: Readonly<{ id: string; title: string; children?: ReactNode }>) {
  return (
    <div className="mb-6">
      <h2 id={id} className="text-xl font-bold text-fg sm:text-2xl">
        {title}
      </h2>
      {children && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">{children}</p>}
    </div>
  );
}

function Skeleton({ className }: Readonly<{ className: string }>) {
  return <div aria-hidden="true" className={`skeleton rounded-lg ${className}`} />;
}

// ─── Eleições com resultado por seção ─────────────────────────────────────────

function ElectionLine({ e }: Readonly<{ e: CoverageElection }>) {
  const where = `${formatCount(e.municipalities)} ${e.municipalities === 1 ? "município" : "municípios"}`;
  return (
    <li>
      <TransitionLink href={coverageHref(e)} className="focus-ring group block rounded-md px-2 py-1.5 -mx-2 hover:bg-fg/[0.03]">
        <span className="flex items-center gap-2 text-sm font-medium text-fg-soft group-hover:text-fg">
          {e.round}º turno · {e.stateName} <Arrow />
        </span>
        <span className="block text-xs leading-relaxed text-fg-muted">
          {listJoin(e.offices.map((o) => o.name))} · {where} · {formatCount(e.sections)} seções · {compactCount(e.eligible)} de eleitores aptos
        </span>
      </TransitionLink>
    </li>
  );
}

function Coverage({ data }: Readonly<{ data: OverviewResponse }>) {
  return (
    <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
      {byYear(data.elections).map(({ year, rounds }) => (
        <li key={year} className="grid gap-2 p-4 sm:grid-cols-[5.5rem_1fr] sm:gap-4">
          <p className="text-2xl font-bold tabular-nums text-fg">{year}</p>
          <ul className="space-y-1">
            {rounds.map((e) => (
              <ElectionLine key={`${e.year}-${e.round}-${e.uf}`} e={e} />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

// ─── Do estado à urna ─────────────────────────────────────────────────────────

function Path({ e }: Readonly<{ e: CoverageElection }>) {
  const steps = [
    { level: "Estado", value: e.stateName, note: `${compactCount(e.eligible)} de eleitores aptos em ${e.year}` },
    { level: "Municípios", value: formatCount(e.municipalities), note: "Prefeitura e Câmara Municipal; o mapa mostra cada um" },
    { level: "Zonas eleitorais", value: formatCount(e.zones), note: "Os cartórios da Justiça Eleitoral; uma zona pode atender vários municípios" },
    { level: "Seções", value: formatCount(e.sections), note: "A urna: votos de cada candidato, brancos, nulos e quem faltou" },
  ];
  return (
    <>
      <ol className="grid gap-3 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.level} className="relative rounded-lg border border-line bg-surface p-4">
            <span aria-hidden="true" className="mb-3 flex h-[22px] w-[22px] items-center justify-center rounded-full border border-accent/40 bg-canvas text-[10px] font-semibold text-accent-text">
              {i + 1}
            </span>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-muted">{s.level}</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-fg">{s.value}</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{s.note}</p>
          </li>
        ))}
      </ol>
      <TransitionLink
        href={coverageHref(e)}
        className="mi-press focus-ring mt-5 inline-flex items-center gap-2 rounded-lg bg-action px-4 py-2 text-sm font-semibold text-action-fg hover:bg-action/90"
      >
        Explorar {e.stateName} {e.year} <Arrow />
      </TransitionLink>
    </>
  );
}

// ─── Fontes ───────────────────────────────────────────────────────────────────

function Sources({ data }: Readonly<{ data: OverviewResponse }>) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
      {data.sources.map((s) => {
        const day = formatDay(s.latestDownload);
        return (
          <li key={s.kind} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <span className="text-fg-soft">
              <span className="font-semibold text-fg-muted">{s.publisher}</span> · {s.label}
            </span>
            <span className="text-xs text-fg-muted">
              {formatCount(s.files)} {s.files === 1 ? "arquivo" : "arquivos"}
              {day && ` · baixado em ${day}`}
            </span>
          </li>
        );
      })}
      <li className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <span className="text-fg-soft">
          <span className="font-semibold text-fg-muted">IBGE</span> · Malhas e nomes oficiais de municípios
        </span>
        <span className="text-xs text-fg-muted">localidades e malhas territoriais</span>
      </li>
    </ul>
  );
}

// ─── Seção da página inicial ──────────────────────────────────────────────────

/** Cobertura, caminho territorial e fontes — tudo a partir do que está importado (GET /api/v1/overview). */
export function HomeCoverage() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["overview"],
    queryFn: ({ signal }) => getOverview(signal),
    staleTime: 10 * 60_000,
  });
  const latest = data?.elections.find((e) => e.round === 1) ?? data?.elections[0];

  return (
    <>
      <section aria-labelledby="coverage-title" aria-busy={isPending} className="border-b border-line py-12">
        <div className="mx-auto max-w-5xl px-6">
          <SectionTitle id="coverage-title" title="Eleições com resultado por seção">
            Boletins de Urna oficiais já importados. Cada eleição abre no explorador, do estado até a urna.
          </SectionTitle>
          {isPending && <Skeleton className="h-64" />}
          {isError && (
            <DataState kind="error" title="Não foi possível carregar a cobertura agora." action={<RetryButton onRetry={() => refetch()} />} />
          )}
          {data?.elections.length === 0 && <DataState kind="empty" title="Nenhuma eleição importada ainda." />}
          {data && data.elections.length > 0 && <Coverage data={data} />}
        </div>
      </section>

      {latest && (
        <section aria-labelledby="path-title" className="border-b border-line py-12">
          <div className="mx-auto max-w-5xl px-6">
            <SectionTitle id="path-title" title="Do estado à urna">
              O território eleitoral tem quatro níveis. Em qualquer um deles você vê quem teve votos ali — e pode descer ou subir sem
              perder o contexto.
            </SectionTitle>
            <Path e={latest} />
          </div>
        </section>
      )}

      <section aria-labelledby="sources-title" className="border-b border-line py-12">
        <div className="mx-auto max-w-5xl px-6">
          <SectionTitle id="sources-title" title="De onde vêm os dados">
            Só bases públicas oficiais. Cada arquivo baixado guarda a data e a impressão digital (SHA-256), e cada tela diz qual base usou.
          </SectionTitle>
          {isPending && <Skeleton className="h-48" />}
          {data && <Sources data={data} />}
          {data?.updatedAt && <p className="mt-3 text-xs text-fg-muted">Última importação: {formatDay(data.updatedAt)}.</p>}
        </div>
      </section>
    </>
  );
}
