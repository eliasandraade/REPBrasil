"use client";

import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
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

function SearchGlyph({ className }: { className?: string }) {
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

function PoliticianRow({ p }: { p: SearchPolitician }) {
  const title = displayName(p.ballotName ?? p.name);
  const civil = p.ballotName && displayName(p.name) !== title ? displayName(p.name) : null;
  const c = p.candidacy;
  const context = c ? [c.officeName, c.unitName ? displayName(c.unitName) : null, String(c.year), c.party].filter(Boolean).join(" · ") : null;
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-slate-100">{title}</span>
        {c?.elected && (
          <span className="flex-shrink-0 rounded border border-brand/30 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
            Eleito
          </span>
        )}
      </span>
      <span className="block truncate text-xs text-slate-500">
        {[civil, context].filter(Boolean).join(" — ") || "Sem candidatura importada"}
      </span>
    </>
  );
}

function TerritoryRow({ t }: { t: SearchTerritory }) {
  return (
    <>
      <span className="block truncate text-sm font-medium text-slate-100">
        {displayName(t.name)}
        {t.kind === "municipality" && <span className="font-normal text-slate-500"> · {t.uf}</span>}
      </span>
      <span className="block truncate text-xs text-slate-500">
        {t.kind === "state" ? "Estado" : "Município"} · eleições {electionYears(t.elections)}
      </span>
    </>
  );
}

function ElectionRow({ e }: { e: SearchElection }) {
  return (
    <>
      <span className="block truncate text-sm font-medium text-slate-100">
        {e.officeName ?? "Eleições"} {e.year}
      </span>
      <span className="block truncate text-xs text-slate-500">
        {displayName(e.placeName)} · {e.round}º turno
      </span>
    </>
  );
}

function PartyRow({ p }: { p: SearchParty }) {
  return (
    <>
      <span className="block truncate text-sm font-medium text-slate-100">
        {p.acronym}
        {p.name && <span className="font-normal text-slate-400"> · {displayName(p.name)}</span>}
      </span>
      <span className="block truncate text-xs text-slate-500">
        {p.number ? `nº ${p.number} · ` : ""}
        {formatCount(p.candidacies)} candidaturas · ver candidatos
      </span>
    </>
  );
}

function OptionContent({ option }: { option: SearchOption }) {
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
  return [f.officeName, f.year, f.round != null ? `${f.round}º turno` : null].filter((x) => x != null).join(" · ");
}

// ─── Combobox ─────────────────────────────────────────────────────────────────

interface SearchBoxProps {
  /** "dialog": resultados abaixo, sempre visíveis; "inline": painel flutuante enquanto o campo tem foco. */
  variant: "dialog" | "inline";
  autoFocus?: boolean;
  /** Chamado antes de navegar (o diálogo fecha). */
  onNavigate?: () => void;
  /** Esc com o campo vazio (o diálogo fecha). */
  onEscapeEmpty?: () => void;
  placeholder?: string;
}

