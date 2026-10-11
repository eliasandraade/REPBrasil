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
      <span className="rounded border border-accent/25 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-text">
        resultados
      </span>
    );
  if (cadaster)
    return (
      <span className="rounded border border-line bg-fg/5 px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
        cadastro
      </span>
    );
  return (
    <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">sem cadastro</span>
  );
}

export function PanelTitle({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{eyebrow}</p>
      <h2 className="text-lg font-bold leading-tight text-fg">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>}
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
      className="mb-3 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-fg-soft placeholder:text-fg-muted transition-colors duration-[var(--motion-acknowledge)] focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/15"
    />
  );
}

const rowClass =
  "flex items-center justify-between gap-3 rounded-lg border border-line bg-subtle/60 px-3 py-2.5 text-sm";
/** Linha navegável: marca o canto e eleva o fundo; nada se desloca. */
const linkRow = `${rowClass} mi-surface focus-ring hover:border-accent/30 hover:bg-subtle`;

// ─── Brasil → UFs ─────────────────────────────────────────────────────────────

export function CountryPanel({ route, states }: Readonly<{ route: ExplorerRoute; states: StateItem[] }>) {
  const withResults = states.filter((s) => s.resultsAvailable);
  const available = states.filter((s) => s.cadasterAvailable);
  // UF sem cadastro não leva a lugar nenhum: fica numa frase, não numa lista de linhas apagadas
  const missing = states.filter((s) => !s.cadasterAvailable);
  return (
    <div>
      <PanelTitle
        eyebrow="Brasil"
        title="Escolha uma UF"
        sub={`${withResults.length} de ${states.length} UFs com resultados importados nesta eleição.`}
      />
      <ul className="space-y-1.5" data-testid="state-list">
        {available.map((s) => (
          <li key={s.uf}>
            <Link href={buildElectionsPath({ year: route.year, round: route.round, state: s.slug })} className={linkRow} data-state={s.uf}>
              <span className="text-fg-soft">
                {s.name} <span className="text-fg-muted">· {s.uf}</span>
              </span>
              <AvailabilityBadge results={s.resultsAvailable} cadaster={s.cadasterAvailable} />
            </Link>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-fg-muted" data-testid="states-missing">
          Ainda sem dados nesta eleição ({missing.length}): {missing.map((s) => s.name).join(", ")}.
        </p>
      )}
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
      {shown.length === 0 && <p className="py-6 text-center text-sm text-fg-muted">Nenhum município encontrado.</p>}
      <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1" data-testid="municipality-list">
        {shown.map((m) => (
          <li key={m.tseCode}>
            {m.cadasterAvailable ? (
              <Link
                href={buildElectionsPath({ year: route.year, round: route.round, state: state.slug, municipality: m.slug })}
                className={linkRow}
                data-municipality={m.slug}
              >
                <span className="truncate text-fg-soft">{m.name}</span>
                <span className="flex flex-shrink-0 items-center gap-2 text-[11px] text-fg-muted">
                  {m.zones} {m.zones === 1 ? "zona" : "zonas"}
                  <AvailabilityBadge results={m.resultsAvailable} cadaster={m.cadasterAvailable} />
                </span>
              </Link>
            ) : (
              <div className={`${rowClass} cursor-default opacity-50`} aria-disabled="true">
                <span className="truncate text-fg-muted">{m.name}</span>
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
        <p className="text-sm text-fg-muted">
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
              <span className="font-medium text-fg-soft">{zoneLabel(z.number)}</span>
              <span className="flex items-center gap-2 text-[11px] text-fg-muted">
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
        <p className="mb-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent-text" data-testid="single-zone-note">
          Zona única do município — selecionada automaticamente.
        </p>
      )}
      {zone.awaitingLocation > 0 && (
        <p className="mb-3 text-[11px] text-fg-muted">
          {zone.awaitingLocation} {zone.awaitingLocation === 1 ? "local sem coordenada oficial" : "locais sem coordenada oficial"}: sem pino no
          mapa (nenhuma posição é estimada).
        </p>
      )}
      {placeFilter && (
        <button type="button" onClick={onClearPlace} className="mb-3 text-xs text-accent-text underline-offset-2 hover:underline">
          Mostrar todos os locais
        </button>
      )}
      <SearchBox value={query} onChange={setQuery} placeholder="Seção, local ou bairro" label="Buscar seção ou local" />
      {shown.length === 0 && <p className="py-6 text-center text-sm text-fg-muted">Nenhuma seção ou local encontrado.</p>}
      <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1" data-testid="place-list">
        {shown.map((p) => (
          <li key={p.code} className="rounded-lg border border-line bg-subtle/50 p-3" data-place={p.code}>
            <p className="text-sm font-medium text-fg-soft">{p.name}</p>
            <p className="mb-2 text-[11px] text-fg-muted">
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
                        ? "border-accent bg-accent/15 text-accent-text"
                        : s.isAggregated
                          ? "border-dashed border-line-strong text-fg-muted hover:border-accent/40 hover:text-fg-soft"
                          : "border-line bg-fg/5 text-fg-soft hover:border-accent/40"
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
