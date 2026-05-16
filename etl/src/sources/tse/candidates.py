import uuid
from datetime import UTC, datetime
from typing import Any

import polars as pl
from loguru import logger

from src.db.connection import get_db
from src.pipeline.base import BasePipeline
from src.sources.tse.downloader import extract_candidates_csv

# "#NE" é o código TSE para registros sem status de situação definido no arquivo consulta_cand_2024_BRASIL.csv
VALID_STATUSES = {"APTO", "INAPTO", "DEFERIDO", "DEFERIDO COM RECURSO", "#NE"}

COLUMN_MAP = {
    "SQ_CANDIDATO": "tse_id",
    "NM_CANDIDATO": "name",
    "NM_URNA_CANDIDATO": "ballot_name",
    "SG_UF": "state",
    "SG_PARTIDO": "party_acronym",
    "NM_PARTIDO": "party_name",
    "DS_CARGO": "office",
    "DS_SITUACAO_CANDIDATURA": "candidacy_status",
}


class TseCandidatesPipeline(BasePipeline):
    """Pipeline de coleta de candidatos do TSE — eleição 2024 (validação técnica Fase 1)."""

    def __init__(self, limit: int | None = None) -> None:
        self.limit = limit

    def collect(self) -> pl.DataFrame:
        csv_path = extract_candidates_csv()
        logger.info(f"Lendo CSV: {csv_path}")
        df = pl.read_csv(
            csv_path,
            separator=";",
            encoding="latin1",
            infer_schema_length=0,
            truncate_ragged_lines=True,
        )
        logger.info(f"Registros brutos: {len(df)}")
        return df

    def transform(self, raw: pl.DataFrame) -> list[dict[str, Any]]:
        available = [c for c in COLUMN_MAP if c in raw.columns]
        missing = [c for c in COLUMN_MAP if c not in raw.columns]
        if missing:
            logger.warning(f"Colunas esperadas ausentes no CSV do TSE: {missing}")
        df = raw.select(available).rename({c: COLUMN_MAP[c] for c in available})

        if "candidacy_status" in df.columns:
            df = df.filter(pl.col("candidacy_status").is_in(list(VALID_STATUSES)))

        if self.limit:
            df = df.head(self.limit)

        now = datetime.now(UTC).isoformat()
        records = []
        for row in df.iter_rows(named=True):
            tse_id = str(row.get("tse_id") or "").strip() or None
            name = (row.get("name") or "").strip().title()
            ballot_name = (row.get("ballot_name") or "").strip().title()
            if tse_id is None:
                logger.warning(f"Registro ignorado: SQ_CANDIDATO vazio para '{name}'")
                continue
            records.append(
                {
                    "id": str(uuid.uuid4()),
                    "name": name,
                    "ballot_name": ballot_name,
                    "tse_id": tse_id,
                    "state": row.get("state") or None,
                    "party_acronym": row.get("party_acronym") or None,
                    "party_name": row.get("party_name") or None,
                    "office": row.get("office") or None,
                    "candidacy_status": row.get("candidacy_status") or None,
                    "created_at": now,
                    "updated_at": now,
                    "source_updated_at": now,
                }
            )

        logger.info(f"Registros após transformação: {len(records)}")
        return records

    def load(self, data: list[dict[str, Any]]) -> None:
        if not data:
            logger.warning("Nenhum registro para carregar.")
            return

        insert_sql = """
            INSERT INTO "Politicians"
                ("Id", "Name", "BallotName", "TseId",
                 "State", "PartyAcronym", "PartyName", "Office", "CandidacyStatus",
                 "CreatedAt", "UpdatedAt", "SourceUpdatedAt")
            VALUES
                (%(id)s, %(name)s, %(ballot_name)s, %(tse_id)s,
                 %(state)s, %(party_acronym)s, %(party_name)s, %(office)s, %(candidacy_status)s,
                 %(created_at)s, %(updated_at)s, %(source_updated_at)s)
            ON CONFLICT ("TseId") WHERE "TseId" IS NOT NULL DO UPDATE SET
                "Name" = EXCLUDED."Name",
                "BallotName" = EXCLUDED."BallotName",
                "State" = EXCLUDED."State",
                "PartyAcronym" = EXCLUDED."PartyAcronym",
                "PartyName" = EXCLUDED."PartyName",
                "Office" = EXCLUDED."Office",
                "CandidacyStatus" = EXCLUDED."CandidacyStatus",
                "UpdatedAt" = EXCLUDED."UpdatedAt",
                "SourceUpdatedAt" = EXCLUDED."SourceUpdatedAt"
        """

        with get_db() as conn:
            with conn.cursor() as cur:
                cur.executemany(insert_sql, data)
                logger.info(
                    f"Submetidos ao banco: {len(data)} registros"
                    " (novos inseridos, existentes atualizados)"
                )
