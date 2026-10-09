"""Cadastro eleitoral genérico — totalmente offline.

Fixtures SINTÉTICAS em `fixtures/cadaster/` com o MESMO layout (cabeçalho,
Latin-1, `;`, aspas, CRLF, sentinelas) dos arquivos oficiais do TSE:

- `municipio_tse_ibge_XX_fixture.csv`: UF fictícia XX, três municípios
  (99999 e 99998 com cadastro; 99997 só território);
- `eleitorado_local_votacao_2099_XX.csv`: 99999 com UMA zona (9), 99998 com
  DUAS zonas (9 e 10) — a zona 9 é compartilhada entre os dois municípios,
  como acontece no Ceará real. Inclui linhas do 2º turno.

O cadastro do 99999/zona 9 é o mesmo de `fixtures/open-data/cadastro-ficticio.json`,
então o BU fictício reconcilia contra ele pelo caminho genérico.
"""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest

from urnai_ingest.cadaster.errors import CadasterError, CadasterMissing
from urnai_ingest.cadaster.polling_places import COORDINATES_SOURCE, parse_cadaster, zone_snapshot
from urnai_ingest.cadaster.sources import (
    KIND_POLLING_PLACES,
    CadasterResourceSpec,
    acquire_resource,
    extract_member,
    find_acquired,
    load_manifest,
    select_resource,
)
from urnai_ingest.cadaster.territories import assign_slugs, parse_territories, slugify
from urnai_ingest.cli import main
from urnai_ingest.open_data.ckan import DiscoveryError
from urnai_ingest.open_data.layout import LayoutError
from urnai_ingest.open_data.pipeline import prepare_import

from test_open_data_pipeline import CADASTRO, acquired

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "cadaster"
TERRITORIES = FIXTURES / "municipio_tse_ibge_XX_fixture.csv"
POLLING = FIXTURES / "eleitorado_local_votacao_2099_XX.csv"
POLLING_TEXT = POLLING.read_bytes().decode("latin-1")


def write(tmp_path: Path, text: str, name: str = "eleitorado_local_votacao_2099_XX.csv", encoding: str = "latin-1") -> Path:
    p = tmp_path / name
    p.write_bytes(text.encode(encoding))
    return p


def mutated(tmp_path: Path, old: str, new: str) -> Path:
    assert old in POLLING_TEXT, old
    return write(tmp_path, POLLING_TEXT.replace(old, new, 1))


def cadaster(path: Path = POLLING, **kw):
    return parse_cadaster(path, year=2099, turn=1, uf="XX", **kw)


# ---------------------------------------------------------------- território

def test_territories_are_identified_by_official_codes_not_names():
    t = parse_territories(TERRITORIES)
    assert t.generated_at == "01/01/2099 00:00:00"
    assert t.states["XX"].ibge_code == 99 and t.states["XX"].name == "Estado Fictício"
    m = t.municipality("xx", 99999)
    assert m and (m.tse_code, m.ibge_code, m.name, m.slug) == ("99999", 9900001, "Município Fictício", "municipio-ficticio")
    assert t.municipality("XX", "99997").slug == "aldeia-sem-cadastro"  # type: ignore[union-attr]


def test_slugs_are_deterministic_and_collisions_get_the_tse_code():
    assert slugify("General Sampaio") == "general-sampaio"
    assert slugify("Olho-d'Água do Borges") == "olho-d-agua-do-borges"
    assert slugify("  São  Luís ") == "sao-luis"
    slugs = assign_slugs([("XX", "00001", "Santa Fé"), ("XX", "00002", "Santa Fe"), ("YY", "00003", "Santa Fé"), ("XX", "00004", "Outra")])
    assert slugs == {("XX", "00001"): "santa-fe-00001", ("XX", "00002"): "santa-fe-00002", ("YY", "00003"): "santa-fe", ("XX", "00004"): "outra"}


def test_territories_reject_inconsistent_codes(tmp_path):
    text = TERRITORIES.read_bytes().decode("latin-1")
    with pytest.raises(CadasterError, match="does not belong"):
        parse_territories(write(tmp_path, text.replace('"9900002"', '"2304608"'), "t.csv"))
    with pytest.raises(CadasterError, match="mapped to two"):
        parse_territories(write(tmp_path, text.replace('"9900002"', '"9900001"'), "t2.csv"))
    with pytest.raises(CadasterError, match="5 digits"):
        parse_territories(write(tmp_path, text.replace('"99998"', '"9998"'), "t3.csv"))


# ---------------------------------------------------------------- cadastro

