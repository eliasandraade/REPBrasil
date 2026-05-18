from typing import Any

import httpx
from loguru import logger

CAMARA_API_BASE = "https://dadosabertos.camara.leg.br/api/v2"
_ITEMS_PER_PAGE = 500


def fetch_deputies(legislature: int) -> list[dict[str, Any]]:
    """
    Busca todos os deputados de uma legislatura via API paginada da Câmara.
    Sem autenticação. Segue rel=next até não existir.
    """
    deputies: list[dict[str, Any]] = []
    page = 1

    while True:
        resp = httpx.get(
            f"{CAMARA_API_BASE}/deputados",
            params={
                "idLegislatura": legislature,
                "itens": _ITEMS_PER_PAGE,
                "pagina": page,
                "ordem": "ASC",
                "ordenarPor": "nome",
            },
            timeout=30,
        )
        resp.raise_for_status()
        body = resp.json()

        batch = body.get("dados", [])
        if not batch:
            break

        deputies.extend(batch)
        logger.debug(f"Página {page}: {len(batch)} deputados (total acumulado: {len(deputies)})")

        has_next = any(link.get("rel") == "next" for link in body.get("links", []))
        if not has_next:
            break

        page += 1

    logger.info(f"Deputados coletados: {len(deputies)} (legislatura {legislature})")
    return deputies
