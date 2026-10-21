"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getSavedItems, planRefusalOf, removeSavedItem, saveItem, savedPageLabel } from "@/lib/account";
import { accountKeys, useAccount, useRefreshAccount } from "@/lib/useAccount";
import { TransitionLink } from "@/motion/navigation";

type Target = { resourceType: string; resourceKey: string };
type Collection = "favorite" | "watchlist";

function targetFromLocation(pathname: string, query: string): Target | null {
  const parts = pathname.split("/").filter(Boolean);
  const reproducible = query ? `${pathname}?${query}` : pathname;
  if (parts[0] === "politicos" && parts[1]) return { resourceType: "politician", resourceKey: parts[1] };
  if (parts[0] === "partidos" && parts[1]) return { resourceType: "party", resourceKey: parts[1] };
  if (parts[0] === "municipios" && parts[1] && parts[2]) return { resourceType: "municipality", resourceKey: `${parts[1]}/${parts[2]}` };
  if (parts[0] === "estados" && parts[1]) return { resourceType: "state", resourceKey: parts[1] };
  if (parts[0] === "eleicoes" && parts[1] && parts[2]) return { resourceType: "election", resourceKey: reproducible };
  if (parts[0] === "rankings") return { resourceType: "ranking", resourceKey: reproducible };
  if (parts[0] === "dados") return { resourceType: "indicator", resourceKey: reproducible };
  return null;
}

/** Ações de conta na página atual: favoritar e acompanhar. O limite do plano é decidido pela API. */
export function SaveCurrentPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const target = useMemo(() => targetFromLocation(pathname, query), [pathname, query]);
  const { data: me } = useAccount();
  const refreshAccount = useRefreshAccount();
  const signedIn = !!me && !!target;
  const favorites = useQuery({ queryKey: accountKeys.saved("favorite"), queryFn: () => getSavedItems("favorite"), enabled: signedIn });
  const watchlist = useQuery({ queryKey: accountKeys.saved("watchlist"), queryFn: () => getSavedItems("watchlist"), enabled: signedIn });
  const [busy, setBusy] = useState<Collection | null>(null);
  const [refusal, setRefusal] = useState<{ text: string; plan: boolean } | null>(null);
  useEffect(() => setRefusal(null), [pathname, query]);

  const returnTo = query ? `${pathname}?${query}` : pathname;
  const isSaved = (items: typeof favorites.data) =>
    !!target && !!items?.some((item) => item.resourceType === target.resourceType && item.resourceKey === target.resourceKey);
  const favorite = isSaved(favorites.data);
  const watching = isSaved(watchlist.data);

  if (me === undefined) return null;
  if (!me) {
    return (
      <TransitionLink href={`/entrar?returnTo=${encodeURIComponent(returnTo)}`} className="focus-ring rounded-full border border-line bg-surface/95 px-4 py-2 text-xs font-semibold text-fg shadow-lg backdrop-blur hover:bg-canvas">
        Entrar
      </TransitionLink>
    );
  }

  async function toggle(collection: Collection) {
    if (!me || !target) return;
    setBusy(collection);
    setRefusal(null);
    const selected = collection === "favorite" ? favorite : watching;
    try {
      if (selected) await removeSavedItem(me, collection, target.resourceType, target.resourceKey);
      else {
        await saveItem(me, {
          collection,
          resourceType: target.resourceType,
          resourceKey: target.resourceKey,
          label: savedPageLabel(document.title, target.resourceKey),
          href: returnTo,
          metadata: {},
        });
      }
      await refreshAccount();
    } catch (error) {
      const plan = planRefusalOf(error);
      const failure = selected ? "Não foi possível remover agora. Tente de novo." : "Não foi possível salvar agora. Tente de novo.";
      setRefusal(plan ? { text: plan.message, plan: true } : { text: failure, plan: false });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {refusal && (
        <p role="alert" className="max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-xs text-fg shadow-lg">
          {refusal.text}
          {refusal.plan && (
            <>
              {" "}
              <TransitionLink href="/planos" className="focus-ring rounded font-semibold text-accent-text underline underline-offset-2">Ver planos</TransitionLink>
            </>
          )}
        </p>
      )}
      <div className="flex items-center gap-2 rounded-full border border-line bg-surface/95 p-1.5 shadow-lg backdrop-blur">
        {target && (
          <>
            <button type="button" disabled={busy !== null} aria-pressed={favorite} onClick={() => void toggle("favorite")} className="focus-ring rounded-full px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-fg/[0.05] hover:text-fg disabled:opacity-60">
              {favorite ? "★" : "☆"} <span className="hidden sm:inline">Favorito</span>
            </button>
            <button type="button" disabled={busy !== null} aria-pressed={watching} onClick={() => void toggle("watchlist")} className="focus-ring rounded-full px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-fg/[0.05] hover:text-fg disabled:opacity-60">
              {watching ? "✓" : "+"} <span className="hidden sm:inline">Watchlist</span>
            </button>
          </>
        )}
        <TransitionLink href="/conta" className="focus-ring rounded-full bg-action px-3 py-1.5 text-xs font-semibold text-action-fg">Conta</TransitionLink>
      </div>
    </div>
  );
}
