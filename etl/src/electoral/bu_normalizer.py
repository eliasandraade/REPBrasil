from __future__ import annotations

from typing import Any


class BUNormalizationError(ValueError):
    pass


FASE_CODES = {"simulado": 1, "oficial": 2, "treinamento": 3}
TIPO_URNA_CODES = {
    "secao": 1,
    "contingencia": 3,
    "contingenciaSecao": 4,
    "contingenciaEncerrandoSecao": 6,
}
TIPO_ARQUIVO_CODES = {
    "votacaoUE": 1,
    "votacaoRED": 2,
    "saMistaMRParcialCedula": 3,
    "saMistaBUImpressoCedula": 4,
    "saManual": 5,
    "saEletronica": 6,
}
TIPO_CARGO_CODES = {"majoritario": 1, "proporcional": 2, "consulta": 3}
TIPO_VOTO_CODES = {
    "nominal": 1,
    "branco": 2,
    "nulo": 3,
    "legenda": 4,
    "cargoSemCandidato": 5,
}
CARGO_CONSTITUCIONAL_CODES = {
    "presidente": 1,
    "vicePresidente": 2,
    "governador": 3,
    "viceGovernador": 4,
    "senador": 5,
    "deputadoFederal": 6,
    "deputadoEstadual": 7,
    "deputadoDistrital": 8,
    "primeiroSuplenteSenador": 9,
    "segundoSuplenteSenador": 10,
    "prefeito": 11,
    "vicePrefeito": 12,
    "vereador": 13,
}


def _choice(value: object, *, label: str) -> tuple[str, Any]:
    if not isinstance(value, (tuple, list)) or len(value) != 2:
        raise BUNormalizationError(f"{label} must be an ASN.1 CHOICE pair")
    return str(value[0]), value[1]


def _enum_code(value: object, mapping: dict[str, int], *, label: str) -> int:
    if isinstance(value, bool):
        raise BUNormalizationError(f"{label} must not be boolean")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value in mapping:
        return mapping[value]
    raise BUNormalizationError(f"unknown {label}: {value!r}")


def _required_int(value: object, *, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise BUNormalizationError(f"{label} must be an integer")
    return value


def _pleito_id(header: dict[str, Any]) -> int:
    choice_name, choice_value = _choice(header.get("idEleitoral"), label="cabecalho.idEleitoral")
    if choice_name != "idPleito":
        raise BUNormalizationError(
            f"BU cabecalho.idEleitoral must identify a pleito, got {choice_name!r}"
        )
    return _required_int(choice_value, label="idPleito")


def _office_code(choice_value: object) -> tuple[str, int]:
    choice_name, value = _choice(choice_value, label="codigoCargo")
    if choice_name == "cargoConstitucional":
        return choice_name, _enum_code(
            value,
            CARGO_CONSTITUCIONAL_CODES,
            label="CargoConstitucional",
        )
    if choice_name == "numeroCargoConsultaLivre":
        return choice_name, _required_int(value, label="NumeroCargoConsultaLivre")
    raise BUNormalizationError(f"unknown codigoCargo choice: {choice_name!r}")


def normalize_bu(decoded: dict[str, Any]) -> dict[str, Any]:
    """Convert the official decoded BU structure into JSON-safe Urnaí data.

    Cryptographic hashes/signatures remain in the raw decoded artifact and are
    deliberately excluded from this normalized projection. This function does
    not invent candidate metadata: it preserves only the numeric candidate and
    party identifiers present in the BU itself.
    """

    header = decoded["cabecalho"]
    section = decoded["identificacaoSecao"]
    municipality_zone = section["municipioZona"]
    urna = decoded["urna"]
    correspondence = urna["correspondenciaResultado"]
    carga = correspondence["carga"]

    elections: list[dict[str, Any]] = []
    for election in decoded.get("resultadosVotacaoPorEleicao", []):
        offices: list[dict[str, Any]] = []
        for result in election.get("resultadosVotacao", []):
            office_type = _enum_code(
                result["tipoCargo"],
                TIPO_CARGO_CODES,
                label="TipoCargoConsulta",
            )
            turnout = _required_int(result["qtdComparecimento"], label="qtdComparecimento")
            for office_total in result.get("totaisVotosCargo", []):
                office_kind, office_code = _office_code(office_total["codigoCargo"])
                votes: list[dict[str, Any]] = []
                for vote in office_total.get("votosVotaveis", []):
                    identified = vote.get("identificacaoVotavel")
                    votes.append(
                        {
                            "tipo_voto": _enum_code(
                                vote["tipoVoto"],
                                TIPO_VOTO_CODES,
                                label="TipoVoto",
                            ),
                            "quantidade": _required_int(
                                vote["quantidadeVotos"],
                                label="quantidadeVotos",
                            ),
                            "votavel": (
                                _required_int(identified["codigo"], label="identificacaoVotavel.codigo")
                                if identified is not None
                                else None
                            ),
                            "partido": (
                                _required_int(identified["partido"], label="identificacaoVotavel.partido")
                                if identified is not None
                                else None
                            ),
                            "ordem_hash": _required_int(
                                vote["ordemGeracaoHash"],
                                label="ordemGeracaoHash",
                            ),
                        }
                    )
                offices.append(
                    {
                        "tipo_cargo": office_type,
                        "codigo_cargo_tipo": office_kind,
                        "codigo_cargo": office_code,
                        "ordem_impressao": _required_int(
                            office_total["ordemImpressao"],
                            label="ordemImpressao",
                        ),
                        "comparecimento": turnout,
                        "votos": votes,
                    }
                )
        elections.append(
            {
                "eleicao": _required_int(election["idEleicao"], label="idEleicao"),
                "aptos": _required_int(election["qtdEleitoresAptos"], label="qtdEleitoresAptos"),
                "aptos_secao": _required_int(
                    election["qtdEleitoresAptosSecao"],
                    label="qtdEleitoresAptosSecao",
                ),
                "aptos_tte": _required_int(
                    election["qtdEleitoresAptosTTE"],
                    label="qtdEleitoresAptosTTE",
                ),
                "cargos": offices,
            }
        )

    return {
        "pleito": _pleito_id(header),
        "fase": _enum_code(decoded["fase"], FASE_CODES, label="Fase"),
        "municipio": _required_int(municipality_zone["municipio"], label="municipio"),
        "zona": _required_int(municipality_zone["zona"], label="zona"),
        "local": _required_int(section["local"], label="local"),
        "secao": _required_int(section["secao"], label="secao"),
        "data_hora_emissao": decoded["dataHoraEmissao"],
        "comparecimento": _required_int(
            decoded["qtdEleitoresCompareceram"],
            label="qtdEleitoresCompareceram",
        ),
        "urna": {
            "tipo": _enum_code(urna["tipoUrna"], TIPO_URNA_CODES, label="TipoUrna"),
            "tipo_arquivo": _enum_code(
                urna["tipoArquivo"],
                TIPO_ARQUIVO_CODES,
                label="TipoArquivo",
            ),
            "versao_votacao": urna["versaoVotacao"],
            "numero_interno": _required_int(carga["numeroInternoUrna"], label="numeroInternoUrna"),
            "codigo_carga": carga["codigoCarga"],
        },
        "eleicoes": elections,
    }
