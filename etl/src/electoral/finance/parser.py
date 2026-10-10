"""Prestação de contas de candidatos (TSE): receitas, despesas contratadas e despesas pagas.

Perfis de cabeçalho EXATOS (iguais em 2022, 2024 e 2026 — conferidos nos arquivos oficiais).
Privacidade:
- nunca guardados: CPF do candidato e do vice, gênero e cor/raça do candidato, município e UF de
  doadores/fornecedores, números de recibo/documento;
- documento do doador/fornecedor: só em memória, para o HMAC (identidade para agrupar) e, quando
  tem 14 dígitos (CNPJ, identificador público de empresa), também em claro;
- descrições livres: e-mails e sequências com formato de CPF mascarados antes de gravar.
"""

from __future__ import annotations

import csv
from collections.abc import Iterator
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

from ..candidates.parser import CandidateRowError, code, iso_date, required_int, text
from ..candidates.records import money, sanitize_text
from ..open_data.layout import DetectedLayout, LayoutError
from ..open_data.parser import row_hash

_COMMON = (
    "DT_GERACAO", "HH_GERACAO", "AA_ELEICAO", "CD_TIPO_ELEICAO", "NM_TIPO_ELEICAO", "CD_ELEICAO", "DS_ELEICAO",
    "DT_ELEICAO", "ST_TURNO", "TP_PRESTACAO_CONTAS", "DT_PRESTACAO_CONTAS", "SQ_PRESTADOR_CONTAS", "SG_UF",
)
_CANDIDATE = (
    "SG_UE", "NM_UE", "NR_CNPJ_PRESTADOR_CONTA", "CD_CARGO", "DS_CARGO", "SQ_CANDIDATO", "NR_CANDIDATO",
    "NM_CANDIDATO", "NR_CPF_CANDIDATO", "NR_CPF_VICE_CANDIDATO", "NR_PARTIDO", "SG_PARTIDO", "NM_PARTIDO",
)

REVENUE_PROFILE = "tse-receitas-candidatos-v1"
REVENUE_COLUMNS: tuple[str, ...] = _COMMON + _CANDIDATE + (
    "CD_FONTE_RECEITA", "DS_FONTE_RECEITA", "CD_ORIGEM_RECEITA", "DS_ORIGEM_RECEITA", "CD_NATUREZA_RECEITA",
    "DS_NATUREZA_RECEITA", "CD_ESPECIE_RECEITA", "DS_ESPECIE_RECEITA", "CD_CNAE_DOADOR", "DS_CNAE_DOADOR",
    "NR_CPF_CNPJ_DOADOR", "NM_DOADOR", "NM_DOADOR_RFB", "CD_ESFERA_PARTIDARIA_DOADOR", "DS_ESFERA_PARTIDARIA_DOADOR",
    "SG_UF_DOADOR", "CD_MUNICIPIO_DOADOR", "NM_MUNICIPIO_DOADOR", "SQ_CANDIDATO_DOADOR", "NR_CANDIDATO_DOADOR",
    "CD_CARGO_CANDIDATO_DOADOR", "DS_CARGO_CANDIDATO_DOADOR", "NR_PARTIDO_DOADOR", "SG_PARTIDO_DOADOR",
    "NM_PARTIDO_DOADOR", "NR_RECIBO_DOACAO", "NR_DOCUMENTO_DOACAO", "SQ_RECEITA", "DT_RECEITA", "DS_RECEITA",
    "VR_RECEITA", "DS_NATUREZA_RECURSO_ESTIMAVEL", "DS_GENERO", "DS_COR_RACA",
)

