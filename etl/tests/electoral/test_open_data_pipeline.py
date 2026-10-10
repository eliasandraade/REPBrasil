"""Pipeline histórico (Dados Abertos TSE) — totalmente offline.

Fixture `fixtures/open-data/bweb_1t_XX_fixture.csv`: MESMO cabeçalho, encoding
(Latin-1), separador e sentinelas do arquivo oficial, com dados FICTÍCIOS
(UF XX, município 99999, eleições 999001/999002). Nenhum resultado real.
"""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest

from src.electoral.ea20 import EA20Result
from src.electoral.open_data.acquire import (
    AcquisitionError,
    acquire_bu_resource,
    parse_checksum_file,
)
from src.electoral.open_data.ckan import DiscoveryError, select_bu_resource
from src.electoral.open_data.ea20_check import validate_against_ea20
from src.electoral.open_data.layout import COLUMNS, LayoutError, detect_layout
from src.electoral.open_data.parser import (
    RowError,
    ScanStats,
    aggregated_sections,
    number,
    parse_row,
    row_hash,
    scan,
)
from src.electoral.open_data.pipeline import prepare_import
from src.electoral.open_data.results import ConsistencyError

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "open-data"
CSV_BYTES = (FIXTURES / "bweb_1t_XX_fixture.csv").read_bytes()
CADASTRO = FIXTURES / "cadastro-ficticio.json"
ZIP_NAME = "bweb_1t_XX_010120990000.zip"
URL = f"https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2099/buweb/{ZIP_NAME}"
FIXED_ZIP_TIME = (2099, 1, 1, 0, 0, 0)


# ---------------------------------------------------------------- helpers

def make_zip(csv_bytes: bytes = CSV_BYTES, name: str = "bweb_1t_XX_010120990000.csv") -> bytes:
    buf = io.BytesIO()
    # data fixa: ZipFile.writestr(nome) grava o relógio atual, e dois ZIPs "iguais" criados em
    # segundos diferentes teriam SHA-256 diferentes (o teste de idempotência ficava intermitente)
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo(name, date_time=FIXED_ZIP_TIME), csv_bytes, zipfile.ZIP_DEFLATED)
        z.writestr(zipfile.ZipInfo("_leiame-boletimurnaweb.pdf", date_time=FIXED_ZIP_TIME), b"%PDF fictitious", zipfile.ZIP_DEFLATED)
    return buf.getvalue()


def package(*, extra: list[dict] | None = None, hash_url: str | None = None) -> dict:
    resources = [
        {"id": "r-data", "name": "XX - Boletim de Urna - Primeiro turno - 01.01.2099", "format": "CSV",
         "mimetype": "application/zip", "size": None, "hash": "", "url": URL, "state": "active", "metadata_modified": "2099-01-01T00:00:00"},
        {"id": "r-hash", "name": "XX - Hash SHA2 - Primeiro turno - 01.01.2099", "format": "",
         "url": hash_url or URL + ".sha512", "state": "active"},
        {"id": "r-other", "name": "YY - Boletim de Urna - Primeiro turno - 01.01.2099", "format": "CSV",
         "url": URL.replace("XX", "YY"), "state": "active"},
    ]
    return {"success": True, "result": {"id": "pkg", "name": "resultados-2099-boletim-de-urna", "title": "Fictício",
                                        "organization": {"name": "tse-agel"}, "resources": resources + (extra or [])}}


class FakeSource:
    def __init__(self, zip_bytes: bytes, checksum_text: str) -> None:
        self.zip_bytes, self.checksum_text = zip_bytes, checksum_text

    def stream(self, url: str):
        assert url == URL
        for i in range(0, len(self.zip_bytes), 1000):
            yield self.zip_bytes[i : i + 1000]

    def text(self, url: str) -> str:
        assert url == URL + ".sha512"
        return self.checksum_text


def acquired(tmp_path: Path, csv_bytes: bytes = CSV_BYTES):
    z = make_zip(csv_bytes)
    resource = select_bu_resource(package(), year=2099, turn=1, uf="XX")
    source = FakeSource(z, f"{hashlib.sha512(z).hexdigest()}  {ZIP_NAME}\n")
    return acquire_bu_resource(resource, tmp_path / "out", source=source, now=lambda: "2099-01-02T00:00:00+00:00")


