"""Bens declarados, informações complementares e redes sociais das candidaturas.

Fonte: dataset `candidatos-<ano>` do Portal de Dados Abertos do TSE (um CSV por UF dentro de
cada ZIP: `bem_candidato_<ano>_<UF>.csv`, `consulta_cand_complementar_<ano>_<UF>.csv`,
`rede_social_candidato_<ano>_<UF>.csv`). Cada linha é ligada à candidatura exata pelo par
oficial (SQ_CANDIDATO, CD_ELEICAO) do mesmo ano — o SQ se repete no 2º turno com outro
CD_ELEICAO; eleições suplementares têm CD_ELEICAO próprio. Nunca por nome.

Privacidade (o REP Brasil não precisa expor o que não é sobre a candidatura):
- informações complementares: só a LISTA FECHADA `COMPLEMENT_FIELDS` (situação do registro,
  julgamento, cassação, diploma, destinação dos votos, presença na urna, limite de gastos,
  reeleição). Origem étnica, cor/raça, gênero, naturalidade e idade não são gravados;
- redes sociais: só URLs http(s); links de WhatsApp, `mailto:`/`tel:` e URLs com e-mail são
  descartados e contados;
- textos livres (descrição de bens): e-mails e sequências com formato de CPF são mascarados
  antes de gravar. A impressão digital da linha é calculada sobre os campos JÁ sanitizados.

Versões: o TSE regenera os arquivos (DT_GERACAO muda) sem mudar o conteúdo; a impressão
digital ignora a data de geração. Um arquivo que altera registros já gravados exige
`supersede=True` e o diff fica no lote — nada muda em silêncio.
"""

from __future__ import annotations

import csv
import re
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psycopg
from psycopg.types.json import Jsonb

from ..cadaster.store import _record_failure, _source_file_id
from ..open_data.layout import DetectedLayout, LayoutError
from ..open_data.parser import row_hash
from .parser import SENTINEL_TEXT, CandidateRowError, code, iso_date, required_int, text

SOURCE_ASSETS = "tse-open-data-candidate-assets"
SOURCE_RECORDS = "tse-open-data-candidate-records"
ORDINARY_ELECTION = 2

ASSETS_PROFILE_ID = "tse-bem-candidato-v1"
ASSETS_COLUMNS: tuple[str, ...] = (
    "DT_GERACAO", "HH_GERACAO", "ANO_ELEICAO", "CD_TIPO_ELEICAO", "NM_TIPO_ELEICAO", "CD_ELEICAO", "DS_ELEICAO",
    "DT_ELEICAO", "SG_UF", "SG_UE", "NM_UE", "SQ_CANDIDATO", "NR_ORDEM_BEM_CANDIDATO", "CD_TIPO_BEM_CANDIDATO",
    "DS_TIPO_BEM_CANDIDATO", "DS_BEM_CANDIDATO", "VR_BEM_CANDIDATO", "DT_ULT_ATUAL_BEM_CANDIDATO",
    "HH_ULT_ATUAL_BEM_CANDIDATO",
)

