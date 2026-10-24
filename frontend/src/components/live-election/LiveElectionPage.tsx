"use client";

import "./live-election.css";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { sendProductEvent } from "@/lib/live-election/api";
import type { BrazilMapShapes } from "@/lib/live-election/map-shapes";
import { createLiveStore, initialLiveState } from "@/lib/live-election/store";
import { LiveStreamClient } from "@/lib/live-election/stream";
import type { LiveEnvelope, LiveStatesPayload, LiveSummary } from "@/lib/live-election/types";
import { prefersReducedMotion } from "@/motion/reduced-motion";
import { PhaseBanners } from "./Banners";
import { BrazilElectionMap, ExteriorCard } from "./BrazilElectionMap";
import { LastToTotalize, RegionBreakdown, RemainingVotesPanel, TerritorialSummaryCard } from "./Breakdowns";
import { LazySection, LiveAnnouncer, NotifyButton } from "./Extras";
import { Hero, HeroSkeleton } from "./Hero";
import { LiveStoreProvider, useLive } from "./LiveContext";
import { DistanceCard } from "./MathStatus";
import { MethodologyButton, MethodologyContent } from "./Methodology";
import { Completeness, NationalMetrics } from "./NationalMetrics";
import { SectionHeading } from "./primitives";
import { SourceStatusLine, VelocityPanel } from "./SourceStatus";
import { StateResultsTable } from "./StateTable";
import { ElectionTimeline } from "./Timeline";

const chartSkeleton = () => <div className="skeleton h-[520px] rounded-2xl" aria-hidden="true" />;
const listSkeleton = () => <div className="skeleton h-[600px] rounded-2xl" aria-hidden="true" />;

// Abaixo da dobra e sob demanda: cada bloco é um pedaço de JavaScript separado.
const EvolutionCharts = dynamic(() => import("./Charts").then((m) => m.EvolutionCharts), { ssr: false, loading: chartSkeleton });
const RankingsPanel = dynamic(() => import("./Rankings").then((m) => m.RankingsPanel), { ssr: false, loading: listSkeleton });
const MunicipalityExplorer = dynamic(() => import("./MunicipalityExplorer").then((m) => m.MunicipalityExplorer), { ssr: false, loading: listSkeleton });
const FirstRoundSection = dynamic(() => import("./FirstRound").then((m) => m.FirstRoundSection), { ssr: false, loading: listSkeleton });
const StateDrawer = dynamic(() => import("./StateDrawer").then((m) => m.StateDrawer), { ssr: false });