def prepared(tmp_path: Path, csv_bytes: bytes = CSV_BYTES, **kwargs):
    a = acquired(tmp_path, csv_bytes)
    return prepare_import(a.manifest_path, municipality=99999, zone=9, cadastro_path=kwargs.pop("cadastro", CADASTRO), **kwargs)


def mutate(old: str, new: str, count: int = 1) -> bytes:
    text = CSV_BYTES.decode("latin-1")
    assert text.count(old) >= count, old
    return text.replace(old, new, count).encode("latin-1")


# ---------------------------------------------------------------- discovery

def test_discovery_selects_resource_and_official_checksum():
    r = select_bu_resource(package(), year=2099, turn=1, uf="xx")
    assert (r.uf, r.turn, r.resource_id, r.url) == ("XX", 1, "r-data", URL)
    assert r.checksum and (r.checksum.algorithm, r.checksum.resource_id) == ("sha512", "r-hash")
    assert r.resource_name_date == "01.01.2099"


def test_discovery_rejects_ambiguity_wrong_host_and_unrelated_checksum():
    dup = {"id": "r-dup", "name": "XX - Boletim de Urna - Primeiro turno - 02.01.2099", "url": URL, "state": "active"}
    with pytest.raises(DiscoveryError, match="exactly one"):
        select_bu_resource(package(extra=[dup]), year=2099, turn=1, uf="XX")
    bad = package()
    bad["result"]["resources"][0]["url"] = "https://mirror.example.com/" + ZIP_NAME
    with pytest.raises(DiscoveryError, match="official"):
        select_bu_resource(bad, year=2099, turn=1, uf="XX")
    with pytest.raises(DiscoveryError, match="does not belong"):
        select_bu_resource(package(hash_url="https://cdn.tse.jus.br/x/outro.zip.sha512"), year=2099, turn=1, uf="XX")
    with pytest.raises(DiscoveryError):
        select_bu_resource(package(), year=2098, turn=1, uf="XX")


# ---------------------------------------------------------------- acquisition

def test_acquisition_is_content_addressed_with_provenance(tmp_path):
    a = acquired(tmp_path)
    z = make_zip()
    assert a.directory.name == hashlib.sha256(z).hexdigest()
    m = a.manifest
    assert m["zip"]["sha512"] == hashlib.sha512(z).hexdigest() == m["official_checksum"]["value"]
    assert m["official_checksum"]["verified"] is True
    assert m["csv"] == {"name": "bweb_1t_XX_010120990000.csv", "size": len(CSV_BYTES), "sha256": hashlib.sha256(CSV_BYTES).hexdigest()}
    assert m["source"]["resource_id"] == "r-data" and m["scope"] == {"year": 2099, "turn": 1, "uf": "XX", "resource_name_date": "01.01.2099"}
    assert a.csv_path.read_bytes() == CSV_BYTES
    again = acquired(tmp_path)  # mesmo arquivo: reaproveita, não sobrescreve
    assert again.reused and again.directory == a.directory


