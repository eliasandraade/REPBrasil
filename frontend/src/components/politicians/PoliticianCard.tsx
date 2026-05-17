import Link from "next/link";
import type { PoliticianSummary } from "@/lib/types";

interface PoliticianCardProps {
  politician: PoliticianSummary;
}

export function PoliticianCard({ politician }: PoliticianCardProps) {
  const meta = [politician.office, politician.partyAcronym, politician.state]
    .filter(Boolean)
    .join(" · ");

  const initials = politician.ballotName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <Link
      href={`/politico/${politician.id}`}
      className="group flex items-center gap-4 rounded-lg border border-white/8 bg-card p-4 transition-all hover:border-brand/30 hover:shadow-card-hover"
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-brand/10 border border-brand/15 text-brand font-semibold text-sm">
        {initials}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-100 transition-colors group-hover:text-brand">
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
        className="flex-shrink-0 text-slate-700 transition-colors group-hover:text-brand"
        aria-hidden="true"
      >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    </Link>
  );
}
