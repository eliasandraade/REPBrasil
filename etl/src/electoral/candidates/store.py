"""Persistência de disputas/candidaturas, resolução de identidade e vínculo com o BU.

Uma importação = uma transação. Reimportar o mesmo arquivo para o mesmo recorte
é `already_imported`. Um arquivo mais novo que altere candidaturas já gravadas
exige `supersede=True` e o diff fica no lote — nada muda em silêncio.

Ordem de resolução do perfil político de uma pessoa (docs/TSE_IDENTITY.md):
1. perfil já ligado à pessoa (`Politicians.PersonId`);
2. perfil cujo `TseId` é um SQ_CANDIDATO anterior listado pelo TSE no
   "Histórico de candidaturas" da candidatura atual;
3. perfil cujo `TseId` é o próprio SQ_CANDIDATO atual (reexecução);
4. novo perfil criado a partir da candidatura oficial.
Um perfil já ligado a OUTRA pessoa nunca é reaproveitado: conflito registrado,
candidatura sem perfil.

Candidatura sem CPF utilizável (a partir de 2024 o TSE não divulga o CPF):
a. histórico oficial persistido (`candidacy_prior`): uma candidatura posterior de pessoa
   resolvida por CPF lista este SQ_CANDIDATO ⇒ mesma pessoa (`resolved_tse_link`);
b. perfil cujo `TseId` é este SQ_CANDIDATO: vínculo com o perfil; se o perfil já pertence a
   uma pessoa (vínculo oficial anterior), a candidatura herda a pessoa (`resolved_tse_link`);
c. nada disso ⇒ sem pessoa e sem perfil. Nunca por nome; nunca um perfil inventado.
"""

from __future__ import annotations

import json
import re
import unicodedata
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from ..cadaster.store import _record_failure, _source_file_id
from ..open_data.layout import DetectedLayout
from . import identity
from .parser import CandidateRow, HistoryRow

SOURCE = "tse-open-data-candidates"
HISTORY_SOURCE = "tse-open-data-candidacy-history"
LINK_SOURCE = "electoral-identity-link"
REQUIRED_TABLES = {"contest", "candidacy", "votable_candidacy", "candidacy_prior"}

# Ordem para escolher a candidatura que origina um perfil novo (cargos com votação primeiro).
OFFICE_PRECEDENCE = {1: 0, 3: 1, 5: 2, 6: 3, 7: 4, 8: 5, 2: 6, 4: 7, 9: 8, 10: 9, 11: 10, 13: 11, 12: 12}

# CD_TIPO_ELEICAO 2 = eleição ordinária. O arquivo de candidatos de um ano também traz
# eleições suplementares realizadas depois (mesmo ANO_ELEICAO, outra data): não pertencem
# ao pleito (ano, turno) e são contadas à parte. Sentinela (None) segue para a checagem de data.
ORDINARY_ELECTION = 2

COMPARED_FIELDS = (
    "candidate_number", "ballot_name", "full_name", "social_name", "agremiation_type",
    "party_number", "party_acronym", "party_name", "federation_number", "federation_acronym",
    "federation_name", "coalition_name", "candidacy_status_code", "candidacy_status",
    "round_outcome_code", "round_outcome", "elected",
)

_RUN_SUCCEEDED = "UPDATE ingestion_run SET status = 'succeeded', finished_at = now(), stats = %s WHERE id = %s"


class CandidatesError(RuntimeError):
    pass


class CandidacyConflict(CandidatesError):
    """Arquivo oficial mais novo altera candidaturas gravadas: exige supersede explícito."""

    def __init__(self, message: str, diff: list[dict[str, Any]]) -> None:
        super().__init__(message)
        self.diff = diff


@dataclass
class _Person:
    person_id: str
    candidacies: list[CandidateRow] = field(default_factory=list)
    politician_id: str | None = None
    politician_method: str | None = None


def _check_schema(cur: psycopg.Cursor) -> None:
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")
    missing = REQUIRED_TABLES - {r[0] for r in cur.fetchall()}
    if missing:
        raise CandidatesError(
            f"electoral schema missing {sorted(missing)}; apply the EF migration AddElectoralIntelligence"
        )


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _check_key(cur: psycopg.Cursor, key: bytes) -> None:
    """A chave HMAC é parte da identidade persistida: trocá-la em silêncio duplicaria pessoas."""
    cur.execute(
        """SELECT stats->>'key_fingerprint' FROM ingestion_run
            WHERE source = %s AND status = 'succeeded' AND stats ? 'key_fingerprint'
            ORDER BY finished_at DESC LIMIT 1""",
        (SOURCE,),
    )
    row = cur.fetchone()
    if row and row[0] != identity.key_fingerprint(key):
        raise CandidatesError(
            "REPBRASIL_PERSON_DOCUMENT_KEY differs from the key used by previous imports in this database; "
            "key rotation requires the explicit procedure in docs/TSE_IDENTITY.md (never a silent change)"
        )


def _election_id(cur: psycopg.Cursor, year: int, turn: int) -> str:
    return _election(cur, year, turn)[0]


