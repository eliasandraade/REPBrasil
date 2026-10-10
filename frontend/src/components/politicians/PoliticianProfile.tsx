"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AssetDeclarationItem, DataSourceItem, ElectionResultItem, PoliticianDetail, ScoreStatusItem } from "@/lib/types";
import { TransitionLink } from "@/motion/navigation";
import { AssetsPanel, FinancePanel, RecordsPanel, TerritoryPanel } from "@/components/xray/CandidacyPanels";
import { CandidacyPicker } from "@/components/xray/CandidacyPicker";
import { EvolutionList, XrayTimeline } from "@/components/xray/XrayTimeline";
import { byRecency, latestCandidacy, useXray } from "@/components/xray/useXray";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { ProfileHeader, type LoadState } from "./ProfileHeader";
import { ProfileOverview } from "./ProfileOverview";
import { ProfileTabs, type TabDef } from "./ProfileTabs";
import { AssetsTab } from "./tabs/AssetsTab";
import { CamaraTab } from "./tabs/CamaraTab";
import { ElectionTab } from "./tabs/ElectionTab";
import { MetadataTab } from "./tabs/MetadataTab";
import { OverviewTab } from "./tabs/OverviewTab";
import { ScoreTab } from "./tabs/ScoreTab";

export { IDENTITY_VT, InitialAvatar, type LoadState } from "./ProfileHeader";

/** Abas na ordem de leitura; o id vai para a URL (?aba=…), então é estável e em português. */
type TabId = "visao-geral" | "historico" | "territorio" | "patrimonio" | "contas" | "fontes" | "score" | "camara";

const TAB_IDS: readonly TabId[] = ["visao-geral", "historico", "territorio", "patrimonio", "contas", "fontes", "score", "camara"];

/** Links antigos e do explorador: ?aba=eleicoes / ?aba=raio-x abrem o histórico eleitoral. */
const TAB_ALIASES: Record<string, TabId> = { eleicoes: "historico", "raio-x": "historico", overview: "visao-geral", camara: "camara" };

interface PoliticianProfileProps {
  politician: PoliticianDetail;
  elections: ElectionResultItem[];
  assets: AssetDeclarationItem[];
  sources: DataSourceItem[];
  score?: ScoreStatusItem;
  status?: { elections: LoadState; assets: LoadState; sources: LoadState };
}

function fromUrl(hasCamara: boolean): { tab: TabId; candidacy: string | null } {
  if (typeof window === "undefined") return { tab: "visao-geral", candidacy: null };
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("aba") ?? "";
  const tab = (TAB_IDS as readonly string[]).includes(raw) ? (raw as TabId) : TAB_ALIASES[raw] ?? "visao-geral";
  return { tab: tab === "camara" && !hasCamara ? "visao-geral" : tab, candidacy: params.get("candidatura") };
}

/** Aba e candidatura na URL (substitui o histórico, não acrescenta): o link copiado abre exatamente aqui. */
function writeUrl(tab: TabId, candidacy: string | null) {
  const url = new URL(window.location.href);
  if (tab === "visao-geral") url.searchParams.delete("aba");
  else url.searchParams.set("aba", tab);
  if (candidacy && (tab === "territorio" || tab === "patrimonio" || tab === "contas" || tab === "fontes")) url.searchParams.set("candidatura", candidacy);
  else url.searchParams.delete("candidatura");
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
}

function loadState(q: { isError: boolean; isPending: boolean }): LoadState {
  if (q.isError) return "error";
  return q.isPending ? "pending" : "ready";
}

function Unavailable({ children }: Readonly<{ children: string }>) {
  return <DataState kind="no_coverage">{children}</DataState>;
}

/**
 * Perfil: quem a pessoa é nas urnas. Cabeçalho pela candidatura oficial mais recente; abas na ordem de leitura
 * (visão geral → histórico → território → patrimônio → contas → fontes). O cadastro anterior (eleições, bens) só
 * aparece para quem ainda não tem candidatura na camada eleitoral.
 */
