import uuid
from datetime import UTC, datetime
from typing import Any

from loguru import logger

from src.db.connection import get_db
from src.pipeline.base import BasePipeline
from src.sources.camara.api import CAMARA_API_BASE, fetch_deputies
from src.sources.camara.normalizer import match_deputies

LEGISLATURE = 57
MANDATE_START = "2023-02-01"
MANDATE_END = "2027-01-31"

PIPELINE_ID = "camara-deputados-g1-1"
PIPELINE_VERSION = "1.0.0"

CAMARA_SOURCE_NAME = "Câmara dos Deputados API v2 — /deputados (57ª Legislatura)"
CAMARA_SOURCE_ORG = "Câmara dos Deputados"
CAMARA_SOURCE_URL = f"{CAMARA_API_BASE}/deputados"
CAMARA_SOURCE_LICENSE = "Dados Abertos"


def fetch_tse_federal_deputies() -> list[dict[str, Any]]:
    """Busca do DB os políticos TSE eleitos como DEPUTADO FEDERAL."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT p."Id", p."Name", p."BallotName", p."State", p."PartyAcronym"
            FROM "Politicians" p
            JOIN "ElectionResults" er ON er."PoliticianId" = p."Id"
            WHERE p."Office" ILIKE '%DEPUTADO FEDERAL%'
              AND er."Elected" = true
              AND p."DeletedAt" IS NULL
        """)
        rows = cur.fetchall()
    return [
        {"Id": str(r[0]), "Name": r[1], "BallotName": r[2], "State": r[3], "PartyAcronym": r[4]}
        for r in rows
    ]


class CamaraDeputadosPipeline(BasePipeline):
    """
    Pipeline de matching TSE↔Câmara dos Deputados.

    collect(): Busca deputados via API paginada (57ª legislatura).
    transform(): Normaliza nomes e executa matching em 3 níveis de confiança.
    load(): UPDATE CamaraId + INSERT Mandate + TransformationChain + Evidence (implementado em Task 5).
    """

    def __init__(self, legislature: int = LEGISLATURE) -> None:
        self.legislature = legislature

    def collect(self) -> list[dict[str, Any]]:
        return fetch_deputies(self.legislature)

    def transform(self, raw: list[dict[str, Any]]) -> dict[str, Any]:
        tse_politicians = fetch_tse_federal_deputies()

        logger.info(f"TSE deputados federais eleitos: {len(tse_politicians)}")
        logger.info(f"Câmara deputados coletados: {len(raw)}")

        # Enriquecer Câmara deputies com photo URL
        for dep in raw:
            dep["photo_url"] = dep.get(
                "urlFoto",
                f"https://www.camara.leg.br/internet/deputado/bandep/{dep['id']}.jpg",
            )

        all_results = match_deputies(raw, tse_politicians)

        matched = []
        unmatched = []
        ambiguous: list[dict[str, Any]] = []

        dep_lookup = {str(d["id"]): d for d in raw}
        for r in all_results:
            if r["camara_id"] is not None:
                dep = dep_lookup.get(r["camara_id"], {})
                r["camara_photo_url"] = dep.get("photo_url", "")
                r["camara_email"] = dep.get("email", "")
                matched.append(r)
            elif r.get("match_method") == "ambiguous_name_2way":
                ambiguous.append(r)
            else:
                unmatched.append(r)

        logger.info(
            f"Resultado: {len(matched)} matched | "
            f"{len(unmatched)} sem match | "
            f"{len(ambiguous)} ambíguos"
        )
        for u in unmatched[:10]:
            logger.debug(f"Sem match: {u['tse_name']} ({u['tse_state']}/{u['tse_party']})")
        for a in ambiguous[:10]:
            logger.debug(f"Ambíguo: {a['tse_name']} ({a['tse_state']}/{a['tse_party']})")

        return {"matched": matched, "unmatched": unmatched, "ambiguous": ambiguous}

    def load(self, data: dict[str, Any]) -> None:
        # Implementado em Task 5
        raise NotImplementedError("load() será implementado em Task 5")
