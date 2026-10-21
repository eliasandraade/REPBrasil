"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AssetDeclarationItem, DataSourceItem, ElectionResultItem, PoliticianDetail, ScoreStatusItem } from "@/lib/types";
import { TransitionLink } from "@/motion/navigation";
import { SocioElectoralPanel } from "@/components/data/SocioElectoralPanel";
import { AssetsPanel, FinancePanel, RecordsPanel, TerritoryPanel } from "@/components/xray/CandidacyPanels";
import { CandidacyPicker } from "@/components/xray/CandidacyPicker";
import { ElectoralBasePanel } from "@/components/xray/ElectoralBasePanel";
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

type TabId =
  | "visao-geral"
  | "historico"
  | "territorio"
  | "base"
  | "socioeleitoral"
  | "patrimonio"
  | "contas"
  | "fontes"
  | "score"
  | "camara";

const TAB_IDS: readonly TabId[] = [
  "visao-geral",
  "historico",
  "territorio",
  "base",
  "socioeleitoral",
  "patrimonio",
  "contas",
  "fontes",
  "score",
  "camara",
];

const TAB_ALIASES: Record<string, TabId> = {
  eleicoes: "historico",
  "raio-x": "historico",
  overview: "visao-geral",
  camara: "camara",
};

interface PoliticianProfileProps {
  politician: PoliticianDetail;
  elections: ElectionResultItem[];
  assets: AssetDeclarationItem[];
  sources: DataSourceItem[];
  score?: ScoreStatusItem;
  status?: Record<LegacyPart, LoadState>;
  /** Tentar de novo cada base, quando a consulta falha. */
  retry?: Partial<Record<LegacyPart, () => void>>;
}

/** Bases do perfil anteriores à camada eleitoral (consultas próprias). */
type LegacyPart = "elections" | "assets" | "sources";

function fromUrl(hasCamara: boolean): { tab: TabId; candidacy: string | null } {
  if (typeof window === "undefined") return { tab: "visao-geral", candidacy: null };
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("aba") ?? "";
  const tab = (TAB_IDS as readonly string[]).includes(raw)
    ? (raw as TabId)
    : TAB_ALIASES[raw] ?? "visao-geral";
  return {
    tab: tab === "camara" && !hasCamara ? "visao-geral" : tab,
    candidacy: params.get("candidatura"),
  };
}

function writeUrl(tab: TabId, candidacy: string | null) {
  const url = new URL(window.location.href);
  if (tab === "visao-geral") url.searchParams.delete("aba");
  else url.searchParams.set("aba", tab);
  if (
    candidacy &&
    (
      tab === "territorio" ||
      tab === "base" ||
      tab === "socioeleitoral" ||
      tab === "patrimonio" ||
      tab === "contas" ||
      tab === "fontes"
    )
  ) {
    url.searchParams.set("candidatura", candidacy);
  } else {
    url.searchParams.delete("candidatura");
  }
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, "", url);
  }
}

function loadState(q: { isError: boolean; isPending: boolean }): LoadState {
  if (q.isError) return "error";
  return q.isPending ? "pending" : "ready";
}

function Unavailable({ children }: Readonly<{ children: string }>) {
  return <DataState kind="no_coverage">{children}</DataState>;
}

