"""CLI: prestação de contas de candidatos (TSE) → candidacy_finance_record.

    python -m src.electoral.finance.cli import --year 2024 --uf CE --dry-run
    python -m src.electoral.finance.cli import --year 2024 --uf CE
    python -m src.electoral.finance.cli import --year 2024 --uf CE --zip caminho/prestacao.zip   # arquivo local
    python -m src.electoral.finance.cli import --year 2024 --uf CE --save-report   # etl/artifacts/reports/

Remoto (padrão): só os membros da UF são lidos (HTTP Range presa à versão publicada); o ZIP inteiro
é lido em streaming apenas para o SHA-256/SHA-512 de proveniência — nada vai para o disco.
Exige `REPBRASIL_PERSON_DOCUMENT_KEY` na importação (HMAC de documentos de doadores/fornecedores).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from .. import db as electoral_db
from ..cadaster.sources import CadasterResourceSpec, discover_resource
from ..candidates import identity
from ..paths import REPORTS_DIR, report_file, unit_code, write_report
from .parser import MEMBERS, FinanceRow, iter_member, parse_row
from .remote import PinnedRangeFile, _client, head, stream_digests
from .store import SOURCE, FinanceConflict, import_finance, select_rows

RESOURCE_NAME = "Prestação de contas de candidatos"
# O dataset de 2022 foi publicado com outro identificador no portal.
DATASETS = {2022: "dadosabertos-tse-jus-br-dataset-prestacao-de-contas-eleitorais-2022"}


def dataset_for(year: int) -> str:
    return DATASETS.get(year, f"prestacao-de-contas-eleitorais-{year}")


class _HashingReader(io.RawIOBase):
    """Repassa os bytes do membro e calcula o SHA-256 do que foi efetivamente lido."""

    def __init__(self, inner) -> None:
        self.inner = inner
        self.sha256 = hashlib.sha256()
        self.size = 0

    def readable(self) -> bool:
        return True

    def readinto(self, buffer) -> int:  # type: ignore[override]
        data = self.inner.read(len(buffer))
        buffer[: len(data)] = data
        self.sha256.update(data)
        self.size += len(data)
        return len(data)


def read_members(zf: zipfile.ZipFile, year: int, uf: str) -> tuple[list[FinanceRow], list[dict[str, Any]]]:
    rows: list[FinanceRow] = []
    members: list[dict[str, Any]] = []
    for prefix, (kind, columns, profile) in MEMBERS.items():
        name = f"{prefix}_{year}_{uf}.csv"
        if name not in zf.namelist():
            raise SystemExit(f"{name} not found in the official ZIP")
        with zf.open(name) as raw:  # zipfile confere o CRC-32 ao chegar ao fim do membro
            hashing = _HashingReader(raw)
            stream = io.BufferedReader(hashing, buffer_size=1 << 20)
            for line, fields in iter_member(stream, columns, name):
                rows.append(parse_row(kind, fields, line, columns, name))
        members.append({"name": name, "kind": kind, "profile": profile, "size": hashing.size, "sha256": hashing.sha256.hexdigest()})
    return rows, members


def summarize(rows: list[FinanceRow], year: int, uf: str) -> dict[str, Any]:
    selected, counts = select_rows(rows, year=year, uf=uf)
    totals: dict[str, Decimal] = defaultdict(Decimal)
    kinds: Counter[str] = Counter()
    for group in selected.values():
        for r in group:
            totals[r.kind] += r.amount or Decimal(0)
            kinds[r.kind] += 1
    return {
        "rows": len(rows), **counts, "candidacies": len(selected), "selected_rows_by_kind": dict(kinds),
        "amount_by_kind": {k: str(v) for k, v in totals.items()},
        "accounts_types": dict(Counter(r.accounts_type for r in rows)),
        "counterparty_kinds": dict(Counter(r.counterparty_kind for r in rows if r.counterparty_kind)),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="repbrasil-electoral-finance")
    sub = parser.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("import", help="import campaign finance (revenues, contracted and paid expenses) of one UF/year")
    imp.add_argument("--year", type=int, required=True)
    imp.add_argument("--uf", required=True, help="UF of the official CSVs (BR = federal candidacies)")
    imp.add_argument("--zip", type=Path, default=None, help="local copy of the official ZIP (default: read the official URL)")
    imp.add_argument("--supersede", action="store_true", help="apply a newer official file that changes stored records")
    imp.add_argument("--dry-run", action="store_true", help="parse and validate only (no zip digest, no database)")
    imp.add_argument("--database-url", default=None, help="defaults to $DATABASE_URL")
    imp.add_argument("--save-report", action="store_true", help="write the full JSON report to etl/artifacts/reports/")
    return parser


def _emit(report: dict[str, Any], target: Path | None) -> None:
    if target is not None:
        write_report(target, json.dumps(report, ensure_ascii=False, indent=2, default=str))
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in report.items()}, ensure_ascii=False, indent=2, default=str))


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    # Só valores validados seguem adiante (e nomeiam o relatório, num diretório fixo).
    year, uf = int(args.year), unit_code(args.uf)
    target = report_file(REPORTS_DIR, "finance", year, uf) if args.save_report else None
    from ..http_client import TSEHttpClient

    client = TSEHttpClient()
    try:
        resource = discover_resource(client, CadasterResourceSpec(SOURCE, dataset_for(year), RESOURCE_NAME))
    finally:
        client.close()

    if args.zip is not None:
        data = args.zip.read_bytes() if not args.dry_run else None
        sha256 = hashlib.sha256(data).hexdigest() if data is not None else None
        sha512 = hashlib.sha512(data).hexdigest() if data is not None else None
        size = args.zip.stat().st_size
        with zipfile.ZipFile(args.zip) as zf:
            rows, members = read_members(zf, year, uf)
    else:
        http = _client()
        try:
            version = head(resource.url, http)
            with zipfile.ZipFile(io.BufferedReader(PinnedRangeFile(version, http), buffer_size=1 << 20)) as zf:
                rows, members = read_members(zf, year, uf)
            sha256, sha512 = (None, None) if args.dry_run else stream_digests(version, http)
            size = version.size
            # mesma versão do início ao fim (o If-Range/If-Match já falham se o arquivo mudar)
            if head(resource.url, http) != version:
                raise SystemExit("official ZIP changed during acquisition; nothing imported")
        finally:
            http.close()

    if args.dry_run:
        _emit({"status": "dry_run", "url": resource.url, "zip_size": size, "members": members,
               **summarize(rows, year, uf)}, target)
        return 0

    manifest = {
        "kind": SOURCE,
        "source": {"portal": resource.portal, "dataset": resource.dataset_name, "dataset_id": resource.dataset_id,
                   "resource_id": resource.resource_id, "resource_name": resource.resource_name, "url": resource.url,
                   "metadata_modified": resource.metadata_modified},
        "downloaded_at": datetime.now(UTC).isoformat(),
        "zip": {"name": resource.url.rsplit("/", 1)[-1], "size": size, "sha256": sha256, "sha512": sha512},
        "official_checksum": {"status": "not_published"},
    }
    database_url = args.database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL (or --database-url) is required")
    key = identity.load_key()
    try:
        with electoral_db.connect(database_url, autocommit=True) as conn:
            report = import_finance(conn, year=year, uf=uf, rows=rows, manifest=manifest, key=key, supersede=args.supersede)
    except FinanceConflict as exc:
        _emit({"status": "conflict", "detail": str(exc), "diff": exc.diff}, target)
        return 4
    _emit({**report, "members": members}, target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
