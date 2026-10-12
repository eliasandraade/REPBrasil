import Link from "next/link";
import { DataState } from "@/components/ui/DataState";
import { MunicipalityDirectory } from "./MunicipalityDirectory";
import { displayName, formatCount, formatPercent, UNAVAILABLE } from "@/lib/elections/format";
import { buildElectionsPath } from "@/lib/elections/route";
import {
  electionProfilePath,
  indicatorValueText,
  municipalityProfilePath,
  stateProfilePath,
} from "@/lib/entities";
import type {
  ElectionProfileData,
  FeaturedRankings,
  MunicipalityProfileData,
  StateProfileData,
} from "@/lib/entities-server";
import { politicianPath } from "@/lib/paths";
import { KIND_SLUG, type RankingResponse } from "@/lib/rankings";

function MetricCard({ label, value, detail }: Readonly<{ label: string; value: string; detail?: string }>) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-fg">{value}</p>
      {detail && <p className="mt-1 text-xs leading-relaxed text-fg-muted">{detail}</p>}
    </div>
  );
}

function SectionTitle({ title, detail }: Readonly<{ title: string; detail?: string }>) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {detail && <p className="mt-1 text-xs leading-relaxed text-fg-muted">{detail}</p>}
    </div>
  );
}

function RankingList({ title, response }: Readonly<{ title: string; response: RankingResponse | null }>) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {!response ? (
        <p className="mt-3 text-xs text-fg-muted">Sem ranking comparável neste recorte.</p>
      ) : response.items.length === 0 ? (
        <p className="mt-3 text-xs text-fg-muted">Nenhum item observado. Ausência não é convertida em zero.</p>
      ) : (
        <ol className="mt-3 divide-y divide-line" data-testid="entity-ranking">
          {response.items.map((item) => {
            const href = item.politicianId ? politicianPath({ id: item.politicianId, slug: item.slug }) : null;
            return (
              <li key={`${item.position}-${item.candidacyId ?? item.name}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="mr-2 text-xs tabular-nums text-fg-muted">{item.position}.</span>
                  {href ? (
                    <Link href={href} className="focus-ring rounded font-medium text-fg hover:text-accent-text">
                      {displayName(item.name)}
                    </Link>
                  ) : (
                    <span className="font-medium text-fg">{displayName(item.name)}</span>
                  )}
                  {item.party && <span className="ml-2 text-xs text-fg-muted">{item.party}</span>}
                </span>
                <span className="flex-shrink-0 text-right text-xs font-medium tabular-nums text-fg-soft">{item.valueText}</span>
              </li>
            );
          })}
        </ol>
      )}
      {response?.coverage && !response.coverage.complete && (
        <p className="mt-3 text-[11px] leading-relaxed text-fg-muted">{response.coverage.note}</p>
      )}
    </section>
  );
}

function RankingsBlock({
  rankings,
  year,
  round,
  uf,
  municipality,
}: Readonly<{
  rankings: FeaturedRankings;
  year: number;
  round: number;
  uf: string;
  municipality?: string | null;
}>) {
  if (!rankings.office) return <DataState kind="empty" title="Sem cargo comparável para destacar." />;
  const query = new URLSearchParams({ ano: String(year), turno: String(round), cargo: String(rankings.office.code), uf });
  if (municipality) query.set("municipio", municipality);
  const candidateKind = rankings.candidateKind ?? "votes";
  const candidateQuery = new URLSearchParams(query);
  candidateQuery.set("tipo", KIND_SLUG[candidateKind]);
  const partyQuery = new URLSearchParams(query);
  partyQuery.set("tipo", KIND_SLUG.parties);
  return (
    <section aria-labelledby="entity-rankings">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="entity-rankings" className="text-base font-semibold text-fg">
            Destaques eleitorais · {rankings.office.name}
          </h2>
          <p className="mt-1 text-xs text-fg-muted">Ranking oficial no recorte mais recente com resultados disponíveis.</p>
        </div>
        <div className="flex gap-3 text-xs">
          <Link href={`/rankings?${candidateQuery}`} className="focus-ring rounded text-accent-text hover:underline">
            Ranking de candidaturas →
          </Link>
          <Link href={`/rankings?${partyQuery}`} className="focus-ring rounded text-accent-text hover:underline">
            Ranking de partidos →
          </Link>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <RankingList title={rankings.candidateKind === "share" ? "Maior participação" : "Mais votados"} response={rankings.candidates} />
        <RankingList title="Partidos mais votados" response={rankings.parties} />
      </div>
    </section>
  );
}

function IntegrityNote() {
  return (
    <div className="rounded-xl border border-line bg-subtle/50 px-4 py-3 text-xs leading-relaxed text-fg-muted">
      O perfil reúne somente dados oficiais já importados. Cobertura ausente ou fonte indisponível permanece como ausência — nunca como zero. Comparações eleitorais respeitam eleição, turno, cargo e território.
    </div>
  );
}

export function StateEntityProfile({ data }: Readonly<{ data: StateProfileData }>) {
  const latest = data.latest;
  const state = latest.state;
  const municipalities = data.municipalities?.municipalities ?? [];
  const explorer = buildElectionsPath({ year: latest.year, round: latest.round, state: state.slug });
  return (
    <main className="min-h-screen bg-canvas px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-7">
        <header>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Território · Estado</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-fg">{data.name}</h1>
              <p className="mt-1 text-sm text-fg-muted">
                {data.uf}{data.ibgeCode !== null ? ` · código IBGE ${data.ibgeCode}` : ""} · {data.snapshots.length} pleito(s) no catálogo
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href={explorer} className="focus-ring rounded-lg bg-accent px-4 py-2 font-medium text-accent-contrast">
                Explorar eleição
              </Link>
              <Link href={`/comparar?tipo=eleicao&uf=${data.uf}`} className="focus-ring rounded-lg border border-line px-4 py-2 text-fg-soft hover:border-accent/30">
                Comparar eleições
              </Link>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo do estado">
          <MetricCard label="Último recorte" value={`${latest.year} · ${latest.round}º turno`} detail={latest.description ?? undefined} />
          <MetricCard label="Municípios conhecidos" value={formatCount(state.municipalities)} detail={`${formatCount(state.cadasterMunicipalities)} com cadastro eleitoral`} />
          <MetricCard label="Com resultados" value={formatCount(state.resultsMunicipalities)} detail={state.resultsAvailable ? "Boletins de Urna importados" : "Resultados ainda indisponíveis"} />
          <MetricCard label="Indicadores" value={formatCount(data.indicators.length)} detail="Indicadores socioeconômicos com observação municipal" />
        </section>

        <section aria-labelledby="state-timeline">
          <SectionTitle title="Linha do tempo eleitoral" detail="Cada cartão mantém a disponibilidade real daquela eleição; cadastro e resultado são estados diferentes." />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" id="state-timeline">
            {data.snapshots.map((snapshot) => (
              <article key={`${snapshot.year}-${snapshot.round}`} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <Link href={electionProfilePath(snapshot.year, snapshot.round)} className="focus-ring rounded font-semibold text-fg hover:text-accent-text">
                    {snapshot.year} · {snapshot.round}º turno
                  </Link>
                  <span className="text-[10px] uppercase tracking-wide text-fg-muted">{snapshot.state.resultsAvailable ? "resultados" : snapshot.state.cadasterAvailable ? "cadastro" : "sem carga"}</span>
                </div>
                <p className="mt-2 text-xs text-fg-muted">{formatCount(snapshot.state.resultsMunicipalities)} municípios com resultado · {formatCount(snapshot.state.cadasterMunicipalities)} com cadastro</p>
                <Link href={buildElectionsPath({ year: snapshot.year, round: snapshot.round, state: snapshot.state.slug })} className="mt-3 inline-block text-xs text-accent-text hover:underline">
                  Abrir explorador →
                </Link>
              </article>
            ))}
          </div>
        </section>

        <RankingsBlock rankings={data.rankings} year={latest.year} round={latest.round} uf={data.uf} />

        <section aria-labelledby="state-indicators">
          <SectionTitle title="Dados socioeconômicos" detail="Cobertura municipal disponível no Data Intelligence. O perfil do estado não transforma média municipal em característica individual do eleitor." />
          {data.indicators.length === 0 ? (
            <DataState kind="empty" title="Sem indicadores carregados para esta UF." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" id="state-indicators">
              {data.indicators.map((item) => (
                <Link key={item.indicator.code} href={`/dados?x=${encodeURIComponent(item.indicator.code)}&periodo=${item.period}`} className="focus-ring rounded-xl border border-line bg-surface p-4 hover:border-accent/30">
                  <p className="text-sm font-semibold text-fg">{item.indicator.name}</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-fg">{formatCount(item.observed)}</p>
                  <p className="mt-1 text-xs text-fg-muted">municípios observados · {item.period} · {item.indicator.provider}</p>
                </Link>
              ))}
            </div>
          )}
        </section>

        {municipalities.length > 0 && <MunicipalityDirectory municipalities={municipalities} uf={data.uf} />}
        <IntegrityNote />
      </div>
    </main>
  );
}

export function MunicipalityEntityProfile({ data }: Readonly<{ data: MunicipalityProfileData }>) {
  const latest = data.latest;
  const municipality = latest.detail.municipality;
  const explorer = buildElectionsPath({
    year: latest.year,
    round: latest.round,
    state: data.uf.toLowerCase(),
    municipality: data.slug,
  });
  return (
    <main className="min-h-screen bg-canvas px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-7">
        <header>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            <Link href={stateProfilePath(data.uf)} className="focus-ring rounded hover:text-accent-text">{data.uf}</Link> · Município
          </p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-fg">{displayName(data.name)}</h1>
              <p className="mt-1 text-sm text-fg-muted">
                {data.uf} · TSE {data.tseCode}{data.ibgeCode !== null ? ` · IBGE ${data.ibgeCode}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href={explorer} className="focus-ring rounded-lg bg-accent px-4 py-2 font-medium text-accent-contrast">Explorar zonas e seções</Link>
              <Link href={`/comparar?tipo=municipio&uf=${data.uf}&itens=${data.ibgeCode ?? ""}`} className="focus-ring rounded-lg border border-line px-4 py-2 text-fg-soft hover:border-accent/30">Comparar município</Link>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo do município">
          <MetricCard label="Último recorte" value={`${latest.year} · ${latest.round}º turno`} detail={latest.description ?? undefined} />
          <MetricCard label="Zonas eleitorais" value={formatCount(latest.detail.summary?.zones)} detail={`${formatCount(latest.detail.summary?.sections)} seções no cadastro`} />
          <MetricCard label="Eleições com resultado" value={formatCount(data.snapshots.filter((item) => item.detail.municipality.resultsAvailable).length)} detail={`${data.snapshots.length} pleito(s) localizados`} />
          <MetricCard label="Indicadores" value={formatCount(data.indicators.length)} detail="Última observação oficial disponível por indicador" />
        </section>

        <section aria-labelledby="municipality-indicators">
          <SectionTitle title="Retrato socioeconômico" detail="Valores municipais oficiais. O período aparece em cada indicador para impedir comparações temporais implícitas." />
          {data.indicators.length === 0 ? (
            <DataState kind="empty" title="Sem indicador socioeconômico observado para este município." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" id="municipality-indicators">
              {data.indicators.map(({ indicator, value }) => (
                <Link key={indicator.code} href={`/dados?x=${encodeURIComponent(indicator.code)}&periodo=${value.period}`} className="focus-ring rounded-xl border border-line bg-surface p-4 hover:border-accent/30">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{value.period} · {indicator.provider}</p>
                  <p className="mt-1 text-sm font-semibold text-fg">{indicator.name}</p>
                  <p className="mt-2 text-xl font-bold tabular-nums text-fg">{indicatorValueText(value.value, indicator.unit)}</p>
                  <p className="mt-1 truncate text-[11px] text-fg-muted" title={value.dataset}>{value.dataset}</p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="municipality-timeline">
          <SectionTitle title="Histórico eleitoral" detail="O mesmo território é resolvido por código oficial ao longo dos pleitos disponíveis." />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" id="municipality-timeline">
            {data.snapshots.map((snapshot) => {
              const m = snapshot.detail.municipality;
              return (
                <article key={`${snapshot.year}-${snapshot.round}`} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={electionProfilePath(snapshot.year, snapshot.round)} className="focus-ring rounded font-semibold text-fg hover:text-accent-text">{snapshot.year} · {snapshot.round}º turno</Link>
                    <span className="text-[10px] uppercase tracking-wide text-fg-muted">{m.resultsAvailable ? "resultados" : m.cadasterAvailable ? "cadastro" : "sem carga"}</span>
                  </div>
                  <p className="mt-2 text-xs text-fg-muted">{formatCount(snapshot.detail.summary?.zones)} zonas · {formatCount(snapshot.detail.summary?.sections)} seções</p>
                  <Link href={buildElectionsPath({ year: snapshot.year, round: snapshot.round, state: data.uf.toLowerCase(), municipality: m.slug })} className="mt-3 inline-block text-xs text-accent-text hover:underline">Ver resultado territorial →</Link>
                </article>
              );
            })}
          </div>
          {data.unavailableElections > 0 && <p className="mt-3 text-xs text-fg-muted">{data.unavailableElections} consulta(s) de pleito ficaram indisponíveis durante a montagem deste perfil; isso não foi convertido em ausência de dado.</p>}
        </section>

        <RankingsBlock rankings={data.rankings} year={latest.year} round={latest.round} uf={data.uf} municipality={municipality.tseCode} />
        <IntegrityNote />
      </div>
    </main>
  );
}

export function ElectionEntitySummary({ data }: Readonly<{ data: ElectionProfileData }>) {
  const loadedStates = data.states.filter((state) => state.cadasterAvailable || state.resultsAvailable);
  const resultStates = data.states.filter((state) => state.resultsAvailable);
  const municipalities = resultStates.reduce((total, state) => total + state.resultsMunicipalities, 0);
  const primary = data.primaryState;
  return (
    <section className="border-b border-line bg-canvas px-4 py-8 sm:px-6" aria-labelledby="election-entity-title" data-testid="election-entity-summary">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Eleição</p>
            <h1 id="election-entity-title" className="mt-1 text-3xl font-bold text-fg">Eleições {data.year} · {data.round}º turno</h1>
            <p className="mt-1 text-sm text-fg-muted">{data.description ?? "Pleito oficial"} · {data.electionDate}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <a href="#explorador" className="focus-ring rounded-lg bg-accent px-4 py-2 font-medium text-accent-contrast">Explorar território</a>
            <Link href={`/comparar?tipo=eleicao${primary ? `&uf=${primary.uf}` : ""}`} className="focus-ring rounded-lg border border-line px-4 py-2 text-fg-soft hover:border-accent/30">Comparar pleitos</Link>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="UFs com carga" value={formatCount(loadedStates.length)} detail={`${formatCount(resultStates.length)} com resultados`} />
          <MetricCard label="Municípios com resultado" value={formatCount(municipalities)} detail="Somente UFs com Boletim de Urna importado" />
          <MetricCard label="Cargos" value={formatCount(data.overview.reduce((total, item) => total + item.offices.length, 0))} detail="Somatório das coberturas estaduais carregadas" />
          <MetricCard label="Recorte destacado" value={primary?.uf ?? UNAVAILABLE} detail={data.rankings.office?.name ?? "Sem cargo comparável"} />
        </div>

        {loadedStates.length > 0 && (
          <section aria-labelledby="election-coverage">
            <SectionTitle title="Cobertura carregada" detail="A plataforma mostra apenas as UFs efetivamente importadas neste pleito." />
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" id="election-coverage">
              {loadedStates.map((state) => (
                <article key={state.uf} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
                  <div>
                    <Link href={stateProfilePath(state.uf)} className="focus-ring rounded font-semibold text-fg hover:text-accent-text">{state.name} · {state.uf}</Link>
                    <p className="mt-1 text-xs text-fg-muted">{formatCount(state.resultsMunicipalities)} municípios com resultado · {formatCount(state.cadasterMunicipalities)} com cadastro</p>
                  </div>
                  <Link href={buildElectionsPath({ year: data.year, round: data.round, state: state.slug })} className="focus-ring flex-shrink-0 rounded text-xs text-accent-text hover:underline">Explorar →</Link>
                </article>
              ))}
            </div>
          </section>
        )}

        {primary && <RankingsBlock rankings={data.rankings} year={data.year} round={data.round} uf={primary.uf} />}
        <IntegrityNote />
      </div>
    </section>
  );
}
