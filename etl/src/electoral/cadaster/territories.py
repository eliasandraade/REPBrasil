"""UFs e municípios: "Códigos oficiais de UF e municípios segundo o TSE e o IBGE".

Autoridade para identidade territorial e nomes. O código do município no TSE
(5 dígitos) é a identidade eleitoral; o código IBGE (7 dígitos) liga o
município à malha geográfica. Os dois vêm da MESMA linha oficial — nenhum
casamento por nome.

O slug é derivado do nome IBGE só para navegação (URL). Colisões dentro da
mesma UF recebem o código TSE como sufixo, de forma determinística.
"""
from __future__ import annotations

import csv
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from ..open_data.layout import detect_csv_layout
from .errors import CadasterError

PROFILE_ID = "tse-municipio-tse-ibge-v1"
COLUMNS: tuple[str, ...] = (
    "DT_GERACAO",
    "HH_GERACAO",
    "CD_UF_TSE",
    "CD_UF_IBGE",
    "SG_UF",
    "NM_UF",
    "CD_MUNICIPIO_TSE",
    "NM_MUNICIPIO_TSE",
    "CD_MUNICIPIO_IBGE",
    "NM_MUNICIPIO_IBGE",
)


@dataclass(frozen=True)
class StateRecord:
    uf: str
    name: str
    ibge_code: int
    tse_code: int


@dataclass(frozen=True)
class MunicipalityRecord:
    uf: str
    tse_code: str
    ibge_code: int
    name: str
    tse_name: str
    slug: str


@dataclass(frozen=True)
class Territories:
    generated_at: str
    states: dict[str, StateRecord]
    municipalities: dict[tuple[str, str], MunicipalityRecord]  # (UF, código TSE)

    def municipality(self, uf: str, tse_code: str | int) -> MunicipalityRecord | None:
        return self.municipalities.get((uf.upper(), str(tse_code).zfill(5)))


def slugify(name: str) -> str:
    """"General Sampaio" → "general-sampaio"; "Olho-d'Água" → "olho-d-agua"."""
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c)).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
    if not slug:
        raise CadasterError(f"cannot derive a slug from {name!r}")
    return slug


def assign_slugs(entries: list[tuple[str, str, str]]) -> dict[tuple[str, str], str]:
    """(UF, código TSE, nome) → slug único por UF. Colisão ⇒ `<slug>-<código TSE>` para todos os envolvidos."""
    by_slug: dict[tuple[str, str], list[str]] = defaultdict(list)
    for uf, code, name in entries:
        by_slug[(uf, slugify(name))].append(code)
    out: dict[tuple[str, str], str] = {}
    for (uf, slug), codes in by_slug.items():
        for code in codes:
            out[(uf, code)] = slug if len(codes) == 1 else f"{slug}-{code}"
    per_uf = [(uf, slug) for (uf, _), slug in out.items()]
    if len(per_uf) != len(set(per_uf)):
        raise CadasterError("slug collision after disambiguation")
    return out


def _int(raw: str, column: str, line: int) -> int:
    if not re.fullmatch(r"\d+", raw):
        raise CadasterError(f"line {line}: {column} must be numeric, got {raw!r}")
    return int(raw)


def parse_territories(csv_path: Path) -> Territories:
    layout = detect_csv_layout(csv_path, columns=COLUMNS, profile_id=PROFILE_ID)
    states: dict[str, StateRecord] = {}
    raw: dict[tuple[str, str], tuple[int, str, str]] = {}
    ibge_seen: dict[int, tuple[str, str]] = {}
    generated: set[str] = set()
    with csv_path.open("r", encoding=layout.encoding, newline="") as fh:
        reader = csv.reader(fh, delimiter=layout.delimiter, quotechar=layout.quotechar)
        next(reader)
        for line, fields in enumerate(reader, start=2):
            if len(fields) != len(COLUMNS):
                raise CadasterError(f"line {line}: expected {len(COLUMNS)} fields, got {len(fields)} (truncated?)")
            row = dict(zip(COLUMNS, (f.strip() for f in fields), strict=False))
            generated.add(f"{row['DT_GERACAO']} {row['HH_GERACAO']}")
            uf = row["SG_UF"].upper()
            if not re.fullmatch(r"[A-Z]{2}", uf):
                raise CadasterError(f"line {line}: invalid SG_UF {uf!r}")
            state = StateRecord(uf, row["NM_UF"], _int(row["CD_UF_IBGE"], "CD_UF_IBGE", line), _int(row["CD_UF_TSE"], "CD_UF_TSE", line))
            if states.setdefault(uf, state) != state:
                raise CadasterError(f"line {line}: conflicting data for UF {uf}: {states[uf]} vs {state}")
            tse = row["CD_MUNICIPIO_TSE"]
            if not re.fullmatch(r"\d{5}", tse):
                raise CadasterError(f"line {line}: CD_MUNICIPIO_TSE must have 5 digits, got {tse!r}")
            ibge = _int(row["CD_MUNICIPIO_IBGE"], "CD_MUNICIPIO_IBGE", line)
            if len(str(ibge)) != 7 or str(ibge)[:2] != str(state.ibge_code):
                raise CadasterError(f"line {line}: IBGE code {ibge} does not belong to UF {uf} ({state.ibge_code})")
            key = (uf, tse)
            if key in raw:
                raise CadasterError(f"line {line}: duplicate municipality {uf}/{tse}")
            if ibge in ibge_seen:
                raise CadasterError(f"line {line}: IBGE code {ibge} mapped to two TSE municipalities {ibge_seen[ibge]} and {key}")
            ibge_seen[ibge] = key
            if not row["NM_MUNICIPIO_IBGE"]:
                raise CadasterError(f"line {line}: empty NM_MUNICIPIO_IBGE")
            raw[key] = (ibge, row["NM_MUNICIPIO_IBGE"], row["NM_MUNICIPIO_TSE"])
    if not raw:
        raise CadasterError("territory file has no rows")
    if len(generated) != 1:
        raise CadasterError(f"territory file mixes generation timestamps: {sorted(generated)}")
    slugs = assign_slugs([(uf, code, name) for (uf, code), (_, name, _) in raw.items()])
    municipalities = {
        key: MunicipalityRecord(key[0], key[1], ibge, name, tse_name, slugs[key]) for key, (ibge, name, tse_name) in raw.items()
    }
    return Territories(generated.pop(), states, municipalities)
