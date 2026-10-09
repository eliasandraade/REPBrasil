"""Parse + normalização + reconciliação de um arquivo adquirido.

Produz um `PreparedImport` com tudo que será persistido e o relatório. O
mesmo caminho serve para `--dry-run` (sem banco) e para a importação real.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..ea20 import EA20Result
from .acquire import load_manifest, verify_file_sha256
from .ea20_check import validate_against_ea20
from .layout import DetectedLayout, detect_layout
from .parser import ScanStats, scan
from .reconcile import ReconciliationReport, reconcile_with_cadastro
from .results import ConsistencyError, NormalizedZone, normalize_zone


@dataclass
class PreparedImport:
    manifest: dict[str, Any]
    layout: DetectedLayout
    stats: ScanStats
    zone: NormalizedZone
    reconciliation: ReconciliationReport
    ea20: dict[str, Any]
    fingerprint: str
    scope: dict[str, Any]

    def report(self, *, batch_id: str | None = None, status: str = "dry_run") -> dict[str, Any]:
        z = self.zone
        offices: dict[int, dict[str, Any]] = defaultdict(lambda: {"urns": 0, "vote_records": 0, "votes_total": 0, "turnout_total": 0})
        names: dict[int, str | None] = {}
        elections: dict[int, set[int]] = defaultdict(set)
        for (_, office, election), result in z.results.items():
            o = offices[office]
            o["urns"] += 1
            o["vote_records"] += len(result.votes)
            o["votes_total"] += result.votes_total
            turnout = result.structural["turnout"]
            o["turnout_total"] = None if turnout is None or o["turnout_total"] is None else o["turnout_total"] + int(turnout)  # type: ignore[call-overload]
            names[office] = result.structural["office_name"]  # type: ignore[assignment]
            elections[office].add(election)
        kinds = Counter(v.vote_kind for v in z.votables.values())
        aggregated_count = sum(len(v) for v in self.reconciliation.aggregated_sections.values())
        source = self.manifest["source"]
        return {
            "status": status,
            "import_batch_id": batch_id,
            "source": {
                "dataset": source["dataset"],
                "resource_id": source["resource_id"],
                "resource_name": source["resource_name"],
                "url": source["url"],
                "zip_sha256": self.manifest["zip"]["sha256"],
                "zip_sha512": self.manifest["zip"]["sha512"],
                "official_checksum_verified": self.manifest["official_checksum"]["verified"],
                "csv_name": self.manifest["csv"]["name"],
                "csv_sha256": self.manifest["csv"]["sha256"],
                "csv_size": self.manifest["csv"]["size"],
                "source_generated_at": z.generated_at,
            },
            "layout": self.layout.as_dict(),
            "scope": self.scope,
            "rows": {
                "read": self.stats.rows_read,
                "matching_uf": self.stats.rows_matching_uf,
                "matching_municipality": self.stats.rows_matching_municipality,
                "matching_zone": self.stats.rows_matching_zone,
                "accepted": sum(len(r.votes) for r in z.results.values()),
                "rejected": 0,
            },
            "sections": {
                "found": len(z.sections),
                "principal": len(self.reconciliation.principal_sections),
                "aggregated": aggregated_count,
                "aggregation": self.reconciliation.as_dict()["aggregated_sections"],
            },
            "offices": {
                str(code): {"name": names[code], "election_codes": sorted(elections[code]), **offices[code]}
                for code in sorted(offices)
            },
            "votables": {"total": len(z.votables), "by_kind": dict(sorted(kinds.items()))},
            "vote_records": sum(len(r.votes) for r in z.results.values()),
            "ea20_validation": self.ea20,
            "warnings": self.reconciliation.warnings,
            "fingerprint": self.fingerprint,
        }


def fingerprint(scope: dict[str, Any], zone: NormalizedZone) -> str:
    digest = hashlib.sha256(json.dumps(scope, sort_keys=True).encode())
    for h in sorted(v.source_row_hash for r in zone.results.values() for v in r.votes):
        digest.update(h.encode())
    return digest.hexdigest()


def prepare_import(
    manifest_path: Path,
    *,
    municipality: int,
    zone: int,
    cadastro_path: Path | None = None,
    cadastro: dict[str, Any] | None = None,
    ea20_paths: list[Path] | None = None,
    verify_csv_hash: bool = True,
) -> PreparedImport:
    """`cadastro`: recorte canônico da zona (banco ou CSV oficial do cadastro);
    `cadastro_path`: o mesmo formato em JSON (fixtures). Exatamente um."""
    if (cadastro is None) == (cadastro_path is None):
        raise ValueError("pass exactly one of cadastro / cadastro_path")
    manifest, csv_path = load_manifest(manifest_path)
    if verify_csv_hash:
        verify_file_sha256(csv_path, manifest["csv"]["sha256"])
    layout = detect_layout(csv_path)
    scope_info = manifest["scope"]
    stats = ScanStats()
    rows = list(scan(csv_path, layout, uf=scope_info["uf"], municipality=municipality, zone=zone, stats=stats))
    if not rows:
        raise ConsistencyError(f"no rows for municipality {municipality} zone {zone} in {manifest['csv']['name']}")
    for row in rows:
        if row.year != scope_info["year"] or row.turn != scope_info["turn"]:
            raise ConsistencyError(f"line {row.line}: year/turn {row.year}/{row.turn} differ from the resource scope {scope_info}")
    normalized = normalize_zone(rows, municipality=municipality, zone=zone)
    if cadastro is None:
        assert cadastro_path is not None
        cadastro = json.loads(cadastro_path.read_text(encoding="utf-8"))
    reconciliation = reconcile_with_cadastro(normalized, cadastro)
    documents = [EA20Result.model_validate(json.loads(p.read_text(encoding="utf-8"))) for p in (ea20_paths or [])]
    ea20 = validate_against_ea20(normalized, documents)
    if ea20["status"] == "fail":
        raise ConsistencyError(f"EA20 validation failed: {json.dumps(ea20['offices'], ensure_ascii=False)}")
    scope = {
        "year": scope_info["year"],
        "turn": scope_info["turn"],
        "uf": scope_info["uf"],
        "municipality": str(municipality).zfill(5),
        "zone": zone,
    }
    return PreparedImport(manifest, layout, stats, normalized, reconciliation, ea20, fingerprint(scope, normalized), scope)