COMPLEMENT_PROFILE_ID = "tse-consulta-cand-complementar-v1"
COMPLEMENT_COLUMNS: tuple[str, ...] = (
    "DT_GERACAO", "HH_GERACAO", "ANO_ELEICAO", "CD_ELEICAO", "SQ_CANDIDATO", "CD_DETALHE_SITUACAO_CAND",
    "DS_DETALHE_SITUACAO_CAND", "CD_NACIONALIDADE", "DS_NACIONALIDADE", "CD_MUNICIPIO_NASCIMENTO",
    "NM_MUNICIPIO_NASCIMENTO", "NR_IDADE_DATA_POSSE", "ST_QUILOMBOLA", "CD_ETNIA_INDIGENA", "DS_ETNIA_INDIGENA",
    "VR_DESPESA_MAX_CAMPANHA", "ST_REELEICAO", "ST_DECLARAR_BENS", "NR_PROTOCOLO_CANDIDATURA", "NR_PROCESSO",
    "CD_SITUACAO_CANDIDATO_PLEITO", "DS_SITUACAO_CANDIDATO_PLEITO", "CD_SITUACAO_CANDIDATO_URNA",
    "DS_SITUACAO_CANDIDATO_URNA", "ST_CANDIDATO_INSERIDO_URNA", "NM_TIPO_DESTINACAO_VOTOS",
    "CD_SITUACAO_CANDIDATO_TOT", "DS_SITUACAO_CANDIDATO_TOT", "ST_PREST_CONTAS", "ST_SUBSTITUIDO", "SQ_SUBSTITUIDO",
    "SQ_ORDEM_SUPLENCIA", "DT_ACEITE_CANDIDATURA", "CD_SITUACAO_JULGAMENTO", "DS_SITUACAO_JULGAMENTO",
    "CD_SITUACAO_JULGAMENTO_PLEITO", "DS_SITUACAO_JULGAMENTO_PLEITO", "CD_SITUACAO_JULGAMENTO_URNA",
    "DS_SITUACAO_JULGAMENTO_URNA", "CD_SITUACAO_CASSACAO", "DS_SITUACAO_CASSACAO", "CD_SITUACAO_CASSACAO_MIDIA",
    "DS_SITUACAO_CASSACAO_MIDIA", "CD_SITUACAO_DIPLOMA", "DS_SITUACAO_DIPLOMA", "CD_GENERO_FEFC", "DS_GENERO_FEFC",
    "CD_COR_RACA_FEFC", "DS_COR_RACA_FEFC",
)

# Campo publicado → chave gravada. Lista fechada: o que não está aqui não é gravado.
COMPLEMENT_FIELDS: dict[str, str] = {
    "DS_DETALHE_SITUACAO_CAND": "detail_status",
    "VR_DESPESA_MAX_CAMPANHA": "max_campaign_spending",
    "ST_REELEICAO": "reelection",
    "ST_DECLARAR_BENS": "declares_assets",
    "NR_PROCESSO": "process_number",
    "DS_SITUACAO_CANDIDATO_PLEITO": "status_in_election",
    "DS_SITUACAO_CANDIDATO_URNA": "status_on_urn",
    "ST_CANDIDATO_INSERIDO_URNA": "inserted_in_urn",
    "NM_TIPO_DESTINACAO_VOTOS": "votes_destination",
    "DS_SITUACAO_CANDIDATO_TOT": "totalization_status",
    "ST_PREST_CONTAS": "accounts_rendered",
    "ST_SUBSTITUIDO": "substituted",
    "SQ_SUBSTITUIDO": "substituted_tse_candidate_id",
    "SQ_ORDEM_SUPLENCIA": "substitute_order",
    "DT_ACEITE_CANDIDATURA": "accepted_on",
    "DS_SITUACAO_JULGAMENTO": "judgment_status",
    "DS_SITUACAO_JULGAMENTO_PLEITO": "judgment_status_election",
    "DS_SITUACAO_JULGAMENTO_URNA": "judgment_status_urn",
    "DS_SITUACAO_CASSACAO": "cassation_status",
    "DS_SITUACAO_CASSACAO_MIDIA": "cassation_media_status",
    "DS_SITUACAO_DIPLOMA": "diploma_status",
}

SOCIAL_PROFILE_ID = "tse-rede-social-candidato-v1"
SOCIAL_COLUMNS: tuple[str, ...] = (
    "DT_GERACAO", "HH_GERACAO", "AA_ELEICAO", "SG_UF", "CD_TIPO_ELEICAO", "NM_TIPO_ELEICAO", "CD_ELEICAO",
    "DS_ELEICAO", "SQ_CANDIDATO", "NR_ORDEM_REDE_SOCIAL", "DS_URL",
)
# Até 2022 a coluna de ordem se chamava NR_ORDEM (mesmo significado e posição).
SOCIAL_PROFILE_ID_2022 = "tse-rede-social-candidato-2022-v1"
SOCIAL_COLUMNS_2022: tuple[str, ...] = tuple("NR_ORDEM" if c == "NR_ORDEM_REDE_SOCIAL" else c for c in SOCIAL_COLUMNS)

