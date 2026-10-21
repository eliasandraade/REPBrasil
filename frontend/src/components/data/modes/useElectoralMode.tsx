"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { TransitionLink } from "@/motion/navigation";
import { displayName, formatCount } from "@/lib/elections/format";
import { isMunicipalOffice } from "@/lib/entities";
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
import { SELECT, emptyChoice, knownState, municipalityRows, municipios, ofPlace, pendingReading, ufLabel } from "./shared";

const percent = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const electionLabel = (year: number, round: number) => `${year} · ${round}º turno`;
const officeName = (label: string) => label.charAt(0) + label.slice(1).toLowerCase();
/** Vice e suplentes não recebem voto próprio: ficam fora da escolha de cargo. */
const votable = (label: string) => !/VICE|SUPLENTE/i.test(label);
const isTie = (f: MapFeature) => f.category === "tie";
/** Nome da candidatura mais votada no município; empate na primeira colocação não é candidatura. */
const winnerOf = (f: MapFeature) => (f.categoryLabel && !isTie(f) ? displayName(f.categoryLabel) : null);
/** O cargo só existe no mesmo tipo de pleito: geral nos anos pares não múltiplos de 4, municipal nos múltiplos de 4. */
const sameCalendar = (year: number, office: number) => (isMunicipalOffice(office) ? year % 4 === 0 : year % 4 === 2);
/** Pleito anterior ao escolhido (ano, depois turno). */
const earlierThan = (e: { year: number; round: number }, ref: { year: number; round: number }) => e.year < ref.year || (e.year === ref.year && e.round < ref.round);

/**
 * Modo eleitoral: a candidatura mais votada em cada município, por cargo e pleito, em paleta neutra (sem cor de
 * partido). Só pleitos com Boletim de Urna carregado na UF aparecem como escolha.
 */
export function useElectoralMode(ctx: ModeContext): ModeView {
  const { state, coverage, coverageStatus, enabled, theme, level, municipalities, update, hovered, onHover } = ctx;
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

  // antes/depois: o mesmo cargo num pleito anterior carregado na UF ("antes" é sempre anterior; sem pedido, o mais próximo)
  const others = election ? elections.filter((e) => earlierThan(e, election)).sort((a, b) => b.year - a.year || b.round - a.round) : [];
  const [beforeYear, beforeRound] = (state.before ?? "").split(":").map(Number);
  // sem pedido: o pleito anterior mais próximo que teve o mesmo cargo, de preferência no mesmo turno
  const kin = office ? others.filter((e) => sameCalendar(e.year, office.value)) : others;
  const before =
    others.find((e) => e.year === beforeYear && e.round === (beforeRound || 1)) ?? kin.find((e) => e.round === election?.round) ?? kin[0] ?? others[0] ?? null;
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
            {elections.length === 0 && <option value="">{emptyChoice(coverageStatus, "Sem pleitos carregados")}</option>}
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
    if (coverageStatus !== "ready") return pendingReading(coverageStatus);
    if (!election) return { what: `Nenhum resultado eleitoral carregado para os municípios ${place} até agora.`, facts: [], notice: "A malha municipal (IBGE) continua disponível para navegar." };
    const forOffice = office ? ` para ${office.label.toLowerCase()}` : "";
    const what = `Candidatura mais votada em cada município${forOffice}, ${electionLabel(election.year, election.round)}. Cores neutras, pela ordem da legenda; nunca cor de partido.`;
    const source = mapQ.data?.freshness.refreshedAt
      ? { provider: "TSE", dataset: "Boletim de Urna (agregado vigente)", retrievedAt: mapQ.data.freshness.refreshedAt, dateLabel: "agregado atualizado em" }
      : null;
    if (level === "municipality" && selected) {
      const tie = !!chosen && isTie(chosen);
      const margin = chosen?.details.marginVotes;
      const value = leaderValue(chosen, `${selected}:${election.year}:${office?.value}`);
      return {
        what,
        value,
        notice: value ? null : "Sem resultado para este município neste recorte.",
        facts: typeof margin === "number" && !tie ? [{ label: "Margem", text: `${formatCount(margin)} votos sobre o segundo lugar` }] : [],
        source,
      };
    }
    const winners = new Set(features.map(winnerOf).filter(Boolean));
    const ties = features.filter(isTie).length;
    return {
      what,
      facts: [
        { label: "Com resultado", text: `${formatInteger(election.municipalities)} de ${formatInteger(coverage?.municipalities ?? election.municipalities)} municípios` },
        ...(winners.size ? [{ label: "Mais votadas", text: `${winners.size} ${winners.size === 1 ? "candidatura" : "candidaturas diferentes"}` }] : []),
        ...(ties ? [{ label: "Empates", text: `${formatInteger(ties)} ${ties === 1 ? "município" : "municípios"} com empate na primeira colocação` }] : []),
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
    compareNote: coverageStatus === "ready" ? compareNote(elections.length, others.length, beforeQ.isSuccess && !beforeHasData, before) : undefined,
    compareError:
      beforeQ.isError && !beforeQ.data && before
        ? { message: `Não foi possível carregar ${electionLabel(before.year, before.round)}.`, retry: () => void beforeQ.refetch() }
        : null,
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
                winner: winnerOf(feature) ?? (isTie(feature) ? "empate na 1ª colocação" : "sem resultado"),
                share: feature.value == null ? "—" : `${percent.format(feature.value)}%`,
                margin: typeof feature.details.marginVotes === "number" ? formatCount(feature.details.marginVotes) : "—",
              },
              sort: { share: feature.value, margin: typeof feature.details.marginVotes === "number" ? feature.details.marginVotes : null },
            }),
            "winner",
          ),
          initialSort: { key: "share", dir: "desc" },
          status: knownState(mapQ),
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

