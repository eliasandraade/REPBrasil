import { fetchJson } from "./api";
import type { PlanCode, PlanSource, SubscriptionStatus } from "./account";

/** Capability do catálogo da API: recurso (sim/não) ou limite numérico. */
export interface CapabilityDefinition {
  key: string;
  kind: "feature" | "limit";
  group: string;
  label: string;
  description: string;
}

export interface PlanDefinition {
  code: PlanCode;
  rank: number;
  name: string;
  monthlyPriceCents: number;
  recommended: boolean;
  summary: string;
  audience: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
}

/** Catálogo único de planos (GET /api/v1/plans). A interface nunca inventa plano, preço ou limite. */
export interface PlansCatalog {
  currency: "BRL";
  interval: "month";
  billing: { available: boolean; message: string | null };
  baseline: string[];
  capabilities: CapabilityDefinition[];
  plans: PlanDefinition[];
}

export const getPlans = () => fetchJson<PlansCatalog>("/api/v1/plans");

export const FAVORITES_LIMIT = "limit.favorites";
export const WATCHLIST_LIMIT = "limit.watchlist";
export const ALERTS_LIMIT = "limit.alerts";
export const COMPARE_LIMIT = "limit.compare_candidacies";
export const SAVED_FOLDERS = "account.saved_folders";
/** Relevo 3D, intensidade (mapa de calor) e antes/depois no mapa. O mapa, a tabela e os valores são de todos. */
export const ADVANCED_MAP_MODES = "map.advanced_modes";
/** Série inteira de uma camada (linha do tempo) numa consulta. Cada ano continua aberto a todos. */
export const MAP_SERIES = "data.map_series";
export const CORRELATION_MATRIX = "data.correlation_matrix";
export const EXPORT_CSV = "data.export_csv";
export const EXPORT_BULK = "data.export_bulk";

export const PLAN_NAME: Record<PlanCode, string> = { FREE: "Gratuito", ADVANCED: "Avançado", PROFESSIONAL: "Profissional" };

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 24,90"; o plano gratuito é "R$ 0" (sem centavos que não existem). */
export function formatMonthlyPrice(cents: number): string {
  return cents === 0 ? "R$ 0" : BRL.format(cents / 100);
}

/** Valor de uma capability num plano, para leitura: limite numérico ou "Incluído"/"Não incluído". */
export function capabilityValue(plan: PlanDefinition, capability: CapabilityDefinition): { text: string; included: boolean } {
  if (capability.kind === "limit") {
    const max = plan.limits[capability.key] ?? 0;
    return { text: max.toLocaleString("pt-BR"), included: max > 0 };
  }
  const on = plan.features[capability.key] === true;
  return { text: on ? "Incluído" : "Não incluído", included: on };
}

export const PLAN_SOURCE_LABEL: Record<PlanSource, string> = {
  default: "plano padrão de toda conta",
  subscription: "pela sua assinatura",
  manual: "concedido pela administração do REPBrasil",
  role: "acesso de administração",
};

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: "Ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
  expired: "Encerrada",
};
