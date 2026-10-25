"use client";

import { memo, useMemo } from "react";
import { hasVotes, standingOf } from "@/lib/live-election/derive";
import { formatInteger, formatIntegerCompact, formatPercent, formatPercentagePoints, formatSectionsPct, formatSignedVotes, formatTimestamp, formatVotes, sectionsPrecision } from "@/lib/live-election/format";
import type { BrazilMapShapes } from "@/lib/live-election/map-shapes";
import { showsResults } from "@/lib/live-election/phase";
import { spotlightOf } from "@/lib/live-election/presentation";
import type { LiveCandidate, TerritoryResult } from "@/lib/live-election/types";
import { describeState, fillFor } from "../BrazilElectionMap";
import { useChangeFlash, useLive } from "../LiveContext";
import type { PresentationView } from "./hooks";

const FLASH_MS = 700;

function slotPaint(slot: "a" | "b" | "tie" | "none", fill?: string): string {
  if (slot === "b") return `repeating-linear-gradient(45deg, var(--live-hatch) 0 2px, transparent 2px 5px), ${fill ?? "var(--live-b)"}`;
  return fill ?? (slot === "a" ? "var(--live-a)" : slot === "tie" ? "var(--live-tie)" : "var(--live-land)");
}

function Swatch({ slot }: Readonly<{ slot: "a" | "b" }>) {
  return <span className="pm-swatch" aria-hidden="true" style={{ background: slotPaint(slot) }} />;
}

// ------------------------------------------------------------------ totalização

