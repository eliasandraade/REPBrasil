import { accountFetch, type AccountMe, type PlanCode, type SubscriptionStatus } from "./account";

/** Estado de um componente medido pelo diagnóstico. */
export interface ComponentHealth {
  name: string;
  status: "ok" | "down" | "not_configured";
  latencyMs: number | null;
  detail: string | null;
}

export interface RouteMetric {
  method: string;
  route: string;
  calls: number;
  clientErrors: number;
  serverErrors: number;
  p95Ms: number | null;
  lastCallAt: string | null;
}

export interface AdminOverview {
  generatedAt: string;
  api: { environment: string; revision: string | null; startedAt: string; uptimeSeconds: number; runtime: string; latestMigration: string | null };
  components: ComponentHealth[];
  pendingMigrations: string[];
  freshness: Array<{ source: string; rows: number; latestAt: string | null }>;
  derivedViews: Array<{ view: string; refreshedAt: string; buRuns: number; buLastFinishedAt: string | null }>;
  recentIngestions: Array<{ source: string; status: string; startedAt: string; finishedAt: string | null; error: string | null }>;
  users: {
    total: number;
    active: number;
    suspended: number;
    new7d: number;
    new30d: number;
    seen30d: number;
    activeSessions: number;
    byPlan: Record<PlanCode, number>;
    byRole: { user: number; superadmin: number };
    truncated: boolean;
  };
  subscriptions: { active: number; pastDue: number; canceled: number; expired: number; lapsedButActive: number; manualPlanGrants: number; billingProvider: string | null };
  alerts: { enabledSubscriptions: number; notifications: number; pendingEditions: number; latestEditionAt: string | null };
  support: { open: number; inReview: number };
  http: { since: string; calls: number; serverErrors: number; routes: RouteMetric[] };
}

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string | null;
  status: "active" | "suspended";
  plan: PlanCode;
  planSource: AccountMe["planSource"];
  role: AccountMe["role"];
  configuredSuperadmin: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  activeSessions: number;
}

export interface AdminUserPage {
  items: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  truncated: boolean;
}

export interface AdminSubscriptionRow {
  id: string;
  userId: string;
  email: string;
  plan: PlanCode;
  status: SubscriptionStatus;
  provider: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  canceledAt: string | null;
  countsNow: boolean;
}

export interface AuditEntry {
  id: string;
  actorUserId: string;
  actorEmail: string;
  action: string;
  targetUserId: string | null;
  targetLabel: string | null;
  before: unknown;
  after: unknown;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface AdminUserDetail {
  id: string;
  email: string;
  displayName: string | null;
  fullName: string | null;
  stateCode: string | null;
  municipalityName: string | null;
  usageType: string | null;
  status: "active" | "suspended";
  disabledReason: string | null;
  disabledAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  activeSessions: number;
  providers: string[];
  configuredSuperadmin: boolean;
  access: { role: AccountMe["role"]; plan: PlanCode; planSource: AccountMe["planSource"]; features: Record<string, boolean>; limits: Record<string, number> };
  entitlements: Array<{ key: string; value: string; source: string; startsAt: string; expiresAt: string | null }>;
  subscriptions: AdminSubscriptionRow[];
  usage: AccountMe["usage"];
  audit: AuditEntry[];
}

export interface SupportRequestRow {
  id: string;
  category: string;
  name: string | null;
  email: string;
  organization: string | null;
  relatedSubject: string | null;
  sourceReference: string | null;
  message: string;
  status: "novo" | "em_analise" | "respondido" | "arquivado";
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Regra de acesso de uma rota, lida pelo servidor dos atributos que a aplicam (x-repbrasil-access). */
export interface RouteAccess {
  kind: "public" | "session" | "capability" | "superadmin" | "header";
  label: string;
  csrf: boolean;
  capability?: string | null;
  requiredPlan?: PlanCode | null;
  header?: string | null;
}

export interface OpenApiCatalog {
  generatedAt: string;
  metricsSince: string;
  document: OpenApiDocument;
  metrics: RouteMetric[];
}

export interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, JsonSchema> };
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Array<{ name: string; in: string; required?: boolean; description?: string; schema?: JsonSchema }>;
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: JsonSchema }> }>;
  "x-repbrasil-access"?: RouteAccess;
}

