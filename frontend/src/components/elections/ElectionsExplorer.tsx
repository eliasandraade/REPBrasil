"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { electionsApi, type ResultQuery } from "@/lib/elections/api";
import { pad3, sectionLabel, sourceDate, zoneLabel } from "@/lib/elections/format";
import { buildElectionsPath, levelOf, parentRoute, parseElectionsPath, type ExplorerRoute } from "@/lib/elections/route";
import { useReducedMotion } from "@/motion/reduced-motion";
import { cssEasing, duration } from "@/motion/tokens";
import { buildZoneModel } from "@/lib/elections/zone-model";
import { parseSelection, serializeSelection, toggleSelection, xrayApi } from "@/lib/elections/xray";
import type { MapLayerKind } from "@/lib/elections/xray-types";
import { CountryPanel, MunicipalityPanel, StatePanel, ZonePanel } from "./ExplorerPanels";
import { partiesApi, resultFor } from "@/lib/parties";
import { CompareTray, MapLayerBar, useMapLayer, useSelectionNames, type LayerState } from "./ExplorerTools";
import { SectionResults, type VoteTypeFilter } from "./SectionResults";
import { TerritoryCandidates } from "./TerritoryCandidates";
import { TerritoryMap, type MapPoint, type MapScope } from "./TerritoryMap";

const LAYER_KINDS: ReadonlySet<MapLayerKind> = new Set(["intensity", "share", "winner", "growth", "decline", "ab", "base", "party"]);

const ibge = (code: number | null | undefined) => (code == null ? null : String(code));
const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

function Notice({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-8 text-center" data-testid="explorer-notice">
      <p className="font-medium text-fg-soft">{title}</p>
      {children && <p className="mt-1 text-sm text-fg-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Troca de eleição sem perder o lugar: mantém UF e município; zona e seção mudam de uma eleição para outra e
 * caem; cargo, camada e seleção também (candidaturas são de cada eleição).
 */
function ElectionSwitcher({ route }: Readonly<{ route: ExplorerRoute }>) {
  const router = useRouter();
  const search = useSearchParams();
  const { data } = useQuery({ queryKey: ["el-elections"], queryFn: electionsApi.elections, staleTime: 10 * 60_000 });
  const elections = data?.elections ?? [];
  const current = `${route.year}-${route.round}`;
  if (elections.length < 2 || !elections.some((e) => `${e.year}-${e.round}` === current)) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      Eleição
      <select
        value={current}
        onChange={(e) => {
          const [year, round] = e.target.value.split("-").map(Number);
          const painel = search.get("painel");
          const path = buildElectionsPath({ year, round, state: route.state, municipality: route.municipality });
          router.push(painel ? `${path}?painel=${encodeURIComponent(painel)}` : path, { scroll: false });
        }}
        className="focus-ring rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg-soft"
        data-testid="election-switcher"
      >
        {elections.map((e) => (
          <option key={`${e.year}-${e.round}`} value={`${e.year}-${e.round}`}>
            {e.year} · {e.round}º turno
          </option>
        ))}
      </select>
    </label>
  );
}

/** Esqueleto do painel: título + linhas com a altura das linhas reais. */
function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <div className="mb-4 space-y-1.5" aria-hidden="true">
        <div className="skeleton h-2.5 w-16" />
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-3 w-56" />
      </div>
      <div className="space-y-1.5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-[42px] rounded-lg" />
        ))}
      </div>
    </div>
  );
}

const LEVELS = ["country", "state", "municipality", "zone", "section"] as const;

/**
 * Zoom semântico do painel: ao mudar de camada do território, o novo nível
 * entra pelo lado da direção (aprofundar → da direita; emergir → da esquerda).
 * Na mesma camada (outra seção, outra zona), só uma troca curta de opacidade.
 * Nunca mantém o conteúdo anterior na tela: só a entrada é animada.
 */
