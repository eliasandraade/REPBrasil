/**
 * Contrato da API de apuração ao vivo (2º turno presidencial). Espelha os DTOs de
 * `backend/src/RepBrasil.Application/LiveElection/Contracts.cs` (JSON em camelCase).
 *
 * Regras do contrato:
 * - `null` é "não publicado pela fonte" (ou ainda não disponível), NUNCA zero.
 * - Percentuais são números já em escala 0–100, com a precisão oficial do TSE (até 9 casas).
 * - Horários do TSE vêm em ISO 8601 com o deslocamento de Brasília (-03:00); horários do REPBrasil em UTC (Z).
 * - Votos, seções e eleitorado são inteiros exatos (abaixo de 2^53).
 */

export type LivePhase =
  | "PRE_ELECTION"
  | "WAITING_FOR_RELEASE"
  | "LIVE"
  | "LIVE_STALE"
  | "MATHEMATICALLY_DEFINED"
  | "FINALIZING"
  | "FINAL"
  | "SOURCE_ERROR";

export type DataMode = "official" | "simulation" | "replay";

/** Completude de uma métrica derivada: dado completo, parcial (abrangência incompleta) ou defasado. */
export type Coverage = "complete" | "partial" | "stale";

/** A = primeiro na ordem oficial do TSE (`seq`), B = segundo. Nunca deriva de partido. */
export type CandidateSlot = "a" | "b";

/** Andamento oficial (`and`): n → not-started, p → partial, f → finished. */
export type Progress = "not-started" | "partial" | "finished";

export type RegionCode = "N" | "NE" | "CO" | "SE" | "S";

export interface LiveMeta {
  source: "TSE";
  mode: DataMode;
  phase: LivePhase;
  electionCode: number;
  /** Versão (sequencial) do snapshot nacional servido; cresce a cada atualização efetiva. */
  snapshotVersion: number;
  /** dg/hg do arquivo nacional (geração do arquivo no TSE). */
  sourceGeneratedAt: string | null;
  /** dt/ht do arquivo nacional (última totalização). */
  totalizedAt: string | null;
  /** Relógio do REPBrasil: quando o arquivo foi recebido. */
  ingestedAt: string | null;
  /** Relógio do REPBrasil: quando esta resposta foi produzida. */
  publishedAt: string;
  /** publishedAt − ingestedAt. */
  ageSeconds: number | null;
  /** ingestedAt − sourceGeneratedAt (atraso entre a geração no TSE e o recebimento). */
  sourceDelaySeconds: number | null;
  coverage: Coverage;
  isFinal: boolean;
  isMathematicallyDefined: boolean;
}

export interface LiveEnvelope<T> {
  data: T;
  meta: LiveMeta;
}

export interface SectionTotals {
  total: number | null;
  totalized: number | null;
  notTotalized: number | null;
  installed: number | null;
  notInstalled: number | null;
  counted: number | null;
  notCounted: number | null;
  /** pstn: seções totalizadas / total. */
  totalizedPct: number | null;
  /** psin: instaladas / totalizadas. */
  installedPct: number | null;
  /** psan: apuradas / instaladas. */
  countedPct: number | null;
}

export interface ElectorateTotals {
  total: number | null;
  inTotalized: number | null;
  inNotTotalized: number | null;
  inInstalled: number | null;
  inNotInstalled: number | null;
  inCounted: number | null;
  inNotCounted: number | null;
  turnout: number | null;
  abstention: number | null;
  /** pestn: eleitorado de seções totalizadas / eleitorado. */
  inTotalizedPct: number | null;
  /** pesan: eleitorado de seções apuradas / eleitorado de seções instaladas. */
  inCountedPct: number | null;
  /** Derivado: eleitorado de seções apuradas / eleitorado total. */
  inCountedOfTotalPct: number | null;
  /** pcn: comparecimento / eleitorado de seções instaladas. */
  turnoutPct: number | null;
  /** pan: abstenção / eleitorado de seções instaladas. */
  abstentionPct: number | null;
}

