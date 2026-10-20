"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { PlanGateNote, useEntitlement } from "@/components/account/PlanGate";
import { useResolvedTheme } from "@/components/theme/theme";
import { MapLegend } from "@/components/territory/MapLegend";
import { TerritoryCanvas } from "@/components/territory/TerritoryCanvas";
import { TerritoryTable, type TableRow } from "@/components/territory/TerritoryTable";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { getCoverage, type DataCoverage } from "@/lib/data-intelligence";
import { loadMunicipalityMesh, loadUfMesh, type TerritoryCollection } from "@/lib/elections/geo";
import { municipalityProfilePath, stateProfilePath } from "@/lib/entities";
import { ADVANCED_MAP_MODES } from "@/lib/plans";
import { ibgeCodeOfUf, territoriesApi, ufOfIbgeCode, type TerritoryMunicipality } from "@/lib/territories";
import { availabilityText, hasData, MODE_LABEL, stateOf, statesWithData } from "@/lib/territory/coverage";
import { coverageLayer, viewNote } from "@/lib/territory/layers";
import { ufOfPreposition } from "@/lib/territory/places";
import {
  EXPLORER_MODES,
  EXPLORER_VIEWS,
  explorerHref,
  levelOf,
  parseExplorerState,
  UFS,
  type ExplorerLevel,
  type ExplorerMode,
  type ExplorerState,
  type ExplorerView,
} from "@/lib/territory/url";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useReducedMotion } from "@/motion/reduced-motion";
import { ExplorerTrail } from "./ExplorerTrail";
import { ReadingPanel } from "./ReadingPanel";
import type { ModeView, ReadingModel, TableModel } from "./explorer-types";
import { useAmendmentsMode } from "./modes/useAmendmentsMode";
import { useElectoralMode } from "./modes/useElectoralMode";
import { useSocioMode } from "./modes/useSocioMode";

const VIEW_LABEL: Record<ExplorerView, string> = { mapa: "Mapa", relevo: "Relevo 3D", intensidade: "Intensidade", comparar: "Antes/depois" };
const MODE_NOUN: Record<ExplorerMode, string> = { socioeconomico: "socioeconômicos", eleitoral: "eleitorais", emendas: "de emendas" };
const SEGMENT = "segmented-item focus-ring rounded-md px-3 py-1.5 text-body-sm font-medium";

/** Municípios da UF: nomes oficiais da malha do IBGE, com slug e código TSE do catálogo quando existem. */
function municipalitiesOf(mesh: TerritoryCollection | undefined, catalog: TerritoryMunicipality[] | undefined, uf: string | null): TerritoryMunicipality[] {
  const byCode = new Map((catalog ?? []).map((m) => [m.ibgeCode, m]));
  // nome oficial do IBGE (grafia da malha) e, quando houver, slug e código TSE do catálogo
  const rows = (mesh?.features ?? []).map((f) => ({
    ...(byCode.get(f.properties.code) ?? { ibgeCode: f.properties.code, slug: "", tseCode: "", stateCode: uf ?? "" }),
    name: f.properties.name,
  }));
  for (const m of catalog ?? []) if (!rows.some((r) => r.ibgeCode === m.ibgeCode)) rows.push(m);
  return rows;
}

/**
 * Explorador territorial (/dados). O mapa é o protagonista e persiste de Brasil → UF → município; tudo o que a tela
 * mostra está na URL (território, modo, vista e recorte). Disponibilidade vem da API: onde não há dado, a tela diz
 * "sem dados carregados" e a malha oficial continua navegável.
 */