function compareNote(loaded: number, earlier: number, notContested: boolean, before: { year: number; round: number } | null): string | undefined {
  if (loaded < 2) return "Só há um pleito carregado nesta UF; a comparação precisa de dois.";
  if (earlier === 0) return "Não há pleito anterior a este carregado nesta UF. Escolha um pleito mais recente para comparar.";
  if (notContested && before) return `Esse cargo não teve resultado em ${electionLabel(before.year, before.round)}.`;
  return undefined;
}

/** Valor do painel no município: a candidatura mais votada, ou o empate na primeira colocação. */
function leaderValue(chosen: MapFeature | undefined, swapKey: string): ReadingModel["value"] {
  if (chosen?.value == null) return null;
  const share = `${percent.format(chosen.value)}%`;
  if (isTie(chosen)) return { label: "Mais votado(a)", text: `Empate na primeira colocação · ${share} cada`, swapKey };
  const winner = winnerOf(chosen);
  return winner ? { label: "Mais votado(a)", text: `${winner} · ${share}`, swapKey } : null;
}

function electoralSentences(
  features: MapFeature[],
  chosen: MapFeature | undefined,
  place: string,
  office: string,
  election: { year: number; round: number } | null,
): string[] {
  if (!election || features.length === 0) return [];
  const officeName = office.toLowerCase();
  if (chosen) {
    const name = displayName(chosen.name);
    if (chosen.value == null) return [`Sem resultado para ${name} neste recorte.`];
    const share = `${percent.format(chosen.value)}%`;
    if (isTie(chosen)) return [`${name}: empate na primeira colocação para ${officeName}; as candidaturas empatadas tiveram ${share} dos votos válidos cada.`];
    const winner = winnerOf(chosen);
    if (!winner) return [`Sem resultado para ${name} neste recorte.`];
    const margin = chosen.details.marginVotes;
    const ahead = typeof margin === "number" ? `, ${formatCount(margin)} votos à frente do segundo lugar` : "";
    return [`${name}: ${winner} teve ${share} dos votos válidos para ${officeName}${ahead}.`];
  }
  const tally = new Map<string, number>();
  for (const f of features) {
    const winner = winnerOf(f);
    if (winner) tally.set(winner, (tally.get(winner) ?? 0) + 1);
  }
  const ties = features.filter(isTie).length;
  const tieSentence = tieText(ties);
  const ordered = [...tally].sort((a, b) => b[1] - a[1]);
  if (ordered.length === 0) return tieSentence;
  const label = electionLabel(election.year, election.round);
  if (ordered.length === 1) {
    const [name, count] = ordered[0];
    return [`${name} foi a candidatura mais votada para ${officeName} ${winnerScope(count, ties, place)} (${label}).`, ...tieSentence];
  }
  return [
    `${formatInteger(ordered.length)} candidaturas diferentes foram as mais votadas para ${officeName} em pelo menos um município ${place} (${label}).`,
    ...ordered.slice(0, 3).map(([name, count]) => `${name}: candidatura mais votada em ${formatInteger(count)} ${count === 1 ? "município" : "municípios"}.`),
    ...tieSentence,
  ];
}

/** "em todos os 184 municípios do Ceará com resultado"; havendo empate, "em 183 municípios do Ceará". */
function winnerScope(count: number, ties: number, place: string): string {
  if (ties > 0) return `em ${municipios(count, formatInteger)} ${place}`;
  return count === 1 ? `no único município ${place} com resultado` : `em todos os ${formatInteger(count)} municípios ${place} com resultado`;
}

function tieText(ties: number): string[] {
  if (ties === 0) return [];
  return [ties === 1 ? "1 município teve empate na primeira colocação." : `${formatInteger(ties)} municípios tiveram empate na primeira colocação.`];
}

