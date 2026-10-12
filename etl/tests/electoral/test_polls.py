from __future__ import annotations

import hashlib

import httpx
import pytest

from src.sources.tse.polls import TsePollArchiveClient, poll_archive_url


def test_poll_archive_url_is_official_tse_cdn() -> None:
    assert poll_archive_url(2026) == (
        "https://cdn.tse.jus.br/estatistica/sead/odsele/pesquisa_eleitoral/"
        "pesquisa_eleitoral_2026.zip"
    )


def test_poll_archive_rejects_unsupported_year() -> None:
    with pytest.raises(ValueError):
        poll_archive_url(2010)


def test_poll_archive_hashes_exact_source_bytes() -> None:
    content = b"official-zip-bytes"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            request=request,
            content=content,
            headers={"etag": '"abc"'},
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        artifact = TsePollArchiveClient(client).fetch(2026)

    assert artifact.content == content
    assert artifact.sha256 == hashlib.sha256(content).hexdigest()
    assert artifact.etag == '"abc"'


def test_poll_archive_304_does_not_create_content() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["If-None-Match"] == '"abc"'
        return httpx.Response(304, request=request)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        artifact = TsePollArchiveClient(client).fetch(2026, etag='"abc"')

    assert artifact.status_code == 304
    assert artifact.content is None
    assert artifact.sha256 is None
