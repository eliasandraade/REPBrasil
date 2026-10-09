"""Descoberta (CKAN) e aquisição auditável dos arquivos oficiais do cadastro.

Mesmo princípio do pipeline do BU (`open_data/ckan.py`, `open_data/acquire.py`):
recurso escolhido pelos metadados oficiais do Portal de Dados Abertos do TSE,
host oficial obrigatório, download em streaming com SHA-256/SHA-512 e
persistência content-addressed `<out>/<sha256>/source.zip` + `manifest.json`.

Diferença: o TSE NÃO publica checksum para estes datasets. O manifesto registra
`official_checksum.status = "not_published"` — nunca finge verificação. Se o
CKAN declarar tamanho ou hash, eles são conferidos.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import unicodedata
import zipfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from ..open_data.acquire import AcquisitionError, StreamSource
from ..open_data.ckan import PORTAL_BASE, DiscoveryError, JsonFetcher, _official_url

MANIFEST_VERSION = 1
_CHUNK = 1 << 20

KIND_POLLING_PLACES = "tse-open-data-polling-places"
KIND_MUNICIPALITY_CODES = "tse-open-data-municipality-codes"


def _norm(s: str) -> str:
    return unicodedata.normalize("NFC", s).strip()


@dataclass(frozen=True)
class CadasterResourceSpec:
    kind: str
    dataset: str
    resource_name: str

    @classmethod
    def polling_places(cls, year: int) -> "CadasterResourceSpec":
        return cls(KIND_POLLING_PLACES, f"eleitorado-{year}", f"Eleitorado por local de votação - {year}")

    @classmethod
    def municipality_codes(cls) -> "CadasterResourceSpec":
        return cls(
            KIND_MUNICIPALITY_CODES,
            "codigos-oficiais-de-uf-e-municipios-segundo-o-tse-e-o-ibge",
            "Códigos oficiais de UF e municípios segundo o TSE e o IBGE",
        )


@dataclass(frozen=True)
class CadasterResource:
    kind: str
    portal: str
    dataset_name: str
    dataset_id: str
    dataset_title: str
    dataset_metadata_modified: str | None
    organization: str | None
    resource_id: str
    resource_name: str
    url: str
    format: str | None
    size: int | None
    published_hash: str | None
    metadata_modified: str | None
    last_modified: str | None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def package_show_url(dataset: str, *, portal: str = PORTAL_BASE) -> str:
    return f"{portal}/api/3/action/package_show?id={dataset}"


def select_resource(package: dict[str, Any], spec: CadasterResourceSpec, *, portal: str = PORTAL_BASE) -> CadasterResource:
    if package.get("success") is not True or not isinstance(package.get("result"), dict):
        raise DiscoveryError("CKAN package_show did not return success")
    result = package["result"]
    if result.get("name") != spec.dataset:
        raise DiscoveryError(f"unexpected dataset {result.get('name')!r}; expected {spec.dataset!r}")
    matches = [
        r for r in result.get("resources", [])
        if r.get("state", "active") == "active" and _norm(str(r.get("name", ""))) == _norm(spec.resource_name)
    ]
    if len(matches) != 1:
        raise DiscoveryError(f"expected exactly one resource named {spec.resource_name!r} in {spec.dataset}, found {len(matches)}")
    resource = matches[0]
    url = _official_url(str(resource.get("url", "")))
    if not urlparse(url).path.lower().endswith(".zip"):
        raise DiscoveryError(f"cadaster resource is not a ZIP: {url}")
    size = resource.get("size")
    org = result.get("organization") or {}
    return CadasterResource(
        kind=spec.kind,
        portal=portal,
        dataset_name=spec.dataset,
        dataset_id=str(result.get("id")),
        dataset_title=str(result.get("title")),
        dataset_metadata_modified=result.get("metadata_modified"),
        organization=org.get("name") if isinstance(org, dict) else None,
        resource_id=str(resource["id"]),
        resource_name=_norm(str(resource["name"])),
        url=url,
        format=resource.get("format") or None,
        size=int(size) if isinstance(size, (int, str)) and str(size).isdigit() else None,
        published_hash=resource.get("hash") or None,
        metadata_modified=resource.get("metadata_modified"),
        last_modified=resource.get("last_modified"),
    )


def discover_resource(client: JsonFetcher, spec: CadasterResourceSpec, *, portal: str = PORTAL_BASE) -> CadasterResource:
    package = client.get_json(package_show_url(spec.dataset, portal=portal))
    if not isinstance(package, dict):
        raise DiscoveryError("CKAN package_show returned a non-object payload")
    return select_resource(package, spec, portal=portal)


@dataclass(frozen=True)
class AcquiredCadaster:
    directory: Path
    zip_path: Path
    manifest_path: Path
    manifest: dict[str, Any]
    reused: bool


def _published_hash(value: str | None) -> tuple[str, str] | None:
    if not value:
        return None
    v = value.strip().lower().split(":")[-1]
    if re.fullmatch(r"[0-9a-f]{64}", v):
        return ("sha256", v)
    if re.fullmatch(r"[0-9a-f]{128}", v):
        return ("sha512", v)
    return None


def acquire_resource(
    resource: CadasterResource,
    out_dir: Path,
    *,
    source: StreamSource,
    now: Callable[[], str] = lambda: datetime.now(UTC).isoformat(),
) -> AcquiredCadaster:
    zip_name = Path(urlparse(resource.url).path).name
    out_dir.mkdir(parents=True, exist_ok=True)
    sha256, sha512, size = hashlib.sha256(), hashlib.sha512(), 0
    fd, tmp_name = tempfile.mkstemp(prefix=".download-", suffix=".zip", dir=out_dir)
    tmp = Path(tmp_name)
    downloaded_at = now()
    try:
        with os.fdopen(fd, "wb") as fh:
            for chunk in source.stream(resource.url):
                sha256.update(chunk)
                sha512.update(chunk)
                size += len(chunk)
                fh.write(chunk)
        computed = {"sha256": sha256.hexdigest(), "sha512": sha512.hexdigest()}
        if resource.size is not None and resource.size != size:
            raise AcquisitionError(f"size mismatch: downloaded {size}, metadata declares {resource.size}")
        published = _published_hash(resource.published_hash)
        if published and computed[published[0]] != published[1]:
            raise AcquisitionError(f"{published[0]} mismatch with the CKAN resource hash")
        try:
            with zipfile.ZipFile(tmp) as zf:
                bad = zf.testzip()
                members = [{"name": i.filename, "size": i.file_size, "crc": f"{i.CRC:08x}"} for i in zf.infolist()]
        except zipfile.BadZipFile as exc:
            raise AcquisitionError(f"downloaded file is not a valid ZIP: {exc}") from exc
        if bad is not None:
            raise AcquisitionError(f"ZIP member {bad} failed its CRC check")

        directory = out_dir / computed["sha256"]
        manifest_path = directory / "manifest.json"
        if manifest_path.exists():
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            if existing["zip"]["sha256"] != computed["sha256"]:
                raise AcquisitionError(f"content-addressed directory {directory} holds a different artifact")
            tmp.unlink(missing_ok=True)
            return AcquiredCadaster(directory, directory / "source.zip", manifest_path, existing, True)
        directory.mkdir(parents=True, exist_ok=True)
        zip_path = directory / "source.zip"
        os.replace(tmp, zip_path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    manifest: dict[str, Any] = {
        "manifest_version": MANIFEST_VERSION,
        "kind": resource.kind,
        "source": {
            "portal": resource.portal,
            "dataset": resource.dataset_name,
            "dataset_id": resource.dataset_id,
            "dataset_title": resource.dataset_title,
            "organization": resource.organization,
            "resource_id": resource.resource_id,
            "resource_name": resource.resource_name,
            "url": resource.url,
            "format": resource.format,
            "metadata_modified": resource.metadata_modified,
            "last_modified": resource.last_modified,
            "dataset_metadata_modified": resource.dataset_metadata_modified,
            "published_size": resource.size,
            "published_hash": resource.published_hash,
        },
        "downloaded_at": downloaded_at,
        "zip": {"name": zip_name, "size": size, "sha256": computed["sha256"], "sha512": computed["sha512"]},
        "official_checksum": (
            {"status": "verified", "algorithm": published[0], "value": published[1], "source": "ckan resource hash"}
            if published
            else {"status": "not_published", "note": "the TSE does not publish a checksum for this dataset; only the computed hashes are recorded"}
        ),
        "zip_members": members,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return AcquiredCadaster(directory, zip_path, manifest_path, manifest, False)


def load_manifest(path: Path, *, kind: str) -> dict[str, Any]:
    manifest_path = path / "manifest.json" if path.is_dir() else path
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("kind") != kind:
        raise AcquisitionError(f"{manifest_path} is a {manifest.get('kind')!r} manifest, expected {kind!r}")
    manifest["_directory"] = str(manifest_path.parent)
    return manifest


def find_acquired(root: Path, *, kind: str, year: int | None = None) -> Path:
    """Único diretório adquirido do tipo pedido sob `root` (ambíguo ⇒ erro explícito)."""
    found: list[Path] = []
    if root.is_dir():
        for manifest_path in sorted(root.glob("*/manifest.json")):
            m = json.loads(manifest_path.read_text(encoding="utf-8"))
            if m.get("kind") != kind:
                continue
            if year is not None and str(year) not in m["source"]["dataset"]:
                continue
            found.append(manifest_path.parent)
    if len(found) != 1:
        raise AcquisitionError(
            f"expected exactly one acquired {kind} under {root}{f' for {year}' if year else ''}, found {len(found)}; pass the directory explicitly"
        )
    return found[0]


def extract_member(manifest: dict[str, Any], pattern: str) -> dict[str, Any]:
    """Extrai (uma vez) o membro do ZIP cujo nome casa com `pattern`; devolve nome, tamanho, SHA-256 e caminho."""
    directory = Path(manifest["_directory"])
    regex = re.compile(pattern)
    names = [m["name"] for m in manifest["zip_members"] if regex.fullmatch(m["name"])]
    if len(names) != 1:
        raise AcquisitionError(f"expected exactly one ZIP member matching {pattern!r}, found {names}")
    name = names[0]
    target = directory / "extracted" / name
    digest = hashlib.sha256()
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(target.suffix + ".part")
        with zipfile.ZipFile(directory / "source.zip") as zf, zf.open(name) as src, tmp.open("wb") as dst:
            while chunk := src.read(_CHUNK):  # zipfile confere o CRC ao final
                digest.update(chunk)
                dst.write(chunk)
        os.replace(tmp, target)
    else:
        with target.open("rb") as fh:
            while chunk := fh.read(_CHUNK):
                digest.update(chunk)
    expected = next(m for m in manifest["zip_members"] if m["name"] == name)
    if target.stat().st_size != expected["size"]:
        raise AcquisitionError(f"extracted {name} size differs from the ZIP directory")
    return {"name": name, "size": expected["size"], "sha256": digest.hexdigest(), "path": target}