def _contest_ids(cur: psycopg.Cursor, election_id: str, rows: Iterable[CandidateRow]) -> dict[tuple, str]:
    ids: dict[tuple, str] = {}
    for r in rows:
        key = (r.election_code, r.office_code, r.electoral_unit)
        if key in ids:
            continue
        # UF da disputa: nenhuma para a federal (BR); a própria UE na estadual; SG_UF na municipal.
        contest_uf = None if r.scope == "federal" else (r.electoral_unit if r.scope == "state" else r.uf)
        cur.execute(
            """INSERT INTO contest (election_id, tse_election_code, tse_election_description, office_code,
                                    office_name, scope, electoral_unit, uf)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (election_id, tse_election_code, office_code, electoral_unit) DO NOTHING""",
            (election_id, r.election_code, r.election_description, r.office_code, r.office_name, r.scope,
             r.electoral_unit, contest_uf),
        )
        cur.execute(
            """SELECT id, office_name, scope FROM contest WHERE election_id = %s AND tse_election_code = %s
                 AND office_code = %s AND electoral_unit = %s""",
            (election_id, *key),
        )
        cid, office_name, scope = cur.fetchone()
        if (office_name, scope) != (r.office_name, r.scope):
            raise CandidatesError(
                f"contest {key} stored as {(office_name, scope)}, source says {(r.office_name, r.scope)}"
            )
        ids[key] = str(cid)
    return ids


def _person_id(cur: psycopg.Cursor, document_hash: str, full_name: str, now: str) -> str:
    cur.execute(
        """SELECT "Id" FROM "Persons"
            WHERE "DocumentType" = 'CPF' AND "NormalizedDocumentHash" = %s AND "DeletedAt" IS NULL""",
        (document_hash,),
    )
    rows = cur.fetchall()
    if len(rows) > 1:
        raise CandidatesError("more than one active Person shares the same document hash")
    if rows:
        return str(rows[0][0])
    person_id = str(uuid.uuid4())
    cur.execute(
        """INSERT INTO "Persons" ("Id", "FullName", "NormalizedDocumentHash", "DocumentType",
                                  "CreatedAt", "UpdatedAt", "SourceUpdatedAt")
           VALUES (%s, %s, %s, 'CPF', %s, %s, %s)""",
        (person_id, full_name, document_hash, now, now, now),
    )
    return person_id


def _politicians(cur: psycopg.Cursor, where: str, params: tuple) -> list[tuple[str, str | None, str | None]]:
    cur.execute(f'SELECT "Id", "PersonId", "TseId" FROM "Politicians" WHERE "DeletedAt" IS NULL AND {where}', params)
    return [(str(a), str(b) if b else None, c) for a, b, c in cur.fetchall()]


