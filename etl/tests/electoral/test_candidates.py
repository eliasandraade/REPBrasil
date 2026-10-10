"""Candidaturas oficiais, identidade determinística e vínculo votável → candidatura.

Dados SINTÉTICOS no layout oficial (consulta_cand / historico_candidatura).
CPFs fictícios com dígitos verificadores válidos, gerados aqui.
Testes de banco: REPBRASIL_ELECTORAL_TEST_DATABASE_URL (banco *_test com as
migrations EF aplicadas); sem ele, só os testes puros rodam.
"""
from __future__ import annotations

import csv
from pathlib import Path

import pytest

from src.electoral.candidates import identity
from src.electoral.candidates.layout import (
    CANDIDATES_COLUMNS,
    CANDIDATES_PROFILE_ID,
    HISTORY_COLUMNS,
    HISTORY_PROFILE_ID,
)
from src.electoral.candidates.parser import (
    CandidateRowError,
    iter_csv,
    parse_candidate,
    parse_history,
)
from src.electoral.open_data.layout import detect_csv_layout

KEY = b"k" * 32


def cpf(seed: int) -> str:
    digits = f"{seed:09d}"
    for size in (9, 10):
        total = sum(int(d) * w for d, w in zip(digits, range(size + 1, 1, -1), strict=False))
        digits += str((total * 10) % 11 % 10)
    return digits


BASE = dict.fromkeys(CANDIDATES_COLUMNS, "#NULO") | {
    "DT_GERACAO": "01/01/2099", "HH_GERACAO": "10:00:00", "ANO_ELEICAO": "2099", "CD_TIPO_ELEICAO": "2",
    "NM_TIPO_ELEICAO": "ELEIÇÃO ORDINÁRIA", "NR_TURNO": "1", "DT_ELEICAO": "04/10/2099",
    "NR_CPF_CANDIDATO": "", "DS_EMAIL": "NÃO DIVULGÁVEL", "CD_SITUACAO_CANDIDATURA": "-3",
    "DS_SITUACAO_CANDIDATURA": "#NE", "TP_AGREMIACAO": "PARTIDO ISOLADO", "NR_FEDERACAO": "-1",
    "SQ_COLIGACAO": "1", "NM_COLIGACAO": "PARTIDO ISOLADO", "DT_NASCIMENTO": "01/01/1970",
    "NR_TITULO_ELEITORAL_CANDIDATO": "000000000000", "CD_SIT_TOT_TURNO": "4", "DS_SIT_TOT_TURNO": "NÃO ELEITO",
}


def federal(sq: int, number: int, name: str, ballot: str, doc: str, **kw: str) -> dict[str, str]:
    return BASE | {"CD_ELEICAO": "999001", "DS_ELEICAO": "Eleição Fictícia Federal", "TP_ABRANGENCIA": "FEDERAL",
                   "SG_UF": "BR", "SG_UE": "BR", "NM_UE": "BRASIL", "CD_CARGO": "1", "DS_CARGO": "PRESIDENTE",
                   "SQ_CANDIDATO": str(sq), "NR_CANDIDATO": str(number), "NM_CANDIDATO": name,
                   "NM_URNA_CANDIDATO": ballot, "NR_CPF_CANDIDATO": doc, "NR_PARTIDO": str(number),
                   "SG_PARTIDO": f"P{number}", "NM_PARTIDO": f"PARTIDO FICTÍCIO {number}"} | kw


