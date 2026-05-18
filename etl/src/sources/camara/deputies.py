import json as _json
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
        matched = data["matched"]
        now = datetime.now(UTC).isoformat()
        chain_id = str(uuid.uuid4())
        source_id = str(uuid.uuid4())

        with get_db() as conn:
            cur = conn.cursor()
            try:
                # ── 1. Source upsert ──────────────────────────────────────────
                cur.execute(
                    """
                    INSERT INTO "Sources"
                        ("Id","Name","Organization","SourceType","OriginalUrl",
                         "CollectedAt","License","CreatedAt","UpdatedAt")
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT ("Name","SourceType") DO UPDATE SET
                        "CollectedAt" = EXCLUDED."CollectedAt",
                        "UpdatedAt" = EXCLUDED."UpdatedAt"
                    RETURNING "Id"
                    """,
                    (
                        source_id, CAMARA_SOURCE_NAME, CAMARA_SOURCE_ORG, "api",
                        CAMARA_SOURCE_URL, now, CAMARA_SOURCE_LICENSE, now, now,
                    ),
                )
                source_id = str(cur.fetchone()[0])

                # ── 2. TransformationChain ────────────────────────────────────
                cur.execute(
                    """
                    INSERT INTO "TransformationChains"
                        ("Id","PipelineId","PipelineVersion","StartedAt","Status","CreatedAt","UpdatedAt")
                    VALUES (%s,%s,%s,%s,'Running',%s,%s)
                    """,
                    (chain_id, PIPELINE_ID, PIPELINE_VERSION, now, now, now),
                )

                # ── 3. Steps ─────────────────────────────────────────────────
                unmatched_count = len(data.get("unmatched", []))
                ambiguous_count = len(data.get("ambiguous", []))
                tse_sql = (
                    'SELECT DISTINCT p."Id",p."Name",p."BallotName",p."State",p."PartyAcronym" '
                    'FROM "Politicians" p JOIN "ElectionResults" er ON er."PoliticianId"=p."Id" '
                    'WHERE p."Office" ILIKE \'%DEPUTADO FEDERAL%\' AND er."Elected"=true AND p."DeletedAt" IS NULL'
                )
                steps = [
                    (
                        "collect_deputies",
                        f"Coleta de deputados via API Câmara — legislatura {self.legislature}",
                        _json.dumps({"source": CAMARA_SOURCE_URL, "legislature": self.legislature,
                                     "pipeline_version": PIPELINE_VERSION}),
                        f"api:{CAMARA_SOURCE_URL}",
                    ),
                    (
                        "normalize_names",
                        "Normalização de nomes TSE e Câmara — remove acentos, lowercase, partículas PT-BR",
                        _json.dumps({"tse_query": tse_sql}),
                        "normalized_names",
                    ),
                    (
                        "match_tse_camara",
                        (
                            f"Matching exact normalizado em 3 níveis (full_3way/ballot_3way/name_2way). "
                            f"Resultado: {len(matched)} matched, {unmatched_count} sem match, "
                            f"{ambiguous_count} ambíguos. pipeline_version={PIPELINE_VERSION}"
                        ),
                        _json.dumps({"algorithm": "exact_normalized_3level", "pipeline_version": PIPELINE_VERSION}),
                        _json.dumps({"matched": len(matched), "unmatched": unmatched_count,
                                     "ambiguous": ambiguous_count}),
                    ),
                    (
                        "update_politicians",
                        f"UPDATE CamaraId + INSERT Mandates + Evidence (Derived) para {len(matched)} políticos",
                        None,
                        _json.dumps({"camara_ids_updated": len(matched), "mandates_inserted": len(matched),
                                     "evidences_inserted": len(matched)}),
                    ),
                ]
                for order, (step_type, description, input_ref, output_ref) in enumerate(steps, 1):
                    cur.execute(
                        """
                        INSERT INTO "TransformationSteps"
                            ("Id","ChainId","Order","StepType","Description","Parameters",
                             "InputReference","OutputReference","ExecutedAt","CreatedAt","UpdatedAt")
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        (str(uuid.uuid4()), chain_id, order, step_type, description, None,
                         input_ref, output_ref, now, now, now),
                    )

                # ── 4. Loop: UPDATE CamaraId + INSERT Mandate + Evidence ──────
                updated = 0
                for m in matched:
                    pol_id = m["politician_id"]
                    camara_id = m["camara_id"]

                    cur.execute(
                        'UPDATE "Politicians" SET "CamaraId" = %s, "UpdatedAt" = %s WHERE "Id" = %s',
                        (camara_id, now, pol_id),
                    )

                    cur.execute(
                        """
                        INSERT INTO "Mandates"
                            ("Id","PoliticianId","House","Legislature","Title",
                             "State","PartyAcronym","StartDate","EndDate",
                             "ExternalId","ExternalUrl","SourceId","CreatedAt","UpdatedAt")
                        VALUES (%s,%s,'CAMARA',%s,'DEPUTADO FEDERAL',%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT ("PoliticianId","House","Legislature") DO UPDATE SET
                            "ExternalId" = EXCLUDED."ExternalId",
                            "ExternalUrl" = EXCLUDED."ExternalUrl",
                            "PartyAcronym" = EXCLUDED."PartyAcronym",
                            "SourceId" = EXCLUDED."SourceId",
                            "UpdatedAt" = EXCLUDED."UpdatedAt"
                        """,
                        (
                            str(uuid.uuid4()), pol_id, self.legislature,
                            m["tse_state"], m["tse_party"],
                            MANDATE_START, MANDATE_END,
                            camara_id,
                            f"https://www.camara.leg.br/deputados/{camara_id}",
                            source_id, now, now,
                        ),
                    )

                    cur.execute(
                        """
                        INSERT INTO "Evidences"
                            ("Id","SourceId","Description","EvidenceType","DatasetId",
                             "ConfidenceLevel","NormalizedReference","TransformationChainId",
                             "CollectedAt","ContestationStatus","Metadata","CreatedAt","UpdatedAt")
                        VALUES (%s,%s,%s,'Derived','camara-deputados-57',%s,%s,%s,%s,'None',%s,%s,%s)
                        """,
                        (
                            str(uuid.uuid4()), source_id,
                            f"Match TSE->Camara: {m['tse_name']} [{m['tse_state']}/{m['tse_party']}] = CamaraId {camara_id} via {m['match_method']}",
                            m["confidence_level"],
                            f"https://dadosabertos.camara.leg.br/api/v2/deputados/{camara_id}",
                            chain_id, now,
                            _json.dumps({
                                "politician_id": pol_id,
                                "camara_id": camara_id,
                                "match_method": m["match_method"],
                                "camara_name": m["camara_name"],
                            }),
                            now, now,
                        ),
                    )
                    updated += 1

                # ── 5. Fechar TransformationChain ────────────────────────────
                cur.execute(
                    """
                    UPDATE "TransformationChains"
                    SET "Status" = 'Completed', "CompletedAt" = %s, "UpdatedAt" = %s
                    WHERE "Id" = %s
                    """,
                    (now, now, chain_id),
                )

            finally:
                cur.close()

        logger.info(
            f"Câmara load concluído: {updated} CamaraIds atualizados, "
            f"{updated} Mandates inseridos, {updated} Evidências registradas."
        )
