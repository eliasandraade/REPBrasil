"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { electionsApi, type ResultQuery } from "@/lib/elections/api";
import { pad3, sectionLabel, sourceDate, zoneLabel } from "@/lib/elections/format";
import { buildElectionsPath, levelOf, parentRoute, parseElectionsPath, type ExplorerRoute } from "@/lib/elections/route";
import { useReducedMotion } from "@/lib/elections/reduced-motion";
import { buildZoneModel } from "@/lib/elections/zone-model";
import { CountryPanel, MunicipalityPanel, StatePanel, ZonePanel } from "./ExplorerPanels";
import { SectionResults, type VoteTypeFilter } from "./SectionResults";
import { TerritoryMap, type MapPoint, type MapScope } from "./TerritoryMap";

const ibge = (code: number | null | undefined) => (code == null ? null : String(code));
const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

function Notice({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/8 bg-card px-5 py-8 text-center" data-testid="explorer-notice">
      <p className="font-medium text-slate-200">{title}</p>
      {children && <p className="mt-1 text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Carregando">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-11 animate-pulse rounded-lg bg-card-elevated" />
      ))}
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

  // Sem rota válida as consultas ficam desabilitadas (enabled: !!parsed): 0 nunca chega à API.
  const year = parsed?.year ?? 0;
  const round = parsed?.round ?? 0;
  const uf = parsed?.state ?? null;
  const munKey = parsed?.municipality ?? null;

  const statesQ = useQuery({ queryKey: ["el-states", year, round], queryFn: () => electionsApi.states(year, round), enabled: !!parsed });
  const munsQ = useQuery({
    queryKey: ["el-muns", year, round, uf],
    queryFn: () => electionsApi.municipalities(year, round, uf!),
    enabled: !!parsed && !!uf,
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

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(search.toString());
      if (value === null) params.delete(key);
      else params.set(key, value);
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [pathname, router, search],
  );

  const states = statesQ.data?.states ?? null;
  const stateRow = states?.find((s) => s.slug === uf) ?? null;
  const municipalities = munsQ.data?.municipalities ?? null;

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
    return <Notice title="Endereço inválido" action={<Link href="/eleicoes" className="text-sm text-brand hover:underline">Ir para Eleições</Link>} />;
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
        action={<Link href={buildElectionsPath(parentRoute(route))} className="text-sm text-brand hover:underline">Voltar um nível</Link>}
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
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:border-white/30"
          >
            Tentar novamente
          </button>
        }
      >
        Falha de comunicação não é ausência de dados.
      </Notice>
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
  const cadasterDate = sourceDate(zoneQ.data?.provenance?.sourceGeneratedAt ?? mun?.provenance?.sourceGeneratedAt);

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:px-6" data-level={level}>
      <div className="mx-auto max-w-7xl">
        <nav aria-label="Navegação territorial" className="mb-4 flex flex-wrap items-center gap-1 text-xs text-slate-500" data-testid="breadcrumb">
          <Link href="/eleicoes" className="hover:text-slate-300">
            Eleições
          </Link>
          {crumbs.map((c, i) => (
            <span key={c.href} className="flex items-center gap-1">
              <span aria-hidden="true">/</span>
              {i === crumbs.length - 1 ? (
                <span className="text-slate-300" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="hover:text-slate-300">
                  {c.label}
                </Link>
              )}
            </span>
          ))}
        </nav>

        <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
          <aside className="rounded-xl border border-white/8 bg-card p-4" aria-label="Exploração territorial" data-testid="explorer-panel">
            {panel}
          </aside>
          <div className="relative min-h-[360px] lg:sticky lg:top-6 lg:h-[calc(100vh-7rem)]">
            {showResults ? (
              <div className="h-full overflow-y-auto rounded-xl border border-white/8 bg-card p-4">
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
              <TerritoryMap
                level={level}
                routeKey={pathname}
                scope={scope}
                points={level === "zone" ? points : []}
                reduced={reduced}
                onSelect={onMapSelect}
                onSelectPlace={setPlaceFilter}
              />
            )}
          </div>
        </div>

        <p className="mt-4 text-[11px] text-slate-600">
          Fonte: Tribunal Superior Eleitoral (cadastro eleitoral e Boletins de Urna, Dados Abertos) e IBGE (malhas).
          {cadasterDate && ` Cadastro gerado pelo TSE em ${cadasterDate}.`} Dados eleitorais são descritivos e não alteram o Score.
          {route.section != null && sectionDetail?.isAggregated && ` Seção ${pad3(route.section)} agregada.`}
        </p>
      </div>
    </main>
  );
}
