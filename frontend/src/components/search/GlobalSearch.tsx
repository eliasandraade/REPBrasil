"use client";

import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { displayName, formatCount } from "@/lib/elections/format";
import {
  GROUP_LABEL,
  SEARCH_EXAMPLES,
  SEARCH_MAX_LENGTH,
  electionYears,
  placesWithoutData,
  searchAll,
  searchOptions,
  searchableQuery,
  type SearchElection,
  type SearchOption,
  type SearchParty,
  type SearchPolitician,
  type SearchResponse,
  type SearchTerritory,
} from "@/lib/search";
import { TransitionLink, useNavigate } from "@/motion/navigation";
import { SearchDialogContext, useOpenSearch } from "./search-context";

export { useOpenSearch } from "./search-context";

const DEBOUNCE_MS = 160;

function SearchGlyph({ className }: Readonly<{ className?: string }>) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ─── Linhas de resultado ──────────────────────────────────────────────────────

function PoliticianRow({ p }: Readonly<{ p: SearchPolitician }>) {
  const title = displayName(p.ballotName ?? p.name);
  const civil = p.ballotName && displayName(p.name) !== title ? displayName(p.name) : null;
  const c = p.candidacy;
  const context = c ? [c.officeName, c.unitName ? displayName(c.unitName) : null, String(c.year), c.party].filter(Boolean).join(" · ") : null;
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-fg">{title}</span>
        {c?.elected && (
          <span className="flex-shrink-0 rounded border border-accent/30 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent-text">
            Eleito
          </span>
        )}
      </span>
      <span className="block truncate text-xs text-fg-muted">
        {[civil, context].filter(Boolean).join(" — ") || "Sem candidatura importada"}
      </span>
    </>
  );
}

function TerritoryRow({ t }: Readonly<{ t: SearchTerritory }>) {
  return (
    <>
      <span className="block truncate text-sm font-medium text-fg">
        {displayName(t.name)}
        {t.kind === "municipality" && <span className="font-normal text-fg-muted"> · {t.uf}</span>}
      </span>
      <span className="block truncate text-xs text-fg-muted">
        {t.kind === "state" ? "Estado" : "Município"} · eleições {electionYears(t.elections)}
      </span>
    </>
  );
}

function ElectionRow({ e }: Readonly<{ e: SearchElection }>) {
  return (
    <>
      <span className="block truncate text-sm font-medium text-fg">
        {e.officeName ?? "Eleições"} {e.year}
      </span>
      <span className="block truncate text-xs text-fg-muted">
        {displayName(e.placeName)} · {e.round}º turno
      </span>
    </>
  );
}

function PartyRow({ p }: Readonly<{ p: SearchParty }>) {
  return (
    <>
      <span className="block truncate text-sm font-medium text-fg">
        {p.acronym}
        {p.name && <span className="font-normal text-fg-muted"> · {displayName(p.name)}</span>}
      </span>
      <span className="block truncate text-xs text-fg-muted">
        {p.number ? `nº ${p.number} · ` : ""}
        {formatCount(p.candidacies)} candidaturas · ver candidatos
      </span>
    </>
  );
}

function OptionContent({ option }: Readonly<{ option: SearchOption }>) {
  switch (option.group) {
    case "politicians":
      return <PoliticianRow p={option.item as SearchPolitician} />;
    case "territories":
      return <TerritoryRow t={option.item as SearchTerritory} />;
    case "elections":
      return <ElectionRow e={option.item as SearchElection} />;
    default:
      return <PartyRow p={option.item as SearchParty} />;
  }
}

/** O que a busca entendeu da consulta ("Deputado Federal · 2022 · 2º turno") — previsível, sem mágica. */
function filterText(r: SearchResponse | undefined): string | null {
  const f = r?.filter;
  if (!f || (f.year == null && f.round == null && f.officeName == null)) return null;
  return [f.officeName, f.year, f.round == null ? null : `${f.round}º turno`].filter((x) => x != null).join(" · ");
}