/** Campos especializados da eleição e da fonte (nível técnico). */
function TechnicalFacts() {
  const election = useLive((s) => s.summary?.election ?? null);
  const meta = useLive((s) => s.summaryMeta);
  const official = useLive((s) => s.summary?.official ?? null);
  if (!election) return null;
  const rows: [string, string][] = [
    ["Eleição (código TSE)", String(election.electionCode)],
    ["1º turno (código TSE)", election.firstRoundElectionCode ? String(election.firstRoundElectionCode) : "—"],
    ["Pleito", election.pleitoCode ? String(election.pleitoCode) : "—"],
    ["Cargo", `${election.officeName} (${String(election.officeCode).padStart(4, "0")})`],
    ["Ciclo · ambiente", `${election.cycle} · ${election.environment}`],
    ["Modo de dados", election.mode === "official" ? "oficial" : election.mode === "simulation" ? "simulação do TSE" : "replay (teste)"],
    ["Andamento (and)", official ? official.progress : "—"],
    ["Totalização final (tf)", official ? (official.finalTotalization ? "sim" : "não") : "—"],
    ["Matematicamente definido (md)", official?.mathematicallyDefinedFlag ?? "ausente"],
    ["Divulgação de votos (dv)", official ? (official.votesReleased ? "liberada" : "não liberada") : "—"],
    ["Versão do snapshot", meta ? String(meta.snapshotVersion) : "—"],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-body-sm sm:grid-cols-2" data-testid="live-technical-facts">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1.5">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="tabular text-right font-medium text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function PageBody({ mapShapes }: Readonly<{ mapShapes: BrazilMapShapes }>) {
  const hasSummary = useLive((s) => s.summary !== null);
  const hasStates = useLive((s) => s.states !== null);
  const [drawerUf, setDrawerUf] = useState<string | null>(null);
  const [explorerUf, setExplorerUf] = useState("SP");
  const explorerRef = useRef<HTMLDivElement>(null);

  const openState = useCallback((uf: string) => setDrawerUf(uf.toUpperCase()), []);
  const closeState = useCallback(() => setDrawerUf(null), []);
  const explore = useCallback((uf: string) => {
    setDrawerUf(null);
    setExplorerUf(uf.toUpperCase());
    requestAnimationFrame(() => explorerRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }));
  }, []);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 sm:py-8 lg:px-8" data-testid="live-election-page">
      {/* Nível 1 — leitura instantânea */}
      <div className="space-y-4">
        <p className="text-micro uppercase tracking-[0.1em] text-fg-muted sm:text-label">Eleições 2026 · Presidente da República · Dados oficiais do TSE</p>
        {hasSummary ? <Hero /> : <HeroSkeleton />}
        <SourceStatusLine />
        <PhaseBanners />
        <div className="flex flex-wrap items-center gap-2">
          <MethodologyButton />
          <NotifyButton />
        </div>
        <LiveAnnouncer />
      </div>

      {/* Nível 2 — entendimento: situação matemática, mapa e onde estão os votos restantes */}
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:grid-rows-[auto_1fr]">
        <div className="order-1 xl:order-none xl:col-start-2 xl:row-start-1">
          <DistanceCard />
        </div>
        <section aria-labelledby="live-map-title" className="order-2 xl:order-none xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <SectionHeading
            id="live-map-title"
            eyebrow="Mapa"
            title="Quem está à frente em cada UF"
            description="Cor = candidatura à frente; intensidade = tamanho da vantagem. Toque ou use as setas e Enter para abrir o painel da UF."
          />
          {hasStates ? (
            <BrazilElectionMap shapes={mapShapes} onSelect={openState} />
          ) : (
            <div className="skeleton aspect-square w-full rounded-2xl" aria-busy="true" aria-label="Carregando o mapa" />
          )}
          <div className="mt-4">
            <ExteriorCard onSelect={openState} />
          </div>
        </section>
        <div className="order-3 space-y-4 xl:order-none xl:col-start-2 xl:row-start-2">
          <RemainingVotesPanel />
          <Completeness />
          <TerritorialSummaryCard />
        </div>
      </div>

      <NationalMetrics />
      <StateResultsTable onSelect={openState} />

      <div className="grid gap-6 lg:grid-cols-2">
        <LastToTotalize />
        <VelocityPanel />
      </div>

      {/* Nível 3 — análise */}
      <RegionBreakdown />
      <LazySection minHeight={520} testId="live-lazy-evolution">
        <EvolutionCharts />
      </LazySection>
      <ElectionTimeline />
      <LazySection minHeight={600} testId="live-lazy-rankings">
        <RankingsPanel />
      </LazySection>
      <div ref={explorerRef} className="scroll-mt-20">
        <LazySection minHeight={600} testId="live-lazy-explorer">
          <MunicipalityExplorer uf={explorerUf} onUfChange={setExplorerUf} />
        </LazySection>
      </div>
      <LazySection minHeight={420} testId="live-lazy-first-round">
        <FirstRoundSection />
      </LazySection>

      {/* Nível 4 — técnico */}
      <section aria-labelledby="live-technical" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <SectionHeading
          id="live-technical"
          eyebrow="Técnico"
          title="Fonte, atualização e metodologia"
          description={
            <>
              Arquivos oficiais de divulgação do TSE (
              <a href="https://resultados.tse.jus.br" className="text-accent-text underline-offset-2 hover:underline" rel="noopener noreferrer" target="_blank">
                resultados.tse.jus.br
              </a>
              ). O REPBrasil normaliza, guarda o histórico e calcula estatísticas descritivas; a situação oficial publicada pelo TSE sempre prevalece.
            </>
          }
        />
        <TechnicalFacts />
        <div className="mt-4 border-t border-line pt-4">
          <MethodologyContent />
        </div>
      </section>

      {drawerUf ? <StateDrawer uf={drawerUf} onClose={closeState} onExplore={explore} /> : null}
    </main>
  );
}

/**
 * Raiz da apuração ao vivo. Recebe do servidor o primeiro snapshot (placar já no HTML) e a malha do mapa já
 * projetada; no cliente, liga o stream SSE do REPBrasil e ressincroniza para não depender de HTML em cache.
 */
export function LiveElectionPage({
  initialSummary,
  initialStates,
  mapShapes,
}: Readonly<{ initialSummary: LiveEnvelope<LiveSummary> | null; initialStates: LiveEnvelope<LiveStatesPayload> | null; mapShapes: BrazilMapShapes }>) {
  const [store] = useState(() => createLiveStore(initialLiveState(initialSummary, initialStates)));

  useEffect(() => {
    const client = new LiveStreamClient(store);
    client.start({ resync: true });
    sendProductEvent("election_page_view", { once: true });
    return () => client.stop();
  }, [store]);

  return (
    <LiveStoreProvider store={store}>
      <PageBody mapShapes={mapShapes} />
    </LiveStoreProvider>
  );
}
