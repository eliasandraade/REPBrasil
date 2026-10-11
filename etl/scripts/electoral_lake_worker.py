from __future__ import annotations

import hmac
import json
import os
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.electoral import db as electoral_db
from src.electoral.lake import LakeError, lake_root_from_env
from src.electoral.lake_query import (
    candidacy_votes_by_result,
    result_votes,
    section_contest_stats,
    valid_votes_by_result,
)
from src.electoral.lake_result_query import result_votes_from_archive, section_results

MAX_BODY_BYTES = 2 * 1024 * 1024
CONTEST_STATS_LEVELS = ("section", "place")


def _level(value: object) -> str:
    """Nível da estatística da disputa no lake: só seção ou local de votação."""
    for level in CONTEST_STATS_LEVELS:
        if value == level:
            return level
    raise ValueError(f"level must be one of {CONTEST_STATS_LEVELS}")


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "REPBrasilElectoralLake/2"

    def log_message(self, format: str, *args: Any) -> None:
        print(f"lake-http {self.address_string()} {format % args}", flush=True)

    def _reply(self, status: int, body: Any) -> None:
        payload = _json_bytes(body)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _authorized(self) -> bool:
        token = os.environ.get("REPBRASIL_LAKE_TOKEN")
        if not token:
            return True
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {token}"
        return hmac.compare_digest(supplied, expected)

    def _read_json(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ValueError("Content-Length is required")
        length = int(raw_length)
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("request body too large")
        payload = json.loads(self.rfile.read(length))
        if not isinstance(payload, dict):
            raise ValueError("JSON object required")
        return payload

    def do_GET(self) -> None:
        if self.path == "/health":
            self._reply(HTTPStatus.OK, {"status": "ok", "storage": "parquet", "schema": 2})
            return
        self._reply(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:
        if not self._authorized():
            self._reply(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return
        try:
            body = self._read_json()
            database_url = os.environ.get("DATABASE_URL")
            if not database_url:
                raise RuntimeError("DATABASE_URL is required")
            root = lake_root_from_env().resolve()
            with electoral_db.connect(database_url) as conn:
                conn.read_only = True
                if self.path == "/v1/section-results":
                    result = section_results(
                        conn,
                        root,
                        scopes=list(body.get("scopes", [])),
                        uf=str(body["uf"]),
                        municipality_tse_code=str(body["municipalityTseCode"]),
                        zone=int(body["zone"]) if body.get("zone") is not None else None,
                    )
                elif self.path == "/v1/valid-votes":
                    result = valid_votes_by_result(
                        conn,
                        root,
                        year=int(body["year"]),
                        turn=int(body["round"]),
                        uf=str(body["uf"]),
                        municipality_tse_code=str(body["municipalityTseCode"]),
                        office_codes=[int(value) for value in body.get("officeCodes", [])],
                        zone=int(body["zone"]) if body.get("zone") is not None else None,
                    )
                elif self.path == "/v1/candidacy-votes":
                    result = candidacy_votes_by_result(
                        conn,
                        root,
                        candidacy_ids=[str(value) for value in body.get("candidacyIds", [])],
                        scopes=list(body.get("scopes", [])),
                        uf=str(body["uf"]),
                        municipality_tse_code=str(body["municipalityTseCode"]),
                        zone=int(body["zone"]) if body.get("zone") is not None else None,
                    )
                elif self.path == "/v1/section-contest-stats":
                    result = section_contest_stats(
                        conn,
                        root,
                        candidacy_id=str(body["candidacyId"]),
                        year=int(body["year"]),
                        turn=int(body["round"]),
                        election_code=int(body["electionCode"]),
                        office_code=int(body["officeCode"]),
                        uf=str(body["uf"]),
                        municipality_tse_code=str(body["municipalityTseCode"]),
                        zone=int(body["zone"]) if body.get("zone") is not None else None,
                        level=_level(body.get("level", "section")),
                    )
                elif self.path == "/v1/result-votes":
                    result_id = int(body["resultId"])
                    uf = str(body["uf"])
                    result = result_votes(conn, root, result_id=result_id, uf=uf)
                    if not result:
                        result = result_votes_from_archive(conn, root, result_id=result_id, uf=uf)
                else:
                    self._reply(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                    return
            self._reply(HTTPStatus.OK, result)
        except (KeyError, TypeError, ValueError, LakeError) as exc:
            self._reply(HTTPStatus.BAD_REQUEST, {"error": "invalid_request", "message": str(exc)})
        except Exception as exc:  # noqa: BLE001
            print(f"lake-http error: {type(exc).__name__}: {exc}", flush=True)
            self._reply(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal_error"})


def main() -> int:
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"electoral lake worker listening on :{port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
