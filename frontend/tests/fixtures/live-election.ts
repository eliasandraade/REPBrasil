/**
 * Fixtures da apuração ao vivo no formato do contrato (src/lib/live-election/types.ts). Candidaturas, números
 * e horários SINTÉTICOS ("CANDIDATO A/B"): servem para testar comportamento, nunca para conferir resultado.
 */
import type {
  CandidateVotes,
  LiveCandidate,
  LiveEnvelope,
  LiveMeta,
  LivePhase,
  LiveStatesPayload,
  LiveSummary,
  MunicipalityListItem,
  RegionCode,
  RemainingByUf,
  TerritoryResult,
} from "@/lib/live-election/types";
import { UF_NAMES, UFS } from "@/lib/site";

export const KEY_A = "990000000001";
export const KEY_B = "990000000002";

export const CANDIDATES: LiveCandidate[] = [
  {
    key: KEY_A,
    slot: "a",
    number: 10,
    name: "CANDIDATO A DA SILVA",
    ballotName: "CANDIDATO A",
    party: "PA",
    partyName: "PARTIDO A",
    coalition: { name: "COLIGAÇÃO A", kind: "coligacao", composition: "PA / PX" },
    vice: { name: "VICE A", ballotName: "VICE A", party: "PX" },
    photoUrl: `/api/v1/elections/2026/president/second-round/photos/${KEY_A}`,
    destination: "Válido",
    situation: null,
    elected: false,
    position: 1,
  },
  {
    key: KEY_B,
    slot: "b",
    number: 20,
    name: "CANDIDATO B DE SOUZA",
    ballotName: "CANDIDATO B",
    party: "PB",
    partyName: "PARTIDO B",
    coalition: null,
    vice: { name: "VICE B", ballotName: "VICE B", party: "PB" },
    photoUrl: null,
    destination: "Válido",
    situation: null,
    elected: false,
    position: 2,
  },
];

const ELECTORATE = 158_000_000;
const SECTIONS = 500_000;

export function meta(version: number, overrides: Partial<LiveMeta> = {}): LiveMeta {
  return {
    source: "TSE",
    mode: "official",
    phase: "LIVE",
    electionCode: 6258,
    snapshotVersion: version,
    sourceGeneratedAt: "2026-10-25T19:30:00-03:00",
    totalizedAt: "2026-10-25T19:29:58-03:00",
    ingestedAt: "2026-10-25T22:30:01Z",
    publishedAt: `2026-10-25T22:30:${String(10 + (version % 40)).padStart(2, "0")}Z`,
    ageSeconds: 1.2,
    sourceDelaySeconds: 1.1,
    coverage: "complete",
    isFinal: false,
    isMathematicallyDefined: false,
    ...overrides,
  };
}

