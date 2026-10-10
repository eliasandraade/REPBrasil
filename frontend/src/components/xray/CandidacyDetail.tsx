"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { displayName, formatCount, formatPercent, UNAVAILABLE } from "@/lib/elections/format";
import { buildElectionsPath } from "@/lib/elections/route";
import { CELL_STATE_LABEL, LEVEL_LABEL, money, signedPercent, xrayApi } from "@/lib/elections/xray";
import type { AssetDiffItem, TerritoryLevel, TerritoryValue, XrayCandidacy } from "@/lib/elections/xray-types";
import { InsightList } from "./InsightList";

type DetailTab = "territory" | "assets" | "finance" | "records";

const COMPLEMENT_LABELS: Record<string, string> = {
  detail_status: "Situação detalhada",
  status_in_election: "Situação no pleito",
  status_on_urn: "Situação na urna",
  inserted_in_urn: "Inserido(a) na urna",
  votes_destination: "Destinação dos votos",
  totalization_status: "Situação na totalização",
  judgment_status: "Julgamento",
  cassation_status: "Cassação",
  diploma_status: "Diploma",
  reelection: "Candidatura à reeleição",
  max_campaign_spending: "Limite de gastos de campanha",
  accounts_rendered: "Prestou contas",
  process_number: "Processo de registro",
  accepted_on: "Aceite da candidatura",
  substitute_order: "Ordem de suplência",
};

/** Chaves estáveis a partir dos dados (repetições numeradas), nunca pela posição na lista. */
function withKeys<T>(items: T[], keyOf: (item: T) => string): Array<[string, T]> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return [n === 1 ? base : `${base}#${n}`, item];
  });
}