export function PoliticianProfile({
  politician,
  elections,
  assets,
  sources,
  score,
  status = { elections: "ready", assets: "ready", sources: "ready" },
}: Readonly<PoliticianProfileProps>) {
  const hasCamara = !!politician.camaraId;
  const [{ tab, candidacy: requested }, setView] = useState(() => fromUrl(hasCamara));
  const xrayQ = useXray(politician.id);
  const xray = xrayQ.data;
  const xrayState = loadState(xrayQ);
  const candidacies = useMemo(() => (xray ? byRecency(xray.candidacies) : []), [xray]);
  const electoral = candidacies.length > 0;
  const selected = candidacies.find((c) => c.candidacyId === requested) ?? latestCandidacy(xray);

  useEffect(() => writeUrl(tab, requested ?? null), [tab, requested]);

  const open = (next: TabId, candidacy?: string | null) =>
    setView((v) => ({ tab: next, candidacy: candidacy === undefined ? v.candidacy : candidacy }));
  const pick = (candidacy: string) => setView((v) => ({ ...v, candidacy }));

  const TABS: TabDef<TabId>[] = [
    { id: "visao-geral", label: "Visão geral" },
    { id: "historico", label: "Histórico eleitoral" },
    { id: "territorio", label: "Território" },
    { id: "patrimonio", label: "Patrimônio" },
    { id: "contas", label: "Contas" },
    { id: "fontes", label: "Fontes" },
    { id: "score", label: "Score" },
    ...(hasCamara ? [{ id: "camara" as TabId, label: "Câmara" }] : []),
  ];

  const loading = <DataState kind="loading" title="Carregando dados eleitorais" height="h-40" />;
  const failed = (
    <DataState kind="error" title="Não foi possível carregar os dados eleitorais." action={<RetryButton onRetry={() => xrayQ.refetch()} />}>
      Falha de comunicação não é ausência de dados.
    </DataState>
  );
  /** Conteúdo eleitoral, com carregamento, falha e "sem candidatura" ditos com clareza. */
  const electoralOr = (render: () => ReactNode, legacy: () => ReactNode) => {
    if (xrayState === "pending") return loading;
    if (xrayState === "error") return failed;
    return electoral ? render() : legacy();
  };
  const picker = selected && <CandidacyPicker candidacies={candidacies} value={selected.candidacyId} onChange={pick} />;

  return (
    <div className="space-y-6">
      <ProfileHeader politician={politician} xray={xray} xrayState={xrayState} />

      <ProfileTabs tabs={TABS} active={tab} onChange={(id) => open(id)} idPrefix={`perfil-${politician.id}`}>
        {tab === "visao-geral" &&
          electoralOr(
            () => <ProfileOverview data={xray!} onOpenTerritory={(id) => open("territorio", id)} />,
            () => <OverviewTab politician={politician} elections={elections} assets={assets} />,
          )}
        {tab === "historico" &&
          electoralOr(
            () => <XrayTimeline data={xray!} onOpen={(id) => open("territorio", id)} />,
            () => <ElectionTab elections={elections} />,
          )}
        {tab === "territorio" &&
          electoralOr(
            () => (
              <>
                {picker}
                {selected && <TerritoryPanel key={selected.candidacyId} c={selected} />}
              </>
            ),
            () => <Unavailable>Sem votação importada na camada eleitoral para este perfil.</Unavailable>,
          )}
        {tab === "patrimonio" &&
          electoralOr(
            () => (
              <div className="space-y-4">
                {picker}
                {selected && <AssetsPanel key={selected.candidacyId} c={selected} />}
                {xray && xray.assetsEvolution.length > 0 && <EvolutionList data={{ ...xray, evolution: [] }} />}
              </div>
            ),
            () => (status.assets === "pending" ? loading : <AssetsTab assets={assets} />),
          )}
        {tab === "contas" &&
          electoralOr(
            () => (
              <>
                {picker}
                {selected && <FinancePanel key={selected.candidacyId} c={selected} />}
              </>
            ),
            () => <Unavailable>Sem prestação de contas importada para este perfil.</Unavailable>,
          )}
        {tab === "fontes" && (
          <div className="space-y-6">
            {electoral && selected && (
              <section aria-label="Registros oficiais da candidatura">
                {picker}
                <RecordsPanel key={selected.candidacyId} c={selected} />
              </section>
            )}
            <MetadataTab politician={politician} sources={sources} />
          </div>
        )}
        {tab === "score" && <ScoreTab score={score} />}
        {tab === "camara" && <CamaraTab politicianId={politician.id} camaraId={politician.camaraId ?? null} />}
      </ProfileTabs>

      <p className="text-xs text-slate-500">
        Dados públicos oficiais, com a fonte em cada número. Quando a fonte não informa, aparece &ldquo;—&rdquo;: ausência não é zero.{" "}
        <button type="button" onClick={() => open("fontes")} className="mi-underline focus-ring rounded text-brand">
          Ver fontes
        </button>
      </p>

      <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-card/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-300">Dados incorretos?</p>
          <p className="text-xs text-slate-500">Políticos, assessorias ou cidadãos podem pedir revisão, com a fonte oficial.</p>
        </div>
        <TransitionLink
          href="/suporte"
          className="mi-press focus-ring flex-shrink-0 self-start rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-white/25 hover:bg-white/10 sm:self-auto"
        >
          Pedir correção →
        </TransitionLink>
      </div>
    </div>
  );
}
