from __future__ import annotations

import io
import zipfile

import pytest

from src.electoral.poll_registry import parse_poll_registry_archive


def _archive(csv_text: str, *, year: int = 2026) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            f"pesquisa_eleitoral_{year}_BRASIL.csv",
            csv_text.encode("utf-8"),
        )
    return buffer.getvalue()


def test_normalizes_official_registry_metadata_without_inventing_results() -> None:
    content = _archive(
        "NR_PROTOCOLO_REGISTRO;NM_EMPRESA;NM_EMPRESA_FANTASIA;NR_CNPJ_EMPRESA;"
        "DS_CARGO;DT_INICIO_PESQUISA;DT_FIM_PESQUISA;DT_DIVULGACAO;"
        "QT_ENTREVISTADO;DS_METODOLOGIA_PESQUISA;SG_UF;NM_UE\n"
        "CE000012026;EMPRESA TESTE LTDA;Instituto Teste;12345678000199;Governador;"
        "01/09/2026;03/09/2026;04/09/2026;1.200;Entrevistas presenciais;CE;CE\n"
        "BR000022026;EMPRESA BRASIL LTDA;;98765432000199;Presidente;"
        "02/09/2026;05/09/2026;;2000;Entrevistas telefônicas;BR;BR\n"
    )

    parsed = parse_poll_registry_archive(content, year=2026, uf_filter="CE")

    record = parsed.rows[0]
    assert len(parsed.rows) == 1
    assert record.registration_number == "CE000012026"
    assert record.office_code == 3
    assert record.state_code == "CE"
    assert record.municipality_tse_code is None
    assert record.institute_name == "Instituto Teste"
    assert record.institute_slug == "tse-12345678000199"
    assert record.sample_size == 1200
    assert record.published_at is not None
    assert record.published_at.isoformat() == "2026-09-04T00:00:00-03:00"
    assert record.scenarios == ()
    assert parsed.warnings == ()


def test_can_filter_national_registry_rows() -> None:
    content = _archive(
        "NR_PROTOCOLO_REGISTRO;NM_EMPRESA;DS_CARGO;DT_INICIO_PESQUISA;"
        "DT_FIM_PESQUISA;SG_UF;NM_UE\n"
        "CE000012026;EMPRESA CE;Governador;01/09/2026;03/09/2026;CE;CE\n"
        "BR000022026;EMPRESA BR;Presidente;02/09/2026;05/09/2026;BR;BR\n"
    )

    parsed = parse_poll_registry_archive(content, year=2026, uf_filter="BR")

    record = parsed.rows[0]
    assert len(parsed.rows) == 1
    assert record.registration_number == "BR000022026"
    assert record.state_code is None
    assert record.office_code == 1


def test_negative_official_sample_is_audited_missing_not_zero() -> None:
    content = _archive(
        "NR_PROTOCOLO_REGISTRO;NM_EMPRESA;DS_CARGO;DT_INICIO_PESQUISA;"
        "DT_FIM_PESQUISA;QT_ENTREVISTADO;SG_UF;NM_UE\n"
        "BR093812026;MEDIA - INTELIGENCIA EM PESQUISA LTDA;Presidente;"
        "01/09/2026;03/09/2026;-2000;BR;BR\n"
    )

    parsed = parse_poll_registry_archive(content, year=2026, uf_filter="BR")

    assert len(parsed.rows) == 1
    assert parsed.rows[0].sample_size is None
    assert len(parsed.warnings) == 1
    warning = parsed.warnings[0]
    assert warning.line_number == 2
    assert warning.registration_number == "BR093812026"
    assert warning.field == "QT_ENTREVISTADO"
    assert warning.raw_value == "-2000"
    assert warning.action == "stored_as_missing"


def test_malformed_sample_still_fails_closed() -> None:
    content = _archive(
        "NR_PROTOCOLO_REGISTRO;NM_EMPRESA;DS_CARGO;DT_INICIO_PESQUISA;"
        "DT_FIM_PESQUISA;QT_ENTREVISTADO;SG_UF;NM_UE\n"
        "BR000022026;EMPRESA BR;Presidente;02/09/2026;05/09/2026;abc;BR;BR\n"
    )

    with pytest.raises(ValueError, match="invalid integer"):
        parse_poll_registry_archive(content, year=2026, uf_filter="BR")


def test_expands_multiple_known_offices_without_name_linking() -> None:
    content = _archive(
        "NR_PROTOCOLO_REGISTRO;NM_EMPRESA;DS_CARGOS;DT_INICIO_PESQUISA;"
        "DT_FIM_PESQUISA;SG_UF;NM_UE\n"
        "CE000032026;EMPRESA CE;Governador / Senador;01/09/2026;03/09/2026;CE;CE\n"
    )

    parsed = parse_poll_registry_archive(content, year=2026, uf_filter="CE")

    assert [record.office_code for record in parsed.rows] == [3, 5]
    assert all(record.scenarios == () for record in parsed.rows)


def test_fails_closed_when_office_column_drifts() -> None:
    content = _archive(
        "NR_PROTOCOLO_REGISTRO;NM_EMPRESA;CARGO_NOVO;DT_INICIO_PESQUISA;"
        "DT_FIM_PESQUISA;SG_UF;NM_UE\n"
        "CE000012026;EMPRESA CE;Governador;01/09/2026;03/09/2026;CE;CE\n"
    )

    with pytest.raises(ValueError, match="missing office column"):
        parse_poll_registry_archive(content, year=2026)
