"""Leitura estrita dos CSVs de candidatos e de histórico de candidaturas do TSE.

Sentinelas do TSE viram NULL, nunca zero nem texto inventado:
`#NULO`, `#NE`, `NÃO DIVULGÁVEL` e códigos negativos (-1, -3, -4).
Cada linha guarda o número físico da linha e o SHA-256 dos campos de origem.
"""

from __future__ import annotations

import csv
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from ..open_data.layout import DetectedLayout, LayoutError
from ..open_data.parser import row_hash

SENTINEL_TEXT = frozenset({"#NULO", "#NE", "NÃO DIVULGÁVEL", "NAO DIVULGAVEL", ""})

# CD_SIT_TOT_TURNO → eleito? (tabela fixa; documentada em docs/TSE_IDENTITY.md)
ELECTED_BY_OUTCOME: dict[int, bool | None] = {
    1: True,   # ELEITO
    2: True,   # ELEITO POR QP
    3: True,   # ELEITO POR MÉDIA
    4: False,  # NÃO ELEITO
    5: False,  # SUPLENTE
    6: None,   # 2º TURNO — indefinido no 1º turno
}

SCOPE_BY_ABRANGENCIA = {"FEDERAL": "federal", "ESTADUAL": "state"}


class CandidateRowError(ValueError):
    def __init__(self, line: int, message: str) -> None:
        super().__init__(f"line {line}: {message}")
        self.line = line


def text(raw: str) -> str | None:
    value = raw.strip()
    return None if value.upper() in SENTINEL_TEXT else value


def code(raw: str, column: str, line: int) -> int | None:
    value = raw.strip()
    if value == "":
        return None
    try:
        number = int(value)
    except ValueError as exc:
        raise CandidateRowError(line, f"{column} is not an integer: {value!r}") from exc
    return None if number < 0 else number


def required_int(raw: str, column: str, line: int) -> int:
    number = code(raw, column, line)
    if number is None:
        raise CandidateRowError(line, f"{column} is required, found {raw!r}")
    return number


@dataclass(frozen=True)
class CandidateRow:
    source_member: str  # CSV dentro do ZIP oficial (a linha só é única dentro dele)
    line: int
    source_row_hash: str
    generated_at: str
    year: int
    turn: int
    election_code: int
    election_description: str | None
    scope: str
    uf: str
    electoral_unit: str
    office_code: int
    office_name: str
    tse_candidate_id: int
    candidate_number: int
    full_name: str
    ballot_name: str
    social_name: str | None
    agremiation_type: str | None
    party_number: int | None
    party_acronym: str | None
    party_name: str | None
    federation_number: int | None
    federation_acronym: str | None
    federation_name: str | None
    coalition_name: str | None
    candidacy_status_code: int | None
    candidacy_status: str | None
    round_outcome_code: int | None
    round_outcome: str | None
    elected: bool | None
    # Documento publicado: usado só em memória para o HMAC. Nunca persistido nem impresso.
    cpf_raw: str = field(repr=False, compare=False)


