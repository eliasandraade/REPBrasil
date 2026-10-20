from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from src.sources.camara.api import CamaraApi, CamaraPage


@dataclass(frozen=True)
class CamaraActivity:
    member_external_id: str
    external_id: str
    activity_type: str
    occurred_at: datetime | None
    title: str | None
    description: str | None
    source_url: str | None
    raw: dict[str, Any]


def _parse_datetime(raw: object) -> datetime | None:
    if raw in (None, ""):
        return None
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"invalid Câmara activity datetime: {raw!r}") from exc


def parse_proposition_rows(
    member_external_id: str,
    pages: list[CamaraPage],
) -> list[CamaraActivity]:
    member_id = str(member_external_id).strip()
    if not member_id:
        raise ValueError("Câmara member id is required")

    activities: list[CamaraActivity] = []
    seen: set[str] = set()
    for page in pages:
        payload = page.payload
        rows = payload.get("dados") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise ValueError("unexpected Câmara propositions payload")

        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("unexpected Câmara proposition row")
            raw_id = row.get("id")
            if raw_id is None or not str(raw_id).strip().isdigit():
                raise ValueError("Câmara proposition without a numeric official id")
            external_id = str(int(str(raw_id).strip()))
            if external_id in seen:
                continue
            seen.add(external_id)

            sigla = str(row.get("siglaTipo") or "").strip()
            numero = str(row.get("numero") or "").strip()
            ano = str(row.get("ano") or "").strip()
            title_parts = [part for part in (sigla, numero, ano) if part]
            title = " ".join(title_parts) or None
            description = str(row.get("ementa") or "").strip() or None
            source_url = str(row.get("uri") or "").strip() or page.url
            activities.append(
                CamaraActivity(
                    member_external_id=member_id,
                    external_id=external_id,
                    activity_type="proposition",
                    occurred_at=_parse_datetime(row.get("dataApresentacao")),
                    title=title,
                    description=description,
                    source_url=source_url,
                    raw=row,
                )
            )
    return activities


def fetch_deputy_propositions(
    api: CamaraApi,
    deputy_id: int | str,
    *,
    presented_from: date,
    presented_to: date,
    itens: int = 100,
) -> tuple[list[CamaraActivity], bytes, tuple[str, ...]]:
    """Proposições de autoria do deputado apresentadas no intervalo.

    `/deputados/{id}/proposicoes` não existe na API v2 (405) e `/proposicoes` recusa intervalos de
    datas maiores que 3 meses (400); por isso a consulta é `/proposicoes?idDeputadoAutor=&ano=` para
    cada ano do intervalo, e o recorte exato usa a data oficial de apresentação.
    """
    deputy = int(deputy_id)
    if deputy <= 0:
        raise ValueError("invalid Câmara deputy id")
    if presented_from > presented_to:
        raise ValueError("propositions interval starts after it ends")
    pages = []
    for year in range(presented_from.year, presented_to.year + 1):
        pages.extend(
            api.fetch_all(
                "/proposicoes",
                params={
                    "idDeputadoAutor": deputy,
                    "ano": year,
                    "itens": int(itens),
                    "ordem": "ASC",
                    "ordenarPor": "id",
                },
            )
        )
    activities = [
        activity
        for activity in parse_proposition_rows(str(deputy), pages)
        if activity.occurred_at is None
        or presented_from <= activity.occurred_at.date() <= presented_to
    ]
    canonical = json.dumps(
        [page.payload for page in pages],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return activities, canonical, tuple(page.url for page in pages)
