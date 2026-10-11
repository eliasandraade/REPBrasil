"""Base Eleitoral no escopo frio: a posição calculada no lake (Polars sobre Parquet) segue a MESMA regra do SQL
do backend. Os números espelham ElectoralXraySchemaTests.Contest_stats_rank_every_voted_candidate_number_per_territory
(dados fictícios)."""

from __future__ import annotations

import polars as pl
import pytest

from src.electoral.lake_query import contest_stats_frame

# votáveis: 1 = candidata A (alvo), 2 = candidato B; a legenda já foi excluída pelo filtro de números de candidatura
VOTES = pl.DataFrame(
    {
        "result_id": [100, 100, 101, 101, 104],
        "votable_id": [1, 2, 1, 2, 2],
        "votes": [10, 20, 5, 5, 4],
    }
).lazy()
RESULTS = pl.DataFrame(
    {
        "result_id": [100, 101, 104],
        "municipality_tse_code": ["99991"] * 3,
        "zone": [1, 1, 1],
        "section": [100, 101, 104],
        "place": ["1001", "1001", "1001"],
    }
)


def test_section_stats_rank_ties_and_absent_target_votes() -> None:
    rows = {r["section"]: r for r in contest_stats_frame(VOTES, RESULTS, target_votable_ids={1}, level="section")}
    assert (rows[100]["ahead"], rows[100]["targetVotes"], rows[100]["leaderVotes"]) == (1, 10, 20)
    assert (rows[101]["ahead"], rows[101]["targetVotes"], rows[101]["bestOtherVotes"]) == (0, 5, 5)  # empate
    assert (rows[104]["ahead"], rows[104]["targetVotes"], rows[104]["contestants"]) == (1, 0, 1)
    assert all(r["placeCode"] == "" for r in rows.values())


def test_place_stats_sum_the_place_urns() -> None:
    (row,) = contest_stats_frame(VOTES, RESULTS, target_votable_ids={1}, level="place")
    assert (row["placeCode"], row["section"], row["targetVotes"], row["leaderVotes"], row["ahead"]) == ("1001", 0, 15, 29, 1)


def test_unknown_level_is_rejected() -> None:
    with pytest.raises(ValueError, match="level"):
        contest_stats_frame(VOTES, RESULTS, target_votable_ids={1}, level="zone")
