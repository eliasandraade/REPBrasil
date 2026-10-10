"""Prestação de contas: parser, privacidade e seleção do envio — dados SINTÉTICOS no layout oficial."""
from __future__ import annotations

import io
from decimal import Decimal

import pytest

from src.electoral.finance.parser import (
    CONTRACTED_COLUMNS,
    PAID_COLUMNS,
    REVENUE_COLUMNS,
    iter_member,
    parse_row,
)
from src.electoral.finance.store import select_rows
from src.electoral.open_data.layout import LayoutError

DONOR_CPF = "52998224725"  # CPF fictício com dígitos verificadores válidos
CANDIDATE_CPF = "11144477735"

COMMON = {
    "DT_GERACAO": "01/01/2099", "HH_GERACAO": "10:00:00", "AA_ELEICAO": "2098", "CD_TIPO_ELEICAO": "2",
    "NM_TIPO_ELEICAO": "Ordinária", "CD_ELEICAO": "999619", "DS_ELEICAO": "Fictícia", "DT_ELEICAO": "04/10/2098",
    "ST_TURNO": "1", "TP_PRESTACAO_CONTAS": "Final", "DT_PRESTACAO_CONTAS": "01/11/2098", "SQ_PRESTADOR_CONTAS": "5001",
    "SG_UF": "XX",
}
CANDIDATE = {
    "SG_UE": "99999", "NM_UE": "MUNICÍPIO FICTÍCIO", "NR_CNPJ_PRESTADOR_CONTA": "00000000000191", "CD_CARGO": "13",
    "DS_CARGO": "Vereador", "SQ_CANDIDATO": "700001", "NR_CANDIDATO": "12345", "NM_CANDIDATO": "CANDIDATA FICTÍCIA",
    "NR_CPF_CANDIDATO": CANDIDATE_CPF, "NR_CPF_VICE_CANDIDATO": "-4", "NR_PARTIDO": "12", "SG_PARTIDO": "PF",
    "NM_PARTIDO": "PARTIDO FICTÍCIO",
}


def revenue(**kw: str) -> list[str]:
    values = dict.fromkeys(REVENUE_COLUMNS, "#NULO") | COMMON | CANDIDATE | {
        "CD_FONTE_RECEITA": "1", "DS_FONTE_RECEITA": "OUTROS RECURSOS", "CD_ORIGEM_RECEITA": "10010200",
        "DS_ORIGEM_RECEITA": "Recursos de pessoas físicas", "NR_CPF_CNPJ_DOADOR": DONOR_CPF, "NM_DOADOR": "DOADORA FICTÍCIA",
        "SQ_CANDIDATO_DOADOR": "-1", "NR_CANDIDATO_DOADOR": "-1", "CD_CNAE_DOADOR": "-1", "CD_ESFERA_PARTIDARIA_DOADOR": "-1",
        "CD_MUNICIPIO_DOADOR": "-1", "CD_CARGO_CANDIDATO_DOADOR": "-1", "NR_PARTIDO_DOADOR": "-1", "SQ_RECEITA": "41618168",
        "DT_RECEITA": "16/08/2098", "DS_RECEITA": "DOAÇÃO; contato doadora@example.org", "VR_RECEITA": "500,00",
        "CD_NATUREZA_RECEITA": "0", "CD_ESPECIE_RECEITA": "2", "DS_GENERO": "SENSÍVEL", "DS_COR_RACA": "SENSÍVEL",
        "NM_MUNICIPIO_DOADOR": "PESSOAL", "SG_UF_DOADOR": "XX",
    } | kw
    return [values[c] for c in REVENUE_COLUMNS]


def contracted(**kw: str) -> list[str]:
    values = dict.fromkeys(CONTRACTED_COLUMNS, "#NULO") | COMMON | CANDIDATE | {
        "CD_TIPO_FORNECEDOR": "1", "DS_TIPO_FORNECEDOR": "PESSOA JURÍDICA", "CD_CNAE_FORNECEDOR": "1813001",
        "NR_CPF_CNPJ_FORNECEDOR": "11222333000181", "NM_FORNECEDOR": "GRÁFICA FICTÍCIA LTDA", "SQ_CANDIDATO_FORNECEDOR": "-1",
        "NR_CANDIDATO_FORNECEDOR": "-1", "CD_ESFERA_PART_FORNECEDOR": "-1", "CD_MUNICIPIO_FORNECEDOR": "-1",
        "CD_CARGO_FORNECEDOR": "-1", "NR_PARTIDO_FORNECEDOR": "-1", "CD_ORIGEM_DESPESA": "20140000",
        "DS_ORIGEM_DESPESA": "Publicidade por materiais impressos", "SQ_DESPESA": "64127817", "DT_DESPESA": "20/08/2098",
        "DS_DESPESA": "SANTINHOS", "VR_DESPESA_CONTRATADA": "1.234,56",
    } | kw
    return [values[c] for c in CONTRACTED_COLUMNS]


