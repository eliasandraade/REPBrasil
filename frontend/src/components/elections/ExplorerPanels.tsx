"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatCount, normalizeText, pad3, sectionLabel, zoneLabel } from "@/lib/elections/format";
import { buildElectionsPath, type ExplorerRoute } from "@/lib/elections/route";
import type { MunicipalityDetailResponse, MunicipalityItem, StateItem } from "@/lib/elections/types";
import { searchPlaces, type ZoneModel } from "@/lib/elections/zone-model";

// ─── Peças visuais (design system REPBrasil: cards escuros, acento brand) ─────

export function AvailabilityBadge({ results, cadaster }: { results: boolean; cadaster: boolean }) {
  if (results)
    return (
      <span className="rounded border border-brand/25 bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand">
        resultados
      </span>
    );
  if (cadaster)
    return (
      <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
        cadastro
      </span>
    );
  return (
    <span className="rounded border border-white/5 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">sem cadastro</span>
  );
}

export function PanelTitle({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{eyebrow}</p>
      <h2 className="text-lg font-bold leading-tight text-slate-100">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <input
      type="search"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mb-3 w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 transition-colors duration-[var(--motion-acknowledge)] focus:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/15"
    />
  );
}

const rowClass =
  "flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-card-elevated/60 px-3 py-2.5 text-sm";
/** Linha navegável: marca o canto e eleva o fundo; nada se desloca. */
const linkRow = `${rowClass} mi-surface focus-ring hover:border-brand/30 hover:bg-card-elevated`;

// ─── Brasil → UFs ─────────────────────────────────────────────────────────────

