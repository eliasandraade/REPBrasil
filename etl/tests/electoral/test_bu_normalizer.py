import pytest

from src.electoral.bu_normalizer import BUNormalizationError, normalize_bu


def decoded_bu():
    return {
        "cabecalho": {
            "dataGeracao": "20261004T180000",
            "idEleitoral": ("idPleito", 3220),
        },
        "fase": 2,
        "urna": {
            "tipoUrna": 1,
            "versaoVotacao": "10.23.0.0",
            "correspondenciaResultado": {
                "identificacao": ("identificacaoSecaoEleitoral", {}),
                "carga": {
                    "numeroInternoUrna": 2031648,
                    "numeroSerieFC": b"\x00\x00\x00\x01",
                    "identificadorGeradorMidia": {
                        "nome": "gerador",
                        "serialCertificadoTPM": "0",
                        "serialInstalacao": "0",
                    },
                    "dataHoraCarga": "20261004T170000",
                    "codigoCarga": "226921764068436623652154",
                },
            },
            "tipoArquivo": 1,
            "numeroSerieFV": b"\x00\x00\x00\x02",
        },
        "identificacaoSecao": {
            "municipioZona": {"municipio": 13935, "zona": 50},
            "local": 1066,
            "secao": 29,
        },
        "dataHoraEmissao": "20261004T180500",
        "dadosSecaoSA": (
            "dadosSecao",
            {
                "dataHoraAbertura": "20261004T080000",
                "dataHoraEncerramento": "20261004T170000",
            },
        ),
        "qtdEleitoresCompareceram": 200,
        "resultadosVotacaoPorEleicao": [
            {
                "idEleicao": 6257,
                "qtdEleitoresAptos": 225,
                "qtdEleitoresAptosSecao": 220,
                "qtdEleitoresAptosTTE": 5,
                "resultadosVotacao": [
                    {
                        "tipoCargo": 1,
                        "qtdComparecimento": 200,
                        "totaisVotosCargo": [
                            {
                                "codigoCargo": ("cargoConstitucional", 1),
                                "ordemImpressao": 1,
                                "votosVotaveis": [
                                    {
                                        "tipoVoto": 1,
                                        "quantidadeVotos": 120,
                                        "identificacaoVotavel": {"partido": 55, "codigo": 55},
                                        "ordemGeracaoHash": 1,
                                        "hash": b"hash-1",
                                    },
                                    {
                                        "tipoVoto": 2,
                                        "quantidadeVotos": 5,
                                        "ordemGeracaoHash": 2,
                                        "hash": b"hash-2",
                                    },
                                    {
                                        "tipoVoto": 3,
                                        "quantidadeVotos": 10,
                                        "ordemGeracaoHash": 3,
                                        "hash": b"hash-3",
                                    },
                                ],
                            }
                        ],
                    }
                ],
                "ultimoHashVotosVotavel": b"final-hash",
                "assinaturaUltimoHashVotosVotavel": b"signature",
            }
        ],
        "historicoCodigosCarga": [],
    }


def test_normalizes_identity_urna_and_election_totals():
    normalized = normalize_bu(decoded_bu())

    assert normalized["pleito"] == 3220
    assert normalized["fase"] == 2
    assert normalized["municipio"] == 13935
    assert normalized["zona"] == 50
    assert normalized["local"] == 1066
    assert normalized["secao"] == 29
    assert normalized["comparecimento"] == 200
    assert normalized["urna"] == {
        "tipo": 1,
        "tipo_arquivo": 1,
        "versao_votacao": "10.23.0.0",
        "numero_interno": 2031648,
        "codigo_carga": "226921764068436623652154",
    }

    election = normalized["eleicoes"][0]
    assert election["eleicao"] == 6257
    assert election["aptos"] == 225
    assert election["aptos_secao"] == 220
    assert election["aptos_tte"] == 5

    office = election["cargos"][0]
    assert office["tipo_cargo"] == 1
    assert office["codigo_cargo_tipo"] == "cargoConstitucional"
    assert office["codigo_cargo"] == 1
    assert office["comparecimento"] == 200


def test_preserves_vote_identifiers_and_missing_votavel_as_null():
    votes = normalize_bu(decoded_bu())["eleicoes"][0]["cargos"][0]["votos"]

    assert votes[0] == {
        "tipo_voto": 1,
        "quantidade": 120,
        "votavel": 55,
        "partido": 55,
        "ordem_hash": 1,
    }
    assert votes[1]["tipo_voto"] == 2
    assert votes[1]["votavel"] is None
    assert votes[1]["partido"] is None
    assert votes[2]["tipo_voto"] == 3
    assert votes[2]["votavel"] is None
    assert votes[2]["partido"] is None


def test_supports_named_enums_from_asn1tools_default_mode():
    value = decoded_bu()
    value["fase"] = "oficial"
    value["urna"]["tipoUrna"] = "secao"
    value["urna"]["tipoArquivo"] = "votacaoUE"
    result = value["resultadosVotacaoPorEleicao"][0]["resultadosVotacao"][0]
    result["tipoCargo"] = "majoritario"
    result["totaisVotosCargo"][0]["codigoCargo"] = ("cargoConstitucional", "presidente")
    result["totaisVotosCargo"][0]["votosVotaveis"][0]["tipoVoto"] = "nominal"

    normalized = normalize_bu(value)

    assert normalized["fase"] == 2
    assert normalized["urna"]["tipo"] == 1
    assert normalized["urna"]["tipo_arquivo"] == 1
    assert normalized["eleicoes"][0]["cargos"][0]["codigo_cargo"] == 1
    assert normalized["eleicoes"][0]["cargos"][0]["votos"][0]["tipo_voto"] == 1


def test_rejects_non_pleito_header_choice():
    value = decoded_bu()
    value["cabecalho"]["idEleitoral"] = ("idEleicao", 6257)

    with pytest.raises(BUNormalizationError, match="must identify a pleito"):
        normalize_bu(value)
