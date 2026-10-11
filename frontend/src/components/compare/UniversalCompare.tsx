"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { ExportActions } from "@/components/export/ExportActions";
import { getIndicatorValues, getIndicators, type Indicator, type IndicatorValue } from "@/lib/data-intelligence";
import { electionsApi } from "@/lib/elections/api";
import type { ElectionItem, MunicipalityItem, StateItem } from "@/lib/elections/types";
import type { ExportReport, ReportValue } from "@/lib/export/report";
import { defaultPick, partiesApi, resultFor, type PartiesResponse, type PartyResult, type PartySummary } from "@/lib/parties";

const MAX_ITEMS = 5;
const DEFAULT_UF = "CE";

type CompareKind = "candidatura" | "partido" | "municipio" | "eleicao";

interface DeterministicInsight {
  code: string;
  version: "v1";
  title: string;
  text: string;
}

const KIND_LABEL: Record<CompareKind, string> = {
  candidatura: "Candidaturas",
  partido: "Partidos",
  municipio: "Municípios",
  eleicao: "Eleições",
};

function split(value: string | null): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))].slice(0, MAX_ITEMS);
}

function format(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function currentUrl(): string {
  return typeof window === "undefined" ? "" : window.location.href;
}

function leader<T>(items: T[], value: (item: T) => number | null | undefined): { items: T[]; value: number } | null {
  const observed = items.map((item) => ({ item, value: value(item) })).filter((entry): entry is { item: T; value: number } => entry.value !== null && entry.value !== undefined && Number.isFinite(entry.value));
  if (observed.length === 0) return null;
  const maximum = Math.max(...observed.map((entry) => entry.value));
  return { items: observed.filter((entry) => entry.value === maximum).map((entry) => entry.item), value: maximum };
}

function Insights({ items }: Readonly<{ items: DeterministicInsight[] }>) {
  if (items.length === 0) return null;
  return (
    <section className="grid gap-3 md:grid-cols-2" aria-label="Insights determinísticos" data-testid="deterministic-insights">
      {items.map((item) => (
        <article key={item.code} className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-fg">{item.title}</h3>
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">{item.code}/{item.version}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-fg-muted">{item.text}</p>
        </article>
      ))}
    </section>
  );
}

function EmptyHint({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="rounded-xl border border-line bg-surface p-5 text-sm text-fg-muted">{children}</div>;
}

function PartyComparator({ setParam }: Readonly<{ setParam: (updates: Record<string, string | null>) => void }>) {
  const search = useSearchParams();
  const uf = (search.get("uf") ?? DEFAULT_UF).toUpperCase();
  const selected = split(search.get("itens"));
  const dataQuery = useQuery({ queryKey: ["parties", uf], queryFn: () => partiesApi.list(uf), staleTime: 60_000 });
  const data = dataQuery.data;
  const fallback = data ? defaultPick(data) : null;
  const year = Number(search.get("ano")) || fallback?.year || 0;
  const round = Number(search.get("turno")) || fallback?.round || 0;
  const office = Number(search.get("cargo")) || fallback?.office || 0;

  useEffect(() => {
    if (!fallback || (search.get("ano") && search.get("turno") && search.get("cargo"))) return;
    setParam({ ano: String(year), turno: String(round), cargo: String(office), uf });
  }, [fallback, office, round, search, setParam, uf, year]);

  const parties = useMemo(() => data?.parties.filter((party) => selected.includes(party.slug)) ?? [], [data, selected]);
  const rows = parties.map((party) => ({ party, result: resultFor(party, year, round, office) }));
  const contexts = data?.elections.flatMap((election) => election.offices.map((item) => ({ year: election.year, round: election.round, office: item.code, name: item.name, covered: item.covered }))) ?? [];
  const contextKey = `${year}-${round}-${office}`;

  const insights = useMemo(() => {
    const result: DeterministicInsight[] = [];
    const withResult = rows.filter((row): row is { party: PartySummary; result: PartyResult } => Boolean(row.result));
    const share = leader(withResult, (row) => row.result.share);
    if (share) result.push({ code: "party-share-leader", version: "v1", title: "Maior participação", text: `${share.items.map((row) => row.party.acronym).join(" e ")} ${share.items.length > 1 ? "empatam" : "aparece"} com ${percent(share.value)} dos votos válidos no recorte.` });
    const elected = leader(withResult, (row) => row.result.elected);
    if (elected) result.push({ code: "party-elected-leader", version: "v1", title: "Mais eleitos", text: `${elected.items.map((row) => row.party.acronym).join(" e ")} ${elected.items.length > 1 ? "empatam" : "aparece"} com ${format(elected.value, 0)} eleito(s) no recorte.` });
    const capillarity = leader(withResult, (row) => row.result.municipalitiesWithVotes);
    if (capillarity) result.push({ code: "party-capillarity-leader", version: "v1", title: "Maior presença territorial", text: `${capillarity.items.map((row) => row.party.acronym).join(" e ")} registra(m) votos em ${format(capillarity.value, 0)} município(s), a maior presença entre os selecionados.` });
    return result;
  }, [rows]);

  const report: ExportReport | null = data && rows.length > 0 ? {
    filename: `repbrasil-partidos-${year}-${round}-${office}`,
    title: "REPBrasil — Comparação de partidos",
    subtitle: `${uf} · ${year} · ${round}º turno · cargo ${office}`,
    headers: ["Partido", "Votos", "% válidos", "Candidaturas", "Eleitos", "Municípios com votos", "Estado do dado"],
    rows: rows.map(({ party, result }) => result ? [party.acronym, result.votes, result.share, result.candidacies, result.elected, result.municipalitiesWithVotes, result.votes === null ? "Ausente" : "Observado"] : [party.acronym, null, null, null, null, null, "Partido não disputou este recorte"]),
    metadata: [{ label: "UF", value: uf }, { label: "Ano", value: String(year) }, { label: "Turno", value: String(round) }, { label: "Cargo", value: String(office) }],
    sources: ["Tribunal Superior Eleitoral (TSE) — candidaturas e Boletins de Urna oficiais"],
    methodology: [data.methodology, "Ausência de resultado não é convertida em zero. Insights usam regras determinísticas versionadas."],
    generatedAt: new Date().toISOString(),
    url: currentUrl(),
  } : null;

  if (dataQuery.isLoading) return <EmptyHint>Carregando partidos…</EmptyHint>;
  if (dataQuery.isError || !data) return <EmptyHint>Não foi possível carregar os partidos.</EmptyHint>;

  const add = (slug: string) => setParam({ itens: [...selected, slug].slice(0, MAX_ITEMS).join(",") });
  const remove = (slug: string) => setParam({ itens: selected.filter((item) => item !== slug).join(",") || null });

  return (
    <div className="space-y-5">
      <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-3">
        <label className="text-sm text-fg-muted">Recorte
          <select value={contextKey} onChange={(event) => {
            const [nextYear, nextRound, nextOffice] = event.target.value.split("-");
            setParam({ ano: nextYear, turno: nextRound, cargo: nextOffice });
          }} className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg">
            {contexts.map((item) => <option key={`${item.year}-${item.round}-${item.office}`} value={`${item.year}-${item.round}-${item.office}`}>{item.year} · {item.round}º turno · {item.name}{item.covered ? "" : " · cobertura parcial"}</option>)}
          </select>
        </label>
        <label className="text-sm text-fg-muted">Adicionar partido
          <select defaultValue="" onChange={(event) => { if (event.target.value) add(event.target.value); event.currentTarget.value = ""; }} disabled={selected.length >= MAX_ITEMS} className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg">
            <option value="">Escolha…</option>
            {data.parties.filter((party) => !selected.includes(party.slug)).map((party) => <option key={party.slug} value={party.slug}>{party.acronym}{party.name ? ` — ${party.name}` : ""}</option>)}
          </select>
        </label>
        <div className="text-sm text-fg-muted"><span>Selecionados</span><div className="mt-2 flex flex-wrap gap-1.5">{parties.map((party) => <button key={party.slug} type="button" onClick={() => remove(party.slug)} className="rounded-full border border-line px-2.5 py-1 text-xs text-fg-soft">{party.acronym} ×</button>)}{parties.length === 0 && <span className="text-xs">Nenhum.</span>}</div></div>
      </section>

      {rows.length === 0 ? <EmptyHint>Escolha de 2 a {MAX_ITEMS} partidos para comparar. O sistema não trata partido ausente da disputa como zero.</EmptyHint> : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[760px] text-sm"><thead className="border-b border-line text-left text-xs text-fg-muted"><tr><th className="px-4 py-3">Partido</th><th className="px-4 py-3 text-right">Votos</th><th className="px-4 py-3 text-right">% válidos</th><th className="px-4 py-3 text-right">Candidaturas</th><th className="px-4 py-3 text-right">Eleitos</th><th className="px-4 py-3 text-right">Municípios</th></tr></thead><tbody>{rows.map(({ party, result }) => <tr key={party.slug} className="border-t border-line"><td className="px-4 py-3 font-medium text-fg">{party.acronym}</td><td className="px-4 py-3 text-right text-fg-muted">{format(result?.votes, 0)}</td><td className="px-4 py-3 text-right text-fg-muted">{percent(result?.share)}</td><td className="px-4 py-3 text-right text-fg-muted">{format(result?.candidacies, 0)}</td><td className="px-4 py-3 text-right text-fg-muted">{format(result?.elected, 0)}</td><td className="px-4 py-3 text-right text-fg-muted">{format(result?.municipalitiesWithVotes, 0)}</td></tr>)}</tbody></table></div>
          <Insights items={insights} />
          {report && <ExportActions report={report} />}
        </>
      )}
    </div>
  );
}

function MunicipalityComparator({ setParam }: Readonly<{ setParam: (updates: Record<string, string | null>) => void }>) {
  const search = useSearchParams();
  const uf = (search.get("uf") ?? DEFAULT_UF).toUpperCase();
  const selected = split(search.get("itens"));
  const period = Number(search.get("periodo")) || 2022;
  const metricCodes = split(search.get("metricas"));
  const elections = useQuery({ queryKey: ["elections-catalog"], queryFn: electionsApi.elections, staleTime: 5 * 60_000 });
  const reference = elections.data?.elections.find((item) => item.resultsAvailable) ?? elections.data?.elections[0];
  const municipalities = useQuery({
    queryKey: ["compare-municipalities", reference?.year, reference?.round, uf],
    queryFn: () => electionsApi.municipalities(reference!.year, reference!.round, uf),
    enabled: Boolean(reference),
    staleTime: 5 * 60_000,
  });
  const indicators = useQuery({ queryKey: ["data-indicators"], queryFn: getIndicators, staleTime: 5 * 60_000 });
  const effectiveMetrics = metricCodes.length > 0 ? metricCodes : (indicators.data?.slice(0, 5).map((item) => item.code) ?? []);
  const values = useQuery({
    queryKey: ["compare-municipality-values", effectiveMetrics.join(","), period, uf],
    queryFn: async () => Promise.all(effectiveMetrics.map(async (code) => ({ code, values: await getIndicatorValues(code, period, uf) }))),
    enabled: effectiveMetrics.length > 0,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (metricCodes.length === 0 && effectiveMetrics.length > 0) setParam({ metricas: effectiveMetrics.join(","), periodo: String(period), uf });
  }, [effectiveMetrics, metricCodes.length, period, setParam, uf]);

  const catalog = municipalities.data?.municipalities ?? [];
  const picked = catalog.filter((item) => item.ibgeCode !== null && selected.includes(String(item.ibgeCode)));
  const metrics = (indicators.data ?? []).filter((item) => effectiveMetrics.includes(item.code));
  const valueMap = useMemo(() => {
    const map = new Map<string, IndicatorValue>();
    for (const group of values.data ?? []) for (const item of group.values) map.set(`${group.code}:${item.municipalityIbgeCode}`, item);
    return map;
  }, [values.data]);

  const insights = useMemo(() => metrics.flatMap((metric): DeterministicInsight[] => {
    const observed = picked.map((municipality) => ({ municipality, value: valueMap.get(`${metric.code}:${municipality.ibgeCode}`)?.value })).filter((item): item is { municipality: MunicipalityItem; value: number } => item.value !== undefined);
    if (observed.length < 2) return [];
    const maximum = Math.max(...observed.map((item) => item.value));
    const winners = observed.filter((item) => item.value === maximum).map((item) => item.municipality.name);
    return [{ code: `municipality-max-${metric.code}`, version: "v1", title: `Maior ${metric.name}`, text: `${winners.join(" e ")} registra(m) o maior valor observado entre os municípios selecionados: ${format(maximum)} ${metric.unit}. A regra descreve o valor; não classifica o município como melhor ou pior.` }];
  }), [metrics, picked, valueMap]);

  const sources = [...new Set((values.data ?? []).flatMap((group) => group.values.map((item) => `${item.provider} — ${item.dataset}`)))];
  const report: ExportReport | null = picked.length > 0 && metrics.length > 0 ? {
    filename: `repbrasil-municipios-${period}`,
    title: "REPBrasil — Comparação de municípios",
    subtitle: `${uf} · período ${period}`,
    headers: ["Indicador", "Unidade", ...picked.map((item) => item.name)],
    rows: metrics.map((metric) => [metric.name, metric.unit, ...picked.map((municipality) => valueMap.get(`${metric.code}:${municipality.ibgeCode}`)?.value ?? null)]),
    metadata: [{ label: "UF", value: uf }, { label: "Período", value: String(period) }, { label: "Municípios", value: String(picked.length) }],
    sources,
    methodology: ["Comparação por código IBGE oficial; nomes de município nunca são usados para resolver identidade.", "Ausência de observação permanece ausência. Insights extremos são descritivos e determinísticos, sem inferência causal ou normativa."],
    generatedAt: new Date().toISOString(),
    url: currentUrl(),
  } : null;

  const addMunicipality = (code: string) => setParam({ itens: [...selected, code].slice(0, MAX_ITEMS).join(",") });
  const addMetric = (code: string) => setParam({ metricas: [...effectiveMetrics, code].slice(0, MAX_ITEMS).join(",") });

  if (elections.isLoading || municipalities.isLoading || indicators.isLoading) return <EmptyHint>Carregando municípios e indicadores…</EmptyHint>;
  if (municipalities.isError || indicators.isError) return <EmptyHint>Não foi possível carregar a comparação municipal.</EmptyHint>;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-3">
        <label className="text-sm text-fg-muted">Adicionar município
          <select defaultValue="" disabled={selected.length >= MAX_ITEMS} onChange={(event) => { if (event.target.value) addMunicipality(event.target.value); event.currentTarget.value = ""; }} className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg"><option value="">Escolha…</option>{catalog.filter((item) => item.ibgeCode !== null && !selected.includes(String(item.ibgeCode))).map((item) => <option key={item.tseCode} value={String(item.ibgeCode)}>{item.name}</option>)}</select>
        </label>
        <label className="text-sm text-fg-muted">Período
          <input type="number" value={period} onChange={(event) => setParam({ periodo: event.target.value })} className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg" />
        </label>
        <label className="text-sm text-fg-muted">Adicionar indicador
          <select defaultValue="" disabled={effectiveMetrics.length >= MAX_ITEMS} onChange={(event) => { if (event.target.value) addMetric(event.target.value); event.currentTarget.value = ""; }} className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg"><option value="">Escolha…</option>{(indicators.data ?? []).filter((item) => !effectiveMetrics.includes(item.code)).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
        </label>
        <div className="md:col-span-3 flex flex-wrap gap-2">{picked.map((item) => <button key={item.tseCode} type="button" onClick={() => setParam({ itens: selected.filter((code) => code !== String(item.ibgeCode)).join(",") || null })} className="rounded-full border border-line px-2.5 py-1 text-xs text-fg-soft">{item.name} ×</button>)}{metrics.map((item) => <button key={item.code} type="button" onClick={() => setParam({ metricas: effectiveMetrics.filter((code) => code !== item.code).join(",") || null })} className="rounded-full border border-accent/25 px-2.5 py-1 text-xs text-accent-text">{item.name} ×</button>)}</div>
      </section>
      {picked.length === 0 ? <EmptyHint>Escolha de 2 a {MAX_ITEMS} municípios. O vínculo com indicadores usa o código IBGE oficial, nunca semelhança de nome.</EmptyHint> : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[680px] text-sm"><thead className="border-b border-line text-left text-xs text-fg-muted"><tr><th className="px-4 py-3">Indicador</th>{picked.map((item) => <th key={item.tseCode} className="px-4 py-3 text-right">{item.name}</th>)}</tr></thead><tbody>{metrics.map((metric) => <tr key={metric.code} className="border-t border-line"><td className="px-4 py-3"><p className="font-medium text-fg">{metric.name}</p><p className="text-xs text-fg-muted">{metric.unit} · {period}</p></td>{picked.map((municipality) => <td key={municipality.tseCode} className="px-4 py-3 text-right text-fg-muted">{format(valueMap.get(`${metric.code}:${municipality.ibgeCode}`)?.value)}</td>)}</tr>)}</tbody></table></div>
          <Insights items={insights} />
          {report && <ExportActions report={report} />}
        </>
      )}
    </div>
  );
}