def state(sq: int, number: int, name: str, ballot: str, doc: str, **kw: str) -> dict[str, str]:
    return BASE | {"CD_ELEICAO": "999002", "DS_ELEICAO": "Eleição Fictícia Estadual", "TP_ABRANGENCIA": "ESTADUAL",
                   "SG_UF": "XX", "SG_UE": "XX", "NM_UE": "ESTADO FICTÍCIO", "CD_CARGO": "6",
                   "DS_CARGO": "DEPUTADO FEDERAL", "SQ_CANDIDATO": str(sq), "NR_CANDIDATO": str(number),
                   "NM_CANDIDATO": name, "NM_URNA_CANDIDATO": ballot, "NR_CPF_CANDIDATO": doc,
                   "NR_PARTIDO": str(number // 100), "SG_PARTIDO": f"P{number // 100}",
                   "NM_PARTIDO": f"PARTIDO FICTÍCIO {number // 100}"} | kw


ALFA = federal(9001, 11, "CANDIDATA FICTÍCIA ALFA DA SILVA", "CANDIDATA FICTÍCIA ALFA", cpf(100000001))
BETA = federal(9002, 22, "CANDIDATO FICTÍCIO BETA SOUZA", "CANDIDATO FICTÍCIO BETA", cpf(100000002),
               CD_SIT_TOT_TURNO="6", DS_SIT_TOT_TURNO="2º TURNO")
GAMA = state(9101, 1111, "DEPUTADA FICTÍCIA GAMA LIMA", "DEPUTADA FICTÍCIA GAMA", cpf(100000003),
             CD_SIT_TOT_TURNO="2", DS_SIT_TOT_TURNO="ELEITO POR QP")
DELTA = state(9102, 2222, "DEPUTADO FICTÍCIO DELTA REIS", "DEPUTADO DELTA", cpf(100000004))
SEM_DOC = state(9103, 3333, "CANDIDATO SEM DOCUMENTO", "SEM DOCUMENTO", "-4")


def write_csv(path: Path, columns: tuple[str, ...], rows: list[dict[str, str]]) -> Path:
    with path.open("w", encoding="latin-1", newline="") as fh:
        w = csv.writer(fh, delimiter=";", quotechar='"', quoting=csv.QUOTE_ALL, lineterminator="\r\n")
        w.writerow(columns)
        for r in rows:
            w.writerow([r[c] for c in columns])
    return path


def parse_file(path: Path):
    layout = detect_csv_layout(path, columns=CANDIDATES_COLUMNS, profile_id=CANDIDATES_PROFILE_ID)
    return [parse_candidate(f, line, layout.columns, path.name) for line, f in iter_csv(path, layout)], layout


def history_row(current_sq: int, prior_sq: int, year: int = 2096) -> dict[str, str]:
    return dict.fromkeys(HISTORY_COLUMNS, "") | {
        "DT_GERACAO": "01/01/2099", "HH_GERACAO": "10:00:00", "ANO_ELEICAO_ATUAL": "2099",
        "SQ_CANDIDATO_ATUAL": str(current_sq), "SG_UF_ATUAL": "XX", "ANO_ELEICAO": str(year),
        "CD_TIPO_ELEICAO": "2", "NR_TURNO": "1", "CD_ELEICAO": "1", "SG_UF": "XX", "SG_UE": "99999",
        "CD_CARGO": "13", "DS_CARGO": "Vereador", "SQ_CANDIDATO": str(prior_sq), "NR_CANDIDATO": "12345",
        "NM_CANDIDATO": "QUALQUER NOME", "CD_SIT_TOT_TURNO": "5", "DS_SIT_TOT_TURNO": "Suplente",
    }


def parse_history_file(path: Path):
    layout = detect_csv_layout(path, columns=HISTORY_COLUMNS, profile_id=HISTORY_PROFILE_ID)
    return [parse_history(f, line, layout.columns) for line, f in iter_csv(path, layout)], layout


# ------------------------------------------------------------------ puros


def test_cpf_classification_never_guesses():
    assert identity.check_cpf(cpf(123456789)).status == identity.RESOLVED
    for sentinel in ("-4", "NÃO DIVULGÁVEL", "", "#NULO"):
        assert identity.check_cpf(sentinel).status == identity.UNAVAILABLE
    for bad in ("1234567890", "11111111111", cpf(123456789)[:-1] + "0" if cpf(123456789)[-1] != "0" else cpf(123456789)[:-1] + "1", "123.456.789-09"):
        assert identity.check_cpf(bad).status == identity.INVALID


def test_document_hash_is_keyed_and_the_key_is_mandatory():
    doc = cpf(123456789)
    first, second = identity.document_hash(KEY, doc), identity.document_hash(KEY, doc)
    assert first == second  # determinístico por chave
    assert identity.document_hash(KEY, doc) != identity.document_hash(b"z" * 32, doc)
    assert doc not in identity.document_hash(KEY, doc)
    with pytest.raises(identity.IdentityKeyMissing):
        identity.load_key({})
    with pytest.raises(identity.IdentityKeyMissing):
        identity.load_key({identity.DOCUMENT_KEY_ENV: "curta"})


def test_parser_maps_sentinels_to_null_and_hides_the_document(tmp_path):
    rows, _ = parse_file(write_csv(tmp_path / "consulta_cand_2099_XX.csv", CANDIDATES_COLUMNS, [GAMA, SEM_DOC]))
    gama, sem_doc = rows
    assert (gama.line, gama.source_member) == (2, "consulta_cand_2099_XX.csv")
    assert (gama.office_code, gama.candidate_number, gama.scope, gama.electoral_unit) == (6, 1111, "state", "XX")
    assert gama.elected is True and gama.round_outcome == "ELEITO POR QP"
    assert gama.candidacy_status is None and gama.candidacy_status_code is None  # #NE / -3
    assert gama.federation_number is None and gama.social_name is None  # -1 / #NULO
    assert GAMA["NR_CPF_CANDIDATO"] not in repr(gama)
    assert identity.check_cpf(sem_doc.cpf_raw).status == identity.UNAVAILABLE


def test_source_row_hash_is_computed_with_the_cpf_redacted(tmp_path):
    """Nenhum material persistido permite verificar um CPF offline com SHA-256 não chaveado."""
    import hashlib

    from src.electoral.candidates.parser import CPF_REDACTION, candidate_row_hash
    from src.electoral.open_data.parser import row_hash

    doc_a, doc_b = cpf(111111111), cpf(222222222)
    rows, layout = parse_file(write_csv(tmp_path / "consulta_cand_2099_XX.csv", CANDIDATES_COLUMNS,
                                        [GAMA | {"NR_CPF_CANDIDATO": doc_a}, GAMA | {"NR_CPF_CANDIDATO": doc_b}]))
    a, b = rows
    # Linhas idênticas exceto pelo CPF ⇒ mesma impressão digital: o hash não carrega informação do CPF.
    assert a.source_row_hash == b.source_row_hash
    raw_a = [(GAMA | {"NR_CPF_CANDIDATO": doc_a})[c] for c in CANDIDATES_COLUMNS]
    assert a.source_row_hash != row_hash(raw_a)  # não é o hash da linha bruta
    redacted = [CPF_REDACTION if c == "NR_CPF_CANDIDATO" else v for c, v in zip(CANDIDATES_COLUMNS, raw_a, strict=True)]
    assert a.source_row_hash == row_hash(redacted) == candidate_row_hash(raw_a, CANDIDATES_COLUMNS)
    # Um atacante com um CPF candidato não consegue confirmá-lo contra o hash persistido.
    for guess in (doc_a, doc_b):
        assert row_hash([guess if c == "NR_CPF_CANDIDATO" else v for c, v in zip(CANDIDATES_COLUMNS, raw_a, strict=True)]) != a.source_row_hash
        assert hashlib.sha256(guess.encode()).hexdigest() != a.source_row_hash
    assert doc_a not in repr(a)


RUNOFF = {"NR_TURNO": "2", "CD_ELEICAO": "999003", "DT_ELEICAO": "25/10/2099", "CD_SIT_TOT_TURNO": "-1", "DS_SIT_TOT_TURNO": "#NULO"}


def test_official_file_with_both_rounds_imports_only_the_requested_turn(tmp_path):
    """O TSE publica as linhas do 2º turno no mesmo arquivo, com o MESMO SQ_CANDIDATO."""
    from src.electoral.candidates.store import CandidatesError, select_candidacies

    beta_1 = BETA
    beta_2 = BETA | RUNOFF
    rows, _ = parse_file(write_csv(tmp_path / "consulta_cand_2099_BR.csv", CANDIDATES_COLUMNS, [ALFA, beta_1, beta_2]))
    selected, other, _ = select_candidacies(rows, year=2099, turn=1, units={"BR"})
    assert [(r.tse_candidate_id, r.turn) for r in selected] == [(9001, 1), (9002, 1)]
    assert other == {2: 1}
    selected_2, other_2, _ = select_candidacies(rows, year=2099, turn=2, units={"BR"})
    assert [(r.tse_candidate_id, r.turn, r.election_code) for r in selected_2] == [(9002, 2, 999003)]
    assert other_2 == {1: 2}
    other_year, _ = parse_file(write_csv(tmp_path / "x.csv", CANDIDATES_COLUMNS, [ALFA | {"ANO_ELEICAO": "2098"}]))
    with pytest.raises(CandidatesError, match="year 2098"):
        select_candidacies(other_year, year=2099, turn=1, units={"BR"})


def test_cli_summary_keeps_counts_and_drops_bulky_lists():
    from src.electoral.candidates.cli import summarize

    report = {"status": "succeeded", "linked": 640, "ambiguous": [{"number": 1}] * 8, "identity": {"resolved": 742},
              "nested": {"warnings": [{"a": 1}] * 290}}
    assert summarize(report) == {"status": "succeeded", "linked": 640, "ambiguous_count": 8, "identity": {"resolved": 742},
                                 "nested": {"warnings_count": 290}}


def test_elected_is_undefined_for_runoff_and_federal_requires_br(tmp_path):
    rows, _ = parse_file(write_csv(tmp_path / "consulta_cand_2099_BR.csv", CANDIDATES_COLUMNS, [ALFA, BETA]))
    assert [r.elected for r in rows] == [False, None]
    bad = write_csv(tmp_path / "x.csv", CANDIDATES_COLUMNS, [ALFA | {"SG_UE": "XX"}])
    with pytest.raises(CandidateRowError, match="federal contest"):
        parse_file(bad)


# ------------------------------------------------------------------ banco

psycopg = pytest.importorskip("psycopg")

from conftest import TEST_DATABASE_URL, reset_electoral_schema  # noqa: E402
from test_cadaster_store import load_cadaster, load_territories, manifest  # noqa: E402
from test_open_data_pipeline import prepared  # noqa: E402

from src.electoral.candidates.store import (  # noqa: E402
    CandidacyConflict,
    import_candidates,
    link_votables,
)
from src.electoral.open_data.store import import_prepared  # noqa: E402

db = pytest.mark.skipif(not TEST_DATABASE_URL, reason="REPBRASIL_ELECTORAL_TEST_DATABASE_URL not set")


@pytest.fixture
def conn():
    assert TEST_DATABASE_URL
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True, options="-c search_path=electoral,public") as c:
        reset_electoral_schema(c)
        c.execute('TRUNCATE "Persons", "Politicians", "Sources" CASCADE')
        load_territories(c)
        load_cadaster(c)
        yield c


