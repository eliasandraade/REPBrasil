from __future__ import annotations

import json
from decimal import Decimal

import pytest

from src.electoral.live_count import parse_live_result
from src.sources.tse.live_results import (
    accompaniment_url,
    official_2026_election_code,
    result_url,
)


def _payload(*, final: bool = False, votes: str = "", percentage: str = "") -> bytes:
    return json.dumps(
        {
            "ele": "6259",
            "t": "1",
            "and": "f" if final else "p",
            "dg": "04/10/2026",
            "hg": "18:00:00",
            "carg": [
                {
                    "cd": "3",
                    "agr": [
                        {
                            "par": [
                                {
                                    "sg": "ABC",
                                    "cand": [
                                        {
                                            "n": "55",
                                            "sqcand": "123456",
                                            "nmu": "CANDIDATA TESTE",
                                            "seq": "1",
                                            "vap": votes,
                                            "pvapn": percentage,
                                            "st": "2º turno",
                                        }
                                    ],
                                }
                            ]
                        }
                    ],
                }
            ],
            "s": {"ts": "100", "st": "50", "pstn": "50,0000"},
        },
        ensure_ascii=False,
    ).encode()


def test_official_2026_codes_follow_election_family() -> None:
    assert official_2026_election_code(1, 1) == 6257
    assert official_2026_election_code(1, 3) == 6259
    assert official_2026_election_code(2, 1) == 6258
    assert official_2026_election_code(2, 3) == 6260


def test_builds_official_result_urls_exactly() -> None:
    assert result_url(year=2026, election_code=6257, office_code=1) == (
        "https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/"
        "br-c0001-e006257-u.json"
    )
    assert result_url(
        year=2026,
        election_code=6259,
        office_code=5,
        uf="CE",
        municipality_tse_code="13897",
    ) == (
        "https://resultados.tse.jus.br/oficial/ele2026/6259/dados/ce/"
        "ce13897-c0005-e006259-u.json"
    )
    assert accompaniment_url(year=2026, election_code=6259, uf="CE").endswith(
        "/ce/ce-e006259-ab.json"
    )


def test_parser_keeps_unpublished_candidate_values_missing() -> None:
    parsed = parse_live_result(_payload(), office_code=3)
    candidate = parsed.candidates[0]
    assert parsed.status == "partial"
    assert parsed.total_sections == 100
    assert parsed.counted_sections == 50
    assert parsed.counted_percent == Decimal("50.0000")
    assert candidate.votes is None
    assert candidate.percentage is None


def test_parser_reads_final_candidate_observation() -> None:
    parsed = parse_live_result(
        _payload(final=True, votes="12345", percentage="51,2345"), office_code=3
    )
    assert parsed.status == "final"
    assert parsed.candidates[0].votes == 12345
    assert parsed.candidates[0].percentage == Decimal("51.2345")


def test_parser_fails_closed_on_layout_drift() -> None:
    with pytest.raises(ValueError, match="missing section totals"):
        parse_live_result(b'{"ele":"6259","t":"1","carg":[]}', office_code=3)