export interface VoteTotals {
  total: number | null;
  /** vvc: votos a votáveis concorrentes. */
  toCandidates: number | null;
  valid: number | null;
  nominal: number | null;
  annulled: number | null;
  annulledSubJudice: number | null;
  blank: number | null;
  /** tvn = nulos + nulos técnicos. */
  nullTotal: number | null;
  null: number | null;
  technicalNull: number | null;
  /** vsan: votos de seções anuladas. */
  annulledSections: number | null;
  /** vscv: votos sem candidato para votar. */
  noCandidate: number | null;
  /** Derivado: válidos / total de votos. */
  validPct: number | null;
  /** pvbn: brancos / total. */
  blankPct: number | null;
  /** ptvnn: nulos (total) / total. */
  nullTotalPct: number | null;
  /** pvann: anulados / votos a votáveis concorrentes. */
  annulledPct: number | null;
}

export interface CoalitionInfo {
  name: string;
  kind: "coligacao" | "federacao" | "partido-isolado";
  composition: string | null;
}

export interface RunningMate {
  name: string;
  ballotName: string;
  party: string | null;
}

export interface LiveCandidate {
  /** sqcand do TSE (identidade estável entre turnos). */
  key: string;
  slot: CandidateSlot;
  number: number;
  name: string;
  ballotName: string;
  party: string | null;
  partyName: string | null;
  coalition: CoalitionInfo | null;
  vice: RunningMate | null;
  /** Foto oficial servida pelo REPBrasil (cópia em cache do diretório `fotos` do TSE). */
  photoUrl: string | null;
  /** dvt: destinação do voto (Válido, Anulado, Anulado sub judice…). */
  destination: string | null;
  /** st: situação oficial (preenchida só com totalização final). */
  situation: string | null;
  /** e = "s": eleito (ou classificado para o 2º turno, no 1º turno). */
  elected: boolean;
  /** seq: ordem oficial. */
  position: number;
}

export interface CandidateVotes {
  key: string;
  votes: number | null;
  /** pvapn (oficial) quando vem do TSE; nas agregações do REPBrasil, votos / soma dos votos dos candidatos. */
  pct: number | null;
}

export interface TerritoryResult {
  scope: "br" | "uf" | "mu" | "zona" | "region";
  /** "br", sigla da UF em maiúsculas ("SP", "ZZ" = exterior), código TSE do município (5 dígitos), zona (4 dígitos) ou região. */
  code: string;
  uf: string | null;
  name: string;
  region: RegionCode | null;
  capital: boolean;
  /** Mesma ordem de `LiveSummary.candidates`. */
  candidates: CandidateVotes[];
  /** null em empate ou sem votos. */
  leaderKey: string | null;
  leadVotes: number | null;
  /** Diferença em pontos percentuais entre o 1º e o 2º. */
  leadPp: number | null;
  sections: SectionTotals;
  electorate: ElectorateTotals;
  votes: VoteTotals;
  progress: Progress;
  totalizedAt: string | null;
  generatedAt: string | null;
  ingestedAt: string | null;
  coverage: Coverage;
  /** false: ainda não há arquivo desta abrangência recebido pelo REPBrasil. */
  available: boolean;
}

export interface OfficialStatus {
  progress: Progress;
  /** tf = "s". */
  finalTotalization: boolean;
  /** md: "e" (eleito), "s" (segundo turno), "n" (não definido) ou ausente. */
  mathematicallyDefinedFlag: "e" | "s" | "n" | null;
  /** dv = "s": votação liberada para divulgação. */
  votesReleased: boolean;
  /** mntf: motivo de não totalização final (reprocessamento pendente). */
  nonFinalReason: string | null;
  /** esae = "s": totalização sem atribuição de eleito. */
  noElectedAttribution: boolean | null;
  noElectedReasons: string[];
}

export interface IndependentMath {
  available: boolean;
  /** Por que o cálculo não está disponível (dados ausentes, invariantes inconsistentes…). */
  reason: string | null;
  leaderKey: string | null;
  runnerUpKey: string | null;
  leaderVotes: number | null;
  runnerUpVotes: number | null;
  leadVotes: number | null;
  /** esnt + esna: teto conservador de eleitores que ainda podem aparecer. */
  remainingElectorateUpperBound: number | null;
  /** runnerUpVotes + remainingElectorateUpperBound. */
  maxPossibleTrailingCandidate: number | null;
  /** leadVotes + 1. */
  votesNeededForTrailingCandidate: number | null;
  /**
   * remaining − lead + 1 enquanto a desigualdade ainda não foi atingida. null quando não se aplica — inclusive
   * quando o limite já foi atingido sem o sinal oficial md=e (o REPBrasil não antecipa a definição).
   */
  distanceToIrreversibility: number | null;
  invariantsOk: boolean;
}

