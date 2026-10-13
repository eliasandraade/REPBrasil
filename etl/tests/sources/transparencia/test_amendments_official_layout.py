"""Parser contra o layout oficial do `EmendasParlamentares.csv` (CGU, verificado em 13/10/2026)."""

from decimal import Decimal

import pytest

from src.sources.transparencia.amendments import parse_amendments

HEADER = [
    "Código da Emenda",
    "Ano da Emenda",
    "Tipo de Emenda",
    "Código do Autor da Emenda",
    "Nome do Autor da Emenda",
    "Número da emenda",
    "Localidade de aplicação do recurso",
    "Código Município IBGE",
    "Município",
    "Código UF IBGE",
    "UF",
    "Região",
    "Código Função",
    "Nome Função",
    "Código Subfunção",
    "Nome Subfunção",
    "Código Programa",
    "Nome Programa",
    "Código Ação",
    "Nome Ação",
    "Código Plano Orçamentário",
    "Nome Plano Orçamentário",
    "Valor Empenhado",
    "Valor Liquidado",
    "Valor Pago",
    "Valor Restos A Pagar Inscritos",
    "Valor Restos A Pagar Cancelados",
    "Valor Restos A Pagar Pagos",
]
ABSENT = "Sem informação"


def _row(
    code,
    year,
    author,
    locality,
    municipality,
    state_code,
    uf,
    action,
    committed,
    paid,
    kind="Emenda Individual",
):
    values = dict.fromkeys(HEADER, "")
    values.update(
        {
            "Código da Emenda": code,
            "Ano da Emenda": year,
            "Tipo de Emenda": kind,
            "Nome do Autor da Emenda": author,
            "Localidade de aplicação do recurso": locality,
            "Código Município IBGE": municipality,
            "Código UF IBGE": state_code,
            "UF": uf,
            "Nome Ação": action,
            "Valor Empenhado": committed,
            "Valor Pago": paid,
        }
    )
    return ";".join(values[column] for column in HEADER)


def _csv(*rows: str) -> bytes:
    return ("\n".join([";".join(HEADER), *rows]) + "\n").encode("latin-1")


OFFICIAL = _csv(
    _row(
        "202523170001",
        "2025",
        "DEPUTADA EXEMPLO",
        "FORTALEZA - CE",
        "2304400",
        "2300000",
        "CEARÁ",
        "Saúde",
        "1300000,00",
        "487500,00",
    ),
    _row(
        "202523170002",
        "2025",
        "DEPUTADO EXEMPLO",
        "CEARÁ (UF)",
        ABSENT,
        "2300000",
        "CEARÁ",
        "Estradas",
        "300000,00",
        "0,00",
    ),
    _row(
        ABSENT,
        "2014",
        ABSENT,
        "SOBRAL - CE",
        "2312908",
        "2300000",
        "CEARÁ",
        "Urbanismo",
        "100000,00",
        "0,00",
    ),
    _row(
        "202523170003",
        "2025",
        "BANCADA",
        "MÚLTIPLO",
        ABSENT,
        "2300000",
        "CEARÁ",
        "Ação A",
        "100,50",
        "50,00",
        "Emenda de Bancada",
    ),
    _row(
        "202523170003",
        "2025",
        "BANCADA",
        "MÚLTIPLO",
        ABSENT,
        "2300000",
        "CEARÁ",
        "Ação B",
        "200,25",
        "0,00",
        "Transferência Especial",
    ),
    _row(
        "202535170001",
        "2025",
        "DEPUTADO PAULISTA",
        "SÃO PAULO - SP",
        "3550308",
        "3500000",
        "SÃO PAULO",
        "Saúde",
        "999,00",
        "0,00",
    ),
    _row(
        "202500000001",
        "2025",
        "RELATOR",
        "Nacional",
        ABSENT,
        "-1",
        ABSENT,
        "Programa",
        "10,00",
        "0,00",
    ),
    _row(
        "202500000002",
        "2025",
        "RELATOR",
        "MÚLTIPLO",
        ABSENT,
        "-14",
        "Múltiplo",
        "Programa",
        "20,00",
        "0,00",
    ),
)


def test_official_layout_scoped_to_ceara() -> None:
    parsed = parse_amendments(OFFICIAL, state_ibge_code="23")
    records = {row.external_id: row for row in parsed.records}

    assert parsed.rows_read == 8
    assert parsed.rows_in_scope == 5
    assert parsed.rows_without_official_identifier == 1
    assert parsed.multi_row_amendments == 1
    assert set(records) == {"202523170001", "202523170002", "202523170003"}

    fortaleza = records["202523170001"]
    assert fortaleza.municipality_ibge_code == "2304400"
    assert fortaleza.locality == "FORTALEZA - CE"
    assert (fortaleza.committed_amount, fortaleza.paid_amount) == (
        Decimal("1300000.00"),
        Decimal("487500.00"),
    )


def test_official_absence_marker_is_absence_never_a_code_or_zero() -> None:
    record = {
        row.external_id: row for row in parse_amendments(OFFICIAL, state_ibge_code="23").records
    }["202523170002"]
    assert record.municipality_ibge_code is None
    assert record.paid_amount == Decimal("0.00")  # zero publicado continua zero


def test_amendment_split_across_budget_lines_is_one_amendment() -> None:
    record = {
        row.external_id: row for row in parse_amendments(OFFICIAL, state_ibge_code="23").records
    }["202523170003"]
    assert record.committed_amount == Decimal("300.75")
    assert record.paid_amount == Decimal("50.00")
    assert record.amendment_type == "Emenda de Bancada | Transferência Especial"
    assert record.municipality_ibge_code is None
    assert len(record.raw["rows"]) == 2


def test_split_amendment_with_an_unpublished_line_has_no_total() -> None:
    content = _csv(
        _row(
            "1", "2025", "A", "FORTALEZA - CE", "2304400", "2300000", "CEARÁ", "X", "10,00", "1,00"
        ),
        _row(
            "1", "2025", "A", "FORTALEZA - CE", "2304400", "2300000", "CEARÁ", "Y", ABSENT, "2,00"
        ),
    )
    record = parse_amendments(content, state_ibge_code="23").records[0]
    assert record.committed_amount is None
    assert record.paid_amount == Decimal("3.00")
    assert record.municipality_ibge_code == "2304400"


def test_national_and_multi_state_scopes_never_belong_to_a_state() -> None:
    national = parse_amendments(OFFICIAL)
    assert {"202500000001", "202500000002"} <= {row.external_id for row in national.records}
    scoped = parse_amendments(OFFICIAL, state_ibge_code="23")
    assert not {"202500000001", "202500000002"} & {row.external_id for row in scoped.records}


def test_conflicting_author_for_the_same_official_code_fails_closed() -> None:
    content = _csv(
        _row(
            "1", "2025", "A", "FORTALEZA - CE", "2304400", "2300000", "CEARÁ", "X", "10,00", "1,00"
        ),
        _row(
            "1", "2025", "B", "FORTALEZA - CE", "2304400", "2300000", "CEARÁ", "Y", "10,00", "1,00"
        ),
    )
    with pytest.raises(ValueError, match="conflicting author or year"):
        parse_amendments(content, state_ibge_code="23")


def test_scoping_requires_an_official_territorial_column() -> None:
    content = "Código da Emenda;Nome do Autor da Emenda;Ano da Emenda\n1;A;2025\n".encode("latin-1")
    with pytest.raises(ValueError, match="no official territorial code"):
        parse_amendments(content, state_ibge_code="23")