def run_import(conn, tmp_path, br, xx, history=(), sha="c", supersede=False, key=KEY):
    tmp_path.mkdir(parents=True, exist_ok=True)
    br_rows, layout = parse_file(write_csv(tmp_path / "consulta_cand_2099_BR.csv", CANDIDATES_COLUMNS, br))
    xx_rows, _ = parse_file(write_csv(tmp_path / "consulta_cand_2099_XX.csv", CANDIDATES_COLUMNS, xx))
    hist, hist_layout = parse_history_file(write_csv(tmp_path / "historico_candidatura_2099_XX.csv", HISTORY_COLUMNS, list(history)))
    return import_candidates(
        conn, year=2099, turn=1, units={"BR", "XX"}, candidates=br_rows + xx_rows,
        candidates_manifest=manifest("tse-open-data-candidates", sha), candidates_layout=layout,
        history=hist, history_manifest=manifest("tse-open-data-candidacy-history", "d"), history_layout=hist_layout,
        key=key, supersede=supersede,
    )


def candidacy(conn, sq: int):
    return conn.execute(
        """SELECT c.identity_status, c.person_id, c.politician_id, p."NormalizedDocumentHash", c.source_member, c.source_line
             FROM candidacy c LEFT JOIN "Persons" p ON p."Id" = c.person_id WHERE c.tse_candidate_id = %s""",
        (sq,),
    ).fetchone()