CONTRACTED_PROFILE = "tse-despesas-contratadas-candidatos-v1"
CONTRACTED_COLUMNS: tuple[str, ...] = _COMMON + _CANDIDATE + (
    "CD_TIPO_FORNECEDOR", "DS_TIPO_FORNECEDOR", "CD_CNAE_FORNECEDOR", "DS_CNAE_FORNECEDOR", "NR_CPF_CNPJ_FORNECEDOR",
    "NM_FORNECEDOR", "NM_FORNECEDOR_RFB", "CD_ESFERA_PART_FORNECEDOR", "DS_ESFERA_PART_FORNECEDOR", "SG_UF_FORNECEDOR",
    "CD_MUNICIPIO_FORNECEDOR", "NM_MUNICIPIO_FORNECEDOR", "SQ_CANDIDATO_FORNECEDOR", "NR_CANDIDATO_FORNECEDOR",
    "CD_CARGO_FORNECEDOR", "DS_CARGO_FORNECEDOR", "NR_PARTIDO_FORNECEDOR", "SG_PARTIDO_FORNECEDOR",
    "NM_PARTIDO_FORNECEDOR", "DS_TIPO_DOCUMENTO", "NR_DOCUMENTO", "CD_ORIGEM_DESPESA", "DS_ORIGEM_DESPESA",
    "SQ_DESPESA", "DT_DESPESA", "DS_DESPESA", "VR_DESPESA_CONTRATADA",
)

PAID_PROFILE = "tse-despesas-pagas-candidatos-v1"
PAID_COLUMNS: tuple[str, ...] = _COMMON + (
    "DS_TIPO_DOCUMENTO", "NR_DOCUMENTO", "CD_FONTE_DESPESA", "DS_FONTE_DESPESA", "CD_ORIGEM_DESPESA",
    "DS_ORIGEM_DESPESA", "CD_NATUREZA_DESPESA", "DS_NATUREZA_DESPESA", "CD_ESPECIE_RECURSO", "DS_ESPECIE_RECURSO",
    "SQ_DESPESA", "SQ_PARCELAMENTO_DESPESA", "DT_PAGTO_DESPESA", "DS_DESPESA", "VR_PAGTO_DESPESA",
)

# membro do ZIP → (tipo de registro, colunas, perfil)
MEMBERS: dict[str, tuple[str, tuple[str, ...], str]] = {
    "receitas_candidatos": ("revenue", REVENUE_COLUMNS, REVENUE_PROFILE),
    "despesas_contratadas_candidatos": ("expense_contracted", CONTRACTED_COLUMNS, CONTRACTED_PROFILE),
    "despesas_pagas_candidatos": ("expense_paid", PAID_COLUMNS, PAID_PROFILE),
}

# Prioridade entre envios do mesmo prestador/candidatura (maior vence): a final substitui as parciais.
ACCOUNTS_PRIORITY = {"FINAL": 4, "REGULARIZAÇÃO DA OMISSÃO": 3, "PARCIAL": 2, "RELATÓRIO FINANCEIRO": 1}


@dataclass(frozen=True)
class FinanceRow:
    kind: str  # revenue | expense_contracted | expense_paid
    member: str
    line: int
    year: int
    election_type_code: int | None
    election_code: int | None
    turn: int | None
    accounts_type: str | None
    accounts_date: str | None
    provider_id: int  # SQ_PRESTADOR_CONTAS
    tse_candidate_id: int | None  # ausente nas despesas pagas (ligadas pelo prestador)
    uf: str
    occurred_on: str | None
    amount: Decimal | None
    category: str | None
    description: str | None
    counterparty_name: str | None
    counterparty_kind: str | None  # person | company | unidentified (só receitas/contratadas)
    counterparty_cnpj: str | None
    record_id: int | None  # SQ_RECEITA / SQ_DESPESA
    payload: dict[str, Any] = field(hash=False)
    # Documento publicado do doador/fornecedor: só em memória (HMAC). Nunca persistido nem impresso.
    document_digits: str | None = field(default=None, repr=False, compare=False)

    def content_hash(self, document_hmac: str | None) -> str:
        """Impressão digital sanitizada (sem data de geração; documento só como HMAC chaveado)."""
        fields = [
            self.kind, str(self.provider_id), str(self.tse_candidate_id), str(self.record_id), str(self.occurred_on),
            str(self.amount), str(self.category), str(self.description), str(self.counterparty_name),
            str(self.counterparty_kind), str(self.counterparty_cnpj), str(document_hmac),
            *(f"{k}={self.payload[k]}" for k in sorted(self.payload)),
        ]
        return row_hash(fields)


