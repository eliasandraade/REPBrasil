"""Leitura em streaming do CSV do Boletim de Urna.

- Nunca carrega o arquivo inteiro: `csv.reader` incremental sobre o arquivo
  extraído (1,2 GB no Ceará).
- Filtro precoce por município/zona antes de tipar a linha.
- Ausência fica `None`: `#NULO`, `#NE`, −1/−3 em numéricos e campo vazio
  NUNCA viram zero.
- `source_row_hash` = SHA-256 da representação canônica dos campos de origem
  (valores decodificados, na ordem do cabeçalho, separados por U+001F).
"""
from __future__ import annotations

import csv
import hashlib
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .layout import (
    COLUMNS,
    NULL_NUMERIC_TOKENS,
    NULL_TEXT_TOKENS,
    DetectedLayout,
    LayoutError,
)

_IDX = {name: i for i, name in enumerate(COLUMNS)}


class RowError(RuntimeError):
    """Linha dentro do escopo com dado inválido. A importação inteira falha."""

    def __init__(self, line: int, message: str) -> None:
        super().__init__(f"line {line}: {message}")
        self.line = line


def text(raw: str) -> str | None:
    value = raw.strip()
    if value == "" or value in NULL_TEXT_TOKENS:
        return None
    return value


def number(raw: str, column: str, line: int) -> int | None:
    value = raw.strip()
    if value == "" or value in NULL_TEXT_TOKENS or value in NULL_NUMERIC_TOKENS:
        return None
    try:
        parsed = int(value)
    except ValueError as exc:
        raise RowError(line, f"{column}={raw!r} is not an integer") from exc
    if parsed < 0:
        raise RowError(line, f"{column}={raw!r} is negative and not a documented null sentinel")
    return parsed


def timestamp(raw: str, column: str, line: int) -> datetime | None:
    value = text(raw)
    if value is None:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    raise RowError(line, f"{column}={raw!r} is not a recognized date/time")


def aggregated_sections(raw: str, line: int) -> tuple[int, ...]:
    """`DS_SECOES_AGREGADAS`: "28 / 40" → (28, 40); `#NULO#` → ()."""
    value = text(raw)
    if value is None:
        return ()
    parts = [p.strip() for p in value.split("/")]
    if not parts or any(not p.isdigit() for p in parts):
        raise RowError(line, f"DS_SECOES_AGREGADAS={raw!r} is not a '/'-separated list of sections")
    numbers = tuple(int(p) for p in parts)
    if len(set(numbers)) != len(numbers):
        raise RowError(line, f"DS_SECOES_AGREGADAS={raw!r} repeats a section")
    return numbers


