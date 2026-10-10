"""Layout do CSV "Boletim de Urna" (bweb_<turno>_<UF>_<geração>.csv).

Perfil derivado de DUAS fontes, nunca de suposição:
  1. o cabeçalho real de `bweb_1t_CE_051020261403.csv` (45 colunas);
  2. o leiame oficial embutido no ZIP (`_leiame-boletimurnaweb.pdf`), que
     documenta: codificação "Latin 1"; campos entre aspas separados por ponto
     e vírgula; `#NULO` = em branco (−1 em numéricos); `#NE` = não registrado
     no ano (−3 em numéricos).

Qualquer cabeçalho diferente (coluna a mais, a menos ou reordenada) falha.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

PROFILE_ID = "tse-bweb-2026-v1"
DOCUMENTED_ENCODING = "latin-1"
DOCUMENTED_DELIMITER = ";"

COLUMNS: tuple[str, ...] = (
    "DT_GERACAO", "HH_GERACAO", "ANO_ELEICAO", "CD_TIPO_ELEICAO", "NM_TIPO_ELEICAO",
    "CD_PLEITO", "DT_PLEITO", "NR_TURNO", "CD_ELEICAO", "DS_ELEICAO",
    "SG_UF", "CD_MUNICIPIO", "NM_MUNICIPIO", "NR_ZONA", "NR_SECAO",
    "NR_LOCAL_VOTACAO", "CD_CARGO_PERGUNTA", "DS_CARGO_PERGUNTA", "NR_PARTIDO", "SG_PARTIDO",
    "NM_PARTIDO", "DT_BU_RECEBIDO", "QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCOES",
    "CD_TIPO_URNA", "DS_TIPO_URNA", "CD_TIPO_VOTAVEL", "DS_TIPO_VOTAVEL", "NR_VOTAVEL",
    "NM_VOTAVEL", "QT_VOTOS", "NR_URNA_EFETIVADA", "CD_CARGA_1_URNA_EFETIVADA", "CD_CARGA_2_URNA_EFETIVADA",
    "CD_FLASHCARD_URNA_EFETIVADA", "DT_CARGA_URNA_EFETIVADA", "DS_CARGO_PERGUNTA_SECAO", "DS_SECOES_AGREGADAS", "DT_ABERTURA",
    "DT_ENCERRAMENTO", "QT_ELEI_BIOM_SEM_HABILITACAO", "DT_EMISSAO_BU", "NR_JUNTA_APURADORA", "NR_TURMA_APURADORA",
)

# Colunas numéricas segundo o leiame + valores observados. Nelas, −1 (#NULO) e
# −3 (#NE) significam ausência — nunca zero.
NUMERIC_COLUMNS = frozenset({
    "ANO_ELEICAO", "CD_TIPO_ELEICAO", "CD_PLEITO", "NR_TURNO", "CD_ELEICAO",
    "CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "NR_LOCAL_VOTACAO", "CD_CARGO_PERGUNTA",
    "NR_PARTIDO", "QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCOES", "CD_TIPO_URNA",
    "CD_TIPO_VOTAVEL", "NR_VOTAVEL", "QT_VOTOS", "NR_URNA_EFETIVADA",
    "QT_ELEI_BIOM_SEM_HABILITACAO", "NR_JUNTA_APURADORA", "NR_TURMA_APURADORA",
})
NULL_TEXT_TOKENS = frozenset({"#NULO", "#NULO#", "#NE", "#NE#"})
NULL_NUMERIC_TOKENS = frozenset({"-1", "-3"})


class LayoutError(RuntimeError):
    """Arquivo fora do layout/encoding documentado. Nunca importar."""


@dataclass(frozen=True)
class DetectedLayout:
    profile: str
    encoding: str
    delimiter: str
    quotechar: str
    line_terminator: str
    columns: tuple[str, ...]
    # Cabeçalho exato do arquivo quando o perfil renomeia colunas para os nomes canônicos.
    source_columns: tuple[str, ...] | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "profile": self.profile,
            "encoding": self.encoding,
            "delimiter": self.delimiter,
            "quotechar": self.quotechar,
            "line_terminator": repr(self.line_terminator),
            "columns": len(self.columns),
        }


def _check_encoding(sample: bytes) -> None:
    # Latin-1 decodifica qualquer byte; por isso validamos o que o distinguiria
    # de alternativas plausíveis:
    #  - bytes 0x80–0x9F são controles C1 em Latin-1 mas letras em cp1252;
    #  - um arquivo UTF-8 com acentos decodificaria como UTF-8 multibyte.
    if not any(b >= 0x80 for b in sample):
        return
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError:
        pass  # bytes altos que não formam UTF-8 válido: consistente com Latin-1
    else:
        raise LayoutError("non-ASCII sample is valid UTF-8: encoding differs from the documented Latin-1")
    if any(0x80 <= b <= 0x9F for b in sample):
        raise LayoutError("sample contains bytes 0x80-0x9F: not plain Latin-1 as documented (cp1252?)")


# Perfil 2022: cabeçalho real de `bweb_1t_CE_051020221321.csv` e
# `bweb_2t_CE_311020221535.csv`. Mesmas 45 colunas, na mesma ordem e com o mesmo
# significado (leiame oficial do ZIP); só dois nomes diferem. O arquivo é lido com o
# cabeçalho exato e as colunas recebem os nomes canônicos acima.
PROFILE_ID_2022 = "tse-bweb-2022-v1"
RENAMED_2022: dict[str, str] = {
    "DS_SECOES_AGREGADAS": "DS_AGREGADAS",
    "QT_ELEI_BIOM_SEM_HABILITACAO": "QT_ELEITORES_BIOMETRIA_NH",
}
COLUMNS_2022: tuple[str, ...] = tuple(RENAMED_2022.get(c, c) for c in COLUMNS)

# (perfil, cabeçalho exato do arquivo); 2024 publica o mesmo cabeçalho de 2026.
PROFILES: tuple[tuple[str, tuple[str, ...]], ...] = ((PROFILE_ID, COLUMNS), (PROFILE_ID_2022, COLUMNS_2022))


def detect_layout(path: Path, *, sample_bytes: int = 4 << 20) -> DetectedLayout:
    """Layout do Boletim de Urna: o cabeçalho tem de ser EXATAMENTE um dos perfis
    documentados. As colunas devolvidas usam sempre os nomes canônicos (`COLUMNS`)."""
    errors: list[str] = []
    for profile_id, header in PROFILES:
        try:
            detected = detect_csv_layout(path, columns=header, profile_id=profile_id, sample_bytes=sample_bytes)
        except LayoutError as exc:
            if "header does not match" not in str(exc):
                raise  # encoding/separador errados não dependem do perfil
            errors.append(str(exc))
            continue
        return DetectedLayout(
            detected.profile, detected.encoding, detected.delimiter, detected.quotechar, detected.line_terminator, COLUMNS,
            source_columns=None if header == COLUMNS else header,
        )
    raise LayoutError("; ".join(errors))


def detect_csv_layout(
    path: Path, *, columns: tuple[str, ...], profile_id: str, sample_bytes: int = 4 << 20
) -> DetectedLayout:
    """Confere encoding (Latin-1), separador (`;`) e cabeçalho exato de um CSV
    de Dados Abertos do TSE contra um perfil de colunas documentado."""
    with path.open("rb") as fh:
        sample = fh.read(sample_bytes)
    if not sample:
        raise LayoutError("empty CSV")
    first_line_end = sample.find(b"\n")
    if first_line_end < 0:
        raise LayoutError("no line terminator in sample: truncated or not a CSV")
    terminator = "\r\n" if sample[first_line_end - 1 : first_line_end] == b"\r" else "\n"
    header_bytes = sample[:first_line_end].rstrip(b"\r")
    if any(b >= 0x80 for b in header_bytes):
        raise LayoutError("header must be ASCII")
    # só linhas completas: um corte no meio de um caractere UTF-8 multibyte
    # faria um arquivo UTF-8 parecer Latin-1
    _check_encoding(sample[: sample.rfind(b"\n") + 1])

    header_text = header_bytes.decode("ascii")
    try:
        dialect = csv.Sniffer().sniff(header_text, delimiters=";,\t|")
    except csv.Error as exc:
        raise LayoutError(f"cannot detect delimiter: {exc}") from exc
    if dialect.delimiter != DOCUMENTED_DELIMITER:
        raise LayoutError(f"delimiter {dialect.delimiter!r} differs from documented {DOCUMENTED_DELIMITER!r}")
    header = next(csv.reader([header_text], delimiter=dialect.delimiter, quotechar='"'))
    if tuple(header) != columns:
        missing = [c for c in columns if c not in header]
        extra = [c for c in header if c not in columns]
        raise LayoutError(
            f"header does not match profile {profile_id}: missing={missing} extra={extra} "
            f"(order {'differs' if not missing and not extra else 'n/a'})"
        )
    return DetectedLayout(profile_id, DOCUMENTED_ENCODING, DOCUMENTED_DELIMITER, '"', terminator, tuple(header))