/** Linha de status lida por leitores de tela (e testada): o que está acontecendo, em uma frase. */
export function statusText(state: { typed: string | null; isError: boolean; loading: boolean; count: number }): string {
  if (state.isError) return "Não foi possível buscar agora.";
  if (state.typed === null) return "";
  if (state.loading) return `Buscando “${state.typed}”…`;
  if (state.count === 0) return `Nada encontrado para “${state.typed}”.`;
  return `${state.count} ${state.count === 1 ? "resultado" : "resultados"}`;
}

// ─── Partes do painel ─────────────────────────────────────────────────────────

function Examples({ onPick }: Readonly<{ onPick: (example: string) => void }>) {
  return (
    <div className="px-4 py-4">
      <p className="text-xs text-fg-muted">Busque por nome de urna, município, partido ou eleição. Exemplos:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {SEARCH_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="focus-ring rounded-full border border-line px-3 py-1 text-xs text-fg-soft transition-colors hover:border-accent/40 hover:text-fg"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div aria-hidden="true" className="space-y-4 px-4 py-4">
      {["w-2/5", "w-1/3", "w-1/2"].map((w) => (
        <div key={w}>
          <div className={`skeleton h-4 ${w}`} />
          <div className="skeleton mt-1.5 h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

/**
 * Lista de opções agrupada (WAI-ARIA listbox com grupos). O foco fica no campo (aria-activedescendant);
 * as opções são focáveis só por programa (tabIndex −1) e o link real permite abrir em nova aba.
 */
function Results({
  listId,
  response,
  options,
  active,
  onHover,
  onNavigate,
}: Readonly<{
  listId: string;
  response: SearchResponse | undefined;
  options: SearchOption[];
  active: number;
  onHover: (index: number) => void;
  onNavigate?: () => void;
}>) {
  return (
    <div id={listId} role="listbox" aria-label="Resultados da busca" className={options.length > 0 ? "py-1" : "hidden"}>
      {(response?.order ?? []).map((group) => {
        const groupOptions = options.filter((o) => o.group === group);
        if (groupOptions.length === 0) return null;
        const start = options.indexOf(groupOptions[0]);
        return (
          <div key={group} role="group" aria-label={GROUP_LABEL[group]} className="pb-1">
            <div aria-hidden="true" className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
              {GROUP_LABEL[group]}
            </div>
            {groupOptions.map((option, i) => {
              const selected = start + i === active;
              return (
                <div
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  onMouseEnter={() => onHover(start + i)}
                  className={selected ? "bg-fg/[0.06]" : ""}
                >
                  <TransitionLink href={option.href} tabIndex={-1} onClick={() => onNavigate?.()} className="block min-w-0 px-4 py-2">
                    <OptionContent option={option} />
                  </TransitionLink>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Notes({
  typed,
  response,
  withoutData,
  isError,
  empty,
  onRetry,
}: Readonly<{
  typed: string | null;
  response: SearchResponse | undefined;
  withoutData: SearchTerritory[];
  isError: boolean;
  empty: boolean;
  onRetry: () => void;
}>) {
  return (
    <>
      {typed !== null && withoutData.length > 0 && (
        <p className="px-4 pb-3 pt-1 text-[11px] leading-relaxed text-fg-muted">
          Ainda sem eleições importadas: {withoutData.map((t) => `${displayName(t.name)} (${t.uf})`).join(", ")}.
        </p>
      )}
      {isError && (
        <div className="flex items-center gap-3 px-4 py-4 text-sm text-fg-muted">
          <span>Não foi possível buscar agora.</span>
          <button type="button" onClick={onRetry} className="focus-ring rounded text-accent-text hover:underline">
            Tentar de novo
          </button>
        </div>
      )}
      {empty && response && withoutData.length === 0 && (
        <p className="px-4 py-4 text-sm text-fg-muted">
          Nada encontrado para “{typed}”. Tente o nome de urna, um município ou “Deputado Federal 2022”.
        </p>
      )}
    </>
  );
}

// ─── Combobox ─────────────────────────────────────────────────────────────────

interface SearchBoxProps {
  /** "dialog": resultados abaixo, sempre visíveis; "inline": painel flutuante enquanto há foco dentro da busca. */
  variant: "dialog" | "inline";
  autoFocus?: boolean;
  /** Chamado antes de navegar (o diálogo fecha). */
  onNavigate?: () => void;
  /** Esc com o campo vazio (o diálogo fecha). */
  onEscapeEmpty?: () => void;
  placeholder?: string;
}

/** Resultado da consulta que está no campo — nunca o de uma consulta anterior. */
function useSearchResults(text: string) {
  const debounced = useDebounced(text, DEBOUNCE_MS);
  const query = searchableQuery(debounced);
  const typed = searchableQuery(text);
  const { data, isError, refetch } = useQuery({
    queryKey: ["search", query],
    queryFn: ({ signal }) => searchAll(query as string, signal),
    enabled: query !== null,
    staleTime: 5 * 60_000,
  });
  const response = typed !== null && query === typed ? data : undefined;
  const options = useMemo(() => searchOptions(response), [response]);
  const withoutData = useMemo(() => placesWithoutData(response), [response]);
  return { typed, response, options, withoutData, isError, refetch, loading: typed !== null && !response && !isError };
}

export function SearchBox({ variant, autoFocus, onNavigate, onEscapeEmpty, placeholder }: Readonly<SearchBoxProps>) {
  const navigate = useNavigate();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const statusId = `${baseId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const { typed, response, options, withoutData, isError, refetch, loading } = useSearchResults(text);

  useEffect(() => setActive(0), [response]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const go = useCallback(
    (option: SearchOption | undefined) => {
      if (!option) return;
      onNavigate?.();
      navigate(option.href);
    },
    [navigate, onNavigate],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const count = options.length;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (count === 0) return;
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      case "Enter":
        e.preventDefault();
        go(options[active] ?? options[0]);
        return;
      case "Escape":
        if (!text) {
          onEscapeEmpty?.();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        setText("");
        return;
    }
  };

  // painel aberto enquanto o foco estiver em qualquer parte da busca (campo, exemplos, opções)
  const onFocusOut = (e: FocusEvent<HTMLDivElement>) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) setFocused(false);
  };

  const expanded = typed !== null && options.length > 0;
  const showPanel = variant === "dialog" || focused;
  const activeOption = expanded ? options[active] : undefined;
  const understood = filterText(response);

  const panel = (
    <div className={variant === "dialog" ? "min-h-0 flex-1 overflow-y-auto" : ""}>
      {typed === null && (
        <Examples
          onPick={(example) => {
            setText(example);
            inputRef.current?.focus();
          }}
        />
      )}
      {understood && expanded && (
        <p className="px-4 pt-3 text-[11px] text-fg-muted">
          Filtrando por <span className="text-fg-soft">{understood}</span>
        </p>
      )}
      {loading && <LoadingRows />}
      <Results listId={listId} response={response} options={options} active={active} onHover={setActive} onNavigate={onNavigate} />
      <Notes
        typed={typed}
        response={response}
        withoutData={withoutData}
        isError={isError}
        empty={typed !== null && !isError && !loading && options.length === 0}
        onRetry={() => refetch()}
      />
    </div>
  );
  const inlinePanelVisible = showPanel && (typed === null || loading || expanded || isError || !!response);

  return (
    <div
      ref={containerRef}
      onFocus={() => setFocused(true)}
      onBlur={onFocusOut}
      className={variant === "dialog" ? "flex min-h-0 flex-1 flex-col" : "relative"}
    >
      <div
        className={`relative flex items-center gap-3 px-4 ${variant === "dialog" ? "border-b border-line py-3" : "rounded-xl border border-line bg-surface py-3 focus-within:border-accent/50"}`}
      >
        <SearchGlyph className="h-5 w-5 flex-shrink-0 text-fg-muted" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showPanel && expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && activeOption ? `${listId}-${activeOption.id}` : undefined}
          aria-describedby={statusId}
          aria-label="Buscar políticos, lugares, partidos e eleições"
          placeholder={placeholder ?? "Buscar político, município, partido ou eleição"}
          autoComplete="off"
          spellCheck={false}
          maxLength={SEARCH_MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-muted [&::-webkit-search-cancel-button]:hidden"
        />
        <div aria-hidden="true" data-pending={loading} className={`absolute inset-x-3 bottom-0 ${loading ? "query-trace" : "h-px"}`} />
      </div>
      <p id={statusId} role="status" aria-live="polite" className="sr-only">
        {statusText({ typed, isError, loading, count: options.length })}
      </p>
      {variant === "dialog" && panel}
      {variant === "inline" && inlinePanelVisible && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(28rem,70vh)] overflow-y-auto rounded-xl border border-line bg-surface shadow-card">
          {panel}
        </div>
      )}
    </div>
  );
}

// ─── Diálogo global (atalho "/" e Ctrl/⌘+K) ──────────────────────────────────

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function SearchProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openSearch = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const shortcut = (e.key === "/" && !isEditable(e.target)) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k");
      if (!shortcut || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  return (
    <SearchDialogContext.Provider value={openSearch}>
      {children}
      <dialog
        ref={dialogRef}
        aria-label="Buscar no REPBrasil"
        onClose={close}
        onCancel={close}
        className="m-0 h-[100dvh] max-h-none w-full max-w-none bg-transparent p-0 text-fg backdrop:bg-black/70 sm:mx-auto sm:mt-[12vh] sm:h-fit sm:w-[min(640px,calc(100vw-2rem))]"
      >
        {open && (
          <>
            {/* Fora do painel: um botão de verdade (clique no fundo fecha; o teclado fecha com Esc ou "Fechar"). */}
            <button type="button" tabIndex={-1} aria-label="Fechar a busca" onClick={close} className="fixed inset-0 cursor-default" />
            <div className="relative flex h-full flex-col overflow-hidden border-line bg-surface shadow-card sm:max-h-[70vh] sm:rounded-xl sm:border">
              <SearchBox variant="dialog" autoFocus onNavigate={close} onEscapeEmpty={close} />
              <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-fg-muted">
                <span className="hidden sm:inline">↑ ↓ para escolher · Enter para abrir · Esc para fechar</span>
                <button type="button" onClick={close} className="focus-ring ml-auto rounded px-2 py-1 text-fg-muted hover:text-fg-soft">
                  Fechar
                </button>
              </div>
            </div>
          </>
        )}
      </dialog>
    </SearchDialogContext.Provider>
  );
}

/** Botão que abre a busca: largo na barra lateral, só ícone na barra do celular. */
export function SearchTrigger({ compact = false }: Readonly<{ compact?: boolean }>) {
  const openSearch = useOpenSearch();
  if (compact)
    return (
      <button
        type="button"
        onClick={openSearch}
        aria-label="Buscar"
        aria-haspopup="dialog"
        className="focus-ring rounded-md p-1.5 text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg-soft"
      >
        <SearchGlyph className="h-5 w-5" />
      </button>
    );
  return (
    <button
      type="button"
      onClick={openSearch}
      aria-haspopup="dialog"
      aria-keyshortcuts="/ Control+K"
      className="focus-ring flex w-full items-center gap-2 rounded-md border border-line bg-fg/[0.02] px-2.5 py-2 text-left text-sm text-fg-muted transition-colors hover:border-line-strong hover:text-fg-soft"
    >
      <SearchGlyph className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 truncate">Buscar…</span>
      <kbd className="rounded border border-line px-1.5 font-sans text-[10px] text-fg-muted">/</kbd>
    </button>
  );
}