KINDS = ("asset", "complement", "social_network")

# Quantificadores limitados e início de token: tempo linear (sem backtracking super-linear).
_EMAIL = re.compile(r"(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}")
_CPF_LIKE = re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)")
_BLOCKED_HOSTS = ("whatsapp.com", "wa.me", "whats.app")


class RecordsError(RuntimeError):
    pass


class RecordsConflict(RecordsError):
    """Arquivo oficial mais novo altera registros gravados: exige supersede explícito."""

    def __init__(self, message: str, diff: list[dict[str, Any]]) -> None:
        super().__init__(message)
        self.diff = diff


@dataclass(frozen=True)
class RecordRow:
    kind: str
    member: str
    line: int
    year: int
    election_type_code: int | None
    election_code: int | None
    uf: str
    tse_candidate_id: int
    generated_at: str
    payload: dict[str, Any] = field(hash=False)
    row_hash: str = ""


def sanitize_text(value: str | None) -> str | None:
    """Mascara e-mails e sequências com formato de CPF em texto livre publicado."""
    if value is None:
        return None
    return _CPF_LIKE.sub("[documento omitido]", _EMAIL.sub("[e-mail omitido]", value))


def sanitize_url(value: str | None) -> str | None:
    """URL pública de rede social, ou None quando o link expõe contato pessoal."""
    if not value:
        return None
    url = value.strip()
    if not re.match(r"^https?://", url, re.IGNORECASE):
        return None
    host = (urlparse(url).hostname or "").lower()
    if any(host == h or host.endswith("." + h) for h in _BLOCKED_HOSTS):
        return None
    if _EMAIL.search(url):
        return None
    return url


def money(raw: str, column: str, line: int) -> Decimal | None:
    """Valor monetário do TSE: '94490,00' (bens) ou '55968.49' (complementar); -1/sentinela ⇒ None."""
    value = (raw or "").strip()
    if value.upper() in SENTINEL_TEXT or value.startswith("-"):
        return None
    normalized = value.replace(".", "").replace(",", ".") if "," in value else value
    try:
        number = Decimal(normalized)
    except InvalidOperation as exc:
        raise CandidateRowError(line, f"{column} is not a monetary value: {value!r}") from exc
    if number < 0:
        raise CandidateRowError(line, f"{column} is negative: {value!r}")
    return number


def _hash(kind: str, sq: int, payload: dict[str, Any]) -> str:
    # Data de geração fora: regenerações do mesmo conteúdo têm a mesma impressão digital.
    return row_hash([kind, str(sq), *(f"{k}={payload[k]}" for k in sorted(payload))])


def parse_asset(fields: list[str], line: int, columns: tuple[str, ...], member: str) -> RecordRow:
    if len(fields) != len(columns):
        raise CandidateRowError(line, f"expected {len(columns)} fields, found {len(fields)}")
    f = dict(zip(columns, fields, strict=True))
    sq = required_int(f["SQ_CANDIDATO"], "SQ_CANDIDATO", line)
    value = money(f["VR_BEM_CANDIDATO"], "VR_BEM_CANDIDATO", line)
    payload = {
        "order": code(f["NR_ORDEM_BEM_CANDIDATO"], "NR_ORDEM_BEM_CANDIDATO", line),
        "type_code": code(f["CD_TIPO_BEM_CANDIDATO"], "CD_TIPO_BEM_CANDIDATO", line),
        "type": text(f["DS_TIPO_BEM_CANDIDATO"]),
        "description": sanitize_text(text(f["DS_BEM_CANDIDATO"])),
        "value": None if value is None else str(value),
        "updated_on": iso_date(f["DT_ULT_ATUAL_BEM_CANDIDATO"], line),
    }
    return RecordRow(
        "asset", member, line, required_int(f["ANO_ELEICAO"], "ANO_ELEICAO", line),
        code(f["CD_TIPO_ELEICAO"], "CD_TIPO_ELEICAO", line), code(f["CD_ELEICAO"], "CD_ELEICAO", line),
        f["SG_UF"].strip().upper(), sq, f"{f['DT_GERACAO'].strip()} {f['HH_GERACAO'].strip()}", payload,
        _hash("asset", sq, payload),
    )


