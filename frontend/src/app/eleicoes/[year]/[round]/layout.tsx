import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { ElectionsExplorer } from "@/components/elections/ElectionsExplorer";
import type { ElectionsResponse } from "@/lib/elections/types";
import { serverJson } from "@/lib/server-api";

/** The geographic engine lives above the changing catch-all segment.
 * State, municipality, zone and section navigation must not recreate its canvas.
 * Validate the election here so invalid years still produce a genuine 404.
 */
export default async function ElectionWorkspaceLayout({
  children,
  params,
}: Readonly<{
  children: ReactNode;
  params: Promise<{ year: string; round: string }>;
}>) {
  const { year, round } = await params;
  const catalog = await serverJson<ElectionsResponse>("/api/v1/elections", 600);
  if (
    catalog &&
    !catalog.elections.some((e) => String(e.year) === year && String(e.round) === round)
  )
    notFound();
  return (
    <>
      <Suspense
        fallback={
          <main className="min-h-screen bg-background" aria-busy="true">
            <p className="p-8 text-slate-400">Abrindo o explorador eleitoral…</p>
          </main>
        }
      >
        <ElectionsExplorer />
      </Suspense>
      {children}
    </>
  );
}
