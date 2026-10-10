"""Importadores do Raio X contra o schema real (migrations 001–008) — dados SINTÉTICOS.

Identidade sem CPF só por vínculo oficial, eleição suplementar e data do pleito, histórico
oficial retroativo, votáveis municipais com o mesmo número em municípios diferentes, bens
(idempotência/supersede) e prestação de contas (documentos só como HMAC; CNPJ de empresa público).
Roda com REPBRASIL_ELECTORAL_TEST_DATABASE_URL (banco *_test, como no CI).
"""
from __future__ import annotations

import hashlib
from decimal import Decimal
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg")

from conftest import TEST_DATABASE_URL, reset_electoral_schema  # noqa: E402
from test_cadaster_store import load_cadaster, load_territories, manifest  # noqa: E402
from test_candidates import (  # noqa: E402
    BASE,
    GAMA,
    HISTORY_COLUMNS,
    KEY,
    cpf,
    history_row,
    parse_file,
    parse_history_file,
    run_import,
    state,
    write_csv,
)
from test_finance import CANDIDATE_CPF, DONOR_CPF, contracted, paid, revenue  # noqa: E402

from src.electoral.candidates.layout import CANDIDATES_COLUMNS  # noqa: E402
from src.electoral.candidates.records import (  # noqa: E402
    ASSETS_COLUMNS,
    ASSETS_PROFILE_ID,
    RecordsConflict,
    import_records,
    iter_rows,
    parse_asset,
)
from src.electoral.candidates.store import (  # noqa: E402
    CandidatesError,
    backfill_history,
    import_candidates,
    link_votables,
)
from src.electoral.finance.parser import (  # noqa: E402
    CONTRACTED_COLUMNS,
    PAID_COLUMNS,
    REVENUE_COLUMNS,
    parse_row,
)
from src.electoral.finance.store import import_finance  # noqa: E402
from src.electoral.open_data.layout import detect_csv_layout  # noqa: E402

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="REPBRASIL_ELECTORAL_TEST_DATABASE_URL not set")

MUNICIPAL_ELECTION = "998619"
SUPPLEMENTARY = {"CD_TIPO_ELEICAO": "1", "CD_ELEICAO": "996223", "DT_ELEICAO": "06/12/2098"}


@pytest.fixture
def conn():
    assert TEST_DATABASE_URL
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True, options="-c search_path=electoral,public") as c:
        reset_electoral_schema(c)
        c.execute('TRUNCATE "Persons", "Politicians", "Sources" CASCADE')
        load_territories(c)
        load_cadaster(c)  # pleito 2099 (estadual/federal)
        # pleito municipal anterior (2098), só para os testes de identidade entre eleições
        c.execute("INSERT INTO election (year, round, election_date, tse_cycle) VALUES (2098, 1, '2098-10-04', 'ele2098')")
        yield c


def municipal(sq: int, number: int, ballot: str, unit: str, **kw: str) -> dict[str, str]:
    return BASE | {
        "ANO_ELEICAO": "2098", "DT_ELEICAO": "04/10/2098", "CD_ELEICAO": MUNICIPAL_ELECTION,
        "DS_ELEICAO": "Municipais Fictícias", "TP_ABRANGENCIA": "MUNICIPAL", "SG_UF": "XX", "SG_UE": unit,
        "NM_UE": f"MUNICÍPIO {unit}", "CD_CARGO": "13", "DS_CARGO": "VEREADOR", "SQ_CANDIDATO": str(sq),
        "NR_CANDIDATO": str(number), "NM_CANDIDATO": f"{ballot} DA SILVA", "NM_URNA_CANDIDATO": ballot,
        "NR_CPF_CANDIDATO": "-4", "NR_PARTIDO": "12", "SG_PARTIDO": "PF", "NM_PARTIDO": "PARTIDO FICTÍCIO",
    } | kw


