import { normalizeText, pad3 } from "./format";
import type { PlaceItem, SectionItem, ZoneDetailResponse } from "./types";

/**
 * Modelo de uma zona a partir do cadastro oficial (resposta da API).
 * Integridade: coordenadas só quando a fonte publica; aptos de agregadas
 * `null` (contados na urna principal); ausente nunca vira 0.
 */
export interface ZoneModel {
  number: number;
  places: PlaceItem[];
  sections: SectionItem[];
  /** Locais sem coordenada publicada pela fonte (sem pin no mapa). */
  awaitingLocation: number;
  getSection(n: number): (SectionItem & { place: PlaceItem }) | null;
  getPlace(code: string): PlaceItem | null;
}

export function buildZoneModel(response: ZoneDetailResponse): ZoneModel | null {
  if (!response.zone) return null;
  const places = response.places;
  const byPlace = new Map(places.map((p) => [p.code, p]));
  const bySection = new Map<number, SectionItem & { place: PlaceItem }>();
  for (const place of places) for (const s of place.sections) bySection.set(s.number, { ...s, place });
  return {
    number: response.zone.number,
    places,
    sections: places.flatMap((p) => p.sections),
    awaitingLocation: places.filter((p) => p.coordinates === null).length,
    getSection: (n) => bySection.get(n) ?? null,
    getPlace: (code) => byPlace.get(code) ?? null,
  };
}

/** Busca por número de seção ("29", "029"), código do local ou nome/endereço/bairro (sem acento). */
export function searchPlaces(places: PlaceItem[], query: string): PlaceItem[] {
  const q = normalizeText(query).replace(/^(secao|seção)\s*/, "");
  if (!q) return places;
  if (/^\d+$/.test(q)) {
    const bare = q.replace(/^0+/, "");
    const match = (n: number) => pad3(n).startsWith(q) || (bare !== "" && String(n).startsWith(bare));
    return places
      .map((p) => (p.code === q ? p : { ...p, sections: p.sections.filter((s) => match(s.number)) }))
      .filter((p) => p.sections.length > 0);
  }
  return places.filter(
    (p) =>
      normalizeText(p.name).includes(q) ||
      normalizeText(p.address ?? "").includes(q) ||
      normalizeText(p.neighborhood ?? "").includes(q),
  );
}
