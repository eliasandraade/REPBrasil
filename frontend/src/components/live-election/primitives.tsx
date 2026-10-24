"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import { initials } from "@/lib/live-election/derive";
import { photoSrc } from "@/lib/live-election/api";
import { PHASE_UI } from "@/lib/live-election/phase";
import type { CandidateSlot, DataMode, LiveCandidate, LivePhase } from "@/lib/live-election/types";
import { useChangeFlash } from "./LiveContext";

const TONE_CLASS: Record<string, string> = {
  neutral: "border-line bg-subtle text-fg-soft",
  live: "border-danger/30 bg-danger/[0.08] text-danger",
  warn: "border-warn/30 bg-warn/10 text-warn",
  positive: "border-positive/30 bg-positive/10 text-positive",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

/** Selo do estado da apuração. "AO VIVO" tem um ponto com pulso discreto; resultado final nunca é "ao vivo". */
export function StatusPill({ phase, className = "" }: Readonly<{ phase: LivePhase; className?: string }>) {
  const ui = PHASE_UI[phase];
  return (
    <span
      data-testid="live-status-pill"
      data-phase={phase}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label uppercase ${TONE_CLASS[ui.tone]} ${className}`}
    >
      {ui.live ? <span className="live-dot live-dot-pulse" aria-hidden="true" /> : null}
      {ui.label}
    </span>
  );
}

/** Selo obrigatório fora do ambiente oficial: simulação e replay nunca se passam por resultado real. */
export function ModeBadge({ mode }: Readonly<{ mode: DataMode }>) {
  if (mode === "official") return null;
  const label = mode === "simulation" ? "SIMULAÇÃO — ambiente de testes do TSE" : "REPLAY — dados de teste";
  return (
    <span
      data-testid="live-mode-badge"
      className="inline-flex items-center rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-label uppercase text-warn"
    >
      {label}
    </span>
  );
}

export const SLOT_LABEL: Record<CandidateSlot, string> = { a: "A", b: "B" };

/** Marcador de candidato: cor da paleta A×B + letra (nunca só cor; B também leva hachura). */
export function SlotSwatch({ slot, className = "h-3 w-3" }: Readonly<{ slot: CandidateSlot | "tie" | "none"; className?: string }>) {
  const fill =
    slot === "a" ? "live-fill-a" : slot === "b" ? "live-fill-b live-hatch" : slot === "tie" ? "live-fill-tie" : "bg-[var(--live-land)] border border-line";
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-sm ${fill} ${className}`} />;
}

/** Foto oficial (cópia em cache servida pela API) com substituto de iniciais; nunca quebra o layout. */
export function CandidatePhoto({
  candidate,
  size,
  priority = false,
  className = "",
}: Readonly<{ candidate: Pick<LiveCandidate, "ballotName" | "photoUrl" | "slot">; size: number; priority?: boolean; className?: string }>) {
  const src = photoSrc(candidate.photoUrl);
  const [failed, setFailed] = useState(false);
  const height = Math.round((size * 225) / 161);
  const frame = `relative shrink-0 overflow-hidden rounded-xl border border-line bg-subtle ${className}`;
  if (!src || failed) {
    return (
      <div
        className={`${frame} flex items-center justify-center`}
        style={{ width: size, height }}
        role="img"
        aria-label={`Foto indisponível de ${candidate.ballotName}`}
      >
        <span className={`text-heading-sm font-semibold ${candidate.slot === "a" ? "live-text-a" : "live-text-b"}`}>{initials(candidate.ballotName)}</span>
      </div>
    );
  }
  return (
    <div className={frame} style={{ width: size, height }}>
      <Image
        src={src}
        alt={`Foto oficial de ${candidate.ballotName} (TSE)`}
        fill
        sizes={`${size}px`}
        priority={priority}
        className="object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

/** Valor que pisca de leve quando um dado oficial novo chega. */
export function FlashValue({ value, children, className = "" }: Readonly<{ value: unknown; children: ReactNode; className?: string }>) {
  const flash = useChangeFlash(value);
  return <span className={`live-flash-target ${flash ? "live-flash" : ""} ${className}`}>{children}</span>;
}

/** Título de seção com o nível de leitura (instantâneo, entendimento, análise, técnico). */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
}: Readonly<{ id: string; eyebrow?: string; title: string; description?: ReactNode; action?: ReactNode }>) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="text-label uppercase text-accent-text">{eyebrow}</p> : null}
        <h2 id={id} className="mt-1 text-heading-sm text-fg sm:text-heading-md">
          {title}
        </h2>
        {description ? <p className="mt-1 max-w-3xl text-body-sm text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Linha "rótulo · valor (· complemento)" de uma lista de métricas. */
export function MetricRow({
  label,
  value,
  extra,
  hint,
  flashKey,
}: Readonly<{ label: ReactNode; value: ReactNode; extra?: ReactNode; hint?: string; flashKey?: unknown }>) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/70 py-2 last:border-b-0">
      <dt className="min-w-0 text-body-sm text-fg-muted" title={hint}>
        {label}
      </dt>
      <dd className="tabular flex shrink-0 items-baseline gap-2 text-right text-body-sm font-semibold text-fg">
        {flashKey === undefined ? value : <FlashValue value={flashKey}>{value}</FlashValue>}
        {extra ? <span className="text-micro font-medium text-fg-muted">{extra}</span> : null}
      </dd>
    </div>
  );
}

/** Barra de progresso acessível (0–100). */
export function ProgressBar({ pct, label, className = "h-2" }: Readonly<{ pct: number | null; label: string; className?: string }>) {
  const value = typeof pct === "number" ? Math.min(100, Math.max(0, pct)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={typeof pct === "number" ? Number(value.toFixed(2)) : undefined}
      className={`w-full overflow-hidden rounded-full bg-subtle ${className}`}
    >
      <div className="live-bar h-full rounded-full bg-fg-soft" style={{ width: `${value}%` }} />
    </div>
  );
}