def parse_complement(fields: list[str], line: int, columns: tuple[str, ...], member: str, uf: str) -> RecordRow:
    """O arquivo complementar não traz SG_UF: a UF é a do CSV (`consulta_cand_complementar_<ano>_<UF>.csv`)."""
    if len(fields) != len(columns):
        raise CandidateRowError(line, f"expected {len(columns)} fields, found {len(fields)}")
    f = dict(zip(columns, fields, strict=True))
    sq = required_int(f["SQ_CANDIDATO"], "SQ_CANDIDATO", line)
    payload: dict[str, Any] = {}
    for column, key in COMPLEMENT_FIELDS.items():
        raw = f[column]
        if column == "VR_DESPESA_MAX_CAMPANHA":
            amount = money(raw, column, line)
            payload[key] = None if amount is None else str(amount)
        elif column in ("SQ_SUBSTITUIDO", "SQ_ORDEM_SUPLENCIA"):
            payload[key] = code(raw, column, line)
        elif column == "DT_ACEITE_CANDIDATURA":
            # Publicado como carimbo ISO ('2024-08-12 08:39:17'); gravamos só a data.
            stamp = text(raw)
            if stamp is not None and re.fullmatch(r"\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?", stamp):
                payload[key] = stamp[:10]
            else:
                payload[key] = iso_date(raw, line)
        else:
            payload[key] = text(raw)
    return RecordRow(
        "complement", member, line, required_int(f["ANO_ELEICAO"], "ANO_ELEICAO", line), None,
        code(f["CD_ELEICAO"], "CD_ELEICAO", line), uf.upper(), sq,
        f"{f['DT_GERACAO'].strip()} {f['HH_GERACAO'].strip()}", payload, _hash("complement", sq, payload),
    )


def parse_social(fields: list[str], line: int, columns: tuple[str, ...], member: str) -> RecordRow | None:
    """None quando o link não é uma URL pública de rede social (contato pessoal descartado)."""
    if len(fields) != len(columns):
        raise CandidateRowError(line, f"expected {len(columns)} fields, found {len(fields)}")
    f = dict(zip(columns, fields, strict=True))
    url = sanitize_url(text(f["DS_URL"]))
    if url is None:
        return None
    sq = required_int(f["SQ_CANDIDATO"], "SQ_CANDIDATO", line)
    order_column = "NR_ORDEM_REDE_SOCIAL" if "NR_ORDEM_REDE_SOCIAL" in f else "NR_ORDEM"
    payload = {"order": code(f[order_column], order_column, line), "url": url}
    return RecordRow(
        "social_network", member, line, required_int(f["AA_ELEICAO"], "AA_ELEICAO", line),
        code(f["CD_TIPO_ELEICAO"], "CD_TIPO_ELEICAO", line), code(f["CD_ELEICAO"], "CD_ELEICAO", line),
        f["SG_UF"].strip().upper(), sq, f"{f['DT_GERACAO'].strip()} {f['HH_GERACAO'].strip()}", payload,
        _hash("social_network", sq, payload),
    )


def iter_rows(path: Path, layout: DetectedLayout) -> Iterator[tuple[int, list[str]]]:
    with path.open("r", encoding=layout.encoding, newline="") as fh:
        reader = csv.reader(fh, delimiter=layout.delimiter, quotechar=layout.quotechar, strict=True)
        header = next(reader, None)
        if header is None or tuple(header) != layout.columns:
            raise LayoutError(f"{path.name}: header differs from profile {layout.profile}")
        for fields in reader:
            yield reader.line_num, fields


