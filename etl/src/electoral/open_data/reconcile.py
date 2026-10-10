"""Reconciliação do BU (Dados Abertos) com o cadastro do piloto.

Bloqueiam a importação (podem alterar contagem/identidade):
  - conjunto de seções principais diferente do cadastro;
  - seção desconhecida ou agregada aparecendo como urna própria;
  - agregações (`DS_SECOES_AGREGADAS`) diferentes do cadastro;
  - aptos por abrangência (federal/estadual) diferentes do cadastro.

Apenas avisam (política aprovada na revisão do PR #10; ver
`docs/DATA_SOURCES.md`, "Divergência de local de votação"):
  - `polling_place_mismatch`: o `NR_LOCAL_VOTACAO` do BU difere do local do
    cadastro. Votos e aptos não dependem do local; o valor do BU é guardado
    como proveniência e o cadastro não é alterado.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .results import ConsistencyError, NormalizedZone


@dataclass
class ReconciliationReport:
    principal_sections: list[int]
    aggregated_sections: dict[int, list[int]]
    warnings: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "principal_sections": self.principal_sections,
            "aggregated_sections": {str(k): v for k, v in sorted(self.aggregated_sections.items())},
            "warnings": self.warnings,
        }


def reconcile_with_cadastro(zone: NormalizedZone, cadastro: dict[str, Any]) -> ReconciliationReport:
    municipality = cadastro.get("municipality", {})
    if str(municipality.get("tse_code")) != str(zone.municipality_code).zfill(5):
        raise ConsistencyError(f"cadastro is for municipality {municipality.get('tse_code')}, BU is {zone.municipality_code}")
    if zone.zone not in municipality.get("zone_numbers", []):
        raise ConsistencyError(f"cadastro does not list zone {zone.zone}")

    sections = {int(s["number"]): s for s in cadastro["sections"]}
    principals = {n for n, s in sections.items() if not s["is_aggregated"]}
    found = set(zone.sections)

    unknown = sorted(found - set(sections))
    if unknown:
        raise ConsistencyError(f"BU has sections unknown to the cadastro: {unknown}")
    as_urn = sorted(n for n in found if sections[n]["is_aggregated"])
    if as_urn:
        raise ConsistencyError(f"aggregated sections appear with their own votes in the BU: {as_urn}")
    missing = sorted(principals - found)
    if missing:
        raise ConsistencyError(f"principal sections from the cadastro missing in the BU: {missing}")

    aggregated: dict[int, list[int]] = {}
    warnings: list[dict[str, Any]] = []
    places = {p["tse_location_code"] for p in cadastro.get("polling_places", [])}
    for number in sorted(found):
        record = sections[number]
        structure = zone.section_structure(number)
        bu_agg = sorted(structure["aggregated_sections"])  # type: ignore[arg-type]
        cad_agg = sorted(int(x) for x in record.get("aggregated_sections", []))
        if bu_agg != cad_agg:
            raise ConsistencyError(f"section {number}: BU aggregates {bu_agg}, cadastro aggregates {cad_agg}")
        for agg in bu_agg:
            agg_record = sections.get(agg)
            if agg_record is None or not agg_record["is_aggregated"] or int(agg_record["principal_number"]) != number:
                raise ConsistencyError(f"section {number}: aggregated {agg} is not registered as aggregated to {number}")
        if bu_agg:
            aggregated[number] = bu_agg

        eligible = zone.eligible_by_scope(number)
        expected = {"federal": record.get("total_eligible_federal"), "state": record.get("total_eligible_state")}
        for scope, value in eligible.items():
            if value is None or expected[scope] is None:
                continue  # ausência não é comparada como zero
            if value != expected[scope]:
                raise ConsistencyError(f"section {number}: BU {scope} QT_APTOS {value} != cadastro {expected[scope]}")

        bu_place = structure["polling_place_code"]
        cad_place = record.get("polling_place_code")
        if bu_place is not None and cad_place is not None and str(bu_place) != str(cad_place):
            warnings.append({
                "code": "polling_place_mismatch",
                "section": number,
                "bu_polling_place_code": str(bu_place),
                "cadastro_polling_place_code": str(cad_place),
                "bu_polling_place_in_cadastro": str(bu_place) in places,
                "affects_votes": False,
            })

    return ReconciliationReport(sorted(found), aggregated, warnings)
