"use client";

import { useId } from "react";
import { displayName } from "@/lib/elections/format";
import { electionLabel } from "@/lib/elections/xray";
import type { XrayCandidacy } from "@/lib/elections/xray-types";

export const candidacyLabel = (c: XrayCandidacy) =>
  `${electionLabel(c.contest.year, c.contest.round)} · ${displayName(c.contest.officeName)} · ${displayName(c.contest.unit.name)}`;

/** Escolha da candidatura (Território, Patrimônio, Contas, Registros): um campo nativo, acessível e leve no celular. */
export function CandidacyPicker({
  candidacies,
  value,
  onChange,
}: Readonly<{ candidacies: XrayCandidacy[]; value: string | undefined; onChange: (candidacyId: string) => void }>) {
  const id = useId();
  if (candidacies.length <= 1) {
    const only = candidacies[0];
    return only ? <p className="mb-3 text-xs text-fg-muted">{candidacyLabel(only)}</p> : null;
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-xs text-fg-muted">
        Candidatura
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focus-ring min-w-0 max-w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-fg-soft"
      >
        {candidacies.map((c) => (
          <option key={c.candidacyId} value={c.candidacyId}>
            {candidacyLabel(c)}
            {c.ticket ? " (chapa)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
