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


def test_cli_reports_go_to_fixed_directories_with_validated_names(tmp_path):
    from src.electoral.paths import (
        AUDITS_DIR,
        REPO_ROOT,
        REPORTS_DIR,
        report_file,
        unit_code,
        write_report,
    )

    assert unit_code(" ce ") == "CE" and unit_code("br") == "BR"
    for bad in ("../CE", "C/E", "CE.json", "XX", ""):
        with pytest.raises(SystemExit):
            unit_code(bad)
    # argumentos da linha de comando nunca escolhem o diretório nem o nome livremente
    assert {REPORTS_DIR.relative_to(REPO_ROOT).as_posix(), AUDITS_DIR.relative_to(REPO_ROOT).as_posix()} == {
        "etl/artifacts/reports", "docs/audits"}
    assert report_file(tmp_path, "finance", 2024, "ce") == tmp_path / "finance_2024_CE.json"
    target = report_file(tmp_path / "audits", "audit", 2022, "CE", 2, suffix=".md")
    assert target == tmp_path / "audits" / "audit_2022_CE_t2.md"
    assert write_report(target, "# ok").read_text(encoding="utf-8") == "# ok\n"


def test_remote_version_comes_from_the_ranged_read_not_from_head():
    """Regressão (2026): o CDN do TSE respondeu HEAD com Content-Length 1 para um ZIP de 178 MB."""
    import zipfile

    import httpx

    from src.electoral.finance.remote import PinnedRangeFile, head
    from src.electoral.open_data.acquire import AcquisitionError

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("receitas_candidatos_2099_XX.csv", "conteudo")
    data = buf.getvalue()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "HEAD":
            return httpx.Response(200, headers={"content-length": "1", "etag": '"v1"'})
        start, end = (int(x) for x in request.headers["range"].removeprefix("bytes=").split("-"))
        return httpx.Response(206, content=data[start:end + 1],
                              headers={"content-range": f"bytes {start}-{end}/{len(data)}", "etag": '"v1"'})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    version = head("https://cdn.tse.jus.br/x.zip", client)
    assert (version.size, version.etag) == (len(data), '"v1"')
    with zipfile.ZipFile(io.BufferedReader(PinnedRangeFile(version, client))) as zf:
        assert zf.read("receitas_candidatos_2099_XX.csv") == b"conteudo"
    without_ranges = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=data)))
    with pytest.raises(AcquisitionError, match="ranged reads are required"):
        head("https://cdn.tse.jus.br/x.zip", without_ranges)
