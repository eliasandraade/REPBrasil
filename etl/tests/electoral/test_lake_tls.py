from __future__ import annotations

import importlib.util
import json
import socket
import ssl
import threading
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from src.electoral.lake_tls import is_bound_to_token, issue_certificate

ETL_ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ETL_ROOT / "tests" / "electoral" / "fixtures" / "lake-tls" / "token-bound-certificate.pem"
# Segredo FICTÍCIO do fixture compartilhado com o teste .NET (ElectoralLakeTransportTests).
FIXTURE_TOKEN = "ci-only-fictitious-lake-tls-fixture-token"
TOKEN = "ci-only-fictitious-lake-token"


def _der(pem: bytes) -> bytes:
    return x509.load_pem_x509_certificate(pem).public_bytes(serialization.Encoding.DER)


def test_certificate_is_bound_to_the_shared_token() -> None:
    issued = issue_certificate(TOKEN, ["electoral-lake.railway.internal", "localhost"])
    certificate = x509.load_pem_x509_certificate(issued.certificate_pem)

    assert is_bound_to_token(_der(issued.certificate_pem), TOKEN)
    assert not certificate.extensions.get_extension_for_class(x509.SubjectKeyIdentifier).critical
    names = certificate.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert names.get_values_for_type(x509.DNSName) == ["electoral-lake.railway.internal", "localhost"]


def test_certificate_bound_to_another_token_is_refused() -> None:
    issued = issue_certificate(TOKEN, ["localhost"])
    assert not is_bound_to_token(_der(issued.certificate_pem), "another-token")
    assert not is_bound_to_token(_der(issued.certificate_pem), "")


def test_each_start_uses_a_fresh_key() -> None:
    first = x509.load_pem_x509_certificate(issue_certificate(TOKEN, ["localhost"]).certificate_pem)
    second = x509.load_pem_x509_certificate(issue_certificate(TOKEN, ["localhost"]).certificate_pem)
    assert first.public_key() != second.public_key()


@pytest.mark.parametrize("standard_key_identifier", [False, True])
def test_certificate_without_token_binding_is_refused(standard_key_identifier: bool) -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "impostor")])
    now = datetime.now(UTC)
    builder = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
    )
    if standard_key_identifier:
        identifier = x509.SubjectKeyIdentifier.from_public_key(key.public_key())
        builder = builder.add_extension(identifier, critical=False)
    certificate = builder.sign(key, hashes.SHA256())
    assert not is_bound_to_token(certificate.public_bytes(serialization.Encoding.DER), TOKEN)


def test_shared_fixture_satisfies_the_cross_language_contract() -> None:
    """O mesmo PEM é aceito pelo cliente .NET; os dois lados concordam sobre rótulo, OID e SPKI."""
    der = _der(FIXTURE.read_bytes())
    assert is_bound_to_token(der, FIXTURE_TOKEN)
    assert not is_bound_to_token(der, TOKEN)


