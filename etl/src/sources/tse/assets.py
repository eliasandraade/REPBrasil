import hashlib
import time
import uuid
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import polars as pl
from loguru import logger

from src.db.connection import get_db_batch
from src.pipeline.base import BasePipeline
from src.sources.tse.downloader import ASSETS_CSV_PATH, extract_assets_csv

ASSETS_COLUMNS = [
    "SQ_CANDIDATO",
    "NR_ORDEM_BEM_CANDIDATO",
    "CD_TIPO_BEM_CANDIDATO",
    "DS_TIPO_BEM_CANDIDATO",
    "DS_BEM_CANDIDATO",
    "VR_BEM_CANDIDATO",
]

ELECTION_YEAR = 2024
SOURCE_ELECTION_YEAR = "2024"

ASSETS_SOURCE_NAME = "TSE Bens Declarados 2024 — bem_candidato_2024_BRASIL.csv"
ASSETS_SOURCE_ORG = "Tribunal Superior Eleitoral"
ASSETS_SOURCE_URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/bem_candidato/bem_candidato_2024.zip"
ASSETS_SOURCE_LICENSE = "Dados Abertos"


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


def _parse_br_decimal(s: str | None) -> Decimal:
    if not s:
        return Decimal("0")
    cleaned = s.strip().replace(".", "").replace(",", ".")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return Decimal("0")


