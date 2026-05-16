"use client";

import { useState } from "react";
import type { AssetDeclarationItem } from "@/lib/types";
import { formatCurrency } from "../utils";

const ITEMS_DEFAULT_LIMIT = 10;

function AssetItemList({ items }: { items: AssetDeclarationItem["items"] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, ITEMS_DEFAULT_LIMIT);
  const hidden = items.length - ITEMS_DEFAULT_LIMIT;

  return (
    <div className="divide-y divide-slate-50 border border-slate-100 rounded-md">
      {visible.map((item) => (
        <div
          key={item.order}
          className="px-3 py-2 flex items-start justify-between gap-3 text-xs"
        >
          <div className="min-w-0">
            <p className="text-slate-500 truncate">
              {item.typeDescription ?? "Bem não especificado"}
            </p>
            {item.description && (
              <p className="text-slate-400 truncate mt-0.5">{item.description}</p>
            )}
          </div>
          <p className="text-slate-700 font-medium shrink-0">
            {formatCurrency(item.value)}
          </p>
        </div>
      ))}
      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-3 py-2 text-xs text-slate-400 text-center"
        >
          Ver todos os {items.length} bens
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
      <p className="text-slate-400 text-sm py-6 text-center">
        Nenhuma declaração de bens registrada.
      </p>
    );
  }

  const maxTotal = Math.max(...assets.map((a) => a.totalValue), 1);

  return (
    <section className="border border-slate-200 rounded-lg divide-y divide-slate-100">
      <div className="px-4 py-3">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          Patrimônio declarado — TSE
        </p>
      </div>
      {assets.map((decl, idx) => {
        const prev = assets[idx + 1];
        const yoyPct =
          prev && prev.totalValue > 0 && prev.year !== decl.year
            ? ((decl.totalValue - prev.totalValue) / prev.totalValue) * 100
            : null;
        const barPct = Math.round((decl.totalValue / maxTotal) * 100);

        return (
          <div key={decl.year} className="px-4 py-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-slate-900">{decl.year}</p>
              <p className="text-sm font-medium text-slate-900">
                {formatCurrency(decl.totalValue)}
              </p>
            </div>

            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-slate-400 rounded-full"
                style={{ width: `${barPct}%`, minWidth: "4px" }}
              />
            </div>

            {yoyPct !== null && (
              <p className="text-xs text-slate-400">
                Variação percentual em relação à declaração anterior:{" "}
                {yoyPct >= 0 ? "+" : ""}
                {yoyPct.toFixed(1)}%
              </p>
            )}

            {decl.items.length > 0 && <AssetItemList items={decl.items} />}
          </div>
        );
      })}
    </section>
  );
}
