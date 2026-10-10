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
        <div className="rounded-lg border border-white/8 bg-card-elevated/40 p-4" aria-hidden="true">
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
      <div className="text-sm text-red-400 py-8 text-center">
        Erro ao carregar dados da Câmara.
      </div>
    );
  }

  if (mandates.length === 0) {
    return (
      <div className="text-sm text-zinc-400 py-8 text-center">
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
            className="object-cover rounded border border-zinc-700"
            unoptimized
          />
        )}
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">
            {mandate.title ?? "Deputado Federal"}
          </h3>
          <p className="text-sm text-zinc-400">
            {mandate.legislature}ª Legislatura · {mandate.state} · {mandate.partyAcronym}
          </p>
          {mandate.startDate && mandate.endDate && (
            <p className="text-xs text-zinc-500 mt-1">
              {new Date(mandate.startDate).getFullYear()} – {new Date(mandate.endDate).getFullYear()}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-zinc-500">ID Câmara</span>
          <p className="text-zinc-200 font-mono">{mandate.externalId ?? "—"}</p>
        </div>
        <div>
          <span className="text-zinc-500">Casa</span>
          <p className="text-zinc-200">{mandate.house}</p>
        </div>
        <div>
          <span className="text-zinc-500">Legislatura</span>
          <p className="text-zinc-200">{mandate.legislature}ª</p>
        </div>
        <div>
          <span className="text-zinc-500">Partido</span>
          <p className="text-zinc-200">{mandate.partyAcronym ?? "—"}</p>
        </div>
      </div>

      {mandate.externalUrl && (
        <a
          href={mandate.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          Ver perfil completo na Câmara dos Deputados ↗
        </a>
      )}

      {mandates.length > 1 && (
        <div className="border-t border-zinc-800 pt-4">
          <p className="text-xs text-zinc-500 mb-2">Outros mandatos registrados:</p>
          <div className="space-y-1">
            {mandates.slice(1).map((m) => (
              <div key={m.id} className="text-xs text-zinc-400">
                {m.legislature}ª Legislatura · {m.house} · {m.partyAcronym}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
