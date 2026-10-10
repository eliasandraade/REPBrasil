"""Cadastro eleitoral: "Eleitorado por local de votação - <ano>" (Dados Abertos TSE).

Uma linha por seção eleitoral × turno. Semântica (leiame oficial do dataset):

- `CD_TIPO_SECAO_AGREGADA`: 1 Principal, 2 Agregada, 3 Distribuída de ofício;
  -1 fora de período eleitoral.
- `NR_SECAO_PRINCIPAL`: só para agregadas; -1 nos demais casos.
- `QT_ELEITOR_ELEICAO_FEDERAL` / `_ESTADUAL` / `_MUNICIPAL`: aptos da URNA após agregações,
  distribuições e transferências temporárias. "Para as seções distribuídas de
  ofício e agregadas, esse quantitativo é zero" — isto é, contado na
  principal. Gravamos NULL nas agregadas (nunca "zero eleitores"). Em eleição geral
  o municipal vem 0; em eleição municipal, federal e estadual vêm 0 (sem disputa).
- `QT_ELEITOR_SECAO`: eleitorado originalmente vinculado à seção — outra
  medida, guardada só como dado da fonte.
- `NR_LATITUDE` / `NR_LONGITUDE`: coordenadas gravadas no cadastro do TSE;
  -1 = não informado ⇒ NULL. Nenhuma coordenada é estimada.

Validações que bloqueiam (dado que poderia alterar contagem/identidade):
layout/encoding; ano/turno/UF fora do pedido; seção duplicada; tipo de seção
não documentado ou "Distribuída de ofício" (exige decisão de interpretação);
agregada sem principal válida, apontando para outra agregada ou para fora da
zona; aptos não nulos em agregada; local com atributos conflitantes.
"""
from __future__ import annotations

import csv
import hashlib
import re
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from pathlib import Path

from ..open_data.layout import DetectedLayout, detect_csv_layout
from .errors import CadasterError, CadasterMissing

PROFILE_ID = "tse-eleitorado-local-votacao-2026-v1"
COLUMNS: tuple[str, ...] = (
    "DT_GERACAO", "HH_GERACAO", "AA_ELEICAO", "DT_ELEICAO", "DS_ELEICAO", "NR_TURNO", "SG_UF", "CD_MUNICIPIO",
    "NM_MUNICIPIO", "NR_ZONA", "NR_SECAO", "CD_TIPO_SECAO_AGREGADA", "DS_TIPO_SECAO_AGREGADA", "NR_SECAO_PRINCIPAL",
    "NR_LOCAL_VOTACAO", "NM_LOCAL_VOTACAO", "CD_TIPO_LOCAL", "DS_TIPO_LOCAL", "DS_ENDERECO", "NM_BAIRRO", "NR_CEP",
    "NR_TELEFONE_LOCAL", "NR_LATITUDE", "NR_LONGITUDE", "CD_SITU_LOCAL_VOTACAO", "DS_SITU_LOCAL_VOTACAO",
    "CD_SITU_ZONA", "DS_SITU_ZONA", "CD_SITU_SECAO", "DS_SITU_SECAO", "CD_SITU_LOCALIDADE", "DS_SITU_LOCALIDADE",
    "CD_SITU_SECAO_ACESSIBILIDADE", "DS_SITU_SECAO_ACESSIBILIDADE", "QT_ELEITOR_SECAO", "QT_ELEITOR_ELEICAO_FEDERAL",
    "QT_ELEITOR_ELEICAO_ESTADUAL", "QT_ELEITOR_ELEICAO_MUNICIPAL", "NR_LOCAL_VOTACAO_ORIGINAL",
    "NM_LOCAL_VOTACAO_ORIGINAL", "DS_ENDERECO_LOCVT_ORIGINAL",
)
_IDX = {name: i for i, name in enumerate(COLUMNS)}
NULL_TEXT = frozenset({"", "#NULO", "#NULO#", "#NE", "#NE#"})
SECTION_TYPES = {1: "Principal", 2: "Agregada"}
DISTRIBUTED = 3
COORDINATES_SOURCE = "tse-open-data:eleitorado-local-votacao"
# Envelope do território brasileiro (inclui Fernando de Noronha e Trindade).
_LAT_RANGE = (-34.0, 5.5)
_LON_RANGE = (-74.1, -28.8)


