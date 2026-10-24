import { API_URL, ApiError } from "@/lib/api";
import type {
  FirstRoundComparison,
  LiveCandidate,
  LiveEnvelope,
  LiveHealthPublic,
  LiveProductEvent,
  LiveStatesPayload,
  LiveSummary,
  LiveTimelinePayload,
  MathStatus,
  MunicipalitiesPayload,
  MunicipalityDetailPayload,
  RankingPayload,
  StateDetailPayload,
  ZonesPayload,
} from "./types";

/**
 * Cliente da API de apuração do REPBrasil. O navegador NUNCA consulta o TSE: tudo passa pela API, que
 * ingere a fonte oficial uma vez para todos os visitantes.
 */

/** Caminho da eleição na API (servidor e cliente). */
export const LIVE_API_PATH = "/api/v1/elections/2026/president/second-round";

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export const LIVE_API_BASE = `${trimSlash(API_URL)}${LIVE_API_PATH}`;

/** Tempo máximo de uma leitura: a rede instável não pode prender a interface. */
export const LIVE_FETCH_TIMEOUT_MS = 8000;

export async function getLiveJson<T>(path: string, init?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
  const timeout = AbortSignal.timeout(init?.timeoutMs ?? LIVE_FETCH_TIMEOUT_MS);
  const signal = init?.signal ? anySignal([init.signal, timeout]) : timeout;
  const res = await fetch(`${LIVE_API_BASE}${path}`, { headers: { Accept: "application/json" }, signal, cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, `API error ${res.status}: ${path}`);
  return (await res.json()) as T;
}

/** AbortSignal.any com recuo para navegadores sem suporte. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const withAny = AbortSignal as typeof AbortSignal & { any?: (s: AbortSignal[]) => AbortSignal };
  if (typeof withAny.any === "function") return withAny.any(signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

type Opts = { signal?: AbortSignal };

export const fetchSummary = (o?: Opts) => getLiveJson<LiveEnvelope<LiveSummary>>("/summary", o);
export const fetchCandidates = (o?: Opts) => getLiveJson<LiveEnvelope<{ candidates: LiveCandidate[] }>>("/candidates", o);
export const fetchStates = (o?: Opts) => getLiveJson<LiveEnvelope<LiveStatesPayload>>("/states", o);
export const fetchStateDetail = (uf: string, o?: Opts) =>
  getLiveJson<LiveEnvelope<StateDetailPayload>>(`/states/${encodeURIComponent(uf.toUpperCase())}`, o);
export const fetchMunicipalities = (uf: string, o?: Opts) =>
  getLiveJson<LiveEnvelope<MunicipalitiesPayload>>(`/states/${encodeURIComponent(uf.toUpperCase())}/municipalities`, o);
export const fetchMunicipality = (code: string, o?: Opts) =>
  getLiveJson<LiveEnvelope<MunicipalityDetailPayload>>(`/municipalities/${encodeURIComponent(code)}`, o);
export const fetchZones = (code: string, o?: Opts) =>
  getLiveJson<LiveEnvelope<ZonesPayload>>(`/municipalities/${encodeURIComponent(code)}/zones`, o);
export const fetchCapitals = (o?: Opts) => getLiveJson<LiveEnvelope<RankingPayload>>("/capitals", o);
export const fetchLargest = (limit: 20 | 50 | 100, o?: Opts) =>
  getLiveJson<LiveEnvelope<RankingPayload>>(`/largest-municipalities?limit=${limit}`, o);
export const fetchTimeline = (scope: "br" | "uf", code: string, o?: Opts) =>
  getLiveJson<LiveEnvelope<LiveTimelinePayload>>(`/timeline?scope=${scope}&code=${encodeURIComponent(code)}`, o);
export const fetchMathStatus = (o?: Opts) => getLiveJson<LiveEnvelope<MathStatus>>("/mathematical-status", o);
export const fetchFirstRound = (scope: FirstRoundComparison["scope"], code: string, o?: Opts) =>
  getLiveJson<LiveEnvelope<FirstRoundComparison>>(`/comparison/first-round?scope=${scope}&code=${encodeURIComponent(code)}`, o);
export const fetchHealth = (o?: Opts) => getLiveJson<LiveHealthPublic>("/health", o);

/** URL do stream SSE. */
export const LIVE_STREAM_URL = `${LIVE_API_BASE}/stream`;

/** Foto oficial: o contrato pode trazer URL absoluta ou relativa à API. */
export function photoSrc(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  if (/^https?:\/\//i.test(photoUrl)) return photoUrl;
  if (photoUrl.startsWith("/")) return `${trimSlash(API_URL)}${photoUrl}`;
  return null;
}

const sentOnce = new Set<LiveProductEvent>();

/**
 * Evento anônimo de produto: só o nome do evento (lista fechada), sem visitante, sem território escolhido,
 * sem preferência eleitoral. Falha em silêncio. `once`: no máximo uma vez por carregamento (ex.: page view).
 */
export function sendProductEvent(event: LiveProductEvent, options?: { once?: boolean }): void {
  if (typeof window === "undefined") return;
  if (options?.once) {
    if (sentOnce.has(event)) return;
    sentOnce.add(event);
  }
  const url = `${LIVE_API_BASE}/events`;
  // text/plain é "simples" para CORS: a API (outra origem) recebe sem preflight e lê o corpo cru {"event": "..."}.
  const body = JSON.stringify({ event });
  try {
    const beacon = typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function";
    if (beacon && navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
  } catch {
    // beacon indisponível: segue para o fetch
  }
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    // analytics nunca derruba a página
  }
}
