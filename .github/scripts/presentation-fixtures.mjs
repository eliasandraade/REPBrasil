// Cenários SINTÉTICOS do Modo Apresentação (candidaturas "CANDIDATO A/B", números inventados) no formato exato do
// contrato da API (frontend/src/lib/live-election/types.ts). Servem só para testes e capturas de revisão: o modo
// de dados é "replay" e a própria interface exibe o selo "REPLAY — dados de teste". Nunca usar em produção.

export const KEY_A = "990000000001";
export const KEY_B = "990000000002";

// UF, nome, região, eleitorado aproximado (milhões) — pesos realistas para a composição; votos são fictícios.
export const UFS = [
  ["AC", "Acre", "N", 0.6], ["AL", "Alagoas", "NE", 2.3], ["AM", "Amazonas", "N", 2.6], ["AP", "Amapá", "N", 0.55],
  ["BA", "Bahia", "NE", 11.3], ["CE", "Ceará", "NE", 6.8], ["DF", "Distrito Federal", "CO", 2.2], ["ES", "Espírito Santo", "SE", 2.9],
  ["GO", "Goiás", "CO", 4.9], ["MA", "Maranhão", "NE", 5.0], ["MG", "Minas Gerais", "SE", 16.3], ["MS", "Mato Grosso do Sul", "CO", 2.0],
  ["MT", "Mato Grosso", "CO", 2.5], ["PA", "Pará", "N", 6.1], ["PB", "Paraíba", "NE", 3.0], ["PE", "Pernambuco", "NE", 7.0],
  ["PI", "Piauí", "NE", 2.6], ["PR", "Paraná", "S", 8.5], ["RJ", "Rio de Janeiro", "SE", 12.8], ["RN", "Rio Grande do Norte", "NE", 2.6],
  ["RO", "Rondônia", "N", 1.2], ["RR", "Roraima", "N", 0.37], ["RS", "Rio Grande do Sul", "S", 8.6], ["SC", "Santa Catarina", "S", 5.5],
  ["SE", "Sergipe", "NE", 1.7], ["SP", "São Paulo", "SE", 34.6], ["TO", "Tocantins", "N", 1.1],
];

export const CANDIDATES = [
  {
    key: KEY_A, slot: "a", number: 10, name: "CANDIDATO A DA SILVA", ballotName: "CANDIDATO A", party: "PA", partyName: "PARTIDO A",
    coalition: { name: "COLIGAÇÃO A", kind: "coligacao", composition: "PA / PX" }, vice: { name: "VICE A", ballotName: "VICE A", party: "PX" },
    photoUrl: null, destination: "Válido", situation: null, elected: false, position: 1,
  },
  {
    key: KEY_B, slot: "b", number: 20, name: "CANDIDATO B DE SOUZA", ballotName: "CANDIDATO B", party: "PB", partyName: "PARTIDO B",
    coalition: null, vice: { name: "VICE B", ballotName: "VICE B", party: "PB" },
    photoUrl: null, destination: "Válido", situation: null, elected: false, position: 2,
  },
];

/** Cenários do pedido (seção 50): fase, % de seções e parcela de A nos válidos. */
export const SCENARIOS = {
  pre: { phase: "PRE_ELECTION", progress: 0, share: null },
  p5: { phase: "LIVE", progress: 5.13, share: 52.41 },
  p20: { phase: "LIVE", progress: 20.37, share: 50.93 },
  p50: { phase: "LIVE", progress: 50.08, share: 51.27 },
  p80: { phase: "LIVE", progress: 80.12, share: 50.61 },
  p95: { phase: "LIVE", progress: 95.03, share: 50.42 },
  close: { phase: "LIVE", progress: 62.4, share: 50.08 },
  comfortable: { phase: "LIVE", progress: 71.6, share: 56.82 },
  leadBefore: { phase: "LIVE", progress: 33.2, share: 50.31 },
  leadAfter: { phase: "LIVE", progress: 35.9, share: 49.62 },
  stale: { phase: "LIVE_STALE", progress: 70.4, share: 51.08, stale: true },
  md: { phase: "MATHEMATICALLY_DEFINED", progress: 93.4, share: 54.2, md: "e" },
  final: { phase: "FINAL", progress: 100, share: 53.91, final: true },
};

