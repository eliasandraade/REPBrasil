"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchStateDetail, sendProductEvent } from "@/lib/live-election/api";
import { EXTERIOR_CODE, REGION_LABEL } from "@/lib/live-election/derive";
import { formatSectionsPct } from "@/lib/live-election/format";
import { ufName } from "@/lib/site";
import { LeadMiniChart } from "./Charts";
import { Drawer } from "./Dialog";
import { FirstRoundTables } from "./FirstRound";
import { useLive } from "./LiveContext";
import { CandidateSplit, TerritoryDetail } from "./TerritoryDetail";

export function stateLabel(uf: string): string {
  return uf.toUpperCase() === EXTERIOR_CODE ? "Exterior" : ufName(uf) ?? uf.toUpperCase();
}

/** Painel da UF (seção 27): resultado, participação, capital × interior, evolução e 1º turno. */
export function StateDrawer({ uf, onClose, onExplore }: Readonly<{ uf: string | null; onClose: () => void; onExplore: (uf: string) => void }>) {
  const candidates = useLive((s) => s.summary?.candidates ?? null);
  const statesRevision = useLive((s) => s.statesRevision);
  const open = uf !== null;
  const query = useQuery({
    queryKey: ["live-election", "state", uf, statesRevision],
    queryFn: ({ signal }) => fetchStateDetail(uf as string, { signal }),
    enabled: open,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (uf) sendProductEvent("state_open");
  }, [uf]);

  if (!uf) return null;
  const list = candidates ?? [];
  const loaded = query.data?.data;
  const detail = loaded && loaded.state.code.toUpperCase() === uf.toUpperCase() ? loaded : null;
  const state = detail?.state ?? null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={stateLabel(uf)}
      testId="live-state-drawer"
      subtitle={
        state ? (
          <span>
            {state.region ? `${REGION_LABEL[state.region]} · ` : ""}
            {formatSectionsPct(state.sections.totalizedPct)} das seções totalizadas
          </span>
        ) : null
      }
    >
      {!detail || !state ? (
        query.isError ? (
          <p role="status" className="text-body-sm text-fg-muted">
            Não foi possível carregar este painel agora.{" "}
            <button type="button" onClick={() => void query.refetch()} className="focus-ring rounded font-medium text-accent-text hover:underline">
              Tentar de novo
            </button>
          </p>
        ) : (
          <div className="space-y-3" aria-busy="true" aria-label="Carregando o painel da UF">
            <div className="skeleton h-24 rounded-xl" />
            <div className="skeleton h-40 rounded-xl" />
          </div>
        )
      ) : (
        <div className="space-y-6">
          <TerritoryDetail territory={state} candidates={list} />

          {detail.capital || detail.interior ? (
            <section aria-labelledby="live-drawer-capital" className="space-y-3">
              <h3 id="live-drawer-capital" className="text-label uppercase text-fg-muted">
                Capital e interior
              </h3>
              {detail.capital ? (
                <div>
                  <p className="mb-1 text-body-sm font-semibold text-fg">Capital — {detail.capital.name}</p>
                  {detail.capital.available ? (
                    <CandidateSplit territory={detail.capital} candidates={list} />
                  ) : (
                    <p className="text-body-sm text-fg-muted">Resultado da capital ainda não recebido.</p>
                  )}
                </div>
              ) : null}
              {detail.interior ? (
                <div>
                  <p className="mb-1 text-body-sm font-semibold text-fg">Interior (UF menos a capital)</p>
                  <CandidateSplit territory={detail.interior} candidates={list} />
                </div>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="live-drawer-evolution">
            <h3 id="live-drawer-evolution" className="mb-2 text-label uppercase text-fg-muted">
              Evolução da vantagem
            </h3>
            <LeadMiniChart points={detail.timeline} candidates={list} label={`Vantagem em pontos percentuais ao longo da apuração em ${stateLabel(uf)}`} />
          </section>

          {detail.firstRound ? (
            <section aria-labelledby="live-drawer-first-round">
              <h3 id="live-drawer-first-round" className="mb-2 text-label uppercase text-fg-muted">
                Variação em relação ao 1º turno
              </h3>
              <FirstRoundTables comparison={detail.firstRound} candidates={list} />
            </section>
          ) : null}

          <button
            type="button"
            onClick={() => onExplore(uf)}
            className="focus-ring w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-body-sm font-semibold text-fg hover:bg-subtle"
          >
            Explorar os municípios de {stateLabel(uf)}
          </button>
        </div>
      )}
    </Drawer>
  );
}