/** Território com votos de A e B (percentuais sobre a soma dos dois, como no 2º turno). */
export function territory(code: string, name: string, votesA: number | null, votesB: number | null, sectionsPct: number, extra: Partial<TerritoryResult> = {}): TerritoryResult {
  const total = (votesA ?? 0) + (votesB ?? 0);
  const pct = (v: number | null) => (v === null || total === 0 ? (v === null ? null : 0) : (v / total) * 100);
  const candidates: CandidateVotes[] = [
    { key: KEY_A, votes: votesA, pct: pct(votesA) },
    { key: KEY_B, votes: votesB, pct: pct(votesB) },
  ];
  const leaderKey = total === 0 || votesA === votesB ? null : (votesA ?? 0) > (votesB ?? 0) ? KEY_A : KEY_B;
  const pa = pct(votesA) ?? 0;
  const pb = pct(votesB) ?? 0;
  const electorate = extra.electorate?.total ?? Math.round(total / 0.8) + 1000;
  const sectionsTotal = extra.sections?.total ?? 1000;
  return {
    scope: code === "br" ? "br" : code.length === 2 ? "uf" : "mu",
    code,
    uf: code.length === 2 && code !== "br" ? code : null,
    name,
    region: null,
    capital: false,
    candidates,
    leaderKey,
    leadVotes: total === 0 ? 0 : Math.abs((votesA ?? 0) - (votesB ?? 0)),
    leadPp: total === 0 ? 0 : Math.abs(pa - pb),
    sections: {
      total: sectionsTotal,
      totalized: Math.round((sectionsTotal * sectionsPct) / 100),
      notTotalized: sectionsTotal - Math.round((sectionsTotal * sectionsPct) / 100),
      installed: Math.round((sectionsTotal * sectionsPct) / 100),
      notInstalled: 0,
      counted: Math.round((sectionsTotal * sectionsPct) / 100),
      notCounted: 0,
      totalizedPct: sectionsPct,
      installedPct: 100,
      countedPct: 100,
    },
    electorate: {
      total: electorate,
      inTotalized: Math.round((electorate * sectionsPct) / 100),
      inNotTotalized: electorate - Math.round((electorate * sectionsPct) / 100),
      inInstalled: Math.round((electorate * sectionsPct) / 100),
      inNotInstalled: 0,
      inCounted: Math.round((electorate * sectionsPct) / 100),
      inNotCounted: 0,
      turnout: total + Math.round(total * 0.05),
      abstention: Math.round((electorate * sectionsPct) / 100) - (total + Math.round(total * 0.05)),
      inTotalizedPct: sectionsPct,
      inCountedPct: 100,
      inCountedOfTotalPct: sectionsPct,
      turnoutPct: 80,
      abstentionPct: 20,
    },
    votes: {
      total: total + Math.round(total * 0.05),
      toCandidates: total,
      valid: total,
      nominal: total,
      annulled: 0,
      annulledSubJudice: 0,
      blank: Math.round(total * 0.02),
      nullTotal: Math.round(total * 0.03),
      null: Math.round(total * 0.03),
      technicalNull: 0,
      annulledSections: null,
      noCandidate: null,
      validPct: 95.24,
      blankPct: 1.9,
      nullTotalPct: 2.86,
      annulledPct: 0,
    },
    progress: sectionsPct >= 100 ? "finished" : sectionsPct > 0 ? "partial" : "not-started",
    totalizedAt: sectionsPct > 0 ? "2026-10-25T19:29:58-03:00" : null,
    generatedAt: "2026-10-25T19:30:00-03:00",
    ingestedAt: "2026-10-25T22:30:01Z",
    coverage: "complete",
    available: true,
    ...extra,
  };
}

interface SummaryOptions {
  phase?: LivePhase;
  sectionsPct?: number;
  votesA?: number | null;
  votesB?: number | null;
  md?: "e" | "s" | "n" | null;
  tf?: boolean;
  dv?: boolean;
  stale?: boolean;
  remaining?: number;
  distance?: number | null;
  mntf?: string | null;
}

