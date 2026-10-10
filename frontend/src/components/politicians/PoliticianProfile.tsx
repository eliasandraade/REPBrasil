"use client";

import { useState, type CSSProperties } from "react";
import type {
  AssetDeclarationItem,
  DataSourceItem,
  ElectionResultItem,
  PoliticianDetail,
  ScoreStatusItem,
} from "@/lib/types";
import { initialsOf } from "@/motion/identity";
import { TransitionLink } from "@/motion/navigation";
import { formatCurrency, formatStatus } from "./utils";
import { ProfileTabs, type TabDef } from "./ProfileTabs";
import { OverviewTab } from "./tabs/OverviewTab";
import { ElectionTab } from "./tabs/ElectionTab";
import { AssetsTab } from "./tabs/AssetsTab";
import { MetadataTab } from "./tabs/MetadataTab";
import { ScoreTab } from "./tabs/ScoreTab";
import { CamaraTab } from "./tabs/CamaraTab";
import { XrayTab } from "@/components/xray/XrayTab";

type TabId = "overview" | "elections" | "electoral" | "assets" | "metadata" | "score" | "camara";

/** Estado de cada consulta complementar: "pending" e "error" nunca viram "não encontrado". */
export type LoadState = "pending" | "error" | "ready";

interface PoliticianProfileProps {
  politician: PoliticianDetail;
  elections: ElectionResultItem[];
  assets: AssetDeclarationItem[];
  sources: DataSourceItem[];
  score?: ScoreStatusItem;
  status?: { elections: LoadState; assets: LoadState; sources: LoadState };
}

/** Nomes das peças de identidade compartilhadas com a busca e com o resultado eleitoral. */
export const IDENTITY_VT = {
  avatar: { viewTransitionName: "vt-avatar" } as CSSProperties,
  name: { viewTransitionName: "vt-name" } as CSSProperties,
};

/** Corpo do cartão por estado: consultar, falhar e não encontrar são afirmações diferentes. */
function SummaryValue({ state, value, sub }: Readonly<{ state: LoadState; value: string; sub?: string }>) {
  if (state === "pending")
    return (
      <>
        <div className="skeleton my-1 h-5 w-16" aria-hidden="true" />
        <p className="mt-0.5 text-xs text-slate-600">consultando…</p>
      </>
    );
  if (state === "error")
    return (
      <>
        <p className="truncate text-lg font-bold text-slate-500">—</p>
        <p className="mt-0.5 text-xs text-slate-600">indisponível no momento</p>
      </>
    );
  return (
    <>
      <p className="value-arrive truncate text-lg font-bold text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-600">{sub}</p>}
    </>
  );
}

function SummaryCard({
  label,
  state,
  value,
  sub,
}: Readonly<{
  label: string;
  state: LoadState;
  value: string;
  sub?: string;
}>) {
  return (
    <div className="rounded-lg border border-white/8 bg-card p-4" aria-busy={state === "pending"}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
        {label}
      </p>
      <SummaryValue state={state} value={value} sub={sub} />
    </div>
  );
}

export function InitialAvatar({ name }: Readonly<{ name: string }>) {
  return (
    <div
      style={IDENTITY_VT.avatar}
      className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-xl font-black text-brand"
    >
      {initialsOf(name)}
    </div>
  );
}

function initialTab(hasCamara: boolean): TabId {
  if (typeof window === "undefined") return "overview";
  // Deep link vindo do explorador eleitoral: abre direto no Raio X (sem passar pela visão geral).
  const aba = new URLSearchParams(window.location.search).get("aba");
  if (aba === "eleicoes" || aba === "raio-x") return "electoral";
  if (aba === "camara" && hasCamara) return "camara";
  return "overview";
}

