from decimal import Decimal

from src.pipeline.socioeconomic import (
    Observation,
    change_kind,
    content_sha256,
    derive_gdp_per_capita,
)


def test_source_hash_uses_acquired_bytes_not_only_numeric_observations() -> None:
    first = b'{"D1C":"2304400","V":"1","note":"release-a"}'
    second = b'{"D1C":"2304400","V":"1","note":"release-b"}'
    expected = "d49523ebbf3d856f377b74d259919b1493922fb6b5009599c4a7a1863c252947"
    assert content_sha256(first) != content_sha256(second)
    assert content_sha256(first) == expected


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