const round = (n) => Math.round(n);
const pct = (part, total) => (total > 0 ? (part / total) * 100 : 0);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function territory({ code, name, region, scope, electorate, sections, sectionsPct, share, stamp }) {
  const totalized = round((sections * sectionsPct) / 100);
  const inTotalized = round((electorate * sectionsPct) / 100);
  const votesOn = share !== null && sectionsPct > 0;
  const turnout = votesOn ? round(inTotalized * 0.792) : 0;
  const valid = votesOn ? round(turnout * 0.952) : 0;
  const blank = votesOn ? round(turnout * 0.019) : 0;
  const nul = votesOn ? turnout - valid - blank : 0;
  const votesA = votesOn ? round((valid * share) / 100) : 0;
  const votesB = valid - votesA;
  const leaderKey = !votesOn || votesA === votesB ? null : votesA > votesB ? KEY_A : KEY_B;
  return {
    scope, code, uf: scope === "uf" ? code : null, name, region, capital: false,
    candidates: [
      { key: KEY_A, votes: votesOn ? votesA : 0, pct: votesOn ? pct(votesA, valid) : 0 },
      { key: KEY_B, votes: votesOn ? votesB : 0, pct: votesOn ? pct(votesB, valid) : 0 },
    ],
    leaderKey,
    leadVotes: Math.abs(votesA - votesB),
    leadPp: votesOn ? Math.abs(pct(votesA, valid) - pct(votesB, valid)) : 0,
    sections: {
      total: sections, totalized, notTotalized: sections - totalized, installed: sections, notInstalled: 0,
      counted: totalized, notCounted: sections - totalized, totalizedPct: sectionsPct, installedPct: 100, countedPct: sectionsPct,
    },
    electorate: {
      total: electorate, inTotalized, inNotTotalized: electorate - inTotalized, inInstalled: electorate, inNotInstalled: 0,
      inCounted: inTotalized, inNotCounted: electorate - inTotalized, turnout, abstention: inTotalized - turnout,
      inTotalizedPct: sectionsPct, inCountedPct: sectionsPct, inCountedOfTotalPct: sectionsPct,
      turnoutPct: votesOn ? pct(turnout, inTotalized) : null, abstentionPct: votesOn ? pct(inTotalized - turnout, inTotalized) : null,
    },
    votes: {
      total: turnout, toCandidates: valid, valid, nominal: valid, annulled: 0, annulledSubJudice: 0, blank, nullTotal: nul, null: nul,
      technicalNull: 0, annulledSections: null, noCandidate: null,
      validPct: votesOn ? pct(valid, turnout) : null, blankPct: votesOn ? pct(blank, turnout) : null,
      nullTotalPct: votesOn ? pct(nul, turnout) : null, annulledPct: votesOn ? 0 : null,
    },
    progress: sectionsPct >= 100 ? "finished" : sectionsPct > 0 ? "partial" : "not-started",
    totalizedAt: sectionsPct > 0 ? stamp.totalized : null,
    generatedAt: stamp.generated,
    ingestedAt: stamp.ingested,
    coverage: "complete",
    available: true,
  };
}

