"""Descoberta do recurso "Boletim de Urna" pelos metadados oficiais (CKAN).

O Portal de Dados Abertos do TSE (https://dadosabertos.tse.jus.br) expõe a
API CKAN padrão. `package_show` do dataset `resultados-<ano>-boletim-de-urna`
lista um recurso ZIP por UF e turno e um recurso irmão "Hash SHA2" com o
checksum oficial (`.zip.sha512`).

Nenhum nome de arquivo/timestamp é fixado em código: o recurso é escolhido
pelos metadados (nome do recurso, formato, URL publicada). Ambiguidade falha.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Protocol
from urllib.parse import urlparse

PORTAL_BASE = "https://dadosabertos.tse.jus.br"
OFFICIAL_DOWNLOAD_HOSTS = frozenset({"cdn.tse.jus.br"})

_TURN_WORDS = {1: "Primeiro", 2: "Segundo"}
_RESOURCE_NAME = re.compile(
    r"^(?P<uf>[A-Z]{2}) - (?P<kind>Boletim de Urna|Hash SHA2) - (?P<turn>Primeiro|Segundo) turno - (?P<date>\d{2}\.\d{2}\.\d{4})$"
)


class DiscoveryError(RuntimeError):
    """Metadado oficial ausente, ambíguo ou fora do esperado."""


class JsonFetcher(Protocol):
    def get_json(self, url: str, *, cache_key: str | None = None) -> object: ...


def dataset_name(year: int) -> str:
    return f"resultados-{year}-boletim-de-urna"


def package_show_url(year: int, *, portal: str = PORTAL_BASE) -> str:
    return f"{portal}/api/3/action/package_show?id={dataset_name(year)}"


@dataclass(frozen=True)
class ChecksumResource:
    resource_id: str
    name: str
    url: str
    algorithm: str


@dataclass(frozen=True)
class OpenDataBUResource:
    portal: str
    dataset_name: str
    dataset_id: str
    dataset_title: str
    dataset_metadata_modified: str | None
    organization: str | None
    year: int
    turn: int
    uf: str
    resource_name_date: str  # data no nome do recurso (geração/publicação), NÃO a data do pleito
    resource_id: str
    resource_name: str
    url: str
    format: str | None
    mimetype: str | None
    size: int | None
    published_hash: str | None
    metadata_modified: str | None
    checksum: ChecksumResource | None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _official_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in OFFICIAL_DOWNLOAD_HOSTS:
        raise DiscoveryError(f"resource URL is not an official TSE download host: {url}")
    return url


def _algorithm_from_url(url: str) -> str:
    suffix = urlparse(url).path.rsplit(".", 1)[-1].lower()
    if suffix not in {"sha256", "sha512"}:
        raise DiscoveryError(f"cannot infer checksum algorithm from official URL: {url}")
    return suffix


def select_bu_resource(package: dict[str, Any], *, year: int, turn: int, uf: str, portal: str = PORTAL_BASE) -> OpenDataBUResource:
    """Escolhe o recurso BU de uma UF/turno a partir do resultado de package_show."""
    if package.get("success") is not True or not isinstance(package.get("result"), dict):
        raise DiscoveryError("CKAN package_show did not return success")
    result = package["result"]
    expected_name = dataset_name(year)
    if result.get("name") != expected_name:
        raise DiscoveryError(f"unexpected dataset {result.get('name')!r}; expected {expected_name!r}")
    if turn not in _TURN_WORDS:
        raise DiscoveryError(f"unsupported turn {turn}")
    uf = uf.upper()

    data: list[tuple[re.Match[str], dict[str, Any]]] = []
    hashes: list[tuple[re.Match[str], dict[str, Any]]] = []
    for resource in result.get("resources", []):
        if resource.get("state", "active") != "active":
            continue
        match = _RESOURCE_NAME.match(str(resource.get("name", "")).strip())
        if not match or match["uf"] != uf or match["turn"] != _TURN_WORDS[turn]:
            continue
        (data if match["kind"] == "Boletim de Urna" else hashes).append((match, resource))

    if len(data) != 1:
        raise DiscoveryError(f"expected exactly one BU resource for {uf} turn {turn}, found {len(data)}")
    match, resource = data[0]
    url = _official_url(str(resource.get("url", "")))
    if not urlparse(url).path.lower().endswith(".zip"):
        raise DiscoveryError(f"BU resource is not a ZIP: {url}")

    checksum: ChecksumResource | None = None
    paired = [(m, r) for m, r in hashes if m["date"] == match["date"]]
    if len(paired) > 1:
        raise DiscoveryError(f"ambiguous checksum resources for {uf} turn {turn}")
    if paired:
        _, hash_resource = paired[0]
        hash_url = _official_url(str(hash_resource.get("url", "")))
        if not hash_url.startswith(url + "."):
            raise DiscoveryError(f"checksum resource does not belong to the BU ZIP: {hash_url}")
        checksum = ChecksumResource(
            resource_id=str(hash_resource["id"]),
            name=str(hash_resource["name"]),
            url=hash_url,
            algorithm=_algorithm_from_url(hash_url),
        )

    size = resource.get("size")
    org = result.get("organization") or {}
    return OpenDataBUResource(
        portal=portal,
        dataset_name=expected_name,
        dataset_id=str(result.get("id")),
        dataset_title=str(result.get("title")),
        dataset_metadata_modified=result.get("metadata_modified"),
        organization=org.get("name") if isinstance(org, dict) else None,
        year=year,
        turn=turn,
        uf=uf,
        resource_name_date=match["date"],
        resource_id=str(resource["id"]),
        resource_name=str(resource["name"]).strip(),
        url=url,
        format=resource.get("format") or None,
        mimetype=resource.get("mimetype") or None,
        size=int(size) if isinstance(size, (int, str)) and str(size).isdigit() else None,
        published_hash=resource.get("hash") or None,
        metadata_modified=resource.get("metadata_modified"),
        checksum=checksum,
    )


def discover_bu_resource(client: JsonFetcher, *, year: int, turn: int, uf: str, portal: str = PORTAL_BASE) -> OpenDataBUResource:
    package = client.get_json(package_show_url(year, portal=portal))
    if not isinstance(package, dict):
        raise DiscoveryError("CKAN package_show returned a non-object payload")
    return select_bu_resource(package, year=year, turn=turn, uf=uf, portal=portal)
