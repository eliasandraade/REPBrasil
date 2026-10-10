from src.electoral.candidates.layout import CANDIDATES_COLUMNS
from src.electoral.candidates.parser import parse_candidate


def _municipal_row() -> list[str]:
    values = dict.fromkeys(CANDIDATES_COLUMNS, "#NULO") | {
        "DT_GERACAO": "07/10/2024",
        "HH_GERACAO": "10:00:00",
        "ANO_ELEICAO": "2024",
        "NR_TURNO": "1",
        "CD_ELEICAO": "619",
        "DS_ELEICAO": "ELEIÇÕES MUNICIPAIS 2024",
        "TP_ABRANGENCIA": "MUNICIPAL",
        "SG_UF": "CE",
        "SG_UE": "13897",
        "CD_CARGO": "13",
        "DS_CARGO": "VEREADOR",
        "SQ_CANDIDATO": "2300020240001",
        "NR_CANDIDATO": "12345",
        "NM_CANDIDATO": "CANDIDATO MUNICIPAL FICTÍCIO",
        "NM_URNA_CANDIDATO": "CANDIDATO FICTÍCIO",
        "NR_CPF_CANDIDATO": "-4",
        "CD_SIT_TOT_TURNO": "4",
        "DS_SIT_TOT_TURNO": "NÃO ELEITO",
        "NR_PARTIDO": "12",
        "SG_PARTIDO": "P12",
        "NM_PARTIDO": "PARTIDO FICTÍCIO",
    }
    return [values[column] for column in CANDIDATES_COLUMNS]


def test_parser_accepts_municipal_scope_and_variable_length_electoral_unit():
    row = parse_candidate(_municipal_row(), 2, CANDIDATES_COLUMNS, "consulta_cand_2024_CE.csv")

    assert row.scope == "municipal"
    assert row.uf == "CE"
    assert row.electoral_unit == "13897"
    assert row.year == 2024
    assert row.office_code == 13
