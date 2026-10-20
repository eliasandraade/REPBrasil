import { API_URL, ApiError } from "./api";

export type PlanCode = "FREE" | "ADVANCED" | "PROFESSIONAL";
export type PlanSource = "default" | "subscription" | "manual" | "role";
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "expired";
export type UsageType = "eleitor" | "estudante_pesquisador" | "jornalista" | "assessor_politico" | "servidor_publico" | "outro";

/** Conta da sessão. Plano, recursos e limites são decididos pela API; a interface só reflete. */
export interface AccountMe {
  id: string;
  email: string;
  displayName: string | null;
  /** Foto do provedor, ou nulo quando a pessoa prefere as iniciais. */
  avatarUrl: string | null;
  csrfToken: string;
  sessionExpiresAt: string;
  role: "user" | "superadmin";
  plan: PlanCode;
  planSource: PlanSource;
  capabilities: Record<string, boolean>;
  limits: Record<string, number>;
  subscription: {
    plan: PlanCode;
    status: SubscriptionStatus;
    provider: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    active: boolean;
  } | null;
  profile: {
    fullName: string | null;
    stateCode: string | null;
    municipalityIbgeCode: string | null;
    municipalityName: string | null;
    usageType: UsageType | null;
    avatarHidden: boolean;
  };
  usage: { favorites: number; watchlist: number; alerts: number; unreadNotifications: number };
}

export interface AccountProfile {
  email: string;
  displayName: string | null;
  fullName: string | null;
  providerAvatarUrl: string | null;
  avatarHidden: boolean;
  stateCode: string | null;
  municipalityIbgeCode: string | null;
  municipalityName: string | null;
  usageType: UsageType | null;
  customizedAt: string | null;
}

export interface ProfileUpdate {
  displayName: string | null;
  fullName: string | null;
  stateCode: string | null;
  municipalityIbgeCode: string | null;
  usageType: UsageType | null;
  avatarHidden: boolean;
}

export interface AlertKind {
  resourceType: string;
  eventKind: string;
  label: string;
  description: string;
  keyFormat: string;
}

/** Recusa do plano (403): recurso fora do plano ou limite atingido, com o menor plano que resolveria. */
export interface PlanRefusal {
  error: "plan_required" | "plan_limit_reached";
  capability?: string;
  limit?: string;
  max?: number;
  requiredPlan: PlanCode | null;
  message: string;
}

export interface SavedItem {
  id: string;
  collection: "favorite" | "watchlist";
  resourceType: string;
  resourceKey: string;
  label: string | null;
  href: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  folder: string | null;
}

export interface AlertSubscription {
  id: string;
  resourceType: string;
  resourceKey: string;
  eventKind: string;
  delivery: "in_app" | "email";
  enabled: boolean;
  createdAt: string;
}

