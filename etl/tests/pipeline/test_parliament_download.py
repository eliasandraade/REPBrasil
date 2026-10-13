"""Download do arquivo oficial de emendas (Portal da Transparência / CGU).

Cada URL — a inicial e cada `Location` — é validada antes de qualquer requisição, e o corpo é lido
em streaming com limite rígido. O `MockTransport` registra tudo o que recebeu: um host proibido
nunca pode aparecer nesse registro.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator

import httpx
import pytest

from src.pipeline.parliament_ingest import AMENDMENTS_URL, OfficialDownload, download_amendments

ZIP_URL = (
    "https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/"
    "emendas-parlamentares/EmendasParlamentares.zip"
)
ZIP_BYTES = b"PK\x03\x04" + b"0" * 2048


class Official:
    """Transporte simulado que guarda cada requisição recebida."""

    def __init__(self, handler: Callable[[httpx.Request], httpx.Response]) -> None:
        self.handler = handler
        self.requested: list[httpx.URL] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requested.append(request.url)
        return self.handler(request)

    def download(self, **kwargs) -> OfficialDownload:
        with httpx.Client(transport=httpx.MockTransport(self)) as http:
            return download_amendments(http, **kwargs)


def _redirect_then(location: str, body: httpx.Response | None = None):
    def handle(request: httpx.Request) -> httpx.Response:
        if str(request.url) == AMENDMENTS_URL:
            return httpx.Response(302, headers={"Location": location})
        return body or httpx.Response(200, content=ZIP_BYTES)

    return handle


def test_official_redirect_is_followed_and_the_final_official_url_is_kept() -> None:
    official = Official(
        _redirect_then(
            ZIP_URL,
            httpx.Response(
                200, content=ZIP_BYTES, headers={"Last-Modified": "Sat, 10 Oct 2026 02:57:21 GMT"}
            ),
        )
    )

    download = official.download()

    assert download.url == ZIP_URL
    assert download.content == ZIP_BYTES
    assert download.last_modified == "Sat, 10 Oct 2026 02:57:21 GMT"
    assert [str(url) for url in official.requested] == [AMENDMENTS_URL, ZIP_URL]


@pytest.mark.parametrize(
    ("location", "reason"),
    [
        ("https://evil.example/EmendasParlamentares.zip", "unexpected amendments download host"),
        ("//evil.example/EmendasParlamentares.zip", "unexpected amendments download host"),
        (
            "https://portaldatransparencia.gov.br.evil.example/x.zip",
            "unexpected amendments download host",
        ),
        (
            "http://dadosabertos-download.cgu.gov.br/EmendasParlamentares.zip",
            "must use https",
        ),
        (
            "https://user:secret@dadosabertos-download.cgu.gov.br/EmendasParlamentares.zip",
            "must not carry credentials",
        ),
        (
            "https://dadosabertos-download.cgu.gov.br:8443/EmendasParlamentares.zip",
            "unexpected amendments download port",
        ),
    ],
)
def test_unofficial_redirect_is_refused_before_any_request_reaches_it(
    location: str, reason: str
) -> None:
    official = Official(_redirect_then(location))

    with pytest.raises(ValueError, match=reason):
        official.download()

    assert [str(url) for url in official.requested] == [AMENDMENTS_URL]


def test_redirect_chain_longer_than_the_limit_is_refused() -> None:
    official = Official(lambda _request: httpx.Response(302, headers={"Location": AMENDMENTS_URL}))

    with pytest.raises(ValueError, match="exceeded 2 redirects"):
        official.download(max_redirects=2)

    assert len(official.requested) == 3


def test_redirect_without_location_fails_closed() -> None:
    official = Official(lambda _request: httpx.Response(302))

    with pytest.raises(httpx.HTTPStatusError):
        official.download()

    assert len(official.requested) == 1


class _Body(httpx.SyncByteStream):
    """Corpo em pedaços que registra quanto foi efetivamente lido."""

    def __init__(self, chunks: int, size: int) -> None:
        self.chunks = chunks
        self.size = size
        self.read = 0

    def __iter__(self) -> Iterator[bytes]:
        for _ in range(self.chunks):
            self.read += 1
            yield b"x" * self.size


def test_declared_size_above_the_limit_is_refused_before_reading_the_body() -> None:
    body = _Body(chunks=4, size=1024)
    official = Official(
        _redirect_then(
            ZIP_URL, httpx.Response(200, headers={"Content-Length": "4096"}, stream=body)
        )
    )

    with pytest.raises(ValueError, match="declares 4096 bytes"):
        official.download(max_bytes=1024)

    assert body.read == 0


def test_stream_without_declared_size_is_cut_as_soon_as_it_passes_the_limit() -> None:
    body = _Body(chunks=100, size=1024)
    official = Official(_redirect_then(ZIP_URL, httpx.Response(200, stream=body)))

    with pytest.raises(ValueError, match="exceeds the 3072-byte limit"):
        official.download(max_bytes=3072)

    assert body.read == 4


def test_body_within_the_limit_is_returned_whole_without_declared_size() -> None:
    body = _Body(chunks=3, size=1024)
    official = Official(_redirect_then(ZIP_URL, httpx.Response(200, stream=body)))

    download = official.download(max_bytes=3072)

    assert download.content == b"x" * 3072
    assert body.read == 3


def test_transfer_encoded_body_is_refused() -> None:
    body = _Body(chunks=1, size=16)
    official = Official(
        _redirect_then(
            ZIP_URL, httpx.Response(200, headers={"Content-Encoding": "gzip"}, stream=body)
        )
    )

    with pytest.raises(ValueError, match="transfer encoding"):
        official.download()

    assert body.read == 0


def test_the_official_file_is_requested_without_transfer_encoding() -> None:
    official = Official(_redirect_then(ZIP_URL))
    seen: list[str | None] = []
    inner = official.handler

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("accept-encoding"))
        return inner(request)

    official.handler = handle
    official.download()

    assert seen == ["identity", "identity"]