def _text(raw: str) -> str | None:
    value = raw.strip()
    return None if value in NULL_TEXT else value


def _int(raw: str, column: str, line: int, *, allow_absent: bool = False) -> int | None:
    value = raw.strip()
    if value in {"-1", "-3"} or value in NULL_TEXT:
        if allow_absent:
            return None
        raise CadasterError(f"line {line}: {column} is absent ({value!r})")
    if not re.fullmatch(r"\d+", value):
        raise CadasterError(f"line {line}: {column} must be a non-negative integer, got {value!r}")
    return int(value)


def _coordinate(raw: str) -> float | None:
    value = raw.strip()
    if value in {"-1", "-3"} or value in NULL_TEXT:
        return None
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return None


@dataclass(frozen=True)
class PlaceRecord:
    zone: int
    code: str
    name: str
    address: str | None
    neighborhood: str | None
    postal_code: str | None
    place_type: str | None
    latitude: float | None
    longitude: float | None

    @property
    def coordinates_source(self) -> str | None:
        return COORDINATES_SOURCE if self.latitude is not None else None


@dataclass(frozen=True)
class SectionRecord:
    zone: int
    number: int
    place_code: str
    is_aggregated: bool
    principal_number: int | None  # só agregadas
    eligible_federal: int | None  # aptos da urna (principal); NULL em agregadas
    eligible_state: int | None
    section_electorate: int | None  # QT_ELEITOR_SECAO (outra medida)
    line: int
    row_hash: str
    eligible_municipal: int | None = None  # aptos da urna para cargos municipais (11/13)


@dataclass
class ZoneCadaster:
    number: int
    places: dict[str, PlaceRecord] = field(default_factory=dict)
    sections: dict[int, SectionRecord] = field(default_factory=dict)

    def aggregated_of(self, principal: int) -> list[int]:
        return sorted(s.number for s in self.sections.values() if s.is_aggregated and s.principal_number == principal)


@dataclass
class MunicipalityCadaster:
    tse_code: str
    tse_name: str
    zones: dict[int, ZoneCadaster] = field(default_factory=dict)


@dataclass
class Cadaster:
    year: int
    turn: int
    uf: str
    election_date: str  # ISO
    election_description: str | None
    generated_at: str
    municipalities: dict[str, MunicipalityCadaster]
    rows_read: int
    rows_matching: int
    rows_other_uf: int = 0  # CSV nacional: linhas de outras UFs puladas
    warnings: list[dict[str, object]] = field(default_factory=list)

    def municipality(self, tse_code: str | int) -> MunicipalityCadaster | None:
        return self.municipalities.get(str(tse_code).zfill(5))

    def summary(self) -> dict[str, object]:
        sections = [s for m in self.municipalities.values() for z in m.zones.values() for s in z.sections.values()]
        places = [p for m in self.municipalities.values() for z in m.zones.values() for p in z.places.values()]
        return {
            "year": self.year,
            "turn": self.turn,
            "uf": self.uf,
            "election_date": self.election_date,
            "generated_at": self.generated_at,
            "rows": {"read": self.rows_read, "matching": self.rows_matching, "other_uf": self.rows_other_uf},
            "municipalities": len(self.municipalities),
            "zones": len({(m.tse_code, z) for m in self.municipalities.values() for z in m.zones}),
            "polling_places": len(places),
            "polling_places_with_coordinates": sum(p.latitude is not None for p in places),
            "sections": len(sections),
            "principal_sections": sum(not s.is_aggregated for s in sections),
            "aggregated_sections": sum(s.is_aggregated for s in sections),
            "warnings": len(self.warnings),
        }


def detect_layout(path: Path) -> DetectedLayout:
    return detect_csv_layout(path, columns=COLUMNS, profile_id=PROFILE_ID)


def _row_hash(fields: list[str]) -> str:
    return hashlib.sha256("\x1f".join(fields).encode("utf-8")).hexdigest()


def _iso_date(raw: str, line: int) -> str:
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", raw.strip())
    if not m:
        raise CadasterError(f"line {line}: DT_ELEICAO must be DD/MM/YYYY, got {raw!r}")
    return f"{m[3]}-{m[2]}-{m[1]}"


