/* eslint-disable @next/next/no-img-element -- foto do provedor (Google), domínio externo variável; sem otimização de imagem. */

const SIZE = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-lg" } as const;

/** Iniciais do nome (duas palavras no máximo); e-mail usa a primeira letra. */
export function initialsOf(name: string): string {
  const words = name.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)!] : words.slice(0, 1);
  return letters.map((word) => word[0]!.toLocaleUpperCase("pt-BR")).join("") || "?";
}

/** Avatar da conta: a foto do provedor, ou as iniciais (preferência do perfil ou conta sem foto). Decorativo. */
export function AccountAvatar({ name, avatarUrl, size = "md" }: Readonly<{ name: string; avatarUrl: string | null; size?: keyof typeof SIZE }>) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className={`${SIZE[size]} shrink-0 rounded-full border border-line object-cover`} />;
  }
  return (
    <span aria-hidden="true" className={`${SIZE[size]} flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-subtle font-semibold text-fg-soft`}>
      {initialsOf(name)}
    </span>
  );
}
