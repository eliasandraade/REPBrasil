import polars as pl
import pytest

from src.sources.tse.results import TseResultsPipeline


@pytest.fixture
def pipeline() -> TseResultsPipeline:
    return TseResultsPipeline()


@pytest.fixture
def sample_df() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "SQ_CANDIDATO": ["123456", "123456", "789012"],
            "NR_TURNO": ["1", "1", "1"],
            "SG_UF": ["SP", "SP", "RJ"],
            "NM_UE": ["SAO PAULO", "SAO PAULO", "RIO DE JANEIRO"],
            "DS_CARGO": ["VEREADOR", "VEREADOR", "PREFEITO"],
            "QT_VOTOS_NOMINAIS_VALIDOS": ["500", "300", "1200"],
            "DS_SIT_TOT_TURNO": ["ELEITO", "ELEITO", "NÃO ELEITO"],
        }
    )


def test_transform_returns_list(pipeline: TseResultsPipeline, sample_df: pl.DataFrame) -> None:
    result = pipeline.transform(sample_df)
    assert isinstance(result, list)
    assert len(result) == 2  # 123456 SP + 789012 RJ (agregados)


def test_transform_aggregates_votes_from_zones(
    pipeline: TseResultsPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    sp = next(r for r in result if r["tse_id"] == "123456")
    assert sp["total_votes"] == 800  # 500 + 300


def test_transform_sets_year_2024(
    pipeline: TseResultsPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    assert all(r["year"] == 2024 for r in result)


def test_transform_elected_true_when_eleito(
    pipeline: TseResultsPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    sp = next(r for r in result if r["tse_id"] == "123456")
    assert sp["elected"] is True
    rj = next(r for r in result if r["tse_id"] == "789012")
    assert rj["elected"] is False


def test_transform_skips_empty_tse_id(pipeline: TseResultsPipeline) -> None:
    df = pl.DataFrame(
        {
            "SQ_CANDIDATO": [""],
            "NR_TURNO": ["1"],
            "SG_UF": ["SP"],
            "NM_UE": ["SAO PAULO"],
            "DS_CARGO": ["VEREADOR"],
            "QT_VOTOS_NOMINAIS_VALIDOS": ["100"],
            "DS_SIT_TOT_TURNO": ["NÃO ELEITO"],
        }
    )
    result = pipeline.transform(df)
    assert len(result) == 0


def test_transform_handles_missing_columns(pipeline: TseResultsPipeline) -> None:
    df = pl.DataFrame(
        {
            "SQ_CANDIDATO": ["999"],
            "NR_TURNO": ["1"],
        }
    )
    result = pipeline.transform(df)
    assert isinstance(result, list)
    assert len(result) == 1


def test_transform_respects_limit(pipeline: TseResultsPipeline, sample_df: pl.DataFrame) -> None:
    limited = TseResultsPipeline(limit=1)
    result = limited.transform(sample_df)
    assert len(result) == 1


def test_transform_elected_for_eleito_por_qp(pipeline: TseResultsPipeline) -> None:
    df = pl.DataFrame(
        {
            "SQ_CANDIDATO": ["555"],
            "NR_TURNO": ["1"],
            "SG_UF": ["MG"],
            "NM_UE": ["BELO HORIZONTE"],
            "DS_CARGO": ["VEREADOR"],
            "QT_VOTOS_NOMINAIS_VALIDOS": ["200"],
            "DS_SIT_TOT_TURNO": ["ELEITO POR QP"],
        }
    )
    result = pipeline.transform(df)
    assert len(result) == 1
    assert result[0]["elected"] is True


def test_transform_nao_eleito_is_not_elected(pipeline: TseResultsPipeline) -> None:
    df = pl.DataFrame(
        {
            "SQ_CANDIDATO": ["777"],
            "NR_TURNO": ["1"],
            "SG_UF": ["RS"],
            "NM_UE": ["PORTO ALEGRE"],
            "DS_CARGO": ["VEREADOR"],
            "QT_VOTOS_NOMINAIS_VALIDOS": ["50"],
            "DS_SIT_TOT_TURNO": ["NÃO ELEITO"],
        }
    )
    result = pipeline.transform(df)
    assert len(result) == 1
    assert result[0]["elected"] is False