export function PoliticianProfile({
  politician,
  elections,
  assets,
  sources,
  score,
  status = { elections: "ready", assets: "ready", sources: "ready" },
  retry,
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
    setView((view) => ({
      tab: next,
      candidacy: candidacy === undefined ? view.candidacy : candidacy,
    }));
  const pick = (candidacy: string) => setView((view) => ({ ...view, candidacy }));

  const tabs: TabDef<TabId>[] = [
    { id: "visao-geral", label: "Visão geral" },
    { id: "historico", label: "Histórico eleitoral" },
    { id: "territorio", label: "Território" },
    { id: "base", label: "Base eleitoral" },
    { id: "socioeleitoral", label: "Perfil socioeleitoral" },
    { id: "patrimonio", label: "Patrimônio" },
    { id: "contas", label: "Contas" },
    { id: "fontes", label: "Fontes" },
    { id: "score", label: "Score" },
    ...(hasCamara ? [{ id: "camara" as TabId, label: "Câmara" }] : []),
  ];

  const loading = (
    <DataState kind="loading" title="Carregando dados eleitorais" height="h-40" />
  );
  const failed = (
    <DataState
      kind="error"
      title="Não foi possível carregar os dados eleitorais."
      action={<RetryButton onRetry={() => xrayQ.refetch()} />}
    >
      Falha de comunicação não é ausência de dados.
    </DataState>
  );
  /** Bases anteriores à camada eleitoral: consultando ≠ falhou ≠ não há registro (falha nunca vira ausência). */
  const legacyOr = (part: LegacyPart, what: string, render: () => ReactNode) => {
    if (status[part] === "pending") return <DataState kind="loading" title={`Carregando ${what}`} height="h-40" />;
    if (status[part] === "error")
      return (
        <DataState kind="error" title={`Não foi possível carregar ${what}.`} action={retry?.[part] ? <RetryButton onRetry={retry[part]!} /> : undefined}>
          Falha de comunicação não é ausência de dados.
        </DataState>
      );
    return render();
  };
  const electoralOr = (render: () => ReactNode, legacy: () => ReactNode) => {
    if (xrayState === "pending") return loading;
    if (xrayState === "error") return failed;
    return electoral ? render() : legacy();
  };
  const picker = selected && (
    <CandidacyPicker
      candidacies={candidacies}
      value={selected.candidacyId}
      onChange={pick}
    />
  );

  return (
    <div className="space-y-6">
      <ProfileHeader politician={politician} xray={xray} xrayState={xrayState} />

      <ProfileTabs tabs={tabs} active={tab} onChange={(id) => open(id)} idPrefix={`perfil-${politician.id}`}>
        {tab === "visao-geral" &&
          electoralOr(
            () => (
              <ProfileOverview
                data={xray!}
                onOpenTerritory={(id) => open("territorio", id)}
              />
            ),
            () => <OverviewTab politician={politician} elections={elections} assets={assets} />,
          )}
        {tab === "historico" &&
          electoralOr(
            () => <XrayTimeline data={xray!} onOpen={(id) => open("territorio", id)} />,
            () => legacyOr("elections", "o histórico eleitoral", () => <ElectionTab elections={elections} />),
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
        {tab === "base" &&
          electoralOr(
            () => (
              <>
                {picker}
                {selected && <ElectoralBasePanel key={selected.candidacyId} c={selected} />}
              </>
            ),
            () => <Unavailable>Sem votação importada na camada eleitoral para este perfil.</Unavailable>,
          )}
        {tab === "socioeleitoral" &&
          electoralOr(
            () => (
              <div className="space-y-4">
                {picker}
                {selected && (
                  <SocioElectoralPanel
                    key={selected.candidacyId}
                    candidacy={selected}
                  />
                )}
              </div>
            ),
            () => (
              <Unavailable>
                Sem votação importada para construir o perfil socioeleitoral.
              </Unavailable>
            ),
          )}
        {tab === "patrimonio" &&
          electoralOr(
            () => (
              <div className="space-y-4">
                {picker}
                {selected && <AssetsPanel key={selected.candidacyId} c={selected} />}
                {xray && xray.assetsEvolution.length > 0 && (
                  <EvolutionList data={{ ...xray, evolution: [] }} />
                )}
              </div>
            ),
            () => legacyOr("assets", "as declarações de bens", () => <AssetsTab assets={assets} />),
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
            <MetadataTab politician={politician} sources={sources} sourcesState={status.sources} onRetrySources={retry?.sources} />
          </div>
        )}
        {tab === "score" && <ScoreTab score={score} />}
        {tab === "camara" && (
          <CamaraTab politicianId={politician.id} camaraId={politician.camaraId ?? null} />
        )}
      </ProfileTabs>

      <p className="text-xs text-fg-muted">
        Dados públicos oficiais, com a fonte em cada número. Quando a fonte não informa,
        aparece &ldquo;—&rdquo;: ausência não é zero.{" "}
        <button
          type="button"
          onClick={() => open("fontes")}
          className="mi-underline focus-ring rounded text-accent-text"
        >
          Ver fontes
        </button>
      </p>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-fg-soft">Dados incorretos?</p>
          <p className="text-xs text-fg-muted">
            Políticos, assessorias ou cidadãos podem pedir revisão, com a fonte oficial.
          </p>
        </div>
        <TransitionLink
          href="/suporte"
          className="mi-press focus-ring flex-shrink-0 self-start rounded-lg border border-line-strong bg-fg/5 px-4 py-2 text-xs font-semibold text-fg-soft transition-colors hover:border-line-strong hover:bg-fg/10 sm:self-auto"
        >
          Pedir correção →
        </TransitionLink>
      </div>
    </div>
  );
}