/** Somas absolutas das UFs (nunca média de percentuais), como faz o backend. */
function nationalFrom(states, share, stamp) {
  const sum = (f) => states.reduce((acc, s) => acc + f(s), 0);
  const sections = sum((s) => s.sections.total);
  const totalized = sum((s) => s.sections.totalized);
  const electorate = sum((s) => s.electorate.total);
  const inTotalized = sum((s) => s.electorate.inTotalized);
  const turnout = sum((s) => s.electorate.turnout);
  const valid = sum((s) => s.votes.valid);
  const blank = sum((s) => s.votes.blank);
  const nul = sum((s) => s.votes.nullTotal);
  const votesA = sum((s) => s.candidates[0].votes);
  const votesB = sum((s) => s.candidates[1].votes);
  const votesOn = share !== null && valid > 0;
  const sectionsPct = pct(totalized, sections);
  const t = territory({ code: "br", name: "Brasil", region: null, scope: "br", electorate, sections, sectionsPct, share: null, stamp });
  return {
    ...t,
    candidates: [
      { key: KEY_A, votes: votesA, pct: votesOn ? pct(votesA, valid) : 0 },
      { key: KEY_B, votes: votesB, pct: votesOn ? pct(votesB, valid) : 0 },
    ],
    leaderKey: !votesOn || votesA === votesB ? null : votesA > votesB ? KEY_A : KEY_B,
    leadVotes: Math.abs(votesA - votesB),
    leadPp: votesOn ? Math.abs(pct(votesA, valid) - pct(votesB, valid)) : 0,
    sections: { ...t.sections, total: sections, totalized, notTotalized: sections - totalized, counted: totalized, notCounted: sections - totalized, totalizedPct: sectionsPct, countedPct: sectionsPct },
    electorate: {
      ...t.electorate, total: electorate, inTotalized, inNotTotalized: electorate - inTotalized, inCounted: inTotalized, inNotCounted: electorate - inTotalized,
      turnout, abstention: inTotalized - turnout, inTotalizedPct: pct(inTotalized, electorate), inCountedPct: pct(inTotalized, electorate),
      inCountedOfTotalPct: pct(inTotalized, electorate), turnoutPct: votesOn ? pct(turnout, inTotalized) : null, abstentionPct: votesOn ? pct(inTotalized - turnout, inTotalized) : null,
    },
    votes: {
      ...t.votes, total: turnout, toCandidates: valid, valid, nominal: valid, blank, nullTotal: nul, null: nul,
      validPct: votesOn ? pct(valid, turnout) : null, blankPct: votesOn ? pct(blank, turnout) : null, nullTotalPct: votesOn ? pct(nul, turnout) : null, annulledPct: votesOn ? 0 : null,
    },
  };
}

function stamps(now) {
  const iso = (ms) => new Date(ms).toISOString();
  return { generated: iso(now - 4_000), totalized: iso(now - 6_000), ingested: iso(now - 1_200) };
}

