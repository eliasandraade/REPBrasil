from decimal import Decimal

import pytest

from src.pipeline.socioeconomic import Observation
from src.pipeline.socioelectoral_ingestion import (
    _derived_content,
    _official_rows,
    derive_illiteracy_rate,
)
from src.sources.ibge.sidra import SidraFetch, SidraObservation


def test_official_rows_fail_closed_on_missing_municipality() -> None:
    fetched = SidraFetch(
        url="https://apisidra.ibge.gov.br/values/test",
        content=b"[]",
        observations=[SidraObservation("2304400", 2022, Decimal("95.1"))],
    )

    with pytest.raises(ValueError, match="incomplete SIDRA snapshot"):
        _official_rows(
            fetched,
            allowed_codes={"2304400", "2304707"},
            period=2022,
            minimum=Decimal(0),
            maximum=Decimal(100),
        )


def test_official_rows_reject_duplicate_municipality_period() -> None:
    fetched = SidraFetch(
        url="https://apisidra.ibge.gov.br/values/test",
        content=b"[]",
        observations=[
            SidraObservation("2304400", 2022, Decimal("95.1")),
            SidraObservation("2304400", 2022, Decimal("94.9")),
        ],
    )

    with pytest.raises(ValueError, match="duplicated"):
        _official_rows(
            fetched,
            allowed_codes={"2304400"},
            period=2022,
        )


def test_illiteracy_is_exact_complement_without_rounding() -> None:
    rows = [Observation("2304400", 2022, Decimal("91.53"))]
    result = derive_illiteracy_rate(rows)
    assert result == [Observation("2304400", 2022, Decimal("8.47"))]


def test_derived_content_changes_when_official_payload_changes() -> None:
    left = _derived_content(b"official-v1", formula="100 - literacy")
    right = _derived_content(b"official-v2", formula="100 - literacy")
    assert left != right
