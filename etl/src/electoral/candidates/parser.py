"""Leitura estrita dos CSVs de candidatos e de histórico de candidaturas do TSE.

Sentinelas do TSE viram NULL, nunca zero nem texto inventado:
`#NULO`, `#NE`, `NÃO DIVULGÁVEL` e códigos negativos (-1, -3, -4).
Cada linha guarda o número físico da linha e uma impressão digital REDIGIDA:

- integridade integral do arquivo = SHA-256/SHA-512 do ZIP e SHA-256 do CSV, registrados em
  `open_data_source_file`;
- `candidacy.source_row_hash` = SHA-256 dos campos canônicos da linha com `NR_CPF_CANDIDATO`
  substituído por `[REDACTED]` — proveniência da linha, sem material que permita confirmar um CPF
  offline;
- CPF = somente HMAC-SHA256 com chave secreta, para identidade (identity.py). Nunca gravado nem logado.
"""

from __future__ import annotations

import csv
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from ..open_data.layout import DetectedLayout, LayoutError
from ..open_data.parser import row_hash

CPF_COLUMN = "NR_CPF_CANDIDATO"
CPF_REDACTION = "[REDACTED]"


def candidate_row_hash(fields: list[str], columns: tuple[str, ...]) -> str:
    """Impressão digital da linha de candidatura com o CPF redigido (nunca o hash da linha bruta)."""
    return row_hash([CPF_REDACTION if c == CPF_COLUMN else v for c, v in zip(columns, fields, strict=True)])


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

SCOPE_BY_ABRANGENCIA = {"FEDERAL": "federal", "ESTADUAL": "state", "MUNICIPAL": "municipal"}


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


def iso_date(raw: str, line: int) -> str | None:
    """DD/MM/AAAA → AAAA-MM-DD; sentinela ⇒ None; qualquer outro formato é erro."""
    value = text(raw)
    if value is None:
        return None
    parts = value.split("/")
    if len(parts) != 3 or not all(p.isdigit() for p in parts) or len(parts[2]) != 4:
        raise CandidateRowError(line, f"date {value!r} is not DD/MM/YYYY")
    return f"{parts[2]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"


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
    # CD_TIPO_ELEICAO: 2 = ordinária, 1 = suplementar (o arquivo do ano traz as suplementares
    # realizadas depois, com o mesmo ANO_ELEICAO); DT_ELEICAO em ISO.
    election_type_code: int | None
    election_date: str | None
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
    scope = SCOPE_BY_ABRANGENCIA[abrangencia]
    unit = f["SG_UE"].strip().upper()
    uf = f["SG_UF"].strip().upper()
    if len(uf) != 2:
        raise CandidateRowError(line, f"SG_UF must be a 2-letter code, found {uf!r}")
    if not unit:
        raise CandidateRowError(line, "SG_UE is required")
    if scope == "federal" and unit != "BR":
        raise CandidateRowError(line, f"federal contest with electoral unit {unit!r}")
    if scope == "state" and len(unit) != 2:
        raise CandidateRowError(line, f"state contest with electoral unit {unit!r}")
    if scope == "municipal":
        # SG_UE municipal = código TSE do município; normalizado com 5 dígitos, igual ao BU.
        if not unit.isdigit() or len(unit) > 5:
            raise CandidateRowError(line, f"municipal contest with electoral unit {unit!r} (expected a TSE municipality code)")
        unit = unit.zfill(5)
    full_name, ballot_name = text(f["NM_CANDIDATO"]), text(f["NM_URNA_CANDIDATO"])
    office_name = text(f["DS_CARGO"])
    if not full_name or not ballot_name or not office_name:
        raise CandidateRowError(line, "NM_CANDIDATO, NM_URNA_CANDIDATO and DS_CARGO are required")
    outcome_code = code(f["CD_SIT_TOT_TURNO"], "CD_SIT_TOT_TURNO", line)
    return CandidateRow(
        source_member=member,
        line=line,
        source_row_hash=candidate_row_hash(fields, columns),
        generated_at=f"{f['DT_GERACAO'].strip()} {f['HH_GERACAO'].strip()}",
        year=required_int(f["ANO_ELEICAO"], "ANO_ELEICAO", line),
        turn=required_int(f["NR_TURNO"], "NR_TURNO", line),
        election_code=required_int(f["CD_ELEICAO"], "CD_ELEICAO", line),
        election_description=text(f["DS_ELEICAO"]),
        election_type_code=code(f["CD_TIPO_ELEICAO"], "CD_TIPO_ELEICAO", line),
        election_date=iso_date(f["DT_ELEICAO"], line),
        scope=scope,
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
    """Uma candidatura anterior (SQ_CANDIDATO) da pessoa da candidatura atual (SQ_CANDIDATO_ATUAL).

    O arquivo não traz CPF: só a relação oficial entre SQ_CANDIDATO e os dados públicos da
    candidatura anterior (cargo, unidade, número, nome de urna, partido, resultado).
    """

    line: int
    current_tse_candidate_id: int
    current_year: int
    year: int
    turn: int
    tse_candidate_id: int
    office_name: str | None
    electoral_unit: str
    source_member: str = ""
    office_code: int | None = None
    unit_name: str | None = None
    candidate_number: int | None = None
    ballot_name: str | None = None
    party_acronym: str | None = None
    round_outcome: str | None = None


def parse_history(fields: list[str], line: int, columns: tuple[str, ...], member: str = "") -> HistoryRow:
    if len(fields) != len(columns):
        raise CandidateRowError(line, f"expected {len(columns)} fields, found {len(fields)}")
    f = dict(zip(columns, fields, strict=True))
    unit = f["SG_UE"].strip().upper()
    # SG_UE municipal = código TSE do município: mesma normalização das candidaturas e do BU.
    if unit.isdigit():
        unit = unit.zfill(5)
    return HistoryRow(
        line=line,
        current_tse_candidate_id=required_int(f["SQ_CANDIDATO_ATUAL"], "SQ_CANDIDATO_ATUAL", line),
        current_year=required_int(f["ANO_ELEICAO_ATUAL"], "ANO_ELEICAO_ATUAL", line),
        year=required_int(f["ANO_ELEICAO"], "ANO_ELEICAO", line),
        turn=required_int(f["NR_TURNO"], "NR_TURNO", line),
        tse_candidate_id=required_int(f["SQ_CANDIDATO"], "SQ_CANDIDATO", line),
        office_name=text(f["DS_CARGO"]),
        electoral_unit=unit,
        source_member=member,
        office_code=code(f["CD_CARGO"], "CD_CARGO", line),
        unit_name=text(f["NM_UE"]),
        candidate_number=code(f["NR_CANDIDATO"], "NR_CANDIDATO", line),
        ballot_name=text(f["NM_URNA_CANDIDATO"]),
        party_acronym=text(f["SG_PARTIDO"]),
        round_outcome=text(f["DS_SIT_TOT_TURNO"]),
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