export function DataExplorer() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/dados";
  const state = useMemo(() => parseExplorerState(search ?? new URLSearchParams()), [search]);
  const level = levelOf(state);
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();
  const allowRelief = useMediaQuery("(pointer: fine) and (min-width: 768px)");
  const [hovered, setHovered] = useState<string | null>(null);
  const advanced = useEntitlement(ADVANCED_MAP_MODES);

  const coverageQ = useQuery({ queryKey: ["data-coverage"], queryFn: getCoverage, staleTime: 5 * 60_000 });
  const ufMeshQ = useQuery({ queryKey: ["uf-mesh"], queryFn: () => loadUfMesh(), staleTime: Infinity });
  const stateCode = state.uf ? ibgeCodeOfUf(state.uf) : null;
  const meshQ = useQuery({ queryKey: ["mesh", stateCode], queryFn: () => loadMunicipalityMesh(stateCode!), enabled: !!stateCode, staleTime: Infinity });
  const catalogQ = useQuery({
    queryKey: ["territory-municipalities", state.uf],
    queryFn: () => territoriesApi.municipalities(state.uf!),
    enabled: !!state.uf,
    staleTime: 30 * 60_000,
    retry: false,
  });
  const municipalities = useMemo(() => municipalitiesOf(meshQ.data, catalogQ.data, state.uf), [catalogQ.data, meshQ.data, state.uf]);
  const coverage = stateOf(coverageQ.data, state.uf);

  const go = useCallback(
    (patch: Partial<ExplorerState>, push = false) => {
      const href = explorerHref({ ...state, ...patch });
      const current = search?.toString() ?? "";
      if (href === (current ? `${pathname}?${current}` : pathname)) return;
      if (push) router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [pathname, router, search, state],
  );
  const update = useCallback((patch: Partial<ExplorerState>) => go(patch), [go]);

  // vistas avançadas são do plano; quem não tem vê o mapa e o aviso do plano
  const requestedView: ExplorerView = state.view !== "mapa" && advanced.allowed !== true ? "mapa" : state.view;
  const modeState = { ...state, view: requestedView };
  const base = { state: modeState, level, coverage, municipalities, theme, reduced, update, hovered, onHover: setHovered };
  const views: Record<ExplorerMode, ModeView> = {
    socioeconomico: useSocioMode({ ...base, enabled: state.mode === "socioeconomico" }),
    eleitoral: useElectoralMode({ ...base, enabled: state.mode === "eleitoral" }),
    emendas: useAmendmentsMode({ ...base, enabled: state.mode === "emendas" }),
  };
  const mode = views[state.mode];
  const effectiveView: ExplorerView = level !== "country" && mode.views.includes(requestedView) ? requestedView : "mapa";

  const countryLayer = useMemo(
    () => (coverageQ.data ? coverageLayer(coverageQ.data.states, state.mode, theme, MODE_LABEL[state.mode]) : null),
    [coverageQ.data, state.mode, theme],
  );
  const layer = level === "country" ? countryLayer : mode.layer;
  const comparing = effectiveView === "comparar" && !!mode.compare;

  const selectState = (code: string) => {
    const uf = ufOfIbgeCode(code);
    if (uf) go({ uf, municipality: null }, true);
  };
  const ufName = coverage?.name ?? ufMeshQ.data?.features.find((f) => f.properties.uf === state.uf)?.properties.name ?? state.uf;
  const municipalityName = state.municipality ? (municipalities.find((m) => m.ibgeCode === state.municipality)?.name ?? state.municipality) : null;
  const place = municipalityName ? `${municipalityName} (${state.uf})` : (ufName ?? "Brasil");

  const reading: ReadingModel = level === "country" ? countryReading(coverageQ.data, state.mode, coverageQ.isPending) : mode.reading;
  const profileSlug = state.municipality ? municipalities.find((m) => m.ibgeCode === state.municipality)?.slug : null;
  const profile = (() => {
    if (level === "municipality" && state.uf && profileSlug && municipalityName)
      return { href: municipalityProfilePath(state.uf, profileSlug), prefix: "Abrir o perfil de", name: municipalityName };
    if (level === "state" && state.uf && ufName && coverage && EXPLORER_MODES.some((m) => hasData(coverage, m)))
      return { href: stateProfilePath(state.uf), prefix: `Abrir o perfil ${ufOfPreposition(state.uf)}`, name: ufName };
    return null;
  })();

  const table = level === "country" ? countryTable(coverageQ.data, ufMeshQ.data, state.mode) : mode.table;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-8 lg:px-8" data-testid="data-explorer">
      <header className="space-y-2">
        <p className="text-label uppercase text-accent-text">Dados</p>
        <h1 className="text-heading-lg text-fg">Explorador territorial</h1>
        <p className="max-w-3xl text-body-sm leading-6 text-fg-muted">
          Indicadores oficiais, resultados eleitorais e emendas parlamentares no mapa, do Brasil ao município. Cada valor traz fonte, período e data de coleta;
          onde não há dado carregado, a tela diz isso.
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExplorerTrail
          stateName={state.uf ? ufName : null}
          municipalityName={municipalityName}
          onCountry={() => go({ uf: null, municipality: null }, true)}
          onState={() => go({ municipality: null }, true)}
        />
        <div role="group" aria-label="Modo do mapa" className="segmented" data-testid="explorer-modes">
          {EXPLORER_MODES.map((m) => (
            <button key={m} type="button" aria-pressed={state.mode === m} onClick={() => go({ mode: m })} className={SEGMENT}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {level !== "country" && mode.controls && <section aria-label="Recorte" className="rounded-xl border border-line bg-surface p-4">{mode.controls}</section>}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Vista do mapa" className="segmented" data-testid="explorer-views">
          {EXPLORER_VIEWS.map((v) => {
            const reason = viewReason(v, level, mode, allowRelief);
            const locked = v !== "mapa" && advanced.allowed === false;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={effectiveView === v}
                disabled={!!reason}
                title={reason ?? (locked ? `${VIEW_LABEL[v]}: plano ${advanced.planName ?? "Avançado"}` : undefined)}
                onClick={() => go({ view: v })}
                className={SEGMENT}
              >
                {VIEW_LABEL[v]}
                {locked && !reason && <span className="ml-1 text-micro text-fg-muted">· plano</span>}
              </button>
            );
          })}
        </div>
        {state.view !== "mapa" && advanced.allowed === false && <PlanGateNote capability={ADVANCED_MAP_MODES} className="w-full" />}
        {effectiveView === "comparar" && !mode.compare && mode.compareNote && <p className="text-micro text-fg-muted">{mode.compareNote}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3">
          <div className="relative h-[58vh] min-h-[360px] lg:h-[640px]">
            {(mode.loading || coverageQ.isFetching) && <div className="query-trace absolute inset-x-3 top-0 z-30" aria-hidden="true" />}
            <TerritoryCanvas
              level={level}
              stateCode={stateCode}
              municipality={state.municipality}
              layer={layer}
              view={effectiveView}
              before={comparing ? mode.compare!.before : null}
              afterLabel={mode.compare?.afterLabel}
              hovered={hovered}
              onHover={setHovered}
              onSelect={(target, code) => (target === "state" ? selectState(code) : go({ municipality: code }, true))}
              reduced={reduced}
              allowRelief={allowRelief}
              label={`Mapa de ${place}${layer ? `: ${layer.caption}` : ""}`}
            />
          </div>
          {(layer?.legend || comparing) && (
            <div className={`flex flex-wrap gap-6 rounded-xl border border-line bg-surface p-3 ${comparing ? "" : "sm:hidden"}`}>
              {comparing && mode.compare?.before.layer.legend && <MapLegend legend={mode.compare.before.layer.legend} heading={`Esquerda · ${mode.compare.before.label}`} />}
              {layer?.legend && <MapLegend legend={layer.legend} heading={comparing ? `Direita · ${mode.compare?.afterLabel}` : undefined} />}
              {!comparing && viewNote(effectiveView, layer) && <p className="text-micro text-fg-muted">{viewNote(effectiveView, layer)}</p>}
            </div>
          )}
        </div>
        <ReadingPanel kind={KIND[level]} title={place} reading={reading} profile={profile} loading={mode.loading} />
      </div>

      {coverageQ.isError && !coverageQ.data && (
        <DataState kind="error" title="Não foi possível carregar a cobertura dos dados" action={<RetryButton onRetry={() => void coverageQ.refetch()} />} />
      )}
      {level !== "country" && mode.error && <DataState kind="error" title={mode.error} action={mode.retry ? <RetryButton onRetry={mode.retry} /> : undefined} />}

      {level === "country" ? <CountryGuide /> : mode.analysis}

      {table && (
        <TerritoryTable
          key={`${level}:${state.mode}:${state.uf}`}
          caption={table.caption}
          columns={table.columns}
          rows={table.rows}
          selected={level === "country" ? null : state.municipality}
          hovered={hovered}
          onHover={setHovered}
          onSelect={(code) => (level === "country" ? selectState(code) : go({ municipality: code }, true))}
          initialSort={table.initialSort}
          noun={level === "country" ? "UFs" : "municípios"}
          actions={table.actions}
          missingLabel={table.missingLabel}
        />
      )}
    </main>
  );
}

const KIND: Record<ExplorerLevel, string> = { country: "País", state: "Unidade da federação", municipality: "Município" };

function viewReason(view: ExplorerView, level: ExplorerLevel, mode: ModeView, allowRelief: boolean): string | null {
  if (view === "mapa") return null;
  if (level === "country") return "Escolha uma UF no mapa para esta vista.";
  if (!mode.views.includes(view)) return "Esta vista não se aplica a este dado.";
  if (view === "relevo" && !allowRelief) return "O relevo 3D fica disponível em telas maiores, com mouse.";
  if (view === "comparar" && !mode.compare && mode.compareNote) return mode.compareNote;
  return null;
}

function countryReading(coverage: DataCoverage | undefined, mode: ExplorerMode, loading: boolean): ReadingModel {
  if (!coverage) return { what: loading ? "Carregando o que está disponível em cada UF…" : "Cobertura indisponível no momento.", facts: [] };
  const withData = statesWithData(coverage, mode);
  return {
    what: `${withData.length} de ${UFS.length} UFs têm dados ${MODE_NOUN[mode]} carregados. Toda UF tem malha municipal oficial do IBGE para navegar; os valores aparecem só onde há dado.`,
    facts: withData.map((s) => ({ label: s.uf, text: availabilityText(s, mode) })),
    notice: withData.length === 0 ? `Ainda não há dados ${MODE_NOUN[mode]} carregados em nenhuma UF.` : null,
  };
}

function countryTable(coverage: DataCoverage | undefined, ufs: TerritoryCollection | undefined, mode: ExplorerMode): TableModel | null {
  if (!ufs) return null;
  const rows: TableRow[] = ufs.features.map((f) => {
    const state = coverage?.states.find((s) => s.uf === f.properties.uf) ?? null;
    const loaded = hasData(state, mode);
    return {
      code: f.properties.code,
      name: `${f.properties.name} (${f.properties.uf})`,
      cells: { available: availabilityText(state, mode) },
      sort: { available: loaded ? 1 : 0 },
      missing: !loaded,
    };
  });
  return {
    caption: `${MODE_LABEL[mode]}: o que está carregado em cada UF`,
    columns: [{ key: "available", label: "Disponível" }],
    rows,
    initialSort: { key: "available", dir: "desc" },
  };
}

function CountryGuide() {
  return (
    <section aria-labelledby="guide-title" className="rounded-xl border border-line bg-surface p-4" data-testid="explorer-guide">
      <h2 id="guide-title" className="font-semibold text-fg">Como usar</h2>
      <ol className="mt-2 grid gap-3 text-body-sm text-fg-soft sm:grid-cols-3">
        <li><span className="font-semibold text-fg">1. Escolha o modo.</span> Socioeconômico, eleitoral ou emendas: o mapa mostra onde cada um tem dado.</li>
        <li><span className="font-semibold text-fg">2. Clique numa UF.</span> O mapa aproxima e pinta os municípios; a tabela abaixo traz os mesmos valores.</li>
        <li><span className="font-semibold text-fg">3. Clique num município.</span> O painel mostra o valor, a posição na UF e de onde o dado veio.</li>
      </ol>
      <p className="mt-3 text-micro text-fg-muted">Cor no mapa indica valor ou cobertura, nunca partido, ideologia ou avaliação de quem governa.</p>
    </section>
  );
}