function plain(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function sectionText(t: TerritoryValue): string {
  const extra = t.sectionMembers && t.sectionMembers.length > 1 ? ` (+${t.sectionMembers.length - 1} agregada)` : "";
  return `Zona ${t.zone} · seção ${t.section}${extra}`;
}

function territoryLabel(t: TerritoryValue, level: TerritoryLevel): string {
  if (level === "zone") return `${t.municipalityName ?? t.municipalityTseCode} · zona ${t.zone}`;
  if (level === "section") return sectionText(t);
  if (level === "place") return `${t.placeName ? displayName(t.placeName) : "Local " + t.placeCode} · zona ${t.zone}`;
  return t.municipalityName ?? t.municipalityTseCode ?? t.uf;
}

function TerritoryPanel({ c }: Readonly<{ c: XrayCandidacy }>) {
  const [level, setLevel] = useState<TerritoryLevel>("municipality");
  const [municipality, setMunicipality] = useState<string | null>(c.contest.unit.scope === "municipal" ? c.contest.unit.code : null);
  const needsMunicipality = level === "section" || level === "place";
  const q = useQuery({
    queryKey: ["xray-territory", c.candidacyId, level, municipality],
    queryFn: () => xrayApi.territory(c.candidacyId, level, { municipality }),
    enabled: !needsMunicipality || !!municipality,
    staleTime: 60_000,
  });
  const levels: TerritoryLevel[] = ["municipality", "zone", "section", "place"];
  const max = Math.max(1, ...(q.data?.territories ?? []).map((t) => t.votes ?? 0));
  return (
    <div data-testid="xray-territory">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Nível territorial</legend>
          {levels.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={level === l}
              onClick={() => setLevel(l)}
              className={`focus-ring rounded border px-2 py-1 text-[11px] ${level === l ? "border-brand bg-brand/15 text-brand" : "border-white/10 text-slate-400 hover:border-white/25"}`}
            >
              {LEVEL_LABEL[l]}
            </button>
          ))}
        </fieldset>
        {municipality && c.contest.unit.scope !== "municipal" && (
          <button type="button" onClick={() => { setMunicipality(null); setLevel("municipality"); }} className="text-[11px] text-brand hover:underline">
            Todos os municípios
          </button>
        )}
      </div>
      {needsMunicipality && !municipality && (
        <p className="text-xs text-slate-500">Escolha um município na lista por município para ver seções e locais de votação.</p>
      )}
      {q.isLoading && <div className="skeleton h-24 rounded-lg" aria-busy="true" aria-label="Carregando território" />}
      {q.isError && <p className="text-xs text-slate-400">Não foi possível carregar a distribuição territorial.</p>}
      {q.data && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Votos no recorte" value={formatCount(q.data.summary.votes)} />
            <Stat label={`${LEVEL_LABEL[level]}s com votos`} value={`${formatCount(q.data.summary.territoriesWithVotes)} / ${formatCount(q.data.summary.territoriesCovered)}`} />
            <Stat label="Concentração top 5" value={formatPercent(q.data.summary.topFiveConcentration)} />
            <Stat label="HHI" value={q.data.summary.hhi === null ? UNAVAILABLE : q.data.summary.hhi.toLocaleString("pt-BR")} />
          </div>
          <InsightList insights={q.data.insights} />
          {q.data.freshness.stale && <p className="mb-2 text-[11px] text-amber-300/80">{q.data.freshness.note}</p>}
          <ol className="max-h-[420px] space-y-1 overflow-y-auto pr-1" data-testid="xray-territory-list">
            {q.data.territories.map((t, i) => (
              <li key={`${t.municipalityTseCode}-${t.zone}-${t.section}-${t.placeCode}`} className="rounded-md border border-white/5 bg-card px-2.5 py-1.5" data-state={t.state}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-6 flex-shrink-0 text-right font-mono text-[10px] text-slate-600">{i + 1}</span>
                    {level === "municipality" && t.municipalityTseCode ? (
                      <button type="button" onClick={() => { setMunicipality(t.municipalityTseCode); setLevel("zone"); }} className="truncate text-left text-slate-200 hover:text-brand" title="Detalhar zonas, seções e locais">
                        {territoryLabel(t, level)}
                      </button>
                    ) : (
                      <span className="truncate text-slate-200">{territoryLabel(t, level)}</span>
                    )}
                  </span>
                  <span className="flex-shrink-0 text-slate-400">
                    {t.votes === null ? <span className="text-slate-500">{CELL_STATE_LABEL[t.state]}</span> : formatCount(t.votes)}
                    {t.share !== null && <span className="text-slate-600"> · {formatPercent(t.share)}</span>}
                  </span>
                </div>
                {t.votes !== null && t.votes > 0 && (
                  <div className="mt-1 h-1 rounded bg-white/5" aria-hidden="true">
                    <div className="h-1 rounded bg-brand/60" style={{ width: `${Math.max(1, (t.votes / max) * 100)}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10px] text-slate-600">
            Percentual = votos ÷ votos válidos do cargo no território. &ldquo;Zero&rdquo; só aparece com Boletim de Urna apurado; sem cobertura, fora da
            disputa ou fora da urna nunca viram zero.
          </p>
          {c.contest.unit.uf && (
            <Link
              href={`${buildElectionsPath({ year: c.contest.year, round: c.contest.round, state: c.contest.unit.uf.toLowerCase() })}?camada=intensity&candidatura=${c.candidacyId}`}
              className="mt-2 inline-block text-xs text-brand hover:underline"
            >
              Ver no mapa do explorador →
            </Link>
          )}
        </>
      )}
    </div>
  );
}

const DIFF_STYLE: Record<AssetDiffItem["status"], string> = {
  added: "bg-brand/10 text-brand",
  removed: "bg-amber-400/10 text-amber-300",
  kept: "bg-white/5 text-slate-400",
};

function diffLabel(status: AssetDiffItem["status"], year: number, compareToYear: number | null): string {
  if (status === "added") return `só em ${year}`;
  if (status === "removed") return `só em ${compareToYear}`;
  return "nas duas";
}

function AssetsPanel({ c }: Readonly<{ c: XrayCandidacy }>) {
  const q = useQuery({ queryKey: ["xray-assets", c.candidacyId], queryFn: () => xrayApi.assets(c.candidacyId), staleTime: 60_000 });
  if (q.isLoading) return <div className="skeleton h-24 rounded-lg" aria-busy="true" aria-label="Carregando bens" />;
  if (q.isError || !q.data) return <p className="text-xs text-slate-400">Não foi possível carregar os bens declarados.</p>;
  const a = q.data;
  return (
    <div data-testid="xray-assets">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label={`Total declarado (${a.year})`} value={money(a.total)} />
        {a.compareToYear !== null && <Stat label={`Total declarado (${a.compareToYear})`} value={money(a.compareToTotal)} />}
        {a.delta !== null && <Stat label="Variação" value={`${money(a.delta)} (${signedPercent(a.deltaPercent)})`} />}
      </div>
      {a.diff.length > 0 ? (
        <ul className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
          {withKeys(a.diff, (d) => `${d.status}|${d.typeCode}|${d.description}|${d.fromValue}|${d.toValue}`).map(([key, d]) => (
            <li key={key} className="flex items-start justify-between gap-2 rounded-md border border-white/5 bg-card px-2.5 py-1.5 text-xs" data-diff={d.status}>
              <span className="min-w-0">
                <span className={`mr-1.5 rounded px-1 py-px text-[9px] uppercase ${DIFF_STYLE[d.status]}`}>
                  {diffLabel(d.status, a.year, a.compareToYear)}
                </span>
                <span className="text-slate-300">{d.type ?? "Bem"}</span>
                {d.description && <span className="block truncate text-[11px] text-slate-500">{d.description}</span>}
              </span>
              <span className="flex-shrink-0 text-right text-slate-400">
                {d.fromValue !== null && <span className="block text-[10px] text-slate-600">{money(d.fromValue)}</span>}
                {d.toValue !== null && money(d.toValue)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
          {withKeys(a.items, (item) => `${item.typeCode}|${item.description}|${item.value}`).map(([key, item]) => (
            <li key={key} className="flex items-start justify-between gap-2 rounded-md border border-white/5 bg-card px-2.5 py-1.5 text-xs">
              <span className="min-w-0">
                <span className="text-slate-300">{item.type ?? "Bem"}</span>
                {item.description && <span className="block truncate text-[11px] text-slate-500">{item.description}</span>}
              </span>
              <span className="flex-shrink-0 text-slate-400">{money(item.value)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-slate-600">{a.note} Itens pareados por tipo e descrição declarados; nenhum juízo é feito.</p>
    </div>
  );
}

function FinancePanel({ c }: Readonly<{ c: XrayCandidacy }>) {
  const q = useQuery({ queryKey: ["xray-finance", c.candidacyId], queryFn: () => xrayApi.finance(c.candidacyId), staleTime: 60_000 });
  if (q.isLoading) return <div className="skeleton h-24 rounded-lg" aria-busy="true" aria-label="Carregando prestação de contas" />;
  if (q.isError || !q.data) return <p className="text-xs text-slate-400">Não foi possível carregar a prestação de contas.</p>;
  const f = q.data;
  const kinds: Record<string, string> = { revenue: "Receita", expense_contracted: "Despesa contratada", expense_paid: "Despesa paga" };
  return (
    <div data-testid="xray-finance">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Receitas" value={money(f.revenues)} />
        <Stat label="Despesas contratadas" value={money(f.expensesContracted)} />
        <Stat label="Despesas pagas" value={money(f.expensesPaid)} />
      </div>
      {f.categories.length > 0 && (
        <ul className="mb-3 space-y-1">
          {f.categories.slice(0, 12).map((cat) => (
            <li key={`${cat.kind}-${cat.category}`} className="flex justify-between gap-2 text-xs">
              <span className="truncate text-slate-300">
                <span className="text-slate-600">{kinds[cat.kind] ?? cat.kind} · </span>
                {cat.category}
              </span>
              <span className="flex-shrink-0 text-slate-400">{money(cat.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {[{ title: "Maiores doadores", rows: f.topDonors }, { title: "Maiores fornecedores", rows: f.topSuppliers }].map(
        (block) =>
          block.rows.length > 0 && (
            <div key={block.title} className="mb-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{block.title}</p>
              <ul className="space-y-1">
                {withKeys(block.rows, (r) => `${r.kind}|${r.name}|${r.cnpj}|${r.amount}`).map(([key, r]) => (
                  <li key={key} className="flex justify-between gap-2 text-xs">
                    <span className="truncate text-slate-300">
                      {r.name ? displayName(r.name) : "Não identificado"}
                      {r.cnpj && <span className="ml-1 font-mono text-[10px] text-slate-600">CNPJ {r.cnpj}</span>}
                      {r.counterpartyKind === "person" && <span className="ml-1 text-[10px] text-slate-600">pessoa física</span>}
                    </span>
                    <span className="flex-shrink-0 text-slate-400">{money(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
      <p className="text-[10px] text-slate-600">{f.note}</p>
    </div>
  );
}

function RecordsPanel({ c }: Readonly<{ c: XrayCandidacy }>) {
  const complement = c.records.complement;
  return (
    <div data-testid="xray-records" className="space-y-3">
      {c.records.socialNetworks.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Redes sociais declaradas ao TSE</p>
          <ul className="space-y-0.5">
            {c.records.socialNetworks.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-xs text-brand hover:underline">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Nenhuma rede social declarada (ou arquivo oficial não importado).</p>
      )}
      {complement ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {Object.entries(COMPLEMENT_LABELS).map(([key, label]) =>
            complement[key] === null || complement[key] === undefined ? null : (
              <div key={key} className="flex justify-between gap-2 border-b border-white/5 py-0.5 text-xs">
                <dt className="text-slate-500">{label}</dt>
                <dd className="text-right text-slate-300">
                  {key === "max_campaign_spending" ? money(Number(complement[key])) : plain(complement[key])}
                </dd>
              </div>
            ),
          )}
        </dl>
      ) : (
        <p className="text-xs text-slate-500">Informações complementares do TSE não importadas para esta candidatura.</p>
      )}
      <div data-testid="xray-official-documents" className="rounded-md border border-white/8 p-2.5 text-xs text-slate-400">
        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Propostas de governo e certidões</p>
        Publicadas pelo TSE na página da candidatura no{" "}
        <a href="https://divulgacandcontas.tse.jus.br/" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
          DivulgaCandContas
        </a>{" "}
        (busque por {c.contest.year}, {c.contest.unit.name}, {displayName(c.contest.officeName)}, nº {c.number}). O REP Brasil ainda não importa
        esses documentos.
      </div>
      <p className="text-[10px] text-slate-600">
        Fonte: TSE, Candidatos — informações complementares e redes sociais. Dados pessoais sensíveis (cor/raça, etnia, naturalidade, idade) não
        são gravados; links de contato pessoal são descartados.
      </p>
    </div>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg border border-white/8 bg-card p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{label}</p>
      <p className="truncate text-sm font-bold text-slate-100">{value}</p>
    </div>
  );
}

/** Detalhe de uma candidatura no Raio X: território, bens, contas e registros oficiais. */
export function CandidacyDetail({ c }: Readonly<{ c: XrayCandidacy }>) {
  const [tab, setTab] = useState<DetailTab>("territory");
  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: "territory", label: "Território" },
    { id: "assets", label: "Bens" },
    { id: "finance", label: "Contas de campanha" },
    { id: "records", label: "Registros" },
  ];
  return (
    <section className="rounded-lg border border-brand/20 bg-card-elevated/40 p-4" aria-label="Detalhe da candidatura" data-testid="xray-detail">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
        {c.contest.year} · {c.contest.round}º turno · {displayName(c.contest.officeName)} · {c.contest.unit.name}
      </p>
      <h3 className="mb-3 text-base font-bold text-slate-100">{displayName(c.ballotName)}</h3>
      <div role="tablist" aria-label="Detalhe da candidatura" className="mb-3 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`focus-ring rounded-md px-2.5 py-1 text-xs ${tab === t.id ? "bg-brand/15 text-brand" : "text-slate-400 hover:text-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "territory" && <TerritoryPanel c={c} />}
      {tab === "assets" && <AssetsPanel c={c} />}
      {tab === "finance" && <FinancePanel c={c} />}
      {tab === "records" && <RecordsPanel c={c} />}
    </section>
  );
}
