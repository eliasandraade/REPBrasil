"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getAccount, getSavedItems, removeSavedItem, saveItem, type AccountMe } from "@/lib/account";
import { TransitionLink } from "@/motion/navigation";

type Target = { resourceType: string; resourceKey: string };

function targetFromLocation(pathname: string, query: string): Target | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "politicos" && parts[1]) return { resourceType: "politician", resourceKey: parts[1] };
  if (parts[0] === "partidos" && parts[1]) return { resourceType: "party", resourceKey: parts[1] };
  if (parts[0] === "municipios" && parts[1] && parts[2]) return { resourceType: "municipality", resourceKey: `${parts[1]}/${parts[2]}` };
  if (parts[0] === "estados" && parts[1]) return { resourceType: "state", resourceKey: parts[1] };
  if (parts[0] === "eleicoes" && parts[1] && parts[2]) return { resourceType: "election", resourceKey: `${parts[1]}/${parts[2]}` };
  const reproducible = query ? `${pathname}?${query}` : pathname;
  if (parts[0] === "rankings") return { resourceType: "ranking", resourceKey: reproducible };
  if (parts[0] === "dados") return { resourceType: "indicator", resourceKey: reproducible };
  return null;
}

export function SaveCurrentPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const target = useMemo(() => targetFromLocation(pathname, query), [pathname, query]);
  const [me, setMe] = useState<AccountMe | null | undefined>(undefined);
  const [favorite, setFavorite] = useState(false);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState<"favorite" | "watchlist" | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const account = await getAccount().catch(() => null);
      if (!active) return;
      setMe(account);
      setFavorite(false);
      setWatching(false);
      if (!account || !target) return;
      const [favorites, watchlist] = await Promise.all([getSavedItems("favorite"), getSavedItems("watchlist")]);
      if (!active) return;
      setFavorite(favorites.some((item) => item.resourceType === target.resourceType && item.resourceKey === target.resourceKey));
      setWatching(watchlist.some((item) => item.resourceType === target.resourceType && item.resourceKey === target.resourceKey));
    }
    void load();
    return () => { active = false; };
  }, [target]);

  const returnTo = query ? `${pathname}?${query}` : pathname;

  if (me === undefined) return null;
  if (!me) {
    return (
      <TransitionLink href={`/entrar?returnTo=${encodeURIComponent(returnTo)}`} className="focus-ring rounded-full border border-line bg-surface/95 px-4 py-2 text-xs font-semibold text-fg shadow-lg backdrop-blur hover:bg-canvas">
        Entrar
      </TransitionLink>
    );
  }

  async function toggle(collection: "favorite" | "watchlist") {
    if (!me || !target) return;
    setBusy(collection);
    const selected = collection === "favorite" ? favorite : watching;
    try {
      if (selected) await removeSavedItem(me, collection, target.resourceType, target.resourceKey);
      else {
        await saveItem(me, {
          collection,
          resourceType: target.resourceType,
          resourceKey: target.resourceKey,
          label: document.title.replace(/\s*[|—-]\s*REPBrasil.*$/i, "") || target.resourceKey,
          href: returnTo,
          metadata: {},
        });
      }
      if (collection === "favorite") setFavorite(!selected);
      else setWatching(!selected);
    } finally { setBusy(null); }
  }

  return (
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
      <TransitionLink href="/conta" className="focus-ring rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white">Conta</TransitionLink>
    </div>
  );
}
