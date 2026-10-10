/**
 * Fio de identidade entre telas. Quando o usuário abre um perfil a partir de um
 * card da busca ou de um voto, guardamos (só em memória, só nesta aba) o nome
 * exibido naquele ponto de partida. O perfil em carregamento usa esse nome para
 * manter a identidade visível — é a mesma entidade, pelo mesmo id — até os dados
 * oficiais chegarem e substituírem o cabeçalho. Nenhum outro dado é antecipado.
 */
const hints = new Map<string, { name: string }>();

export function rememberIdentity(id: string | null | undefined, name: string | null | undefined) {
  if (!id || !name) return;
  hints.set(id, { name });
}

export function identityHint(id: string | null | undefined): { name: string } | null {
  return (id && hints.get(id)) || null;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
