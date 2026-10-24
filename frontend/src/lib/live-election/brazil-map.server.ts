import ufMesh from "../../../public/geo/br-uf.json";
import type { TerritoryCollection } from "@/lib/elections/geo";
import { projectBrazil, type BrazilMapShapes } from "./map-shapes";

/**
 * Só para componentes de servidor: importa a malha de UFs (≈100 KB) e devolve o traçado SVG pronto. Nunca
 * importar em componente de cliente (a malha iria para o pacote do navegador).
 */
let cached: BrazilMapShapes | null = null;

export function brazilMapShapes(): BrazilMapShapes {
  cached ??= projectBrazil(ufMesh as unknown as TerritoryCollection);
  return cached;
}
