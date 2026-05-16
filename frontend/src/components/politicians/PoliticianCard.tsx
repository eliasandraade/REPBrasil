import Link from "next/link";
import type { PoliticianSummary } from "@/lib/types";

interface PoliticianCardProps {
  politician: PoliticianSummary;
}

export function PoliticianCard({ politician }: PoliticianCardProps) {
  const meta = [politician.office, politician.partyAcronym, politician.state]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/politico/${politician.id}`}
      className="block p-4 border border-slate-200 rounded-lg hover:border-brand-500 hover:shadow-sm transition-all"
    >
      <p className="font-semibold text-slate-900">{politician.ballotName}</p>
      <p className="text-sm text-slate-500">{politician.name}</p>
      {meta && <p className="text-xs text-slate-400 mt-1">{meta}</p>}
    </Link>
  );
}