@db
def test_identity_follows_each_rows_own_document_even_when_lines_collide(conn, tmp_path):
    """Regressão: BR e XX têm as MESMAS linhas físicas (2, 3); cada candidatura fica com o seu CPF."""
    report = run_import(conn, tmp_path, [ALFA, BETA], [GAMA, DELTA, SEM_DOC])
    assert report["status"] == "succeeded" and report["inserted"] == 5
    assert report["identity"] == {"resolved": 4, "unresolved_document_unavailable": 1}
    for row in (ALFA, BETA, GAMA, DELTA):
        status, person, politician, digest, _, _ = candidacy(conn, int(row["SQ_CANDIDATO"]))
        assert status == "resolved" and politician is not None
        assert digest == identity.document_hash(KEY, row["NR_CPF_CANDIDATO"])
    assert candidacy(conn, 9001)[4:] == ("consulta_cand_2099_BR.csv", 2)
    assert candidacy(conn, 9101)[4:] == ("consulta_cand_2099_XX.csv", 2)
    status, person, politician, *_ = candidacy(conn, 9103)
    assert (status, person, politician) == ("unresolved_document_unavailable", None, None)
    # o CPF nunca é gravado
    dump = conn.execute("SELECT string_agg(row_to_json(c)::text, '') FROM candidacy c").fetchone()[0]
    assert ALFA["NR_CPF_CANDIDATO"] not in dump
    # idempotência
    assert run_import(conn, tmp_path / "again", [ALFA, BETA], [GAMA, DELTA, SEM_DOC])["status"] == "already_imported"
    assert conn.execute("SELECT count(*) FROM candidacy").fetchone()[0] == 5


