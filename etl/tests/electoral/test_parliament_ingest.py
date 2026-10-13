"""Ingestão do Parlamento (Câmara + Portal da Transparência) contra o banco de teste.

As fontes oficiais são simuladas por httpx.MockTransport com os layouts reais (verificados em
13/10/2026). Testes de banco: REPBRASIL_ELECTORAL_TEST_DATABASE_URL (banco *_test).
"""
from __future__ import annotations

import hashlib
import io
import zipfile
from datetime import date

import httpx
import pytest

from src.pipeline.parliament_ingest import AMENDMENTS_URL, ingest_parliament
from src.sources.camara.api import CamaraApi

psycopg = pytest.importorskip("psycopg")

from conftest import TEST_DATABASE_URL, reset_electoral_schema  # noqa: E402

db = pytest.mark.skipif(not TEST_DATABASE_URL, reason="REPBRASIL_ELECTORAL_TEST_DATABASE_URL not set")

BASE = "https://dadosabertos.camara.leg.br/api/v2"
ZIP_URL = "https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/emendas-parlamentares/EmendasParlamentares.zip"
HEADER = (
    "Código da Emenda;Ano da Emenda;Tipo de Emenda;Nome do Autor da Emenda;"
    "Localidade de aplicação do recurso;Código Município IBGE;Código UF IBGE;UF;Valor Empenhado;Valor Pago"
)