def import_2098(conn, tmp_path: Path, rows: list[dict[str, str]], sha: str = "m") -> dict:
    """Arquivo municipal da UF inteira (`--municipal-uf XX`), sem histórico (publicado só a partir de 2026)."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    parsed, layout = parse_file(write_csv(tmp_path / "consulta_cand_2098_XX.csv", CANDIDATES_COLUMNS, rows))
    return import_candidates(
        conn, year=2098, turn=1, units=set(), candidates=parsed,
        candidates_manifest=manifest("tse-open-data-candidates", sha), candidates_layout=layout,
        history=None, history_manifest=None, history_layout=None, key=KEY, municipal_ufs={"XX"},
    )


def asset_file(tmp_path: Path, value: str, sha: str):
    """bem_candidato_2099_XX.csv com um bem da candidatura GAMA (layout oficial)."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    row = dict.fromkeys(ASSETS_COLUMNS, "") | {
        "DT_GERACAO": "01/01/2099", "HH_GERACAO": "10:00:00", "ANO_ELEICAO": "2099", "CD_TIPO_ELEICAO": "2",
        "CD_ELEICAO": GAMA["CD_ELEICAO"], "SG_UF": "XX", "SG_UE": "XX", "SQ_CANDIDATO": GAMA["SQ_CANDIDATO"],
        "NR_ORDEM_BEM_CANDIDATO": "1", "CD_TIPO_BEM_CANDIDATO": "11", "DS_TIPO_BEM_CANDIDATO": "Casa",
        "DS_BEM_CANDIDATO": "CASA FICTÍCIA", "VR_BEM_CANDIDATO": value, "DT_ULT_ATUAL_BEM_CANDIDATO": "07/07/2099",
    }
    path = write_csv(tmp_path / "bem_candidato_2099_XX.csv", ASSETS_COLUMNS, [row])
    layout = detect_csv_layout(path, columns=ASSETS_COLUMNS, profile_id=ASSETS_PROFILE_ID)
    rows = [parse_asset(f, line, layout.columns, path.name) for line, f in iter_rows(path, layout)]
    return rows, manifest("tse-open-data-candidate-assets", sha), layout


def test_no_cpf_identity_uses_only_official_links(conn, tmp_path):
    # 2099: GAMA (CPF) cita no histórico oficial a candidatura 700001 de 2098
    first = run_import(conn, tmp_path / "2099", [], [GAMA], history=[history_row(9101, 700001, year=2098)])
    assert first["history_rows_persisted"] == 1
    gama_person, gama_politician = conn.execute(
        "SELECT person_id, politician_id FROM candidacy WHERE tse_candidate_id = 9101").fetchone()
    priors = conn.execute(
        "SELECT prior_year, prior_office_code, prior_electoral_unit, prior_candidate_number FROM candidacy_prior").fetchall()
    assert [(y, o, u.strip(), n) for y, o, u, n in priors] == [(2098, 13, "99999", 12345)]
    # perfil já existente cujo TseId é o SQ de 2098, ainda sem pessoa
    profile = conn.execute(
        """INSERT INTO "Politicians" ("Id", "Name", "BallotName", "TseId", "CreatedAt", "UpdatedAt")
           VALUES (gen_random_uuid(), 'Vereador Fictício', 'V', '700002', now(), now()) RETURNING "Id\"""").fetchone()[0]

    rows = [
        municipal(700001, 12345, "GAMA VEREADORA", "99999"),
        municipal(700002, 12345, "VEREADOR PERFIL", "99998"),  # mesmo número, outro município
        municipal(700003, 54321, "SEM VINCULO", "99999"),
        municipal(700004, 15, "SUPLEMENTAR", "99999", **SUPPLEMENTARY),
    ]
    report = import_2098(conn, tmp_path / "2098", rows)
    assert report["identity_resolution"] == {"tse_candidacy_history": 1, "profile_only": 1, "unresolved": 1}
    assert report["other_election_rows"] == {"996223 Municipais Fictícias (2098-12-06)": 1}
    stored = {sq: (status, person, politician) for sq, status, person, politician in conn.execute(
        """SELECT tse_candidate_id, identity_status, person_id, politician_id FROM candidacy
            WHERE tse_candidate_id >= 700001""")}
    assert stored == {
        700001: ("resolved_tse_link", gama_person, gama_politician),  # pessoa provada pelo histórico oficial
        700002: ("unresolved_document_unavailable", None, profile),  # perfil oficial, pessoa não provada
        700003: ("unresolved_document_unavailable", None, None),  # nome nunca vincula
    }
    contests = conn.execute(
        "SELECT electoral_unit, uf FROM contest WHERE scope = 'municipal' ORDER BY electoral_unit").fetchall()
    assert [(u.strip(), uf) for u, uf in contests] == [("99998", "XX"), ("99999", "XX")]
    assert import_2098(conn, tmp_path / "again", rows)["status"] == "already_imported"


