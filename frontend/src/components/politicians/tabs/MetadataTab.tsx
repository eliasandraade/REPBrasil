import type { PoliticianDetail } from "@/lib/types";
import { Row, formatDate } from "../utils";

interface MetadataTabProps {
  politician: PoliticianDetail;
}

export function MetadataTab({ politician }: MetadataTabProps) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
        IDs externos
      </p>
      <Row label="TSE" value={politician.tseId} />
      <Row label="Câmara" value={politician.camaraId} />
      <Row label="Senado" value={politician.senateId} />

      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-6 mb-2">
        Coleta de dados
      </p>
      <Row label="Cadastro criado em" value={formatDate(politician.createdAt)} />
      <Row label="Última atualização" value={formatDate(politician.sourceUpdatedAt)} />
      <Row label="Versão da metodologia" value="v0 — em desenvolvimento" />

      <div className="mt-6 bg-slate-50 rounded p-3">
        <p className="text-xs text-slate-500">
          Base: dados eleitorais TSE 2024 (eleições municipais). Dados de mandatos federais em integração futura.
        </p>
      </div>
    </div>
  );
}
