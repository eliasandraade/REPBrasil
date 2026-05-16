"use client";

import { useState } from "react";
import type { AssetDeclarationItem, DataSourceItem, ElectionResultItem, PoliticianDetail, ScoreStatusItem } from "@/lib/types";
import { formatStatus } from "./utils";
import { OverviewTab } from "./tabs/OverviewTab";
import { ElectionTab } from "./tabs/ElectionTab";
import { AssetsTab } from "./tabs/AssetsTab";
import { MetadataTab } from "./tabs/MetadataTab";
import { ScoreTab } from "./tabs/ScoreTab";

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
  sources: DataSourceItem[];
  score?: ScoreStatusItem;
}

export function PoliticianProfile({ politician, elections, assets, sources, score }: PoliticianProfileProps) {
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
        {activeTab === "assets" && (
          <AssetsTab assets={assets} />
        )}
        {activeTab === "metadata" && <MetadataTab politician={politician} sources={sources} />}
        {activeTab === "score" && <ScoreTab score={score} />}
      </div>
    </div>
  );
}
