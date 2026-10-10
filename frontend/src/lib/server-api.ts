/**
 * Leituras da API feitas pelo SERVIDOR do site (metadados, sitemap). Nunca importar em componente de cliente:
 * usa variáveis sem NEXT_PUBLIC (token interno, URL da rede privada).
 *
 * - API_INTERNAL_URL: endereço da API pela rede privada (opcional; senão, o público).
 * - INTERNAL_API_TOKEN: mesmo valor de RateLimit:InternalToken na API — um robô de busca não esgota o limite
 *   técnico do site inteiro (opcional).
 * Falha ou demora (3 s) → `null`: a página continua, com metadados genéricos.
 */
import { API_URL } from "./api";

const BASE = (process.env.API_INTERNAL_URL || API_URL).replace(/\/+$/, "");

/** Resposta com o status: 404 (não existe) é diferente de 0 (rede/tempo) e de 5xx (falha da API). */
export async function serverFetch<T>(path: string, revalidateSeconds = 3600): Promise<{ status: number; data: T | null }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.INTERNAL_API_TOKEN) headers["X-Internal-Token"] = process.env.INTERNAL_API_TOKEN;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers,
      next: { revalidate: revalidateSeconds },
      signal: AbortSignal.timeout(3000),
    });
    return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
  } catch {
    return { status: 0, data: null };
  }
}

export async function serverJson<T>(path: string, revalidateSeconds = 3600): Promise<T | null> {
  return (await serverFetch<T>(path, revalidateSeconds)).data;
}
