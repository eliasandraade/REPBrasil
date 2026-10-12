from __future__ import annotations

import hashlib
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

_ALLOWED_HOSTS = {"resultados.tse.jus.br", "resultados-sim.tse.jus.br"}
OFFICIAL_BASE_URL = "https://resultados.tse.jus.br"
OFFICIAL_ENVIRONMENT = "oficial"
OFFICIAL_2026_ELECTION_CODES = {
    1: {"federal": 6257, "state": 6259},
    2: {"federal": 6258, "state": 6260},
}


@dataclass(frozen=True)
class ResultArtifact:
    url: str
    status_code: int
    content: bytes | None
    etag: str | None
    last_modified: str | None

    @property
    def sha256(self) -> str | None:
        if self.content is None:
            return None
        return hashlib.sha256(self.content).hexdigest()


def official_2026_election_code(round_number: int, office_code: int) -> int:
    if round_number not in OFFICIAL_2026_ELECTION_CODES:
        raise ValueError("2026 round must be 1 or 2")
    family = "federal" if office_code == 1 else "state"
    return OFFICIAL_2026_ELECTION_CODES[round_number][family]


def _validate_base(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_HOSTS:
        raise ValueError(f"unexpected TSE results base URL: {base_url}")
    return normalized


def _uf(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if len(normalized) != 2 or not normalized.isalpha():
        raise ValueError("UF must contain two letters")
    return normalized


def _municipality(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if len(normalized) != 5 or not normalized.isdigit():
        raise ValueError("TSE municipality code must contain five digits")
    return normalized


def result_url(
    *,
    year: int,
    election_code: int,
    office_code: int,
    uf: str | None = None,
    municipality_tse_code: str | None = None,
    base_url: str = OFFICIAL_BASE_URL,
    environment: str = OFFICIAL_ENVIRONMENT,
) -> str:
    if year < 2000 or year > 2200:
        raise ValueError("year is outside the supported TSE result range")
    if election_code <= 0 or office_code <= 0:
        raise ValueError("election_code and office_code must be positive")
    if not environment or "/" in environment or ".." in environment:
        raise ValueError("invalid TSE results environment")
    normalized_uf = _uf(uf)
    municipality = _municipality(municipality_tse_code)
    if municipality is not None and normalized_uf is None:
        raise ValueError("municipality result requires UF")

    scope = normalized_uf or "br"
    prefix = "br" if normalized_uf is None else normalized_uf
    if municipality is not None:
        prefix = f"{normalized_uf}{municipality}"
    base = _validate_base(base_url)
    return (
        f"{base}/{environment}/ele{year}/{election_code}/dados/{scope}/"
        f"{prefix}-c{office_code:04d}-e{election_code:06d}-u.json"
    )


def accompaniment_url(
    *,
    year: int,
    election_code: int,
    uf: str | None = None,
    base_url: str = OFFICIAL_BASE_URL,
    environment: str = OFFICIAL_ENVIRONMENT,
) -> str:
    if year < 2000 or year > 2200:
        raise ValueError("year is outside the supported TSE result range")
    if election_code <= 0:
        raise ValueError("election_code must be positive")
    if not environment or "/" in environment or ".." in environment:
        raise ValueError("invalid TSE results environment")
    scope = _uf(uf) or "br"
    base = _validate_base(base_url)
    return (
        f"{base}/{environment}/ele{year}/{election_code}/dados/{scope}/"
        f"{scope}-e{election_code:06d}-ab.json"
    )


class TseLiveResultsClient:
    """Conditional GET client for TSE result artifacts.

    The TSE CDN supports ETag/Last-Modified. A 304 is represented with content=None so
    callers do not create duplicate snapshots when the official artifact did not change.
    """

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=30, follow_redirects=True)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> TseLiveResultsClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def fetch(
        self,
        url: str,
        *,
        etag: str | None = None,
        last_modified: str | None = None,
    ) -> ResultArtifact:
        _validate_base(url)
        headers: dict[str, str] = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        response = self._client.get(url, headers=headers)
        if response.status_code == 304:
            return ResultArtifact(
                url=str(response.url),
                status_code=304,
                content=None,
                etag=response.headers.get("etag") or etag,
                last_modified=response.headers.get("last-modified") or last_modified,
            )
        response.raise_for_status()
        return ResultArtifact(
            url=str(response.url),
            status_code=response.status_code,
            content=response.content,
            etag=response.headers.get("etag"),
            last_modified=response.headers.get("last-modified"),
        )
