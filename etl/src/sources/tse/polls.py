from __future__ import annotations

import hashlib
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

_POLL_ARCHIVE_HOST = "cdn.tse.jus.br"


@dataclass(frozen=True)
class PollArchive:
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


def poll_archive_url(year: int) -> str:
    if year < 2012 or year > 2200:
        raise ValueError("poll archive year is outside the supported TSE range")
    return (
        "https://cdn.tse.jus.br/estatistica/sead/odsele/pesquisa_eleitoral/"
        f"pesquisa_eleitoral_{year}.zip"
    )


class TsePollArchiveClient:
    """Fetches the official TSE PesqEle archive without interpreting missing values.

    The archive is the auditable registry source. Poll-result percentages are not inferred
    from registration metadata: they must come from an audited published result/report.
    """

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=60, follow_redirects=True)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> TsePollArchiveClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def fetch(
        self,
        year: int,
        *,
        etag: str | None = None,
        last_modified: str | None = None,
    ) -> PollArchive:
        url = poll_archive_url(year)
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != _POLL_ARCHIVE_HOST:
            raise ValueError("unexpected TSE poll archive URL")
        headers: dict[str, str] = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        response = self._client.get(url, headers=headers)
        if response.status_code == 304:
            return PollArchive(
                url=str(response.url),
                status_code=304,
                content=None,
                etag=response.headers.get("etag") or etag,
                last_modified=response.headers.get("last-modified") or last_modified,
            )
        response.raise_for_status()
        return PollArchive(
            url=str(response.url),
            status_code=response.status_code,
            content=response.content,
            etag=response.headers.get("etag"),
            last_modified=response.headers.get("last-modified"),
        )
