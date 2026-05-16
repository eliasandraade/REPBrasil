import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import polars as pl
from loguru import logger

from src.db.connection import get_db
from src.pipeline.base import BasePipeline
from src.sources.tse.downloader import RESULTS_CSV_PATH, extract_results_csv

RESULTS_COLUMNS = [
    "SQ_CANDIDATO",
    "NR_TURNO",
    "SG_UF",
    "NM_UE",
    "DS_CARGO",
    "QT_VOTOS_NOMINAIS_VALIDOS",
    "DS_SIT_TOT_TURNO",
]

RESULTS_SOURCE_NAME = "TSE Resultados Eleitorais 2024 — votacao_candidato_munzona_2024_BRASIL.csv"
RESULTS_SOURCE_ORG = "Tribunal Superior Eleitoral"
RESULTS_SOURCE_URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2024.zip"
RESULTS_SOURCE_LICENSE = "Dados Abertos"


def _compute_sha256(path: Path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _get_file_size(path: Path) -> int | None:
    if not path.exists():
        return None
    return path.stat().st_size


class TseResultsPipeline(BasePipeline):
    """Pipeline de resultados eleitorais TSE 2024 — votação por candidato/município."""

    def __init__(self, limit: int | None = None) -> None:
        self.limit = limit

    def collect(self) -> pl.DataFrame:
        csv_path = extract_results_csv()
        logger.info(f"Lendo CSV de resultados: {csv_path}")
        df = pl.read_csv(
            csv_path,
            separator=";",
            encoding="latin1",
            infer_schema_length=0,
            truncate_ragged_lines=True,
        )
        logger.info(f"Linhas brutas: {len(df)}")
        return df

    def transform(self, raw: pl.DataFrame) -> list[dict[str, Any]]:
        available = [c for c in RESULTS_COLUMNS if c in raw.columns]
        missing = [c for c in RESULTS_COLUMNS if c not in raw.columns]
        if missing:
            logger.warning(f"Colunas ausentes no CSV de resultados TSE: {missing}")

        df = raw.select(available)

        if "QT_VOTOS_NOMINAIS_VALIDOS" in df.columns:
            df = df.with_columns(
                pl.col("QT_VOTOS_NOMINAIS_VALIDOS")
                .cast(pl.Int64, strict=False)
                .fill_null(0)
            )
        if "NR_TURNO" in df.columns:
            df = df.with_columns(
                pl.col("NR_TURNO").cast(pl.Int32, strict=False).fill_null(1)
            )
        if "DS_SIT_TOT_TURNO" in df.columns:
            df = df.with_columns(
                pl.col("DS_SIT_TOT_TURNO")
                .str.to_uppercase()
                .str.starts_with("ELEITO")
                .alias("elected_flag")
            )

        group_cols = [
            c for c in ["SQ_CANDIDATO", "NR_TURNO", "SG_UF", "NM_UE", "DS_CARGO"]
            if c in df.columns
        ]
        agg_exprs: list[pl.Expr] = []
        if "QT_VOTOS_NOMINAIS_VALIDOS" in df.columns:
            agg_exprs.append(
                pl.col("QT_VOTOS_NOMINAIS_VALIDOS").sum().alias("total_votes")
            )
        if "DS_SIT_TOT_TURNO" in df.columns:
            agg_exprs.append(pl.col("DS_SIT_TOT_TURNO").first().alias("situation"))
        if "elected_flag" in df.columns:
            agg_exprs.append(pl.col("elected_flag").any().alias("elected"))

        if group_cols and agg_exprs:
            df = df.group_by(group_cols).agg(agg_exprs)

        if self.limit:
            df = df.head(self.limit)

        records: list[dict[str, Any]] = []
        for row in df.iter_rows(named=True):
            tse_id = str(row.get("SQ_CANDIDATO") or "").strip() or None
            if tse_id is None:
                continue
            situation = (str(row.get("situation") or "")).strip() or None
            records.append(
                {
                    "tse_id": tse_id,
                    "round": int(row.get("NR_TURNO") or 1),
                    "year": 2024,
                    "office": (str(row.get("DS_CARGO") or "")).strip() or None,
                    "state": (str(row.get("SG_UF") or "")).strip() or None,
                    "city": (str(row.get("NM_UE") or "")).strip() or None,
                    "total_votes": int(row.get("total_votes") or 0),
                    "situation": situation,
                    "elected": bool(row.get("elected") or False),
                }
            )

        logger.info(f"Registros transformados: {len(records)}")
        return records

    def load(self, data: list[dict[str, Any]]) -> None:
        if not data:
            logger.warning("Nenhum resultado para carregar.")
            return

        now = datetime.now(UTC).isoformat()

        with get_db() as conn:
            with conn.cursor() as cur:
                # Upsert Source record for provenance tracking
                csv_hash = _compute_sha256(RESULTS_CSV_PATH)
                csv_size = _get_file_size(RESULTS_CSV_PATH)
                source_id = str(uuid.uuid4())
                cur.execute(
                    """
                    INSERT INTO "Sources"
                        ("Id","Name","Organization","SourceType","OriginalUrl",
                         "CollectedAt","Hash","FileSizeBytes","License","CreatedAt","UpdatedAt")
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT ("Name","SourceType") DO UPDATE SET
                        "CollectedAt" = EXCLUDED."CollectedAt",
                        "Hash" = EXCLUDED."Hash",
                        "FileSizeBytes" = EXCLUDED."FileSizeBytes",
                        "UpdatedAt" = EXCLUDED."UpdatedAt"
                    """,
                    (
                        source_id,
                        RESULTS_SOURCE_NAME,
                        RESULTS_SOURCE_ORG,
                        "results",
                        RESULTS_SOURCE_URL,
                        now,
                        csv_hash,
                        csv_size,
                        RESULTS_SOURCE_LICENSE,
                        now, now,
                    ),
                )
                logger.info("Fonte 'results' registrada/atualizada em Sources.")

                tse_ids = list({r["tse_id"] for r in data})
                cur.execute(
                    'SELECT "TseId", "Id" FROM "Politicians" WHERE "TseId" = ANY(%s)',
                    (tse_ids,),
                )
                tse_to_politician: dict[str, str] = {
                    row[0]: row[1] for row in cur.fetchall()
                }
                logger.info(
                    f"Políticos encontrados: {len(tse_to_politician)} de {len(tse_ids)}"
                )

                elections_map: dict[tuple, str] = {}
                distinct_elections = {
                    (r["year"], r["office"], r["state"], r["city"])
                    for r in data
                    if r["office"] and r["state"] and r["city"]
                }
                for key in distinct_elections:
                    year, office, state, city = key
                    cur.execute(
                        'SELECT "Id" FROM "Elections" WHERE "Year"=%s AND "Office"=%s'
                        ' AND "State"=%s AND "City"=%s AND "DeletedAt" IS NULL',
                        (year, office, state, city),
                    )
                    row = cur.fetchone()
                    if row:
                        elections_map[key] = row[0]
                    else:
                        eid = str(uuid.uuid4())
                        cur.execute(
                            'INSERT INTO "Elections"'
                            ' ("Id","Year","Office","State","City","CreatedAt","UpdatedAt","SourceUpdatedAt")'
                            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                            (eid, year, office, state, city, now, now, now),
                        )
                        elections_map[key] = eid
                logger.info(f"Eleições mapeadas: {len(elections_map)}")

                results_to_load: list[dict[str, Any]] = []
                skipped = 0
                for r in data:
                    pid = tse_to_politician.get(r["tse_id"])
                    if pid is None:
                        skipped += 1
                        continue
                    key = (r["year"], r["office"], r["state"], r["city"])
                    eid = elections_map.get(key)
                    if eid is None:
                        skipped += 1
                        continue
                    results_to_load.append(
                        {
                            "id": str(uuid.uuid4()),
                            "politician_id": pid,
                            "election_id": eid,
                            "round": r["round"],
                            "total_votes": r["total_votes"],
                            "situation": r["situation"],
                            "elected": r["elected"],
                            "created_at": now,
                            "updated_at": now,
                            "source_updated_at": now,
                        }
                    )

                if results_to_load:
                    upsert_sql = """
                        INSERT INTO "ElectionResults"
                            ("Id","PoliticianId","ElectionId","Round",
                             "TotalVotes","Situation","Elected",
                             "CreatedAt","UpdatedAt","SourceUpdatedAt")
                        VALUES
                            (%(id)s,%(politician_id)s,%(election_id)s,%(round)s,
                             %(total_votes)s,%(situation)s,%(elected)s,
                             %(created_at)s,%(updated_at)s,%(source_updated_at)s)
                        ON CONFLICT ("PoliticianId","ElectionId","Round") DO UPDATE SET
                            "TotalVotes"=EXCLUDED."TotalVotes",
                            "Situation"=EXCLUDED."Situation",
                            "Elected"=EXCLUDED."Elected",
                            "UpdatedAt"=EXCLUDED."UpdatedAt",
                            "SourceUpdatedAt"=EXCLUDED."SourceUpdatedAt"
                    """
                    cur.executemany(upsert_sql, results_to_load)

                logger.info(
                    f"Carregados: {len(results_to_load)} resultados. Ignorados: {skipped}"
                )
