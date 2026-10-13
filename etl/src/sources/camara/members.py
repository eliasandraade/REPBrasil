"""Deputados federais de uma UF numa legislatura (Dados Abertos da Câmara, API v2).

A lista `/deputados?siglaUf=..&idLegislatura=..` repete o deputado a cada troca de registro
(ex.: partido) e não traz datas; por isso nome, partido e foto vêm do `ultimoStatus` oficial de
`/deputados/{id}`. O detalhe também publica CPF e dados pessoais: nada disso é guardado — `raw`
leva só os campos usados (LGPD; CPF nunca em texto puro).

O parlamentar é uma entidade própria, identificada pelo id oficial da Câmara; nenhum vínculo com
pessoa/candidatura é criado aqui (nome nunca é identidade).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from src.sources.camara.api import CamaraApi

_PHOTO_HOST = "www.camara.leg.br"
_PHOTO_PATH = "/internet/deputado/bandep/"
_STATUS_FIELDS = (
    "id",
    "uri",
    "nome",
    "nomeEleitoral",
    "siglaPartido",
    "siglaUf",
    "idLegislatura",
    "situacao",
    "condicaoEleitoral",
    "data",
    "urlFoto",
)


@dataclass(frozen=True)
class CamaraDeputy:
    external_id: str
    name: str
    parliamentary_name: str
    state_code: str
    party_acronym: str | None
    photo_url: str | None
    raw: dict[str, Any]


def _official_id(raw: object) -> str:
    text = str(raw if raw is not None else "").strip()
    if not text.isdigit() or int(text) <= 0:
        raise ValueError("Câmara deputy without a numeric official id")
    return str(int(text))


def _photo(raw: object) -> str | None:
    url = str(raw or "").strip()
    if not url:
        return None
    parsed = urlparse(url)
    official = parsed.scheme == "https" and parsed.hostname == _PHOTO_HOST
    if not official or not parsed.path.startswith(_PHOTO_PATH):
        return None
    return url


def parse_deputy(detail: dict[str, Any], *, uf: str) -> CamaraDeputy:
    data = detail.get("dados") if isinstance(detail, dict) else None
    status = data.get("ultimoStatus") if isinstance(data, dict) else None
    if not isinstance(status, dict):
        raise ValueError("unexpected Câmara deputy payload")
    external_id = _official_id(data.get("id"))
    if _official_id(status.get("id")) != external_id:
        raise ValueError(f"Câmara deputy {external_id} has an inconsistent status id")
    parliamentary_name = str(status.get("nome") or "").strip()
    civil_name = str(data.get("nomeCivil") or "").strip()
    if not parliamentary_name:
        raise ValueError(f"Câmara deputy {external_id} without a published name")
    return CamaraDeputy(
        external_id=external_id,
        name=civil_name or parliamentary_name,
        parliamentary_name=parliamentary_name,
        state_code=uf,
        party_acronym=str(status.get("siglaPartido") or "").strip() or None,
        photo_url=_photo(status.get("urlFoto")),
        raw={
            "uri": data.get("uri"),
            "nomeCivil": civil_name or None,
            "ultimoStatus": {field: status.get(field) for field in _STATUS_FIELDS},
        },
    )


def fetch_state_deputies(
    api: CamaraApi, uf: str, legislature: int
) -> tuple[list[CamaraDeputy], bytes, tuple[str, ...]]:
    """Deputados da UF na legislatura, com os bytes canônicos e as URLs consultadas."""
    pages = api.fetch_all(
        "/deputados",
        params={
            "siglaUf": uf,
            "idLegislatura": int(legislature),
            "itens": 100,
            "ordem": "ASC",
            "ordenarPor": "nome",
        },
    )
    ids: list[str] = []
    for page in pages:
        rows = page.payload.get("dados")
        if not isinstance(rows, list):
            raise ValueError("unexpected Câmara deputies payload")
        for row in rows:
            if not isinstance(row, dict) or str(row.get("siglaUf") or "").strip().upper() != uf:
                raise ValueError("Câmara deputies listing returned a row outside the requested UF")
            external_id = _official_id(row.get("id"))
            if external_id not in ids:
                ids.append(external_id)

    details = [api.fetch_all(f"/deputados/{int(external_id)}") for external_id in ids]
    deputies = [parse_deputy(detail[0].payload, uf=uf) for detail in details]
    canonical = json.dumps(
        {
            "list": [page.payload for page in pages],
            "details": [detail[0].payload for detail in details],
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    urls = tuple(page.url for page in pages) + tuple(detail[0].url for detail in details)
    return deputies, canonical, urls
