"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { getMandates } from "@/lib/api";
import type { Mandate } from "@/lib/types";

interface Props {
  politicianId: string;
  camaraId: string | null;
}

export function CamaraTab({ politicianId, camaraId }: Props) {
  const { data: mandates, isLoading, isError } = useQuery<Mandate[]>({
    queryKey: ["mandates", politicianId],
    queryFn: () => getMandates(politicianId),
  });

  if (isLoading) {
    return (
      <div aria-busy="true" className="space-y-3">
        <div className="rounded-lg border border-line bg-subtle/40 p-4" aria-hidden="true">
          <div className="skeleton mb-2 h-5 w-40" />
          <div className="skeleton mb-4 h-3 w-56" />
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <div className="skeleton mb-1 h-2.5 w-16" />
                <div className="skeleton h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
        <output className="sr-only">Carregando dados da Câmara</output>
      </div>
    );
  }

  if (isError || !mandates) {
    return (
      <div className="text-sm text-danger py-8 text-center">
        Erro ao carregar dados da Câmara.
      </div>
    );
  }

  if (mandates.length === 0) {
    return (
      <div className="text-sm text-fg-muted py-8 text-center">
        Nenhum mandato federal registrado para este político.
      </div>
    );
  }

  const mandate = mandates[0];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        {camaraId && (
          <Image
            src={`https://www.camara.leg.br/internet/deputado/bandep/${camaraId}.jpg`}
            alt="Foto oficial Câmara"
            width={80}
            height={96}
            className="object-cover rounded border border-line-strong"
            unoptimized
          />
        )}
        <div>
          <h3 className="text-lg font-semibold text-fg">
            {mandate.title ?? "Deputado Federal"}
          </h3>
          <p className="text-sm text-fg-muted">
            {mandate.legislature}ª Legislatura · {mandate.state} · {mandate.partyAcronym}
          </p>
          {mandate.startDate && mandate.endDate && (
            <p className="text-xs text-fg-muted mt-1">
              {new Date(mandate.startDate).getFullYear()} – {new Date(mandate.endDate).getFullYear()}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-fg-muted">ID Câmara</span>
          <p className="text-fg-soft font-mono">{mandate.externalId ?? "—"}</p>
        </div>
        <div>
          <span className="text-fg-muted">Casa</span>
          <p className="text-fg-soft">{mandate.house}</p>
        </div>
        <div>
          <span className="text-fg-muted">Legislatura</span>
          <p className="text-fg-soft">{mandate.legislature}ª</p>
        </div>
        <div>
          <span className="text-fg-muted">Partido</span>
          <p className="text-fg-soft">{mandate.partyAcronym ?? "—"}</p>
        </div>
      </div>

      {mandate.externalUrl && (
        <a
          href={mandate.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-info hover:text-info transition-colors"
        >
          Ver perfil completo na Câmara dos Deputados ↗
        </a>
      )}

      {mandates.length > 1 && (
        <div className="border-t border-line-strong pt-4">
          <p className="text-xs text-fg-muted mb-2">Outros mandatos registrados:</p>
          <div className="space-y-1">
            {mandates.slice(1).map((m) => (
              <div key={m.id} className="text-xs text-fg-muted">
                {m.legislature}ª Legislatura · {m.house} · {m.partyAcronym}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