def paid(**kw: str) -> list[str]:
    values = dict.fromkeys(PAID_COLUMNS, "#NULO") | COMMON | {
        "CD_FONTE_DESPESA": "1", "DS_FONTE_DESPESA": "Outros Recursos", "CD_ORIGEM_DESPESA": "20140000",
        "DS_ORIGEM_DESPESA": "Publicidade por materiais impressos", "CD_NATUREZA_DESPESA": "1", "CD_ESPECIE_RECURSO": "19",
        "SQ_DESPESA": "64127817", "SQ_PARCELAMENTO_DESPESA": "1", "DT_PAGTO_DESPESA": "21/08/2098", "VR_PAGTO_DESPESA": "534,00",
    } | kw
    return [values[c] for c in PAID_COLUMNS]


def test_revenue_keeps_only_public_fields_and_never_the_documents():
    r = parse_row("revenue", revenue(), 2, REVENUE_COLUMNS, "receitas_candidatos_2098_XX.csv")
    assert (r.amount, r.category, r.counterparty_kind, r.counterparty_cnpj) == (Decimal("500.00"), "Recursos de pessoas físicas", "person", None)
    assert r.document_digits == DONOR_CPF  # só em memória, para o HMAC
    persisted = repr(r) + str(r.payload) + str(r.description)
    for secret in (DONOR_CPF, CANDIDATE_CPF, "SENSÍVEL", "PESSOAL", "doadora@example.org"):
        assert secret not in persisted
    assert r.content_hash("hmac-a") != r.content_hash("hmac-b")  # o documento (como HMAC) diferencia doadores homônimos
    regenerated = parse_row("revenue", revenue(DT_GERACAO="02/01/2099"), 2, REVENUE_COLUMNS, "x.csv")
    assert regenerated.content_hash("h") == r.content_hash("h")


def test_supplier_company_keeps_the_public_cnpj():
    r = parse_row("expense_contracted", contracted(), 2, CONTRACTED_COLUMNS, "despesas_contratadas_candidatos_2098_XX.csv")
    assert (r.counterparty_kind, r.counterparty_cnpj, r.amount) == ("company", "11222333000181", Decimal("1234.56"))


def test_paid_expenses_link_through_the_accounts_provider_and_one_submission_wins():
    rows = [
        parse_row("revenue", revenue(), 2, REVENUE_COLUMNS, "r.csv"),
        parse_row("expense_contracted", contracted(), 2, CONTRACTED_COLUMNS, "c.csv"),
        parse_row("expense_paid", paid(), 2, PAID_COLUMNS, "p.csv"),
        # prestador sem receita/despesa contratada: despesa paga sem vínculo (contada)
        parse_row("expense_paid", paid(SQ_PRESTADOR_CONTAS="5999"), 3, PAID_COLUMNS, "p.csv"),
        # envio parcial do mesmo candidato (outro prestador): perde para a final
        parse_row("revenue", revenue(SQ_PRESTADOR_CONTAS="5002", TP_PRESTACAO_CONTAS="Parcial", SQ_RECEITA="9"), 4, REVENUE_COLUMNS, "r.csv"),
        # eleição suplementar: fora do pleito
        parse_row("revenue", revenue(CD_TIPO_ELEICAO="1", CD_ELEICAO="996223"), 5, REVENUE_COLUMNS, "r.csv"),
        parse_row("revenue", revenue(SG_UF="YY"), 6, REVENUE_COLUMNS, "r.csv"),
    ]
    selected, counts = select_rows(rows, year=2098, uf="XX")
    group = selected[(700001, 999619)]
    assert sorted(r.kind for r in group) == ["expense_contracted", "expense_paid", "revenue"]
    assert all(r.provider_id == 5001 for r in group)
    assert counts == {"paid_rows_without_unique_provider": 1, "superseded_submission_rows": 1,
                      "other_election_rows": 1, "other_uf_rows": 1}


def test_unknown_header_fails_closed():
    header = ";".join(f'"{c}"' for c in REVENUE_COLUMNS[:-1]) + "\r\n"
    with pytest.raises(LayoutError):
        list(iter_member(io.BytesIO(header.encode("latin-1")), REVENUE_COLUMNS, "receitas_candidatos_2098_XX.csv"))


def test_cli_reports_are_written_only_inside_the_repository(tmp_path):
    from src.electoral.paths import REPO_ROOT, output_path

    assert output_path(REPO_ROOT / "docs" / "audits" / "x.md") == (REPO_ROOT / "docs" / "audits" / "x.md").resolve()
    with pytest.raises(SystemExit):
        output_path(tmp_path / "fora.json", root=REPO_ROOT / "docs")
    with pytest.raises(SystemExit):
        output_path(REPO_ROOT / "docs" / ".." / ".." / "fora.json")
