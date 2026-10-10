from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

from .discovery import discover_general_elections
from .http_client import TSEHttpClient
from .models import EA11Config, EA12Config, EA16Config, SectionAux
from .planner import UrnaArtifactRequest, plan_urna_artifacts
from .tse_urls import (
    TSEConfig,
    election_config_url,
    municipalities_config_url,
    section_aux_url,
    sections_config_url,
)


class AcquisitionError(RuntimeError):
    pass


class AcquisitionNotReady(AcquisitionError):
    pass


@dataclass(frozen=True)
class ReceptionSnapshot:
    hash: str
    status: str
    received_at: str | None
    files: tuple[str, ...]


@dataclass(frozen=True)
class SourceGenerations:
    ea11: str
    ea12: str
    ea16: str
    ea18: str


@dataclass(frozen=True)
class SectionArtifactPlan:
    cycle: str
    pleito: int
    election_date: str
    federal_election: int
    state_election: int
    uf: str
    municipality_tse: str
    municipality_ibge: str
    municipality_name: str
    zone: int
    requested_section: int
    principal_section: int
    requested_was_aggregated: bool
    reception_hash: str
    reception_status: str
    filename: str
    file_type: str
    artifact_url: str
    ea11_url: str
    ea12_url: str
    ea16_url: str
    ea18_url: str
    generations: SourceGenerations
    receptions: tuple[ReceptionSnapshot, ...]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class AcquiredUrnaArtifact:
    plan: SectionArtifactPlan
    body: bytes
    sha256: str
    size: int
    fetched_at: str

    def manifest(self) -> dict[str, Any]:
        result = self.plan.as_dict()
        result.update(
            {
                "sha256": self.sha256,
                "size": self.size,
                "fetched_at": self.fetched_at,
                "source": "Tribunal Superior Eleitoral / resultados.tse.jus.br",
            }
        )
        return result


@dataclass(frozen=True)
class PersistedArtifact:
    data_path: Path
    manifest_path: Path


def _generated_at(document: Any) -> str:
    return f"{document.dg} {document.hg}"


def _section(zone_data, number: int):
    code = str(number).zfill(4)
    for item in zone_data.sec:
        if item.ns == code:
            return item
    raise AcquisitionError(f"section {code} not present in EA16 zone {zone_data.cd}")


def _single_artifact(requests: list[UrnaArtifactRequest], *, suffix: str) -> UrnaArtifactRequest:
    if not requests:
        raise AcquisitionNotReady(f"EA18 does not list an artifact ending with {suffix!r} in the latest usable reception")
    if len(requests) != 1:
        names = ", ".join(item.filename for item in requests)
        raise AcquisitionError(f"ambiguous urna artifact for suffix {suffix!r}: {names}")
    return requests[0]