export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  nullable?: boolean;
  description?: string;
  additionalProperties?: JsonSchema | boolean;
}

const csrf = (me: AccountMe) => ({ "X-RepBrasil-CSRF": me.csrfToken });
const post = <T,>(me: AccountMe, path: string, body: unknown) =>
  accountFetch<T>(path, { method: "POST", headers: csrf(me), body: JSON.stringify(body) });

/** Cliente das rotas de administração (sessão de Super Admin; escrita com CSRF). */
export const adminApi = {
  me: () => accountFetch<{ id: string; email: string; role: string }>("/api/v1/admin/me"),
  overview: () => accountFetch<AdminOverview>("/api/v1/admin/overview"),
  users: (query: URLSearchParams) => accountFetch<AdminUserPage>(`/api/v1/admin/users?${query}`),
  user: (id: string) => accountFetch<AdminUserDetail>(`/api/v1/admin/users/${encodeURIComponent(id)}`),
  suspend: (me: AccountMe, id: string, reason: string | null) => post<AdminUserDetail>(me, `/api/v1/admin/users/${encodeURIComponent(id)}/suspend`, { reason }),
  reactivate: (me: AccountMe, id: string) => post<AdminUserDetail>(me, `/api/v1/admin/users/${encodeURIComponent(id)}/reactivate`, {}),
  role: (me: AccountMe, id: string, role: "user" | "superadmin") => post<AdminUserDetail>(me, `/api/v1/admin/users/${encodeURIComponent(id)}/role`, { role }),
  plan: (me: AccountMe, id: string, plan: PlanCode, expiresAt: string | null) =>
    post<AdminUserDetail>(me, `/api/v1/admin/users/${encodeURIComponent(id)}/plan`, { plan, expiresAt }),
  grant: (me: AccountMe, id: string, key: string, value: string, expiresAt: string | null) =>
    post<AdminUserDetail>(me, `/api/v1/admin/users/${encodeURIComponent(id)}/entitlements`, { key, value, expiresAt }),
  revoke: (me: AccountMe, id: string, key: string) =>
    accountFetch<AdminUserDetail>(`/api/v1/admin/users/${encodeURIComponent(id)}/entitlements/${encodeURIComponent(key)}`, { method: "DELETE", headers: csrf(me) }),
  subscription: (me: AccountMe, id: string, body: { plan: PlanCode; status: SubscriptionStatus; currentPeriodEnd: string | null; notes: string | null }) =>
    post<AdminUserDetail>(me, `/api/v1/admin/users/${encodeURIComponent(id)}/subscription`, body),
  subscriptions: (status: string) => accountFetch<AdminSubscriptionRow[]>(`/api/v1/admin/subscriptions${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  audit: (query: URLSearchParams) => accountFetch<{ items: AuditEntry[]; total: number; page: number; pageSize: number }>(`/api/v1/admin/audit?${query}`),
  support: (status: string) => accountFetch<SupportRequestRow[]>(`/api/v1/admin/support${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  supportStatus: (me: AccountMe, id: string, status: SupportRequestRow["status"]) =>
    post<SupportRequestRow>(me, `/api/v1/admin/support/${encodeURIComponent(id)}/status`, { status }),
  openapi: () => accountFetch<OpenApiCatalog>("/api/v1/admin/openapi"),
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "user.suspend": "Suspensão",
  "user.reactivate": "Reativação",
  "user.role": "Papel",
  "user.plan": "Plano manual",
  "user.entitlement.grant": "Concessão",
  "user.entitlement.revoke": "Revogação",
  "user.subscription": "Assinatura",
  "support.status": "Suporte",
};

export const SUPPORT_CATEGORY_LABEL: Record<string, string> = {
  duvida: "Dúvida geral",
  contestacao: "Contestação de dado",
  correcao_de_dado: "Correção de informação",
  institucional: "Solicitação institucional",
  erro_tecnico: "Erro técnico",
  conta: "Conta e planos",
};

export const SUPPORT_STATUS_LABEL: Record<SupportRequestRow["status"], string> = {
  novo: "Novo",
  em_analise: "Em análise",
  respondido: "Respondido",
  arquivado: "Arquivado",
};
