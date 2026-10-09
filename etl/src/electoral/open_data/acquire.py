"""Aquisição auditável do ZIP oficial do Boletim de Urna (Dados Abertos TSE).

- Download em streaming (o ZIP estadual tem centenas de MB; nada é carregado
  inteiro em memória) com SHA-256 e SHA-512 calculados durante a transferência.
- Conferência contra o checksum OFICIAL publicado no recurso irmão
  (`.zip.sha512`). Divergência aborta e descarta o arquivo.
- Persistência content-addressed: `<out>/<sha256-do-zip>/source.zip`,
  `manifest.json` e `extracted/<csv>`. Uma nova versão do TSE gera outro
  diretório; nada é sobrescrito silenciosamente.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

from .ckan import OpenDataBUResource

MANIFEST_VERSION = 1
_CHUNK = 1 << 20


class AcquisitionError(RuntimeError):
    """Download, checksum ou conteúdo do ZIP inválidos."""


class StreamSource(Protocol):
    def stream(self, url: str) -> Iterator[bytes]: ...
    def text(self, url: str) -> str: ...


class HttpStreamSource:
    """Cliente mínimo para arquivos grandes. Sem retries agressivos."""

    def __init__(self, client: httpx.Client | None = None, *, attempts: int = 3) -> None:
        self.client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0), follow_redirects=True)
        self.attempts = attempts

    def close(self) -> None:
        self.client.close()

    def stream(self, url: str) -> Iterator[bytes]:
        with self.client.stream("GET", url) as response:
            if response.status_code != 200:
                raise AcquisitionError(f"HTTP {response.status_code} for {url}")
            yield from response.iter_bytes(_CHUNK)

    def text(self, url: str) -> str:
        last: Exception | None = None
        for _ in range(self.attempts):
            try:
                response = self.client.get(url)
            except httpx.HTTPError as exc:
                last = exc
                continue
            if response.status_code != 200:
                raise AcquisitionError(f"HTTP {response.status_code} for {url}")
            return response.text
        raise AcquisitionError(f"failed to fetch {url}") from last


def parse_checksum_file(text: str, *, algorithm: str, expected_filename: str) -> str:
    """Lê um arquivo no formato `<hex>  <arquivo>` (sha512sum/sha256sum)."""
    size = {"sha256": 64, "sha512": 128}[algorithm]
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) != 1:
        raise AcquisitionError(f"official checksum file must contain exactly one line, found {len(lines)}")
    match = re.fullmatch(rf"(?P<hex>[0-9a-fA-F]{{{size}}})\s+\*?(?P<name>\S+)", lines[0])
    if not match:
        raise AcquisitionError("official checksum file is not in '<hex>  <filename>' format")
    if match["name"] != expected_filename:
        raise AcquisitionError(f"official checksum refers to {match['name']!r}, expected {expected_filename!r}")
    return match["hex"].lower()


@dataclass(frozen=True)
class AcquiredOpenDataBU:
    directory: Path
    zip_path: Path
    csv_path: Path
    manifest_path: Path
    manifest: dict[str, Any]
    reused: bool


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _single_csv(archive: zipfile.ZipFile) -> zipfile.ZipInfo:
    csvs = [info for info in archive.infolist() if info.filename.lower().endswith(".csv")]
    if len(csvs) != 1:
        raise AcquisitionError(f"expected exactly one CSV inside the ZIP, found {len(csvs)}")
    if "/" in csvs[0].filename or "\\" in csvs[0].filename or csvs[0].filename.startswith("."):
        raise AcquisitionError(f"unsafe CSV member name: {csvs[0].filename!r}")
    return csvs[0]


def extract_csv(zip_path: Path, target_dir: Path) -> dict[str, Any]:
    """Extrai o único CSV do ZIP em streaming, verificando CRC e hash."""
    target_dir.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path) as archive:
            info = _single_csv(archive)
            members = [{"name": i.filename, "size": i.file_size, "compressed_size": i.compress_size} for i in archive.infolist()]
            digest = hashlib.sha256()
            size = 0
            tmp = target_dir / f".{info.filename}.partial"
            with archive.open(info) as src, tmp.open("wb") as dst:
                while chunk := src.read(_CHUNK):  # zipfile valida CRC ao fim: arquivo truncado falha aqui
                    digest.update(chunk)
                    size += len(chunk)
                    dst.write(chunk)
    except zipfile.BadZipFile as exc:
        raise AcquisitionError(f"invalid or truncated ZIP: {exc}") from exc
    if size != info.file_size:
        raise AcquisitionError(f"CSV size mismatch: read {size}, ZIP declares {info.file_size}")
    final = target_dir / info.filename
    os.replace(tmp, final)
    return {"name": info.filename, "size": size, "sha256": digest.hexdigest(), "zip_members": members}


def acquire_bu_resource(
    resource: OpenDataBUResource,
    out_dir: Path,
    *,
    source: StreamSource,
    now: Callable[[], str] = _now,
) -> AcquiredOpenDataBU:
    if resource.checksum is None:
        raise AcquisitionError("no official checksum resource published; refusing to acquire without verification")
    zip_name = Path(urlparse(resource.url).path).name
    official = parse_checksum_file(
        source.text(resource.checksum.url), algorithm=resource.checksum.algorithm, expected_filename=zip_name
    )

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
        if computed[resource.checksum.algorithm] != official:
            raise AcquisitionError(
                f"{resource.checksum.algorithm} mismatch: computed {computed[resource.checksum.algorithm]}, official {official}"
            )
        if resource.size is not None and resource.size != size:
            raise AcquisitionError(f"size mismatch: downloaded {size}, metadata declares {resource.size}")

        directory = out_dir / computed["sha256"]
        manifest_path = directory / "manifest.json"
        if manifest_path.exists():
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            if existing["zip"]["sha256"] != computed["sha256"]:
                raise AcquisitionError(f"content-addressed directory {directory} holds a different artifact")
            tmp.unlink(missing_ok=True)
            return AcquiredOpenDataBU(
                directory, directory / "source.zip", directory / "extracted" / existing["csv"]["name"], manifest_path, existing, True
            )

        directory.mkdir(parents=True, exist_ok=True)
        zip_path = directory / "source.zip"
        os.replace(tmp, zip_path)
        csv_info = extract_csv(zip_path, directory / "extracted")
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    manifest: dict[str, Any] = {
        "manifest_version": MANIFEST_VERSION,
        "kind": "tse-open-data-bu",
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
            "mimetype": resource.mimetype,
            "metadata_modified": resource.metadata_modified,
            "dataset_metadata_modified": resource.dataset_metadata_modified,
            "published_size": resource.size,
            "published_hash": resource.published_hash,
        },
        "scope": {"year": resource.year, "turn": resource.turn, "uf": resource.uf, "resource_name_date": resource.resource_name_date},
        "downloaded_at": downloaded_at,
        "zip": {"name": zip_name, "size": size, "sha256": computed["sha256"], "sha512": computed["sha512"]},
        "official_checksum": {
            "resource_id": resource.checksum.resource_id,
            "resource_name": resource.checksum.name,
            "url": resource.checksum.url,
            "algorithm": resource.checksum.algorithm,
            "value": official,
            "verified": True,
        },
        "csv": {k: csv_info[k] for k in ("name", "size", "sha256")},
        "zip_members": csv_info["zip_members"],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return AcquiredOpenDataBU(directory, zip_path, directory / "extracted" / csv_info["name"], manifest_path, manifest, False)


def load_manifest(path: Path) -> tuple[dict[str, Any], Path]:
    """Lê um manifest (ou diretório) e devolve o caminho do CSV verificado."""
    manifest_path = path / "manifest.json" if path.is_dir() else path
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("kind") != "tse-open-data-bu":
        raise AcquisitionError(f"{manifest_path} is not an open-data BU manifest")
    csv_path = manifest_path.parent / "extracted" / manifest["csv"]["name"]
    if not csv_path.exists():
        raise AcquisitionError(f"extracted CSV missing: {csv_path}")
    return manifest, csv_path


def verify_file_sha256(path: Path, expected: str) -> None:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(_CHUNK):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise AcquisitionError(f"{path.name}: sha256 {digest.hexdigest()} does not match manifest {expected}")
