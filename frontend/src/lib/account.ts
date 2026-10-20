import { API_URL, ApiError } from "./api";

export interface AccountMe {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  csrfToken: string;
  sessionExpiresAt: string;
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

export async function getAccount(): Promise<AccountMe | null> {
  try {
    return await accountFetch<AccountMe>("/api/v1/account/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function requestMagicLink(email: string, returnTo = "/conta") {
  return accountFetch<{ status: string }>("/api/v1/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({ email, returnTo }),
  });
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

export function saveItem(me: AccountMe, item: Omit<SavedItem, "id" | "createdAt">) {
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

export function getAlerts() { return accountFetch<AlertSubscription[]>("/api/v1/account/alerts"); }
export function getNotifications() { return accountFetch<AccountNotification[]>("/api/v1/account/notifications"); }
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