function electionKey(item: ElectionItem): string {
  return `${item.year}-${item.round}`;
}

function ElectionComparator({ setParam }: Readonly<{ setParam: (updates: Record<string, string | null>) => void }>) {
  const search = useSearchParams();
  const uf = (search.get("uf") ?? DEFAULT_UF).toUpperCase();
  const selected = split(search.get("itens"));
  const catalog = useQuery({ queryKey: ["elections-catalog"], queryFn: electionsApi.elections, staleTime: 5 * 60_000 });
  const selectedElections = (catalog.data?.elections ?? []).filter((item) => selected.includes(electionKey(item)));
  const states = useQuery({
    queryKey: ["compare-election-states", selected.join(","), uf],
    queryFn: async () => Promise.all(selectedElections.map(async (election) => ({ election, state: (await electionsApi.states(election.year, election.round)).states.find((item) => item.uf === uf) ?? null }))),
    enabled: selectedElections.length > 0,
    staleTime: 60_000,
  });
  const rows = states.data ?? [];
  const insights = useMemo(() => {
    const coverage = leader(rows.filter((row): row is { election: ElectionItem; state: StateItem } => row.state !== null), (row) => row.state.resultsMunicipalities);
    if (!coverage) return [];
    return [{ code: "election-result-coverage", version: "v1", title: "Maior cobertura municipal de resultados", text: `${coverage.items.map((item) => `${item.election.year} ${item.election.round}º turno`).join(" e ")} possui(em) resultados para ${format(coverage.value, 0)} município(s) de ${uf}, a maior cobertura entre os pleitos selecionados.` }] satisfies DeterministicInsight[];
  }, [rows, uf]);

  const report: ExportReport | null = rows.length > 0 ? {
    filename: `repbrasil-eleicoes-${uf.toLowerCase()}`,
    title: "REPBrasil — Comparação de eleições",
    subtitle: uf,
    headers: ["Eleição", "Data", "Cadastro", "Resultados", "Municípios", "Municípios com cadastro", "Municípios com resultados"],
    rows: rows.map(({ election, state }) => [
      `${election.year} · ${election.round}º turno`, election.electionDate, election.cadasterAvailable ? "Disponível" : "Indisponível", election.resultsAvailable ? "Disponível" : "Indisponível", state?.municipalities ?? null, state?.cadasterMunicipalities ?? null, state?.resultsMunicipalities ?? null,
    ]),
    metadata: [{ label: "UF", value: uf }, { label: "Pleitos", value: String(rows.length) }],
    sources: ["Tribunal Superior Eleitoral (TSE) — cadastro eleitoral e Boletins de Urna oficiais"],
    methodology: ["A comparação descreve a cobertura dos datasets importados para cada pleito; indisponibilidade não é convertida em zero.", "Insights usam apenas regras determinísticas versionadas sobre os valores exibidos."],
    generatedAt: new Date().toISOString(),
    url: currentUrl(),
  } : null;

  if (catalog.isLoading) return <EmptyHint>Carregando pleitos…</EmptyHint>;
  if (catalog.isError || !catalog.data) return <EmptyHint>Não foi possível carregar os pleitos.</EmptyHint>;

  const add = (key: string) => setParam({ itens: [...selected, key].slice(0, MAX_ITEMS).join(",") });
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-surface p-4">
        <label className="block max-w-xl text-sm text-fg-muted">Adicionar eleição
          <select defaultValue="" disabled={selected.length >= MAX_ITEMS} onChange={(event) => { if (event.target.value) add(event.target.value); event.currentTarget.value = ""; }} className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-fg"><option value="">Escolha…</option>{catalog.data.elections.filter((item) => !selected.includes(electionKey(item))).map((item) => <option key={electionKey(item)} value={electionKey(item)}>{item.year} · {item.round}º turno · {item.description ?? "Eleição"}</option>)}</select>
        </label>
        <div className="mt-3 flex flex-wrap gap-2">{selectedElections.map((item) => <button key={electionKey(item)} type="button" onClick={() => setParam({ itens: selected.filter((key) => key !== electionKey(item)).join(",") || null })} className="rounded-full border border-line px-2.5 py-1 text-xs text-fg-soft">{item.year} · {item.round}º turno ×</button>)}</div>
      </section>
      {selectedElections.length === 0 ? <EmptyHint>Escolha de 2 a {MAX_ITEMS} eleições para comparar cobertura e disponibilidade de dados no mesmo território.</EmptyHint> : states.isLoading ? <EmptyHint>Carregando cobertura dos pleitos…</EmptyHint> : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface"><table className="w-full min-w-[760px] text-sm"><thead className="border-b border-line text-left text-xs text-fg-muted"><tr><th className="px-4 py-3">Eleição</th><th className="px-4 py-3">Data</th><th className="px-4 py-3 text-right">Municípios</th><th className="px-4 py-3 text-right">Cadastro</th><th className="px-4 py-3 text-right">Resultados</th></tr></thead><tbody>{rows.map(({ election, state }) => <tr key={electionKey(election)} className="border-t border-line"><td className="px-4 py-3 font-medium text-fg">{election.year} · {election.round}º turno</td><td className="px-4 py-3 text-fg-muted">{new Date(election.electionDate).toLocaleDateString("pt-BR")}</td><td className="px-4 py-3 text-right text-fg-muted">{format(state?.municipalities, 0)}</td><td className="px-4 py-3 text-right text-fg-muted">{format(state?.cadasterMunicipalities, 0)}</td><td className="px-4 py-3 text-right text-fg-muted">{format(state?.resultsMunicipalities, 0)}</td></tr>)}</tbody></table></div>
          <Insights items={insights} />
          {report && <ExportActions report={report} />}
        </>
      )}
    </div>
  );
}