def _resolve_coordinates(
    result: dict[str, MunicipalityCadaster],
    published: dict[tuple[str, int, str], set[tuple[float, float]]],
    unpublished: Counter[tuple[str, int, str]],
) -> list[dict[str, object]]:
    """Coordenadas de cada local a partir das linhas das suas seções.

    Uma única coordenada publicada vale para o local, mesmo que outras linhas não a publiquem (-1);
    coordenadas publicadas diferentes para o mesmo local ⇒ nenhuma (não se escolhe uma). Ambos os
    casos geram aviso; nada é inventado.
    """
    warnings: list[dict[str, object]] = []
    for (municipality, zone_n, place_code), coordinates in sorted(published.items()):
        zone = result[municipality].zones[zone_n]
        where = {"municipality": municipality, "zone": zone_n, "polling_place": place_code}
        if len(coordinates) > 1:
            warnings.append({"code": "polling_place_coordinates_conflict", **where,
                             "coordinates": [list(c) for c in sorted(coordinates)]})
            continue
        ((lat, lon),) = coordinates
        zone.places[place_code] = replace(zone.places[place_code], latitude=lat, longitude=lon)
        if unpublished[(municipality, zone_n, place_code)]:
            warnings.append({"code": "polling_place_coordinates_partial", **where,
                             "rows_without_coordinates": unpublished[(municipality, zone_n, place_code)]})
    return warnings


