"""TLS do RPC privado do lake eleitoral (worker Python ↔ API .NET).

A cada início o worker gera uma chave EC P-256 efêmera e um certificado autoassinado. A confiança
não vem de uma CA: o Subject Key Identifier do certificado (RFC 5280 §4.2.1.2 admite outros métodos
além do SHA-1 da chave) é

    HMAC-SHA256(REPBRASIL_LAKE_TOKEN, BINDING_LABEL || SubjectPublicKeyInfo DER)

e o cliente .NET, que conhece o mesmo segredo, só conclui o handshake se o HMAC da chave pública
apresentada conferir. Quem não conhece o token não consegue se passar pelo worker; não há arquivo de
certificado para distribuir nem variável de ambiente nova.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import ssl
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

BINDING_LABEL = b"repbrasil-electoral-lake-tls/v1\x00"
CERTIFICATE_LIFETIME = timedelta(days=825)
_COMMON_NAME = "repbrasil-electoral-lake"


@dataclass(frozen=True)
class IssuedCertificate:
    certificate_pem: bytes
    private_key_pem: bytes


def subject_public_key_info(public_key: ec.EllipticCurvePublicKey) -> bytes:
    return public_key.public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )


def token_binding(token: str, spki_der: bytes) -> bytes:
    if not token:
        raise ValueError("the shared lake token is required to bind the TLS certificate")
    return hmac.new(token.encode("utf-8"), BINDING_LABEL + spki_der, hashlib.sha256).digest()


def issue_certificate(
    token: str, hostnames: Iterable[str], *, now: datetime | None = None
) -> IssuedCertificate:
    """Certificado autoassinado efêmero cuja chave pública fica vinculada ao token compartilhado."""
    key = ec.generate_private_key(ec.SECP256R1())
    binding = token_binding(token, subject_public_key_info(key.public_key()))
    issued_at = (now or datetime.now(UTC)) - timedelta(minutes=5)
    dns_names = sorted({name.strip().lower() for name in hostnames if name and name.strip()})
    alternative_names: list[x509.GeneralName] = [x509.DNSName(name) for name in dns_names]
    alternative_names.append(x509.IPAddress(ipaddress.ip_address("127.0.0.1")))
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, _COMMON_NAME)])
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(issued_at)
        .not_valid_after(issued_at + CERTIFICATE_LIFETIME)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectAlternativeName(alternative_names), critical=False)
        .add_extension(x509.SubjectKeyIdentifier(binding), critical=False)
        .sign(key, hashes.SHA256())
    )
    return IssuedCertificate(
        certificate_pem=certificate.public_bytes(serialization.Encoding.PEM),
        private_key_pem=key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
    )


def is_bound_to_token(certificate_der: bytes, token: str) -> bool:
    """Mesma verificação feita pelo cliente .NET (usada nos testes de contrato)."""
    if not token:
        return False
    certificate = x509.load_der_x509_certificate(certificate_der)
    try:
        identifier = certificate.extensions.get_extension_for_class(x509.SubjectKeyIdentifier)
    except x509.ExtensionNotFound:
        return False
    public_key = certificate.public_key()
    if not isinstance(public_key, ec.EllipticCurvePublicKey):
        return False
    expected = token_binding(token, subject_public_key_info(public_key))
    return hmac.compare_digest(identifier.value.digest, expected)


def load_certificate(context: ssl.SSLContext, issued: IssuedCertificate) -> None:
    """Carrega o par no contexto TLS; os PEM passam só por um diretório temporário privado."""
    with tempfile.TemporaryDirectory(prefix="repbrasil-lake-tls-") as directory:
        certificate_path = Path(directory) / "certificate.pem"
        key_path = Path(directory) / "private-key.pem"
        certificate_path.write_bytes(issued.certificate_pem)
        descriptor = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(issued.private_key_pem)
        context.load_cert_chain(certificate_path, key_path)
