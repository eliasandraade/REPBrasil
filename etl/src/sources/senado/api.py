"""Senado Federal — Dados Abertos (https://legis.senado.leg.br/dadosabertos).

Somente leitura, sem autenticação. A lista de parlamentares em exercício traz o código
oficial do Senado (`CodigoParlamentar`), nome parlamentar, partido, UF e mandato.

Vínculo com candidaturas do TSE: o Senado NÃO publica CPF nem SQ_CANDIDATO; portanto nenhum
vínculo automático é feito por nome (regra do projeto). O provedor só normaliza o fato oficial.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

SENADO_API_BASE = "https://legis.senado.leg.br/dadosabertos"


@dataclass(frozen=True)
class Senator:
    code: str  # CodigoParlamentar (identificador oficial do Senado)
    parliamentary_name: str
    full_name: str | None
    uf: str | None
    party: str | None
    mandate_code: str | None
    mandate_participation: str | None  # Titular / 1º Suplente / 2º Suplente
    first_legislature: str | None
    second_legislature: str | None
    photo_url: str | None
    page_url: str | None


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def parse_current(payload: dict[str, Any]) -> list[Senator]:
    """Normaliza `senador/lista/atual` (JSON oficial v4). Estrutura inesperada ⇒ erro explícito."""
    root = payload.get("ListaParlamentarEmExercicio")
    if not isinstance(root, dict) or "Parlamentares" not in root:
        raise ValueError(
            "unexpected Senado payload: ListaParlamentarEmExercicio.Parlamentares missing"
        )
    senators: list[Senator] = []
    for p in _as_list((root.get("Parlamentares") or {}).get("Parlamentar")):
        ident = p.get("IdentificacaoParlamentar") or {}
        mandate = p.get("Mandato") or {}
        code = str(ident.get("CodigoParlamentar") or "").strip()
        if not code:
            raise ValueError("Senado payload without CodigoParlamentar")
        senators.append(
            Senator(
                code=code,
                parliamentary_name=str(ident.get("NomeParlamentar") or "").strip(),
                full_name=ident.get("NomeCompletoParlamentar"),
                uf=ident.get("UfParlamentar") or mandate.get("UfParlamentar"),
                party=ident.get("SiglaPartidoParlamentar"),
                mandate_code=mandate.get("CodigoMandato"),
                mandate_participation=mandate.get("DescricaoParticipacao"),
                first_legislature=(mandate.get("PrimeiraLegislaturaDoMandato") or {}).get(
                    "NumeroLegislatura"
                ),
                second_legislature=(mandate.get("SegundaLegislaturaDoMandato") or {}).get(
                    "NumeroLegislatura"
                ),
                photo_url=ident.get("UrlFotoParlamentar"),
                page_url=ident.get("UrlPaginaParlamentar"),
            )
        )
    return senators


def fetch_current_senators(
    uf: str | None = None, client: httpx.Client | None = None
) -> list[Senator]:
    own = client is None
    client = client or httpx.Client(timeout=30, headers={"Accept": "application/json"})
    try:
        params = {"uf": uf.upper()} if uf else None
        r = client.get(f"{SENADO_API_BASE}/senador/lista/atual", params=params)
        r.raise_for_status()
        return parse_current(r.json())
    finally:
        if own:
            client.close()