export function PoliticianProfile({
  politician,
  elections,
  assets,
  sources,
  score,
  status = { elections: "ready", assets: "ready", sources: "ready" },
}: Readonly<PoliticianProfileProps>) {
  const [activeTab, setActiveTab] = useState<TabId>(() => initialTab(!!politician.camaraId));

  const TABS: TabDef<TabId>[] = [
    { id: "overview", label: "Visão Geral" },
    { id: "elections", label: "Eleições" },
    { id: "electoral", label: "Raio X eleitoral" },
    { id: "assets", label: "Patrimônio" },
    { id: "metadata", label: "Fontes" },
    { id: "score", label: "Score" },
    ...(politician.camaraId ? [{ id: "camara" as TabId, label: "Câmara" }] : []),
  ];

  const partyLabel = [politician.partyAcronym, politician.partyName]
    .filter(Boolean)
    .join(" — ");

  const latestAssets = assets[0] ?? null;
  const electedCount = elections.filter((e) => e.elected).length;

  return (
    <div className="space-y-6">
      {/* ── Disclaimer banner ─────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 rounded-lg border border-white/8 bg-card/50 px-4 py-3 text-xs text-slate-500">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0 text-brand" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <span>
          Esta página organiza dados públicos oficiais. A base está em expansão e pode conter
          limitações herdadas das fontes originais. Consulte sempre a{" "}
          <button
            type="button"
            onClick={() => setActiveTab("metadata")}
            className="mi-underline focus-ring rounded text-brand"
          >
            fonte oficial vinculada
          </button>
          .
        </span>
      </div>

      {/* ── Profile header (identidade: não se move entre abas) ───────────── */}
      <div className="rounded-xl border border-white/8 bg-card p-6">
        <div className="flex items-start gap-4">
          <InitialAvatar name={politician.ballotName} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-start gap-2">
              <h1 style={IDENTITY_VT.name} className="text-2xl font-bold leading-tight text-slate-100">
                {politician.ballotName}
              </h1>
              <span className="inline-flex items-center gap-1 rounded border border-brand/25 bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
                <span className="h-1 w-1 rounded-full bg-brand" />
                Dados públicos oficiais
              </span>
            </div>
            <p className="mb-1 text-sm text-slate-400">{politician.name}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {politician.office && (
                <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-slate-400">
                  {politician.office}
                </span>
              )}
              {politician.partyAcronym && (
                <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-slate-400">
                  {partyLabel || politician.partyAcronym}
                </span>
              )}
              {politician.state && (
                <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-slate-400">
                  {politician.state}
                </span>
              )}
              {politician.candidacyStatus &&
                politician.candidacyStatus !== "#NE" && (
                  <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-slate-500">
                    {formatStatus(politician.candidacyStatus)}
                  </span>
                )}
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard
            label="Candidaturas"
            state={status.elections}
            value={elections.length > 0 ? String(elections.length) : "—"}
            sub="registros encontrados"
          />
          <SummaryCard
            label="Eleições"
            state={status.elections}
            value={electedCount > 0 ? String(electedCount) : elections.length > 0 ? "0" : "—"}
            sub={electedCount > 0 ? "eleito(a)" : "na base atual"}
          />
          <SummaryCard
            label="Patrimônio declarado"
            state={status.assets}
            value={latestAssets ? formatCurrency(latestAssets.totalValue) : "—"}
            sub={latestAssets ? `${latestAssets.items.length} itens` : "não encontrado"}
          />
          <SummaryCard
            label="Fontes vinculadas"
            state={status.sources}
            value={sources.length > 0 ? String(sources.length) : "—"}
            sub="rastreabilidade"
          />
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <ProfileTabs tabs={TABS} active={activeTab} onChange={setActiveTab} idPrefix={`perfil-${politician.id}`}>
        {activeTab === "overview" && (
          <OverviewTab
            politician={politician}
            elections={elections}
            assets={assets}
          />
        )}
        {activeTab === "elections" && <ElectionTab elections={elections} />}
        {activeTab === "electoral" && <XrayTab politicianId={politician.id} />}
        {activeTab === "assets" && <AssetsTab assets={assets} />}
        {activeTab === "metadata" && (
          <MetadataTab politician={politician} sources={sources} />
        )}
        {activeTab === "score" && <ScoreTab score={score} />}
        {activeTab === "camara" && (
          <CamaraTab
            politicianId={politician.id}
            camaraId={politician.camaraId ?? null}
          />
        )}
      </ProfileTabs>

      {/* ── Contestação CTA ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-lg border border-white/8 bg-card/50 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-slate-300">Dados incorretos?</p>
          <p className="text-xs text-slate-500">
            Políticos, assessorias ou cidadãos podem solicitar revisão de informações.
          </p>
        </div>
        <TransitionLink
          href="/suporte"
          className="mi-press focus-ring ml-4 flex-shrink-0 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-white/25 hover:bg-white/10"
        >
          Contestar →
        </TransitionLink>
      </div>
    </div>
  );
}
