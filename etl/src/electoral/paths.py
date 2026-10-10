"""Saída dos CLIs em diretórios fixos do repositório.

Argumentos de linha de comando nunca escolhem onde gravar: o diretório é fixo e o nome do
arquivo é montado só com valores validados (ano/turno inteiros e unidade eleitoral de uma
lista fechada, devolvida a partir da própria lista — nunca o texto recebido).
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # etl/src/electoral/paths.py → raiz do repositório
REPORTS_DIR = REPO_ROOT / "etl" / "artifacts" / "reports"  # relatórios JSON completos (ignorado pelo git)
AUDITS_DIR = REPO_ROOT / "docs" / "audits"  # resumo da auditoria por eleição (versionado)

# As 27 UFs, BR (disputas federais) e ZZ (exterior, nos arquivos de Boletim de Urna).
UNITS = (
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI",
    "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO", "BR", "ZZ",
)


def unit_code(raw: str) -> str:
    """UF (ou BR) validada; o valor devolvido sai da lista fechada."""
    wanted = raw.strip().upper()
    for unit in UNITS:
        if unit == wanted:
            return unit
    raise SystemExit(f"unknown electoral unit {raw!r}; expected one of {', '.join(UNITS)}")


def report_file(directory: Path, kind: str, year: int, unit: str, turn: int | None = None, *, suffix: str = ".json") -> Path:
    """`<directory>/<kind>_<ano>_<UF>[_t<turno>]<suffix>`, com o diretório criado."""
    name = f"{kind}_{int(year)}_{unit_code(unit)}" + ("" if turn is None else f"_t{int(turn)}") + suffix
    directory.mkdir(parents=True, exist_ok=True)
    return directory / name


def write_report(path: Path, text: str) -> Path:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text if text.endswith("\n") else text + "\n")
    return path