def parse_cadaster(
    csv_path: Path,
    *,
    year: int,
    turn: int,
    uf: str,
    municipalities: Iterable[str | int] | None = None,
    national: bool = False,
) -> Cadaster:
    """Lê o CSV da UF em streaming e monta o cadastro de um turno (opcionalmente só alguns municípios).

    `national=True`: até 2024 o TSE publica um único CSV nacional (`eleitorado_local_votacao_<ano>.csv`);
    as linhas de outras UFs são puladas e contadas. Num arquivo da UF, outra UF continua sendo erro.
    """
    layout = detect_layout(csv_path)
    uf = uf.upper()
    wanted = {str(m).zfill(5) for m in municipalities} if municipalities else None
    result: dict[str, MunicipalityCadaster] = {}
    dates: Counter[str] = Counter()
    descriptions: Counter[str] = Counter()
    generated: Counter[str] = Counter()
    warnings: list[dict[str, object]] = []
    rows_read = rows_matching = rows_other_uf = 0
    # Coordenadas publicadas por local (município, zona, local); resolvidas depois de ler todas as linhas.
    published: dict[tuple[str, int, str], set[tuple[float, float]]] = defaultdict(set)
    unpublished: Counter[tuple[str, int, str]] = Counter()
    i = _IDX
    with csv_path.open("r", encoding=layout.encoding, newline="") as fh:
        reader = csv.reader(fh, delimiter=layout.delimiter, quotechar=layout.quotechar)
        next(reader)
        for line, fields in enumerate(reader, start=2):
            rows_read += 1
            if len(fields) != len(COLUMNS):
                raise CadasterError(f"line {line}: expected {len(COLUMNS)} fields, got {len(fields)} (truncated?)")
            if fields[i["NR_TURNO"]].strip() != str(turn):
                continue
            if fields[i["SG_UF"]].strip().upper() != uf:
                if national:
                    rows_other_uf += 1
                    continue
                raise CadasterError(f"line {line}: SG_UF {fields[i['SG_UF']]!r} in the {uf} file")
            municipality = fields[i["CD_MUNICIPIO"]].strip().zfill(5)
            if wanted is not None and municipality not in wanted:
                continue
            rows_matching += 1
            if _int(fields[i["AA_ELEICAO"]], "AA_ELEICAO", line) != year:
                raise CadasterError(f"line {line}: AA_ELEICAO {fields[i['AA_ELEICAO']]} differs from {year}")
            dates[_iso_date(fields[i["DT_ELEICAO"]], line)] += 1
            descriptions[fields[i["DS_ELEICAO"]].strip()] += 1
            generated[f"{fields[i['DT_GERACAO']].strip()} {fields[i['HH_GERACAO']].strip()}"] += 1

            zone_n = _int(fields[i["NR_ZONA"]], "NR_ZONA", line)
            section_n = _int(fields[i["NR_SECAO"]], "NR_SECAO", line)
            assert zone_n is not None and section_n is not None
            situation = (_text(fields[i["DS_SITU_SECAO"]]) or "").upper()
            if situation != "ATIVO":
                raise CadasterError(f"line {line}: section {zone_n}/{section_n} situation {situation!r} needs an interpretation decision")

            type_code = _int(fields[i["CD_TIPO_SECAO_AGREGADA"]], "CD_TIPO_SECAO_AGREGADA", line, allow_absent=True)
            if type_code == DISTRIBUTED:
                raise CadasterError(f"line {line}: section {zone_n}/{section_n} is 'Distribuída de ofício': not supported without an interpretation decision")
            if type_code not in SECTION_TYPES:
                raise CadasterError(f"line {line}: undocumented CD_TIPO_SECAO_AGREGADA {fields[i['CD_TIPO_SECAO_AGREGADA']]!r}")
            if (_text(fields[i["DS_TIPO_SECAO_AGREGADA"]]) or "") != SECTION_TYPES[type_code]:
                raise CadasterError(f"line {line}: DS_TIPO_SECAO_AGREGADA does not match code {type_code}")
            aggregated = type_code == 2
            principal = _int(fields[i["NR_SECAO_PRINCIPAL"]], "NR_SECAO_PRINCIPAL", line, allow_absent=True)
            if aggregated and (principal is None or principal == section_n):
                raise CadasterError(f"line {line}: aggregated section {section_n} without a valid NR_SECAO_PRINCIPAL")
            if not aggregated and principal is not None:
                raise CadasterError(f"line {line}: principal section {section_n} has NR_SECAO_PRINCIPAL {principal}")

            federal = _int(fields[i["QT_ELEITOR_ELEICAO_FEDERAL"]], "QT_ELEITOR_ELEICAO_FEDERAL", line)
            state = _int(fields[i["QT_ELEITOR_ELEICAO_ESTADUAL"]], "QT_ELEITOR_ELEICAO_ESTADUAL", line)
            municipal = _int(fields[i["QT_ELEITOR_ELEICAO_MUNICIPAL"]], "QT_ELEITOR_ELEICAO_MUNICIPAL", line)
            if aggregated:
                if federal != 0 or state != 0 or municipal != 0:
                    raise CadasterError(
                        f"line {line}: aggregated section {section_n} has non-zero urn electorate ({federal}/{state}/{municipal})"
                    )
                federal = state = municipal = None  # contado na principal; ≠ zero eleitores

            place_code = fields[i["NR_LOCAL_VOTACAO"]].strip()
            if not re.fullmatch(r"\d+", place_code):
                raise CadasterError(f"line {line}: invalid NR_LOCAL_VOTACAO {place_code!r}")
            place_name = _text(fields[i["NM_LOCAL_VOTACAO"]])
            if not place_name:
                raise CadasterError(f"line {line}: empty NM_LOCAL_VOTACAO")
            lat, lon = _coordinate(fields[i["NR_LATITUDE"]]), _coordinate(fields[i["NR_LONGITUDE"]])
            if (lat is None) != (lon is None) or (
                lat is not None and lon is not None and not (_LAT_RANGE[0] <= lat <= _LAT_RANGE[1] and _LON_RANGE[0] <= lon <= _LON_RANGE[1])
            ):
                warnings.append({"code": "invalid_coordinates", "zone": zone_n, "polling_place": place_code,
                                 "latitude": fields[i["NR_LATITUDE"]], "longitude": fields[i["NR_LONGITUDE"]]})
                lat = lon = None
            place = PlaceRecord(
                zone=zone_n,
                code=place_code,
                name=place_name,
                address=_text(fields[i["DS_ENDERECO"]]),
                neighborhood=_text(fields[i["NM_BAIRRO"]]),
                postal_code=_text(fields[i["NR_CEP"]]),
                place_type=_text(fields[i["DS_TIPO_LOCAL"]]),
                latitude=lat,
                longitude=lon,
            )

            mun = result.get(municipality)
            if mun is None:
                mun = result[municipality] = MunicipalityCadaster(municipality, (_text(fields[i["NM_MUNICIPIO"]]) or ""))
            zone = mun.zones.setdefault(zone_n, ZoneCadaster(zone_n))
            # Identidade do local: todos os atributos, exceto as coordenadas (algumas linhas não as publicam).
            existing = zone.places.setdefault(place_code, replace(place, latitude=None, longitude=None))
            if existing != replace(place, latitude=None, longitude=None):
                raise CadasterError(f"line {line}: polling place {zone_n}/{place_code} has conflicting attributes across rows")
            if lat is None or lon is None:
                unpublished[(municipality, zone_n, place_code)] += 1
            else:
                published[(municipality, zone_n, place_code)].add((lat, lon))
            if section_n in zone.sections:
                raise CadasterError(f"line {line}: duplicate section {municipality}/{zone_n}/{section_n} (line {zone.sections[section_n].line})")
            zone.sections[section_n] = SectionRecord(
                zone=zone_n,
                number=section_n,
                place_code=place_code,
                is_aggregated=aggregated,
                principal_number=principal if aggregated else None,
                eligible_federal=federal,
                eligible_state=state,
                section_electorate=_int(fields[i["QT_ELEITOR_SECAO"]], "QT_ELEITOR_SECAO", line, allow_absent=True),
                line=line,
                row_hash=_row_hash(fields),
                eligible_municipal=municipal,
            )

    if wanted is not None:
        missing = sorted(wanted - set(result))
        if missing:
            raise CadasterMissing(f"municipalities {missing} have no rows for turn {turn} in {csv_path.name}")
    if not result:
        raise CadasterError(f"no rows for {uf} turn {turn} in {csv_path.name}")
    if len(dates) != 1 or len(generated) != 1:
        raise CadasterError(f"mixed election dates {sorted(dates)} or generation timestamps {sorted(generated)} in one turn")
    warnings.extend(_resolve_coordinates(result, published, unpublished))

    for mun in result.values():
        for zone in mun.zones.values():
            for s in zone.sections.values():
                if not s.is_aggregated:
                    continue
                target = zone.sections.get(s.principal_number)  # type: ignore[arg-type]
                if target is None:
                    raise CadasterError(f"section {mun.tse_code}/{zone.number}/{s.number}: principal {s.principal_number} not found in the zone")
                if target.is_aggregated:
                    raise CadasterError(f"section {mun.tse_code}/{zone.number}/{s.number}: principal {s.principal_number} is itself aggregated")
                if target.place_code != s.place_code:
                    warnings.append({"code": "aggregated_in_other_place", "municipality": mun.tse_code, "zone": zone.number,
                                     "section": s.number, "principal": target.number})

    return Cadaster(
        year=year,
        turn=turn,
        uf=uf,
        election_date=dates.most_common(1)[0][0],
        election_description=descriptions.most_common(1)[0][0] if len(descriptions) == 1 else None,
        generated_at=generated.most_common(1)[0][0],
        municipalities=result,
        rows_read=rows_read,
        rows_matching=rows_matching,
        rows_other_uf=rows_other_uf,
        warnings=warnings,
    )