def test_candidacies_of_another_election_date_are_refused(conn, tmp_path):
    with pytest.raises(CandidatesError, match="do not belong to election 2098/1"):
        import_2098(conn, tmp_path, [municipal(700001, 12345, "A", "99999", DT_ELEICAO="06/10/2098")])
    assert conn.execute("SELECT count(*) FROM candidacy").fetchone()[0] == 0


def test_history_backfill_is_idempotent_and_never_touches_candidacies(conn, tmp_path):
    run_import(conn, tmp_path / "base", [], [GAMA])  # 2099 importado sem histórico (como antes da migration 007)
    before = conn.execute("SELECT count(*), max(updated_at) FROM candidacy").fetchone()
    history, layout = parse_history_file(write_csv(
        tmp_path / "historico_candidatura_2099_XX.csv", HISTORY_COLUMNS,
        [history_row(9101, 700001, year=2098), history_row(9999, 700009, year=2098)]))
    history_manifest = manifest("tse-open-data-candidacy-history", "h")
    report = backfill_history(conn, year=2099, history=history, history_manifest=history_manifest, history_layout=layout)
    assert (report["inserted"], report["rows_for_imported"], report["rows_not_imported"]) == (1, 1, 1)
    again = backfill_history(conn, year=2099, history=history, history_manifest=history_manifest, history_layout=layout)
    assert again["status"] == "already_imported"
    assert conn.execute("SELECT count(*) FROM candidacy_prior").fetchone()[0] == 1
    assert conn.execute("SELECT count(*), max(updated_at) FROM candidacy").fetchone() == before


def test_municipal_votables_with_the_same_number_link_to_their_own_municipality(conn, tmp_path):
    import_2098(conn, tmp_path, [municipal(700001, 12345, "VEREADORA UM", "99999"),
                                 municipal(700002, 12345, "VEREADOR DOIS", "99998")])
    election = conn.execute("SELECT id FROM election WHERE year = 2098").fetchone()[0]
    bu_run = conn.execute(
        """INSERT INTO ingestion_run (source, election_id, status, finished_at)
           VALUES ('tse-open-data-bu', %s, 'succeeded', now()) RETURNING id""", (election,)).fetchone()[0]
    for municipality, name, votes in (("99999", "VEREADORA UM", 7), ("99998", "VEREADOR DOIS", 3)):
        votable = conn.execute(
            """INSERT INTO votable (uf, election_code, office_code, vote_kind, type_code, type_description, number, name,
                                    municipality_tse_code)
               VALUES ('XX', %s, 13, 'candidate', 1, 'Nominal', 12345, %s, %s) RETURNING id""",
            (int(MUNICIPAL_ELECTION), name, municipality)).fetchone()[0]
        result = conn.execute(
            """INSERT INTO section_office_result (ingestion_run_id, year, turn, election_code, uf, municipality_tse_code,
                                                 zone, section, office_code, votes_total)
               VALUES (%s, 2098, 1, %s, 'XX', %s, 9, 1, 13, %s) RETURNING id""",
            (bu_run, int(MUNICIPAL_ELECTION), municipality, votes)).fetchone()[0]
        conn.execute(
            "INSERT INTO section_office_vote (result_id, votable_id, votes, source_row_hash, source_line) VALUES (%s, %s, %s, %s, 2)",
            (result, votable, votes, hashlib.sha256(f"{municipality}:12345".encode()).hexdigest()))
    # dois votáveis com o mesmo número convivem (um por município); repetir no mesmo município viola a identidade
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute(
            """INSERT INTO votable (uf, election_code, office_code, vote_kind, type_code, type_description, number, name,
                                    municipality_tse_code)
               VALUES ('XX', %s, 13, 'candidate', 1, 'Nominal', 12345, 'OUTRO', '99999')""", (int(MUNICIPAL_ELECTION),))
    report = link_votables(conn, year=2098, turn=1, uf="XX")
    assert (report["votables"], report["linked"], report["ambiguous"], report["unmatched"]) == (2, 2, [], [])
    linked = dict(conn.execute(
        """SELECT v.municipality_tse_code, c.tse_candidate_id FROM votable_candidacy vc
             JOIN votable v ON v.id = vc.votable_id JOIN candidacy c ON c.id = vc.candidacy_id"""))
    assert linked == {"99999": 700001, "99998": 700002}


