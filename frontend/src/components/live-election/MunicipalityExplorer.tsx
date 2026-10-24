"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMunicipalities, fetchMunicipality, fetchZones, sendProductEvent } from "@/lib/live-election/api";
import { candidateByKey, EXTERIOR_CODE, matchesSearch, shareOf } from "@/lib/live-election/derive";
import { formatInteger, formatPercent, formatSectionsPct, formatTimestamp, formatVotes } from "@/lib/live-election/format";
import type { LiveCandidate, MunicipalityListItem, TerritoryResult } from "@/lib/live-election/types";
import { UF_NAMES, UFS } from "@/lib/site";
import { Drawer } from "./Dialog";
import { FirstRoundTables } from "./FirstRound";
import { useLive } from "./LiveContext";
import { SectionHeading, SlotSwatch } from "./primitives";
import { TerritoryDetail } from "./TerritoryDetail";

const PAGE = 60;

/** Filtra municípios por nome sem acento e sem caixa (função pura, testada). */
export function filterMunicipalities(items: readonly MunicipalityListItem[], query: string): MunicipalityListItem[] {
  return items.filter((m) => matchesSearch(m.name, query));
}

function ZonesTable({ code, candidates }: Readonly<{ code: string; candidates: readonly LiveCandidate[] }>) {
  const query = useQuery({
    queryKey: ["live-election", "zones", code],
    queryFn: ({ signal }) => fetchZones(code, { signal }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const [a, b] = candidates;
  if (query.isError) return <p className="text-body-sm text-fg-muted">Não foi possível carregar as zonas agora.</p>;
  if (!query.data) return <div className="skeleton h-24 rounded-xl" aria-busy="true" aria-label="Carregando as zonas" />;
  const zones = query.data.data.zones;
  if (zones.length === 0) return <p className="text-body-sm text-fg-muted">Nenhuma zona eleitoral publicada para este município.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-body-sm">
        <caption className="sr-only">Resultado por zona eleitoral</caption>
        <thead>
          <tr className="text-micro uppercase text-fg-muted">
            <th scope="col" className="py-1 text-left font-medium">
              Zona
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {a?.ballotName ?? "A"}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {b?.ballotName ?? "B"}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Totalização
            </th>
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.code} className="border-t border-line/60">
              <th scope="row" className="py-1.5 text-left font-medium text-fg">
                {z.name || `Zona ${z.code}`}
              </th>
              <td className="py-1.5 text-right">{a && z.available ? formatPercent(shareOf(z, a.key)) : "—"}</td>
              <td className="py-1.5 text-right">{b && z.available ? formatPercent(shareOf(z, b.key)) : "—"}</td>
              <td className="py-1.5 text-right">{z.available ? formatSectionsPct(z.sections.totalizedPct) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MunicipalityDrawer({ code, onClose, candidates }: Readonly<{ code: string | null; onClose: () => void; candidates: readonly LiveCandidate[] }>) {
  const [showZones, setShowZones] = useState(false);
  const query = useQuery({
    queryKey: ["live-election", "municipality", code],
    queryFn: ({ signal }) => fetchMunicipality(code as string, { signal }),
    enabled: code !== null,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
  useEffect(() => {
    setShowZones(false);
    if (code) sendProductEvent("municipality_open");
  }, [code]);
  if (!code) return null;
  const detail = query.data?.data;
  const municipality: TerritoryResult | null = detail && detail.municipality.code === code ? detail.municipality : null;
  return (
    <Drawer
      open
      onClose={onClose}
      wide
      testId="live-municipality-drawer"
      title={municipality ? `${municipality.name}${municipality.uf ? ` · ${municipality.uf}` : ""}` : "Município"}
      subtitle={municipality?.capital ? "Capital" : undefined}
    >
      {!municipality ? (
        query.isError ? (
          <p role="status" className="text-body-sm text-fg-muted">
            Não foi possível carregar o município agora.
          </p>
        ) : (
          <div className="skeleton h-48 rounded-xl" aria-busy="true" aria-label="Carregando o município" />
        )
      ) : (
        <div className="space-y-6">
          <TerritoryDetail territory={municipality} candidates={candidates} />
          {detail && detail.zones.length > 0 ? (
            <section aria-labelledby="live-zones-title">
              <div className="flex items-center justify-between gap-2">
                <h3 id="live-zones-title" className="text-label uppercase text-fg-muted">
                  Zonas eleitorais ({detail.zones.length})
                </h3>
                <button
                  type="button"
                  aria-expanded={showZones}
                  onClick={() => setShowZones((v) => !v)}
                  className="focus-ring rounded-lg border border-line px-3 py-1.5 text-body-sm font-medium text-fg-soft hover:bg-subtle"
                >
                  {showZones ? "Ocultar zonas" : "Ver resultado por zona"}
                </button>
              </div>
              {showZones ? (
                <div className="mt-2">
                  <ZonesTable code={code} candidates={candidates} />
                </div>
              ) : null}
            </section>
          ) : null}
          {detail?.firstRound ? (
            <section aria-labelledby="live-mun-first-round">
              <h3 id="live-mun-first-round" className="mb-2 text-label uppercase text-fg-muted">
                Variação em relação ao 1º turno
              </h3>
              <FirstRoundTables comparison={detail.firstRound} candidates={candidates} />
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

/** Explorador municipal (seção 31): UF → município, busca instantânea sem acento, lista paginada, zonas sob demanda. */
export function MunicipalityExplorer({ uf, onUfChange }: Readonly<{ uf: string; onUfChange: (uf: string) => void }>) {
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const list = useMemo(() => candidates ?? [], [candidates]);
  const [a, b] = list;
  const query = useQuery({
    queryKey: ["live-election", "municipalities", uf],
    queryFn: ({ signal }) => fetchMunicipalities(uf, { signal }),
    refetchInterval: 30_000,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    setVisible(PAGE);
  }, [uf, search]);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const onSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.trim()) searchTimer.current = setTimeout(() => sendProductEvent("municipality_search"), 1500);
  };

  const payload = query.data?.data;
  const sameUf = payload && payload.uf.toUpperCase() === uf.toUpperCase();
  const filtered = useMemo(() => (sameUf ? filterMunicipalities(payload.municipalities, search) : []), [payload, sameUf, search]);

  return (
    <section aria-labelledby="live-municipalities" data-testid="live-municipality-explorer">
      <SectionHeading
        id="live-municipalities"
        eyebrow="Municípios"
        title="Explorar municípios"
        description="Escolha a UF e busque o município. Os resultados municipais chegam conforme o TSE os publica; a cobertura aparece abaixo."
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-micro font-medium text-fg-muted">
          UF
          <select
            value={uf}
            onChange={(e) => {
              onUfChange(e.target.value);
              setSearch("");
            }}
            className="focus-ring rounded-lg border border-line bg-surface px-2 py-2 text-body-sm text-fg"
          >
            {UFS.map((u) => (
              <option key={u} value={u}>
                {UF_NAMES[u]}
              </option>
            ))}
            <option value={EXTERIOR_CODE}>Exterior</option>
          </select>
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-micro font-medium text-fg-muted">
          Município
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Digite o nome (com ou sem acento)"
            className="focus-ring rounded-lg border border-line bg-surface px-3 py-2 text-body-sm text-fg"
            aria-controls="live-municipality-list"
          />
        </label>
        {payload && sameUf ? (
          <p className="text-micro text-fg-muted" aria-live="polite">
            {formatInteger(filtered.length)} municípios · resultados recebidos para {formatPercent(payload.coveragePct, 1)}
          </p>
        ) : null}
      </div>

      {!sameUf ? (
        query.isError ? (
          <p role="status" className="rounded-2xl border border-line bg-surface p-4 text-body-sm text-fg-muted">
            Não foi possível carregar os municípios agora.
          </p>
        ) : (
          <div className="skeleton h-72 rounded-2xl" aria-busy="true" aria-label="Carregando os municípios" />
        )
      ) : (
        <>
          <ul id="live-municipality-list" className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface" data-testid="live-municipality-list">
            {filtered.slice(0, visible).map((m) => {
              const r = m.result;
              const leader = r ? candidateByKey(list, r.leaderKey) : null;
              return (
                <li key={m.code}>
                  <button
                    type="button"
                    onClick={() => setSelected(m.code)}
                    className="focus-ring grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left hover:bg-subtle/60"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-body-sm font-semibold text-fg">
                        {m.name}
                        {m.capital ? <span className="ml-1.5 rounded border border-line px-1 text-micro font-medium text-fg-muted">capital</span> : null}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 text-micro text-fg-muted">
                        <span>{formatInteger(m.electorate)} eleitores</span>
                        <span>· {formatSectionsPct(m.sectionsPct)} totalizado</span>
                        {r && leader ? (
                          <span className="flex items-center gap-1">
                            · <SlotSwatch slot={leader.slot} className="h-2 w-2" /> {leader.ballotName} à frente
                          </span>
                        ) : r ? null : (
                          <span>· resultado ainda não recebido</span>
                        )}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-right text-body-sm">
                      {r ? (
                        <>
                          <span className="flex items-center justify-end gap-1.5 font-semibold text-fg">
                            <SlotSwatch slot="a" className="h-2 w-2" />
                            {a ? formatPercent(shareOf(r, a.key)) : "—"}
                          </span>
                          <span className="flex items-center justify-end gap-1.5 text-fg-muted">
                            <SlotSwatch slot="b" className="h-2 w-2" />
                            {b ? formatPercent(shareOf(r, b.key)) : "—"}
                          </span>
                        </>
                      ) : (
                        <span className="text-micro text-fg-muted">{formatTimestamp(m.totalizedAt, "time")}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {filtered.length === 0 ? <p className="mt-3 text-body-sm text-fg-muted">Nenhum município encontrado.</p> : null}
          {filtered.length > visible ? (
            <button
              type="button"
              onClick={() => setVisible((v) => v + PAGE)}
              className="focus-ring mt-3 rounded-lg border border-line bg-surface px-4 py-2 text-body-sm font-medium text-fg-soft hover:bg-subtle"
            >
              Mostrar mais ({formatVotes(filtered.length - visible)} restantes)
            </button>
          ) : null}
        </>
      )}
      <MunicipalityDrawer code={selected} onClose={() => setSelected(null)} candidates={list} />
    </section>
  );
}
