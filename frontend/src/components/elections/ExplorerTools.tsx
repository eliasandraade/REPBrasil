"use client";

import { useQuery } from "@tanstack/react-query";
import { useResolvedTheme } from "@/components/theme/theme";
import Link from "next/link";
import { useMemo } from "react";
import { buildLayerView, LAYER_LABEL, type MapLayerView } from "@/lib/elections/map-layers";
import { displayName } from "@/lib/elections/format";
import { electionLabel, MAX_COMPARE, serializeSelection, xrayApi, type MapLayerParams } from "@/lib/elections/xray";
import type { MapLayerKind } from "@/lib/elections/xray-types";

export interface LayerState {
  layer: MapLayerKind | null;
  office: number | null;
  candidacy: string | null;
  base: string | null;
  a: string | null;
  b: string | null;
}

const LAYERS: MapLayerKind[] = ["intensity", "share", "base", "winner", "growth", "decline", "ab"];

/** Nomes das candidaturas selecionadas (a URL guarda só os ids). */
export function useSelectionNames(ids: string[], uf: string | null) {
  const q = useQuery({
    queryKey: ["selection-names", ids.join(","), uf],
    queryFn: () => xrayApi.compare(ids, { uf: uf!, level: "state" }),
    enabled: ids.length > 0 && !!uf,
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const c of q.data?.candidacies ?? [])
      names.set(c.candidacyId, `${displayName(c.ballotName)} · ${displayName(c.contest.officeName)} ${electionLabel(c.contest.year, c.contest.round)}`);
    return names;
  }, [q.data]);
}

/** Valores da camada temática (API) já convertidos em cores neutras para o mapa. */
export function useMapLayer(year: number, round: number, uf: string | null, municipality: string | null, s: LayerState) {
  const params: MapLayerParams | null = useMemo(() => {
    if (!s.layer || !uf) return null;
    const p: MapLayerParams = { layer: s.layer, municipality };
    if (s.layer === "winner") return s.office ? { ...p, office: s.office } : null;
    if (s.layer === "intensity" || s.layer === "share" || s.layer === "base") return s.candidacy ? { ...p, candidacy: s.candidacy } : null;
    if (s.layer === "growth" || s.layer === "decline") return s.candidacy && s.base ? { ...p, candidacy: s.candidacy, base: s.base } : null;
    return s.a && s.b ? { ...p, a: s.a, b: s.b } : null;
  }, [s, uf, municipality]);
  const q = useQuery({
    queryKey: ["map-layer", year, round, uf, params],
    queryFn: () => xrayApi.map(year, round, uf!, params!),
    enabled: !!params,
    staleTime: 60_000,
  });
  const theme = useResolvedTheme();
  const view: MapLayerView | null = useMemo(() => (q.data && params ? buildLayerView(q.data, theme) : null), [q.data, params, theme]);
  return { view, response: q.data ?? null, loading: q.isFetching, error: q.isError, ready: !!params };
}

export function MapLayerBar({
  state,
  onChange,
  selection,
  names,
  offices,
  note,
  loading,
  error,
  disabled,
}: Readonly<{
  state: LayerState;
  onChange: (next: Partial<LayerState>) => void;
  selection: string[];
  names: Map<string, string>;
  offices: Array<{ value: string; label: string }>;
  note: string | null;
  loading: boolean;
  error: boolean;
  disabled: boolean;
}>) {
  const select = "rounded-md border border-line bg-canvas px-2 py-1 text-xs text-fg-soft focus:border-accent/40 focus:outline-none";
  const options = (value: string | null, onPick: (v: string | null) => void, label: string) => (
    <select aria-label={label} className={select} value={value ?? ""} onChange={(e) => onPick(e.target.value || null)}>
      <option value="">{label}</option>
      {[...new Set([...(value ? [value] : []), ...selection])].map((id) => (
        <option key={id} value={id}>
          {names.get(id) ?? "Candidatura selecionada"}
        </option>
      ))}
    </select>
  );
  return (
    <div className="mb-2 rounded-xl border border-line bg-surface p-2.5" data-testid="map-layer-bar">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Camada</span>
        <button
          type="button"
          aria-pressed={state.layer === null}
          disabled={disabled}
          onClick={() => onChange({ layer: null })}
          className={`rounded border px-2 py-0.5 text-[11px] ${state.layer === null ? "border-accent bg-accent/15 text-accent-text" : "border-line text-fg-muted"}`}
        >
          Território
        </button>
        {LAYERS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={state.layer === l}
            disabled={disabled}
            onClick={() => onChange({ layer: l })}
            className={`rounded border px-2 py-0.5 text-[11px] disabled:opacity-40 ${state.layer === l ? "border-accent bg-accent/15 text-accent-text" : "border-line text-fg-muted hover:border-line-strong"}`}
          >
            {LAYER_LABEL[l]}
          </button>
        ))}
      </div>
      {state.layer && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {state.layer === "winner" && (
            <select aria-label="Cargo" className={select} value={state.office ?? ""} onChange={(e) => onChange({ office: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Escolha o cargo</option>
              {offices.map((o) => (
                <option key={o.value} value={o.value}>
                  {displayName(o.label)}
                </option>
              ))}
            </select>
          )}
          {(state.layer === "intensity" || state.layer === "share" || state.layer === "base") && options(state.candidacy, (v) => onChange({ candidacy: v }), "Candidatura")}
          {(state.layer === "growth" || state.layer === "decline") && (
            <>
              {options(state.base, (v) => onChange({ base: v }), "De (base)")}
              {options(state.candidacy, (v) => onChange({ candidacy: v }), "Para")}
            </>
          )}
          {state.layer === "ab" && (
            <>
              {options(state.a, (v) => onChange({ a: v }), "A")}
              {options(state.b, (v) => onChange({ b: v }), "B")}
            </>
          )}
          {loading && <span className="text-[11px] text-fg-muted">carregando…</span>}
          {error && <span className="text-[11px] text-warn">camada indisponível</span>}
        </div>
      )}
      {state.layer && state.layer !== "winner" && selection.length === 0 && !state.candidacy && (
        <p className="mt-1.5 text-[11px] text-fg-muted">Marque candidaturas para comparar (lista Candidaturas) ou use &ldquo;ver no mapa&rdquo;.</p>
      )}
      {note && <p className="mt-1.5 text-[11px] text-fg-muted">{note}</p>}
    </div>
  );
}

export function CompareTray({
  selection,
  names,
  uf,
  onRemove,
  onClear,
}: Readonly<{
  selection: string[];
  names: Map<string, string>;
  uf: string | null;
  onRemove: (id: string) => void;
  onClear: () => void;
}>) {
  if (selection.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-accent/20 bg-surface px-3 py-2 text-xs" data-testid="compare-tray">
      <span className="font-semibold text-fg-soft">
        Comparar ({selection.length}/{MAX_COMPARE})
      </span>
      {selection.map((id) => (
        <span key={id} className="flex items-center gap-1 rounded border border-line bg-fg/5 px-1.5 py-0.5 text-fg-soft">
          {names.get(id) ?? "Candidatura"}
          <button type="button" aria-label="Remover da comparação" onClick={() => onRemove(id)} className="text-fg-muted hover:text-fg-soft">
            ×
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear} className="text-fg-muted hover:text-fg-soft">
        limpar
      </button>
      {uf && (
        <Link
          href={`/eleicoes/comparar?c=${serializeSelection(selection)}&uf=${uf.toUpperCase()}&nivel=municipality`}
          className="ml-auto rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 font-medium text-accent-text hover:bg-accent/15"
        >
          Comparar →
        </Link>
      )}
    </div>
  );
}
