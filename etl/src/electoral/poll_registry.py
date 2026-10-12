from __future__ import annotations

import csv
import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from src.electoral.polls import PollRecord

_BRT = ZoneInfo("America/Sao_Paulo")
_OFFICE_CODES = {
    "PRESIDENTE": 1,
    "GOVERNADOR": 3,
    "SENADOR": 5,
    "DEPUTADO FEDERAL": 6,
    "DEPUTADO ESTADUAL": 7,
    "DEPUTADO DISTRITAL": 8,
}
_REQUIRED_COLUMNS = {
    "NR_PROTOCOLO_REGISTRO",
    "NM_EMPRESA",
    "DT_INICIO_PESQUISA",
    "DT_FIM_PESQUISA",
    "SG_UF",
    "NM_UE",
}
_OFFICE_COLUMNS = ("DS_CARGO", "DS_CARGOS")
_SAMPLE_COLUMNS = ("QT_ENTREVISTADO", "QT_ENTREVISTADOS")


@dataclass(frozen=True)
class PollRegistryParseResult:
    member_name: str
    rows: tuple[PollRecord, ...]


def _decode(content: bytes) -> str:
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("unsupported PesqEle CSV encoding")


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_text = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", ascii_text).strip().upper()


def _parse_date(value: str, field: str, *, required: bool) -> date | None:
    text = value.strip()
    if not text:
        if required:
            raise ValueError(f"missing required PesqEle date: {field}")
        return None
    for pattern in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    raise ValueError(f"invalid PesqEle date in {field}: {value!r}")


def _optional_int(value: str, field: str) -> int | None:
    text = value.strip()
    if not text:
        return None
    digits = re.sub(r"[^0-9-]", "", text)
    if not digits or digits in {"-", "+"}:
        raise ValueError(f"invalid integer in PesqEle {field}: {value!r}")
    parsed = int(digits)
    if parsed < 0:
        raise ValueError(f"negative integer in PesqEle {field}: {value!r}")
    return parsed


def _office_codes(value: str) -> tuple[int, ...]:
    normalized = _normalize(value)
    if not normalized:
        raise ValueError("PesqEle row without office")
    matches = tuple(
        code
        for label, code in _OFFICE_CODES.items()
        if re.search(rf"(?<![A-Z]){re.escape(label)}(?![A-Z])", normalized)
    )
    if not matches:
        raise ValueError(f"unsupported PesqEle office: {value!r}")
    return tuple(dict.fromkeys(matches))


def _slug(cnpj: str, name: str) -> str:
    digits = re.sub(r"\D", "", cnpj)
    if len(digits) == 14:
        return f"tse-{digits}"
    base = _normalize(name).lower().replace(" ", "-")
    base = re.sub(r"[^a-z0-9-]", "", base).strip("-")
    if not base:
        raise ValueError("cannot derive a stable institute slug")
    return f"tse-name-{base}"


def _scope(row: dict[str, str]) -> tuple[str | None, str | None]:
    uf = row.get("SG_UF", "").strip().upper()
    electoral_unit = row.get("NM_UE", "").strip()
    if uf == "BR":
        return None, None
    if len(uf) != 2 or not uf.isalpha():
        raise ValueError(f"invalid PesqEle UF: {uf!r}")
    municipality = electoral_unit if len(electoral_unit) == 5 and electoral_unit.isdigit() else None
    return uf, municipality


def _member_name(names: list[str], year: int) -> str:
    expected = f"pesquisa_eleitoral_{year}_BRASIL.csv".lower()
    matches = [name for name in names if name.rsplit("/", 1)[-1].lower() == expected]
    if len(matches) != 1:
        raise ValueError(
            f"PesqEle archive must contain exactly one {expected}; found {len(matches)}"
        )
    return matches[0]


def parse_poll_registry_archive(
    content: bytes,
    *,
    year: int,
    uf_filter: str | None = None,
) -> PollRegistryParseResult:
    """Parse the official annual PesqEle registry ZIP into auditable poll metadata.

    The open-data CSV contains registration/design metadata, not candidate percentages.
    Therefore every normalized PollRecord deliberately has no result scenarios.
    """
    if year < 2012 or year > 2200:
        raise ValueError("PesqEle year is outside the supported range")
    if not content:
        raise ValueError("empty PesqEle archive")
    normalized_filter = uf_filter.strip().upper() if uf_filter else None
    if normalized_filter is not None and normalized_filter != "BR" and (
        len(normalized_filter) != 2 or not normalized_filter.isalpha()
    ):
        raise ValueError("PesqEle UF filter must be BR or two letters")

    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise ValueError("invalid PesqEle ZIP archive") from exc

    with archive:
        member = _member_name(archive.namelist(), year)
        raw_csv = archive.read(member)
    reader = csv.DictReader(io.StringIO(_decode(raw_csv)), delimiter=";")
    if reader.fieldnames is None:
        raise ValueError("PesqEle CSV has no header")
    fields = {field.strip() for field in reader.fieldnames if field}
    missing = sorted(_REQUIRED_COLUMNS - fields)
    if missing:
        raise ValueError(f"PesqEle CSV missing required columns: {', '.join(missing)}")
    office_column = next((column for column in _OFFICE_COLUMNS if column in fields), None)
    if office_column is None:
        raise ValueError("PesqEle CSV missing office column")
    sample_column = next((column for column in _SAMPLE_COLUMNS if column in fields), None)

    records: list[PollRecord] = []
    for line_number, raw_row in enumerate(reader, start=2):
        row = {str(key).strip(): str(value or "") for key, value in raw_row.items() if key}
        registration = row.get("NR_PROTOCOLO_REGISTRO", "").strip()
        if not registration:
            raise ValueError(f"PesqEle line {line_number} without registration number")
        state_code, municipality_code = _scope(row)
        row_scope = state_code or "BR"
        if normalized_filter is not None and row_scope != normalized_filter:
            continue

        institute_legal = row.get("NM_EMPRESA", "").strip()
        if not institute_legal:
            raise ValueError(f"PesqEle line {line_number} without institute name")
        institute_trade = row.get("NM_EMPRESA_FANTASIA", "").strip()
        institute_name = institute_trade or institute_legal
        institute_slug = _slug(row.get("NR_CNPJ_EMPRESA", ""), institute_legal)
        field_start = _parse_date(
            row.get("DT_INICIO_PESQUISA", ""),
            "DT_INICIO_PESQUISA",
            required=True,
        )
        field_end = _parse_date(
            row.get("DT_FIM_PESQUISA", ""),
            "DT_FIM_PESQUISA",
            required=True,
        )
        assert field_start is not None and field_end is not None
        publication = _parse_date(
            row.get("DT_DIVULGACAO", ""),
            "DT_DIVULGACAO",
            required=False,
        )
        sample_size = (
            _optional_int(row.get(sample_column, ""), sample_column)
            if sample_column is not None
            else None
        )
        methodology = row.get("DS_METODOLOGIA_PESQUISA", "").strip() or None

        for office_code in _office_codes(row.get(office_column, "")):
            records.append(
                PollRecord(
                    year=year,
                    office_code=office_code,
                    registration_number=registration,
                    institute_name=institute_name,
                    institute_slug=institute_slug,
                    field_start=field_start,
                    field_end=field_end,
                    state_code=state_code,
                    municipality_tse_code=municipality_code,
                    published_at=(
                        datetime.combine(publication, datetime.min.time()).replace(tzinfo=_BRT)
                        if publication is not None
                        else None
                    ),
                    sample_size=sample_size,
                    methodology=methodology,
                )
            )

    return PollRegistryParseResult(member_name=member, rows=tuple(records))