# ---------------------------------------------------------------------------
# Persistência


def _candidacy_index(cur: psycopg.Cursor, year: int) -> dict[tuple[int, int], str]:
    """(SQ_CANDIDATO, CD_ELEICAO) → candidatura importada do ano."""
    cur.execute(
        """SELECT c.tse_candidate_id, k.tse_election_code, c.id::text
             FROM candidacy c JOIN contest k ON k.id = c.contest_id JOIN election e ON e.id = k.election_id
            WHERE e.year = %s""",
        (year,),
    )
    return {(int(sq), int(code)): cid for sq, code, cid in cur.fetchall()}


def _stored(cur: psycopg.Cursor, kind: str, candidacy_ids: list[str]) -> dict[str, set[str]]:
    if kind == "asset":
        cur.execute(
            "SELECT candidacy_id::text, source_row_hash FROM candidacy_asset WHERE candidacy_id = ANY(%s::uuid[])",
            (candidacy_ids,),
        )
    else:
        cur.execute(
            """SELECT candidacy_id::text, source_row_hash FROM candidacy_source_record
                WHERE record_kind = %s AND candidacy_id = ANY(%s::uuid[])""",
            (kind, candidacy_ids),
        )
    stored: dict[str, set[str]] = defaultdict(set)
    for cid, digest in cur.fetchall():
        stored[cid].add(digest)
    return stored


def _delete(cur: psycopg.Cursor, kind: str, candidacy_id: str) -> None:
    if kind == "asset":
        cur.execute("DELETE FROM candidacy_asset WHERE candidacy_id = %s", (candidacy_id,))
    else:
        cur.execute("DELETE FROM candidacy_source_record WHERE record_kind = %s AND candidacy_id = %s", (kind, candidacy_id))


def _insert(cur: psycopg.Cursor, kind: str, candidacy_id: str, rows: list[RecordRow], source_id: str, run_id: str) -> int:
    inserted = 0
    for r in rows:
        if kind == "asset":
            p = r.payload
            cur.execute(
                """INSERT INTO candidacy_asset (candidacy_id, asset_type_code, asset_type, description, value,
                                                source_file_id, ingestion_run_id, source_member, source_line,
                                                source_row_hash, source_generated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (candidacy_id, source_row_hash) DO NOTHING""",
                (candidacy_id, p["type_code"], p["type"], p["description"], p["value"], source_id, run_id,
                 r.member, r.line, r.row_hash, r.generated_at),
            )
        else:
            cur.execute(
                """INSERT INTO candidacy_source_record (candidacy_id, record_kind, payload, source_file_id,
                                                       ingestion_run_id, source_member, source_line, source_row_hash,
                                                       source_generated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (candidacy_id, record_kind, source_row_hash) DO NOTHING""",
                (candidacy_id, kind, Jsonb(r.payload), source_id, run_id, r.member, r.line, r.row_hash, r.generated_at),
            )
        inserted += cur.rowcount
    return inserted