export function summary(o: SummaryOptions = {}): LiveSummary {
  const sectionsPct = o.sectionsPct ?? 50;
  const votesA = o.votesA === undefined ? 40_000_000 : o.votesA;
  const votesB = o.votesB === undefined ? 38_000_000 : o.votesB;
  const national = territory("br", "Brasil", votesA, votesB, sectionsPct, {
    sections: { ...territory("br", "Brasil", 1, 1, sectionsPct).sections, total: SECTIONS, totalizedPct: sectionsPct },
    electorate: { ...territory("br", "Brasil", 1, 1, sectionsPct).electorate, total: ELECTORATE, inTotalizedPct: sectionsPct },
  });
  const lead = Math.abs((votesA ?? 0) - (votesB ?? 0));
  const remaining = o.remaining ?? Math.round(ELECTORATE * (1 - sectionsPct / 100));
  const leaderIsA = (votesA ?? 0) >= (votesB ?? 0);
  const distance = o.distance === undefined ? (remaining - lead + 1 > 0 ? remaining - lead + 1 : null) : o.distance;
  return {
    election: {
      year: 2026,
      round: 2,
      electionCode: 6258,
      firstRoundElectionCode: 6257,
      pleitoCode: 3221,
      officeCode: 1,
      officeName: "Presidente",
      date: "2026-10-25",
      mode: "official",
      environment: "oficial",
      cycle: "ele2026",
    },
    phase: o.phase ?? "LIVE",
    official: {
      progress: sectionsPct >= 100 ? "finished" : sectionsPct > 0 ? "partial" : "not-started",
      finalTotalization: o.tf ?? false,
      mathematicallyDefinedFlag: o.md === undefined ? null : o.md,
      votesReleased: o.dv ?? true,
      nonFinalReason: o.mntf ?? null,
      noElectedAttribution: o.tf ? false : null,
      noElectedReasons: [],
    },
    candidates: CANDIDATES.map((c) => (o.tf ? { ...c, elected: c.key === (leaderIsA ? KEY_A : KEY_B), situation: c.key === (leaderIsA ? KEY_A : KEY_B) ? "Eleito" : "Não eleito" } : c)),
    national,
    math: {
      official: { flag: o.md === undefined ? null : o.md, defined: o.md === "e", definedAt: o.md === "e" ? "2026-10-25T19:02:13-03:00" : null, detectedAt: o.md === "e" ? "2026-10-25T22:02:14Z" : null },
      independent: {
        available: (votesA ?? 0) + (votesB ?? 0) > 0,
        reason: null,
        leaderKey: leaderIsA ? KEY_A : KEY_B,
        runnerUpKey: leaderIsA ? KEY_B : KEY_A,
        leaderVotes: Math.max(votesA ?? 0, votesB ?? 0),
        runnerUpVotes: Math.min(votesA ?? 0, votesB ?? 0),
        leadVotes: lead,
        remainingElectorateUpperBound: remaining,
        maxPossibleTrailingCandidate: Math.min(votesA ?? 0, votesB ?? 0) + remaining,
        votesNeededForTrailingCandidate: lead + 1,
        distanceToIrreversibility: distance,
        invariantsOk: true,
      },
    },
    source: {
      healthy: !o.stale,
      stale: o.stale ?? false,
      staleSince: o.stale ? "2026-10-25T22:20:00Z" : null,
      lastFileGeneratedAt: "2026-10-25T19:30:00-03:00",
      lastReceivedAt: "2026-10-25T22:30:01Z",
      lastCheckedAt: "2026-10-25T22:30:05Z",
      delaySeconds: 1.2,
      message: o.stale ? "Aguardando nova atualização da fonte." : null,
    },
    velocity: {
      windows: [
        { minutes: 1, votesPerMinute: 120_000, sectionsPerMinute: 900, electoratePerMinute: 300_000, samples: 3 },
        { minutes: 5, votesPerMinute: 110_000, sectionsPerMinute: 850, electoratePerMinute: 290_000, samples: 10 },
        { minutes: 15, votesPerMinute: 100_000, sectionsPerMinute: 800, electoratePerMinute: 280_000, samples: 25 },
      ],
      eta: sectionsPct > 0 && sectionsPct < 100 ? { at: "2026-10-25T21:10:00-03:00", basisMinutes: 15 } : null,
    },
    events: [
      { id: 1, type: "totalization-started", at: "2026-10-25T17:00:05-03:00", detectedAt: "2026-10-25T20:00:06Z", title: "Divulgação iniciada", detail: null, sectionsPct: 0.01 },
    ],
    defined:
      o.md === "e"
        ? { leaderKey: leaderIsA ? KEY_A : KEY_B, votes: Math.max(votesA ?? 0, votesB ?? 0), pct: 51, leadVotes: lead, sectionsPct, definedAt: "2026-10-25T19:02:13-03:00", detectedAt: "2026-10-25T22:02:14Z" }
        : null,
  };
}

export function envelope<T>(data: T, version = 10, overrides: Partial<LiveMeta> = {}): LiveEnvelope<T> {
  return { data, meta: meta(version, overrides) };
}

const REGION_OF: Record<string, RegionCode> = {
  AC: "N", AM: "N", AP: "N", PA: "N", RO: "N", RR: "N", TO: "N",
  AL: "NE", BA: "NE", CE: "NE", MA: "NE", PB: "NE", PE: "NE", PI: "NE", RN: "NE", SE: "NE",
  DF: "CO", GO: "CO", MS: "CO", MT: "CO",
  ES: "SE", MG: "SE", RJ: "SE", SP: "SE",
  PR: "S", RS: "S", SC: "S",
};