def plan_section_artifact(
    client: TSEHttpClient,
    cfg: TSEConfig,
    *,
    uf: str,
    municipality: int | str,
    zone: int,
    section: int,
    turn: int = 1,
    suffix: str = "-bu.dat",
) -> SectionArtifactPlan:
    """Resolve one section to the exact TSE urna artifact without guessing paths.

    Network sequence is bounded and deterministic: EA11 -> EA12 -> EA16 -> EA18.
    Aggregated sections are resolved to their principal section before EA18.
    The BU bytes themselves are *not* downloaded here.
    """

    uf = uf.lower().strip()
    municipality_code = str(municipality).zfill(5)

    ea11_url = election_config_url(cfg)
    ea11 = EA11Config.model_validate(
        client.get_json(ea11_url, cache_key=f"ea11:{cfg.environment}:{cfg.cycle}")
    )
    context = discover_general_elections(ea11, cycle=cfg.cycle, turn=turn)
    bound = context.with_config(cfg)

    ea12_url = municipalities_config_url(bound, context.state.code)
    ea12 = EA12Config.model_validate(
        client.get_json(
            ea12_url,
            cache_key=f"ea12:{bound.environment}:{bound.cycle}:{context.state.code}",
        )
    )
    municipality_data = ea12.find_by_tse_code(uf, municipality_code)
    zone_code = str(zone).zfill(4)
    if zone_code not in municipality_data.z:
        raise AcquisitionError(
            f"zone {zone_code} is not listed for municipality {uf}/{municipality_code} in EA12"
        )

    ea16_url = sections_config_url(bound, uf)
    ea16 = EA16Config.model_validate(
        client.get_json(
            ea16_url,
            cache_key=f"ea16:{bound.environment}:{bound.cycle}:{bound.pleito}:{uf}",
        )
    )
    if ea16.cdp != context.pleito:
        raise AcquisitionError(f"EA16 pleito mismatch: expected {context.pleito}, got {ea16.cdp}")

    zone_data = ea16.find_zone(uf, municipality_code, zone)
    requested = _section(zone_data, section)
    principal_number = int(requested.nsp) if requested.nsp is not None else int(requested.ns)
    principal = _section(zone_data, principal_number)
    if principal.is_aggregated:
        raise AcquisitionError(f"EA16 principal resolution for section {section} points to another aggregated section")
    if not principal.auxiliary_available:
        raise AcquisitionNotReady(
            f"EA16 has not announced EA18 availability for principal section {principal_number:04d}"
        )

    ea18_url = section_aux_url(bound, uf, municipality_code, zone, principal_number)
    ea18 = SectionAux.model_validate(
        client.get_json(
            ea18_url,
            cache_key=(
                f"ea18:{bound.environment}:{bound.cycle}:{bound.pleito}:"
                f"{uf}:{municipality_code}:{zone_code}:{principal_number:04d}"
            ),
        )
    )
    reception = ea18.latest_usable_reception()
    if reception is None:
        raise AcquisitionNotReady(f"EA18 has no usable reception for section {principal_number:04d}")

    artifact = _single_artifact(
        plan_urna_artifacts(
            ea18,
            bound,
            uf=uf,
            municipality=municipality_code,
            zone=zone,
            section=principal_number,
            suffix=suffix,
            reception=reception,
        ),
        suffix=suffix,
    )

    receptions = tuple(
        ReceptionSnapshot(
            hash=item.hash,
            status=item.st,
            received_at=item.received_at.isoformat() if item.received_at else None,
            files=tuple(file.nm for file in item.arq),
        )
        for item in ea18.hashes
    )

    return SectionArtifactPlan(
        cycle=context.cycle,
        pleito=context.pleito,
        election_date=context.election_date,
        federal_election=context.federal.code,
        state_election=context.state.code,
        uf=uf,
        municipality_tse=municipality_data.cd,
        municipality_ibge=municipality_data.cdi,
        municipality_name=municipality_data.nm,
        zone=int(zone_code),
        requested_section=int(section),
        principal_section=principal_number,
        requested_was_aggregated=requested.is_aggregated,
        reception_hash=artifact.reception_hash,
        reception_status=artifact.reception_status,
        filename=artifact.filename,
        file_type=artifact.file_type,
        artifact_url=artifact.url,
        ea11_url=ea11_url,
        ea12_url=ea12_url,
        ea16_url=ea16_url,
        ea18_url=ea18_url,
        generations=SourceGenerations(
            ea11=_generated_at(ea11),
            ea12=_generated_at(ea12),
            ea16=_generated_at(ea16),
            ea18=_generated_at(ea18),
        ),
        receptions=receptions,
    )


def download_planned_artifact(client: TSEHttpClient, plan: SectionArtifactPlan) -> AcquiredUrnaArtifact:
    body = client.get_bytes(
        plan.artifact_url,
        cache_key=(
            f"urna:{plan.cycle}:{plan.pleito}:{plan.uf}:{plan.municipality_tse}:"
            f"{plan.zone:04d}:{plan.principal_section:04d}:{plan.reception_hash}:{plan.filename}"
        ),
    )
    digest = sha256(body).hexdigest()
    return AcquiredUrnaArtifact(
        plan=plan,
        body=body,
        sha256=digest,
        size=len(body),
        fetched_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    )


def acquire_section_artifact(client: TSEHttpClient, cfg: TSEConfig, **kwargs) -> AcquiredUrnaArtifact:
    plan = plan_section_artifact(client, cfg, **kwargs)
    return download_planned_artifact(client, plan)


def persist_acquired_artifact(artifact: AcquiredUrnaArtifact, out_dir: Path) -> PersistedArtifact:
    plan = artifact.plan
    if Path(plan.filename).name != plan.filename:
        raise AcquisitionError("unsafe artifact filename")

    directory = (
        Path(out_dir)
        / plan.cycle
        / str(plan.pleito)
        / plan.uf
        / plan.municipality_tse
        / f"z{plan.zone:04d}"
        / f"s{plan.principal_section:04d}"
        / artifact.sha256[:16]
    )
    directory.mkdir(parents=True, exist_ok=True)
    data_path = directory / plan.filename
    manifest_path = directory / "manifest.json"

    if data_path.exists():
        existing = sha256(data_path.read_bytes()).hexdigest()
        if existing != artifact.sha256:
            raise AcquisitionError(f"existing artifact hash mismatch at {data_path}")
    else:
        temporary = data_path.with_suffix(data_path.suffix + ".part")
        temporary.write_bytes(artifact.body)
        temporary.replace(data_path)

    manifest_payload = json.dumps(artifact.manifest(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temporary_manifest = manifest_path.with_suffix(".json.part")
    temporary_manifest.write_text(manifest_payload, encoding="utf-8")
    temporary_manifest.replace(manifest_path)
    return PersistedArtifact(data_path=data_path, manifest_path=manifest_path)
