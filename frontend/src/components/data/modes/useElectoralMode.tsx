"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { TransitionLink } from "@/motion/navigation";
import { displayName, formatCount } from "@/lib/elections/format";
import { buildLayerView } from "@/lib/elections/map-layers";
import { buildElectionsPath } from "@/lib/elections/route";
import { xrayApi } from "@/lib/elections/xray";
import type { MapFeature } from "@/lib/elections/xray-types";
import { formatInteger } from "@/lib/territory/format";
import { electoralLayer } from "@/lib/territory/layers";
import type { ExplorerView } from "@/lib/territory/url";
import { Insights } from "../Insights";
import { SocioElectoralCrossing } from "../SocioElectoralCrossing";
import type { ModeContext, ModeView, ReadingModel } from "../explorer-types";
import { SELECT, municipalityRows, ofPlace, ufLabel } from "./shared";

const percent = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const electionLabel = (year: number, round: number) => `${year} · ${round}º turno`;
const officeName = (label: string) => label.charAt(0) + label.slice(1).toLowerCase();
/** Vice e suplentes não recebem voto próprio: ficam fora da escolha de cargo. */
const votable = (label: string) => !/VICE|SUPLENTE/i.test(label);
const winnerOf = (f: MapFeature) => (f.categoryLabel ? displayName(f.categoryLabel) : null);

/**
 * Modo eleitoral: a candidatura mais votada em cada município, por cargo e pleito, em paleta neutra (sem cor de
 * partido). Só pleitos com Boletim de Urna carregado na UF aparecem como escolha.
 */