def import_records(
    conn: psycopg.Connection,
    *,
    year: int,
    uf: str,
    kind: str,
    rows: list[RecordRow],
    manifest: dict[str, Any],
    layout: DetectedLayout,
    supersede: bool = False,
    dropped_rows: int = 0,
) -> dict[str, Any]:
    """Grava os registros de uma UF/ano ligados às candidaturas já importadas do mesmo ano.

    Linhas de eleições suplementares, de outra UF ou de candidaturas não importadas são
    contadas, nunca gravadas. Bens sem valor publicado são contados e não gravados (o fato
    "valor declarado" não existe para eles)."""
    if kind not in KINDS:
        raise RecordsError(f"unknown record kind {kind!r}")
    uf = uf.upper()
    source = SOURCE_ASSETS if kind == "asset" else SOURCE_RECORDS
    scope = {"year": year, "uf": uf, "record_kind": None if kind == "asset" else kind}
    report: dict[str, Any] = {
        "status": "succeeded", "scope": scope, "rows": len(rows), "dropped_personal_contact": dropped_rows,
        "other_uf_rows": 0, "other_year_rows": 0, "other_election_rows": 0, "rows_without_value": 0,
        "duplicate_rows": 0, "rows_unmatched": 0, "candidacies": 0, "inserted": 0, "unchanged": 0,
        "superseded": 0, "diff": [],
    }
    by_key: dict[tuple[int, int | None], list[RecordRow]] = defaultdict(list)
    for r in rows:
        if r.uf != uf:
            report["other_uf_rows"] += 1
        elif r.year != year:
            report["other_year_rows"] += 1
        elif r.election_type_code not in (ORDINARY_ELECTION, None):
            report["other_election_rows"] += 1
        elif kind == "asset" and r.payload["value"] is None:
            report["rows_without_value"] += 1
        else:
            by_key[(r.tse_candidate_id, r.election_code)].append(r)
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("SELECT to_regclass('candidacy_asset') IS NOT NULL AND to_regclass('candidacy_source_record') IS NOT NULL")
            if not cur.fetchone()[0]:
                raise RecordsError("electoral schema missing candidacy_asset/candidacy_source_record; apply the EF migrations")
            source_id = _source_file_id(cur, manifest, year=year, layout=layout)
            cur.execute(
                """SELECT id FROM ingestion_run WHERE source = %s AND status = 'succeeded' AND source_file_id = %s
                     AND scope->>'year' = %s AND scope->>'uf' = %s
                     AND (scope->>'record_kind') IS NOT DISTINCT FROM %s::text""",
                (source, source_id, str(year), uf, scope["record_kind"]),
            )
            done = cur.fetchone()
            if done:
                return {"status": "already_imported", "scope": scope, "import_batch_id": str(done[0])}
            ids = _candidacy_index(cur, year)
            if not ids:
                raise RecordsError(f"no candidacies of {year} in the database; import candidates first")
            cur.execute(
                "INSERT INTO ingestion_run (source, scope, status, source_file_id) VALUES (%s, %s, 'running', %s) RETURNING id",
                (source, Jsonb(scope), source_id),
            )
            run_id = str(cur.fetchone()[0])

            groups: dict[str, list[RecordRow]] = {}
            for key, group in by_key.items():
                cid = ids.get(key) if key[1] is not None else None
                if cid is None:
                    report["rows_unmatched"] += len(group)
                    continue
                unique: dict[str, RecordRow] = {}
                for r in group:
                    if r.row_hash in unique:
                        report["duplicate_rows"] += 1
                        continue
                    unique[r.row_hash] = r
                groups[cid] = list(unique.values())
            report["candidacies"] = len(groups)

            stored = _stored(cur, kind, list(groups))
            for cid, group in groups.items():
                new = {r.row_hash for r in group}
                old = stored.get(cid, set())
                if not old:
                    report["inserted"] += _insert(cur, kind, cid, group, source_id, run_id)
                    continue
                if old == new:
                    report["unchanged"] += 1
                    continue
                report["diff"].append({"candidacy_id": cid, "added": len(new - old), "removed": len(old - new)})
                if supersede:
                    _delete(cur, kind, cid)
                    _insert(cur, kind, cid, group, source_id, run_id)
                    report["superseded"] += 1
            if report["diff"] and not supersede:
                raise RecordsConflict(
                    f"{len(report['diff'])} candidacies have {kind} records that differ from this official file; "
                    "rerun with --supersede",
                    report["diff"],
                )
            stats = {k: v for k, v in report.items() if k != "diff"} | {"diff_count": len(report["diff"])}
            cur.execute(
                "UPDATE ingestion_run SET status = 'succeeded', finished_at = now(), stats = %s WHERE id = %s",
                (Jsonb(stats), run_id),
            )
            report["import_batch_id"] = run_id
            return report
    except RecordsError as exc:
        _record_failure(conn, source, scope, str(exc))
        raise
