"""Emendas parlamentares do Portal da Transparência (CGU), arquivo `EmendasParlamentares.csv`.

Layout oficial verificado em 13/10/2026 (download de 10/10/2026): CSV `;` em Latin-1, colunas
"Código da Emenda", "Ano da Emenda", "Nome do Autor da Emenda", "Localidade de aplicação do
recurso", "Código Município IBGE", "Código UF IBGE" (`2300000` para o CE), "Valor Empenhado",
"Valor Pago" etc. "Sem informação" é o marcador oficial de ausência.

Regras:
- ausência ("", "Sem informação") fica `None`; nunca vira zero;
- município só pelo código IBGE oficial de 7 dígitos; texto de localidade nunca é convertido;
- linha sem código oficial de emenda não vira emenda (identidade nunca é inventada): é contada;
- um mesmo código dividido em várias linhas orçamentárias (ações/programas) é uma emenda: valores
  somados só quando todos foram publicados; município só quando todas as linhas apontam o mesmo.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any


@dataclass(frozen=True)
class AmendmentRecord:
    external_id: str
    author_name: str | None
    year: int | None
    amendment_type: str | None
    functional_programming: str | None
    beneficiary_document: str | None
    beneficiary_name: str | None
    locality: str | None
    municipality_ibge_code: str | None
    committed_amount: Decimal | None
    paid_amount: Decimal | None
    raw: dict[str, Any]


@dataclass(frozen=True)
class AmendmentParse:
    records: list[AmendmentRecord]
    rows_read: int
    rows_in_scope: int
    rows_without_official_identifier: int
    multi_row_amendments: int


FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "external_id": (
        "Código da Emenda",
        "Codigo da Emenda",
        "Código Emenda",
        "Codigo Emenda",
    ),
    "author_name": ("Nome do Autor da Emenda", "Autor da Emenda", "Autor"),
    "year": ("Ano da Emenda", "Ano"),
    "amendment_type": ("Tipo de Emenda", "Tipo Emenda"),
    "functional_programming": (
        "Código da Programação",
        "Codigo da Programacao",
        "Programação Orçamentária",
        "Programacao Orcamentaria",
    ),
    "beneficiary_document": (
        "Código do Beneficiário",
        "Codigo do Beneficiario",
        "CNPJ/CPF do Beneficiário",
        "CNPJ/CPF do Beneficiario",
    ),
    "beneficiary_name": (
        "Nome do Beneficiário",
        "Nome do Beneficiario",
        "Beneficiário",
        "Beneficiario",
    ),
    "locality": (
        "Localidade de aplicação do recurso",
        "Localidade de aplicacao do recurso",
        "Localidade do Gasto",
        "Município",
        "Municipio",
        "Localidade",
    ),
    "municipality_ibge_code": (
        "Código Município IBGE",
        "Codigo Municipio IBGE",
        "Código IBGE do Município",
        "Codigo IBGE do Municipio",
        "Código IBGE Município",
        "Codigo IBGE Municipio",
        "Código IBGE",
        "Codigo IBGE",
    ),
    "state_ibge_code": ("Código UF IBGE", "Codigo UF IBGE"),
    "committed_amount": ("Valor Empenhado", "Valor Empenhado (R$)"),
    "paid_amount": ("Valor Pago", "Valor Pago (R$)"),
}

REQUIRED_FIELDS = ("external_id", "author_name", "year")
OFFICIAL_ABSENCE_MARKERS = frozenset({"sem informacao"})


def _fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value.strip().casefold())
    return "".join(character for character in decomposed if unicodedata.category(character) != "Mn")


def _column_map(fieldnames: list[str] | None) -> dict[str, str]:
    if not fieldnames:
        raise ValueError("amendments CSV has no header")
    available = {name.strip(): name for name in fieldnames if name and name.strip()}
    mapping: dict[str, str] = {}
    for semantic, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            if alias in available:
                mapping[semantic] = available[alias]
                break
    missing = [field for field in REQUIRED_FIELDS if field not in mapping]
    if missing:
        raise ValueError(f"unexpected amendments CSV columns; missing required fields: {missing}")
    return mapping


def _text(row: dict[str, str], mapping: dict[str, str], field: str) -> str | None:
    column = mapping.get(field)
    if column is None:
        return None
    value = str(row.get(column) or "").strip()
    if not value or _fold(value) in OFFICIAL_ABSENCE_MARKERS:
        return None
    return value


def _money(raw: str | None) -> Decimal | None:
    if raw is None:
        return None
    text = raw.strip().replace("R$", "").replace(" ", "")
    if not text:
        return None
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"invalid amendments monetary value: {raw!r}") from exc


def _municipality_code(raw: str | None) -> str | None:
    if raw is None or not raw.strip():
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) != 7:
        raise ValueError(f"invalid official municipality IBGE code: {raw!r}")
    return digits


def _state_prefix(raw: str | None) -> str | None:
    """'2300000' ou '23' → '23'; ausência ou escopo não estadual oficial (-1 Nacional/Exterior/
    região, -14 Múltiplo) → None: a emenda não é atribuída a nenhuma UF."""
    if raw is None or raw.strip().startswith("-"):
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 7 and digits.endswith("00000"):
        return digits[:2]
    if len(digits) == 2:
        return digits
    raise ValueError(f"invalid official state IBGE code: {raw!r}")


def _decode(content: bytes, encoding: str) -> str:
    try:
        return content.decode(encoding)
    except UnicodeDecodeError:
        return content.decode("latin-1")


def _in_scope(row: dict[str, str], mapping: dict[str, str], state_ibge_code: str | None) -> bool:
    if state_ibge_code is None:
        return True
    municipality = _municipality_code(_text(row, mapping, "municipality_ibge_code"))
    if municipality is not None:
        return municipality.startswith(state_ibge_code)
    return _state_prefix(_text(row, mapping, "state_ibge_code")) == state_ibge_code


def _single(values: list[str | None]) -> str | None:
    distinct = set(values)
    return values[0] if len(distinct) == 1 else None


def _sum_published(values: list[Decimal | None]) -> Decimal | None:
    if any(value is None for value in values):
        return None
    return sum((value for value in values if value is not None), Decimal("0"))


def _record(
    external_id: str, rows: list[dict[str, str]], mapping: dict[str, str]
) -> AmendmentRecord:
    authors = {_text(row, mapping, "author_name") for row in rows}
    years = {_text(row, mapping, "year") for row in rows}
    if len(authors) != 1 or len(years) != 1:
        raise ValueError(f"amendment {external_id} has conflicting author or year across rows")
    year_raw = years.pop()
    if year_raw is None or not year_raw.isdigit():
        raise ValueError(f"amendment {external_id} has invalid year: {year_raw!r}")
    year = int(year_raw)
    if not 1988 <= year <= 2200:
        raise ValueError(f"amendment {external_id} year out of range: {year}")

    def column(field: str) -> list[str | None]:
        return [_text(row, mapping, field) for row in rows]

    types = sorted({value for value in column("amendment_type") if value is not None})
    raw_rows = [{str(k): str(v or "") for k, v in row.items() if k is not None} for row in rows]
    return AmendmentRecord(
        external_id=external_id,
        author_name=authors.pop(),
        year=year,
        amendment_type=" | ".join(types) or None,
        functional_programming=_single(column("functional_programming")),
        beneficiary_document=_single(column("beneficiary_document")),
        beneficiary_name=_single(column("beneficiary_name")),
        locality=_single(column("locality")),
        municipality_ibge_code=_single(
            [_municipality_code(value) for value in column("municipality_ibge_code")]
        ),
        committed_amount=_sum_published([_money(value) for value in column("committed_amount")]),
        paid_amount=_sum_published([_money(value) for value in column("paid_amount")]),
        raw=raw_rows[0] if len(raw_rows) == 1 else {"rows": raw_rows},
    )


def parse_amendments(
    content: bytes, *, state_ibge_code: str | None = None, encoding: str = "utf-8-sig"
) -> AmendmentParse:
    """Emendas identificadas pelo código oficial, opcionalmente só as destinadas a uma UF."""
    reader = csv.DictReader(io.StringIO(_decode(content, encoding)), delimiter=";")
    mapping = _column_map(reader.fieldnames)
    territorial = {"municipality_ibge_code", "state_ibge_code"} & set(mapping)
    if state_ibge_code is not None and not territorial:
        raise ValueError("amendments CSV has no official territorial code to scope by state")

    groups: dict[str, list[dict[str, str]]] = {}
    rows_read = rows_in_scope = without_identifier = 0
    for row in reader:
        if not row or not any(str(value or "").strip() for value in row.values()):
            continue
        rows_read += 1
        if not _in_scope(row, mapping, state_ibge_code):
            continue
        rows_in_scope += 1
        external_id = _text(row, mapping, "external_id")
        if external_id is None:
            without_identifier += 1
            continue
        groups.setdefault(external_id, []).append(row)

    records = [_record(external_id, rows, mapping) for external_id, rows in groups.items()]
    return AmendmentParse(
        records=records,
        rows_read=rows_read,
        rows_in_scope=rows_in_scope,
        rows_without_official_identifier=without_identifier,
        multi_row_amendments=sum(1 for rows in groups.values() if len(rows) > 1),
    )


def parse_amendments_csv(content: bytes, *, encoding: str = "utf-8-sig") -> list[AmendmentRecord]:
    return parse_amendments(content, encoding=encoding).records


def content_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
