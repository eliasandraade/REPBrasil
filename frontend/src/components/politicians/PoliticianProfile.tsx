"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  AssetDeclarationItem,
  DataSourceItem,
  ElectionResultItem,
  PoliticianDetail,
  ScoreStatusItem,
} from "@/lib/types";
import { formatCurrency, formatStatus } from "./utils";
import { OverviewTab } from "./tabs/OverviewTab";
import { ElectionTab } from "./tabs/ElectionTab";
import { AssetsTab } from "./tabs/AssetsTab";
import { MetadataTab } from "./tabs/MetadataTab";
import { ScoreTab } from "./tabs/ScoreTab";

type TabId = "overview" | "elections" | "assets" | "metadata" | "score";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Visão Geral" },
  { id: "elections", label: "Eleições" },
  { id: "assets", label: "Patrimônio" },
  { id: "metadata", label: "Fontes" },
  { id: "score", label: "Score" },
];

interface PoliticianProfileProps {
  politician: PoliticianDetail;
  elections: ElectionResultItem[];
  assets: AssetDeclarationItem[];
  sources: DataSourceItem[];
  score?: ScoreStatusItem;
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-card p-4">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
        {label}
      </p>
      <p className="truncate text-lg font-bold text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-600">{sub}</p>}
    </div>
  );
}

function InitialAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-brand text-xl font-black">
      {initials}
    </div>
  );
}

export function PoliticianProfile({
  politician,
  elections,
  assets,
  sources,
  score,
}: PoliticianProfileProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

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
            className="text-brand underline-offset-2 hover:underline"
          >
            fonte oficial vinculada
          </button>
          .
        </span>
      </div>

      {/* ── Profile header ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-card p-6">
        <div className="flex items-start gap-4">
          <InitialAvatar name={politician.ballotName} />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-start gap-2">
              <h1 className="text-2xl font-bold text-slate-100 leading-tight">
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
            value={elections.length > 0 ? String(elections.length) : "—"}
            sub="registros encontrados"
          />
          <SummaryCard
            label="Eleições"
            value={electedCount > 0 ? String(electedCount) : elections.length > 0 ? "0" : "—"}
            sub={electedCount > 0 ? "eleito(a)" : "na base atual"}
          />
          <SummaryCard
            label="Patrimônio declarado"
            value={latestAssets ? formatCurrency(latestAssets.totalValue) : "—"}
            sub={latestAssets ? `${latestAssets.items.length} itens` : "não encontrado"}
          />
          <SummaryCard
            label="Fontes vinculadas"
            value={sources.length > 0 ? String(sources.length) : "—"}
            sub="rastreabilidade"
          />
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/8 bg-card">
        {/* Tab nav */}
        <div className="border-b border-white/8">
          <div className="flex overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex-shrink-0 border-b-2 px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-colors
                  ${activeTab === tab.id
                    ? "border-brand text-brand"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="p-5">
          {activeTab === "overview" && (
            <OverviewTab
              politician={politician}
              elections={elections}
              assets={assets}
            />
          )}
          {activeTab === "elections" && <ElectionTab elections={elections} />}
          {activeTab === "assets" && <AssetsTab assets={assets} />}
          {activeTab === "metadata" && (
            <MetadataTab politician={politician} sources={sources} />
          )}
          {activeTab === "score" && <ScoreTab score={score} />}
        </div>
      </div>

      {/* ── Contestação CTA ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-lg border border-white/8 bg-card/50 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-slate-300">Dados incorretos?</p>
          <p className="text-xs text-slate-500">
            Políticos, assessorias ou cidadãos podem solicitar revisão de informações.
          </p>
        </div>
        <Link
          href="/suporte"
          className="ml-4 flex-shrink-0 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 transition-all hover:border-white/25 hover:bg-white/10"
        >
          Contestar →
        </Link>
      </div>
    </div>
  );
}
