from decimal import Decimal

import pytest

from src.sources.atlas import parse_atlas_rows


def test_atlas_parser_is_strict_and_preserves_decimal() -> None:
    rows = parse_atlas_rows(
        [{"municipality_ibge_code": "2304400", "period": "2010", "value": "0,754"}]
    )
    assert rows[0].value == Decimal("0.754")


def test_atlas_parser_fails_closed_on_column_drift() -> None:
    with pytest.raises(ValueError, match="columns missing"):
        parse_atlas_rows([{"municipality_ibge_code": "2304400", "period": 2010}])
