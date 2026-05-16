"use client";

import { useState } from "react";
import type { AssetDeclarationItem, ElectionResultItem, PoliticianDetail } from "@/lib/types";
import { formatStatus } from "./utils";
import { OverviewTab } from "./tabs/OverviewTab";
import { ElectionTab } from "./tabs/ElectionTab";

type TabId = "overview" | "elections" | "assets" | "metadata" | "score";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview",  label: "Visão Geral" },
  { id: "elections", label: "Eleições" },
  { id: "assets",    label: "Patrimônio" },
  { id: "metadata",  label: "Fontes" },
  { id: "score",     label: "Score" },
];

interface PoliticianProfileProps {
  politician: PoliticianDetail;
  elections: ElectionResultItem[];
  assets: AssetDeclarationItem[];
}

export function PoliticianProfile({ politician, elections, assets }: PoliticianProfileProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const partyLabel = [politician.partyAcronym, politician.partyName]
    .filter(Boolean)
    .join(" — ");

  const summaryLine = [politician.office, partyLabel, politician.state]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      {/* Identity header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-slate-900">{politician.ballotName}</h1>
        <p className="text-base text-slate-500">{politician.name}</p>
        {summaryLine && (
          <p className="text-sm text-slate-400">{summaryLine}</p>
        )}
        {politician.candidacyStatus && politician.candidacyStatus !== "#NE" && (
          <p className="text-xs text-slate-400 mt-1">
            Situação: {formatStatus(politician.candidacyStatus)}
          </p>
        )}
      </div>

      {/* Tab navigation — no hover styles (institutional) */}
      <div className="border-b border-slate-200">
        <div className="flex overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 ${
                activeTab === tab.id
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-400"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "overview" && (
          <OverviewTab politician={politician} elections={elections} assets={assets} />
        )}
        {activeTab === "elections" && (
          <ElectionTab elections={elections} />
        )}
        {activeTab === "assets"    && <p className="text-slate-400 text-sm">Patrimônio — em breve</p>}
        {activeTab === "metadata"  && <p className="text-slate-400 text-sm">Fontes — em breve</p>}
        {activeTab === "score"     && <p className="text-slate-400 text-sm">Score — em breve</p>}
      </div>
    </div>
  );
}