def parse_candidate(fields: list[str], line: int, columns: tuple[str, ...], member: str) -> CandidateRow:
    if len(fields) != len(columns):
        raise CandidateRowError(line, f"expected {len(columns)} fields, found {len(fields)}")
    f = dict(zip(columns, fields, strict=True))
    abrangencia = f["TP_ABRANGENCIA"].strip().upper()
    if abrangencia not in SCOPE_BY_ABRANGENCIA:
        raise CandidateRowError(line, f"unknown TP_ABRANGENCIA {abrangencia!r}")
    unit = f["SG_UE"].strip().upper()
    uf = f["SG_UF"].strip().upper()
    if len(unit) != 2 or len(uf) != 2:
        raise CandidateRowError(line, f"SG_UE/SG_UF must be 2-letter codes, found {unit!r}/{uf!r}")
    if SCOPE_BY_ABRANGENCIA[abrangencia] == "federal" and unit != "BR":
        raise CandidateRowError(line, f"federal contest with electoral unit {unit!r}")
    full_name, ballot_name = text(f["NM_CANDIDATO"]), text(f["NM_URNA_CANDIDATO"])
    office_name = text(f["DS_CARGO"])
    if not full_name or not ballot_name or not office_name:
        raise CandidateRowError(line, "NM_CANDIDATO, NM_URNA_CANDIDATO and DS_CARGO are required")
    outcome_code = code(f["CD_SIT_TOT_TURNO"], "CD_SIT_TOT_TURNO", line)
    return CandidateRow(
        source_member=member,
        line=line,
        source_row_hash=row_hash(fields),
        generated_at=f"{f['DT_GERACAO'].strip()} {f['HH_GERACAO'].strip()}",
        year=required_int(f["ANO_ELEICAO"], "ANO_ELEICAO", line),
        turn=required_int(f["NR_TURNO"], "NR_TURNO", line),
        election_code=required_int(f["CD_ELEICAO"], "CD_ELEICAO", line),
        election_description=text(f["DS_ELEICAO"]),
        scope=SCOPE_BY_ABRANGENCIA[abrangencia],
        uf=uf,
        electoral_unit=unit,
        office_code=required_int(f["CD_CARGO"], "CD_CARGO", line),
        office_name=office_name,
        tse_candidate_id=required_int(f["SQ_CANDIDATO"], "SQ_CANDIDATO", line),
        candidate_number=required_int(f["NR_CANDIDATO"], "NR_CANDIDATO", line),
        full_name=full_name,
        ballot_name=ballot_name,
        social_name=text(f["NM_SOCIAL_CANDIDATO"]),
        agremiation_type=text(f["TP_AGREMIACAO"]),
        party_number=code(f["NR_PARTIDO"], "NR_PARTIDO", line),
        party_acronym=text(f["SG_PARTIDO"]),
        party_name=text(f["NM_PARTIDO"]),
        federation_number=code(f["NR_FEDERACAO"], "NR_FEDERACAO", line),
        federation_acronym=text(f["SG_FEDERACAO"]),
        federation_name=text(f["NM_FEDERACAO"]),
        coalition_name=text(f["NM_COLIGACAO"]),
        candidacy_status_code=code(f["CD_SITUACAO_CANDIDATURA"], "CD_SITUACAO_CANDIDATURA", line),
        candidacy_status=text(f["DS_SITUACAO_CANDIDATURA"]),
        round_outcome_code=outcome_code,
        round_outcome=text(f["DS_SIT_TOT_TURNO"]),
        elected=ELECTED_BY_OUTCOME.get(outcome_code) if outcome_code is not None else None,
        cpf_raw=f["NR_CPF_CANDIDATO"],
    )


@dataclass(frozen=True)
class HistoryRow:
    """Uma candidatura anterior (SQ_CANDIDATO) da pessoa da candidatura atual (SQ_CANDIDATO_ATUAL)."""

    line: int
    current_tse_candidate_id: int
    current_year: int
    year: int
    turn: int
    tse_candidate_id: int
    office_name: str | None
    electoral_unit: str


def parse_history(fields: list[str], line: int, columns: tuple[str, ...]) -> HistoryRow:
    if len(fields) != len(columns):
        raise CandidateRowError(line, f"expected {len(columns)} fields, found {len(fields)}")
    f = dict(zip(columns, fields, strict=True))
    return HistoryRow(
        line=line,
        current_tse_candidate_id=required_int(f["SQ_CANDIDATO_ATUAL"], "SQ_CANDIDATO_ATUAL", line),
        current_year=required_int(f["ANO_ELEICAO_ATUAL"], "ANO_ELEICAO_ATUAL", line),
        year=required_int(f["ANO_ELEICAO"], "ANO_ELEICAO", line),
        turn=required_int(f["NR_TURNO"], "NR_TURNO", line),
        tse_candidate_id=required_int(f["SQ_CANDIDATO"], "SQ_CANDIDATO", line),
        office_name=text(f["DS_CARGO"]),
        electoral_unit=f["SG_UE"].strip().upper(),
    )


def iter_csv(path: Path, layout: DetectedLayout) -> Iterator[tuple[int, list[str]]]:
    """(linha física, campos) de cada registro, após conferir o cabeçalho."""
    with path.open("r", encoding=layout.encoding, newline="") as fh:
        reader = csv.reader(fh, delimiter=layout.delimiter, quotechar=layout.quotechar, strict=True)
        header = next(reader, None)
        if header is None or tuple(header) != layout.columns:
            raise LayoutError(f"{path.name}: header differs from profile {layout.profile}")
        for fields in reader:
            yield reader.line_num, fields
