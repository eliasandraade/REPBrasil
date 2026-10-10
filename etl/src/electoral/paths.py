"""Caminhos de saída dos CLIs: relatórios só dentro do repositório.

Argumentos de linha de comando nunca escolhem livremente onde gravar: o caminho é resolvido
(`realpath`, sem `..` nem links) e precisa ficar dentro da raiz do repositório.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # etl/src/electoral/paths.py → raiz do repositório


def output_path(raw: str | os.PathLike[str], *, root: Path = REPO_ROOT) -> Path:
    base = os.path.realpath(root)
    target = os.path.realpath(raw)
    if os.path.commonpath([base, target]) != base:
        raise SystemExit(f"output path must be inside the repository ({base}): {raw}")
    return Path(target)
