import pytest
from src.sources.camara.normalizer import normalize_name, build_camara_index, match_deputies


def test_normalize_removes_accents():
    assert normalize_name("JOSÉ MARIA") == "jose maria"


def test_normalize_removes_particles():
    assert normalize_name("JOSE DA SILVA") == "jose silva"
    assert normalize_name("MARIA DAS DORES") == "maria dores"
    assert normalize_name("ANTONIO DE SOUSA") == "antonio sousa"


def test_normalize_uppercase_camara_style():
    assert normalize_name("José Maria da Silva") == "jose maria silva"


def test_normalize_removes_special_chars():
    assert normalize_name("O'Brien-Costa") == "obrien costa"


def test_normalize_empty():
    assert normalize_name("") == ""


def test_normalize_only_particles():
    assert normalize_name("da de do") == ""


def test_build_camara_index_keyed_by_norm_uf_party():
    deputies = [
        {"id": 100, "nome": "José Silva", "siglaUf": "CE", "siglaPartido": "PT"},
        {"id": 200, "nome": "Maria Santos", "siglaUf": "BA", "siglaPartido": "PL"},
    ]
    idx = build_camara_index(deputies)
    assert ("jose silva", "CE", "PT") in idx
    assert idx[("jose silva", "CE", "PT")]["id"] == 100


def test_build_camara_index_also_by_name_uf():
    deputies = [{"id": 100, "nome": "José Silva", "siglaUf": "CE", "siglaPartido": "PT"}]
    idx = build_camara_index(deputies)
    assert ("jose silva", "CE") in idx


def test_match_deputies_full_3way():
    camara = [{"id": 100, "nome": "José Silva", "siglaUf": "CE", "siglaPartido": "PT"}]
    tse = [{"Id": "uuid-1", "Name": "JOSE SILVA", "BallotName": "ZE SILVA",
            "State": "CE", "PartyAcronym": "PT"}]
    results = match_deputies(camara, tse)
    matched = [r for r in results if r["camara_id"] is not None]
    assert len(matched) == 1
    assert matched[0]["camara_id"] == "100"
    assert matched[0]["confidence_level"] == 5
    assert matched[0]["match_method"] == "full_3way"


def test_match_deputies_ballot_3way():
    camara = [{"id": 200, "nome": "Ze Silva", "siglaUf": "CE", "siglaPartido": "PT"}]
    tse = [{"Id": "uuid-2", "Name": "JOSE DA SILVA", "BallotName": "ZE SILVA",
            "State": "CE", "PartyAcronym": "PT"}]
    results = match_deputies(camara, tse)
    matched = [r for r in results if r["camara_id"] is not None]
    assert len(matched) == 1
    assert matched[0]["confidence_level"] == 4
    assert matched[0]["match_method"] == "ballot_3way"


def test_match_deputies_name_2way_party_changed():
    camara = [{"id": 300, "nome": "Ana Costa", "siglaUf": "SP", "siglaPartido": "MDB"}]
    tse = [{"Id": "uuid-3", "Name": "ANA COSTA", "BallotName": "ANA COSTA",
            "State": "SP", "PartyAcronym": "PT"}]
    results = match_deputies(camara, tse)
    matched = [r for r in results if r["camara_id"] is not None]
    assert len(matched) == 1
    assert matched[0]["confidence_level"] == 3
    assert matched[0]["match_method"] == "name_2way"


def test_match_deputies_ambiguous_skipped():
    camara = [{"id": 400, "nome": "Joao Santos", "siglaUf": "MG", "siglaPartido": "PT"}]
    tse = [
        {"Id": "uuid-a", "Name": "JOAO SANTOS", "BallotName": "JOAO",
         "State": "MG", "PartyAcronym": "PL"},
        {"Id": "uuid-b", "Name": "JOAO SANTOS", "BallotName": "JOAO SANTOS",
         "State": "MG", "PartyAcronym": "PSDB"},
    ]
    results = match_deputies(camara, tse)
    matched = [r for r in results if r["camara_id"] is not None]
    assert len(matched) == 0


def test_match_deputies_no_match():
    camara = [{"id": 500, "nome": "Pedro Alves", "siglaUf": "RJ", "siglaPartido": "PT"}]
    tse = [{"Id": "uuid-5", "Name": "CARLOS FERREIRA", "BallotName": "CARLAO",
            "State": "RJ", "PartyAcronym": "PT"}]
    results = match_deputies(camara, tse)
    assert all(r["camara_id"] is None for r in results)