export function SearchBox({ variant, autoFocus, onNavigate, onEscapeEmpty, placeholder }: Readonly<SearchBoxProps>) {
  const navigate = useNavigate();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const statusId = `${baseId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(text, DEBOUNCE_MS);
  const query = searchableQuery(debounced);
  const typed = searchableQuery(text);

  const { data, isError, refetch } = useQuery({
    queryKey: ["search", query],
    queryFn: ({ signal }) => searchAll(query as string, signal),
    enabled: query !== null,
    staleTime: 5 * 60_000,
  });
  // nunca resultado antigo sob uma consulta nova: só vale o da consulta que está no campo
  const settled = typed !== null && query === typed;
  const response = settled ? data : undefined;
  const options = useMemo(() => searchOptions(response), [response]);
  const withoutData = useMemo(() => placesWithoutData(response), [response]);
  const understood = filterText(response);

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
    if (e.key === "ArrowDown" && options.length > 0) {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp" && options.length > 0) {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(options[active] ?? options[0]);
    } else if (e.key === "Escape") {
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        setText("");
      } else {
        onEscapeEmpty?.();
      }
    }
  };

  const loading = typed !== null && !response && !isError;
  const status = isError
    ? "Não foi possível buscar agora."
    : typed === null
      ? ""
      : loading
        ? `Buscando “${typed}”…`
        : options.length === 0
          ? `Nada encontrado para “${typed}”.`
          : `${options.length} ${options.length === 1 ? "resultado" : "resultados"}`;
  const expanded = typed !== null && options.length > 0;
  const showPanel = variant === "dialog" || focused;
  const activeOption = expanded ? options[active] : undefined;

  let groupStart = -1;
  const panel = (
    <div className={variant === "dialog" ? "min-h-0 flex-1 overflow-y-auto" : ""}>
      {typed === null && (
        <div className="px-4 py-4">
          <p className="text-xs text-slate-500">Busque por nome de urna, município, partido ou eleição. Exemplos:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SEARCH_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setText(ex);
                  inputRef.current?.focus();
                }}
                className="focus-ring rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 transition-colors hover:border-brand/40 hover:text-white"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {understood && expanded && (
        <p className="px-4 pt-3 text-[11px] text-slate-500">
          Filtrando por <span className="text-slate-300">{understood}</span>
        </p>
      )}

      {loading && (
        <div aria-hidden="true" className="space-y-4 px-4 py-4">
          {["w-2/5", "w-1/3", "w-1/2"].map((w) => (
            <div key={w}>
              <div className={`skeleton h-4 ${w}`} />
              <div className="skeleton mt-1.5 h-3 w-3/5" />
            </div>
          ))}
        </div>
      )}

      <div id={listId} role="listbox" aria-label="Resultados da busca" className={expanded ? "py-1" : "hidden"}>
        {(response?.order ?? []).map((group) => {
          const groupOptions = options.filter((o) => o.group === group);
          if (groupOptions.length === 0) return null;
          groupStart = options.indexOf(groupOptions[0]);
          const headingId = `${listId}-${group}`;
          return (
            <div key={group} role="group" aria-labelledby={headingId} className="pb-1">
              <div id={headingId} role="presentation" className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                {GROUP_LABEL[group]}
              </div>
              {groupOptions.map((option, i) => {
                const index = groupStart + i;
                const selected = index === active;
                return (
                  <div
                    key={option.id}
                    id={`${listId}-${option.id}`}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(index)}
                    className={selected ? "bg-white/[0.06]" : ""}
                  >
                    <TransitionLink
                      href={option.href}
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onNavigate?.()}
                      className="block min-w-0 px-4 py-2"
                    >
                      <OptionContent option={option} />
                    </TransitionLink>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {typed !== null && withoutData.length > 0 && (
        <p className="px-4 pb-3 pt-1 text-[11px] leading-relaxed text-slate-600">
          Ainda sem eleições importadas:{" "}
          {withoutData.map((t) => `${displayName(t.name)} (${t.uf})`).join(", ")}.
        </p>
      )}

      {isError && (
        <div className="flex items-center gap-3 px-4 py-4 text-sm text-slate-400">
          Não foi possível buscar agora.
          <button type="button" onClick={() => refetch()} className="focus-ring rounded text-brand hover:underline">
            Tentar de novo
          </button>
        </div>
      )}

      {typed !== null && !isError && !loading && options.length === 0 && withoutData.length === 0 && response && (
        <p className="px-4 py-4 text-sm text-slate-400">
          Nada encontrado para “{typed}”. Tente o nome de urna, um município ou “Deputado Federal 2022”.
        </p>
      )}
    </div>
  );

  return (
    <div className={variant === "dialog" ? "flex min-h-0 flex-1 flex-col" : "relative"}>
      <div className={`relative flex items-center gap-3 px-4 ${variant === "dialog" ? "border-b border-white/[0.08] py-3" : "rounded-xl border border-white/10 bg-card py-3 focus-within:border-brand/50"}`}>
        <SearchGlyph className="h-5 w-5 flex-shrink-0 text-slate-500" />
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
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="min-w-0 flex-1 bg-transparent text-base text-slate-100 outline-none placeholder:text-slate-500 [&::-webkit-search-cancel-button]:hidden"
        />
        <div aria-hidden="true" data-pending={loading} className={`absolute inset-x-3 bottom-0 ${loading ? "query-trace" : "h-px"}`} />
      </div>
      <p id={statusId} role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {variant === "dialog"
        ? panel
        : showPanel &&
          (typed === null || loading || expanded || isError || response) && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              className="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(28rem,70vh)] overflow-y-auto rounded-xl border border-white/10 bg-card shadow-card"
            >
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
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        className="m-0 h-[100dvh] max-h-none w-full max-w-none bg-transparent p-0 text-slate-100 backdrop:bg-black/70 sm:mx-auto sm:mt-[12vh] sm:h-fit sm:w-[min(640px,calc(100vw-2rem))]"
      >
        {open && (
          <div className="flex h-full flex-col overflow-hidden border-white/10 bg-card shadow-card sm:max-h-[70vh] sm:rounded-xl sm:border">
            <SearchBox variant="dialog" autoFocus onNavigate={() => setOpen(false)} onEscapeEmpty={() => setOpen(false)} />
            <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[11px] text-slate-600">
              <span className="hidden sm:inline">↑ ↓ para escolher · Enter para abrir · Esc para fechar</span>
              <button type="button" onClick={() => setOpen(false)} className="focus-ring ml-auto rounded px-2 py-1 text-slate-400 hover:text-slate-200">
                Fechar
              </button>
            </div>
          </div>
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
        className="focus-ring rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
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
      className="focus-ring flex w-full items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-2 text-left text-sm text-slate-500 transition-colors hover:border-white/20 hover:text-slate-300"
    >
      <SearchGlyph className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 truncate">Buscar…</span>
      <kbd className="rounded border border-white/10 px-1.5 font-sans text-[10px] text-slate-500">/</kbd>
    </button>
  );
}