def _zip(*rows: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("EmendasParlamentares.csv", ("\n".join([HEADER, *rows]) + "\n").encode("latin-1"))
    return buffer.getvalue()


FIRST_EDITION = _zip(
    "202523170001;2025;Individual;DEPUTADA A;FORTALEZA - CE;2304400;2300000;CEARÁ;1000,00;400,00",
    "202523170002;2025;Individual;DEPUTADO B;CEARÁ (UF);Sem informação;2300000;CEARÁ;500,00;0,00",
    "Sem informação;2014;Individual;Sem informação;SOBRAL - CE;2312908;2300000;CEARÁ;100,00;0,00",
    "202535170001;2025;Individual;DEPUTADO SP;SÃO PAULO - SP;3550308;3500000;SÃO PAULO;9,00;0,00",
)
SECOND_EDITION = _zip(
    "202523170001;2025;Individual;DEPUTADA A;FORTALEZA - CE;2304400;2300000;CEARÁ;1200,00;600,00",
)


def _detail(deputy_id: int, party: str) -> dict:
    status = {
        "id": deputy_id, "uri": f"{BASE}/deputados/{deputy_id}", "nome": f"Deputado {deputy_id}",
        "nomeEleitoral": f"Deputado {deputy_id}", "siglaPartido": party, "siglaUf": "CE", "idLegislatura": 57,
        "situacao": "Exercício", "condicaoEleitoral": "Titular", "data": "2023-02-01",
        "urlFoto": f"https://www.camara.leg.br/internet/deputado/bandep/{deputy_id}.jpg",
    }
    return {"dados": {"id": deputy_id, "uri": status["uri"], "nomeCivil": f"CIVIL {deputy_id}", "cpf": "12345678901",
                      "ultimoStatus": status}, "links": []}


def _handler(zip_bytes: bytes, *, redirect_to: str = ZIP_URL, seen: list[str] | None = None):
    def handle(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if seen is not None:
            seen.append(request.url.host)
        if url.startswith(AMENDMENTS_URL):
            return httpx.Response(302, headers={"Location": redirect_to})
        if url.startswith(ZIP_URL):
            return httpx.Response(200, content=zip_bytes, headers={"Last-Modified": "Sat, 10 Oct 2026 02:57:21 GMT"})
        if request.url.path == "/api/v2/deputados":
            return httpx.Response(200, json={"dados": [
                {"id": 1001, "nome": "Deputado 1001", "siglaPartido": "AAA", "siglaUf": "CE"},
                {"id": 1001, "nome": "Deputado 1001", "siglaPartido": "BBB", "siglaUf": "CE"},
                {"id": 1002, "nome": "Deputado 1002", "siglaPartido": "CCC", "siglaUf": "CE"},
            ], "links": []})
        if request.url.path.startswith("/api/v2/deputados/"):
            deputy_id = int(request.url.path.rsplit("/", 1)[-1])
            return httpx.Response(200, json=_detail(deputy_id, "BBB" if deputy_id == 1001 else "CCC"))
        if request.url.path == "/api/v2/proposicoes":
            author = int(request.url.params["idDeputadoAutor"])
            return httpx.Response(200, json={"dados": [{
                "id": author * 10, "uri": f"{BASE}/proposicoes/{author * 10}", "siglaTipo": "PL",
                "numero": author, "ano": 2025, "ementa": "Ementa oficial", "dataApresentacao": "2025-03-01T10:00",
            }], "links": []})
        return httpx.Response(404)
    return handle


def _ingest(conn, zip_bytes: bytes, **kwargs):
    transport = httpx.MockTransport(_handler(zip_bytes, **kwargs))
    with CamaraApi(httpx.Client(transport=transport), sleep=lambda _s: None) as camara, \
            httpx.Client(transport=transport) as http:
        return ingest_parliament(
            conn, uf="CE", legislature=57, presented_from=date(2023, 2, 1), presented_to=date(2026, 10, 13),
            camara=camara, http=http,
        )


@pytest.fixture
def conn():
    assert TEST_DATABASE_URL
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True, options="-c search_path=electoral,public") as c:
        reset_electoral_schema(c)
        yield c


@db
def test_members_are_official_unlinked_entities_without_personal_documents(conn) -> None:
    summary = _ingest(conn, FIRST_EDITION)

    assert summary["members"] == 2
    rows = conn.execute(
        "SELECT external_id, party_acronym, identity_method, person_id, raw::text FROM parliament_member ORDER BY external_id"
    ).fetchall()
    assert [(r[0], r[1], r[2], r[3]) for r in rows] == [("1001", "BBB", "unlinked", None), ("1002", "CCC", "unlinked", None)]
    assert all("12345678901" not in r[4] for r in rows)
    assert summary["activities"] == 2


@db
def test_amendments_edition_keeps_official_provenance_and_scope(conn) -> None:
    summary = _ingest(conn, FIRST_EDITION)

    assert summary["amendments"] == {
        "rows_read": 4, "rows_in_scope": 3, "rows_without_official_identifier": 1,
        "multi_row_amendments": 0, "amendments": 2, "with_municipality": 1,
    }
    source = conn.execute(
        "SELECT source_url, sha256, parser_version, metadata FROM parliament_source WHERE dataset = 'emendas-parlamentares:CE'"
    ).fetchone()
    assert source[0] == ZIP_URL
    assert source[1] == hashlib.sha256(FIRST_EDITION).hexdigest()
    assert source[2] == "parliament-v1"
    assert source[3]["last_modified"] == "Sat, 10 Oct 2026 02:57:21 GMT"
    # Escopo oficial da edição: é ele que recorta /amendments?uf=CE (inclusive sem município).
    assert source[3]["uf"] == "CE"
    amendments = conn.execute(
        "SELECT external_id, municipality_ibge_code, committed_amount FROM parliament_amendment ORDER BY external_id"
    ).fetchall()
    assert [(a[0], a[1]) for a in amendments] == [("202523170001", "2304400"), ("202523170002", None)]


@db
def test_rerun_with_the_same_official_bytes_is_idempotent(conn) -> None:
    _ingest(conn, FIRST_EDITION)
    before = conn.execute("SELECT (SELECT count(*) FROM parliament_source), (SELECT count(*) FROM parliament_amendment)").fetchone()
    _ingest(conn, FIRST_EDITION)
    after = conn.execute("SELECT (SELECT count(*) FROM parliament_source), (SELECT count(*) FROM parliament_amendment)").fetchone()
    assert after == before


@db
def test_new_official_edition_is_added_and_the_previous_one_preserved(conn) -> None:
    _ingest(conn, FIRST_EDITION)
    _ingest(conn, SECOND_EDITION)

    editions = conn.execute(
        "SELECT count(*) FROM parliament_source WHERE dataset = 'emendas-parlamentares:CE'"
    ).fetchone()[0]
    assert editions == 2
    history = conn.execute(
        "SELECT count(*) FROM parliament_amendment WHERE external_id = '202523170002'"
    ).fetchone()[0]
    assert history == 1


@db
def test_download_redirected_outside_official_hosts_is_refused(conn) -> None:
    seen: list[str] = []
    with pytest.raises(ValueError, match="unexpected amendments download host"):
        _ingest(
            conn,
            FIRST_EDITION,
            redirect_to="https://evil.example/EmendasParlamentares.zip",
            seen=seen,
        )
    assert "evil.example" not in seen
    assert "portaldatransparencia.gov.br" in seen
    assert conn.execute("SELECT count(*) FROM parliament_amendment").fetchone()[0] == 0
