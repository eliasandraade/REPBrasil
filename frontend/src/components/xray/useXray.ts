"use client";

import { useQuery } from "@tanstack/react-query";
import { xrayApi } from "@/lib/elections/xray";
import type { XrayCandidacy, XrayResponse } from "@/lib/elections/xray-types";

/** Raio X do político (uma consulta, compartilhada pelo cabeçalho e pelas abas do perfil). */
export function useXray(politicianId: string | undefined) {
  return useQuery({
    queryKey: ["xray", politicianId],
    queryFn: () => xrayApi.xray(politicianId!),
    enabled: !!politicianId,
    staleTime: 60_000,
  });
}

/** Candidaturas da mais recente para a mais antiga; na mesma eleição, a própria antes da de vice/suplente. */
export function byRecency(candidacies: XrayCandidacy[]): XrayCandidacy[] {
  return [...candidacies].sort(
    (a, b) =>
      b.contest.year - a.contest.year ||
      b.contest.round - a.contest.round ||
      Number(a.ticket !== null) - Number(b.ticket !== null) ||
      a.contest.officeCode - b.contest.officeCode,
  );
}

/** Candidatura própria mais recente (com voto próprio); senão, a mais recente de qualquer tipo. */
export function latestCandidacy(data: XrayResponse | undefined): XrayCandidacy | undefined {
  if (!data) return undefined;
  const sorted = byRecency(data.candidacies);
  return sorted.find((c) => !c.ticket && c.totals.votes !== null) ?? sorted.find((c) => !c.ticket) ?? sorted[0];
}
