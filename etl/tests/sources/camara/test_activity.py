from src.sources.camara.activity import parse_proposition_rows
from src.sources.camara.api import CamaraPage


def test_parse_proposition_rows_uses_official_id_and_date() -> None:
    page = CamaraPage(
        url="https://dadosabertos.camara.leg.br/api/v2/deputados/123/proposicoes",
        status_code=200,
        content=b"{}",
        payload={
            "dados": [
                {
                    "id": 987,
                    "uri": "https://dadosabertos.camara.leg.br/api/v2/proposicoes/987",
                    "siglaTipo": "PL",
                    "numero": 42,
                    "ano": 2026,
                    "ementa": "Texto oficial",
                    "dataApresentacao": "2026-10-01T12:30:00",
                }
            ],
            "links": [],
        },
    )
    rows = parse_proposition_rows("123", [page])
    assert len(rows) == 1
    assert rows[0].external_id == "987"
    assert rows[0].title == "PL 42 2026"
    assert rows[0].occurred_at is not None


def test_parse_proposition_rows_fails_without_official_id() -> None:
    page = CamaraPage(
        url="https://dadosabertos.camara.leg.br/api/v2/deputados/123/proposicoes",
        status_code=200,
        content=b"{}",
        payload={"dados": [{"ementa": "Sem id"}], "links": []},
    )
    try:
        parse_proposition_rows("123", [page])
    except ValueError as exc:
        assert "official id" in str(exc)
    else:
        raise AssertionError("missing official id must fail closed")


def test_parse_proposition_rows_deduplicates_same_official_id_across_pages() -> None:
    row = {"id": 7, "ementa": "X", "dataApresentacao": None}
    pages = [
        CamaraPage("https://dadosabertos.camara.leg.br/api/v2/a", 200, b"{}", {"dados": [row]}),
        CamaraPage("https://dadosabertos.camara.leg.br/api/v2/b", 200, b"{}", {"dados": [row]}),
    ]
    assert len(parse_proposition_rows("123", pages)) == 1