export interface AccountNotification {
  id: string;
  eventKey: string;
  resourceType: string;
  resourceKey: string;
  title: string;
  body: string | null;
  href: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface AccountEntitlement {
  key: string;
  value: string;
  source: string;
  startsAt: string;
  expiresAt: string | null;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  dailyQuota: number;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
}

export interface CreatedApiKey {
  key: ApiKeyInfo;
  secret: string;
}

async function accountFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ApiError(response.status, `API error ${response.status}: ${path}${body ? ` — ${body}` : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function errorBody(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ApiError)) return null;
  const start = error.message.indexOf(" — ");
  if (start < 0) return null;
  try {
    const parsed: unknown = JSON.parse(error.message.slice(start + 3));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A recusa de plano dentro de um erro da API, ou nulo se o erro for outro. */
export function planRefusalOf(error: unknown): PlanRefusal | null {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  const body = errorBody(error);
  if (body?.error !== "plan_required" && body?.error !== "plan_limit_reached") return null;
  return body as unknown as PlanRefusal;
}

/** Mensagem de validação da API (`{ error }` em 400), ou nulo. */
export function accountErrorMessage(error: unknown): string | null {
  const body = errorBody(error);
  const text = body?.message ?? body?.error;
  return typeof text === "string" && text.trim() ? text : null;
}

const SITE_TITLE_SUFFIX = "repbrasil";
const TITLE_SEPARATORS = new Set(["·", "|", "—", "-"]);

/** Rótulo de página salva: o título sem o sufixo " · REPBrasil" do template, sem regex com backtracking. */
export function savedPageLabel(title: string, fallback: string): string {
  let label = title.trim();
  if (label.toLowerCase().endsWith(SITE_TITLE_SUFFIX)) {
    const head = label.slice(0, -SITE_TITLE_SUFFIX.length).trimEnd();
    if (TITLE_SEPARATORS.has(head.at(-1) ?? "")) label = head.slice(0, -1).trim();
  }
  return label || fallback;
}

/**
 * Completa campos que uma API anterior a esta versão ainda não devolve (durante um deploy em que o frontend
 * chega antes da API): plano Gratuito, sem recursos e limites zerados. O servidor continua decidindo tudo.
 */
export function normalizeAccount(raw: Partial<AccountMe> & Pick<AccountMe, "id" | "email" | "csrfToken">): AccountMe {
  return {
    displayName: null,
    avatarUrl: null,
    sessionExpiresAt: "",
    role: "user",
    plan: "FREE",
    planSource: "default",
    subscription: null,
    ...raw,
    capabilities: raw.capabilities ?? {},
    limits: raw.limits ?? {},
    profile: raw.profile ?? { fullName: null, stateCode: null, municipalityIbgeCode: null, municipalityName: null, usageType: null, avatarHidden: false },
    usage: raw.usage ?? { favorites: 0, watchlist: 0, alerts: 0, unreadNotifications: 0 },
  };
}

/**
 * Conta da sessão, ou nulo para quem não entrou. Usa `/account/session` (200 `{authenticated:false}` sem sessão),
 * para a checagem feita em toda página não registrar um 401 esperado como erro no console.
 */
export async function getAccount(): Promise<AccountMe | null> {
  try {
    const state = await accountFetch<Partial<AccountMe> & { authenticated?: boolean }>("/api/v1/account/session");
    if (!state.authenticated || !state.id || !state.email || !state.csrfToken) return null;
    return normalizeAccount(state as AccountMe);
  } catch (error) {
    // API anterior a esta versão (frontend publicado antes): sem /account/session, vale /account/me (401 = anônimo).
    if (error instanceof ApiError && error.status === 404) return getAccountFromMe();
    throw error;
  }
}

async function getAccountFromMe(): Promise<AccountMe | null> {
  try {
    return normalizeAccount(await accountFetch<AccountMe>("/api/v1/account/me"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Prazo do pedido de magic link no navegador: maior que o limite de ~10 s da API, para o 503 dela chegar antes. */
export const MAGIC_LINK_TIMEOUT_MS = 20_000;

export async function requestMagicLink(email: string, returnTo = "/conta") {
  // Sem resposta no prazo, o pedido é abortado e a tela sai de "Enviando…" com a mensagem de erro.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAGIC_LINK_TIMEOUT_MS);
  try {
    return await accountFetch<{ status: string }>("/api/v1/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, returnTo }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function googleLoginUrl(returnTo = "/conta") {
  return `${API_URL}/api/v1/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function logout(csrfToken: string) {
  return accountFetch<void>("/api/v1/auth/logout", { method: "POST", headers: { "X-RepBrasil-CSRF": csrfToken } });
}

export function getSavedItems(collection: "favorite" | "watchlist") {
  return accountFetch<SavedItem[]>(`/api/v1/account/saved?collection=${collection}`);
}

export function saveItem(me: AccountMe, item: Omit<SavedItem, "id" | "createdAt" | "folder">) {
  return accountFetch<SavedItem>("/api/v1/account/saved", {
    method: "POST",
    headers: { "X-RepBrasil-CSRF": me.csrfToken },
    body: JSON.stringify(item),
  });
}

export function removeSavedItem(me: AccountMe, collection: "favorite" | "watchlist", resourceType: string, resourceKey: string) {
  const params = new URLSearchParams({ collection, resourceType, resourceKey });
  return accountFetch<void>(`/api/v1/account/saved?${params}`, {
    method: "DELETE",
    headers: { "X-RepBrasil-CSRF": me.csrfToken },
  });
}

export function moveSavedItem(me: AccountMe, item: Pick<SavedItem, "collection" | "resourceType" | "resourceKey">, folder: string | null) {
  return accountFetch<SavedItem>("/api/v1/account/saved/folder", {
    method: "POST",
    headers: { "X-RepBrasil-CSRF": me.csrfToken },
    body: JSON.stringify({ ...item, folder }),
  });
}

export function getProfile() { return accountFetch<AccountProfile>("/api/v1/account/profile"); }

export function updateProfile(me: AccountMe, update: ProfileUpdate) {
  return accountFetch<AccountProfile>("/api/v1/account/profile", {
    method: "POST",
    headers: { "X-RepBrasil-CSRF": me.csrfToken },
    body: JSON.stringify(update),
  });
}

export function getAlertKinds() { return accountFetch<AlertKind[]>("/api/v1/account/alert-kinds"); }
export function getAlerts() { return accountFetch<AlertSubscription[]>("/api/v1/account/alerts"); }

export function saveAlert(me: AccountMe, alert: { resourceType: string; resourceKey: string; eventKind: string; enabled: boolean }) {
  return accountFetch<AlertSubscription>("/api/v1/account/alerts", {
    method: "POST",
    headers: { "X-RepBrasil-CSRF": me.csrfToken },
    body: JSON.stringify({ ...alert, delivery: "in_app" }),
  });
}

export function deleteAlert(me: AccountMe, id: string) {
  return accountFetch<void>(`/api/v1/account/alerts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-RepBrasil-CSRF": me.csrfToken },
  });
}

export function getNotifications() { return accountFetch<AccountNotification[]>("/api/v1/account/notifications"); }

export function markNotificationRead(me: AccountMe, id: string) {
  return accountFetch<void>(`/api/v1/account/notifications/${encodeURIComponent(id)}/read`, {
    method: "POST",
    headers: { "X-RepBrasil-CSRF": me.csrfToken },
  });
}

export function markAllNotificationsRead(me: AccountMe) {
  return accountFetch<void>("/api/v1/account/notifications/read-all", {
    method: "POST",
    headers: { "X-RepBrasil-CSRF": me.csrfToken },
  });
}

export function getEntitlements() { return accountFetch<AccountEntitlement[]>("/api/v1/account/entitlements"); }
export function getApiKeys() { return accountFetch<ApiKeyInfo[]>("/api/v1/account/api-keys"); }

export function createApiKey(me: AccountMe, name: string) {
  return accountFetch<CreatedApiKey>("/api/v1/account/api-keys", {
    method: "POST",
    headers: { "X-RepBrasil-CSRF": me.csrfToken },
    body: JSON.stringify({ name, scopes: ["read:public"] }),
  });
}

export function revokeApiKey(me: AccountMe, id: string) {
  return accountFetch<void>(`/api/v1/account/api-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-RepBrasil-CSRF": me.csrfToken },
  });
}
