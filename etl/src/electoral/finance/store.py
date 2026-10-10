"""Persistência da prestação de contas em `candidacy_finance_record` (migrations 006 + 008).

- Candidatura: par oficial (SQ_CANDIDATO, CD_ELEICAO) das receitas e despesas contratadas;
  despesas pagas não trazem o SQ e são ligadas pelo prestador de contas (SQ_PRESTADOR_CONTAS)
  das linhas da MESMA versão do arquivo — prestador ambíguo ⇒ sem vínculo (contado).
- Um envio por candidatura: se houver mais de um (final, parcial, relatório…), vale o de maior
  prioridade (`ACCOUNTS_PRIORITY`), depois o turno maior; os demais são contados, nunca somados.
- Documento de doador/fornecedor: HMAC-SHA256 com a mesma chave das pessoas (impressão digital
  conferida); CNPJ em claro só para empresas. CPF nunca é gravado nem registrado em log.
- Eleições suplementares, outra UF e outro ano: contados e ignorados.
- Um arquivo mais novo que altera registros gravados exige `supersede=True` (diff no lote).
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from ..cadaster.store import _record_failure, _source_file_id
from ..candidates import identity
from ..candidates.records import _candidacy_index
from ..candidates.store import SOURCE as CANDIDATES_SOURCE
from .parser import ACCOUNTS_PRIORITY, FinanceRow

SOURCE = "tse-open-data-campaign-finance"
ORDINARY_ELECTION = 2
DIRECTION = {"revenue": "revenue", "expense_contracted": "expense", "expense_paid": "expense"}


class FinanceError(RuntimeError):
    pass


class FinanceConflict(FinanceError):
    def __init__(self, message: str, diff: list[dict[str, Any]]) -> None:
        super().__init__(message)
        self.diff = diff


def _check_key(cur: psycopg.Cursor, key: bytes) -> None:
    cur.execute(
        """SELECT stats->>'key_fingerprint' FROM ingestion_run
            WHERE source = %s AND status = 'succeeded' AND stats ? 'key_fingerprint'
            ORDER BY finished_at DESC LIMIT 1""",
        (CANDIDATES_SOURCE,),
    )
    row = cur.fetchone()
    if row and row[0] != identity.key_fingerprint(key):
        raise FinanceError("REPBRASIL_PERSON_DOCUMENT_KEY differs from the key used by previous imports in this database")


def _submission_rank(r: FinanceRow) -> tuple[int, int, str]:
    return (ACCOUNTS_PRIORITY.get(r.accounts_type or "", 0), r.turn or 0, r.accounts_date or "")


def select_rows(rows: list[FinanceRow], *, year: int, uf: str) -> tuple[dict[tuple[int, int], list[FinanceRow]], dict[str, int]]:
    """Agrupa por candidatura (SQ, CD_ELEICAO) e mantém um único envio de contas por candidatura."""
    counts: dict[str, int] = defaultdict(int)
    provider_to_key: dict[int, set[tuple[int, int]]] = defaultdict(set)
    kept: list[FinanceRow] = []
    for r in rows:
        if r.uf != uf:
            counts["other_uf_rows"] += 1
        elif r.year != year:
            counts["other_year_rows"] += 1
        elif r.election_type_code not in (ORDINARY_ELECTION, None):
            counts["other_election_rows"] += 1
        elif r.amount is None:
            counts["rows_without_amount"] += 1
        else:
            kept.append(r)
            if r.tse_candidate_id is not None and r.election_code is not None:
                provider_to_key[r.provider_id].add((r.tse_candidate_id, r.election_code))

    by_key: dict[tuple[int, int], list[FinanceRow]] = defaultdict(list)
    for r in kept:
        if r.tse_candidate_id is not None and r.election_code is not None:
            by_key[(r.tse_candidate_id, r.election_code)].append(r)
            continue
        keys = provider_to_key.get(r.provider_id, set())
        if len(keys) != 1:
            counts["paid_rows_without_unique_provider"] += 1
            continue
        by_key[next(iter(keys))].append(r)

    selected: dict[tuple[int, int], list[FinanceRow]] = {}
    for key, group in by_key.items():
        submissions: dict[tuple[int, int | None, str | None], list[FinanceRow]] = defaultdict(list)
        for r in group:
            submissions[(r.provider_id, r.turn, r.accounts_type)].append(r)
        best = max(submissions, key=lambda s: _submission_rank(submissions[s][0]))
        for sub, sub_rows in submissions.items():
            if sub != best:
                counts["superseded_submission_rows"] += len(sub_rows)
        selected[key] = submissions[best]
    return selected, dict(counts)


def import_finance(
    conn: psycopg.Connection,
    *,
    year: int,
    uf: str,
    rows: list[FinanceRow],
    manifest: dict[str, Any],
    key: bytes,
    supersede: bool = False,
) -> dict[str, Any]:
    uf = uf.upper()
    scope = {"year": year, "uf": uf, "record_kind": None}
    selected, counts = select_rows(rows, year=year, uf=uf)
    report: dict[str, Any] = {
        "status": "succeeded", "scope": scope, "rows": len(rows), **counts, "candidacies": 0,
        "rows_unmatched": 0, "inserted": 0, "unchanged": 0, "superseded": 0, "duplicate_rows": 0,
        "by_kind": defaultdict(int), "diff": [], "key_fingerprint": identity.key_fingerprint(key),
    }
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                """SELECT count(*) FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = 'candidacy_finance_record'
                      AND column_name IN ('counterparty_kind', 'counterparty_cnpj')"""
            )
            if cur.fetchone()[0] != 2:
                raise FinanceError("electoral schema missing finance columns; apply the EF migration AddXrayDerived")
            _check_key(cur, key)
            source_id = _source_file_id(cur, manifest, year=year, layout=None)
            cur.execute(
                """SELECT id FROM ingestion_run WHERE source = %s AND status = 'succeeded' AND source_file_id = %s
                     AND scope->>'year' = %s AND scope->>'uf' = %s""",
                (SOURCE, source_id, str(year), uf),
            )
            done = cur.fetchone()
            if done:
                return {"status": "already_imported", "scope": scope, "import_batch_id": str(done[0])}
            index = _candidacy_index(cur, year)
            if not index:
                raise FinanceError(f"no candidacies of {year} in the database; import candidates first")
            cur.execute(
                "INSERT INTO ingestion_run (source, scope, status, source_file_id) VALUES (%s, %s, 'running', %s) RETURNING id",
                (SOURCE, Jsonb(scope), source_id),
            )
            run_id = str(cur.fetchone()[0])

            for cand_key, group in selected.items():
                candidacy_id = index.get(cand_key)
                if candidacy_id is None:
                    report["rows_unmatched"] += len(group)
                    continue
                report["candidacies"] += 1
                prepared: dict[str, tuple[FinanceRow, str | None]] = {}
                for r in group:
                    hmac = identity.document_hash(key, r.document_digits) if r.document_digits else None
                    digest = r.content_hash(hmac)
                    if digest in prepared:
                        report["duplicate_rows"] += 1
                        continue
                    prepared[digest] = (r, hmac)
                cur.execute(
                    """SELECT source_row_hash FROM candidacy_finance_record
                        WHERE candidacy_id = %s AND record_kind IN ('revenue', 'expense_contracted', 'expense_paid')""",
                    (candidacy_id,),
                )
                stored = {row[0] for row in cur.fetchall()}
                if stored and stored == set(prepared):
                    report["unchanged"] += 1
                    continue
                if stored:
                    report["diff"].append({"candidacy_id": candidacy_id, "added": len(set(prepared) - stored),
                                           "removed": len(stored - set(prepared))})
                    if not supersede:
                        continue
                    cur.execute(
                        """DELETE FROM candidacy_finance_record
                            WHERE candidacy_id = %s AND record_kind IN ('revenue', 'expense_contracted', 'expense_paid')""",
                        (candidacy_id,),
                    )
                    report["superseded"] += 1
                for digest, (r, hmac) in prepared.items():
                    cur.execute(
                        """INSERT INTO candidacy_finance_record (candidacy_id, record_kind, direction, occurred_on, amount,
                                                                 category, description, counterparty_name,
                                                                 counterparty_document_hash, counterparty_kind,
                                                                 counterparty_cnpj, payload, source_file_id, ingestion_run_id,
                                                                 source_member, source_line, source_row_hash, source_generated_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL)
                           ON CONFLICT (candidacy_id, record_kind, source_row_hash) DO NOTHING""",
                        (candidacy_id, r.kind, DIRECTION[r.kind], r.occurred_on, r.amount, r.category, r.description,
                         r.counterparty_name, hmac, r.counterparty_kind, r.counterparty_cnpj,
                         Jsonb({**r.payload, "record_id": r.record_id}), source_id, run_id, r.member, r.line, digest),
                    )
                    report["inserted"] += cur.rowcount
                    report["by_kind"][r.kind] += cur.rowcount
            if report["diff"] and not supersede:
                raise FinanceConflict(
                    f"{len(report['diff'])} candidacies have finance records that differ from this official file; rerun with --supersede",
                    report["diff"],
                )
            report["by_kind"] = dict(report["by_kind"])
            stats = {k: v for k, v in report.items() if k != "diff"} | {"diff_count": len(report["diff"])}
            cur.execute(
                "UPDATE ingestion_run SET status = 'succeeded', finished_at = now(), stats = %s WHERE id = %s",
                (Jsonb(stats), run_id),
            )
            report["import_batch_id"] = run_id
            return report
    except FinanceError as exc:
        _record_failure(conn, SOURCE, scope, str(exc))
        raise
