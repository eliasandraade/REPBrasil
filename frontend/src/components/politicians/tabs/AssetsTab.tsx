"use client";

import { useState } from "react";
import type { AssetDeclarationItem } from "@/lib/types";
import { formatCurrency } from "../utils";

const ITEMS_DEFAULT_LIMIT = 8;

function AssetItemList({ items }: { items: AssetDeclarationItem["items"] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, ITEMS_DEFAULT_LIMIT);
  const hidden = items.length - ITEMS_DEFAULT_LIMIT;

  return (
    <div className="overflow-hidden rounded-md border border-white/8">
      {visible.map((item) => (
        <div
          key={item.order}
          className="flex items-start justify-between gap-3 border-b border-white/5 px-3 py-2.5 last:border-0"
        >
          <div className="min-w-0">
            <p className="text-xs text-slate-400 truncate">
              {item.typeDescription ?? "Bem não especificado"}
            </p>
            {item.description && (
              <p className="mt-0.5 text-xs text-slate-600 truncate">{item.description}</p>
            )}
          </div>
          <p className="flex-shrink-0 text-xs font-semibold text-slate-300">
            {formatCurrency(item.value)}
          </p>
        </div>
      ))}
      {!expanded && hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full px-3 py-2.5 text-xs font-medium text-brand transition-colors hover:bg-brand/5"
        >
          Ver todos os {items.length} bens declarados
        </button>
      )}
    </div>
  );
}

interface AssetsTabProps {
  assets: AssetDeclarationItem[];
}

export function AssetsTab({ assets }: AssetsTabProps) {
  if (assets.length === 0) {
    return (
      <div className="rounded-lg border border-white/8 bg-card-elevated px-5 py-10 text-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3 text-slate-700" aria-hidden="true"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        <p className="font-medium text-slate-400">Nenhuma declaração de bens registrada</p>
        <p className="mt-1 text-xs text-slate-600">Não encontrada na base atual do TSE.</p>
      </div>
    );
  }

  const maxTotal = Math.max(...assets.map((a) => a.totalValue), 1);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          Patrimônio declarado — TSE
        </p>
        <span className="text-xs text-slate-600">
          {assets.length} declaraç{assets.length !== 1 ? "ões" : "ão"}
        </span>
      </div>

      <div className="space-y-4">
        {assets.map((decl, idx) => {
          const prev = assets[idx + 1];
          const yoyPct =
            prev && prev.totalValue > 0 && prev.year !== decl.year
              ? ((decl.totalValue - prev.totalValue) / prev.totalValue) * 100
              : null;
          const barPct = Math.round((decl.totalValue / maxTotal) * 100);
          return (
            <div key={decl.year} className="rounded-lg border border-white/8 bg-card-elevated p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-200">{decl.year}</span>
                <div className="text-right">
                  <span className="text-base font-bold text-slate-100">
                    {formatCurrency(decl.totalValue)}
                  </span>
                  {yoyPct !== null && (
                    <span className="ml-2 text-xs font-medium text-slate-500">
                      {yoyPct >= 0 ? "+" : ""}{yoyPct.toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-brand/70"
                  style={{ width: `${barPct}%`, minWidth: "3px" }}
                />
              </div>

              {yoyPct !== null && (
                <p className="text-xs text-slate-600">
                  Variação em relação à declaração anterior:{" "}
                  <span className="text-slate-500">
                    {yoyPct >= 0 ? "+" : ""}{yoyPct.toFixed(1)}%
                  </span>
                  <span className="ml-1 text-slate-700">(dados públicos TSE, sem inferência)</span>
                </p>
              )}

              {decl.items.length > 0 && <AssetItemList items={decl.items} />}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-600">
        Declarações de bens baseadas em dados públicos do TSE. Variações patrimoniais são
        apresentadas sem inferência sobre origem ou licitude.
      </p>
    </div>
  );
}
