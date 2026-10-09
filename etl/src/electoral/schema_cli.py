from __future__ import annotations

import argparse
import json
from pathlib import Path

from .schema_bundle import OFFICIAL_2026_SCHEMA_URL, persist_schema_bundle


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="urnai-schema",
        description="Audit and persist the official TSE BU/RDV ASN.1 package obtained manually from the TSE portal.",
    )
    parser.add_argument("zip", type=Path, help="path to the ZIP downloaded from the official TSE Eleições 2026 page")
    parser.add_argument("--out", type=Path, default=Path("artifacts/tse/schema"))
    parser.add_argument(
        "--source-url",
        default=OFFICIAL_2026_SCHEMA_URL,
        help="official page/download URL recorded in the provenance manifest",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    persisted = persist_schema_bundle(args.zip, args.out, source_url=args.source_url)
    manifest = json.loads(persisted.manifest_path.read_text(encoding="utf-8"))
    manifest["directory"] = str(persisted.directory)
    manifest["zip_path"] = str(persisted.zip_path)
    manifest["manifest_path"] = str(persisted.manifest_path)
    manifest["extracted_dir"] = str(persisted.extracted_dir)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
