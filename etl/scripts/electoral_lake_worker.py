from __future__ import annotations

import hmac
import json
import os
import socket
import ssl
import sys
from collections.abc import Iterable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.electoral import db as electoral_db  # noqa: E402
from src.electoral.lake import LakeError, lake_root_from_env  # noqa: E402
from src.electoral.lake_query import (  # noqa: E402
    candidacy_votes_by_result,
    result_votes,
    section_contest_stats,
    valid_votes_by_result,
)
from src.electoral.lake_result_query import result_votes_from_archive, section_results  # noqa: E402
from src.electoral.lake_tls import issue_certificate, load_certificate  # noqa: E402

MAX_BODY_BYTES = 2 * 1024 * 1024
CONTEST_STATS_LEVELS = ("section", "place")
CONNECTION_TIMEOUT_SECONDS = 15
TLS_HANDSHAKE_RECORD = b"\x16"


def _level(value: object) -> str:
    for level in CONTEST_STATS_LEVELS:
        if value == level:
            return level
    raise ValueError(f"level must be one of {CONTEST_STATS_LEVELS}")


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def _required_token() -> str:
    token = os.environ.get("REPBRASIL_LAKE_TOKEN", "").strip()
    if not token:
        raise SystemExit("REPBRASIL_LAKE_TOKEN is required")
    return token


def _private_bind_host() -> str:
    private_domain = os.environ.get("RAILWAY_PRIVATE_DOMAIN", "").strip().lower()
    public_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if private_domain.endswith(".railway.internal") and not public_domain:
        return "0.0.0.0"
    if os.environ.get("REPBRASIL_LAKE_LOCAL_ONLY") == "1":
        return "127.0.0.1"
    raise SystemExit(
        "electoral lake worker requires Railway private networking with no public domain"
    )


def _tls_hostnames() -> list[str]:
    private_domain = os.environ.get("RAILWAY_PRIVATE_DOMAIN", "").strip().lower()
    return [name for name in (private_domain, "localhost") if name]


class PrivateLakeServer(ThreadingHTTPServer):
    """Todo RPC trafega em TLS. Em texto claro só existe o probe de saúde da plataforma.

    O healthcheck do Railway fala HTTP simples com a PORT do serviço; ele recebe uma resposta
    constante, sem dados nem credenciais. Qualquer outra requisição sem TLS recebe 426 e a conexão
    é encerrada sem que o corpo seja lido ou processado.
    """

    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
        *,
        tls: ssl.SSLContext,
    ) -> None:
        self.tls_context = tls
        self.certificate_pem = b""
        super().__init__(address, handler)

    def finish_request(self, request: socket.socket, client_address: Any) -> None:
        request.settimeout(CONNECTION_TIMEOUT_SECONDS)
        try:
            first = request.recv(1, socket.MSG_PEEK)
        except OSError:
            return
        if not first:
            return
        if first != TLS_HANDSHAKE_RECORD:
            PlaintextProbeHandler(request, client_address, self)
            return
        try:
            secure = self.tls_context.wrap_socket(request, server_side=True)
        except (ssl.SSLError, OSError) as exc:
            print(f"lake-rpc tls handshake refused: {type(exc).__name__}", flush=True)
            return
        with secure:
            try:
                self.RequestHandlerClass(secure, client_address, self)
            except (ssl.SSLError, ConnectionError) as exc:
                # No TLS 1.3 o cliente que recusa o certificado alerta já dentro da sessão.
                print(f"lake-rpc tls session aborted by peer: {type(exc).__name__}", flush=True)


class PlaintextProbeHandler(BaseHTTPRequestHandler):
    server_version = "REPBrasilElectoralLake/5"
    timeout = CONNECTION_TIMEOUT_SECONDS

    def log_message(self, format: str, *args: Any) -> None:
        print(f"lake-probe {self.address_string()} {format % args}", flush=True)

    def _reply(self, status: int, body: Any) -> None:
        payload = _json_bytes(body)
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._reply(HTTPStatus.OK, {"status": "ok"})
            return
        self._reply(HTTPStatus.UPGRADE_REQUIRED, {"error": "tls_required"})

    def do_POST(self) -> None:
        self._reply(HTTPStatus.UPGRADE_REQUIRED, {"error": "tls_required"})


class Handler(BaseHTTPRequestHandler):
    server_version = "REPBrasilElectoralLake/5"
    timeout = CONNECTION_TIMEOUT_SECONDS
    auth_token = ""

    def log_message(self, format: str, *args: Any) -> None:
        print(f"lake-rpc {self.address_string()} {format % args}", flush=True)

    def _reply(self, status: int, body: Any) -> None:
        payload = _json_bytes(body)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "").encode("utf-8", "surrogateescape")
        expected = f"Bearer {self.auth_token}".encode()
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
            self._reply(HTTPStatus.OK, {"status": "ok", "storage": "parquet", "schema": 4})
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
        except Exception as exc:
            print(f"lake-rpc error: {type(exc).__name__}: {exc}", flush=True)
            self._reply(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal_error"})


def build_server(
    address: tuple[str, int], token: str, hostnames: Iterable[str]
) -> PrivateLakeServer:
    """Servidor TLS 1.2+ com certificado efêmero vinculado ao token (src/electoral/lake_tls.py)."""
    Handler.auth_token = token
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    certificate = issue_certificate(token, hostnames)
    load_certificate(context, certificate)
    server = PrivateLakeServer(address, Handler, tls=context)
    server.certificate_pem = certificate.certificate_pem
    return server


def main() -> int:
    port = int(os.environ.get("PORT", "8080"))
    server = build_server((_private_bind_host(), port), _required_token(), _tls_hostnames())
    print(f"electoral lake worker listening on private TLS transport :{port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
