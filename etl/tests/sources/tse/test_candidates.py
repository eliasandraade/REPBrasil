from uuid import UUID as _UUID

import polars as pl
import pytest

from src.sources.tse.candidates import TseCandidatesPipeline


@pytest.fixture
def pipeline() -> TseCandidatesPipeline:
    return TseCandidatesPipeline(limit=10)


@pytest.fixture
def sample_df() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "SQ_CANDIDATO": ["123456", "789012"],
            "NM_CANDIDATO": ["JOAO DA SILVA", "MARIA SOUZA"],
            "NM_URNA_CANDIDATO": ["JOAO SILVA", "MARIA SOUZA"],
            "SG_UF": ["SP", "RJ"],
            "SG_PARTIDO": ["PT", "PSDB"],
            "NM_PARTIDO": ["Partido dos Trabalhadores", "PSDB"],
            "DS_CARGO": ["DEPUTADO FEDERAL", "SENADOR"],
            "DS_SITUACAO_CANDIDATURA": ["APTO", "DEFERIDO"],
        }
    )


def test_transform_returns_list(pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame) -> None:
    result = pipeline.transform(sample_df)
    assert isinstance(result, list)
    assert len(result) == 2


def test_transform_normalizes_names(
    pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    assert result[0]["name"] == "Joao Da Silva"
    assert result[0]["ballot_name"] == "Joao Silva"


def test_transform_sets_tse_id(
    pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    assert result[0]["tse_id"] == "123456"


def test_transform_filters_invalid_status(pipeline: TseCandidatesPipeline) -> None:
    df = pl.DataFrame(
        {
            "SQ_CANDIDATO": ["111"],
            "NM_CANDIDATO": ["CANDIDATO INVALIDO"],
            "NM_URNA_CANDIDATO": ["INVALIDO"],
            "DS_SITUACAO_CANDIDATURA": ["INDEFERIDO"],
        }
    )
    result = pipeline.transform(df)
    assert len(result) == 0


def test_transform_generates_uuid(
    pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    _UUID(result[0]["id"])  # raises ValueError if not a valid UUID


def test_transform_handles_missing_columns(pipeline: TseCandidatesPipeline) -> None:
    df = pl.DataFrame(
        {
            "SQ_CANDIDATO": ["999"],
            "NM_CANDIDATO": ["TESTE"],
            "NM_URNA_CANDIDATO": ["TESTE"],
        }
    )
    result = pipeline.transform(df)
    assert len(result) == 1
    assert result[0]["tse_id"] == "999"


def test_transform_includes_electoral_fields(
    pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    assert result[0]["state"] == "SP"
    assert result[0]["party_acronym"] == "PT"
    assert result[0]["party_name"] == "Partido dos Trabalhadores"
    assert result[0]["office"] == "DEPUTADO FEDERAL"
    assert result[0]["candidacy_status"] == "APTO"


def test_transform_electoral_fields_none_when_columns_missing(
    pipeline: TseCandidatesPipeline,
) -> None:
    df = pl.DataFrame(
        {
            "SQ_CANDIDATO": ["555"],
            "NM_CANDIDATO": ["SEM PARTIDO"],
            "NM_URNA_CANDIDATO": ["SEM PARTIDO"],
            "DS_SITUACAO_CANDIDATURA": ["DEFERIDO"],
        }
    )
    result = pipeline.transform(df)
    assert result[0]["state"] is None
    assert result[0]["party_acronym"] is None
    assert result[0]["party_name"] is None
    assert result[0]["office"] is None


def test_transform_upsert_preserves_created_at_key(
    pipeline: TseCandidatesPipeline, sample_df: pl.DataFrame
) -> None:
    result = pipeline.transform(sample_df)
    assert "created_at" in result[0]
    assert "updated_at" in result[0]
