/** Endereços públicos (servem ao servidor e ao cliente). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string) => UUID.test(value);

/** "/politicos/<slug>" quando há slug; senão pelo id (a página troca para o slug ao abrir). */
export const politicianPath = (p: { id: string; slug?: string | null }) => `/politicos/${encodeURIComponent(p.slug || p.id)}`;