def test_assets_are_idempotent_and_a_changed_file_needs_supersede(conn, tmp_path):
    run_import(conn, tmp_path / "cand", [], [GAMA])
    rows, man, layout = asset_file(tmp_path / "a1", "100000,00", "a1")
    first = import_records(conn, year=2099, uf="XX", kind="asset", rows=rows, manifest=man, layout=layout)
    assert (first["inserted"], first["candidacies"]) == (1, 1)
    assert import_records(conn, year=2099, uf="XX", kind="asset", rows=rows, manifest=man, layout=layout)["status"] == "already_imported"

    rows2, man2, layout2 = asset_file(tmp_path / "a2", "150000,00", "a2")
    with pytest.raises(RecordsConflict):
        import_records(conn, year=2099, uf="XX", kind="asset", rows=rows2, manifest=man2, layout=layout2)
    assert conn.execute("SELECT value FROM candidacy_asset").fetchall() == [(Decimal("100000.00"),)]
    applied = import_records(conn, year=2099, uf="XX", kind="asset", rows=rows2, manifest=man2, layout=layout2, supersede=True)
    assert applied["superseded"] == 1
    assert conn.execute("SELECT value FROM candidacy_asset").fetchall() == [(Decimal("150000.00"),)]


def test_finance_documents_are_hmac_only_and_the_company_cnpj_is_public(conn, tmp_path):
    candidate = state(9201, 1234, "DEPUTADA FINANCEIRA", "DEPUTADA FINANCEIRA", cpf(100000009))
    run_import(conn, tmp_path / "cand", [], [candidate])
    ids = {"AA_ELEICAO": "2099", "CD_ELEICAO": candidate["CD_ELEICAO"], "SG_UF": "XX"}
    rows = [
        parse_row("revenue", revenue(**ids, SQ_CANDIDATO="9201"), 2, REVENUE_COLUMNS, "receitas_candidatos_2099_XX.csv"),
        parse_row("expense_contracted", contracted(**ids, SQ_CANDIDATO="9201"), 2, CONTRACTED_COLUMNS,
                  "despesas_contratadas_candidatos_2099_XX.csv"),
        # despesa paga não traz SQ_CANDIDATO: liga pelo prestador de contas
        parse_row("expense_paid", paid(**ids), 2, PAID_COLUMNS, "despesas_pagas_candidatos_2099_XX.csv"),
    ]
    finance_manifest = manifest("tse-open-data-campaign-finance", "f1")
    report = import_finance(conn, year=2099, uf="XX", rows=rows, manifest=finance_manifest, key=KEY)
    assert (report["candidacies"], report["by_kind"]) == (1, {"revenue": 1, "expense_contracted": 1, "expense_paid": 1})
    stored = {r[0]: r[1:] for r in conn.execute(
        """SELECT record_kind, counterparty_kind, counterparty_cnpj, counterparty_document_hash
             FROM candidacy_finance_record""")}
    assert stored["revenue"][:2] == ("person", None) and len(stored["revenue"][2]) == 64  # doador PF: só HMAC
    assert stored["expense_contracted"][:2] == ("company", "11222333000181")  # fornecedor PJ: CNPJ público
    assert stored["expense_paid"] == (None, None, None)
    dump = conn.execute("SELECT string_agg(row_to_json(f)::text, '') FROM candidacy_finance_record f").fetchone()[0]
    for secret in (DONOR_CPF, CANDIDATE_CPF, "doadora@example.org"):
        assert secret not in dump
    assert import_finance(conn, year=2099, uf="XX", rows=rows, manifest=finance_manifest, key=KEY)["status"] == "already_imported"
