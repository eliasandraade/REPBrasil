from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
from typing import Any

import asn1tools


OFFICIAL_2026_SCHEMA_BUNDLE_SHA256 = "b5ac413e81121d53de2bb1657af611f84a45fdc84388e9d9821872994bbfbafd"
OFFICIAL_2026_BU_SCHEMA_SHA256 = "ef64bf723f774403b423ed0b617f5a83a3f50c0023d0003e18cd29170404ab81"
BU_ENVELOPE_ROOT_TYPE = "EntidadeEnvelopeGenerico"
BU_CONTENT_ROOT_TYPE = "EntidadeBoletimUrna"


class BUParserError(ValueError):
    pass


class BUEncryptedError(BUParserError):
    pass


@dataclass(frozen=True)
class DecodedBU:
    envelope: dict[str, Any]
    bu: dict[str, Any]


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _is_bu_envelope(value: object) -> bool:
    return value == 1 or value == "envelopeBoletimUrna"


class BUParser:
    """Decoder for the official TSE 2026 BU BER format.

    The official 2026 package reviewed on 2026-10-07 documents a two-stage
    decode: ``EntidadeEnvelopeGenerico`` for the outer BER envelope and
    ``EntidadeBoletimUrna`` for the OCTET STRING stored in ``conteudo``.

    By default the parser only accepts the exact reviewed ``spec/bu.asn1``
    content hash. If TSE republishes the schema, the new version must be
    reviewed and this lock intentionally updated before production decoding.
    """

    def __init__(
        self,
        schema_path: Path,
        *,
        verify_official_2026_schema: bool = True,
        numeric_enums: bool = True,
    ):
        self.schema_path = Path(schema_path)
        self.schema_sha256 = _sha256_file(self.schema_path)
        if verify_official_2026_schema and self.schema_sha256 != OFFICIAL_2026_BU_SCHEMA_SHA256:
            raise BUParserError(
                "BU schema hash does not match the reviewed official TSE 2026 spec/bu.asn1; "
                f"expected {OFFICIAL_2026_BU_SCHEMA_SHA256}, got {self.schema_sha256}"
            )
        self.codec = asn1tools.compile_files(
            str(self.schema_path),
            codec="ber",
            numeric_enums=numeric_enums,
        )

    def decode_raw(self, bu_path: Path, *, root_type: str):
        payload = Path(bu_path).read_bytes()
        return self.codec.decode(root_type, payload)

    def decode_envelope(self, bu_path: Path) -> dict[str, Any]:
        payload = Path(bu_path).read_bytes()
        envelope = self.codec.decode(BU_ENVELOPE_ROOT_TYPE, payload)
        if not isinstance(envelope, dict):
            raise BUParserError("decoded BU envelope is not a mapping")
        self._validate_bu_envelope(envelope)
        return envelope

    def decode_full(self, bu_path: Path) -> DecodedBU:
        envelope = self.decode_envelope(bu_path)
        content = envelope["conteudo"]
        bu = self.codec.decode(BU_CONTENT_ROOT_TYPE, bytes(content))
        if not isinstance(bu, dict):
            raise BUParserError("decoded BU content is not a mapping")
        return DecodedBU(envelope=envelope, bu=bu)

    def decode(self, bu_path: Path) -> dict[str, Any]:
        return self.decode_full(bu_path).bu

    @staticmethod
    def _validate_bu_envelope(envelope: dict[str, Any]) -> None:
        if not _is_bu_envelope(envelope.get("tipoEnvelope")):
            raise BUParserError(
                "artifact is not a BU envelope; expected TipoEnvelope.envelopeBoletimUrna"
            )
        if envelope.get("seguranca") is not None:
            raise BUEncryptedError(
                "BU envelope declares security/encryption metadata; encrypted content is not decoded automatically"
            )
        if envelope.get("urna") is not None:
            raise BUParserError(
                "official BU envelope must omit the outer urna field; it is reserved for other envelope types"
            )
        content = envelope.get("conteudo")
        if not isinstance(content, (bytes, bytearray)):
            raise BUParserError("BU envelope conteudo must be an OCTET STRING")
