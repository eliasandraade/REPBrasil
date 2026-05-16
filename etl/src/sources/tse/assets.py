import uuid
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import polars as pl
from loguru import logger

from src.db.connection import get_db
from src.pipeline.base import BasePipeline
from src.sources.tse.downloader import extract_assets_csv

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


def _parse_br_decimal(s: str | None) -> Decimal:
    if not s:
        return Decimal("0")
    cleaned = s.strip().replace(".", "").replace(",", ".")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return Decimal("0")


class TseAssetsPipeline(BasePipeline):
    """Pipeline de bens declarados TSE 2024."""

    def __init__(self, limit: int | None = None) -> None:
        self.limit = limit

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

        with get_db() as conn:
            with conn.cursor() as cur:
                tse_ids = [d["tse_id"] for d in data]
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

                loaded_decls = 0
                loaded_items = 0
                skipped = 0

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
                            str(uuid.uuid4()),
                            pid,
                            decl["year"],
                            decl["source_election_year"],
                            float(decl["total_value"]),
                            now,
                            now,
                            now,
                        ),
                    )
                    row = cur.fetchone()
                    declaration_id = row[0]
                    loaded_decls += 1

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
                                str(uuid.uuid4()),
                                declaration_id,
                                item["order"],
                                item["type_code"],
                                item["type_description"],
                                item["description"],
                                float(item["value"]),
                                now,
                                now,
                                now,
                            ),
                        )
                        loaded_items += 1

                logger.info(
                    f"Carregado: {loaded_decls} declarações, {loaded_items} itens. "
                    f"Ignorados: {skipped}"
                )