def test_acquisition_rejects_checksum_mismatch_and_truncated_zip(tmp_path):
    resource = select_bu_resource(package(), year=2099, turn=1, uf="XX")
    z = make_zip()
    with pytest.raises(AcquisitionError, match="mismatch"):
        acquire_bu_resource(resource, tmp_path / "a", source=FakeSource(z, f"{'0' * 128}  {ZIP_NAME}"))
    assert not any(p.is_dir() for p in (tmp_path / "a").iterdir())
    truncated = z[: len(z) // 2]
    with pytest.raises(AcquisitionError):
        acquire_bu_resource(resource, tmp_path / "b", source=FakeSource(truncated, f"{hashlib.sha512(truncated).hexdigest()}  {ZIP_NAME}"))
    with pytest.raises(AcquisitionError, match="refers to"):
        parse_checksum_file(f"{'a' * 128}  outro.zip", algorithm="sha512", expected_filename=ZIP_NAME)


# ---------------------------------------------------------------- layout / encoding / delimiter

def test_layout_detects_documented_encoding_delimiter_and_header(tmp_path):
    p = tmp_path / "f.csv"
    p.write_bytes(CSV_BYTES)
    layout = detect_layout(p)
    assert (layout.encoding, layout.delimiter, layout.line_terminator, layout.columns) == ("latin-1", ";", "\r\n", COLUMNS)


@pytest.mark.parametrize(
    "payload, message",
    [
        (CSV_BYTES.decode("latin-1").encode("utf-8"), "UTF-8"),
        (CSV_BYTES.replace(b"FICT\xcdCIO", b"FICT\x8dCIO", 1), "0x80-0x9F"),
        (CSV_BYTES.replace(b'"NR_TURMA_APURADORA"', b'"NR_TURMA"', 1), "header"),
        (CSV_BYTES.replace(b";", b",", 44), "delimiter"),
    ],
    ids=["utf-8", "cp1252-c1", "header", "comma"],
)
def test_layout_rejects_undocumented_formats(tmp_path, payload, message):
    p = tmp_path / "f.csv"
    p.write_bytes(payload)
    with pytest.raises(LayoutError, match=message):
        detect_layout(p)


# ---------------------------------------------------------------- parse: null ≠ zero

def test_null_sentinels_are_none_and_zero_stays_zero():
    for raw in ("#NULO", "#NULO#", "#NE", "#NE#", "-1", "-3", "", "  "):
        assert number(raw, "QT_VOTOS", 1) is None
    assert number("0", "QT_VOTOS", 1) == 0
    with pytest.raises(RowError):
        number("-7", "QT_VOTOS", 1)
    assert aggregated_sections("28 / 40", 1) == (28, 40)
    assert aggregated_sections("#NULO#", 1) == ()
    with pytest.raises(RowError):
        aggregated_sections("28 / x", 1)


def test_source_row_hash_is_deterministic_and_sensitive():
    fields = next(iter(CSV_BYTES.decode("latin-1").splitlines()[1:])).replace('"', "").split(";")
    assert row_hash(fields) == row_hash(list(fields))
    changed = list(fields)
    changed[COLUMNS.index("QT_VOTOS")] = "31"
    assert row_hash(changed) != row_hash(fields)
    row = parse_row(fields, 2)
    assert row.party_number == 11 and row.votes == 30 and row.aggregated_sections == (2, 3)
    assert row.municipality_name == "MUNICÍPIO FICTÍCIO"  # Latin-1 decodificado


def test_scan_filters_early_and_counts(tmp_path):
    p = tmp_path / "f.csv"
    p.write_bytes(CSV_BYTES)
    stats = ScanStats()
    rows = list(scan(p, detect_layout(p), uf="XX", municipality=99999, zone=9, stats=stats))
    assert (stats.rows_read, stats.rows_matching_municipality, len(rows)) == (13, 13, 13)
    assert list(scan(p, detect_layout(p), uf="XX", municipality=99999, zone=8, stats=ScanStats())) == []


# ---------------------------------------------------------------- normalize + reconcile (end to end)

def test_end_to_end_dry_run_report(tmp_path):
    p = prepared(tmp_path)
    r = p.report()
    assert r["rows"] == {"read": 13, "matching_uf": 13, "matching_municipality": 13, "matching_zone": 13, "accepted": 13, "rejected": 0}
    assert r["sections"] == {"found": 3, "principal": 3, "aggregated": 3, "aggregation": {"1": [2, 3], "5": [6]}}
    assert r["offices"]["1"]["votes_total"] == r["offices"]["1"]["turnout_total"] == 126
    assert r["votables"]["by_kind"] == {"blank": 1, "candidate": 4, "null": 1, "party_legend": 2}
    assert r["ea20_validation"]["status"] == "not_available"
    assert r["warnings"] == []
    assert r["status"] == "dry_run" and r["import_batch_id"] is None


def test_repeated_structural_metrics_are_stored_once_not_summed(tmp_path):
    zone = prepared(tmp_path).zone
    urn = zone.results[(1, 1, 999001)]
    assert len(urn.votes) == 4  # QT_APTOS repetido em 4 linhas…
    assert urn.structural["eligible"] == 70  # …é UMA propriedade da urna, não 4 × 70
    assert zone.eligible_by_scope(4) == {"federal": 40, "state": 39}


def test_confirmed_zero_is_kept_and_absence_is_none(tmp_path):
    zone = prepared(tmp_path).zone
    legend = [v for v in zone.results[(4, 6, 999002)].votes if v.votable.type_code == 4]
    assert [v.votes for v in legend] == [0]
    blank = next(v for v in zone.votables.values() if v.vote_kind == "blank")
    assert (blank.party_number, blank.party_acronym, blank.key.number) == (None, None, 95)


def test_cargo_candidate_party_blank_null_identity(tmp_path):
    zone = prepared(tmp_path).zone
    assert zone.offices == [1, 6]
    alfa = next(v for v in zone.votables.values() if v.key.number == 11 and v.key.office_code == 1)
    assert (alfa.vote_kind, alfa.name, alfa.party_acronym, alfa.party_name) == ("candidate", "CANDIDATA FICTÍCIA ALFA", "PFA", "PARTIDO FICTÍCIO ALFA")
    # mesmo número 11, outro cargo/tipo: outra entidade
    legend11 = next(v for v in zone.votables.values() if v.key.number == 11 and v.key.office_code == 6)
    assert legend11.vote_kind == "party_legend" and legend11.key != alfa.key
    kinds = {v.vote_kind for v in zone.votables.values()}
    assert kinds == {"candidate", "party_legend", "blank", "null"}


def test_fingerprint_is_idempotent_and_tracks_content(tmp_path):
    a = prepared(tmp_path / "a").fingerprint
    b = prepared(tmp_path / "b").fingerprint
    changed = prepared(tmp_path / "c", mutate(';"CANDIDATO FICT\xcdCIO BETA";20;', ';"CANDIDATO FICT\xcdCIO BETA";19;')).fingerprint
    assert a == b  # mesmo arquivo ⇒ mesma importação
    assert changed != a  # um voto diferente ⇒ outra versão


@pytest.mark.parametrize(
    "old, new, message",
    [
        # métrica estrutural conflitante dentro da mesma urna/cargo
        (';70;55;15;1;"Apurada";2;"Branco"', ';71;55;15;1;"Apurada";2;"Branco"', "repeated structural field"),
        # linha duplicada ≠ voto adicional
        (';"Branco";95;"Branco";3;', ';"Nominal";22;"CANDIDATO FICT\xcdCIO BETA";3;', None),
        # tipo de votável não documentado
        (';2;"Branco";95;', ';9;"Branco";95;', "not a documented"),
        # branco com número diferente de 95
        (';2;"Branco";95;', ';2;"Branco";94;', "documented 95"),
        # aptos ≠ comparecimento + abstenções
        (';40;30;10;1;"Apurada";1;"Nominal";11;', ';40;30;11;1;"Apurada";1;"Nominal";11;', None),
    ],
    ids=["structural-conflict", "duplicate-line", "unknown-type", "blank-number", "aptos-identity"],
)
def test_inconsistent_source_fails_the_import(tmp_path, old, new, message):
    with pytest.raises(ConsistencyError, match=message):
        prepared(tmp_path, mutate(old, new))


def test_duplicate_votable_row_fails(tmp_path):
    lines = CSV_BYTES.split(b"\r\n")
    duplicated = b"\r\n".join(lines[:2] + [lines[1]] + lines[2:])
    with pytest.raises(ConsistencyError, match="duplicate votable"):
        prepared(tmp_path, duplicated)


def test_reconciliation_blocks_structure_divergence_and_warns_on_polling_place(tmp_path):
    cad = json.loads(CADASTRO.read_text(encoding="utf-8"))

    def run(mutated: dict, sub: str):
        path = tmp_path / f"{sub}.json"
        path.write_text(json.dumps(mutated, ensure_ascii=False), encoding="utf-8")
        return prepared(tmp_path / sub, cadastro=path)

    wrong_agg = json.loads(json.dumps(cad))
    wrong_agg["sections"][0]["aggregated_sections"] = [2]
    with pytest.raises(ConsistencyError, match="aggregates"):
        run(wrong_agg, "agg")

    unknown = json.loads(json.dumps(cad))
    unknown["sections"] = [s for s in unknown["sections"] if s["number"] != 4]
    with pytest.raises(ConsistencyError, match="unknown"):
        run(unknown, "unknown")

    aptos = json.loads(json.dumps(cad))
    aptos["sections"][3]["total_eligible_state"] = 40
    with pytest.raises(ConsistencyError, match="QT_APTOS"):
        run(aptos, "aptos")

    missing = json.loads(json.dumps(cad))
    missing["sections"].append({"number": 7, "principal_number": 7, "polling_place_code": "9002", "is_aggregated": False, "aggregated_sections": []})
    with pytest.raises(ConsistencyError, match="missing in the BU"):
        run(missing, "missing")

    place = json.loads(json.dumps(cad))
    place["sections"][3]["polling_place_code"] = "9002"
    report = run(place, "place").report()
    assert report["warnings"] == [{
        "code": "polling_place_mismatch", "section": 4, "bu_polling_place_code": "9001",
        "cadastro_polling_place_code": "9002", "bu_polling_place_in_cadastro": True, "affects_votes": False,
    }]


def test_aggregated_section_with_own_votes_is_rejected(tmp_path):
    with pytest.raises(ConsistencyError, match="aggregated sections appear"):
        prepared(tmp_path, mutate(";9;5;9002;6;", ";9;6;9002;6;"))


def test_wrong_municipality_or_zone_yields_no_import(tmp_path):
    a = acquired(tmp_path)
    with pytest.raises(ConsistencyError, match="no rows"):
        prepare_import(a.manifest_path, municipality=99998, zone=9, cadastro_path=CADASTRO)


def test_csv_tampered_after_acquisition_is_rejected(tmp_path):
    a = acquired(tmp_path)
    a.csv_path.write_bytes(CSV_BYTES.replace(b";30;", b";31;", 1))
    with pytest.raises(AcquisitionError, match="sha256"):
        prepare_import(a.manifest_path, municipality=99999, zone=9, cadastro_path=CADASTRO)


# ---------------------------------------------------------------- EA20

def _ea20(office: int, election: int, **v) -> EA20Result:
    votes = {"tv": 0, "vvc": 0, "vb": 0, "tvn": 0, "vscv": 0, **v}
    votes["tv"] = votes["vvc"] + votes["vb"] + votes["tvn"] + votes["vscv"]
    return EA20Result.model_validate({
        "ele": election, "t": 1, "f": "o", "sup": "n", "tpabr": "zona", "cdabr": "0009", "dg": "", "hg": "", "idg": 1,
        "dv": "n", "dt": "", "ht": "", "tf": "s", "and": "f", "md": "e", "esae": "n", "carg": [{"cd": office}],
        "s": {"ts": 3, "st": 3, "snt": 0, "si": 3, "sni": 0, "sa": 3, "sna": 0},
        "e": {"te": 160, "est": 160, "esnt": 0, "esi": 160, "esni": 0, "esa": 160, "esna": 0, "c": 126, "a": 34},
        "v": votes,
    })


def test_ea20_cross_check(tmp_path):
    zone = prepared(tmp_path).zone
    ok = _ea20(1, 999001, vvc=121, vb=3, tvn=2, vn=2, vnom=121, vl=0)
    assert validate_against_ea20(zone, [ok])["status"] == "pass"
    bad = _ea20(1, 999001, vvc=120, vb=4, tvn=2, vn=2, vnom=120, vl=0)
    result = validate_against_ea20(zone, [bad])
    assert result["status"] == "fail" and set(result["offices"]["1"]["differences"]) == {"vb", "vnom"}
    assert validate_against_ea20(zone, [])["status"] == "not_available"
