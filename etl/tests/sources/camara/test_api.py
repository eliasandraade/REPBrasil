import pytest
from unittest.mock import MagicMock, patch
from src.sources.camara.api import fetch_deputies, CAMARA_API_BASE


def _make_page(dados: list, has_next: bool) -> dict:
    links = [{"rel": "self", "href": "..."}]
    if has_next:
        links.append({"rel": "next", "href": "..."})
    return {"dados": dados, "links": links, "meta": {"totalItens": len(dados)}}


def test_fetch_deputies_single_page(mocker):
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = _make_page(
        [{"id": 1, "nome": "João"}, {"id": 2, "nome": "Maria"}], has_next=False
    )
    mocker.patch("httpx.get", return_value=mock_response)
    result = fetch_deputies(legislature=57)
    assert len(result) == 2
    assert result[0]["id"] == 1


def test_fetch_deputies_paginates_until_no_next(mocker):
    page1 = _make_page([{"id": i} for i in range(500)], has_next=True)
    page2 = _make_page([{"id": 500}], has_next=False)
    mock_get = mocker.patch("httpx.get")
    mock_get.side_effect = [
        MagicMock(raise_for_status=MagicMock(), json=MagicMock(return_value=page1)),
        MagicMock(raise_for_status=MagicMock(), json=MagicMock(return_value=page2)),
    ]
    result = fetch_deputies(legislature=57)
    assert len(result) == 501
    assert mock_get.call_count == 2


def test_fetch_deputies_empty_dados_stops(mocker):
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"dados": [], "links": [], "meta": {}}
    mocker.patch("httpx.get", return_value=mock_response)
    result = fetch_deputies(legislature=57)
    assert result == []


def test_fetch_deputies_uses_correct_params(mocker):
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = _make_page([], has_next=False)
    mock_get = mocker.patch("httpx.get", return_value=mock_response)
    fetch_deputies(legislature=57)
    call_kwargs = mock_get.call_args
    params = call_kwargs.kwargs.get("params", {})
    assert params.get("idLegislatura") == 57
    assert params.get("itens") == 500
