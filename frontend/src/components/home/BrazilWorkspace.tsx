"use client";

import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SearchBox } from "@/components/search/GlobalSearch";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { electionsApi } from "@/lib/elections/api";
import { loadTerritoryGeo } from "@/lib/elections/geo";
import { buildElectionsPath } from "@/lib/elections/route";
import { compactCount, coverageHref, formatDay, getOverview } from "@/lib/overview";
import { TransitionLink } from "@/motion/navigation";
import { useReducedMotion } from "@/motion/reduced-motion";

const TerritoryMap = dynamic(
  () => import("@/components/elections/TerritoryMap").then((m) => m.TerritoryMap),
  {
    ssr: false,
    loading: () => (
      <div className="atlas-loading" role="status">
        Preparando o mapa do Brasil…
      </div>
    ),
  },
);

export function BrazilWorkspace() {
  const reduced = useReducedMotion();
  const [chosen, setChosen] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [territorySearch, setTerritorySearch] = useState("");
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: ({ signal }) => getOverview(signal),
    staleTime: 600_000,
    retry: 1,
  });
  const catalog = useQuery({
    queryKey: ["el-elections"],
    queryFn: electionsApi.elections,
    retry: 1,
  });
  const geo = useQuery({
    queryKey: ["territory-geometry"],
    queryFn: () => loadTerritoryGeo(),
    staleTime: Infinity,
    retry: 1,
  });
  const elections = useMemo(
    () => [...(catalog.data?.elections ?? [])].sort((a, b) => b.year - a.year || a.round - b.round),
    [catalog.data],
  );
  const current =
    elections.find((e) => `${e.year}-${e.round}` === period) ??
    elections.find((e) => e.default) ??
    elections[0];
  const states = useQuery({
    queryKey: ["el-states", current?.year, current?.round],
    queryFn: () => electionsApi.states(current!.year, current!.round),
    enabled: !!current,
    retry: 1,
  });
  const territories = useMemo(() => geo.data?.ufs.features ?? [], [geo.data]);
  const selected = territories.find((f) => f.properties.code === chosen);
  const available = useMemo(() => states.data?.states ?? [], [states.data]);
  const selectedState = available.find((s) => String(s.ibgeCode) === chosen);
  const coverage = (overview.data?.elections ?? []).filter(
    (e) =>
      e.year === current?.year &&
      e.round === current?.round &&
      (!selected || e.uf === selected.properties.uf),
  );
  const normalize = (v: string) =>
    v
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const visible = territories
    .filter((f) =>
      normalize(`${f.properties.name} ${f.properties.uf}`).includes(normalize(territorySearch)),
    )
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name, "pt-BR"));
  const scope = useMemo(
    () => ({
      state: chosen,
      municipality: null,
      interactiveStates: territories.map((f) => f.properties.code),
      highlightStates: available
        .filter((s) => s.resultsAvailable)
        .flatMap((s) => (s.ibgeCode == null ? [] : String(s.ibgeCode))),
      interactiveMunicipalities: [],
      highlightMunicipalities: [],
    }),
    [chosen, territories, available],
  );

  return (
    <main className="brazil-workspace">
      <section className="atlas-intro">
        <div>
          <p className="eyebrow">Território · Eleições · Pessoas</p>
          <h1>O Brasil, em contexto.</h1>
          <p>Parta de um lugar. Encontre uma disputa. Investigue os dados.</p>
        </div>
        <div className="atlas-search">
          <SearchBox variant="inline" placeholder="Quem ou onde você quer conhecer?" />
          <span>Busca por pessoa, município, partido ou eleição</span>
        </div>
      </section>
      <section className="atlas" aria-label="Explorar o Brasil">
        <div className="atlas-toolbar">
          <div>
            <span className="eyebrow">Atlas eleitoral</span>
            <strong>{selected?.properties.name ?? "Brasil"}</strong>
          </div>
          <div className="atlas-toolbar-actions">
            {chosen && (
              <button onClick={() => setChosen(null)} className="quiet-button">
                ← Brasil
              </button>
            )}
            <span className="atlas-source">Geografia IBGE</span>
          </div>
        </div>
        <div className="atlas-body">
          <div className="atlas-map">
            <TerritoryMap
              level={chosen ? "state" : "country"}
              routeKey={chosen ?? "brasil"}
              scope={scope}
              points={[]}
              reduced={reduced}
              onSelect={(target, code) => {
                if (target === "state") setChosen(code);
              }}
              onSelectPlace={() => {}}
            />
            <div className="atlas-map-caption">
              <span className="map-key" />
              {states.isError || states.isPending || !current
                ? "Cobertura eleitoral não confirmada"
                : "Preenchimento claro: resultado importado"}
              <span>Selecione um estado</span>
            </div>
          </div>
          <aside className="atlas-context" aria-label="Contexto do território">
            <p className="eyebrow">Seu ponto de partida</p>
            <h2>{selected?.properties.name ?? "Cada lugar tem uma história eleitoral."}</h2>
            <p className="atlas-context-description">
              {selected
                ? "Consulte a cobertura disponível e siga até os municípios, zonas e seções."
                : "Escolha um estado no mapa ou na lista. O que está disponível aparece aqui, com a origem dos dados."}
            </p>
            <label className="territory-label" htmlFor="territory-search">
              Encontrar estado
            </label>
            <input
              id="territory-search"
              className="territory-input"
              value={territorySearch}
              onChange={(e) => setTerritorySearch(e.target.value)}
              placeholder="Nome ou UF"
              type="search"
            />
            <div className="territory-list" aria-label="Estados do Brasil">
              {geo.isPending && <p role="status">Carregando territórios…</p>}
              {geo.isError && (
                <DataState
                  kind="error"
                  title="Não foi possível carregar os territórios"
                  action={<RetryButton onRetry={() => geo.refetch()} />}
                />
              )}
              {geo.data && visible.length === 0 && <p role="status">Nenhum estado encontrado.</p>}
              {visible.map((f) => {
                const state = available.find((s) => String(s.ibgeCode) === f.properties.code);
                return (
                  <button
                    key={f.id}
                    onClick={() => setChosen(f.properties.code)}
                    aria-pressed={chosen === f.properties.code}
                    className="territory-row"
                  >
                    <span className="territory-uf">{f.properties.uf}</span>
                    <span>{f.properties.name}</span>
                    <span className="territory-availability">
                      {state?.resultsAvailable
                        ? "Resultados"
                        : state?.cadasterAvailable
                          ? "Cadastro"
                          : ""}
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                );
              })}
            </div>
            <div className="atlas-selection" aria-live="polite">
              {catalog.isError || states.isError ? (
                <DataState
                  kind="error"
                  title="Cobertura indisponível no momento"
                  action={
                    <RetryButton
                      onRetry={() => {
                        void catalog.refetch();
                        if (current) void states.refetch();
                      }}
                    />
                  }
                >
                  O mapa mostra geografia, não confirma resultados.
                </DataState>
              ) : catalog.isPending || states.isFetching ? (
                <p role="status">Consultando o catálogo eleitoral…</p>
              ) : current && selectedState?.cadasterAvailable ? (
                <TransitionLink
                  className="primary-action"
                  href={buildElectionsPath({
                    year: current.year,
                    round: current.round,
                    state: selectedState.slug,
                  })}
                >
                  Explorar {selectedState.name}
                  <span aria-hidden="true">→</span>
                </TransitionLink>
              ) : chosen ? (
                <p>
                  {current
                    ? "Sem cadastro importado para este estado nesta eleição."
                    : "Nenhuma eleição disponível no catálogo."}
                </p>
              ) : current ? (
                <TransitionLink
                  className="primary-action"
                  href={buildElectionsPath({ year: current.year, round: current.round })}
                >
                  Abrir explorador eleitoral<span aria-hidden="true">→</span>
                </TransitionLink>
              ) : (
                <p>Nenhuma eleição disponível no catálogo.</p>
              )}
            </div>
          </aside>
        </div>
        <div className="atlas-time">
          <div>
            <span className="eyebrow">Navegação no tempo</span>
            <p>Somente eleições do catálogo</p>
          </div>
          <div className="election-periods" role="group" aria-label="Eleição consultada">
            {elections.map((e) => (
              <button
                key={`${e.year}-${e.round}`}
                aria-pressed={current?.year === e.year && current.round === e.round}
                onClick={() => setPeriod(`${e.year}-${e.round}`)}
              >
                <strong>{e.year}</strong>
                <span>{e.round}º turno</span>
              </button>
            ))}
            {catalog.isError && <span>Catálogo indisponível</span>}
            {catalog.isPending && <span>Consultando eleições…</span>}
            {!catalog.isPending && !catalog.isError && elections.length === 0 && (
              <span>Nenhuma eleição importada</span>
            )}
          </div>
        </div>
      </section>
      <section
        className="coverage-section"
        aria-labelledby="coverage-heading"
        aria-busy={overview.isPending}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">O que você pode investigar</p>
            <h2 id="coverage-heading">Cobertura da base{current ? ` · ${current.year}` : ""}</h2>
          </div>
          <TransitionLink href="/eleicoes" className="text-link">
            Todas as eleições ↗
          </TransitionLink>
        </div>
        {overview.isError && (
          <DataState
            kind="error"
            title="Não foi possível consultar a cobertura"
            action={<RetryButton onRetry={() => overview.refetch()} />}
          >
            Falha de comunicação não significa ausência de dados.
          </DataState>
        )}
        {overview.isPending && <p role="status">Consultando bases importadas…</p>}
        {!overview.isPending && !overview.isError && current && coverage.length === 0 && (
          <DataState kind="no_coverage">
            Sem resultados por seção importados para este recorte.
          </DataState>
        )}
        <div className="coverage-ledger">
          {coverage.map((e) => (
            <TransitionLink
              key={`${e.year}-${e.round}-${e.uf}`}
              href={coverageHref(e)}
              className="coverage-record"
            >
              <span className="coverage-uf">{e.uf}</span>
              <div>
                <h3>{e.stateName}</h3>
                <p>
                  {e.round}º turno · {e.offices.map((o) => o.name).join(", ")}
                </p>
              </div>
              <dl>
                <div>
                  <dt>Municípios</dt>
                  <dd>{compactCount(e.municipalities)}</dd>
                </div>
                <div>
                  <dt>Seções</dt>
                  <dd>{compactCount(e.sections)}</dd>
                </div>
              </dl>
              <span aria-hidden="true">↗</span>
            </TransitionLink>
          ))}
        </div>
      </section>
      <section className="investigation-paths" aria-label="Outras formas de explorar">
        <TransitionLink href="/politicos">
          <span className="eyebrow">01 / Pessoas</span>
          <h2>Da pessoa à trajetória.</h2>
          <p>Candidaturas, território, patrimônio declarado e contas de campanha.</p>
          <span className="text-link">Investigar um perfil ↗</span>
        </TransitionLink>
        <TransitionLink href="/eleicoes/comparar">
          <span className="eyebrow">02 / Comparação</span>
          <h2>Coloque os dados lado a lado.</h2>
          <p>Compare candidaturas e eleições, com limites de comparabilidade explícitos.</p>
          <span className="text-link">Montar uma comparação ↗</span>
        </TransitionLink>
      </section>
      <details className="source-disclosure">
        <summary>
          Fontes, atualização e limites da base<span aria-hidden="true">+</span>
        </summary>
        <div>
          <p>
            Geografia: IBGE. Cadastro, candidaturas e resultados: Tribunal Superior Eleitoral.
            Ausência de dados não é zero. Resultados eleitorais não alteram o Score.
          </p>
          {overview.data?.sources.map((s) => (
            <p key={s.kind}>
              {s.publisher} · {s.label} · {s.files} arquivos
              {s.latestDownload ? ` · download em ${formatDay(s.latestDownload)}` : ""}
            </p>
          ))}
          {overview.data?.updatedAt && (
            <p>Última importação: {formatDay(overview.data.updatedAt)}.</p>
          )}
          <TransitionLink href="/glossario" className="text-link">
            Entender os termos e as limitações ↗
          </TransitionLink>
        </div>
      </details>
    </main>
  );
}