def _resolve_politician(
    cur: psycopg.Cursor,
    person: _Person,
    history: dict[int, list[HistoryRow]],
    now: str,
    report: dict[str, Any],
) -> None:
    """Escolhe/cria o perfil político da pessoa. Nunca por nome."""
    # 1. já ligado à pessoa
    linked = _politicians(cur, '"PersonId" = %s ORDER BY "SourceUpdatedAt" DESC NULLS LAST, "Id"', (person.person_id,))
    if linked:
        person.politician_id, person.politician_method = linked[0][0], "person_link"
        return

    # 2. histórico oficial de candidaturas: SQ anteriores da MESMA pessoa segundo o TSE
    prior: list[HistoryRow] = []
    for c in person.candidacies:
        prior.extend(h for h in history.get(c.tse_candidate_id, []) if h.tse_candidate_id != c.tse_candidate_id)
    by_sq = {str(h.tse_candidate_id): h for h in prior}
    if by_sq:
        found = _politicians(cur, '"TseId" = ANY(%s)', (list(by_sq),))
        usable = []
        for pid, other_person, tse_id in found:
            if other_person and other_person != person.person_id:
                report["identity_conflicts"].append(
                    {"politician_id": pid, "tse_id": tse_id, "reason": "profile already linked to another person"}
                )
                continue
            usable.append((by_sq[tse_id].year, tse_id, pid))
        if usable:
            usable.sort(key=lambda u: (-u[0], u[1]))
            for _, _, pid in usable:
                cur.execute(
                    'UPDATE "Politicians" SET "PersonId" = %s, "UpdatedAt" = %s WHERE "Id" = %s AND "PersonId" IS NULL',
                    (person.person_id, now, pid),
                )
            person.politician_id, person.politician_method = usable[0][2], "tse_candidacy_history"
            report["politicians_linked_by_history"] += 1
            return
        if found:  # só perfis de outra pessoa: não criar duplicata silenciosa
            return

    # 3. reexecução: perfil já criado a partir de uma candidatura atual
    own = _politicians(cur, '"TseId" = ANY(%s)', ([str(c.tse_candidate_id) for c in person.candidacies],))
    for pid, other_person, tse_id in own:
        if other_person and other_person != person.person_id:
            report["identity_conflicts"].append(
                {"politician_id": pid, "tse_id": tse_id, "reason": "profile already linked to another person"}
            )
            return
    if own:
        pid = own[0][0]
        cur.execute(
            'UPDATE "Politicians" SET "PersonId" = %s, "UpdatedAt" = %s WHERE "Id" = %s AND "PersonId" IS NULL',
            (person.person_id, now, pid),
        )
        person.politician_id, person.politician_method = pid, "tse_candidate_id"
        return

    # 4. novo perfil a partir da candidatura oficial (mesma convenção do TseCandidatesPipeline)
    origin = min(person.candidacies, key=lambda c: (OFFICE_PRECEDENCE.get(c.office_code, 99), c.tse_candidate_id))
    pid = str(uuid.uuid4())
    cur.execute(
        """INSERT INTO "Politicians" ("Id", "Name", "BallotName", "TseId", "State", "PartyAcronym", "PartyName",
                                      "Office", "CandidacyStatus", "PersonId", "CreatedAt", "UpdatedAt",
                                      "SourceUpdatedAt")
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (pid, origin.full_name.title(), origin.ballot_name.title(), str(origin.tse_candidate_id), origin.uf,
         origin.party_acronym, origin.party_name, origin.office_name, origin.candidacy_status or "#NE",
         person.person_id, now, now, now),
    )
    person.politician_id, person.politician_method = pid, "created_from_candidacy"
    report["politicians_created"] += 1


def _candidacy_values(r: CandidateRow) -> dict[str, Any]:
    return {f: getattr(r, f) for f in COMPARED_FIELDS}


def _register_source(cur: psycopg.Cursor, manifest: dict[str, Any], name: str, now: str) -> None:
    """Espelha o arquivo oficial em public."Sources" (aba de fontes do perfil)."""
    zip_info = manifest["zip"]
    cur.execute(
        """INSERT INTO "Sources" ("Id", "Name", "Organization", "SourceType", "OriginalUrl", "CollectedAt", "Hash",
                                  "FileSizeBytes", "License", "CollectionMethod", "CreatedAt", "UpdatedAt")
           VALUES (%s, %s, 'Tribunal Superior Eleitoral', %s, %s, %s, %s, %s, 'Dados Abertos', 'CSV_Download', %s, %s)
           ON CONFLICT ("Name", "SourceType") DO UPDATE SET
             "CollectedAt" = EXCLUDED."CollectedAt", "Hash" = EXCLUDED."Hash",
             "FileSizeBytes" = EXCLUDED."FileSizeBytes", "UpdatedAt" = EXCLUDED."UpdatedAt"
        """,
        (str(uuid.uuid4()), name, manifest["kind"], manifest["source"]["url"], manifest["downloaded_at"],
         zip_info["sha256"], zip_info["size"], now, now),
    )


def municipal_selector(uf: str) -> str:
    """Token de escopo: todas as disputas municipais da UF (SG_UE = código TSE do município)."""
    return f"MUN:{uf.upper()}"


def select_candidacies(
    candidates: Iterable[CandidateRow],
    *,
    year: int,
    turn: int,
    units: set[str],
    municipal_ufs: set[str] | frozenset[str] = frozenset(),
) -> tuple[list[CandidateRow], dict[int, int], dict[str, int]]:
    """Candidaturas das UEs pedidas (ou de todos os municípios das UFs em `municipal_ufs`), no turno pedido.

    O arquivo oficial traz, para a mesma eleição, as linhas de cada turno com o MESMO
    SQ_CANDIDATO (ex.: Presidente 2º turno, CD_ELEICAO próprio). Linhas de outro turno são
    separadas e contadas — nunca misturadas. Eleições suplementares publicadas no arquivo do
    ano também são separadas e contadas. Ano diferente do pedido continua sendo erro.
    Devolve (selecionadas, linhas por outro turno, linhas por outra eleição).
    """
    municipal_ufs = {u.upper() for u in municipal_ufs}
    selected: list[CandidateRow] = []
    other_turn: dict[int, int] = defaultdict(int)
    other_election: dict[str, int] = defaultdict(int)
    for r in candidates:
        if r.electoral_unit not in units and not (r.scope == "municipal" and r.uf in municipal_ufs):
            continue
        if r.year != year:
            raise CandidatesError(f"{r.source_member}:{r.line}: year {r.year} differs from {year}")
        if r.election_type_code not in (ORDINARY_ELECTION, None):
            other_election[f"{r.election_code} {r.election_description or ''} ({r.election_date})"] += 1
            continue
        if r.turn != turn:
            other_turn[r.turn] += 1
            continue
        selected.append(r)
    return selected, dict(other_turn), dict(other_election)


def _resolve_without_document(
    cur: psycopg.Cursor, r: CandidateRow, year: int, report: dict[str, Any]
) -> tuple[str | None, str | None, str | None]:
    """(pessoa, perfil, método) de uma candidatura sem CPF utilizável — só por relação oficial."""
    # a. histórico oficial: candidatura posterior de pessoa resolvida por CPF lista este SQ
    cur.execute(
        """SELECT DISTINCT c.person_id::text, c.politician_id::text
             FROM candidacy_prior p JOIN candidacy c ON c.id = p.candidacy_id
            WHERE p.prior_year = %s AND p.prior_tse_candidate_id = %s AND c.person_id IS NOT NULL""",
        (year, r.tse_candidate_id),
    )
    cited = cur.fetchall()
    persons = {row[0] for row in cited}
    if len(persons) > 1:
        report["identity_conflicts"].append(
            {"tse_candidate_id": r.tse_candidate_id, "reason": "official history links this candidacy to more than one person"}
        )
        return None, None, None
    if persons:
        (person_id,) = persons
        linked = _politicians(cur, '"PersonId" = %s ORDER BY "SourceUpdatedAt" DESC NULLS LAST, "Id"', (person_id,))
        politician_id = linked[0][0] if linked else next((row[1] for row in cited if row[1]), None)
        return person_id, politician_id, "tse_candidacy_history"

    # b. perfil cujo TseId é o próprio SQ_CANDIDATO (identificador oficial)
    found = _politicians(cur, '"TseId" = %s', (str(r.tse_candidate_id),))
    if len(found) > 1:
        report["identity_conflicts"].append(
            {"tse_candidate_id": r.tse_candidate_id, "reason": "more than one profile has this SQ_CANDIDATO as TseId"}
        )
        return None, None, None
    if found:
        politician_id, person_id, _ = found[0]
        if person_id:
            return person_id, politician_id, "tse_candidate_id_profile"
        return None, politician_id, None
    # c. sem relação oficial: sem pessoa e sem perfil
    return None, None, None


def _persist_priors(
    cur: psycopg.Cursor,
    history_by_current: dict[int, list[HistoryRow]],
    ids_by_sq: dict[int, list[str]],
    source_file_id: str,
) -> int:
    """Grava o histórico oficial de cada candidatura importada (idempotente)."""
    inserted = 0
    for sq, candidacy_ids in ids_by_sq.items():
        for h in history_by_current.get(sq, []):
            if h.tse_candidate_id == sq:
                continue
            for candidacy_id in candidacy_ids:
                cur.execute(
                    """INSERT INTO candidacy_prior (candidacy_id, prior_year, prior_turn, prior_tse_candidate_id,
                                                    prior_office_code, prior_office_name, prior_electoral_unit,
                                                    prior_unit_name, prior_candidate_number, prior_ballot_name,
                                                    prior_party_acronym, prior_round_outcome, source_file_id,
                                                    source_member, source_line)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (candidacy_id, prior_year, prior_turn, prior_tse_candidate_id) DO NOTHING""",
                    (candidacy_id, h.year, h.turn, h.tse_candidate_id, h.office_code, h.office_name,
                     h.electoral_unit, h.unit_name, h.candidate_number, h.ballot_name, h.party_acronym,
                     h.round_outcome, source_file_id, h.source_member, h.line),
                )
                inserted += cur.rowcount
    return inserted


def _election(cur: psycopg.Cursor, year: int, turn: int) -> tuple[str, str | None]:
    cur.execute("SELECT id, election_date::text FROM election WHERE year = %s AND round = %s", (year, turn))
    row = cur.fetchone()
    if row is None:
        raise CandidatesError(f"election {year}/{turn} not found; import the official electoral cadaster first")
    return str(row[0]), row[1]


def import_candidates(
    conn: psycopg.Connection,
    *,
    year: int,
    turn: int,
    units: set[str],
    candidates: list[CandidateRow],
    candidates_manifest: dict[str, Any],
    candidates_layout: DetectedLayout,
    history: list[HistoryRow] | None,
    history_manifest: dict[str, Any] | None,
    history_layout: DetectedLayout | None,
    key: bytes,
    supersede: bool = False,
    municipal_ufs: set[str] | frozenset[str] = frozenset(),
) -> dict[str, Any]:
    """Importa as candidaturas do recorte. `history` é o "Histórico de candidaturas" do mesmo ano
    (publicado a partir de 2026); sem ele (2022, 2024) a identidade usa só CPF e vínculos oficiais já gravados."""
    if (history is None) != (history_manifest is None):
        raise CandidatesError("history rows and history manifest must be given together")
    units = {u.upper() for u in units}
    municipal_ufs = {u.upper() for u in municipal_ufs}
    selected, other_turn_rows, other_election_rows = select_candidacies(
        candidates, year=year, turn=turn, units=units, municipal_ufs=municipal_ufs
    )
    scope = {
        "year": year, "turn": turn,
        "units": ",".join(sorted(units | {municipal_selector(u) for u in municipal_ufs})),
        "history_zip_sha256": history_manifest["zip"]["sha256"] if history_manifest else None,
    }
    if not selected:
        raise CandidatesError(f"no candidacies for {scope['units']} in {year}/{turn}")
    seen: dict[tuple, str] = {}
    for r in selected:
        k = (r.election_code, r.office_code, r.electoral_unit, r.tse_candidate_id)
        if k in seen:
            raise CandidatesError(f"{r.source_member}:{r.line}: candidacy {k} repeats {seen[k]}")
        seen[k] = f"{r.source_member}:{r.line}"

    history_by_current: dict[int, list[HistoryRow]] = defaultdict(list)
    for h in history or []:
        if h.current_year == year:
            history_by_current[h.current_tse_candidate_id].append(h)

    now = _now()
    report: dict[str, Any] = {
        "status": "succeeded", "scope": scope, "candidacies": len(selected), "inserted": 0, "unchanged": 0,
        "superseded": 0, "identity": defaultdict(int), "identity_resolution": defaultdict(int), "persons": 0,
        "politicians_created": 0, "politicians_linked_by_history": 0, "identity_conflicts": [], "diff": [],
        "key_fingerprint": identity.key_fingerprint(key),
        "other_turn_rows": {str(t): n for t, n in sorted(other_turn_rows.items())},
        "other_election_rows": dict(sorted(other_election_rows.items())),
        "history_rows_persisted": 0,
    }
    try:
        with conn.transaction(), conn.cursor() as cur:
            _check_schema(cur)
            source_id = _source_file_id(cur, candidates_manifest, year=year, layout=candidates_layout)
            history_source_id = (
                _source_file_id(cur, history_manifest, year=year, layout=history_layout) if history_manifest else None
            )
            cur.execute(
                """SELECT id FROM ingestion_run WHERE source = %s AND status = 'succeeded' AND source_file_id = %s
                     AND scope->>'turn' = %s AND scope->>'units' = %s
                     AND (scope->>'history_zip_sha256') IS NOT DISTINCT FROM %s::text""",
                (SOURCE, source_id, str(turn), scope["units"], scope["history_zip_sha256"]),
            )
            done = cur.fetchone()
            if done:
                return {"status": "already_imported", "scope": scope, "import_batch_id": str(done[0])}
            election_id, election_date = _election(cur, year, turn)
            wrong_date = sorted({r.election_date for r in selected if r.election_date and r.election_date != election_date})
            if wrong_date:
                raise CandidatesError(
                    f"candidacies dated {wrong_date} do not belong to election {year}/{turn} held on {election_date}"
                )
            _check_key(cur, key)
            cur.execute(
                """INSERT INTO ingestion_run (source, election_id, scope, status, source_file_id)
                   VALUES (%s, %s, %s, 'running', %s) RETURNING id""",
                (SOURCE, election_id, Jsonb(scope), source_id),
            )
            run_id = str(cur.fetchone()[0])
            contests = _contest_ids(cur, election_id, selected)

            # Identidade: pessoas por HMAC do CPF (o CPF não sai deste bloco).
            # Indexado pela posição: o número da linha só é único dentro de cada CSV do ZIP.
            persons: dict[str, _Person] = {}
            status_of: list[tuple[str, str | None]] = []
            for r in selected:
                check = identity.check_cpf(r.cpf_raw)
                report["identity"][check.status] += 1
                if check.status != identity.RESOLVED:
                    status_of.append((check.status, None))
                    continue
                digest = identity.document_hash(key, check.digits or "")
                if digest not in persons:
                    persons[digest] = _Person(_person_id(cur, digest, r.full_name, now))
                persons[digest].candidacies.append(r)
                status_of.append((identity.RESOLVED, digest))
            report["persons"] = len(persons)
            for person in persons.values():
                _resolve_politician(cur, person, history_by_current, now, report)

            # (status, pessoa, perfil, método) de cada linha; sem CPF ⇒ só vínculos oficiais.
            resolved: list[tuple[str, str | None, str | None, str | None]] = []
            for r, (status, digest) in zip(selected, status_of, strict=True):
                if digest:
                    person = persons[digest]
                    resolved.append((status, person.person_id, person.politician_id, identity.IDENTITY_METHOD))
                    report["identity_resolution"]["cpf"] += 1
                    continue
                person_id, politician_id, method = _resolve_without_document(cur, r, year, report)
                if person_id:
                    resolved.append((identity.TSE_LINK, person_id, politician_id, method))
                    report["identity_resolution"][method or "tse_link"] += 1
                else:
                    resolved.append((status, None, politician_id, None))
                    report["identity_resolution"]["profile_only" if politician_id else "unresolved"] += 1

            ids_by_sq: dict[int, list[str]] = defaultdict(list)
            for r, (status, person_id, politician_id, method) in zip(selected, resolved, strict=True):
                contest_id = contests[(r.election_code, r.office_code, r.electoral_unit)]
                values = _candidacy_values(r)
                cur.execute(
                    f"SELECT id, {', '.join(COMPARED_FIELDS)} FROM candidacy WHERE contest_id = %s AND tse_candidate_id = %s",
                    (contest_id, r.tse_candidate_id),
                )
                existing = cur.fetchone()
                common = {
                    **values,
                    "person_id": person_id,
                    "politician_id": politician_id,
                    "identity_status": status,
                    "identity_method": method,
                    "source_file_id": source_id, "ingestion_run_id": run_id,
                    "source_member": r.source_member, "source_line": r.line,
                    "source_row_hash": r.source_row_hash, "source_generated_at": r.generated_at,
                }
                if existing is None:
                    cols = ["contest_id", "tse_candidate_id", *common]
                    cur.execute(
                        f"INSERT INTO candidacy ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) RETURNING id",
                        (contest_id, r.tse_candidate_id, *common.values()),
                    )
                    ids_by_sq[r.tse_candidate_id].append(str(cur.fetchone()[0]))
                    report["inserted"] += 1
                    continue
                ids_by_sq[r.tse_candidate_id].append(str(existing[0]))
                stored = dict(zip(COMPARED_FIELDS, existing[1:], strict=True))
                changes = {f: [stored[f], values[f]] for f in COMPARED_FIELDS if stored[f] != values[f]}
                if not changes:
                    # Identidade pode evoluir (ex.: chave nova não; perfil novo sim) sem tocar dados da fonte.
                    cur.execute(
                        """UPDATE candidacy SET person_id = %s, politician_id = %s, identity_status = %s,
                                  identity_method = %s, updated_at = now()
                            WHERE id = %s AND (person_id, politician_id, identity_status)
                                  IS DISTINCT FROM (%s::uuid, %s::uuid, %s)""",
                        (person_id, politician_id, status, method, existing[0], person_id, politician_id, status),
                    )
                    report["unchanged"] += 1
                    continue
                report["diff"].append({"tse_candidate_id": r.tse_candidate_id, "changes": changes})
                if supersede:
                    sets = ", ".join(f"{c} = %s" for c in common)
                    cur.execute(f"UPDATE candidacy SET {sets}, updated_at = now() WHERE id = %s", (*common.values(), existing[0]))
                    report["superseded"] += 1
            if report["diff"] and not supersede:
                raise CandidacyConflict(
                    f"{len(report['diff'])} stored candidacies differ from this official file; rerun with --supersede",
                    report["diff"],
                )
            if history_source_id:
                report["history_rows_persisted"] = _persist_priors(cur, history_by_current, ids_by_sq, history_source_id)

            _register_source(cur, candidates_manifest, f"TSE Candidatos {year} — {candidates_manifest['zip']['name']}", now)
            if history_manifest:
                _register_source(cur, history_manifest, f"TSE Histórico de candidaturas {year} — {history_manifest['zip']['name']}", now)
            report["identity"] = dict(report["identity"])
            report["identity_resolution"] = dict(report["identity_resolution"])
            report["history_source_file_id"] = history_source_id
            cur.execute(
                _RUN_SUCCEEDED,
                (Jsonb({k: v for k, v in report.items() if k not in ("diff",)} | {"diff_count": len(report["diff"])}), run_id),
            )
            report["import_batch_id"] = run_id
            return report
    except CandidatesError as exc:
        _record_failure(conn, SOURCE, scope, str(exc))
        raise


def backfill_history(
    conn: psycopg.Connection,
    *,
    year: int,
    history: list[HistoryRow],
    history_manifest: dict[str, Any],
    history_layout: DetectedLayout,
) -> dict[str, Any]:
    """Grava `candidacy_prior` para candidaturas de `year` já importadas antes da migration 007.

    Não altera candidatura nem identidade: só o fato oficial "SQ atual ⇒ SQ anteriores".
    Linhas cuja candidatura atual não está no banco (outras UFs) são contadas e ignoradas.
    """
    scope = {"year": year, "history_zip_sha256": history_manifest["zip"]["sha256"]}
    report: dict[str, Any] = {"status": "succeeded", "scope": scope, "history_rows": 0, "rows_for_imported": 0,
                              "rows_not_imported": 0, "self_rows": 0, "inserted": 0}
    try:
        with conn.transaction(), conn.cursor() as cur:
            _check_schema(cur)
            source_id = _source_file_id(cur, history_manifest, year=year, layout=history_layout)
            cur.execute(
                """SELECT id FROM ingestion_run WHERE source = %s AND status = 'succeeded' AND source_file_id = %s
                     AND scope->>'year' = %s""",
                (HISTORY_SOURCE, source_id, str(year)),
            )
            done = cur.fetchone()
            if done:
                return {"status": "already_imported", "scope": scope, "import_batch_id": str(done[0])}
            cur.execute(
                """SELECT c.tse_candidate_id, c.id::text FROM candidacy c
                     JOIN contest k ON k.id = c.contest_id JOIN election e ON e.id = k.election_id
                    WHERE e.year = %s""",
                (year,),
            )
            ids_by_sq: dict[int, list[str]] = defaultdict(list)
            for sq, cid in cur.fetchall():
                ids_by_sq[int(sq)].append(cid)
            if not ids_by_sq:
                raise CandidatesError(f"no candidacies of {year} in the database; import candidates first")
            cur.execute(
                """INSERT INTO ingestion_run (source, scope, status, source_file_id)
                   VALUES (%s, %s, 'running', %s) RETURNING id""",
                (HISTORY_SOURCE, Jsonb(scope), source_id),
            )
            run_id = str(cur.fetchone()[0])
            history_by_current: dict[int, list[HistoryRow]] = defaultdict(list)
            for h in history:
                if h.current_year != year:
                    continue
                report["history_rows"] += 1
                if h.tse_candidate_id == h.current_tse_candidate_id:
                    report["self_rows"] += 1
                elif h.current_tse_candidate_id in ids_by_sq:
                    report["rows_for_imported"] += 1
                    history_by_current[h.current_tse_candidate_id].append(h)
                else:
                    report["rows_not_imported"] += 1
            report["inserted"] = _persist_priors(cur, history_by_current, ids_by_sq, source_id)
            _register_source(cur, history_manifest, f"TSE Histórico de candidaturas {year} — {history_manifest['zip']['name']}", _now())
            cur.execute(
                _RUN_SUCCEEDED,
                (Jsonb(report), run_id),
            )
            report["import_batch_id"] = run_id
            return report
    except CandidatesError as exc:
        _record_failure(conn, HISTORY_SOURCE, scope, str(exc))
        raise


# ---------------------------------------------------------------------------
# Vínculo votável do BU → candidatura


# Versão da regra de vínculo (parte da idempotência do lote): 1 = disputa + número;
# 2 = + desempate pelo complementar oficial "inserido na urna" e nome conferido sem pontuação;
# 3 = + substituição depois da carga das urnas (as duas constam como inseridas): vale a única que o
#     complementar não marca como substituída (ST_SUBSTITUIDO = N).
LINK_RULES = 3
_ORDINALS = str.maketrans("", "", "ªº")
_NOT_ALNUM = re.compile(r"[^0-9A-Z]+")


def _fold(name: str | None) -> str:
    """Nome para conferência entre fontes oficiais: sem acentos, pontuação nem indicadores ordinais
    ("PROFª" e "PROF." conferem; "D'TERREIRO" e "D TERREIRO" também)."""
    if not name:
        return ""
    decomposed = unicodedata.normalize("NFKD", name.translate(_ORDINALS))
    plain = "".join(c for c in decomposed if not unicodedata.combining(c)).upper()
    return " ".join(_NOT_ALNUM.sub(" ", plain).split())


# Complementar oficial mais recente da candidatura: "inserido na urna" e "substituída".
_COMPLEMENT_FLAGS = """
    SELECT c.id, c.ballot_name, rc.payload->>'inserted_in_urn', rc.payload->>'substituted'
      FROM candidacy c JOIN contest k ON k.id = c.contest_id
      LEFT JOIN LATERAL (SELECT r.payload FROM candidacy_source_record r
                          WHERE r.candidacy_id = c.id AND r.record_kind = 'complement'
                          ORDER BY r.id DESC LIMIT 1) rc ON true"""


def _link_matches(cur: psycopg.Cursor, election_id: str, uf: str, votable: tuple) -> list[tuple]:
    """(candidatura, nome de urna, inserido na urna, substituída) das candidaturas da disputa com o número
    do votável."""
    _, election_code, office_code, number, _, municipality = votable
    if municipality is not None:
        # Cargo municipal: só a disputa daquele município (nunca a UF inteira).
        cur.execute(
            _COMPLEMENT_FLAGS
            + """ WHERE k.election_id = %s AND k.tse_election_code = %s AND k.office_code = %s
                    AND k.scope = 'municipal' AND k.uf = %s AND k.electoral_unit = %s
                    AND c.candidate_number = %s""",
            (election_id, election_code, office_code, uf, municipality.strip(), number),
        )
    else:
        cur.execute(
            _COMPLEMENT_FLAGS
            + """ WHERE k.election_id = %s AND k.tse_election_code = %s AND k.office_code = %s
                    AND k.scope IN ('federal', 'state') AND k.electoral_unit IN (%s, 'BR')
                    AND c.candidate_number = %s""",
            (election_id, election_code, office_code, uf, number),
        )
    return cur.fetchall()


def _flag(value: str | None) -> str:
    return (value or "").strip().upper()


def _pick_candidacy(matches: list[tuple]) -> tuple[tuple | None, str | None]:
    """(candidatura, método): uma única pela disputa + número; várias (substituição de candidatura,
    mesmo número) só quando exatamente uma foi inserida na urna segundo o complementar oficial; se a
    substituição veio depois da carga das urnas (ex.: falecimento) e as duas constam como inseridas,
    só quando exatamente uma NÃO foi substituída. O nome de urna ainda é conferido depois."""
    if len(matches) == 1:
        return matches[0], "contest_number"
    inserted = [m for m in matches if _flag(m[2]) == "SIM"]
    if len(inserted) == 1:
        return inserted[0], "contest_number_inserted_in_urn"
    standing = [m for m in inserted if _flag(m[3]) == "N"]
    if len(inserted) > 1 and len(standing) == 1:
        return standing[0], "contest_number_substitution"
    return None, None


def link_votables(conn: psycopg.Connection, *, year: int, turn: int, uf: str) -> dict[str, Any]:
    """Liga votáveis nominais do BU (urnas da UF) às candidaturas oficiais.

    Chave determinística: CD_ELEICAO + cargo + número, na disputa da UF ou federal ('BR');
    para cargos municipais, na disputa do MUNICÍPIO do votável (SG_UE = código TSE).
    Nenhuma candidatura ⇒ sem vínculo; várias ⇒ só pelos sinalizadores oficiais do complementar
    (inserida na urna; não substituída), senão sem vínculo. Nome de urna divergente entre o BU e o
    arquivo de candidatos ⇒ sem vínculo (conflito entre fontes registrado para revisão). Nenhuma
    tabela de votos é alterada.
    """
    uf = uf.upper()
    report: dict[str, Any] = {"status": "succeeded", "year": year, "turn": turn, "uf": uf, "votables": 0,
                              "linked": 0, "already_linked": 0, "resolved_by_inserted_in_urn": 0,
                              "resolved_by_substitution": 0, "unmatched": [], "ambiguous": [], "name_mismatch": []}
    with conn.transaction(), conn.cursor() as cur:
        _check_schema(cur)
        election_id = _election_id(cur, year, turn)
        cur.execute(
            """SELECT id FROM ingestion_run WHERE source = %s AND status = 'succeeded' AND election_id = %s
               ORDER BY finished_at DESC LIMIT 1""",
            (SOURCE, election_id),
        )
        latest = cur.fetchone()
        if latest is None:
            raise CandidatesError(f"no candidacies imported for {year}/{turn}; run import-candidates first")
        link_scope = {"year": year, "turn": turn, "uf": uf, "candidates_run": str(latest[0]), "link_rules": LINK_RULES}
        cur.execute(
            """SELECT id FROM ingestion_run WHERE source = %s AND status = 'succeeded' AND election_id = %s
                 AND scope->>'uf' = %s AND scope->>'candidates_run' = %s
                 AND (scope->>'link_rules') IS NOT DISTINCT FROM %s::text""",
            (LINK_SOURCE, election_id, uf, link_scope["candidates_run"], str(LINK_RULES)),
        )
        done = cur.fetchone()
        if done:
            return {"status": "already_imported", "scope": link_scope, "import_batch_id": str(done[0])}
        cur.execute(
            """INSERT INTO ingestion_run (source, election_id, scope, status) VALUES (%s, %s, %s, 'running')
               RETURNING id""",
            (LINK_SOURCE, election_id, Jsonb(link_scope)),
        )
        run_id = str(cur.fetchone()[0])
        # votáveis nominais que aparecem em urnas desta UF neste pleito/turno
        cur.execute(
            """SELECT v.id, v.election_code, v.office_code, v.number, v.name, v.municipality_tse_code
                 FROM votable v
                WHERE v.vote_kind = 'candidate'
                  AND EXISTS (SELECT 1 FROM section_office_result r JOIN section_office_vote sv ON sv.result_id = r.id
                               WHERE sv.votable_id = v.id AND r.year = %s AND r.turn = %s AND r.uf = %s)
                ORDER BY v.id""",
            (year, turn, uf),
        )
        votables = cur.fetchall()
        report["votables"] = len(votables)
        for votable in votables:
            votable_id, election_code, office_code, number, name, municipality = votable
            matches = _link_matches(cur, election_id, uf, votable)
            ref = {"votable_id": votable_id, "election_code": election_code, "office_code": office_code,
                   "number": number, "name": name, "municipality_tse_code": municipality}
            if not matches:
                report["unmatched"].append(ref)
                continue
            chosen, method = _pick_candidacy(matches)
            if chosen is None:
                report["ambiguous"].append({**ref, "candidacies": [str(m[0]) for m in matches]})
                continue
            candidacy_id, ballot_name = chosen[0], chosen[1]
            if _fold(ballot_name) != _fold(name):
                report["name_mismatch"].append({**ref, "candidacy_id": str(candidacy_id), "ballot_name": ballot_name})
                continue
            cur.execute("SELECT candidacy_id FROM votable_candidacy WHERE votable_id = %s AND uf = %s", (votable_id, uf))
            stored = cur.fetchone()
            if stored is not None:
                if str(stored[0]) != str(candidacy_id):
                    raise CandidatesError(
                        f"votable {votable_id}/{uf} already linked to candidacy {stored[0]}, now resolves to {candidacy_id}"
                    )
                report["already_linked"] += 1
                continue
            cur.execute(
                """INSERT INTO votable_candidacy (votable_id, uf, candidacy_id, method, ingestion_run_id)
                   VALUES (%s, %s, %s, %s, %s)""",
                (votable_id, uf, candidacy_id, method, run_id),
            )
            report["linked"] += 1
            if method == "contest_number_inserted_in_urn":
                report["resolved_by_inserted_in_urn"] += 1
            elif method == "contest_number_substitution":
                report["resolved_by_substitution"] += 1
        stats = {k: (len(v) if isinstance(v, list) else v) for k, v in report.items()}
        cur.execute(
            _RUN_SUCCEEDED,
            (Jsonb(stats), run_id),
        )
    report["import_batch_id"] = run_id
    return report


def dumps(report: dict[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, indent=2, default=str)
