from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation


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
    raw: dict[str, str]


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
    "locality": ("Localidade do Gasto", "Município", "Municipio", "Localidade"),
    "municipality_ibge_code": (
        "Código IBGE do Município",
        "Codigo IBGE do Municipio",
        "Código IBGE Município",
        "Codigo IBGE Municipio",
        "Código IBGE",
        "Codigo IBGE",
    ),
    "committed_amount": ("Valor Empenhado", "Valor Empenhado (R$)"),
    "paid_amount": ("Valor Pago", "Valor Pago (R$)"),
}

REQUIRED_FIELDS = ("external_id", "author_name", "year")


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
    return value or None


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


def parse_amendments_csv(content: bytes, *, encoding: str = "utf-8-sig") -> list[AmendmentRecord]:
    try:
        text = content.decode(encoding)
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    mapping = _column_map(reader.fieldnames)
    records: list[AmendmentRecord] = []
    seen: set[tuple[str, str | None, int | None]] = set()

    for row in reader:
        if not row or not any(str(value or "").strip() for value in row.values()):
            continue
        external_id = _text(row, mapping, "external_id")
        if external_id is None:
            raise ValueError("amendment row without official identifier")
        year_raw = _text(row, mapping, "year")
        if year_raw is None or not year_raw.isdigit():
            raise ValueError(f"amendment {external_id} has invalid year: {year_raw!r}")
        year = int(year_raw)
        if not 1988 <= year <= 2200:
            raise ValueError(f"amendment {external_id} year out of range: {year}")
        author = _text(row, mapping, "author_name")
        key = (external_id, author, year)
        if key in seen:
            continue
        seen.add(key)
        records.append(
            AmendmentRecord(
                external_id=external_id,
                author_name=author,
                year=year,
                amendment_type=_text(row, mapping, "amendment_type"),
                functional_programming=_text(row, mapping, "functional_programming"),
                beneficiary_document=_text(row, mapping, "beneficiary_document"),
                beneficiary_name=_text(row, mapping, "beneficiary_name"),
                locality=_text(row, mapping, "locality"),
                municipality_ibge_code=_municipality_code(
                    _text(row, mapping, "municipality_ibge_code")
                ),
                committed_amount=_money(_text(row, mapping, "committed_amount")),
                paid_amount=_money(_text(row, mapping, "paid_amount")),
                raw={str(k): str(v or "") for k, v in row.items() if k is not None},
            )
        )
    return records


def content_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