export function useElectoralMode(ctx: ModeContext): ModeView {
  const { state, coverage, enabled, theme, level, municipalities, update, hovered, onHover } = ctx;
  const uf = state.uf;
  const elections = coverage?.elections ?? [];
  const election =
    elections.find((e) => e.year === state.year && e.round === (state.round ?? 1)) ?? elections.find((e) => e.year === state.year) ?? elections[0] ?? null;
  const atState = enabled && level !== "country" && !!uf && !!election;

  const officesQ = useQuery({
    queryKey: ["el-offices", election?.year, election?.round, uf, null],
    queryFn: () => xrayApi.candidates(election!.year, election!.round, uf!, { pageSize: 1 }),
    enabled: atState,
    staleTime: 10 * 60_000,
  });
  const offices = (officesQ.data?.offices ?? []).filter((f) => votable(f.label)).map((f) => ({ value: Number(f.value), label: officeName(f.label) }));
  const office = offices.find((o) => o.value === state.office) ?? offices.find((o) => o.value === 3) ?? offices[0] ?? null;

  const mapQ = useQuery({
    queryKey: ["el-map", election?.year, election?.round, uf, "winner", office?.value],
    queryFn: () => xrayApi.map(election!.year, election!.round, uf!, { layer: "winner", office: office!.value }),
    enabled: atState && !!office,
    staleTime: 5 * 60_000,
  });

  // antes/depois: o mesmo cargo em outro pleito carregado na UF
  const others = elections.filter((e) => e.year !== election?.year || e.round !== election?.round);
  const [beforeYear, beforeRound] = (state.before ?? "").split(":").map(Number);
  const before = others.find((e) => e.year === beforeYear && e.round === (beforeRound || 1)) ?? others[0] ?? null;
  const beforeQ = useQuery({
    queryKey: ["el-map", before?.year, before?.round, uf, "winner", office?.value],
    queryFn: () => xrayApi.map(before!.year, before!.round, uf!, { layer: "winner", office: office!.value }),
    enabled: atState && !!office && !!before && state.view === "comparar",
    staleTime: 5 * 60_000,
    retry: false,
  });

  const caption = office && election ? `Mais votado(a) · ${office.label} · ${electionLabel(election.year, election.round)}` : "";
  const layerView = useMemo(() => (mapQ.data ? buildLayerView(mapQ.data, theme) : null), [mapQ.data, theme]);
  const layer = layerView && election && office ? electoralLayer(layerView, `el:${uf}:${election.year}:${election.round}:${office.value}:${theme}`, caption) : null;
  const beforeHasData = !!beforeQ.data?.features.some((f) => f.categoryLabel);
  const beforeLayer =
    beforeQ.data && beforeHasData && before && office
      ? electoralLayer(buildLayerView(beforeQ.data, theme), `el:${uf}:${before.year}:${before.round}:${office.value}:${theme}`, `Mais votado(a) · ${office.label} · ${electionLabel(before.year, before.round)}`)
      : null;

  const features = mapQ.data?.features.filter((f) => f.ibgeCode != null) ?? [];
  const byCode = new Map(features.map((f) => [String(f.ibgeCode), f]));
  const selected = state.municipality;
  const chosen = selected ? byCode.get(selected) : undefined;
  const place = ofPlace(coverage, uf);
  const slug = (code: string) => municipalities.find((m) => m.ibgeCode === code)?.slug;

  const controls =
    level === "country" ? null : (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-body-sm text-fg-muted">
          <span>Pleito</span>
          <select
            className={SELECT}
            value={election ? `${election.year}:${election.round}` : ""}
            onChange={(e) => {
              const [year, round] = e.target.value.split(":").map(Number);
              update({ year, round: round === 2 ? 2 : 1, office: null, before: null });
            }}
            disabled={elections.length === 0}
          >
            {elections.length === 0 && <option value="">Sem pleitos carregados</option>}
            {elections.map((e) => (
              <option key={`${e.year}:${e.round}`} value={`${e.year}:${e.round}`}>{electionLabel(e.year, e.round)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-body-sm text-fg-muted">
          <span>Cargo</span>
          <select className={SELECT} value={office?.value ?? ""} onChange={(e) => update({ office: Number(e.target.value) })} disabled={offices.length === 0}>
            {offices.length === 0 && <option value="">—</option>}
            {offices.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {state.view === "comparar" && others.length > 0 && (
          <label className="space-y-1 text-body-sm text-fg-muted sm:col-span-2">
            <span>Comparar com o pleito</span>
            <select className={SELECT} value={before ? `${before.year}:${before.round}` : ""} onChange={(e) => update({ before: e.target.value })}>
              {others.map((e) => (
                <option key={`${e.year}:${e.round}`} value={`${e.year}:${e.round}`}>{electionLabel(e.year, e.round)}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    );

  const reading: ReadingModel = (() => {
    if (!election) return { what: `Nenhum resultado eleitoral carregado para os municípios ${place} até agora.`, facts: [], notice: "A malha municipal (IBGE) continua disponível para navegar." };
    const what = `Candidatura mais votada em cada município${office ? ` para ${office.label.toLowerCase()}` : ""}, ${electionLabel(election.year, election.round)}. Cores neutras, pela ordem da legenda; nunca cor de partido.`;
    const source = mapQ.data?.freshness.refreshedAt
      ? { provider: "TSE", dataset: "Boletim de Urna (agregado vigente)", retrievedAt: mapQ.data.freshness.refreshedAt, dateLabel: "agregado atualizado em" }
      : null;
    if (level === "municipality" && selected) {
      const winner = chosen ? winnerOf(chosen) : null;
      const margin = chosen?.details.marginVotes;
      return {
        what,
        value: winner && chosen?.value != null ? { label: "Mais votado(a)", text: `${winner} · ${percent.format(chosen.value)}%`, swapKey: `${selected}:${election.year}:${office?.value}` } : null,
        notice: winner ? null : "Sem resultado para este município neste recorte.",
        facts: typeof margin === "number" ? [{ label: "Margem", text: `${formatCount(margin)} votos sobre a segunda colocada` }] : [],
        source,
      };
    }
    const winners = new Set(features.map((f) => f.categoryLabel).filter(Boolean));
    return {
      what,
      facts: [
        { label: "Com resultado", text: `${formatInteger(election.municipalities)} de ${formatInteger(coverage?.municipalities ?? election.municipalities)} municípios` },
        ...(features.length ? [{ label: "Mais votadas", text: `${winners.size} ${winners.size === 1 ? "candidatura" : "candidaturas diferentes"}` }] : []),
      ],
      source,
    };
  })();

  const sentences = electoralSentences(features, level === "municipality" ? chosen : undefined, place, office?.label ?? "", election);

  const views: ExplorerView[] = ["mapa", "comparar"];
  const ready = atState && !!office;
  const explorerHref = election && uf
    ? buildElectionsPath({ year: election.year, round: election.round, state: uf.toLowerCase(), municipality: selected ? slug(selected) : undefined })
    : null;

  return {
    controls,
    layer: ready ? layer : null,
    compare:
      beforeLayer && before
        ? { before: { layer: beforeLayer, label: `Antes: ${electionLabel(before.year, before.round)}` }, afterLabel: election ? `Depois: ${electionLabel(election.year, election.round)}` : "" }
        : null,
    compareNote: compareNote(others.length, beforeQ.isFetched && !beforeHasData, before),
    views,
    reading,
    table: ready
      ? {
          caption: `${caption} · municípios ${place}`,
          columns: [
            { key: "winner", label: "Mais votado(a)" },
            { key: "share", label: "% dos válidos", numeric: true },
            { key: "margin", label: "Margem (votos)", numeric: true },
          ],
          rows: municipalityRows(
            municipalities,
            features.map((f) => ({ code: String(f.ibgeCode), name: displayName(f.name), feature: f })),
            ({ feature }) => ({
              cells: {
                winner: winnerOf(feature) ?? "sem resultado",
                share: feature.value == null ? "—" : `${percent.format(feature.value)}%`,
                margin: typeof feature.details.marginVotes === "number" ? formatCount(feature.details.marginVotes) : "—",
              },
              sort: { share: feature.value, margin: typeof feature.details.marginVotes === "number" ? feature.details.marginVotes : null },
            }),
            "winner",
          ),
          initialSort: { key: "share", dir: "desc" },
        }
      : null,
    analysis: !ready ? null : (
      <>
        <Insights sentences={sentences} contextKey={`${uf}:${selected}:${election?.year}:${election?.round}:${office?.value}`} />
        <SocioElectoralCrossing
          uf={uf!}
          ufName={ufLabel(coverage, uf)}
          year={election!.year}
          round={election!.round}
          office={office!.value}
          officeLabel={office!.label}
          coverage={coverage}
          selected={selected}
          hovered={hovered}
          onHover={onHover}
        />
        {explorerHref && (
          <p className="text-body-sm">
            <TransitionLink href={explorerHref} className="focus-ring mi-underline rounded font-medium text-accent-text">
              Ver a apuração completa no explorador eleitoral →
            </TransitionLink>
          </p>
        )}
      </>
    ),
    loading: atState && (officesQ.isPending || (!!office && mapQ.isPending)),
    error: mapQ.isError && !mapQ.data ? "Não foi possível carregar o resultado eleitoral." : null,
    retry: () => {
      void officesQ.refetch();
      void mapQ.refetch();
    },
  };
}

function compareNote(others: number, notContested: boolean, before: { year: number; round: number } | null): string | undefined {
  if (others === 0) return "Só há um pleito carregado nesta UF; a comparação precisa de dois.";
  if (notContested && before) return `Esse cargo não teve resultado em ${electionLabel(before.year, before.round)}.`;
  return undefined;
}

function electoralSentences(
  features: MapFeature[],
  chosen: MapFeature | undefined,
  place: string,
  office: string,
  election: { year: number; round: number } | null,
): string[] {
  if (!election || features.length === 0) return [];
  if (chosen) {
    const winner = winnerOf(chosen);
    if (!winner || chosen.value == null) return [`Sem resultado para ${displayName(chosen.name)} neste recorte.`];
    const margin = chosen.details.marginVotes;
    return [
      `${displayName(chosen.name)}: ${winner} teve ${percent.format(chosen.value)}% dos votos válidos para ${office.toLowerCase()}${typeof margin === "number" ? `, ${formatCount(margin)} votos à frente da segunda colocada` : ""}.`,
    ];
  }
  const tally = new Map<string, number>();
  for (const f of features) {
    const winner = winnerOf(f);
    if (winner) tally.set(winner, (tally.get(winner) ?? 0) + 1);
  }
  const ordered = [...tally].sort((a, b) => b[1] - a[1]);
  if (ordered.length === 0) return [];
  const label = electionLabel(election.year, election.round);
  if (ordered.length === 1) return [`${ordered[0][0]} foi a candidatura mais votada para ${office.toLowerCase()} em todos os ${formatInteger(ordered[0][1])} municípios ${place} com resultado (${label}).`];
  return [
    `${formatInteger(ordered.length)} candidaturas diferentes foram as mais votadas para ${office.toLowerCase()} em pelo menos um município ${place} (${label}).`,
    ...ordered.slice(0, 3).map(([name, count]) => `${name}: mais votada em ${formatInteger(count)} ${count === 1 ? "município" : "municípios"}.`),
  ];
}

