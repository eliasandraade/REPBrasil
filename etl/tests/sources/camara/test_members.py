from __future__ import annotations

import json
from datetime import date

import httpx
import pytest

from src.sources.camara.activity import fetch_deputy_propositions
from src.sources.camara.api import CamaraApi
from src.sources.camara.members import fetch_state_deputies, parse_deputy

BASE = "https://dadosabertos.camara.leg.br/api/v2"


def _detail(
    deputy_id: int, *, name: str, party: str, uf: str = "CE", photo: str | None = None
) -> dict:
    return {
        "dados": {
            "id": deputy_id,
            "uri": f"{BASE}/deputados/{deputy_id}",
            "nomeCivil": f"{name.upper()} CIVIL",
            "cpf": "12345678901",
            "dataNascimento": "1980-01-01",
            "ultimoStatus": {
                "id": deputy_id,
                "uri": f"{BASE}/deputados/{deputy_id}",
                "nome": name,
                "nomeEleitoral": name,
                "siglaPartido": party,
                "siglaUf": uf,
                "idLegislatura": 57,
                "situacao": "Exercício",
                "condicaoEleitoral": "Titular",
                "data": "2023-02-01",
                "urlFoto": photo
                or f"https://www.camara.leg.br/internet/deputado/bandep/{deputy_id}.jpg",
            },
        },
        "links": [],
    }


def _listing(rows: list[dict]) -> dict:
    return {"dados": rows, "links": [{"rel": "self", "href": f"{BASE}/deputados"}]}


def _api(handler) -> CamaraApi:
    return CamaraApi(
        httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _seconds: None
    )


def test_deputy_keeps_official_status_and_never_personal_documents() -> None:
    deputy = parse_deputy(_detail(204549, name="AJ Albuquerque", party="PP"), uf="CE")
    assert (deputy.external_id, deputy.parliamentary_name, deputy.party_acronym) == (
        "204549",
        "AJ Albuquerque",
        "PP",
    )
    assert deputy.name == "AJ ALBUQUERQUE CIVIL"
    serialized = json.dumps(deputy.raw)
    assert "12345678901" not in serialized
    assert "dataNascimento" not in serialized


def test_photo_outside_the_official_camara_path_is_dropped() -> None:
    deputy = parse_deputy(
        _detail(1, name="X", party="Y", photo="https://evil.example/x.jpg"), uf="CE"
    )
    assert deputy.photo_url is None


def test_state_listing_dedupes_registrations_and_uses_the_detail_status() -> None:
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        if request.url.path == "/api/v2/deputados":
            assert request.url.params["siglaUf"] == "CE"
            assert request.url.params["idLegislatura"] == "57"
            return httpx.Response(
                200,
                json=_listing(
                    [
                        {
                            "id": 62881,
                            "nome": "Danilo Forte",
                            "siglaPartido": "UNIÃO",
                            "siglaUf": "CE",
                        },
                        {
                            "id": 62881,
                            "nome": "Danilo Forte",
                            "siglaPartido": "PP",
                            "siglaUf": "CE",
                        },
                        {
                            "id": 204549,
                            "nome": "AJ Albuquerque",
                            "siglaPartido": "PP",
                            "siglaUf": "CE",
                        },
                    ]
                ),
            )
        deputy_id = int(request.url.path.rsplit("/", 1)[-1])
        party = "UNIÃO" if deputy_id == 62881 else "PP"
        return httpx.Response(
            200, json=_detail(deputy_id, name=f"Deputado {deputy_id}", party=party)
        )

    deputies, content, urls = fetch_state_deputies(_api(handler), "CE", 57)

    assert [deputy.external_id for deputy in deputies] == ["62881", "204549"]
    assert deputies[0].party_acronym == "UNIÃO"
    assert len(urls) == 3
    assert (
        content == fetch_state_deputies(_api(handler), "CE", 57)[1]
    )  # bytes canônicos determinísticos


def test_state_listing_refuses_rows_from_another_state() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_listing([{"id": 1, "nome": "X", "siglaUf": "SP"}]))

    with pytest.raises(ValueError, match="outside the requested UF"):
        fetch_state_deputies(_api(handler), "CE", 57)


def test_propositions_are_queried_per_year_and_cut_by_the_official_presentation_date() -> None:
    seen: list[httpx.Request] = []

    def proposition(official_id: int, presented: str) -> dict:
        return {
            "id": official_id,
            "uri": f"{BASE}/proposicoes/{official_id}",
            "siglaTipo": "PL",
            "numero": official_id,
            "ano": int(presented[:4]),
            "ementa": "Texto oficial",
            "dataApresentacao": presented,
        }

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        year = request.url.params["ano"]
        rows = {
            "2023": [proposition(1, "2023-01-20T10:00"), proposition(2, "2023-04-25T15:59")],
            "2024": [proposition(3, "2024-06-01T09:00")],
        }.get(year, [])
        return httpx.Response(200, json={"dados": rows, "links": []})

    activities, _content, urls = fetch_deputy_propositions(
        _api(handler), "204554", presented_from=date(2023, 2, 1), presented_to=date(2024, 12, 31)
    )

    assert [request.url.path for request in seen] == ["/api/v2/proposicoes"] * 2
    assert [request.url.params["ano"] for request in seen] == ["2023", "2024"]
    assert {request.url.params["idDeputadoAutor"] for request in seen} == {"204554"}
    assert all("dataApresentacaoInicio" not in request.url.params for request in seen)
    assert [activity.external_id for activity in activities] == ["2", "3"]
    assert len(urls) == 2


def test_propositions_interval_must_be_ordered() -> None:
    with pytest.raises(ValueError, match="interval"):
        fetch_deputy_propositions(
            _api(lambda _r: httpx.Response(200)),
            "1",
            presented_from=date(2026, 1, 2),
            presented_to=date(2026, 1, 1),
        )


def test_transient_gateway_errors_are_retried_but_client_errors_are_not() -> None:
    calls = {"count": 0}

    def flaky(_request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] < 3:
            return httpx.Response(504)
        return httpx.Response(200, json={"dados": [], "links": []})

    assert _api(flaky).fetch_all("/deputados")[0].status_code == 200
    assert calls["count"] == 3

    calls["count"] = 0

    def missing(_request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(405)

    with pytest.raises(httpx.HTTPStatusError):
        _api(missing).fetch_all("/deputados/1/proposicoes")
    assert calls["count"] == 1