export function UniversalCompare() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/comparar";
  const kind = (Object.hasOwn(KIND_LABEL, search.get("tipo") ?? "") ? search.get("tipo") : "partido") as CompareKind;
  const setParam = useMemo(() => (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(updates)) value === null ? params.delete(key) : params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, search]);

  const switchKind = (next: CompareKind) => {
    const params = new URLSearchParams();
    params.set("tipo", next);
    if (next !== "candidatura") params.set("uf", DEFAULT_UF);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 lg:px-8" data-testid="universal-comparison">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent-text">Análise comparável</p>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">Comparar</h1>
        <p className="max-w-3xl text-sm leading-6 text-fg-muted">Compare até {MAX_ITEMS} itens do mesmo tipo. O REPBrasil não mistura universos incompatíveis, não converte ausência em zero e não usa IA generativa para criar conclusões factuais.</p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Tipo de comparação">
        {(Object.keys(KIND_LABEL) as CompareKind[]).map((item) => <button key={item} type="button" aria-pressed={kind === item} onClick={() => switchKind(item)} className={`focus-ring rounded-lg border px-3 py-2 text-sm ${kind === item ? "border-accent bg-accent/10 text-accent-text" : "border-line bg-surface text-fg-muted hover:text-fg"}`}>{KIND_LABEL[item]}</button>)}
      </nav>

      {kind === "candidatura" ? (
        <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-lg font-semibold text-fg">Comparação territorial de candidaturas</h2>
          <p className="text-sm leading-6 text-fg-muted">O comparador eleitoral já suporta até cinco candidaturas, eleições diferentes, município, zona, seção e local de votação, com guardas de comparabilidade e mapa A × B.</p>
          <Link href="/eleicoes/comparar" className="focus-ring inline-flex rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-medium text-accent-text hover:bg-accent/15">Abrir comparador de candidaturas →</Link>
        </section>
      ) : kind === "partido" ? <PartyComparator setParam={setParam} /> : kind === "municipio" ? <MunicipalityComparator setParam={setParam} /> : <ElectionComparator setParam={setParam} />}

      <footer className="rounded-xl border border-line bg-surface p-4 text-xs leading-5 text-fg-muted">
        <strong className="text-fg-soft">Contrato analítico.</strong> A URL registra o recorte reproduzível. Insights são regras determinísticas versionadas sobre dados oficiais/auditados. Correlação não implica causalidade e dados territoriais não identificam características individuais de eleitores.
      </footer>
    </main>
  );
}
