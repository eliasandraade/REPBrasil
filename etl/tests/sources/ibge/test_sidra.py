from decimal import Decimal

import pytest

from src.sources.ibge.sidra import build_sidra_url, parse_sidra_payload, parse_sidra_value


def test_sidra_missing_markers_are_not_zero() -> None:
    assert parse_sidra_value("-") == Decimal(0)
    assert parse_sidra_value("..") is None
    assert parse_sidra_value("...") is None
    assert parse_sidra_value("X") is None
    assert parse_sidra_value("") is None


def test_sidra_payload_skips_header_and_missing_observations() -> None:
    payload = [
        {"D1C": "Município", "D2C": "Ano", "V": "Valor"},
        {"D1C": "2304400", "D2C": "2022", "V": "123,45"},
        {"D1C": "2304707", "D2C": "2022", "V": "..."},
        {"D1C": "2304806", "D2C": "2022", "V": "-"},
    ]
    rows = parse_sidra_payload(payload)
    assert [(r.municipality_ibge_code, r.period, r.value) for r in rows] == [
        ("2304400", 2022, Decimal("123.45")),
        ("2304806", 2022, Decimal(0)),
    ]


def test_sidra_url_re_emits_validated_integers() -> None:
    assert build_sidra_url(table=5938, variable=37, period=2022).endswith("/t/5938/n6/all/v/37/p/2022")
    with pytest.raises(ValueError):
        build_sidra_url(table=5938, variable=37, period=9999)
