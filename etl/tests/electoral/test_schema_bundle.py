from __future__ import annotations

import json
import stat
import zipfile
from pathlib import Path

import pytest

from urnai_ingest.schema_bundle import (
    OFFICIAL_2026_SCHEMA_URL,
    SchemaBundleError,
    inspect_schema_bundle,
    persist_schema_bundle,
)


def write_zip(path: Path, members: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return path


def test_inspects_and_persists_content_addressed_bundle(tmp_path: Path) -> None:
    source = write_zip(
        tmp_path / "official.zip",
        {
            "spec/bu.asn1": b"BU DEFINITIONS ::= BEGIN\nEND\n",
            "README.txt": b"official package fixture\n",
        },
    )

    sha256, members = inspect_schema_bundle(source)
    assert len(sha256) == 64
    assert [member.path for member in members] == ["spec/bu.asn1", "README.txt"]
    assert [member.path for member in members if member.asn1_candidate] == ["spec/bu.asn1"]

    persisted = persist_schema_bundle(source, tmp_path / "artifacts")
    assert persisted.directory.name == sha256
    assert persisted.zip_path.read_bytes() == source.read_bytes()
    assert (persisted.extracted_dir / "spec" / "bu.asn1").read_bytes().startswith(b"BU DEFINITIONS")

    manifest = json.loads(persisted.manifest_path.read_text(encoding="utf-8"))
    assert manifest["source_url"] == OFFICIAL_2026_SCHEMA_URL
    assert manifest["acquisition"] == "manual-official-download"
    assert manifest["zip_sha256"] == sha256
    assert manifest["asn1_candidates"] == ["spec/bu.asn1"]
    assert manifest["root_type"] is None
    assert manifest["members"][0]["sha256"] == members[0].sha256


def test_is_idempotent_for_the_same_zip(tmp_path: Path) -> None:
    source = write_zip(tmp_path / "official.zip", {"bu.asn": b"X DEFINITIONS ::= BEGIN\nEND\n"})
    first = persist_schema_bundle(source, tmp_path / "artifacts")
    second = persist_schema_bundle(source, tmp_path / "artifacts")
    assert first.directory == second.directory
    assert first.zip_path.read_bytes() == second.zip_path.read_bytes()


def test_rejects_path_traversal(tmp_path: Path) -> None:
    source = write_zip(tmp_path / "evil.zip", {"../outside.asn1": b"nope"})
    with pytest.raises(SchemaBundleError, match="unsafe ZIP member path"):
        inspect_schema_bundle(source)


def test_rejects_symlink_members(tmp_path: Path) -> None:
    source = tmp_path / "symlink.zip"
    info = zipfile.ZipInfo("link.asn1")
    info.create_system = 3
    info.external_attr = (stat.S_IFLNK | 0o777) << 16
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr(info, "target")

    with pytest.raises(SchemaBundleError, match="symbolic links"):
        inspect_schema_bundle(source)


def test_rejects_duplicate_members(tmp_path: Path) -> None:
    source = tmp_path / "duplicate.zip"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("same.asn1", b"one")
        archive.writestr("same.asn1", b"two")

    with pytest.raises(SchemaBundleError, match="duplicate ZIP member"):
        inspect_schema_bundle(source)


def test_rejects_non_zip_and_empty_zip(tmp_path: Path) -> None:
    broken = tmp_path / "not.zip"
    broken.write_bytes(b"not a zip")
    with pytest.raises(SchemaBundleError, match="valid ZIP"):
        inspect_schema_bundle(broken)

    empty = tmp_path / "empty.zip"
    with zipfile.ZipFile(empty, "w"):
        pass
    with pytest.raises(SchemaBundleError, match="empty"):
        inspect_schema_bundle(empty)