export function CountryPanel({ route, states }: { route: ExplorerRoute; states: StateItem[] }) {
  const withResults = states.filter((s) => s.resultsAvailable);
  return (
    <div>
      <PanelTitle
        eyebrow="Brasil"
        title="Escolha uma UF"
        sub={`${withResults.length} de ${states.length} UFs com resultados importados nesta etapa.`}
      />
      <ul className="space-y-1.5" data-testid="state-list">
        {states.map((s) => (
          <li key={s.uf}>
            {s.cadasterAvailable ? (
              <Link href={buildElectionsPath({ year: route.year, round: route.round, state: s.slug })} className={linkRow} data-state={s.uf}>
                <span className="text-slate-200">
                  {s.name} <span className="text-slate-600">· {s.uf}</span>
                </span>
                <AvailabilityBadge results={s.resultsAvailable} cadaster={s.cadasterAvailable} />
              </Link>
            ) : (
              <div className={`${rowClass} cursor-default opacity-50`} aria-disabled="true">
                <span className="text-slate-400">
                  {s.name} <span className="text-slate-600">· {s.uf}</span>
                </span>
                <AvailabilityBadge results={false} cadaster={false} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── UF → municípios ──────────────────────────────────────────────────────────

export function StatePanel({ route, state, municipalities }: { route: ExplorerRoute; state: StateItem; municipalities: MunicipalityItem[] }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return municipalities;
    return municipalities.filter((m) => normalizeText(m.name).includes(q) || m.tseCode === q || String(m.ibgeCode) === q);
  }, [municipalities, query]);
  return (
    <div>
      <PanelTitle
        eyebrow={state.name}
        title="Municípios"
        sub={`${formatCount(state.resultsMunicipalities)} de ${formatCount(state.municipalities)} com resultados · ${formatCount(state.cadasterMunicipalities)} com cadastro eleitoral`}
      />
      <SearchBox value={query} onChange={setQuery} placeholder="Buscar município (nome ou código)" label="Buscar município" />
      {shown.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nenhum município encontrado.</p>}
      <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1" data-testid="municipality-list">
        {shown.map((m) => (
          <li key={m.tseCode}>
            {m.cadasterAvailable ? (
              <Link
                href={buildElectionsPath({ year: route.year, round: route.round, state: state.slug, municipality: m.slug })}
                className={linkRow}
                data-municipality={m.slug}
              >
                <span className="truncate text-slate-200">{m.name}</span>
                <span className="flex flex-shrink-0 items-center gap-2 text-[11px] text-slate-500">
                  {m.zones} {m.zones === 1 ? "zona" : "zonas"}
                  <AvailabilityBadge results={m.resultsAvailable} cadaster={m.cadasterAvailable} />
                </span>
              </Link>
            ) : (
              <div className={`${rowClass} cursor-default opacity-50`} aria-disabled="true">
                <span className="truncate text-slate-400">{m.name}</span>
                <AvailabilityBadge results={false} cadaster={false} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Município → zonas ────────────────────────────────────────────────────────

export function MunicipalityPanel({ route, detail }: { route: ExplorerRoute; detail: MunicipalityDetailResponse }) {
  const m = detail.municipality;
  if (detail.status === "cadaster_missing") {
    return (
      <div>
        <PanelTitle eyebrow={`${m.name}/${m.uf}`} title="Cadastro eleitoral não importado" />
        <p className="text-sm text-slate-400">
          O município existe no registro oficial TSE ↔ IBGE, mas o cadastro de zonas, locais e seções desta eleição ainda
          não foi importado. Nada é inferido.
        </p>
      </div>
    );
  }
  const s = detail.summary;
  return (
    <div>
      <PanelTitle
        eyebrow={`${m.name}/${m.uf}`}
        title={detail.zones.length === 1 ? "Zona eleitoral" : "Escolha uma zona"}
        sub={
          s
            ? `${formatCount(s.sections)} seções (${formatCount(s.principalSections)} urnas + ${formatCount(s.aggregatedSections)} agregadas) · ${formatCount(s.pollingPlaces)} locais`
            : undefined
        }
      />
      <ul className="space-y-1.5" data-testid="zone-list">
        {detail.zones.map((z) => (
          <li key={z.number}>
            <Link
              href={buildElectionsPath({ ...route, municipality: m.slug, zone: z.number, section: undefined })}
              className={linkRow}
              data-zone={z.number}
            >
              <span className="font-medium text-slate-200">{zoneLabel(z.number)}</span>
              <span className="flex items-center gap-2 text-[11px] text-slate-500">
                {formatCount(z.sections)} seções · {formatCount(z.pollingPlaces)} locais
                <AvailabilityBadge results={z.resultsAvailable} cadaster />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Zona → locais e seções ───────────────────────────────────────────────────

export function ZonePanel({
  route,
  zone,
  municipalityName,
  singleZone,
  resultsAvailable,
  placeFilter,
  onClearPlace,
}: {
  route: ExplorerRoute;
  zone: ZoneModel;
  municipalityName: string;
  singleZone: boolean;
  resultsAvailable: boolean;
  placeFilter: string | null;
  onClearPlace: () => void;
}) {
  const [query, setQuery] = useState("");
  const base = placeFilter ? zone.places.filter((p) => p.code === placeFilter) : zone.places;
  const shown = searchPlaces(base, query);
  return (
    <div data-auto-zone={singleZone ? "true" : undefined}>
      <PanelTitle
        eyebrow={municipalityName}
        title={zoneLabel(zone.number)}
        sub={`${formatCount(zone.sections.length)} seções em ${formatCount(zone.places.length)} locais${resultsAvailable ? "" : " · resultado ainda não importado"}`}
      />
      {singleZone && (
        <p className="mb-3 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-xs text-brand" data-testid="single-zone-note">
          Zona única do município — selecionada automaticamente.
        </p>
      )}
      {zone.awaitingLocation > 0 && (
        <p className="mb-3 text-[11px] text-slate-500">
          {zone.awaitingLocation} {zone.awaitingLocation === 1 ? "local sem coordenada oficial" : "locais sem coordenada oficial"}: sem pino no
          mapa (nenhuma posição é estimada).
        </p>
      )}
      {placeFilter && (
        <button type="button" onClick={onClearPlace} className="mb-3 text-xs text-brand underline-offset-2 hover:underline">
          Mostrar todos os locais
        </button>
      )}
      <SearchBox value={query} onChange={setQuery} placeholder="Seção, local ou bairro" label="Buscar seção ou local" />
      {shown.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nenhuma seção ou local encontrado.</p>}
      <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1" data-testid="place-list">
        {shown.map((p) => (
          <li key={p.code} className="rounded-lg border border-white/8 bg-card-elevated/50 p-3" data-place={p.code}>
            <p className="text-sm font-medium text-slate-200">{p.name}</p>
            <p className="mb-2 text-[11px] text-slate-500">
              {[p.address, p.neighborhood].filter(Boolean).join(" · ") || "Endereço não informado"}
              {!p.coordinates && " · sem coordenada oficial"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {p.sections.map((s) => {
                const active = route.section === s.number;
                return (
                  <Link
                    key={s.number}
                    href={buildElectionsPath({ ...route, section: s.number })}
                    data-section={s.number}
                    aria-current={active ? "true" : undefined}
                    title={s.isAggregated ? `Seção ${pad3(s.number)} agregada à ${pad3(s.principalNumber)}` : sectionLabel(s.number)}
                    className={`focus-ring rounded border px-2 py-1 font-mono text-[11px] transition-colors duration-[var(--motion-acknowledge)] ${
                      active
                        ? "border-brand bg-brand/15 text-brand"
                        : s.isAggregated
                          ? "border-dashed border-white/15 text-slate-500 hover:border-brand/40 hover:text-slate-300"
                          : "border-white/10 bg-white/5 text-slate-300 hover:border-brand/40"
                    }`}
                  >
                    {s.isAggregated ? `↳${pad3(s.number)}` : pad3(s.number)}
                  </Link>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
