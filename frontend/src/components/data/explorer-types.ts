import type { ReactNode } from "react";
import type { CompareSide } from "@/components/territory/TerritoryCanvas";
import type { TableColumn, TableRow } from "@/components/territory/TerritoryTable";
import type { StateCoverage } from "@/lib/data-intelligence";
import type { DataTheme } from "@/lib/dataviz/palette";
import type { TerritoryMunicipality } from "@/lib/territories";
import type { CanvasLayer } from "@/lib/territory/layers";
import type { ExplorerLevel, ExplorerState, ExplorerView } from "@/lib/territory/url";

/** Fonte de um valor exibido: quem publicou, o conjunto e quando foi coletado. */
export interface ReadingSource {
  provider: string;
  dataset: string;
  retrievedAt: string;
  /** Como ler a data: coleta da fonte (padrão) ou atualização de um agregado derivado. */
  dateLabel?: string;
}

/** Painel "o que estou vendo": território, o que o mapa mostra, o valor e de onde ele veio. */
export interface ReadingModel {
  what: string;
  /** Valor principal do território escolhido (município). */
  value?: { label: string; text: string; swapKey: string } | null;
  facts: Array<{ label: string; text: string }>;
  source?: ReadingSource | null;
  notice?: string | null;
}

export interface TableModel {
  caption: string;
  columns: TableColumn[];
  rows: TableRow[];
  initialSort: { key: string; dir: "asc" | "desc" };
  actions?: ReactNode;
  /** Como dizer a ausência na contagem da tabela (padrão: "sem dado neste recorte"). */
  missingLabel?: string;
}

/** O que cada modo entrega ao explorador; o mapa e a tabela são do explorador (uma instância só). */
export interface ModeView {
  controls: ReactNode;
  layer: CanvasLayer | null;
  /** Lado "antes" e rótulo do "depois" na vista comparar; null = sem comparação neste recorte. */
  compare: { before: CompareSide; afterLabel: string } | null;
  /** Por que a comparação não existe aqui (texto ao lado do controle). */
  compareNote?: string;
  /** Vistas que fazem sentido para o dado deste modo. */
  views: ExplorerView[];
  reading: ReadingModel;
  table: TableModel | null;
  analysis: ReactNode;
  loading: boolean;
  error: string | null;
  retry?: () => void;
}

/** Contexto comum dos modos. */
export interface ModeContext {
  state: ExplorerState;
  level: ExplorerLevel;
  coverage: StateCoverage | null;
  /** Catálogo territorial da UF (nome, slug, código TSE), para nomes e links de perfil. */
  municipalities: TerritoryMunicipality[];
  theme: DataTheme;
  reduced: boolean;
  /** Atualiza o estado na URL (troca de recorte: substitui o histórico). */
  update: (patch: Partial<ExplorerState>) => void;
  hovered: string | null;
  onHover: (code: string | null) => void;
  enabled: boolean;
}