def test_cadaster_models_one_and_many_zones_generically():
    c = cadaster()
    assert (c.year, c.turn, c.uf, c.election_date) == (2099, 1, "XX", "2099-01-01")
    one, many = c.municipality(99999), c.municipality("99998")
    assert one and many
    assert sorted(one.zones) == [9]
    assert sorted(many.zones) == [9, 10]  # mesma zona 9 em dois municípios
    assert c.summary()["sections"] == 10 and c.summary()["aggregated_sections"] == 4
    assert c.rows_matching == 10  # linhas do 2º turno ignoradas


def test_aggregated_electorate_is_null_not_zero_and_principal_holds_the_urn():
    z = cadaster().municipality(99999).zones[9]  # type: ignore[union-attr]
    s1, s2 = z.sections[1], z.sections[2]
    assert (s1.is_aggregated, s1.eligible_federal, s1.eligible_state) == (False, 70, 70)
    assert (s2.is_aggregated, s2.principal_number, s2.eligible_federal, s2.eligible_state) == (True, 1, None, None)
    assert s2.section_electorate == 23  # outra medida, preservada como dado da fonte
    assert z.aggregated_of(1) == [2, 3] and z.aggregated_of(5) == [6]


def test_coordinates_only_when_the_official_source_publishes_them():
    z = cadaster().municipality(99999).zones[9]  # type: ignore[union-attr]
    assert (z.places["9001"].latitude, z.places["9001"].longitude) == (-4.0000001, -39.0000001)
    assert z.places["9001"].coordinates_source == COORDINATES_SOURCE
    assert z.places["9002"].latitude is None and z.places["9002"].coordinates_source is None  # -1 = não informado
    assert z.places["9002"].neighborhood is None  # #NULO


def test_out_of_range_coordinates_are_dropped_with_a_warning(tmp_path):
    c = cadaster(write(tmp_path, POLLING_TEXT.replace('"-4,0000001";"-39,0000001"', '"0";"0"')))  # todas as linhas do local
    assert c.municipality(99999).zones[9].places["9001"].latitude is None  # type: ignore[union-attr]
    assert c.warnings and c.warnings[0]["code"] == "invalid_coordinates"


def test_municipality_filter_and_missing_municipality(tmp_path):
    c = cadaster(municipalities=["99998"])
    assert list(c.municipalities) == ["99998"]
    with pytest.raises(CadasterMissing, match="no rows"):
        cadaster(municipalities=["99997"])


@pytest.mark.parametrize(
    ("old", "new", "message"),
    [
        ('"2";"Agregada";"1"', '"3";"Distribuída de ofício";"1"', "Distribuída de ofício"),
        ('"2";"Agregada";"1"', '"7";"Agregada";"1"', "undocumented"),
        ('"2";"Agregada";"1"', '"2";"Agregada";"-1"', "without a valid NR_SECAO_PRINCIPAL"),
        ('"2";"Agregada";"1"', '"2";"Agregada";"99"', "principal 99 not found"),
        ('"2";"Agregada";"1"', '"2";"Agregada";"3"', "is itself aggregated"),
        ('"23";"0";"0"', '"23";"23";"0"', "non-zero urn electorate"),
        ('"1";"ATIVO";"1";"Ativo"', '"2";"INATIVO";"1";"Ativo"', "interpretation decision"),
        ('"2099";"01/01/2099"', '"2098";"01/01/2099"', "AA_ELEICAO"),
        ('"RUA FICTÍCIA, 1"', '"RUA DIFERENTE"', "conflicting attributes"),
    ],
)
def test_cadaster_blocks_on_semantic_inconsistency(tmp_path, old, new, message):
    with pytest.raises(CadasterError, match=message):
        cadaster(mutated(tmp_path, old, new))


def test_duplicate_section_row_is_rejected(tmp_path):
    lines = POLLING_TEXT.split("\r\n")
    with pytest.raises(CadasterError, match="duplicate section"):
        cadaster(write(tmp_path, "\r\n".join(lines[:2] + [lines[1]] + lines[2:])))


def test_layout_and_encoding_are_enforced(tmp_path):
    with pytest.raises(LayoutError, match="header"):
        cadaster(write(tmp_path, POLLING_TEXT.replace("NR_SECAO_PRINCIPAL", "NR_SECAO_PRINC"), "h.csv"))
    with pytest.raises(LayoutError, match="UTF-8"):
        cadaster(write(tmp_path, POLLING_TEXT, "u.csv", encoding="utf-8"))
    with pytest.raises(CadasterError, match="truncated"):
        cadaster(write(tmp_path, POLLING_TEXT.rsplit(";", 3)[0] + "\r\n", "t.csv"))


