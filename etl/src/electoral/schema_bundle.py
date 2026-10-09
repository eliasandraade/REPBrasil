from __future__ import annotations

import hashlib
import json
import shutil
import stat
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


OFFICIAL_2026_SCHEMA_URL = (
    "https://www.tse.jus.br/eleicoes/eleicoes-2026-content/arquivos/"
    "formato-arquivos-de-bu-rdv-e-assinatura-digital"
)

ASN1_SUFFIXES = {".asn", ".asn1"}


class SchemaBundleError(ValueError):
    pass


@dataclass(frozen=True)
class SchemaBundleMember:
    path: str
    size: int
    sha256: str
    asn1_candidate: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "path": self.path,
            "size": self.size,
            "sha256": self.sha256,
            "asn1_candidate": self.asn1_candidate,
        }


@dataclass(frozen=True)
class PersistedSchemaBundle:
    directory: Path
    zip_path: Path
    manifest_path: Path
    extracted_dir: Path


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _safe_member_path(name: str) -> PurePosixPath:
    candidate = PurePosixPath(name.replace("\\", "/"))
    if candidate.is_absolute() or not candidate.parts:
        raise SchemaBundleError(f"unsafe ZIP member path: {name!r}")
    if any(part in {"", ".", ".."} for part in candidate.parts):
        raise SchemaBundleError(f"unsafe ZIP member path: {name!r}")
    return candidate


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = info.external_attr >> 16
    return stat.S_ISLNK(mode)


def inspect_schema_bundle(zip_path: Path) -> tuple[str, list[SchemaBundleMember]]:
    """Validate a locally obtained official ZIP without trusting its paths.

    This function does not infer an ASN.1 root type and does not decode BU files.
    It only establishes a reproducible inventory and content hashes.
    """

    payload = zip_path.read_bytes()
    bundle_sha256 = _sha256_bytes(payload)
    members: list[SchemaBundleMember] = []
    seen: set[str] = set()

    try:
        archive = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as exc:
        raise SchemaBundleError("schema bundle is not a valid ZIP file") from exc

    with archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            if _is_symlink(info):
                raise SchemaBundleError(f"symbolic links are not allowed in schema bundle: {info.filename!r}")
            safe = _safe_member_path(info.filename)
            normalized = safe.as_posix()
            if normalized in seen:
                raise SchemaBundleError(f"duplicate ZIP member: {normalized!r}")
            seen.add(normalized)
            data = archive.read(info)
            if len(data) != info.file_size:
                raise SchemaBundleError(f"size mismatch while reading ZIP member: {normalized!r}")
            members.append(
                SchemaBundleMember(
                    path=normalized,
                    size=len(data),
                    sha256=_sha256_bytes(data),
                    asn1_candidate=safe.suffix.lower() in ASN1_SUFFIXES,
                )
            )

    if not members:
        raise SchemaBundleError("schema bundle ZIP is empty")
    return bundle_sha256, members


def persist_schema_bundle(
    zip_path: Path,
    out_dir: Path,
    *,
    source_url: str = OFFICIAL_2026_SCHEMA_URL,
) -> PersistedSchemaBundle:
    """Persist an official schema ZIP content-addressed with an audit manifest.

    The caller is responsible for obtaining the ZIP through the official TSE UI.
    We deliberately do not bypass portal download protections.
    """

    bundle_sha256, members = inspect_schema_bundle(zip_path)
    directory = out_dir / bundle_sha256
    saved_zip = directory / "source.zip"
    extracted = directory / "bundle"
    manifest_path = directory / "manifest.json"

    directory.mkdir(parents=True, exist_ok=True)
    extracted.mkdir(parents=True, exist_ok=True)

    if saved_zip.exists():
        existing_sha = _sha256_bytes(saved_zip.read_bytes())
        if existing_sha != bundle_sha256:
            raise SchemaBundleError("content-addressed schema path contains a different ZIP")
    else:
        shutil.copyfile(zip_path, saved_zip)

    with zipfile.ZipFile(saved_zip) as archive:
        for member in members:
            target = extracted / PurePosixPath(member.path)
            target.parent.mkdir(parents=True, exist_ok=True)
            data = archive.read(member.path)
            if _sha256_bytes(data) != member.sha256:
                raise SchemaBundleError(f"member hash changed during extraction: {member.path!r}")
            target.write_bytes(data)

    manifest = {
        "kind": "tse-2026-bu-rdv-schema-bundle",
        "source_url": source_url,
        "acquisition": "manual-official-download",
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        "zip_sha256": bundle_sha256,
        "zip_size": saved_zip.stat().st_size,
        "member_count": len(members),
        "asn1_candidates": [member.path for member in members if member.asn1_candidate],
        "members": [member.as_dict() for member in members],
        "root_type": None,
        "note": "No ASN.1 root type is inferred. Confirm it from the official schema before decoding BU files.",
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return PersistedSchemaBundle(
        directory=directory,
        zip_path=saved_zip,
        manifest_path=manifest_path,
        extracted_dir=extracted,
    )