function useDepthEntrance(level: string, key: string, reduced: boolean) {
  const ref = useRef<HTMLElement>(null);
  const prev = useRef({ level, key });
  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = { level, key };
    if (reduced || (from.level === level && from.key === key)) return;
    const a = LEVELS.indexOf(from.level as (typeof LEVELS)[number]);
    const b = LEVELS.indexOf(level as (typeof LEVELS)[number]);
    const frames: Keyframe[] =
      b === a
        ? [{ opacity: 0.4 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: `translateX(${b > a ? 14 : -14}px)` },
            { opacity: 1, transform: "none" },
          ];
    ref.current?.animate?.(frames, { duration: b === a ? duration.settle : duration.traverse, easing: cssEasing("enter") });
  }, [level, key, reduced]);
  return ref;
}

function PanelFrame({ level, frameKey, reduced, children }: Readonly<{ level: string; frameKey: string; reduced: boolean; children: React.ReactNode }>) {
  const ref = useDepthEntrance(level, frameKey, reduced);
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} data-panel-level={level}>
      {children}
    </div>
  );
}

/**
 * Explorador eleitoral do REPBrasil: Brasil → UF → município → zona → seção →
 * resultado → candidatura → perfil. A URL é a fonte de verdade do território
 * (deep link, refresh, voltar/avançar); cargo e tipo de voto ficam em search
 * params. Tudo vem do catálogo (cadastro oficial importado): nenhum município
 * é especial; uma zona ⇒ seleção automática; várias ⇒ o usuário escolhe.
 */