def row_hash(fields: list[str]) -> str:
    return hashlib.sha256("\x1f".join(fields).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class BURow:
    line: int
    source_row_hash: str
    generated_date: str | None
    generated_time: str | None
    year: int | None
    election_type_code: int | None
    pleito_code: int | None
    pleito_date: datetime | None
    turn: int | None
    election_code: int | None
    election_description: str | None
    uf: str | None
    municipality_code: int | None
    municipality_name: str | None
    zone: int | None
    section: int | None
    polling_place_code: int | None
    office_code: int | None
    office_name: str | None
    party_number: int | None
    party_acronym: str | None
    party_name: str | None
    bu_received_at: datetime | None
    eligible: int | None
    turnout: int | None
    abstentions: int | None
    urn_type_code: int | None
    urn_type_description: str | None
    votable_type_code: int | None
    votable_type_description: str | None
    votable_number: int | None
    votable_name: str | None
    votes: int | None
    urn_number: int | None
    load_code_1: str | None
    load_code_2: str | None
    flashcard: str | None
    loaded_at: datetime | None
    aggregated_sections: tuple[int, ...]
    opened_at: datetime | None
    closed_at: datetime | None
    biometric_not_enabled: int | None
    bu_emitted_at: datetime | None


def parse_row(fields: list[str], line: int) -> BURow:
    f = lambda c: fields[_IDX[c]]  # noqa: E731
    n = lambda c: number(f(c), c, line)  # noqa: E731
    t = lambda c: timestamp(f(c), c, line)  # noqa: E731
    return BURow(
        line=line,
        source_row_hash=row_hash(fields),
        generated_date=text(f("DT_GERACAO")),
        generated_time=text(f("HH_GERACAO")),
        year=n("ANO_ELEICAO"),
        election_type_code=n("CD_TIPO_ELEICAO"),
        pleito_code=n("CD_PLEITO"),
        pleito_date=t("DT_PLEITO"),
        turn=n("NR_TURNO"),
        election_code=n("CD_ELEICAO"),
        election_description=text(f("DS_ELEICAO")),
        uf=text(f("SG_UF")),
        municipality_code=n("CD_MUNICIPIO"),
        municipality_name=text(f("NM_MUNICIPIO")),
        zone=n("NR_ZONA"),
        section=n("NR_SECAO"),
        polling_place_code=n("NR_LOCAL_VOTACAO"),
        office_code=n("CD_CARGO_PERGUNTA"),
        office_name=text(f("DS_CARGO_PERGUNTA")),
        party_number=n("NR_PARTIDO"),
        party_acronym=text(f("SG_PARTIDO")),
        party_name=text(f("NM_PARTIDO")),
        bu_received_at=t("DT_BU_RECEBIDO"),
        eligible=n("QT_APTOS"),
        turnout=n("QT_COMPARECIMENTO"),
        abstentions=n("QT_ABSTENCOES"),
        urn_type_code=n("CD_TIPO_URNA"),
        urn_type_description=text(f("DS_TIPO_URNA")),
        votable_type_code=n("CD_TIPO_VOTAVEL"),
        votable_type_description=text(f("DS_TIPO_VOTAVEL")),
        votable_number=n("NR_VOTAVEL"),
        votable_name=text(f("NM_VOTAVEL")),
        votes=n("QT_VOTOS"),
        urn_number=n("NR_URNA_EFETIVADA"),
        load_code_1=text(f("CD_CARGA_1_URNA_EFETIVADA")),
        load_code_2=text(f("CD_CARGA_2_URNA_EFETIVADA")),
        flashcard=text(f("CD_FLASHCARD_URNA_EFETIVADA")),
        loaded_at=t("DT_CARGA_URNA_EFETIVADA"),
        aggregated_sections=aggregated_sections(f("DS_SECOES_AGREGADAS"), line),
        opened_at=t("DT_ABERTURA"),
        closed_at=t("DT_ENCERRAMENTO"),
        biometric_not_enabled=n("QT_ELEI_BIOM_SEM_HABILITACAO"),
        bu_emitted_at=t("DT_EMISSAO_BU"),
    )


@dataclass
class ScanStats:
    rows_read: int = 0
    rows_matching_uf: int = 0
    rows_matching_municipality: int = 0
    rows_matching_zone: int = 0
    ufs_seen: set[str] = field(default_factory=set)


def scan(
    path: Path,
    layout: DetectedLayout,
    *,
    uf: str,
    municipality: int,
    zone: int,
    stats: ScanStats,
) -> Iterator[BURow]:
    """Percorre o arquivo inteiro e tipa somente as linhas do escopo."""
    i_uf, i_mun, i_zone = _IDX["SG_UF"], _IDX["CD_MUNICIPIO"], _IDX["NR_ZONA"]
    with path.open("r", encoding=layout.encoding, newline="") as fh:
        reader = csv.reader(fh, delimiter=layout.delimiter, quotechar=layout.quotechar, strict=True)
        try:
            header = next(reader)
        except StopIteration as exc:
            raise LayoutError("empty CSV") from exc
        if tuple(header) != (layout.source_columns or layout.columns):
            raise LayoutError("header changed between detection and parsing")
        width = len(header)
        for fields in reader:
            stats.rows_read += 1
            line = reader.line_num
            if len(fields) != width:
                raise LayoutError(f"line {line}: expected {width} fields, found {len(fields)} (truncated or malformed)")
            row_uf = fields[i_uf]
            stats.ufs_seen.add(row_uf)
            if row_uf != uf:
                continue
            stats.rows_matching_uf += 1
            try:
                row_mun = int(fields[i_mun])
            except ValueError as exc:
                raise RowError(line, f"CD_MUNICIPIO={fields[i_mun]!r} is not an integer") from exc
            if row_mun != municipality:
                continue
            stats.rows_matching_municipality += 1
            try:
                row_zone = int(fields[i_zone])
            except ValueError as exc:
                raise RowError(line, f"NR_ZONA={fields[i_zone]!r} is not an integer") from exc
            if row_zone != zone:
                continue
            stats.rows_matching_zone += 1
            yield parse_row(fields, line)
