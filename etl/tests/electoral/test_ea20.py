from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from urnai_ingest.ea20 import (
    EA20Result,
    EA20ZoneExpectation,
    EA20_OFFICE_CODES,
    ea20_zone_filename,
    validate_zone_result,
)


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "ea20-sample.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_parses_synthetic_zone_fixture_and_validates_expected_identity() -> None:
    document = EA20Result.model_validate(load_fixture())
    validate_zone_result(
        document,
        EA20ZoneExpectation(election=999999, zone=50, office_code=EA20_OFFICE_CODES["presidente"]),
    )
    assert document.s.ts == 30
    assert document.e.te == 8274
    assert document.e.c == 7000
    assert document.v.tv == 7000


def test_zone_filename_uses_official_padding() -> None:
    assert ea20_zone_filename(
        uf="CE",
        municipality_tse_code=13935,
        zone=50,
        office_code=1,
        election=6257,
    ) == "ce13935-z0050-c0001-e006257-u.json"


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("s", {"ts": 30, "st": 29, "snt": 0, "si": 29, "sni": 0, "sa": 29, "sna": 0}, "ts must equal st + snt"),
        ("e", {"te": 100, "est": 100, "esnt": 0, "esi": 100, "esni": 0, "esa": 100, "esna": 0, "c": 90, "a": 9}, "esi must equal c + a"),
        ("v", {"tv": 10, "vvc": 8, "vb": 1, "tvn": 0, "vscv": 0}, "tv must equal vvc + vb + tvn + vscv"),
    ],
)
def test_rejects_broken_accounting_hierarchies(field: str, value: dict, message: str) -> None:
    payload = load_fixture()
    payload[field] = value
    with pytest.raises(ValidationError, match=message.replace("+", r"\+")):
        EA20Result.model_validate(payload)


def test_rejects_wrong_scope_election_zone_and_office() -> None:
    document = EA20Result.model_validate(load_fixture())

    with pytest.raises(ValueError, match="zone mismatch"):
        validate_zone_result(document, EA20ZoneExpectation(election=999999, zone=51, office_code="0001"))
    with pytest.raises(ValueError, match="election mismatch"):
        validate_zone_result(document, EA20ZoneExpectation(election=999998, zone=50, office_code="0001"))
    with pytest.raises(ValueError, match="office 0003"):
        validate_zone_result(document, EA20ZoneExpectation(election=999999, zone=50, office_code="0003"))


def test_conditional_vote_fields_are_not_converted_to_zero() -> None:
    payload = load_fixture()
    payload["v"].pop("vnom")
    payload["v"].pop("vn")
    document = EA20Result.model_validate(payload)
    assert document.v.vnom is None
    assert document.v.vn is None


def test_vscv_requires_other_vote_quantities_to_be_zero() -> None:
    payload = load_fixture()
    payload["v"].update({"tv": 4, "vvc": 0, "vb": 0, "tvn": 0, "vscv": 4, "vv": 0, "vnom": 0, "van": 0, "vansj": 0, "vn": 0, "vnt": 0})
    document = EA20Result.model_validate(payload)
    assert document.v.vscv == 4

    payload["v"]["vb"] = 1
    payload["v"]["tv"] = 5
    with pytest.raises(ValidationError, match="vscv > 0"):
        EA20Result.model_validate(payload)
