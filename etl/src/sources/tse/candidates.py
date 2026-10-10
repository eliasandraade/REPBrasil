import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import polars as pl
from loguru import logger

from src.db.connection import get_db
from src.electoral.names import official_case
from src.pipeline.base import BasePipeline
from src.sources.tse.downloader import CSV_PATH, extract_candidates_csv

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

CANDIDATES_SOURCE_NAME = "TSE Candidatos 2024 — consulta_cand_2024_BRASIL.csv"
CANDIDATES_SOURCE_ORG = "Tribunal Superior Eleitoral"
CANDIDATES_SOURCE_URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2024.zip"
CANDIDATES_SOURCE_LICENSE = "Dados Abertos"


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


class TseCandidatesPipeline(BasePipeline):
    """Pipeline de coleta de candidatos do TSE — eleição 2024 (validação técnica Fase 1)."""

    def __init__(self, limit: int | None = None, state_filter: str | None = None) -> None:
        self.limit = limit
        self.state_filter = state_filter.upper() if state_filter else None

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

        # Filtro de UF — aplicado APÓS rename, opera em coluna "state"
        if self.state_filter and "state" in df.columns:
            before = len(df)
            df = df.filter(pl.col("state") == self.state_filter)
            logger.info(f"Filtro UF={self.state_filter}: {before} → {len(df)} registros")

        if "candidacy_status" in df.columns:
            df = df.filter(pl.col("candidacy_status").is_in(list(VALID_STATUSES)))

        if self.limit:
            df = df.head(self.limit)

        now = datetime.now(UTC).isoformat()
        records = []
        for row in df.iter_rows(named=True):
            tse_id = str(row.get("tse_id") or "").strip() or None
            name = official_case(row.get("name"))
            ballot_name = official_case(row.get("ballot_name"))
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

        now = datetime.now(UTC).isoformat()

        with get_db() as conn:
            with conn.cursor() as cur:
                # Upsert Source record for provenance tracking
                csv_hash = _compute_sha256(CSV_PATH)
                csv_size = _get_file_size(CSV_PATH)
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
                        CANDIDATES_SOURCE_NAME,
                        CANDIDATES_SOURCE_ORG,
                        "candidates",
                        CANDIDATES_SOURCE_URL,
                        now,
                        csv_hash,
                        csv_size,
                        CANDIDATES_SOURCE_LICENSE,
                        now, now,
                    ),
                )
                logger.info("Fonte 'candidates' registrada/atualizada em Sources.")

                cur.executemany(insert_sql, data)
                logger.info(
                    f"Submetidos ao banco: {len(data)} registros"
                    " (novos inseridos, existentes atualizados)"
                )