/** Seções totalizadas (precisão adaptativa perto de 100%), restantes e quantidade absoluta. */
export function NationalProgressPanel() {
  const sections = useLive((s) => s.summary?.national.sections ?? null);
  const pct = sections?.totalizedPct ?? null;
  const flash = useChangeFlash(pct, FLASH_MS);
  const rest = pct === null ? null : Math.max(0, 100 - pct);
  return (
    <section className="pm-total" aria-label="Totalização nacional" data-testid="presentation-total">
      <div className="pm-total-head">
        <p className="pm-eyebrow">SEÇÕES TOTALIZADAS · BRASIL</p>
        <p className="pm-total-abs tabular">
          <strong>{formatInteger(sections?.totalized)}</strong> / {formatInteger(sections?.total)}
        </p>
      </div>
      <div className="pm-total-big">
        <span className="pm-total-pct tabular">
          <span className="pm-value" data-flash={flash ? "true" : undefined}>
            {formatSectionsPct(pct)}
          </span>
        </span>
        <span className="pm-total-rest tabular">
          <small>RESTANTES</small>
          {formatPercent(rest, sectionsPrecision(pct))}
        </span>
      </div>
      <div className="pm-progress" role="progressbar" aria-label="Seções totalizadas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={formatSectionsPct(pct)}>
        <span className="pm-progress-fill" style={{ transform: `scaleX(${(pct ?? 0) / 100})` }} />
        <span className="pm-progress-ticks" aria-hidden="true" />
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ KPIs nacionais

/** Faixa de indicadores nacionais: não compete com o placar (tamanho de leitura, não de manchete). */
export function PresentationKpis() {
  const national = useLive((s) => s.summary?.national ?? null);
  const results = useLive((s) => (s.summary ? showsResults(s.summary) && hasVotes(s.summary.national) : false));
  const v = national?.votes;
  const e = national?.electorate;
  const s = national?.sections;
  // Percentual como valor principal (lê a distância); a quantidade absoluta fica embaixo, menor.
  const vote = (pctValue: number | null | undefined, count: number | null | undefined) =>
    results ? { value: formatPercent(pctValue), detail: `${formatVotes(count)}` } : { value: formatPercent(null), detail: undefined };
  const rows: { label: string; value: string; detail?: string }[] = [
    { label: "VÁLIDOS", ...vote(v?.validPct, v?.valid) },
    { label: "BRANCOS", ...vote(v?.blankPct, v?.blank) },
    { label: "NULOS", ...vote(v?.nullTotalPct, v?.nullTotal) },
    { label: "COMPARECIMENTO", ...vote(e?.turnoutPct, e?.turnout) },
    { label: "ABSTENÇÃO", ...vote(e?.abstentionPct, e?.abstention) },
    { label: "ELEITORADO", value: formatIntegerCompact(e?.total), detail: formatInteger(e?.total) },
    { label: "SEÇÕES TOTALIZADAS", value: formatInteger(s?.totalized), detail: s?.total ? `de ${formatInteger(s.total)}` : undefined },
    { label: "SEÇÕES RESTANTES", value: formatInteger(s?.notTotalized), detail: formatPercent(s?.totalizedPct === null || s?.totalizedPct === undefined ? null : Math.max(0, 100 - s.totalizedPct), sectionsPrecision(s?.totalizedPct)) },
  ];
  return (
    <section className="pm-kpis" aria-label="Indicadores nacionais" data-testid="presentation-kpis">
      <p className="pm-eyebrow">INDICADORES NACIONAIS</p>
      <dl className="pm-kpi-grid">
        {rows.map((r) => (
          <div key={r.label} className="pm-kpi">
            <dt>{r.label}</dt>
            <dd className="tabular">
              {r.value}
              {r.detail && r.detail !== "—" ? <small>{r.detail}</small> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------ UF em foco

const REASON_LABEL: Record<string, string> = {
  recent: "ATUALIZAÇÃO RECENTE",
  close: "ENTRE AS MENORES DIFERENÇAS",
  sequence: "",
  manual: "",
};

function DwellBar({ startedAt, dwellMs, running }: Readonly<{ startedAt: number; dwellMs: number; running: boolean }>) {
  if (!running || startedAt === 0) return null;
  return <span key={startedAt} className="pm-dwell" data-run="true" aria-hidden="true" style={{ animationDuration: `${dwellMs}ms` }} />;
}

function NationalOverview({ candidates }: Readonly<{ candidates: readonly LiveCandidate[] }>) {
  const summary = useLive((s) => s.states?.summary ?? null);
  const ufs = useLive((s) => s.states?.states.length ?? 0);
  const [a, b] = [...candidates].sort((x, y) => (x.slot === "a" ? -1 : 1) - (y.slot === "a" ? -1 : 1));
  const leading = (c: LiveCandidate | undefined) => (c && summary ? (summary.ufsLeading[c.key] ?? 0) : null);
  const anyVotes = summary ? Object.values(summary.ufsLeading).some((n) => n > 0) || summary.ufsTied > 0 : false;
  return (
    <div className="pm-focus-body" key="national">
      <div>
        <h3 className="pm-focus-name">Brasil</h3>
        <p className="pm-focus-sub">{anyVotes ? "UFs com cada candidatura à frente" : `${ufs || 27} UFs aguardando votos totalizados`}</p>
        {summary ? (
          <div className="pm-focus-facts">
            <span>
              Empate <strong className="tabular">{formatInteger(summary.ufsTied)}</strong>
            </span>
            <span>
              Sem votos totalizados <strong className="tabular">{formatInteger(summary.ufsWithoutVotes)}</strong>
            </span>
          </div>
        ) : null}
      </div>
      <div>
        {[a, b].filter((c): c is LiveCandidate => Boolean(c)).map((c) => (
          <div key={c.key} className="pm-focus-row">
            <Swatch slot={c.slot} />
            <span className="pm-focus-cand">{c.ballotName}</span>
            <span className="pm-focus-pct tabular">{anyVotes ? formatInteger(leading(c)) : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SpotlightProps {
  view: PresentationView;
  shapes: BrazilMapShapes;
  startedAt: number;
  dwellMs: number;
  rotating: boolean;
}

/** UF em foco (nome, líder, percentuais, votos, vantagem, seções e eleitorado) ou, na visão nacional, o resumo das UFs. */
export function StateSpotlight({ view, shapes, startedAt, dwellMs, rotating }: Readonly<SpotlightProps>) {
  const states = useLive((s) => s.states?.states ?? null);
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  const list = candidates ?? [];
  const uf = view.kind === "state" ? view.uf : null;
  const state: TerritoryResult | undefined = uf ? states?.find((s) => s.code.toUpperCase() === uf) : undefined;
  const name = uf ? (shapes.shapes.find((s) => s.uf === uf)?.name ?? state?.name ?? uf) : "";
  const data = uf ? spotlightOf(uf, name, state, list) : null;
  const reason = view.kind === "state" ? REASON_LABEL[view.reason] : "";
  return (
    <section className="pm-focus" aria-label={data ? `UF em foco: ${data.name}` : "Visão nacional"} data-testid="presentation-spotlight" data-uf={uf ?? "BR"}>
      <DwellBar startedAt={startedAt} dwellMs={dwellMs} running={rotating} />
      <p className="pm-eyebrow">
        {data ? `UF EM FOCO · ${data.uf}` : "VISÃO NACIONAL"}
        {reason ? ` · ${reason}` : ""}
      </p>
      {data ? (
        <div className="pm-focus-body" key={data.uf}>
          <div>
            <h3 className="pm-focus-name">{data.name}</h3>
            <p className="pm-focus-sub tabular">{formatSectionsPct(data.sectionsPct)} das seções totalizadas</p>
            <p className="pm-focus-lead tabular">
              {data.votes && data.leader ? (
                <>
                  Vantagem {formatSignedVotes(data.leadVotes)} votos · {formatPercentagePoints(data.leadPp)}
                </>
              ) : data.votes ? (
                "Empate"
              ) : (
                "Aguardando votos totalizados"
              )}
            </p>
            <div className="pm-focus-facts">
              <span>
                Restantes <strong className="tabular">{formatInteger(data.sectionsRemaining)}</strong> seções
              </span>
              <span>
                Eleitorado <strong className="tabular">{formatVotes(data.electorate)}</strong>
              </span>
              {data.totalizedAt ? (
                <span>
                  Totalização <strong className="tabular">{formatTimestamp(data.totalizedAt)}</strong>
                </span>
              ) : null}
            </div>
          </div>
          <div>
            {data.sides.map((side) => (
              <div key={side.candidate.key} className="pm-focus-row">
                <Swatch slot={side.candidate.slot} />
                <span className="pm-focus-cand">
                  {side.candidate.ballotName}
                  <small className="tabular">{side.votes === null ? "—" : `${formatVotes(side.votes)} votos`}</small>
                </span>
                <span className="pm-focus-pct tabular">{formatPercent(side.pct)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <NationalOverview candidates={list} />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ 27 UFs

interface CellProps {
  uf: string;
  label: string;
  paint: string;
  pct: number | null;
  selected: boolean;
  onSelect: (uf: string) => void;
}

const StateCell = memo(function StateCell({ uf, label, paint, pct, selected, onSelect }: Readonly<CellProps>) {
  return (
    <button type="button" className="pm-cell" data-selected={selected ? "true" : undefined} aria-pressed={selected} aria-label={label} onClick={() => onSelect(uf)} data-uf={uf}>
      <span className="pm-cell-bar" aria-hidden="true">
        <span style={{ background: paint, transform: `scaleX(${(pct ?? 0) / 100})` }} />
      </span>
      <span className="pm-cell-code">{uf}</span>
      <span className="pm-cell-pct tabular">{pct === null ? "—" : formatPercent(pct, 0)}</span>
    </button>
  );
});

/** As 27 UFs de uma vez: sigla, cor de quem lidera (comprimento = seções totalizadas) e percentual de seções. */
export function StateStrip({ shapes, focusedUf, onSelect }: Readonly<{ shapes: BrazilMapShapes; focusedUf: string | null; onSelect: (uf: string) => void }>) {
  const states = useLive((s) => s.states?.states ?? null);
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  const cells = useMemo(() => {
    const list = candidates ?? [];
    const byUf = new Map((states ?? []).map((s) => [s.code.toUpperCase(), s] as const));
    return [...shapes.shapes]
      .sort((x, y) => x.uf.localeCompare(y.uf))
      .map((shape) => {
        const state = byUf.get(shape.uf);
        const standing = standingOf(state, list);
        const slot = standing.kind === "lead" ? standing.slot : standing.kind;
        return {
          uf: shape.uf,
          label: describeState(shape.name, state, list),
          paint: slotPaint(slot, fillFor(standing)),
          pct: state?.available ? state.sections.totalizedPct : null,
        };
      });
  }, [shapes.shapes, states, candidates]);
  return (
    <nav className="pm-strip" aria-label="UFs: escolha uma para colocar em foco" data-testid="presentation-strip">
      {cells.map((c) => (
        <StateCell key={c.uf} uf={c.uf} label={c.label} paint={c.paint} pct={c.pct} selected={focusedUf === c.uf} onSelect={onSelect} />
      ))}
    </nav>
  );
}
