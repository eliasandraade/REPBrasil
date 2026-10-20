"""Ingestão auditável do Parlamento de uma UF a partir das fontes oficiais.

1. Deputados federais da UF na legislatura (Câmara, `/deputados` + `/deputados/{id}`): entidades
   próprias, `identity_method = unlinked` — nenhum vínculo com pessoa sem evidência documental.
2. Proposições de autoria de cada deputado no intervalo (Câmara, `/proposicoes`).
3. Emendas destinadas à UF (Portal da Transparência, `EmendasParlamentares.csv`): uma edição
   completa do recorte por execução, identificada pelo SHA-256 do ZIP oficial.

Cada fonte grava URL, SHA-256, instante de aquisição e versão do parser (`parliament_source`).
Rodar de novo com os mesmos bytes oficiais é idempotente; bytes novos viram uma edição nova e as
anteriores ficam preservadas.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from datetime import date
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from src.pipeline.parliament import (
    ParliamentMember,
    ParliamentSource,
    ensure_source,
    load_amendments,
    load_camara_activities,
    upsert_member,
)
from src.sources.camara.activity import fetch_deputy_propositions
from src.sources.camara.api import CamaraApi
from src.sources.camara.members import fetch_state_deputies
from src.sources.transparencia.amendments import parse_amendments

AMENDMENTS_URL = (
    "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO"
)
AMENDMENTS_MEMBER = "EmendasParlamentares.csv"
_DOWNLOAD_HOSTS = frozenset({"portaldatransparencia.gov.br", "dadosabertos-download.cgu.gov.br"})
_MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024
_MAX_REDIRECTS = 5
_MAX_MEMBER_BYTES = 600 * 1024 * 1024

# Início oficial de cada legislatura (Câmara dos Deputados).
LEGISLATURE_START = {56: date(2019, 2, 1), 57: date(2023, 2, 1)}

# Códigos IBGE das UFs (os dois primeiros dígitos do código de município).
IBGE_STATE_CODES = {
    "RO": "11", "AC": "12", "AM": "13", "RR": "14", "PA": "15", "AP": "16", "TO": "17",
    "MA": "21", "PI": "22", "CE": "23", "RN": "24", "PB": "25", "PE": "26", "AL": "27",
    "SE": "28", "BA": "29", "MG": "31", "ES": "32", "RJ": "33", "SP": "35", "PR": "41",
    "SC": "42", "RS": "43", "MS": "50", "MT": "51", "GO": "52", "DF": "53",
}


@dataclass(frozen=True)
class OfficialDownload:
    url: str
    content: bytes
    last_modified: str | None


def _official_url(url: str) -> str:
    """Só HTTPS, num host oficial, na porta padrão e sem credenciais na URL."""
    parsed = urlsplit(url)
    if parsed.scheme != "https":
        raise ValueError(f"amendments download must use https: {url}")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("amendments download URL must not carry credentials")
    if parsed.hostname not in _DOWNLOAD_HOSTS:
        raise ValueError(f"unexpected amendments download host: {parsed.hostname}")
    if parsed.port not in (None, 443):
        raise ValueError(f"unexpected amendments download port: {parsed.port}")
    return url


def _read_limited(response: httpx.Response, max_bytes: int) -> bytes:
    """Corpo lido aos pedaços, com teto rígido: nada além do limite chega à memória."""
    declared = response.headers.get("content-length")
    if declared is not None:
        if not declared.isdigit():
            raise ValueError(f"invalid amendments Content-Length: {declared!r}")
        if int(declared) > max_bytes:
            raise ValueError(
                f"amendments download declares {declared} bytes, above the {max_bytes}-byte limit"
            )
    content = bytearray()
    # Codificação `identity` (exigida antes da leitura): os bytes são os da rede, sem descompressão.
    for chunk in response.iter_bytes():
        content.extend(chunk)
        if len(content) > max_bytes:
            raise ValueError(f"amendments download exceeds the {max_bytes}-byte limit")
    return bytes(content)


def download_amendments(
    http: httpx.Client,
    *,
    max_bytes: int = _MAX_DOWNLOAD_BYTES,
    max_redirects: int = _MAX_REDIRECTS,
) -> OfficialDownload:
    """ZIP oficial de emendas.

    Redirecionamentos são seguidos à mão: a URL inicial e cada `Location` são validadas *antes*
    da requisição (nenhum host fora da lista é contatado). O corpo é pedido sem codificação de
    transporte e lido em streaming com limite rígido; a URL final oficial fica na proveniência.
    """
    url = _official_url(AMENDMENTS_URL)
    for _ in range(max_redirects + 1):
        with http.stream(
            "GET", url, follow_redirects=False, headers={"Accept-Encoding": "identity"}
        ) as response:
            if response.has_redirect_location:
                url = _official_url(urljoin(url, response.headers["location"]))
                continue
            response.raise_for_status()
            if response.headers.get("content-encoding", "identity").lower() != "identity":
                raise ValueError("amendments download must not use a transfer encoding")
            content = _read_limited(response, max_bytes)
            return OfficialDownload(url, content, response.headers.get("last-modified"))
    raise ValueError(f"amendments download exceeded {max_redirects} redirects")


def amendments_csv(zip_bytes: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        info = archive.getinfo(AMENDMENTS_MEMBER)
        if info.file_size > _MAX_MEMBER_BYTES:
            raise ValueError("amendments CSV exceeds the expected size")
        return archive.read(info)


def ingest_parliament(
    conn: Any,
    *,
    uf: str,
    legislature: int,
    presented_from: date,
    presented_to: date,
    camara: CamaraApi,
    http: httpx.Client,
    include_activities: bool = True,
    include_amendments: bool = True,
) -> dict[str, Any]:
    state_code = IBGE_STATE_CODES[uf]
    summary: dict[str, Any] = {"uf": uf, "legislature": legislature}

    deputies, content, urls = fetch_state_deputies(camara, uf, legislature)
    members_source = ensure_source(
        conn,
        ParliamentSource(
            provider="camara",
            dataset=f"deputados:{uf}:legislatura-{legislature}",
            source_url=urls[0],
            content=content,
            metadata={"uf": uf, "legislature": legislature, "pages": list(urls)},
        ),
    )
    member_ids = {
        deputy.external_id: upsert_member(
            conn,
            ParliamentMember(
                institution="camara",
                external_id=deputy.external_id,
                name=deputy.name,
                parliamentary_name=deputy.parliamentary_name,
                state_code=deputy.state_code,
                party_acronym=deputy.party_acronym,
                photo_url=deputy.photo_url,
                raw=deputy.raw,
            ),
            source_id=members_source,
        )
        for deputy in deputies
    }
    summary["members"] = len(member_ids)

    if include_activities:
        total = 0
        for deputy in deputies:
            activities, content, urls = fetch_deputy_propositions(
                camara, deputy.external_id, presented_from=presented_from, presented_to=presented_to
            )
            source_id = ensure_source(
                conn,
                ParliamentSource(
                    provider="camara",
                    dataset=f"proposicoes:deputado-{deputy.external_id}",
                    source_url=urls[0],
                    content=content,
                    metadata={
                        "presented_from": presented_from.isoformat(),
                        "presented_to": presented_to.isoformat(),
                        "pages": list(urls),
                    },
                ),
            )
            total += load_camara_activities(
                conn,
                member_id=member_ids[deputy.external_id],
                source_id=source_id,
                activities=activities,
            )
        summary["activities"] = total

    if include_amendments:
        download = download_amendments(http)
        parsed = parse_amendments(amendments_csv(download.content), state_ibge_code=state_code)
        counts = {
            "rows_read": parsed.rows_read,
            "rows_in_scope": parsed.rows_in_scope,
            "rows_without_official_identifier": parsed.rows_without_official_identifier,
            "multi_row_amendments": parsed.multi_row_amendments,
            "amendments": len(parsed.records),
            "with_municipality": sum(1 for row in parsed.records if row.municipality_ibge_code),
        }
        source_id = ensure_source(
            conn,
            ParliamentSource(
                provider="transparencia",
                dataset=f"emendas-parlamentares:{uf}",
                source_url=download.url,
                content=download.content,
                metadata={
                    "member": AMENDMENTS_MEMBER,
                    "uf": uf,
                    "last_modified": download.last_modified,
                    **counts,
                },
            ),
        )
        load_amendments(conn, source_id=source_id, records=parsed.records)
        summary["amendments"] = counts
    return summary