@db
def test_official_history_links_an_existing_profile_and_never_steals_another_persons(conn, tmp_path):
    existing = conn.execute(
        """INSERT INTO "Politicians" ("Id", "Name", "BallotName", "TseId", "CreatedAt", "UpdatedAt")
           VALUES (gen_random_uuid(), 'Deputada Gama (Vereadora 2096)', 'Gama', '700001', now(), now()) RETURNING "Id\""""
    ).fetchone()[0]
    other_person = conn.execute(
        """INSERT INTO "Persons" ("Id", "FullName", "CreatedAt", "UpdatedAt") VALUES (gen_random_uuid(), 'OUTRA PESSOA', now(), now())
           RETURNING "Id\""""
    ).fetchone()[0]
    taken = conn.execute(
        """INSERT INTO "Politicians" ("Id", "Name", "BallotName", "TseId", "PersonId", "CreatedAt", "UpdatedAt")
           VALUES (gen_random_uuid(), 'Outro Perfil', 'Outro', '700002', %s, now(), now()) RETURNING "Id\"""",
        (other_person,),
    ).fetchone()[0]
    report = run_import(conn, tmp_path, [ALFA, BETA], [GAMA], history=[history_row(9101, 700001), history_row(9002, 700002)])
    assert report["politicians_linked_by_history"] == 1
    assert report["identity_conflicts"] == [{"politician_id": str(taken), "tse_id": "700002", "reason": "profile already linked to another person"}]
    _, gama_person, gama_politician, *_ = candidacy(conn, 9101)
    assert gama_politician == existing
    assert conn.execute('SELECT "PersonId" FROM "Politicians" WHERE "Id" = %s', (existing,)).fetchone()[0] == gama_person
    # BETA: perfil de outra pessoa não é reaproveitado nem duplicado
    status, beta_person, beta_politician, *_ = candidacy(conn, 9002)
    assert status == "resolved" and beta_person is not None and beta_politician is None
    assert conn.execute('SELECT "PersonId" FROM "Politicians" WHERE "Id" = %s', (taken,)).fetchone()[0] == other_person
    # ALFA: sem histórico ⇒ perfil novo a partir da candidatura oficial
    assert report["politicians_created"] == 1
    row = conn.execute(
        """SELECT p."TseId", p."Office", p."State" FROM candidacy c JOIN "Politicians" p ON p."Id" = c.politician_id
            WHERE c.tse_candidate_id = 9001"""
    ).fetchone()
    assert row == ("9001", "PRESIDENTE", "BR")


