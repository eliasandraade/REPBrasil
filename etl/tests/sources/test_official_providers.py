"""Provedores oficiais (Senado, IBGE): normalização de respostas no formato oficial (offline)."""

from __future__ import annotations

import pytest

from src.sources.ibge.localidades import (
    IbgeMunicipality,
    compare_registry,
    fold,
    parse_municipalities,
)
from src.sources.senado.api import parse_current

SENADO = {
    "ListaParlamentarEmExercicio": {
        "Metadados": {"Versao": "01/01/2099"},
        "Parlamentares": {
            "Parlamentar": [
                {
                    "IdentificacaoParlamentar": {
                        "CodigoParlamentar": "9001",
                        "NomeParlamentar": "Senadora Fictícia",
                        "NomeCompletoParlamentar": "Senadora Fictícia da Silva",
                        "SiglaPartidoParlamentar": "PF",
                        "UfParlamentar": "XX",
                        "UrlFotoParlamentar": "https://example.org/f.jpg",
                    },
                    "Mandato": {
                        "CodigoMandato": "700",
                        "UfParlamentar": "XX",
                        "DescricaoParticipacao": "Titular",
                        "PrimeiraLegislaturaDoMandato": {"NumeroLegislatura": "57"},
                        "SegundaLegislaturaDoMandato": {"NumeroLegislatura": "58"},
                    },
                }
            ]
        },
    }
}


def test_senado_current_list_is_normalized_with_the_official_code():
    (s,) = parse_current(SENADO)
    assert (s.code, s.parliamentary_name, s.uf, s.party, s.mandate_participation) == (
        "9001",
        "Senadora Fictícia",
        "XX",
        "PF",
        "Titular",
    )
    assert (s.first_legislature, s.second_legislature) == ("57", "58")
    single = {
        "ListaParlamentarEmExercicio": {
            "Parlamentares": {
                "Parlamentar": SENADO["ListaParlamentarEmExercicio"]["Parlamentares"][
                    "Parlamentar"
                ][0]
            }
        }
    }
    assert (
        len(parse_current(single)) == 1
    )  # o XML→JSON oficial devolve objeto quando há um só parlamentar
    with pytest.raises(ValueError):
        parse_current({"outra": {}})


def test_ibge_registry_comparison_flags_only_real_divergences():
    ibge = parse_municipalities(
        [{"id": 9900001, "nome": "Município Fictício"}, {"id": 9900002, "nome": "Vila-Fictícia"}]
    )
    report = compare_registry(
        ibge, [(9900001, "MUNICIPIO FICTICIO"), (9900002, "Vila Fictícia"), (9900009, "Outro")]
    )
    assert report["status"] == "divergent"
    assert report["not_in_ibge"] == [9900009]
    assert report["name_differences"] == []  # acento, caixa e hífen não são divergência
    assert compare_registry([IbgeMunicipality(1, "A")], [(1, "B")])["name_differences"] == [
        {"ibge_code": 1, "ibge": "A", "registry": "B"}
    ]
    assert fold("São João do Jaguaribe") == "SAO JOAO DO JAGUARIBE"
