"use client";

import { SwapValue } from "@/motion/feedback";
import { TransitionLink } from "@/motion/navigation";
import type { ReadingModel } from "./explorer-types";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

/**
 * "O que estou vendo": território, o que o mapa mostra, o valor do território escolhido e de onde ele veio. Fonte,
 * conjunto e data de coleta nunca dependem de plano. O nome do território segue para o perfil como elemento
 * compartilhado (mesma identidade entre as telas).
 */
export function ReadingPanel({
  kind,
  title,
  reading,
  profile,
  loading,
}: Readonly<{
  kind: string;
  title: string;
  reading: ReadingModel;
  /** Perfil do território: o nome no link segue para o cabeçalho do perfil. */
  profile?: { href: string; prefix: string; name: string } | null;
  loading?: boolean;
}>) {
  return (
    <aside aria-label="Leitura do recorte" aria-busy={loading || undefined} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4" data-testid="reading-panel">
      <div>
        <p className="text-label uppercase text-fg-muted">{kind}</p>
        <h2 className="mt-1 text-heading-sm text-fg">
          <SwapValue swapKey={title}>{title}</SwapValue>
        </h2>
      </div>
      <div>
        <p className="text-label uppercase text-fg-muted">O que você vê</p>
        <p className="mt-1 text-body-sm leading-6 text-fg-soft">{reading.what}</p>
      </div>
      {reading.notice && (
        <p className="border-l-2 border-warn pl-3 text-body-sm text-fg-soft" role="note">
          {reading.notice}
        </p>
      )}
      {reading.value && (
        <div>
          <p className="text-label uppercase text-fg-muted">{reading.value.label}</p>
          <p className="mt-1 text-heading-md tabular-nums text-fg" aria-live="polite">
            <SwapValue swapKey={reading.value.swapKey}>{reading.value.text}</SwapValue>
          </p>
        </div>
      )}
      {reading.facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-body-sm">
          {reading.facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-fg-muted">{fact.label}</dt>
              <dd className="text-fg">{fact.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {reading.source && (
        <p className="border-t border-line pt-3 text-micro leading-5 text-fg-muted">
          Fonte: <span className="text-fg-soft">{reading.source.provider}</span> · {reading.source.dataset} · {reading.source.dateLabel ?? "coletado em"}{" "}
          {dateTime.format(new Date(reading.source.retrievedAt))}.
        </p>
      )}
      {profile && (
        <TransitionLink href={profile.href} shareIdentity direction="deeper" className="focus-ring mi-underline group mt-auto inline-flex w-fit items-center gap-1 rounded text-body-sm font-medium text-accent-text">
          <span>
            {profile.prefix} <span data-vt="name">{profile.name}</span>
          </span>
          <span aria-hidden="true" className="mi-arrow">→</span>
        </TransitionLink>
      )}
    </aside>
  );
}
