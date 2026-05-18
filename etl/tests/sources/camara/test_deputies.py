import pytest
from unittest.mock import MagicMock, patch
from src.sources.camara.deputies import CamaraDeputadosPipeline


# ─── collect ───────────────────────────────────────────────────────────────────

def test_collect_returns_list_of_deputies(mocker):
    mocker.patch(
        "src.sources.camara.deputies.fetch_deputies",
        return_value=[{"id": 1, "nome": "Teste", "siglaUf": "CE", "siglaPartido": "PT"}],
    )
    p = CamaraDeputadosPipeline()
    result = p.collect()
    assert isinstance(result, list)
    assert result[0]["id"] == 1


# ─── transform ─────────────────────────────────────────────────────────────────

def _make_tse_row(name, ballot, state, party, pid="uuid-1"):
    return {"Id": pid, "Name": name, "BallotName": ballot, "State": state, "PartyAcronym": party}


def test_transform_returns_dict_with_matched_unmatched_ambiguous(mocker):
    mocker.patch(
        "src.sources.camara.deputies.fetch_tse_federal_deputies",
        return_value=[_make_tse_row("JOSE SILVA", "ZE", "CE", "PT")],
    )
    camara = [{"id": 100, "nome": "Jose Silva", "siglaUf": "CE", "siglaPartido": "PT"}]
    result = CamaraDeputadosPipeline().transform(camara)
    assert "matched" in result
    assert "unmatched" in result
    assert "ambiguous" in result


def test_transform_matched_has_correct_fields(mocker):
    mocker.patch(
        "src.sources.camara.deputies.fetch_tse_federal_deputies",
        return_value=[_make_tse_row("JOSE SILVA", "ZE", "CE", "PT")],
    )
    camara = [{"id": 100, "nome": "Jose Silva", "siglaUf": "CE", "siglaPartido": "PT"}]
    result = CamaraDeputadosPipeline().transform(camara)
    assert len(result["matched"]) == 1
    m = result["matched"][0]
    assert m["politician_id"] == "uuid-1"
    assert m["camara_id"] == "100"
    assert m["confidence_level"] == 5
    assert m["match_method"] == "full_3way"
    assert "camara_photo_url" in m


def test_transform_unmatched_no_camara_id(mocker):
    mocker.patch(
        "src.sources.camara.deputies.fetch_tse_federal_deputies",
        return_value=[_make_tse_row("NINGUEM AQUI", "NINGUEM", "AC", "PT")],
    )
    camara = [{"id": 999, "nome": "Outro Nome", "siglaUf": "RO", "siglaPartido": "PT"}]
    result = CamaraDeputadosPipeline().transform(camara)
    assert len(result["unmatched"]) == 1
    assert len(result["matched"]) == 0


def test_transform_summary_logged(mocker, caplog):
    mocker.patch("src.sources.camara.deputies.fetch_tse_federal_deputies", return_value=[])
    CamaraDeputadosPipeline().transform([])
    # Sem crash em inputs vazios
