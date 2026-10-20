"use client";

import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { TransitionLink } from "@/motion/navigation";
import { accountErrorMessage, getSavedItems, moveSavedItem, planRefusalOf, removeSavedItem, type SavedItem } from "@/lib/account";
import { FAVORITES_LIMIT, SAVED_FOLDERS, WATCHLIST_LIMIT } from "@/lib/plans";
import { accountKeys, useAccount, useCapability, useRefreshAccount } from "@/lib/useAccount";
import { UsageMeter } from "./UsageMeter";
import { formatDate, RESOURCE_LABEL } from "./format";

type Collection = "favorite" | "watchlist";

const COPY: Record<Collection, { title: string; empty: string; limit: string }> = {
  favorite: {
    title: "Favoritos",
    empty: "Nenhum favorito ainda. Em qualquer perfil, eleição, ranking ou recorte de dados, use “Favorito” no canto da tela.",
    limit: FAVORITES_LIMIT,
  },
  watchlist: {
    title: "Watchlist",
    empty: "Sua watchlist está vazia. Use “Watchlist” no canto da tela para acompanhar políticos, partidos, municípios e estados.",
    limit: WATCHLIST_LIMIT,
  },
};

const UNFILED = "";

/** Pastas em ordem alfabética; itens sem pasta por último. */
function byFolder(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNFILED) return 1;
  if (b === UNFILED) return -1;
  return a.localeCompare(b, "pt-BR");
}

/** Itens salvos de uma coleção, agrupados por pasta (pastas são do plano Profissional). */
export function SavedSection({ collection }: Readonly<{ collection: Collection }>) {
  const { data: me } = useAccount();
  const canFolder = useCapability(SAVED_FOLDERS);
  const refreshAccount = useRefreshAccount();
  const items = useQuery({ queryKey: accountKeys.saved(collection), queryFn: () => getSavedItems(collection), enabled: !!me });
  const [message, setMessage] = useState<{ tone: "error" | "status"; text: string } | null>(null);
  if (!me) return null;

  const copy = COPY[collection];
  const folders = [...new Set((items.data ?? []).map((item) => item.folder ?? UNFILED))].sort(byFolder);
  const existingFolders = folders.filter((f) => f !== UNFILED);

  async function remove(item: SavedItem) {
    setMessage(null);
    try {
      await removeSavedItem(me!, item.collection, item.resourceType, item.resourceKey);
      await refreshAccount();
    } catch {
      setMessage({ tone: "error", text: "Não foi possível remover o item agora. Tente de novo." });
    }
  }

  async function move(item: SavedItem, folder: string | null) {
    setMessage(null);
    try {
      await moveSavedItem(me!, item, folder);
      await refreshAccount();
      setMessage({ tone: "status", text: folder ? `Movido para “${folder}”.` : "Tirado da pasta." });
    } catch (error) {
      setMessage({ tone: "error", text: planRefusalOf(error)?.message ?? accountErrorMessage(error) ?? "Não foi possível mover o item agora." });
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section aria-labelledby={`saved-${collection}`}>
        <h2 id={`saved-${collection}`} className="sr-only">{copy.title}</h2>
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`mb-4 text-body-sm ${message.tone === "error" ? "text-danger" : "text-fg-soft"}`}>
            {message.text}
          </p>
        )}
        {items.isPending && <DataState kind="loading" title={`Carregando ${copy.title.toLowerCase()}`} height="h-48" />}
        {items.isError && <DataState kind="error" title={`Não foi possível carregar ${copy.title.toLowerCase()}`} action={<RetryButton onRetry={() => void items.refetch()} />} />}
        {items.isSuccess && items.data.length === 0 && <p className="text-body-sm text-fg-muted">{copy.empty}</p>}
        {items.isSuccess &&
          folders.map((folder) => {
            const inFolder = items.data.filter((item) => (item.folder ?? UNFILED) === folder);
            return (
              <div key={folder || "sem-pasta"} className="mb-8">
                {(existingFolders.length > 0 || folder !== UNFILED) && (
                  <h3 className="mb-2 text-label uppercase text-fg-muted">{folder === UNFILED ? "Sem pasta" : folder}</h3>
                )}
                <ul className="divide-y divide-line border-y border-line">
                  {inFolder.map((item) => (
                    <SavedRow key={item.id} item={item} canFolder={canFolder === true} folders={existingFolders} onRemove={remove} onMove={move} />
                  ))}
                </ul>
              </div>
            );
          })}
      </section>

      <aside className="space-y-4 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <UsageMeter
          label={copy.title}
          used={collection === "favorite" ? me.usage.favorites : me.usage.watchlist}
          max={me.limits[copy.limit] ?? 0}
        />
        {canFolder === false && (
          <p className="text-body-sm text-fg-muted">
            Organizar em pastas faz parte do plano Profissional.{" "}
            <TransitionLink href="/planos" className="focus-ring mi-underline rounded text-accent-text">Ver planos</TransitionLink>
          </p>
        )}
      </aside>
    </div>
  );
}

function SavedRow({
  item,
  canFolder,
  folders,
  onRemove,
  onMove,
}: Readonly<{
  item: SavedItem;
  canFolder: boolean;
  folders: string[];
  onRemove: (item: SavedItem) => Promise<void>;
  onMove: (item: SavedItem, folder: string | null) => Promise<void>;
}>) {
  const [editing, setEditing] = useState(false);
  const [folder, setFolder] = useState(item.folder ?? "");
  const ids = useId();
  const label = item.label || item.resourceKey;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onMove(item, folder.trim() || null);
    setEditing(false);
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {item.href ? (
            <TransitionLink href={item.href} className="focus-ring mi-underline block truncate rounded text-body-sm font-medium text-fg">
              {label}
            </TransitionLink>
          ) : (
            <p className="truncate text-body-sm font-medium text-fg">{label}</p>
          )}
          <p className="mt-0.5 text-micro text-fg-muted">
            {RESOURCE_LABEL[item.resourceType] ?? item.resourceType} · salvo em {formatDate(item.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canFolder && (
            <button type="button" onClick={() => setEditing((v) => !v)} aria-expanded={editing} aria-controls={`${ids}-folder`}
              className="focus-ring rounded-md px-2 py-1 text-micro font-medium text-fg-muted hover:bg-fg/[0.05] hover:text-fg">
              Pasta
            </button>
          )}
          <button type="button" onClick={() => void onRemove(item)} aria-label={`Remover ${label}`}
            className="focus-ring rounded-md px-2 py-1 text-micro font-medium text-fg-muted hover:bg-fg/[0.05] hover:text-fg">
            Remover
          </button>
        </div>
      </div>
      {canFolder && editing && (
        <form id={`${ids}-folder`} onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-micro text-fg-muted">
            Nome da pasta (vazio tira da pasta)
            <input value={folder} onChange={(e) => setFolder(e.target.value)} maxLength={60} list={`${ids}-folders`}
              className="focus-ring mt-1 block w-56 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-body-sm text-fg" />
          </label>
          <datalist id={`${ids}-folders`}>
            {folders.map((name) => <option key={name} value={name} />)}
          </datalist>
          <button type="submit" className="focus-ring mi-press rounded-md bg-action px-3 py-1.5 text-micro font-semibold text-action-fg">Salvar</button>
        </form>
      )}
    </li>
  );
}