/** Cenário completo: { summary, states } no contrato da API. `now` em ms (relógio do servidor de testes). */
export function buildScenario(name, now = Date.now()) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`cenário desconhecido: ${name}`);
  // Fonte parada: o último arquivo recebido (e tudo que veio nele) tem 7 minutos.
  const stamp = stamps(sc.stale ? now - 7 * 60_000 : now);
  // Desvios por UF (−15…+15 p.p. na parcela, −10…+10 p.p. nas seções), descontada a média ponderada pelo
  // eleitorado: o resultado nacional fica no alvo do cenário.
  const weightOf = (i) => UFS[i][3];
  const centered = (offsets, weights) => {
    const total = weights.reduce((a, b) => a + b, 0);
    const mean = offsets.reduce((acc, o, i) => acc + o * weights[i], 0) / total;
    return offsets.map((o) => o - mean);
  };
  const progressOffsets = centered(UFS.map((_, i) => ((i * 53) % 21) - 10), UFS.map((_, i) => weightOf(i)));
  const progressOf = (i) => (sc.progress <= 0 ? 0 : sc.progress >= 100 ? 100 : clamp(sc.progress + progressOffsets[i], 0.5, 100));
  const shareOffsets = centered(UFS.map((_, i) => (((i * 37) % 31) - 15) * 0.9), UFS.map((_, i) => weightOf(i) * progressOf(i)));
  const states = UFS.map(([code, ufName, region, millions], i) => {
    const share = sc.share === null ? null : clamp(sc.share + shareOffsets[i], 18, 82);
    const electorate = round(millions * 1_000_000);
    return territory({ code, name: ufName, region, scope: "uf", electorate, sections: round(electorate / 320), sectionsPct: Math.round(progressOf(i) * 100) / 100, share, stamp });
  });
  const national = nationalFrom(states, sc.share, stamp);
  const leaderIsA = national.leaderKey === KEY_A;
  const remaining = national.electorate.inNotTotalized;
  const md = sc.md ?? null;
  const summary = {
    election: {
      year: 2026, round: 2, electionCode: 6258, firstRoundElectionCode: 6257, pleitoCode: 3221, officeCode: 1, officeName: "Presidente",
      date: "2026-10-25", mode: "replay", environment: "replay", cycle: "ele2026",
    },
    phase: sc.phase,
    official: {
      progress: national.progress, finalTotalization: Boolean(sc.final), mathematicallyDefinedFlag: md, votesReleased: sc.share !== null,
      nonFinalReason: null, noElectedAttribution: sc.final ? false : null, noElectedReasons: [],
    },
    candidates: CANDIDATES.map((c) => (sc.final ? { ...c, elected: c.key === national.leaderKey, situation: c.key === national.leaderKey ? "Eleito" : "Não eleito" } : c)),
    national,
    math: {
      official: { flag: md, defined: md === "e", definedAt: md === "e" ? new Date(now - 30_000).toISOString() : null, detectedAt: md === "e" ? new Date(now - 29_000).toISOString() : null },
      independent: {
        available: national.votes.valid > 0, reason: null, leaderKey: national.leaderKey, runnerUpKey: leaderIsA ? KEY_B : KEY_A,
        leaderVotes: Math.max(national.candidates[0].votes, national.candidates[1].votes), runnerUpVotes: Math.min(national.candidates[0].votes, national.candidates[1].votes),
        leadVotes: national.leadVotes, remainingElectorateUpperBound: remaining, maxPossibleTrailingCandidate: null, votesNeededForTrailingCandidate: null,
        distanceToIrreversibility: md === "e" || sc.final ? null : Math.max(1, remaining - national.leadVotes), invariantsOk: true,
      },
    },
    source: {
      healthy: !sc.stale, stale: Boolean(sc.stale), staleSince: sc.stale ? new Date(now - 7 * 60_000).toISOString() : null,
      lastFileGeneratedAt: stamp.generated,
      lastReceivedAt: stamp.ingested, lastCheckedAt: new Date(now - 800).toISOString(),
      delaySeconds: 3.2, message: sc.stale ? "Aguardando nova atualização da fonte." : null,
    },
    velocity: { windows: [], eta: null },
    events: [],
    defined: md === "e" ? { leaderKey: national.leaderKey, votes: null, pct: null, leadVotes: national.leadVotes, sectionsPct: national.sections.totalizedPct, definedAt: new Date(now - 30_000).toISOString(), detectedAt: new Date(now - 29_000).toISOString() } : null,
  };
  const leading = { [KEY_A]: states.filter((s) => s.leaderKey === KEY_A).length, [KEY_B]: states.filter((s) => s.leaderKey === KEY_B).length };
  const payload = {
    states,
    exterior: null,
    regions: [],
    remaining: [],
    summary: {
      ufsLeading: leading,
      ufsTied: states.filter((s) => s.leaderKey === null && s.votes.valid > 0).length,
      ufsWithoutVotes: states.filter((s) => s.votes.valid === 0).length,
      municipalities: { total: 5570, withData: 0, coveragePct: 0, complete: false, leading: null },
    },
  };
  return { summary, states: payload };
}

export function meta(summary, version, now = Date.now()) {
  return {
    source: "TSE", mode: "replay", phase: summary.phase, electionCode: 6258, snapshotVersion: version,
    sourceGeneratedAt: summary.national.generatedAt, totalizedAt: summary.national.totalizedAt, ingestedAt: summary.national.ingestedAt,
    publishedAt: new Date(now).toISOString(), ageSeconds: 1.2, sourceDelaySeconds: 3.2, coverage: summary.source.stale ? "stale" : "complete",
    isFinal: summary.official.finalTotalization, isMathematicallyDefined: summary.official.mathematicallyDefinedFlag === "e",
  };
}
