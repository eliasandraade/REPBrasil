from decimal import Decimal

import pytest

from src.sources.transparencia.amendments import parse_amendments_csv


def test_parse_amendments_csv_preserves_official_values() -> None:
    content = (
        "Código da Emenda;Nome do Autor da Emenda;Ano da Emenda;Tipo de Emenda;"
        "Valor Empenhado;Valor Pago;Nome do Beneficiário;Código IBGE do Município\n"
        "20260001;Maria Exemplo;2026;Individual;1.234,56;789,10;Município X;2304400\n"
    ).encode()
    rows = parse_amendments_csv(content)
    assert len(rows) == 1
    assert rows[0].external_id == "20260001"
    assert rows[0].author_name == "Maria Exemplo"
    assert rows[0].municipality_ibge_code == "2304400"
    assert rows[0].committed_amount == Decimal("1234.56")
    assert rows[0].paid_amount == Decimal("789.10")


def test_parse_amendments_csv_fails_when_official_identity_columns_are_missing() -> None:
    content = b"Autor;Valor Pago\nMaria;10,00\n"
    with pytest.raises(ValueError, match="missing required fields"):
        parse_amendments_csv(content)


def test_parse_amendments_csv_does_not_turn_missing_money_into_zero() -> None:
    content = (
        "Código da Emenda;Nome do Autor da Emenda;Ano da Emenda;Valor Pago\n"
        "1;Maria;2026;\n"
    ).encode()
    rows = parse_amendments_csv(content)
    assert rows[0].paid_amount is None
    assert rows[0].municipality_ibge_code is None


def test_parse_amendments_csv_rejects_invalid_official_municipality_code() -> None:
    content = (
        "Código da Emenda;Nome do Autor da Emenda;Ano da Emenda;Código IBGE do Município\n"
        "1;Maria;2026;Fortaleza\n"
    ).encode()
    with pytest.raises(ValueError, match="invalid official municipality IBGE code"):
        parse_amendments_csv(content)
