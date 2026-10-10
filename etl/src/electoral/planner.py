from __future__ import annotations

from dataclasses import dataclass

from .models import EA16Config, SectionAux, UrnaReception
from .tse_urls import TSEConfig, section_aux_url, urna_file_url


@dataclass(frozen=True)
class AuxRequest:
    uf: str
    municipality: str
    zone: int
    section: int
    source_date: str
    source_time: str
    url: str


@dataclass(frozen=True)
class UrnaArtifactRequest:
    uf: str
    municipality: str
    zone: int
    section: int
    reception_hash: str
    reception_status: str
    filename: str
    file_type: str
    url: str


def plan_aux_requests(
    document: EA16Config,
    cfg: TSEConfig,
    *,
    uf: str,
    municipality: str,
    zone: int,
) -> list[AuxRequest]:
    zone_data = document.find_zone(uf, municipality, zone)
    planned: list[AuxRequest] = []
    for section in zone_data.sec:
        if not section.auxiliary_available:
            continue
        number = int(section.ns)
        planned.append(
            AuxRequest(
                uf=uf.lower(),
                municipality=str(municipality).zfill(5),
                zone=int(zone),
                section=number,
                source_date=section.da or "",
                source_time=section.ha or "",
                url=section_aux_url(cfg, uf, municipality, zone, number),
            )
        )
    return planned


def plan_urna_artifacts(
    document: SectionAux,
    cfg: TSEConfig,
    *,
    uf: str,
    municipality: str,
    zone: int,
    section: int,
    suffix: str | None = None,
    reception: UrnaReception | None = None,
) -> list[UrnaArtifactRequest]:
    selected = reception or document.latest_usable_reception()
    if selected is None:
        return []
    files = selected.arq
    if suffix is not None:
        files = [item for item in files if item.has_suffix(suffix)]
    return [
        UrnaArtifactRequest(
            uf=uf.lower(),
            municipality=str(municipality).zfill(5),
            zone=int(zone),
            section=int(section),
            reception_hash=selected.hash,
            reception_status=selected.st,
            filename=item.nm,
            file_type=item.tp,
            url=urna_file_url(cfg, uf, municipality, zone, section, selected.hash, item.nm),
        )
        for item in files
    ]