def test_zone_snapshot_drives_the_bu_reconciliation(tmp_path):
    snap = zone_snapshot(cadaster(), 99999, 9)
    legacy = json.loads(CADASTRO.read_text(encoding="utf-8"))
    pick = lambda s: {k: s.get(k) for k in ("number", "principal_number", "polling_place_code", "is_aggregated", "aggregated_sections")}  # noqa: E731
    assert [pick(s) for s in snap["sections"]] == [pick(s) for s in legacy["sections"]]  # type: ignore[index]
    a = acquired(tmp_path)
    prepared = prepare_import(a.manifest_path, municipality=99999, zone=9, cadastro=snap)
    assert prepared.reconciliation.aggregated_sections == {1: [2, 3], 5: [6]}


def test_cadaster_missing_is_explicit():
    with pytest.raises(CadasterMissing):
        zone_snapshot(cadaster(), 99997, 9)


# ---------------------------------------------------------------- fontes

URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2099.zip"


def package(url: str = URL, extra: list[dict] | None = None) -> dict:
    resources = [
        {"id": "r-pp", "name": "Eleitorado por local de votação - 2099", "url": url, "format": "CSV", "state": "active"},
        {"id": "r-perfil", "name": "Eleitorado - 2099", "url": URL.replace("locais", "perfil"), "format": "CSV", "state": "active"},
    ]
    return {"success": True, "result": {"id": "pkg", "name": "eleitorado-2099", "title": "Eleitorado - 2099",
                                        "organization": {"name": "tse-agel"}, "resources": resources + (extra or [])}}


class FakeSource:
    def __init__(self, data: bytes) -> None:
        self.data = data

    def stream(self, url: str):
        assert url == URL
        yield self.data

    def text(self, url: str) -> str:  # pragma: no cover
        raise AssertionError


def make_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:  # data fixa ⇒ bytes determinísticos
        for name, data in (("eleitorado_local_votacao_2099_XX.csv", POLLING.read_bytes()),
                           ("eleitorado_local_votacao_2099_YY.csv", b"outra UF"), ("leiame.pdf", b"%PDF fictitious")):
            z.writestr(zipfile.ZipInfo(name, date_time=(2099, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)
    return buf.getvalue()


def acquire(tmp_path: Path):
    resource = select_resource(package(), CadasterResourceSpec.polling_places(2099))
    return acquire_resource(resource, tmp_path / "cadaster", source=FakeSource(make_zip()), now=lambda: "2099-01-03T00:00:00+00:00")


def test_discovery_uses_ckan_metadata_and_official_hosts():
    r = select_resource(package(), CadasterResourceSpec.polling_places(2099))
    assert (r.resource_id, r.kind, r.url) == ("r-pp", KIND_POLLING_PLACES, URL)
    with pytest.raises(DiscoveryError, match="official"):
        select_resource(package("https://mirror.example.com/x.zip"), CadasterResourceSpec.polling_places(2099))
    with pytest.raises(DiscoveryError, match="exactly one"):
        select_resource(package(extra=[{"id": "dup", "name": "Eleitorado por local de votação - 2099", "url": URL}]),
                        CadasterResourceSpec.polling_places(2099))


def test_acquisition_records_that_no_checksum_is_published(tmp_path):
    a = acquire(tmp_path)
    z = make_zip()
    assert a.directory.name == hashlib.sha256(z).hexdigest()
    assert a.manifest["official_checksum"]["status"] == "not_published"  # nunca finge verificação
    assert a.manifest["zip"]["sha512"] == hashlib.sha512(z).hexdigest()
    assert acquire(tmp_path).reused
    m = load_manifest(a.directory, kind=KIND_POLLING_PLACES)
    member = extract_member(m, r".*_2099_XX\.csv")
    assert member["sha256"] == hashlib.sha256(POLLING.read_bytes()).hexdigest()
    assert find_acquired(tmp_path / "cadaster", kind=KIND_POLLING_PLACES, year=2099) == a.directory


# ---------------------------------------------------------------- CLI

def test_cli_dry_run_reconciles_every_zone_from_the_official_cadaster(tmp_path, capsys):
    a = acquire(tmp_path)
    bu = acquired(tmp_path / "bu")
    code = main(["import-open-data-bu", str(bu.directory), "--municipality", "99999", "--dry-run", "--cadaster-dir", str(a.directory.parent)])
    assert code == 0
    reports = json.loads(capsys.readouterr().out)
    assert [r["scope"]["zone"] for r in reports] == [9]  # zona omitida ⇒ todas as zonas do cadastro
    assert reports[0]["sections"]["aggregation"] == {"1": [2, 3], "5": [6]}


def test_cli_answers_cadaster_missing_instead_of_inferring(tmp_path, capsys, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    a = acquire(tmp_path)
    bu = acquired(tmp_path / "bu")
    # 99997 existe no território, mas não tem cadastro eleitoral
    code = main(["import-open-data-bu", str(bu.directory), "--municipality", "99997", "--dry-run", "--cadaster-dir", str(a.directory.parent)])
    assert code == 3
    assert json.loads(capsys.readouterr().out)["status"] == "cadaster_missing"
