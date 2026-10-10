import { politicianPath } from "@/lib/paths";
import type { PoliticianSummary } from "@/lib/types";
import { initialsOf, rememberIdentity } from "@/motion/identity";
import { TransitionLink } from "@/motion/navigation";

interface PoliticianCardProps {
  politician: PoliticianSummary;
}

/**
 * Entrada de um perfil na busca. Ao abrir, avatar e nome são entregues ao
 * perfil como elementos compartilhados (`data-vt`): a identidade do político
 * permanece no lugar enquanto a página aprofunda.
 */
export function PoliticianCard({ politician }: PoliticianCardProps) {
  const meta = [politician.office, politician.partyAcronym, politician.state]
    .filter(Boolean)
    .join(" · ");

  return (
    <TransitionLink
      href={politicianPath(politician)}
      shareIdentity
      onClick={() => rememberIdentity(politician.slug ?? politician.id, politician.ballotName)}
      className="group mi-surface focus-ring flex items-center gap-4 rounded-lg border border-white/8 bg-card p-4 hover:border-brand/30 hover:bg-card-elevated/60"
    >
      {/* Avatar */}
      <div
        data-vt="avatar"
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-brand/15 bg-brand/10 text-sm font-semibold text-brand transition-colors duration-[var(--motion-acknowledge)] group-hover:border-brand/40"
      >
        {initialsOf(politician.ballotName)}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p data-vt="name" className="w-fit max-w-full truncate font-semibold text-slate-100 transition-colors duration-[var(--motion-acknowledge)] group-hover:text-brand">
          {politician.ballotName}
        </p>
        <p className="truncate text-xs text-slate-500">{politician.name}</p>
        {meta && (
          <p className="mt-0.5 truncate text-xs text-slate-600">{meta}</p>
        )}
      </div>

      {/* Arrow */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mi-arrow flex-shrink-0 text-slate-700 transition-colors group-hover:text-brand"
        aria-hidden="true"
      >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    </TransitionLink>
  );
}
