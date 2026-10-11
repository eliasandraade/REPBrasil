from decimal import Decimal

from src.pipeline.socioeconomic import (
    Observation,
    change_kind,
    derive_gdp_per_capita,
    payload_sha256,
)


def test_payload_hash_is_order_independent() -> None:
    a = Observation("2304400", 2022, Decimal("10"))
    b = Observation("2304707", 2022, Decimal("20"))
    assert payload_sha256([a, b]) == payload_sha256([b, a])


def test_changed_counts_only_real_value_changes() -> None:
    assert change_kind(None, Decimal("1")) == "inserted"
    assert change_kind(Decimal("1"), Decimal("1")) == "unchanged"
    assert change_kind(Decimal("1"), Decimal("2")) == "changed"


def test_gdp_per_capita_requires_same_municipality_and_period() -> None:
    gdp = [
        Observation("2304400", 2022, Decimal("2000")),
        Observation("2304707", 2022, Decimal("1000")),
    ]
    population = [
        Observation("2304400", 2022, Decimal("1000")),
        Observation("2304707", 2021, Decimal("500")),
    ]
    rows = derive_gdp_per_capita(gdp, population)
    assert rows == [Observation("2304400", 2022, Decimal("2000"))]
