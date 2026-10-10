"""Leitura de um ZIP oficial remoto sem baixá-lo inteiro para o disco.

O ZIP de prestação de contas do TSE tem centenas de MB a mais de 1 GB e traz todas as UFs; só
os membros da UF interessam. A proveniência continua integral:
1. um `Range: bytes=0-0` fixa a versão publicada (ETag/Last-Modified + tamanho total do Content-Range);
2. o ZIP inteiro é lido em streaming só para calcular SHA-256/SHA-512 (nada vai para o disco),
   com `If-Match` na mesma ETag;
3. os membros da UF são lidos por HTTP Range com `If-Range` na mesma versão — se o TSE regenerar o
   arquivo no meio do caminho o servidor devolve 200 em vez de 206 e a leitura FALHA (fail-closed);
4. o `zipfile` confere o CRC-32 de cada membro lido.
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

import httpx

from ..open_data.acquire import AcquisitionError

_CHUNK = 1 << 20


class RemoteChanged(AcquisitionError):
    """O arquivo oficial mudou durante a leitura: nada é importado."""


@dataclass(frozen=True)
class RemoteVersion:
    url: str
    size: int
    etag: str | None
    last_modified: str | None

    @property
    def validator(self) -> str | None:
        return self.etag or self.last_modified


def _client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0), follow_redirects=True,
                        headers={"User-Agent": "repbrasil-etl/1.0 (+dados abertos TSE)"})


def head(url: str, client: httpx.Client | None = None) -> RemoteVersion:
    """Versão publicada (tamanho, ETag, Last-Modified) lida de um `Range: bytes=0-0`.

    O tamanho vem do total do Content-Range, não do Content-Length de um HEAD: o CDN do TSE já
    respondeu HEAD com Content-Length 1 para um ZIP de 178 MB recém-regenerado.
    """
    own = client is None
    client = client or _client()
    try:
        r = client.get(url, headers={"Range": "bytes=0-0"})
        if r.status_code != 206:
            raise AcquisitionError(f"GET {url} (Range bytes=0-0): HTTP {r.status_code}; ranged reads are required")
        total = (r.headers.get("content-range") or "").rpartition("/")[2]
        if not total.isdigit():
            raise AcquisitionError(f"GET {url}: Content-Range without the total size: {r.headers.get('content-range')!r}")
        return RemoteVersion(url, int(total), r.headers.get("etag"), r.headers.get("last-modified"))
    finally:
        if own:
            client.close()


def stream_digests(version: RemoteVersion, client: httpx.Client | None = None) -> tuple[str, str]:
    """(SHA-256, SHA-512) do arquivo inteiro, lido em streaming na versão fixada."""
    own = client is None
    client = client or _client()
    sha256, sha512, total = hashlib.sha256(), hashlib.sha512(), 0
    headers = {"If-Match": version.etag} if version.etag else {}
    try:
        with client.stream("GET", version.url, headers=headers) as r:
            if r.status_code == 412:
                raise RemoteChanged(f"{version.url} changed since HEAD (ETag)")
            if r.status_code != 200:
                raise AcquisitionError(f"GET {version.url}: HTTP {r.status_code}")
            for chunk in r.iter_bytes(_CHUNK):
                sha256.update(chunk)
                sha512.update(chunk)
                total += len(chunk)
    finally:
        if own:
            client.close()
    if total != version.size:
        raise RemoteChanged(f"{version.url}: read {total} bytes, HEAD declared {version.size}")
    return sha256.hexdigest(), sha512.hexdigest()


class PinnedRangeFile(io.RawIOBase):
    """Arquivo remoto somente-leitura e posicionável, preso a uma versão (Range + If-Range)."""

    def __init__(self, version: RemoteVersion, client: httpx.Client) -> None:
        self.version = version
        self.client = client
        self.pos = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.version.size}[whence]
        self.pos = base + offset
        return self.pos

    def readinto(self, buffer) -> int:  # type: ignore[override]
        n = len(buffer)
        if n == 0 or self.pos >= self.version.size:
            return 0
        end = min(self.pos + n, self.version.size) - 1
        headers = {"Range": f"bytes={self.pos}-{end}"}
        if self.version.validator:
            headers["If-Range"] = self.version.validator
        r = self.client.get(self.version.url, headers=headers)
        if r.status_code == 200:
            raise RemoteChanged(f"{self.version.url} changed during the ranged read")
        if r.status_code != 206:
            raise AcquisitionError(f"ranged GET {self.version.url}: HTTP {r.status_code}")
        data = r.content
        buffer[: len(data)] = data
        self.pos += len(data)
        return len(data)
