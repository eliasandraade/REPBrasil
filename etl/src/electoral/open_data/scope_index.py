"""Índice de escopos (UF × município × zona) de um CSV de Boletim de Urna.

O CSV estadual tem centenas de MB a mais de 1 GB e a importação acontece por
município × zona. Sem índice, cada escopo percorreria o arquivo inteiro. O índice
é construído em UMA passada e guarda, para cada escopo, os intervalos contíguos de
bytes com o número da linha física inicial — a proveniência de cada voto continua
apontando para a linha original do arquivo oficial.

Garantias:
- O índice é derivado (cache), nunca fonte: fica ao lado do CSV, amarrado ao
  SHA-256 e ao tamanho declarados no manifesto; qualquer divergência o descarta.
- Registros com quebra de linha interna fariam um intervalo cortar um registro: o
  leitor CSV estrito falha pela largura de campos (fail-closed), nunca importa
  meia linha.
"""
from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from .layout import DetectedLayout, LayoutError
from .parser import _IDX, BURow, ScanStats, parse_row

INDEX_VERSION = 1


def _key(uf: str, municipality: int, zone: int) -> str:
    return f"{uf}|{municipality}|{zone}"


def _field(line: bytes, index: int, delimiter: bytes) -> bytes:
    # Campos do BU são sempre entre aspas e nunca contêm o separador entre aspas
    # nas colunas de chave (UF, código de município, zona): basta dividir.
    parts = line.split(delimiter, index + 1)
    return parts[index].strip().strip(b'"')


def build_scope_index(csv_path: Path, layout: DetectedLayout, *, csv_sha256: str, csv_size: int) -> dict[str, Any]:
    delimiter = layout.delimiter.encode("ascii")
    i_uf, i_mun, i_zone = _IDX["SG_UF"], _IDX["CD_MUNICIPIO"], _IDX["NR_ZONA"]
    scopes: dict[str, list[list[int]]] = {}
    current: str | None = None
    rows = 0
    with csv_path.open("rb") as fh:
        header = fh.readline()
        if not header:
            raise LayoutError("empty CSV")
        offset = len(header)
        line_no = 1
        for raw in fh:
            line_no += 1
            start = offset
            offset += len(raw)
            body = raw.rstrip(b"\r\n")
            if not body:
                continue
            rows += 1
            try:
                key = _key(
                    _field(body, i_uf, delimiter).decode("latin-1"),
                    int(_field(body, i_mun, delimiter)),
                    int(_field(body, i_zone, delimiter)),
                )
            except (ValueError, IndexError) as exc:
                raise LayoutError(f"line {line_no}: cannot read the scope columns for indexing") from exc
            if key == current:
                scopes[key][-1][2] = offset
            else:
                scopes.setdefault(key, []).append([start, line_no, offset])
                current = key
    if offset != csv_size:
        raise LayoutError(f"indexed {offset} bytes, manifest declares {csv_size}")
    return {"version": INDEX_VERSION, "csv_sha256": csv_sha256, "csv_size": csv_size, "rows": rows, "scopes": scopes}


def load_or_build_scope_index(csv_path: Path, layout: DetectedLayout, *, csv_sha256: str, csv_size: int) -> dict[str, Any]:
    cache = csv_path.with_name(csv_path.name + ".scope-index.json")
    if cache.exists():
        cached = json.loads(cache.read_text(encoding="utf-8"))
        if (
            cached.get("version") == INDEX_VERSION
            and cached.get("csv_sha256") == csv_sha256
            and cached.get("csv_size") == csv_size
            and csv_path.stat().st_size == csv_size
        ):
            return cached
    index = build_scope_index(csv_path, layout, csv_sha256=csv_sha256, csv_size=csv_size)
    tmp = cache.with_suffix(".tmp")
    tmp.write_text(json.dumps(index), encoding="utf-8")
    tmp.replace(cache)
    return index


def scan_indexed(
    path: Path,
    layout: DetectedLayout,
    index: dict[str, Any],
    *,
    uf: str,
    municipality: int,
    zone: int,
    stats: ScanStats,
) -> Iterator[BURow]:
    """Lê somente os intervalos do escopo; linhas e validações iguais a `scan`."""
    width = len(layout.columns)
    i_uf, i_mun, i_zone = _IDX["SG_UF"], _IDX["CD_MUNICIPIO"], _IDX["NR_ZONA"]
    stats.rows_read = int(index["rows"])
    with path.open("rb") as fh:
        for start, first_line, end in index["scopes"].get(_key(uf, municipality, zone), []):
            fh.seek(start)
            text = fh.read(end - start).decode(layout.encoding)
            reader = csv.reader(io.StringIO(text, newline=""), delimiter=layout.delimiter, quotechar=layout.quotechar, strict=True)
            for fields in reader:
                line = first_line + reader.line_num - 1
                if len(fields) != width:
                    raise LayoutError(f"line {line}: expected {width} fields, found {len(fields)} (truncated or malformed)")
                stats.ufs_seen.add(fields[i_uf])
                if fields[i_uf] != uf or int(fields[i_mun]) != municipality or int(fields[i_zone]) != zone:
                    raise LayoutError(f"line {line}: scope index points outside {uf}/{municipality}/{zone}")
                stats.rows_matching_uf += 1
                stats.rows_matching_municipality += 1
                stats.rows_matching_zone += 1
                yield parse_row(fields, line)