export interface MathStatus {
  official: {
    flag: "e" | "s" | "n" | null;
    defined: boolean;
    /** Hora do TSE (dt/ht do arquivo em que md=e apareceu pela primeira vez). */
    definedAt: string | null;
    /** Relógio do REPBrasil: quando o sinal foi recebido. */
    detectedAt: string | null;
  };
  independent: IndependentMath;
}

export interface SourceStatus {
  healthy: boolean;
  stale: boolean;
  staleSince: string | null;
  lastFileGeneratedAt: string | null;
  lastReceivedAt: string | null;
  lastCheckedAt: string | null;
  delaySeconds: number | null;
  /** Mensagem pública e neutra (ex.: "Aguardando nova atualização da fonte."). */
  message: string | null;
}

export interface VelocityWindow {
  minutes: 1 | 5 | 15;
  votesPerMinute: number | null;
  sectionsPerMinute: number | null;
  electoratePerMinute: number | null;
  samples: number;
}

export interface Velocity {
  windows: VelocityWindow[];
  /** Estimativa técnica de conclusão da totalização (100% das seções). null quando os dados são voláteis. */
  eta: { at: string; basisMinutes: number } | null;
}

export type LiveEventType =
  | "totalization-started"
  | "sections-milestone"
  | "lead-change"
  | "mathematically-defined"
  | "finalized"
  | "source-stale"
  | "source-recovered"
  | "data-correction"
  | "reprocessing";

export interface LiveTimelineEvent {
  id: number;
  type: LiveEventType;
  /** Hora do TSE (totalização) quando existe; senão, null. */
  at: string | null;
  detectedAt: string;
  /** Texto factual e neutro em pt-BR. */
  title: string;
  detail: string | null;
  sectionsPct: number | null;
}

export interface DefinedSnapshot {
  leaderKey: string;
  votes: number | null;
  pct: number | null;
  leadVotes: number | null;
  sectionsPct: number | null;
  definedAt: string | null;
  detectedAt: string;
}

export interface ElectionInfo {
  year: number;
  round: number;
  electionCode: number;
  firstRoundElectionCode: number | null;
  pleitoCode: number | null;
  officeCode: number;
  officeName: string;
  /** Data da eleição (AAAA-MM-DD). */
  date: string | null;
  mode: DataMode;
  environment: string;
  cycle: string;
}

export interface LiveSummary {
  election: ElectionInfo;
  phase: LivePhase;
  official: OfficialStatus;
  candidates: LiveCandidate[];
  national: TerritoryResult;
  math: MathStatus;
  source: SourceStatus;
  velocity: Velocity;
  events: LiveTimelineEvent[];
  defined: DefinedSnapshot | null;
}

export interface RemainingByUf {
  uf: string;
  name: string;
  region: RegionCode | null;
  sectionsRemaining: number | null;
  electorateNotTotalized: number | null;
  electorateNotCounted: number | null;
  /** inNotTotalized + inNotCounted. */
  remainingUpperBound: number | null;
  /** Participação no universo restante do país (0–100). */
  shareOfRemaining: number | null;
  totalizedPct: number | null;
  updatedAt: string | null;
}

export interface TerritorialSummary {
  /** Quantidade de UFs (27 + exterior não entra) com cada candidato à frente, por key. */
  ufsLeading: Record<string, number>;
  ufsTied: number;
  ufsWithoutVotes: number;
  municipalities: {
    total: number;
    withData: number;
    /** 0–100. */
    coveragePct: number;
    /** true só quando todos os municípios têm resultado recebido e atual. */
    complete: boolean;
    /** Só presente quando `complete`; antes disso a contagem seria enganosa. */
    leading: Record<string, number> | null;
  };
}

export interface LiveStatesPayload {
  states: TerritoryResult[];
  exterior: TerritoryResult | null;
  regions: TerritoryResult[];
  remaining: RemainingByUf[];
  summary: TerritorialSummary;
}

export interface TimelinePoint {
  at: string | null;
  ingestedAt: string;
  sectionsPct: number | null;
  electoratePct: number | null;
  candidates: CandidateVotes[];
  leaderKey: string | null;
  leadVotes: number | null;
  leadPp: number | null;
}

export interface LeadChange {
  id: number;
  at: string | null;
  detectedAt: string;
  previousLeaderKey: string | null;
  newLeaderKey: string;
  sectionsPct: number | null;
  votes: CandidateVotes[];
  leadVotes: number | null;
  snapshotVersion: number;
}

