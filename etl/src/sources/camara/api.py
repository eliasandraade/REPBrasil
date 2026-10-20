from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from loguru import logger

CAMARA_API_BASE = "https://dadosabertos.camara.leg.br/api/v2"
_ITEMS_PER_PAGE = 500
_ALLOWED_HOST = "dadosabertos.camara.leg.br"


@dataclass(frozen=True)
class CamaraPage:
    url: str
    status_code: int
    content: bytes
    payload: dict[str, Any]


class CamaraApi:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        attempts: int = 4,
        backoff_seconds: float = 2.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=60)
        self._attempts = max(1, attempts)
        self._backoff = backoff_seconds
        self._sleep = sleep

    def _get(self, url: str, params: dict[str, Any] | None) -> httpx.Response:
        """GET com novas tentativas só para falha de transporte ou 5xx (a API oscila com 504)."""
        for attempt in range(1, self._attempts + 1):
            try:
                response = self._client.get(url, params=params)
            except httpx.TransportError:
                if attempt == self._attempts:
                    raise
            else:
                if response.status_code < 500 or attempt == self._attempts:
                    response.raise_for_status()
                    return response
            self._sleep(self._backoff * attempt)
        raise AssertionError("unreachable")

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> CamaraApi:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    @staticmethod
    def _validate_url(url: str) -> str:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != _ALLOWED_HOST:
            raise ValueError(f"unexpected Câmara API URL: {url}")
        return url

    def fetch_all(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> list[CamaraPage]:
        if not path.startswith("/"):
            raise ValueError("Câmara API path must start with /")
        url = self._validate_url(urljoin(f"{CAMARA_API_BASE}/", path.lstrip("/")))
        pages: list[CamaraPage] = []
        request_params = dict(params or {})
        while True:
            response = self._get(url, request_params)
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("unexpected Câmara API payload")
            pages.append(
                CamaraPage(
                    str(response.url),
                    response.status_code,
                    response.content,
                    payload,
                )
            )
            links = payload.get("links", [])
            if not isinstance(links, list):
                raise ValueError("unexpected Câmara API links payload")
            next_url = None
            for link in links:
                if not isinstance(link, dict):
                    raise ValueError("unexpected Câmara API link")
                if link.get("rel") == "next":
                    href = str(link.get("href") or "").strip()
                    if not href:
                        raise ValueError("Câmara next link without href")
                    next_url = self._validate_url(href)
                    break
            if next_url is None:
                break
            url = next_url
            request_params = None
        return pages


def fetch_deputies(legislature: int) -> list[dict[str, Any]]:
    deputies: list[dict[str, Any]] = []
    page = 1
    while True:
        response = httpx.get(
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
        response.raise_for_status()
        body = response.json()
        batch = body.get("dados", [])
        if not batch:
            break
        deputies.extend(batch)
        logger.debug(
            f"Página {page}: {len(batch)} deputados (total acumulado: {len(deputies)})"
        )
        has_next = any(link.get("rel") == "next" for link in body.get("links", []))
        if not has_next:
            break
        page += 1
    logger.info(f"Deputados coletados: {len(deputies)} (legislatura {legislature})")
    return deputies