def _load_worker():
    path = ETL_ROOT / "scripts" / "electoral_lake_worker.py"
    spec = importlib.util.spec_from_file_location("repbrasil_test_lake_worker_tls", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def worker() -> Iterator[object]:
    module = _load_worker()
    server = module.build_server(("127.0.0.1", 0), TOKEN, ["localhost"])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _read_response(connection: socket.socket) -> tuple[int, dict[str, object]]:
    chunks = []
    while chunk := connection.recv(65536):
        chunks.append(chunk)
    head, _, body = b"".join(chunks).partition(b"\r\n\r\n")
    status = int(head.split(b" ", 2)[1])
    return status, json.loads(body)


def _tls(server, request: bytes) -> tuple[int, dict[str, object], bytes]:
    context = ssl.create_default_context(cadata=server.certificate_pem.decode("ascii"))
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    address = server.server_address[:2]
    with socket.create_connection(address, timeout=5) as raw:
        with context.wrap_socket(raw, server_hostname="localhost") as secure:
            peer = secure.getpeercert(binary_form=True)
            secure.sendall(request)
            status, body = _read_response(secure)
    return status, body, peer


def _plain(server, request: bytes) -> tuple[int, dict[str, object]]:
    with socket.create_connection(server.server_address[:2], timeout=5) as raw:
        raw.sendall(request)
        return _read_response(raw)


def test_rpc_health_travels_over_tls_with_a_token_bound_certificate(worker) -> None:
    status, body, peer = _tls(worker, b"GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n")
    assert status == 200
    assert body == {"status": "ok", "storage": "parquet", "schema": 4}
    assert is_bound_to_token(peer, TOKEN)


def test_rpc_over_tls_still_requires_the_bearer_token(worker) -> None:
    request = b"POST /v1/result-votes HTTP/1.0\r\nContent-Length: 2\r\n\r\n{}"
    status, body, _ = _tls(worker, request)
    assert (status, body) == (401, {"error": "unauthorized"})


def test_platform_probe_is_the_only_plaintext_answer(worker) -> None:
    assert _plain(worker, b"GET /health HTTP/1.0\r\nHost: healthcheck.railway.app\r\n\r\n") == (
        200,
        {"status": "ok"},
    )


@pytest.mark.parametrize(
    "request_bytes",
    [
        b"POST /v1/result-votes HTTP/1.0\r\nAuthorization: Bearer x\r\nContent-Length: 2\r\n\r\n{}",
        b"GET /v1/result-votes HTTP/1.0\r\n\r\n",
        b"GET /health/ HTTP/1.0\r\n\r\n",
    ],
)
def test_plaintext_rpc_is_refused_with_upgrade_required(worker, request_bytes: bytes) -> None:
    assert _plain(worker, request_bytes) == (426, {"error": "tls_required"})


def _closed_or_alert(connection: socket.socket) -> bool:
    try:
        reply = connection.recv(4096)
    except ConnectionResetError:
        return True
    return reply == b"" or reply.startswith(b"\x15")


def _drains_to_close(connection: socket.socket) -> bool:
    """Lê (ex.: NewSessionTicket do TLS 1.3) até o servidor encerrar a conexão."""
    try:
        while connection.recv(65536):
            pass
    except ConnectionResetError:
        pass
    return True


def test_a_session_aborted_after_the_handshake_is_logged_without_traceback(worker, capfd) -> None:
    """Como o cliente .NET que recusa o certificado: o handshake termina e a sessão é abortada."""
    context = ssl.create_default_context(cadata=worker.certificate_pem.decode("ascii"))
    incoming, outgoing = ssl.MemoryBIO(), ssl.MemoryBIO()
    session = context.wrap_bio(incoming, outgoing, server_hostname="localhost")
    with socket.create_connection(worker.server_address[:2], timeout=5) as raw:
        while True:
            try:
                session.do_handshake()
                break
            except ssl.SSLWantReadError:
                raw.sendall(outgoing.read())
                incoming.write(raw.recv(65536))
        raw.sendall(outgoing.read())
        raw.sendall(b"\x17\x03\x03\x00\x10" + bytes(16))  # registro que não decifra
        assert _drains_to_close(raw)

    status, _, _ = _tls(worker, b"GET /health HTTP/1.0\r\n\r\n")
    assert status == 200
    captured = capfd.readouterr()
    assert "Traceback" not in captured.err
    assert "lake-rpc tls session aborted by peer" in captured.out


def test_a_failed_handshake_does_not_stop_the_worker(worker) -> None:
    with socket.create_connection(worker.server_address[:2], timeout=5) as raw:
        raw.sendall(b"\x16\x03\x01\x00\x05hello")
        assert _closed_or_alert(raw)
    status, _, _ = _tls(worker, b"GET /health HTTP/1.0\r\n\r\n")
    assert status == 200