/** 27 UFs com resultados variados: A à frente nas pares, B nas ímpares, empate no DF e sem votos em RR. */
export function statesPayload(): LiveStatesPayload {
  const states = UFS.map((uf, i) => {
    if (uf === "RR") return territory(uf, UF_NAMES[uf], 0, 0, 0, { region: REGION_OF[uf] });
    if (uf === "DF") return territory(uf, UF_NAMES[uf], 500_000, 500_000, 80, { region: REGION_OF[uf] });
    const a = 1_000_000 + i * 10_000;
    const b = i % 2 === 0 ? a - 150_000 : a + 300_000;
    return territory(uf, UF_NAMES[uf], a, b, 40 + (i % 6) * 10, { region: REGION_OF[uf] });
  });
  const remaining: RemainingByUf[] = states.map((s) => ({
    uf: s.code,
    name: s.name,
    region: s.region,
    sectionsRemaining: s.sections.notTotalized,
    electorateNotTotalized: s.electorate.inNotTotalized,
    electorateNotCounted: 0,
    remainingUpperBound: s.electorate.inNotTotalized,
    shareOfRemaining: 100 / states.length,
    totalizedPct: s.sections.totalizedPct,
    updatedAt: s.totalizedAt,
  }));
  return {
    states,
    exterior: territory("ZZ", "Exterior", 300_000, 200_000, 70, { scope: "uf" }),
    regions: (["N", "NE", "CO", "SE", "S"] as RegionCode[]).map((r) => territory(r, r, 5_000_000, 4_000_000, 60, { scope: "region", region: r })),
    remaining,
    summary: {
      ufsLeading: { [KEY_A]: 13, [KEY_B]: 12 },
      ufsTied: 1,
      ufsWithoutVotes: 1,
      municipalities: { total: 5570, withData: 1200, coveragePct: 21.5, complete: false, leading: null },
    },
  };
}

export function municipality(code: string, name: string, extra: Partial<MunicipalityListItem> = {}): MunicipalityListItem {
  return {
    code,
    ibgeCode: null,
    name,
    uf: "SP",
    capital: false,
    electorate: 10_000,
    sectionsPct: 50,
    progress: "partial",
    totalizedAt: "2026-10-25T19:29:58-03:00",
    result: null,
    ...extra,
  };
}

/** Cenários nomeados do pedido (0%, 50%, 99%, troca de liderança, empate, md=e, tf=s, defasado, dv=n). */
export const SCENARIOS = {
  preElection: summary({ phase: "PRE_ELECTION", sectionsPct: 0, votesA: 0, votesB: 0 }),
  waitingRelease: summary({ phase: "WAITING_FOR_RELEASE", sectionsPct: 3, votesA: 0, votesB: 0, dv: false }),
  zero: summary({ phase: "LIVE", sectionsPct: 0, votesA: 0, votesB: 0 }),
  fivePct: summary({ sectionsPct: 5, votesA: 4_000_000, votesB: 3_900_000 }),
  half: summary({ sectionsPct: 50 }),
  ninetyNine: summary({ sectionsPct: 99.987654, votesA: 60_000_000, votesB: 59_000_000 }),
  leadBefore: summary({ sectionsPct: 30, votesA: 20_000_000, votesB: 19_000_000 }),
  leadAfter: summary({ sectionsPct: 35, votesA: 22_000_000, votesB: 23_000_000 }),
  tie: summary({ sectionsPct: 20, votesA: 10_000_000, votesB: 10_000_000 }),
  independentReached: summary({ sectionsPct: 90, votesA: 70_000_000, votesB: 50_000_000, remaining: 10_000_000, distance: null, md: "n" }),
  mdAbsent: summary({ sectionsPct: 90, md: null }),
  mdN: summary({ sectionsPct: 90, md: "n" }),
  mathDefined: summary({ phase: "MATHEMATICALLY_DEFINED", sectionsPct: 92, votesA: 70_000_000, votesB: 50_000_000, remaining: 10_000_000, distance: null, md: "e" }),
  final: summary({ phase: "FINAL", sectionsPct: 100, votesA: 75_000_000, votesB: 55_000_000, remaining: 0, distance: null, tf: true }),
  stale: summary({ phase: "LIVE_STALE", sectionsPct: 70, stale: true }),
  reprocessing: summary({ phase: "FINALIZING", sectionsPct: 100, mntf: "Atualização de registro de candidatura após a totalização" }),
} satisfies Record<string, LiveSummary>;