def _document(raw: str) -> tuple[str | None, str, str | None]:
    """(dígitos, tipo, CNPJ em claro). 11 dígitos = pessoa física; 14 = empresa; resto = não identificado."""
    value = (raw or "").strip()
    if value.isdigit() and len(value) == 11:
        return value, "person", None
    if value.isdigit() and len(value) == 14:
        return value, "company", value
    return None, "unidentified", None


def _common(f: dict[str, str], line: int) -> dict[str, Any]:
    accounts = text(f["TP_PRESTACAO_CONTAS"])
    return {
        "year": required_int(f["AA_ELEICAO"], "AA_ELEICAO", line),
        "election_type_code": code(f["CD_TIPO_ELEICAO"], "CD_TIPO_ELEICAO", line),
        "election_code": code(f["CD_ELEICAO"], "CD_ELEICAO", line),
        "turn": code(f["ST_TURNO"], "ST_TURNO", line),
        "accounts_type": accounts.upper() if accounts else None,
        "accounts_date": iso_date(f["DT_PRESTACAO_CONTAS"], line),
        "provider_id": required_int(f["SQ_PRESTADOR_CONTAS"], "SQ_PRESTADOR_CONTAS", line),
        "uf": f["SG_UF"].strip().upper(),
    }


def parse_row(kind: str, fields: list[str], line: int, columns: tuple[str, ...], member: str) -> FinanceRow:
    if len(fields) != len(columns):
        raise CandidateRowError(line, f"expected {len(columns)} fields, found {len(fields)}")
    f = dict(zip(columns, fields, strict=True))
    common = _common(f, line)
    base_payload = {"accounts_type": common["accounts_type"], "accounts_date": common["accounts_date"], "turn": common["turn"]}
    if kind == "revenue":
        digits, cp_kind, cnpj = _document(f["NR_CPF_CNPJ_DOADOR"])
        payload = base_payload | {
            "source": text(f["DS_FONTE_RECEITA"]),
            "nature": text(f["DS_NATUREZA_RECEITA"]),
            "species": text(f["DS_ESPECIE_RECEITA"]),
            "estimable_nature": text(f["DS_NATUREZA_RECURSO_ESTIMAVEL"]),
            "donor_cnae": text(f["DS_CNAE_DOADOR"]),
            "donor_party_sphere": text(f["DS_ESFERA_PARTIDARIA_DOADOR"]),
            "donor_party": text(f["SG_PARTIDO_DOADOR"]),
            "donor_candidate_tse_id": code(f["SQ_CANDIDATO_DOADOR"], "SQ_CANDIDATO_DOADOR", line),
            "donor_candidate_number": code(f["NR_CANDIDATO_DOADOR"], "NR_CANDIDATO_DOADOR", line),
            "donor_candidate_office": text(f["DS_CARGO_CANDIDATO_DOADOR"]),
        }
        return FinanceRow(
            kind, member, line, **common, tse_candidate_id=code(f["SQ_CANDIDATO"], "SQ_CANDIDATO", line),
            occurred_on=iso_date(f["DT_RECEITA"], line), amount=money(f["VR_RECEITA"], "VR_RECEITA", line),
            category=text(f["DS_ORIGEM_RECEITA"]), description=sanitize_text(text(f["DS_RECEITA"])),
            counterparty_name=text(f["NM_DOADOR"]) or text(f["NM_DOADOR_RFB"]), counterparty_kind=cp_kind,
            counterparty_cnpj=cnpj, record_id=code(f["SQ_RECEITA"], "SQ_RECEITA", line), payload=payload,
            document_digits=digits,
        )
    if kind == "expense_contracted":
        digits, cp_kind, cnpj = _document(f["NR_CPF_CNPJ_FORNECEDOR"])
        payload = base_payload | {
            "supplier_type": text(f["DS_TIPO_FORNECEDOR"]),
            "supplier_cnae": text(f["DS_CNAE_FORNECEDOR"]),
            "supplier_party_sphere": text(f["DS_ESFERA_PART_FORNECEDOR"]),
            "supplier_party": text(f["SG_PARTIDO_FORNECEDOR"]),
            "supplier_candidate_tse_id": code(f["SQ_CANDIDATO_FORNECEDOR"], "SQ_CANDIDATO_FORNECEDOR", line),
            "supplier_candidate_number": code(f["NR_CANDIDATO_FORNECEDOR"], "NR_CANDIDATO_FORNECEDOR", line),
            "document_type": text(f["DS_TIPO_DOCUMENTO"]),
        }
        return FinanceRow(
            kind, member, line, **common, tse_candidate_id=code(f["SQ_CANDIDATO"], "SQ_CANDIDATO", line),
            occurred_on=iso_date(f["DT_DESPESA"], line),
            amount=money(f["VR_DESPESA_CONTRATADA"], "VR_DESPESA_CONTRATADA", line),
            category=text(f["DS_ORIGEM_DESPESA"]), description=sanitize_text(text(f["DS_DESPESA"])),
            counterparty_name=text(f["NM_FORNECEDOR"]) or text(f["NM_FORNECEDOR_RFB"]), counterparty_kind=cp_kind,
            counterparty_cnpj=cnpj, record_id=code(f["SQ_DESPESA"], "SQ_DESPESA", line), payload=payload,
            document_digits=digits,
        )
    if kind == "expense_paid":
        payload = base_payload | {
            "source": text(f["DS_FONTE_DESPESA"]),
            "nature": text(f["DS_NATUREZA_DESPESA"]),
            "species": text(f["DS_ESPECIE_RECURSO"]),
            "document_type": text(f["DS_TIPO_DOCUMENTO"]),
            "installment": code(f["SQ_PARCELAMENTO_DESPESA"], "SQ_PARCELAMENTO_DESPESA", line),
        }
        return FinanceRow(
            kind, member, line, **common, tse_candidate_id=None,
            occurred_on=iso_date(f["DT_PAGTO_DESPESA"], line),
            amount=money(f["VR_PAGTO_DESPESA"], "VR_PAGTO_DESPESA", line),
            category=text(f["DS_ORIGEM_DESPESA"]), description=sanitize_text(text(f["DS_DESPESA"])),
            counterparty_name=None, counterparty_kind=None, counterparty_cnpj=None,
            record_id=code(f["SQ_DESPESA"], "SQ_DESPESA", line), payload=payload,
        )
    raise ValueError(f"unknown finance record kind {kind!r}")


def iter_member(stream, layout_columns: tuple[str, ...], member: str, encoding: str = "latin-1") -> Iterator[tuple[int, list[str]]]:
    """(linha física, campos) de um membro do ZIP lido em streaming, conferindo o cabeçalho exato."""
    import io

    reader = csv.reader(io.TextIOWrapper(stream, encoding=encoding, newline=""), delimiter=";", quotechar='"', strict=True)
    header = next(reader, None)
    if header is None or tuple(header) != layout_columns:
        raise LayoutError(f"{member}: header differs from the documented finance profile")
    for fields in reader:
        yield reader.line_num, fields


def detected_layout(profile: str, columns: tuple[str, ...]) -> DetectedLayout:
    return DetectedLayout(profile, "latin-1", ";", '"', "\r\n", columns)


def read_local_member(path: Path, kind: str) -> list[FinanceRow]:
    """Lê um CSV já extraído (testes/offline)."""
    _, columns, _ = next(v for v in MEMBERS.values() if v[0] == kind)
    with path.open("rb") as fh:
        return [parse_row(kind, f, line, columns, path.name) for line, f in iter_member(fh, columns, path.name)]
