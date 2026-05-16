from decimal import Decimal

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
        "NR_ORDEM_BEM": pl.Utf8,
        "CD_TIPO_BEM": pl.Utf8,
        "DS_TIPO_BEM": pl.Utf8,
        "DS_BEM": pl.Utf8,
        "VR_BEM_CANDIDATO": pl.Utf8,
    })

def test_transform_single_candidate_two_items():
    raw = _make_raw([
        {"SQ_CANDIDATO": "111", "NR_ORDEM_BEM": "1", "CD_TIPO_BEM": "01",
         "DS_TIPO_BEM": "Imóvel", "DS_BEM": "Casa", "VR_BEM_CANDIDATO": "500.000,00"},
        {"SQ_CANDIDATO": "111", "NR_ORDEM_BEM": "2", "CD_TIPO_BEM": "02",
         "DS_TIPO_BEM": "Veículo", "DS_BEM": "Carro", "VR_BEM_CANDIDATO": "50.000,00"},
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
        {"SQ_CANDIDATO": "", "NR_ORDEM_BEM": "1", "CD_TIPO_BEM": "01",
         "DS_TIPO_BEM": "X", "DS_BEM": "Y", "VR_BEM_CANDIDATO": "100,00"},
    ])
    result = TseAssetsPipeline().transform(raw)
    assert result == []

def test_transform_respects_limit():
    rows = [
        {"SQ_CANDIDATO": str(i), "NR_ORDEM_BEM": "1", "CD_TIPO_BEM": "01",
         "DS_TIPO_BEM": "X", "DS_BEM": "Y", "VR_BEM_CANDIDATO": "100,00"}
        for i in range(10)
    ]
    raw = _make_raw(rows)
    result = TseAssetsPipeline(limit=3).transform(raw)
    assert len(result) == 3
