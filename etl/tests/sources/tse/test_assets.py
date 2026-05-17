from decimal import Decimal
from unittest.mock import MagicMock

import polars as pl
import pytest

from src.sources.tse.assets import TseAssetsPipeline, _parse_br_decimal


# --- _parse_br_decimal ---

def test_parse_br_decimal_integer():
    assert _parse_br_decimal("1234") == Decimal("1234")

def test_parse_br_decimal_thousands_and_cents():
    assert _parse_br_decimal("1.234,56") == Decimal("1234.56")

def test_parse_br_decimal_zero():
    assert _parse_br_decimal("0,00") == Decimal("0")

def test_parse_br_decimal_none_returns_zero():
    assert _parse_br_decimal(None) == Decimal("0")

def test_parse_br_decimal_empty_returns_zero():
    assert _parse_br_decimal("") == Decimal("0")


# --- TseAssetsPipeline.transform ---

def _make_raw(rows: list[dict]) -> pl.DataFrame:
    return pl.DataFrame(rows, schema={
        "SQ_CANDIDATO": pl.Utf8,
        "NR_ORDEM_BEM_CANDIDATO": pl.Utf8,
        "CD_TIPO_BEM_CANDIDATO": pl.Utf8,
        "DS_TIPO_BEM_CANDIDATO": pl.Utf8,
        "DS_BEM_CANDIDATO": pl.Utf8,
        "VR_BEM_CANDIDATO": pl.Utf8,
    })

def test_transform_single_candidate_two_items():
    raw = _make_raw([
        {"SQ_CANDIDATO": "111", "NR_ORDEM_BEM_CANDIDATO": "1", "CD_TIPO_BEM_CANDIDATO": "01",
         "DS_TIPO_BEM_CANDIDATO": "Imóvel", "DS_BEM_CANDIDATO": "Casa", "VR_BEM_CANDIDATO": "500.000,00"},
        {"SQ_CANDIDATO": "111", "NR_ORDEM_BEM_CANDIDATO": "2", "CD_TIPO_BEM_CANDIDATO": "02",
         "DS_TIPO_BEM_CANDIDATO": "Veículo", "DS_BEM_CANDIDATO": "Carro", "VR_BEM_CANDIDATO": "50.000,00"},
    ])
    pipeline = TseAssetsPipeline()
    result = pipeline.transform(raw)
    assert len(result) == 1
    decl = result[0]
    assert decl["tse_id"] == "111"
    assert decl["total_value"] == Decimal("550000.00")
    assert len(decl["items"]) == 2

def test_transform_skips_empty_tse_id():
    raw = _make_raw([
        {"SQ_CANDIDATO": "", "NR_ORDEM_BEM_CANDIDATO": "1", "CD_TIPO_BEM_CANDIDATO": "01",
         "DS_TIPO_BEM_CANDIDATO": "X", "DS_BEM_CANDIDATO": "Y", "VR_BEM_CANDIDATO": "100,00"},
    ])
    result = TseAssetsPipeline().transform(raw)
    assert result == []

def test_transform_respects_limit():
    rows = [
        {"SQ_CANDIDATO": str(i), "NR_ORDEM_BEM_CANDIDATO": "1", "CD_TIPO_BEM_CANDIDATO": "01",
         "DS_TIPO_BEM_CANDIDATO": "X", "DS_BEM_CANDIDATO": "Y", "VR_BEM_CANDIDATO": "100,00"}
        for i in range(10)
    ]
    raw = _make_raw(rows)
    result = TseAssetsPipeline(limit=3).transform(raw)
    assert len(result) == 3


# --- batch_size constructor ---

def test_default_batch_size():
    assert TseAssetsPipeline().batch_size == 250


def test_custom_batch_size():
    assert TseAssetsPipeline(batch_size=50).batch_size == 50


def test_transform_unaffected_by_batch_size():
    """batch_size afeta apenas load(), não transform()."""
    raw = _make_raw([
        {"SQ_CANDIDATO": "111", "NR_ORDEM_BEM_CANDIDATO": "1", "CD_TIPO_BEM_CANDIDATO": "01",
         "DS_TIPO_BEM_CANDIDATO": "Imóvel", "DS_BEM_CANDIDATO": "Casa",
         "VR_BEM_CANDIDATO": "100,00"},
    ])
    result_default = TseAssetsPipeline().transform(raw)
    result_batch = TseAssetsPipeline(batch_size=1).transform(raw)
    assert len(result_default) == len(result_batch) == 1


# --- load() ---

def test_load_empty_data_skips_db(mocker):
    """load() com lista vazia não deve abrir conexão DB."""
    mock_get_db_batch = mocker.patch("src.sources.tse.assets.get_db_batch")
    TseAssetsPipeline().load([])
    mock_get_db_batch.assert_not_called()


def test_load_calls_commit_per_batch(mocker):
    """Verifica que commit é chamado a cada batch_size declarações + source commit."""
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value = mock_cur
    # Politician lookup retorna 3 políticos
    mock_cur.fetchall.return_value = [("111", "uid-1"), ("222", "uid-2"), ("333", "uid-3")]
    mock_cur.fetchone.return_value = ("decl-uid",)

    mock_ctx = MagicMock()
    mock_ctx.__enter__ = MagicMock(return_value=mock_conn)
    mock_ctx.__exit__ = MagicMock(return_value=False)

    mocker.patch("src.sources.tse.assets.get_db_batch", return_value=mock_ctx)
    mocker.patch("src.sources.tse.assets._compute_sha256", return_value="abc")
    mocker.patch("src.sources.tse.assets._get_file_size", return_value=1024)

    data = [
        {"tse_id": "111", "year": 2024, "source_election_year": "2024",
         "total_value": Decimal("1000"), "items": []},
        {"tse_id": "222", "year": 2024, "source_election_year": "2024",
         "total_value": Decimal("2000"), "items": []},
        {"tse_id": "333", "year": 2024, "source_election_year": "2024",
         "total_value": Decimal("3000"), "items": []},
    ]

    # batch_size=2: source_commit + batch1(decls 0,1) + batch_final(decl 2) = 3 commits total
    TseAssetsPipeline(batch_size=2).load(data)
    assert mock_conn.commit.call_count == 3
