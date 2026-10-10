"""Identidade humana a partir do CPF publicado pelo TSE — sem guardar o CPF.

O CPF tem só ~10⁹ valores possíveis: um SHA-256 puro seria revertido por
enumeração em minutos. Por isso `Persons.NormalizedDocumentHash` recebe um
HMAC-SHA256 com chave secreta (`REPBRASIL_PERSON_DOCUMENT_KEY`), estável por
ambiente. Sem a chave não há resolução de identidade (erro explícito); o CPF
nunca é gravado, registrado em log ou exposto pela API.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from dataclasses import dataclass

DOCUMENT_KEY_ENV = "REPBRASIL_PERSON_DOCUMENT_KEY"
MIN_KEY_BYTES = 32
IDENTITY_METHOD = "cpf_hmac_sha256"

RESOLVED = "resolved"
UNAVAILABLE = "unresolved_document_unavailable"
INVALID = "unresolved_document_invalid"
# Sem CPF utilizável: pessoa provada por relação OFICIAL entre SQ_CANDIDATO (histórico de
# candidaturas do TSE ou perfil cujo TseId é o próprio SQ e já pertence a uma pessoa).
TSE_LINK = "resolved_tse_link"


class IdentityKeyMissing(RuntimeError):
    """Chave HMAC ausente ou curta demais: a resolução de identidade não pode rodar."""


@dataclass(frozen=True)
class DocumentCheck:
    status: str  # RESOLVED | UNAVAILABLE | INVALID
    digits: str | None = None

    def __repr__(self) -> str:  # nunca expor o documento em logs/reprs
        return f"DocumentCheck(status={self.status!r})"


def _cpf_check_digits_ok(digits: str) -> bool:
    if len(set(digits)) == 1:
        return False
    for size in (9, 10):
        total = sum(int(d) * w for d, w in zip(digits[:size], range(size + 1, 1, -1), strict=True))
        check = (total * 10) % 11 % 10
        if check != int(digits[size]):
            return False
    return True


def check_cpf(raw: str) -> DocumentCheck:
    """Classifica o CPF publicado. Sentinelas do TSE (-4, NÃO DIVULGÁVEL…) ⇒ indisponível."""
    value = (raw or "").strip()
    if not value or value.startswith("-") or not any(c.isdigit() for c in value):
        return DocumentCheck(UNAVAILABLE)
    if not value.isdigit() or len(value) != 11 or not _cpf_check_digits_ok(value):
        return DocumentCheck(INVALID)
    return DocumentCheck(RESOLVED, value)


def load_key(environ: dict[str, str] | None = None) -> bytes:
    env = os.environ if environ is None else environ
    raw = env.get(DOCUMENT_KEY_ENV, "")
    key = raw.encode("utf-8")
    if len(key) < MIN_KEY_BYTES:
        raise IdentityKeyMissing(
            f"{DOCUMENT_KEY_ENV} must hold a secret of at least {MIN_KEY_BYTES} bytes; "
            "identity resolution never falls back to an unkeyed hash"
        )
    return key


KEY_CHECK_MESSAGE = b"repbrasil:person-document-key:check:v1"


def key_fingerprint(key: bytes) -> str:
    """Impressão digital pública da chave (HMAC de uma constante, 16 hex): detecta troca de chave
    entre importações sem revelar o segredo nem permitir verificar CPFs."""
    return hmac.new(key, KEY_CHECK_MESSAGE, hashlib.sha256).hexdigest()[:16]


def document_hash(key: bytes, digits: str) -> str:
    """HMAC-SHA256 hexadecimal do CPF normalizado (apenas dígitos)."""
    return hmac.new(key, digits.encode("ascii"), hashlib.sha256).hexdigest()
