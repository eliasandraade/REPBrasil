"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import { getAccount, type AccountMe } from "./account";

/** Chaves de cache da conta: invalidar `["account"]` refaz tudo o que depende da sessão. */
export const accountKeys = {
  all: ["account"] as const,
  me: ["account", "me"] as const,
  profile: ["account", "profile"] as const,
  saved: (collection: "favorite" | "watchlist") => ["account", "saved", collection] as const,
  alerts: ["account", "alerts"] as const,
  alertKinds: ["account", "alert-kinds"] as const,
  notifications: ["account", "notifications"] as const,
  entitlements: ["account", "entitlements"] as const,
  apiKeys: ["account", "api-keys"] as const,
};

const noSubscription = () => () => {};

/** `false` na renderização de hidratação (igual ao HTML do servidor), `true` depois. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

export interface AccountState {
  /** `null`: sem sessão (anônimo); `undefined`: ainda não se sabe. */
  data: AccountMe | null | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * Conta da sessão, fonte única no cliente. Na hidratação responde "carregando", como o servidor (que não conhece a
 * sessão): um componente que hidrata depois da resposta da API não diverge do HTML. 4xx não é repetido; falha de
 * rede/servidor tenta mais uma vez.
 */
export function useAccount(): AccountState {
  const hydrated = useHydrated();
  const query = useQuery<AccountMe | null>({
    queryKey: accountKeys.me,
    queryFn: getAccount,
    staleTime: 30_000,
    retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 1,
  });
  if (!hydrated) return { data: undefined, isPending: true, isError: false, refetch: query.refetch };
  return { data: query.data, isPending: query.isPending, isError: query.isError, refetch: query.refetch };
}

/** Refaz os dados da conta depois de uma mudança (perfil, itens salvos, alertas, plano). */
export function useRefreshAccount() {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: accountKeys.all }), [client]);
}

/** Recurso do plano efetivo, como a API decidiu. Anônimo: não. Carregando: `undefined`. */
export function useCapability(key: string): boolean | undefined {
  const { data } = useAccount();
  if (data === undefined) return undefined;
  return data?.capabilities[key] === true;
}

/** Limite do plano efetivo, como a API decidiu; `fallback` para anônimo ou enquanto carrega. */
export function useLimit(key: string, fallback: number): number {
  const { data } = useAccount();
  return data?.limits[key] ?? fallback;
}