export function ElectionsExplorer() {
  const pathname = usePathname() ?? "/eleicoes";
  const router = useRouter();
  const search = useSearchParams();
  const reduced = useReducedMotion();
  const parsed = parseElectionsPath(pathname);
  const [placeFilter, setPlaceFilter] = useState<string | null>(null);
  // Trilha territorial: só segmentos acrescentados depois da primeira pintura se estendem.
  const explorerMounted = useRef(false);
  useEffect(() => {
    explorerMounted.current = true;
  }, []);
  const extendCrumb = useCallback((el: HTMLElement | null) => {
    if (el && explorerMounted.current) el.classList.add("crumb-extend");
  }, []);

  // Sem rota válida as consultas ficam desabilitadas (enabled: !!parsed): 0 nunca chega à API.
  const year = parsed?.year ?? 0;
  const round = parsed?.round ?? 0;
  const uf = parsed?.state ?? null;
  const munKey = parsed?.municipality ?? null;

  const statesQ = useQuery({
    queryKey: ["el-states", year, round],
    queryFn: () => electionsApi.states(year, round),
    enabled: !!parsed,
    retry: (n, e) => !isNotFound(e) && n < 1,
  });
  const munsQ = useQuery({
    queryKey: ["el-muns", year, round, uf],
    queryFn: () => electionsApi.municipalities(year, round, uf!),
    enabled: !!parsed && !!uf,
    retry: (n, e) => !isNotFound(e) && n < 1,
  });
  const munQ = useQuery({
    queryKey: ["el-mun", year, round, uf, munKey],
    queryFn: () => electionsApi.municipality(year, round, uf!, munKey!),
    enabled: !!parsed && !!uf && !!munKey,
    retry: (n, e) => !isNotFound(e) && n < 1,
  });
  const mun = munQ.data;
  const canonical = mun?.municipality.slug ?? munKey;
  const zoneListed = mun?.status === "available" && parsed?.zone != null && mun.zones.some((z) => z.number === parsed.zone);
  const zoneQ = useQuery({
    queryKey: ["el-zone", year, round, uf, canonical, parsed?.zone],
    queryFn: () => electionsApi.zone(year, round, uf!, canonical!, parsed!.zone!),
    enabled: !!zoneListed,
  });
  const zoneModel = useMemo(() => (zoneQ.data ? buildZoneModel(zoneQ.data) : null), [zoneQ.data]);
  const sectionDetail = parsed?.section != null && zoneModel ? zoneModel.getSection(parsed.section) : null;

  const office = Number(search.get("cargo")) || undefined;
  const voteType = (search.get("tipo") as VoteTypeFilter | null) ?? "todos";
  const resultQuery: ResultQuery = { office, voteType: voteType === "todos" ? undefined : voteType };
  const resultsQ = useQuery({
    queryKey: ["el-results", year, round, uf, canonical, parsed?.zone, parsed?.section, resultQuery.office, resultQuery.voteType],
    queryFn: () => electionsApi.sectionResults(year, round, uf!, canonical!, parsed!.zone!, parsed!.section!, resultQuery),
    enabled: !!sectionDetail && !sectionDetail.isAggregated,
    // Sem placeholder: o resultado de uma seção nunca é exibido sob a rota de outra.
  });

  // Defesa em profundidade: só aceita resultado cuja identidade territorial é a da rota atual
  // (UF, município, zona e seção pedida). Qualquer outro dado é tratado como carregando.
  const resultsData = resultsQ.data;
  const sectionData =
    resultsData &&
    !resultsQ.isPlaceholderData &&
    resultsData.requestedSection === parsed?.section &&
    resultsData.territory.zone === parsed?.zone &&
    resultsData.territory.uf.toLowerCase() === uf &&
    resultsData.territory.municipality.slug === canonical
      ? resultsData
      : null;

  // Município por código TSE/IBGE na URL → canoniza para o slug do catálogo.
  useEffect(() => {
    if (!parsed || !munKey || !mun || mun.municipality.slug === munKey) return;
    router.replace(buildElectionsPath({ ...parsed, municipality: mun.municipality.slug }), { scroll: false });
    // parsed deriva do pathname
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mun, munKey, pathname, router]);

  // Zona única ⇒ seleção automática (replace: voltar não cai num laço).
  const singleZone = mun?.status === "available" && mun.zones.length === 1 ? mun.zones[0].number : null;
  useEffect(() => {
    if (!parsed || levelOf(parsed) !== "municipality" || singleZone == null || mun?.municipality.slug !== canonical) return;
    router.replace(buildElectionsPath({ ...parsed, municipality: canonical!, zone: singleZone }), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, singleZone, canonical]);

  // Troca de zona/seção: o filtro de local deixa de valer.
  const zoneKey = `${uf}/${canonical}/${parsed?.zone}`;
  const lastZone = useRef(zoneKey);
  if (lastZone.current !== zoneKey) {
    lastZone.current = zoneKey;
    if (placeFilter) setPlaceFilter(null);
  }

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [pathname, router, search],
  );
  const setParam = useCallback((key: string, value: string | null) => setParams({ [key]: value }), [setParams]);

  // Painel (território × candidaturas), seleção de comparação (máx. 5) e camada do mapa vivem na URL.
  const panelMode = search.get("painel") === "candidaturas" ? "candidates" : "territory";
  const selection = parseSelection(search.get("c"));
  const [limitHit, setLimitHit] = useState(false);
  const toggleCompare = (id: string) => {
    const r = toggleSelection(selection, id);
    setLimitHit(r.rejected);
    if (!r.rejected) setParam("c", r.ids.length ? serializeSelection(r.ids) : null);
  };
  const layerParam = search.get("camada") as MapLayerKind | null;
  const layerState: LayerState = {
    layer: layerParam && LAYER_KINDS.has(layerParam) ? layerParam : null,
    office: Number(search.get("cargo")) || null,
    candidacy: search.get("candidatura"),
    base: search.get("base"),
    a: search.get("a"),
    b: search.get("b"),
    party: Number(search.get("partido")) || null,
  };
  const onLayerChange = (next: Partial<LayerState>) =>
    setParams({
      ...("layer" in next ? { camada: next.layer ?? null } : {}),
      ...("office" in next ? { cargo: next.office ? String(next.office) : null } : {}),
      ...("candidacy" in next ? { candidatura: next.candidacy ?? null } : {}),
      ...("base" in next ? { base: next.base ?? null } : {}),
      ...("a" in next ? { a: next.a ?? null } : {}),
      ...("b" in next ? { b: next.b ?? null } : {}),
      ...("party" in next ? { partido: next.party ? String(next.party) : null } : {}),
    });

  const states = statesQ.data?.states ?? null;
  const stateRow = states?.find((s) => s.slug === uf) ?? null;
  const municipalities = munsQ.data?.municipalities ?? null;
  const ufCode = stateRow?.uf ?? (uf ? uf.toUpperCase() : null);
  const munTse = mun?.status === "available" ? mun.municipality.tseCode : null;
  const names = useSelectionNames(selection, ufCode);
  // candidaturas da camada vindas só da URL (link compartilhado): nomes também nos seletores do mapa
  const layerIds = [layerState.candidacy, layerState.base, layerState.a, layerState.b].filter(
    (id): id is string => !!id && !selection.includes(id),
  );
  const layerNames = useSelectionNames([...new Set(layerIds)], ufCode);
  const mapNames = useMemo(() => new Map([...layerNames, ...names]), [layerNames, names]);
  const officesQ = useQuery({
    queryKey: ["el-offices", year, round, ufCode, munTse],
    queryFn: () => xrayApi.candidates(year, round, ufCode!, { municipality: munTse, pageSize: 1 }),
    enabled: !!parsed && !!ufCode && (layerState.layer === "winner" || layerState.layer === "party"),
    staleTime: 5 * 60_000,
  });
  const partiesQ = useQuery({
    queryKey: ["parties", ufCode],
    queryFn: () => partiesApi.list(ufCode!),
    enabled: !!ufCode && layerState.layer === "party",
    staleTime: 5 * 60_000,
  });
  const partyOptions = useMemo(() => {
    if (!partiesQ.data || !layerState.office) return [];
    return partiesQ.data.parties
      .flatMap((p) => {
        const r = resultFor(p, year, round, layerState.office!);
        return r ? [{ value: r.partyNumber, label: `${p.acronym} (${r.partyNumber})`, votes: r.votes ?? -1 }] : [];
      })
      .sort((a, b) => b.votes - a.votes || a.label.localeCompare(b.label, "pt-BR"));
  }, [partiesQ.data, layerState.office, year, round]);
  // número de partido vindo da URL que não concorreu no cargo escolhido (ex.: cargo trocado): não é pedido ao mapa
  const partyListed = !layerState.party || partyOptions.some((o) => o.value === layerState.party);
  const mapLayer = useMapLayer(year, round, ufCode, munTse, partyListed ? layerState : { ...layerState, party: null });

  const scope: MapScope = useMemo(
    () => ({
      state: ibge(stateRow?.ibgeCode),
      municipality: ibge(mun?.municipality.ibgeCode),
      interactiveStates: (states ?? []).filter((s) => s.cadasterAvailable).flatMap((s) => ibge(s.ibgeCode) ?? []),
      highlightStates: (states ?? []).filter((s) => s.resultsAvailable).flatMap((s) => ibge(s.ibgeCode) ?? []),
      interactiveMunicipalities: (municipalities ?? []).filter((m) => m.cadasterAvailable).flatMap((m) => ibge(m.ibgeCode) ?? []),
      highlightMunicipalities: (municipalities ?? []).filter((m) => m.resultsAvailable).flatMap((m) => ibge(m.ibgeCode) ?? []),
    }),
    [stateRow, mun, states, municipalities],
  );
  const points: MapPoint[] = useMemo(
    () =>
      (zoneModel?.places ?? []).flatMap((p) =>
        p.coordinates ? [{ code: p.code, latitude: p.coordinates.latitude, longitude: p.coordinates.longitude }] : [],
      ),
    [zoneModel],
  );

  if (!parsed) {
    return <Notice title="Endereço inválido" action={<Link href="/eleicoes" className="text-sm text-accent-text hover:underline">Ir para Eleições</Link>} />;
  }

  const route: ExplorerRoute = { ...parsed, municipality: canonical ?? undefined };
  const level = levelOf(route);
  const notFound =
    (statesQ.isError && isNotFound(statesQ.error)) ||
    (states && uf && !stateRow) ||
    (munQ.isError && isNotFound(munQ.error)) ||
    (mun?.status === "available" && parsed.zone != null && !zoneListed) ||
    (parsed.section != null && zoneModel && !sectionDetail);
  const failed = [statesQ, munsQ, munQ, zoneQ].some((q) => q.isError && !isNotFound(q.error));

  const crumbs = [
    { label: `Eleições ${route.year} · ${route.round}º turno`, href: buildElectionsPath({ year: route.year, round: route.round }) },
    ...(stateRow ? [{ label: stateRow.name, href: buildElectionsPath({ year: route.year, round: route.round, state: stateRow.slug }) }] : []),
    ...(mun ? [{ label: mun.municipality.name, href: buildElectionsPath({ year: route.year, round: route.round, state: uf!, municipality: canonical! }) }] : []),
    ...(route.zone != null && zoneModel ? [{ label: zoneLabel(route.zone), href: buildElectionsPath({ ...route, section: undefined }) }] : []),
    ...(route.section != null && zoneModel ? [{ label: sectionLabel(route.section), href: buildElectionsPath(route) }] : []),
  ];

  const onMapSelect = (target: "state" | "municipality", code: string) => {
    if (target === "state") {
      const s = states?.find((x) => ibge(x.ibgeCode) === code);
      if (s) router.push(buildElectionsPath({ year: route.year, round: route.round, state: s.slug }), { scroll: false });
      return;
    }
    const m = municipalities?.find((x) => ibge(x.ibgeCode) === code);
    if (m) router.push(buildElectionsPath({ year: route.year, round: route.round, state: m.uf.toLowerCase(), municipality: m.slug }), { scroll: false });
  };

  let panel: React.ReactNode;
  if (notFound) {
    panel = (
      <Notice
        title="Território não encontrado"
        action={<Link href={buildElectionsPath(parentRoute(route))} className="text-sm text-accent-text hover:underline">Voltar um nível</Link>}
      >
        Este endereço não corresponde a um território do cadastro oficial importado.
      </Notice>
    );
  } else if (failed) {
    panel = (
      <Notice
        title="Não foi possível carregar o catálogo eleitoral"
        action={
          <button
            type="button"
            onClick={() => [statesQ, munsQ, munQ, zoneQ].forEach((q) => q.isError && q.refetch())}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-fg-soft hover:border-line-strong"
          >
            Tentar novamente
          </button>
        }
      >
        Falha de comunicação não é ausência de dados.
      </Notice>
    );
  } else if (panelMode === "candidates" && ufCode && level !== "country") {
    panel = (
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          {[stateRow?.name, mun?.municipality.name, route.zone != null ? zoneLabel(route.zone) : null].filter(Boolean).join(" · ")}
        </p>
        <h2 className="mb-3 text-lg font-bold leading-tight text-fg">Candidaturas no território</h2>
        <TerritoryCandidates
          year={route.year}
          round={route.round}
          uf={ufCode}
          municipality={munTse}
          zone={route.zone ?? null}
          selection={selection}
          limitHit={limitHit}
          onToggleCompare={toggleCompare}
          onShowOnMap={(id) => setParams({ camada: "intensity", candidatura: id })}
        />
      </div>
    );
  } else if (level === "country") {
    panel = states ? <CountryPanel route={route} states={states} /> : <Skeleton />;
  } else if (level === "state") {
    panel = stateRow && municipalities ? <StatePanel route={route} state={stateRow} municipalities={municipalities} /> : <Skeleton />;
  } else if (level === "municipality") {
    panel = mun ? <MunicipalityPanel route={route} detail={mun} /> : <Skeleton />;
  } else {
    const zoneRow = mun?.zones.find((z) => z.number === route.zone);
    panel =
      zoneModel && mun ? (
        <ZonePanel
          route={route}
          zone={zoneModel}
          municipalityName={`${mun.municipality.name}/${mun.municipality.uf}`}
          singleZone={mun.zones.length === 1}
          resultsAvailable={!!zoneRow?.resultsAvailable}
          placeFilter={placeFilter}
          onClearPlace={() => setPlaceFilter(null)}
        />
      ) : (
        <Skeleton />
      );
  }

  const showResults = !notFound && level === "section" && !!sectionDetail;
  const panelLevel = level === "section" ? "zone" : level;
  const cadasterDate = sourceDate(zoneQ.data?.provenance?.sourceGeneratedAt ?? mun?.provenance?.sourceGeneratedAt);

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 sm:px-6" data-level={level}>
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="Navegação territorial" className="flex flex-wrap items-center gap-1 text-xs text-fg-muted" data-testid="breadcrumb">
          <Link href="/eleicoes" className="focus-ring rounded hover:text-fg-soft">
            Eleições
          </Link>
          {crumbs.map((c, i) => (
            <span key={c.href} ref={extendCrumb} className="flex items-center gap-1">
              <span aria-hidden="true">/</span>
              {i === crumbs.length - 1 ? (
                <span className="text-fg-soft" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="focus-ring rounded hover:text-fg-soft">
                  {c.label}
                </Link>
              )}
            </span>
          ))}
        </nav>
        <ElectionSwitcher route={route} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
          <aside className="rounded-xl border border-line bg-surface p-4" aria-label="Exploração territorial" data-testid="explorer-panel">
            {level !== "country" && !notFound && (
              <div role="tablist" aria-label="Conteúdo do painel" className="mb-3 flex gap-1 rounded-lg border border-line bg-canvas/40 p-0.5 text-xs">
                {(
                  [
                    ["territory", "Território"],
                    ["candidates", "Candidaturas"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={panelMode === id}
                    onClick={() => setParam("painel", id === "candidates" ? "candidaturas" : null)}
                    className={`flex-1 rounded-md px-2 py-1 ${panelMode === id ? "bg-accent/15 text-accent-text" : "text-fg-muted hover:text-fg-soft"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <PanelFrame level={panelLevel} frameKey={`${uf}/${canonical}/${route.zone}/${panelMode}`} reduced={reduced}>
              {panel}
            </PanelFrame>
          </aside>
          <div className="relative min-h-[360px] lg:sticky lg:top-6 lg:h-[calc(100vh-7rem)]">
            {showResults ? (
              <div className="h-full overflow-y-auto rounded-xl border border-line bg-surface p-4">
                <SectionResults
                  route={route}
                  municipalityName={mun ? `${mun.municipality.name}/${mun.municipality.uf}` : ""}
                  data={sectionData}
                  status={resultsQ.isError ? "error" : sectionData ? "ready" : "loading"}
                  isAggregatedInCadaster={sectionDetail!.isAggregated}
                  principalNumber={sectionDetail!.principalNumber}
                  voteType={voteType}
                  onOffice={(code) => setParam("cargo", String(code))}
                  onVoteType={(v) => setParam("tipo", v === "todos" ? null : v)}
                  closeHref={buildElectionsPath({ ...route, section: undefined })}
                  onRetry={() => resultsQ.refetch()}
                />
              </div>
            ) : (
              <div className="flex h-full flex-col">
                {ufCode && level !== "country" && (
                  <MapLayerBar
                    state={layerState}
                    onChange={onLayerChange}
                    selection={selection}
                    names={mapNames}
                    offices={officesQ.data?.offices ?? []}
                    parties={partyOptions}
                    note={mapLayer.view?.note ?? null}
                    loading={mapLayer.loading}
                    error={mapLayer.error}
                    disabled={false}
                  />
                )}
                <div className="relative min-h-[320px] flex-1">
                  <TerritoryMap
                    level={level}
                    routeKey={pathname}
                    scope={scope}
                    points={level === "zone" && !mapLayer.view ? points : []}
                    reduced={reduced}
                    onSelect={onMapSelect}
                    onSelectPlace={setPlaceFilter}
                    layer={level === "country" ? null : mapLayer.view}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <CompareTray
          selection={selection}
          names={names}
          uf={ufCode}
          onRemove={toggleCompare}
          onClear={() => setParam("c", null)}
        />

        <p className="mt-4 text-[11px] text-fg-muted">
          Fonte: Tribunal Superior Eleitoral (cadastro eleitoral e Boletins de Urna, Dados Abertos) e IBGE (malhas).
          {cadasterDate && ` Cadastro gerado pelo TSE em ${cadasterDate}.`} Dados eleitorais são descritivos e não alteram o Score.
          {route.section != null && sectionDetail?.isAggregated && ` Seção ${pad3(route.section)} agregada.`}
        </p>
      </div>
    </main>
  );
}
