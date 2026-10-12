from __future__ import annotations

import argparse

import pytest

from scripts.ingest_live_results import resolve_election_code, validate_args


def _args(**overrides: object) -> argparse.Namespace:
    values: dict[str, object] = {
        "office": 3,
        "watch_seconds": 0,
        "until_final": False,
        "municipality_tse_code": None,
        "uf": "CE",
    }
    values.update(overrides)
    return argparse.Namespace(**values)


def test_resolves_audited_2026_code_without_manual_override() -> None:
    assert resolve_election_code(
        year=2026,
        round_number=1,
        office=3,
        explicit=None,
    ) == 6259


def test_requires_explicit_code_outside_2026_mapping() -> None:
    with pytest.raises(ValueError, match="required outside"):
        resolve_election_code(
            year=2028,
            round_number=1,
            office=3,
            explicit=None,
        )


def test_watch_interval_cannot_run_faster_than_fifteen_seconds() -> None:
    with pytest.raises(ValueError, match="at least 15"):
        validate_args(_args(watch_seconds=5))


def test_until_final_requires_watch_mode() -> None:
    with pytest.raises(ValueError, match="requires --watch-seconds"):
        validate_args(_args(until_final=True))


def test_municipality_requires_uf() -> None:
    with pytest.raises(ValueError, match="requires --uf"):
        validate_args(_args(municipality_tse_code="13897", uf=None))
