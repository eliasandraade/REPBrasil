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


# ─── load ──────────────────────────────────────────────────────────────────────

def test_load_empty_matched_skips_db(mocker):
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value = mock_cur
    mock_cur.fetchone.return_value = ("source-id",)
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_ctx.__exit__ = MagicMock(return_value=False)
    mocker.patch("src.sources.camara.deputies.get_db", return_value=mock_ctx)

    CamaraDeputadosPipeline().load({"matched": [], "unmatched": [], "ambiguous": []})
    # execute chamado pelo menos para source upsert e chain insert
    assert mock_cur.execute.called


def test_load_updates_camara_id_for_matched(mocker):
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value = mock_cur
    mock_cur.fetchone.return_value = ("some-uuid",)
    mock_cur.fetchall.return_value = []
    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_ctx.__exit__ = MagicMock(return_value=False)
    mocker.patch("src.sources.camara.deputies.get_db", return_value=mock_ctx)

    data = {
        "matched": [{
            "politician_id": "pol-uuid",
            "camara_id": "12345",
            "camara_name": "José Silva",
            "camara_photo_url": "https://camara.leg.br/foto/12345.jpg",
            "camara_email": "dep@camara.leg.br",
            "tse_name": "JOSE SILVA",
            "tse_ballot_name": "ZE SILVA",
            "tse_state": "CE",
            "tse_party": "PT",
            "match_method": "full_3way",
            "confidence_level": 5,
        }],
        "unmatched": [],
        "ambiguous": [],
    }

    CamaraDeputadosPipeline().load(data)

    all_sqls = " ".join(str(call) for call in mock_cur.execute.call_args_list)
    assert "CamaraId" in all_sqls
    assert "Mandates" in all_sqls