@db
def test_newer_file_that_changes_a_candidacy_needs_supersede(conn, tmp_path):
    run_import(conn, tmp_path / "a", [ALFA, BETA], [GAMA])
    changed = BETA | {"CD_SIT_TOT_TURNO": "1", "DS_SIT_TOT_TURNO": "ELEITO"}
    with pytest.raises(CandidacyConflict) as exc:
        run_import(conn, tmp_path / "b", [ALFA, changed], [GAMA], sha="e")
    assert exc.value.diff == [{"tse_candidate_id": 9002, "changes": {
        "round_outcome_code": [6, 1], "round_outcome": ["2º TURNO", "ELEITO"], "elected": [None, True]}}]
    assert conn.execute("SELECT elected FROM candidacy WHERE tse_candidate_id = 9002").fetchone()[0] is None
    report = run_import(conn, tmp_path / "c", [ALFA, changed], [GAMA], sha="e", supersede=True)
    assert report["superseded"] == 1 and report["unchanged"] == 2
    assert conn.execute("SELECT elected FROM candidacy WHERE tse_candidate_id = 9002").fetchone()[0] is True


@db
def test_votables_link_by_contest_and_number_without_touching_votes(conn, tmp_path):
    assert import_prepared(conn, prepared(tmp_path / "bu"))["status"] == "succeeded"
    votes_before = conn.execute("SELECT count(*), sum(votes) FROM section_office_vote").fetchone()
    twin = state(9104, 1111, "OUTRA PESSOA COM O MESMO NÚMERO", "DEPUTADA FICTÍCIA GAMA", cpf(100000005))
    run_import(conn, tmp_path / "cand", [ALFA, BETA], [GAMA, twin, DELTA])
    report = link_votables(conn, year=2099, turn=1, uf="XX")
    assert report["votables"] == 4 and report["linked"] == 2  # ALFA e BETA (federal ⇒ disputa BR)
    assert [a["number"] for a in report["ambiguous"]] == [1111]  # duas candidaturas com o mesmo número
    assert [(m["number"], m["ballot_name"]) for m in report["name_mismatch"]] == [(2222, "DEPUTADO DELTA")]
    assert report["unmatched"] == []
    linked = conn.execute(
        """SELECT v.number, c.tse_candidate_id FROM votable_candidacy vc JOIN votable v ON v.id = vc.votable_id
             JOIN candidacy c ON c.id = vc.candidacy_id ORDER BY 1"""
    ).fetchall()
    assert linked == [(11, 9001), (22, 9002)]
    assert conn.execute("SELECT count(*), sum(votes) FROM section_office_vote").fetchone() == votes_before
    assert link_votables(conn, year=2099, turn=1, uf="XX")["status"] == "already_imported"


@db
def test_a_different_hmac_key_on_the_same_database_is_refused(conn, tmp_path):
    """Trocar a chave em silêncio criaria pessoas duplicadas: a importação recusa."""
    from src.electoral.candidates.store import CandidatesError

    first = run_import(conn, tmp_path / "a", [ALFA], [GAMA])
    assert first["key_fingerprint"] == identity.key_fingerprint(KEY)
    assert first["key_fingerprint"] not in KEY.decode() and len(first["key_fingerprint"]) == 16
    with pytest.raises(CandidatesError, match="REPBRASIL_PERSON_DOCUMENT_KEY"):
        run_import(conn, tmp_path / "b", [ALFA, BETA], [GAMA], sha="e", key=b"z" * 32)
    assert conn.execute('SELECT count(*) FROM "Persons"').fetchone()[0] == 2
    # mesma chave continua aceita
    assert run_import(conn, tmp_path / "c", [ALFA, BETA], [GAMA], sha="e")["status"] == "succeeded"


@db
def test_import_skips_rows_of_another_round_and_reports_them(conn, tmp_path):
    report = run_import(conn, tmp_path, [ALFA, BETA, BETA | RUNOFF], [GAMA])
    assert report["status"] == "succeeded" and report["candidacies"] == 3
    assert report["other_turn_rows"] == {"2": 1}
    assert conn.execute("SELECT count(*) FROM candidacy WHERE tse_candidate_id = 9002").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM contest WHERE tse_election_code = 999003").fetchone()[0] == 0

