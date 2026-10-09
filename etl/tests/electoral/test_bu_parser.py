from pathlib import Path

import pytest

from urnai_ingest.bu_parser import (
    BU_CONTENT_ROOT_TYPE,
    BU_ENVELOPE_ROOT_TYPE,
    BUEncryptedError,
    BUParser,
    BUParserError,
)


class FakeCodec:
    def __init__(self, envelope, bu=None):
        self.envelope = envelope
        self.bu = bu if bu is not None else {"decoded": True}
        self.calls = []

    def decode(self, root_type, payload):
        self.calls.append((root_type, bytes(payload)))
        if root_type == BU_ENVELOPE_ROOT_TYPE:
            return self.envelope
        if root_type == BU_CONTENT_ROOT_TYPE:
            return self.bu
        raise AssertionError(root_type)


def parser_with(codec):
    parser = object.__new__(BUParser)
    parser.codec = codec
    parser.schema_path = Path("official-bu.asn1")
    parser.schema_sha256 = "test"
    return parser


def write_payload(tmp_path):
    path = tmp_path / "section-bu.dat"
    path.write_bytes(b"outer-ber")
    return path


def valid_envelope(**overrides):
    envelope = {
        "cabecalho": {},
        "fase": 2,
        "identificacao": ("identificacaoSecaoEleitoral", {}),
        "tipoEnvelope": 1,
        "conteudo": b"inner-ber",
    }
    envelope.update(overrides)
    return envelope


def test_constructor_rejects_unreviewed_schema_before_compilation(tmp_path):
    schema = tmp_path / "bu.asn1"
    schema.write_text("ModuloFalso DEFINITIONS ::= BEGIN END", encoding="utf-8")

    with pytest.raises(BUParserError, match="schema hash does not match"):
        BUParser(schema)


def test_decode_uses_official_outer_and_inner_roots(tmp_path):
    codec = FakeCodec(valid_envelope(), {"cabecalho": {"ok": True}})
    parser = parser_with(codec)

    decoded = parser.decode_full(write_payload(tmp_path))

    assert decoded.bu == {"cabecalho": {"ok": True}}
    assert decoded.envelope["tipoEnvelope"] == 1
    assert codec.calls == [
        (BU_ENVELOPE_ROOT_TYPE, b"outer-ber"),
        (BU_CONTENT_ROOT_TYPE, b"inner-ber"),
    ]


def test_decode_accepts_named_enum_when_numeric_enums_are_disabled(tmp_path):
    codec = FakeCodec(valid_envelope(tipoEnvelope="envelopeBoletimUrna"))
    parser = parser_with(codec)

    assert parser.decode(write_payload(tmp_path)) == {"decoded": True}


def test_decode_rejects_printed_bu_image_envelope(tmp_path):
    codec = FakeCodec(valid_envelope(tipoEnvelope=4))
    parser = parser_with(codec)

    with pytest.raises(BUParserError, match="not a BU envelope"):
        parser.decode(write_payload(tmp_path))


def test_decode_rejects_encrypted_content(tmp_path):
    codec = FakeCodec(valid_envelope(seguranca={"idTipoArquivo": 1}))
    parser = parser_with(codec)

    with pytest.raises(BUEncryptedError, match="encryption"):
        parser.decode(write_payload(tmp_path))


def test_decode_rejects_outer_urna_field_for_bu(tmp_path):
    codec = FakeCodec(valid_envelope(urna={"unexpected": True}))
    parser = parser_with(codec)

    with pytest.raises(BUParserError, match="must omit the outer urna"):
        parser.decode(write_payload(tmp_path))


def test_decode_rejects_non_octet_content(tmp_path):
    codec = FakeCodec(valid_envelope(conteudo="not-bytes"))
    parser = parser_with(codec)

    with pytest.raises(BUParserError, match="OCTET STRING"):
        parser.decode(write_payload(tmp_path))