def zone_snapshot(cadaster: Cadaster, municipality: str | int, zone: int) -> dict[str, object]:
    """Recorte de uma zona no formato que a reconciliação do BU consome."""
    mun = cadaster.municipality(municipality)
    if mun is None:
        raise CadasterMissing(f"no cadaster for municipality {municipality} in {cadaster.uf} {cadaster.year}/{cadaster.turn}")
    return snapshot_dict(
        tse_code=mun.tse_code,
        zone_numbers=sorted(mun.zones),
        zone=mun.zones.get(zone),
        source={"kind": "tse-open-data-polling-places", "generated_at": cadaster.generated_at},
    )


def snapshot_dict(*, tse_code: str, zone_numbers: list[int], zone: ZoneCadaster | None, source: dict[str, object]) -> dict[str, object]:
    sections: list[dict[str, object]] = []
    places: list[dict[str, object]] = []
    if zone is not None:
        places = [{"tse_location_code": p.code, "name": p.name} for p in zone.places.values()]
        for s in sorted(zone.sections.values(), key=lambda x: x.number):
            sections.append({
                "number": s.number,
                "principal_number": s.principal_number if s.is_aggregated else s.number,
                "polling_place_code": s.place_code,
                "is_aggregated": s.is_aggregated,
                "aggregated_sections": [] if s.is_aggregated else zone.aggregated_of(s.number),
                "total_eligible_federal": s.eligible_federal,
                "total_eligible_state": s.eligible_state,
                "total_eligible_municipal": s.eligible_municipal,
            })
    return {
        "source": source,
        "municipality": {"tse_code": tse_code, "zone_numbers": zone_numbers},
        "polling_places": places,
        "sections": sections,
    }