export interface LiveTimelinePayload {
  scope: string;
  code: string;
  points: TimelinePoint[];
  leadChanges: LeadChange[];
}

export interface StateDetailPayload {
  state: TerritoryResult;
  capital: TerritoryResult | null;
  /** Estado menos capital (votos absolutos); null sem a capital recebida. */
  interior: TerritoryResult | null;
  timeline: TimelinePoint[];
  firstRound: FirstRoundComparison | null;
}

export interface MunicipalityListItem {
  code: string;
  ibgeCode: string | null;
  name: string;
  uf: string;
  capital: boolean;
  /** Eleitorado (EA15). */
  electorate: number | null;
  sectionsPct: number | null;
  progress: Progress;
  totalizedAt: string | null;
  /** Resultado do município, quando o REPBrasil já recebeu o arquivo. */
  result: TerritoryResult | null;
}

export interface MunicipalitiesPayload {
  uf: string;
  name: string;
  municipalities: MunicipalityListItem[];
  /** 0–100: municípios da UF com resultado recebido. */
  coveragePct: number;
}

export interface MunicipalityDetailPayload {
  municipality: TerritoryResult;
  ibgeCode: string | null;
  zones: string[];
  firstRound: FirstRoundComparison | null;
}

export interface ZonesPayload {
  municipality: { code: string; name: string; uf: string };
  zones: TerritoryResult[];
}

export interface RankingPayload {
  /** "capitals" | "largest". */
  kind: string;
  /** Base do ranking (ex.: "eleitorado — EA15"). */
  basis: string;
  items: TerritoryResult[];
  coveragePct: number;
}

export interface RoundComparisonCandidate {
  key: string;
  matchedBy: "sqcand" | "number" | null;
  firstRound: { votes: number | null; pct: number | null; position: number | null } | null;
  secondRound: { votes: number | null; pct: number | null };
  diffVotes: number | null;
  deltaPp: number | null;
}

export interface TurnoutComparison {
  metric: "turnout" | "abstention" | "valid" | "blank" | "null";
  firstRound: { count: number | null; pct: number | null };
  secondRound: { count: number | null; pct: number | null };
  deltaCount: number | null;
  deltaPp: number | null;
}

export interface FirstRoundComparison {
  available: boolean;
  firstRoundElectionCode: number | null;
  scope: "br" | "region" | "uf" | "mu";
  code: string;
  name: string;
  candidates: RoundComparisonCandidate[];
  turnout: TurnoutComparison[];
  secondRoundSectionsPct: number | null;
  note: string;
}

export interface LiveHealthPublic {
  status: "healthy" | "degraded" | "down";
  mode: DataMode;
  phase: LivePhase;
  lastSuccessAt: string | null;
  lastNationalUpdateAt: string | null;
  dataAgeSeconds: number | null;
  stale: boolean;
  /** Requisições desta réplica ao TSE desde a partida (inclui 304): não cresce com o número de visitantes. */
  tseRequests: number;
}

/** Eventos do stream SSE (`event:` → `data`). Todo evento tem `id` sequencial (Last-Event-ID). */
export interface LiveStreamEvents {
  snapshot: LiveEnvelope<LiveSummary>;
  "national-update": LiveEnvelope<Omit<LiveSummary, "election" | "candidates" | "events">>;
  "state-update": LiveEnvelope<LiveStatesPayload>;
  "candidate-update": LiveEnvelope<{ candidates: LiveCandidate[] }>;
  "lead-change": LiveEnvelope<LeadChange>;
  "mathematically-defined": LiveEnvelope<{ event: LiveTimelineEvent; defined: DefinedSnapshot }>;
  finalized: LiveEnvelope<{ event: LiveTimelineEvent }>;
  "source-stale": LiveEnvelope<SourceStatus>;
  "source-recovered": LiveEnvelope<SourceStatus>;
  "timeline-event": LiveEnvelope<LiveTimelineEvent>;
}

export type LiveStreamEventName = keyof LiveStreamEvents;

/** Eventos anônimos de produto (sem preferência eleitoral, sem identificador do visitante). */
export type LiveProductEvent =
  | "election_page_view"
  | "state_open"
  | "municipality_search"
  | "municipality_open"
  | "timeline_open"
  | "math_status_open"
  | "first_round_comparison_open";