class TseAssetsPipeline(BasePipeline):
    """Pipeline de bens declarados TSE 2024.

    batch_size: declarações por commit — padrão 250.
        Evita timeout SSL do Railway em loads longos.
        Todos os upserts são idempotentes (ON CONFLICT DO UPDATE).
    """

    def __init__(
        self,
        limit: int | None = None,
        tse_ids_filter: set[str] | None = None,
        batch_size: int = 250,
    ) -> None:
        self.limit = limit
        self.tse_ids_filter = tse_ids_filter
        self.batch_size = batch_size

    def collect(self) -> pl.DataFrame:
        csv_path = extract_assets_csv()
        logger.info(f"Lendo CSV de bens: {csv_path}")
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
        available = [c for c in ASSETS_COLUMNS if c in raw.columns]
        missing = [c for c in ASSETS_COLUMNS if c not in raw.columns]
        if missing:
            logger.warning(f"Colunas ausentes no CSV de bens TSE: {missing}")

        df = raw.select(available)

        if self.tse_ids_filter is not None and "SQ_CANDIDATO" in df.columns:
            before = len(df)
            df = df.filter(pl.col("SQ_CANDIDATO").is_in(list(self.tse_ids_filter)))
            logger.info(
                f"Filtro tse_ids ({len(self.tse_ids_filter)} IDs): "
                f"{before} → {len(df)} linhas"
            )

        if self.limit:
            unique_ids = df.select("SQ_CANDIDATO").unique().head(self.limit)
            df = df.join(unique_ids, on="SQ_CANDIDATO", how="inner")

        declarations: dict[str, dict[str, Any]] = {}
        for row in df.iter_rows(named=True):
            tse_id = str(row.get("SQ_CANDIDATO") or "").strip() or None
            if tse_id is None:
                continue

            value = _parse_br_decimal(str(row.get("VR_BEM_CANDIDATO") or ""))
            order = int(str(row.get("NR_ORDEM_BEM_CANDIDATO") or "0").strip() or "0")

            if tse_id not in declarations:
                declarations[tse_id] = {
                    "tse_id": tse_id,
                    "year": ELECTION_YEAR,
                    "source_election_year": SOURCE_ELECTION_YEAR,
                    "total_value": Decimal("0"),
                    "items": [],
                }

            declarations[tse_id]["total_value"] += value
            declarations[tse_id]["items"].append({
                "order": order,
                "type_code": (str(row.get("CD_TIPO_BEM_CANDIDATO") or "")).strip() or None,
                "type_description": (str(row.get("DS_TIPO_BEM_CANDIDATO") or "")).strip() or None,
                "description": (str(row.get("DS_BEM_CANDIDATO") or "")).strip() or None,
                "value": value,
            })

        result = list(declarations.values())
        logger.info(f"Declarações transformadas: {len(result)}")
        return result

    def load(self, data: list[dict[str, Any]]) -> None:
        if not data:
            logger.warning("Nenhum bem declarado para carregar.")
            return

        now = datetime.now(UTC).isoformat()
        t_start = time.perf_counter()
        logger.info(f"Iniciando load de {len(data)} declarações (batch_size={self.batch_size})")

        with get_db_batch() as conn:
            cur = conn.cursor()
            try:
                # ── 1. Source upsert + commit imediato ───────────────────────
                csv_hash = _compute_sha256(ASSETS_CSV_PATH)
                csv_size = _get_file_size(ASSETS_CSV_PATH)
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
                        source_id, ASSETS_SOURCE_NAME, ASSETS_SOURCE_ORG, "assets",
                        ASSETS_SOURCE_URL, now, csv_hash, csv_size, ASSETS_SOURCE_LICENSE,
                        now, now,
                    ),
                )
                conn.commit()
                logger.info("Fonte 'assets' registrada/atualizada em Sources.")

                # ── 2. Lookup politicians ─────────────────────────────────────
                tse_ids = [d["tse_id"] for d in data]
                cur.execute(
                    'SELECT "TseId", "Id" FROM "Politicians" WHERE "TseId" = ANY(%s)',
                    (tse_ids,),
                )
                tse_to_politician: dict[str, str] = {row[0]: row[1] for row in cur.fetchall()}
                logger.info(
                    f"Políticos encontrados: {len(tse_to_politician)} de {len(tse_ids)}"
                )

                # ── 3. Batch insert ───────────────────────────────────────────
                loaded_decls = 0
                loaded_items = 0
                skipped = 0
                batch_decls = 0
                batches_committed = 0
                t_batch = time.perf_counter()

                for decl in data:
                    pid = tse_to_politician.get(decl["tse_id"])
                    if pid is None:
                        skipped += 1
                        continue

                    cur.execute(
                        """
                        INSERT INTO "AssetDeclarations"
                            ("Id","PoliticianId","ElectionYear","SourceElectionYear","TotalValue",
                             "CreatedAt","UpdatedAt","SourceUpdatedAt")
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT ("PoliticianId","ElectionYear") DO UPDATE SET
                            "SourceElectionYear"=EXCLUDED."SourceElectionYear",
                            "TotalValue"=EXCLUDED."TotalValue",
                            "UpdatedAt"=EXCLUDED."UpdatedAt",
                            "SourceUpdatedAt"=EXCLUDED."SourceUpdatedAt"
                        RETURNING "Id"
                        """,
                        (
                            str(uuid.uuid4()), pid, decl["year"], decl["source_election_year"],
                            float(decl["total_value"]), now, now, now,
                        ),
                    )
                    declaration_id = cur.fetchone()[0]
                    loaded_decls += 1
                    batch_decls += 1

                    for item in decl["items"]:
                        cur.execute(
                            """
                            INSERT INTO "AssetItems"
                                ("Id","DeclarationId","Order","TypeCode","TypeDescription",
                                 "Description","Value","CreatedAt","UpdatedAt","SourceUpdatedAt")
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            ON CONFLICT ("DeclarationId","Order") DO UPDATE SET
                                "TypeCode"=EXCLUDED."TypeCode",
                                "TypeDescription"=EXCLUDED."TypeDescription",
                                "Description"=EXCLUDED."Description",
                                "Value"=EXCLUDED."Value",
                                "UpdatedAt"=EXCLUDED."UpdatedAt",
                                "SourceUpdatedAt"=EXCLUDED."SourceUpdatedAt"
                            """,
                            (
                                str(uuid.uuid4()), declaration_id, item["order"],
                                item["type_code"], item["type_description"],
                                item["description"], float(item["value"]), now, now, now,
                            ),
                        )
                        loaded_items += 1

                    if batch_decls >= self.batch_size:
                        conn.commit()
                        elapsed = time.perf_counter() - t_batch
                        rate = batch_decls / elapsed if elapsed > 0 else 0
                        logger.info(
                            f"Batch {batches_committed + 1}: {batch_decls} decls, "
                            f"{loaded_items} itens acumulados — {elapsed:.1f}s "
                            f"({rate:.1f} decls/s)"
                        )
                        batches_committed += 1
                        batch_decls = 0
                        t_batch = time.perf_counter()

                # Commit final (registros restantes < batch_size)
                if batch_decls > 0:
                    conn.commit()
                    elapsed = time.perf_counter() - t_batch
                    logger.info(
                        f"Batch final ({batches_committed + 1}): {batch_decls} decls "
                        f"em {elapsed:.1f}s"
                    )
                    batches_committed += 1

            finally:
                cur.close()

        total_elapsed = time.perf_counter() - t_start
        rate_s = loaded_decls / total_elapsed if total_elapsed > 0 else 0
        rate_m = rate_s * 60
        logger.info(
            f"Carregado: {loaded_decls} declarações, {loaded_items} itens. "
            f"Ignorados: {skipped}. Batches: {batches_committed}. "
            f"Total: {total_elapsed:.1f}s — {rate_s:.1f} decls/s ({rate_m:.0f} decls/min)"
        )
