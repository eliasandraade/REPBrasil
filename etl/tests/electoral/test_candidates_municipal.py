"""Eleições municipais: candidaturas, seleção, histórico oficial e registros complementares.

Dados SINTÉTICOS no layout oficial do TSE (consulta_cand, historico_candidatura,
bem_candidato, consulta_cand_complementar, rede_social_candidato). Nenhum dado real.
"""
from __future__ import annotations

from src.electoral.candidates.layout import CANDIDATES_COLUMNS, HISTORY_COLUMNS
from src.electoral.candidates.parser import parse_candidate, parse_history
from src.electoral.candidates.records import (
    ASSETS_COLUMNS,
    COMPLEMENT_COLUMNS,
    COMPLEMENT_FIELDS,
    SOCIAL_COLUMNS,
    SOCIAL_COLUMNS_2022,
    money,
    parse_asset,
    parse_complement,
    parse_social,
    sanitize_text,
    sanitize_url,
    social_drop_reason,
)
from src.electoral.candidates.store import municipal_selector, select_candidacies


def _municipal(**kw: str) -> list[str]:
    values = dict.fromkeys(CANDIDATES_COLUMNS, "#NULO") | {
        "DT_GERACAO": "07/10/2099", "HH_GERACAO": "10:00:00", "ANO_ELEICAO": "2098", "CD_TIPO_ELEICAO": "2",
        "NM_TIPO_ELEICAO": "ELEIÇÃO ORDINÁRIA", "NR_TURNO": "1", "CD_ELEICAO": "999619", "DS_ELEICAO": "Eleições Municipais Fictícias",
        "DT_ELEICAO": "04/10/2098", "TP_ABRANGENCIA": "MUNICIPAL", "SG_UF": "XX", "SG_UE": "99999", "NM_UE": "MUNICÍPIO FICTÍCIO",
        "CD_CARGO": "13", "DS_CARGO": "VEREADOR", "SQ_CANDIDATO": "700001", "NR_CANDIDATO": "12345",
        "NM_CANDIDATO": "CANDIDATA MUNICIPAL FICTÍCIA", "NM_URNA_CANDIDATO": "CANDIDATA FICTÍCIA", "NR_CPF_CANDIDATO": "-4",
        "CD_SIT_TOT_TURNO": "5", "DS_SIT_TOT_TURNO": "SUPLENTE", "NR_PARTIDO": "12", "SG_PARTIDO": "PF", "NM_PARTIDO": "PARTIDO FICTÍCIO",
        "NR_FEDERACAO": "-1", "CD_SITUACAO_CANDIDATURA": "12", "DS_SITUACAO_CANDIDATURA": "APTO",
    } | kw
    return [values[c] for c in CANDIDATES_COLUMNS]


def test_parser_normalizes_the_municipal_electoral_unit_to_five_digits():
    row = parse_candidate(_municipal(SG_UE="3891"), 2, CANDIDATES_COLUMNS, "consulta_cand_2098_XX.csv")
    assert (row.scope, row.uf, row.electoral_unit, row.office_code) == ("municipal", "XX", "03891", 13)
    assert (row.election_type_code, row.election_date) == (2, "2098-10-04")
    assert row.elected is False


def test_municipal_selector_takes_every_municipality_and_skips_supplementary_elections():
    rows = [
        parse_candidate(_municipal(SQ_CANDIDATO="1", SG_UE="99999"), 2, CANDIDATES_COLUMNS, "f.csv"),
        parse_candidate(_municipal(SQ_CANDIDATO="2", SG_UE="99998", NR_CANDIDATO="12345"), 3, CANDIDATES_COLUMNS, "f.csv"),
        parse_candidate(_municipal(SQ_CANDIDATO="3", CD_CARGO="11", DS_CARGO="PREFEITO", NR_CANDIDATO="12", NR_TURNO="2",
                                   CD_ELEICAO="999620", DT_ELEICAO="25/10/2098"), 4, CANDIDATES_COLUMNS, "f.csv"),
        # suplementar publicada no arquivo do ano, realizada depois
        parse_candidate(_municipal(SQ_CANDIDATO="4", CD_TIPO_ELEICAO="1", NM_TIPO_ELEICAO="ELEIÇÃO SUPLEMENTAR",
                                   CD_ELEICAO="996223", DS_ELEICAO="Eleição Suplementar Fictícia", DT_ELEICAO="06/07/2099",
                                   CD_CARGO="11", DS_CARGO="PREFEITO", NR_CANDIDATO="15"), 5, CANDIDATES_COLUMNS, "f.csv"),
    ]
    selected, other_turn, other_election = select_candidacies(rows, year=2098, turn=1, units=set(), municipal_ufs={"XX"})
    assert [r.tse_candidate_id for r in selected] == [1, 2]  # mesmo número em municípios diferentes: candidaturas distintas
    assert other_turn == {2: 1}
    assert other_election == {"996223 Eleição Suplementar Fictícia (2099-07-06)": 1}
    assert select_candidacies(rows, year=2098, turn=1, units={"XX"})[0] == []  # UE estadual não seleciona disputas municipais
    assert municipal_selector("xx") == "MUN:XX"


def test_history_row_keeps_official_prior_candidacy_facts():
    values = dict.fromkeys(HISTORY_COLUMNS, "") | {
        "ANO_ELEICAO_ATUAL": "2099", "SQ_CANDIDATO_ATUAL": "900001", "ANO_ELEICAO": "2098", "NR_TURNO": "1",
        "SQ_CANDIDATO": "700001", "CD_CARGO": "13", "DS_CARGO": "Vereador", "SG_UE": "3891", "NM_UE": "Município Fictício",
        "NR_CANDIDATO": "12345", "NM_URNA_CANDIDATO": "CANDIDATA FICTÍCIA", "SG_PARTIDO": "PF", "DS_SIT_TOT_TURNO": "Suplente",
    }
    h = parse_history([values[c] for c in HISTORY_COLUMNS], 7, HISTORY_COLUMNS, "historico_candidatura_2099_XX.csv")
    assert (h.current_tse_candidate_id, h.year, h.tse_candidate_id, h.electoral_unit) == (900001, 2098, 700001, "03891")
    assert (h.office_code, h.candidate_number, h.ballot_name, h.round_outcome) == (13, 12345, "CANDIDATA FICTÍCIA", "Suplente")
    assert h.source_member == "historico_candidatura_2099_XX.csv"


def test_asset_rows_parse_decimal_comma_and_mask_personal_identifiers():
    values = dict.fromkeys(ASSETS_COLUMNS, "") | {
        "DT_GERACAO": "01/01/2099", "HH_GERACAO": "10:00:00", "ANO_ELEICAO": "2098", "CD_TIPO_ELEICAO": "2", "CD_ELEICAO": "999619",
        "SG_UF": "XX", "SG_UE": "99999", "SQ_CANDIDATO": "700001", "NR_ORDEM_BEM_CANDIDATO": "1", "CD_TIPO_BEM_CANDIDATO": "11",
        "DS_TIPO_BEM_CANDIDATO": "Casa", "DS_BEM_CANDIDATO": "CASA; CONTATO fulano@example.org; CPF 123.456.789-09",
        "VR_BEM_CANDIDATO": "94490,50", "DT_ULT_ATUAL_BEM_CANDIDATO": "07/07/2098",
    }
    row = parse_asset([values[c] for c in ASSETS_COLUMNS], 2, ASSETS_COLUMNS, "bem_candidato_2098_XX.csv")
    assert row.payload["value"] == "94490.50"
    assert "@" not in row.payload["description"] and "123.456" not in row.payload["description"]
    regenerated = parse_asset([(values | {"DT_GERACAO": "02/01/2099"})[c] for c in ASSETS_COLUMNS], 2, ASSETS_COLUMNS, "x.csv")
    assert regenerated.row_hash == row.row_hash  # regeneração diária do TSE não muda a impressão digital
    assert money("-1", "VR", 2) is None and str(money("0,00", "VR", 2)) == "0.00"


def test_complement_keeps_only_the_allowlisted_public_fields():
    values = dict.fromkeys(COMPLEMENT_COLUMNS, "#NULO") | {
        "DT_GERACAO": "01/01/2099", "HH_GERACAO": "10:00:00", "ANO_ELEICAO": "2098", "CD_ELEICAO": "999619",
        "SQ_CANDIDATO": "700001", "ST_CANDIDATO_INSERIDO_URNA": "NÃO", "NM_TIPO_DESTINACAO_VOTOS": "Anulado",
        "VR_DESPESA_MAX_CAMPANHA": "55968.49", "DT_ACEITE_CANDIDATURA": "2098-08-12 08:39:17",
        "DS_COR_RACA_FEFC": "SENSÍVEL", "DS_ETNIA_INDIGENA": "SENSÍVEL", "NM_MUNICIPIO_NASCIMENTO": "PESSOAL", "NR_IDADE_DATA_POSSE": "40",
        "SQ_SUBSTITUIDO": "-1", "SQ_ORDEM_SUPLENCIA": "-1",
    }
    row = parse_complement([values[c] for c in COMPLEMENT_COLUMNS], 2, COMPLEMENT_COLUMNS, "c.csv", "xx")
    assert set(row.payload) == set(COMPLEMENT_FIELDS.values())
    assert "SENSÍVEL" not in str(row.payload) and "PESSOAL" not in str(row.payload)
    assert (row.payload["inserted_in_urn"], row.payload["max_campaign_spending"], row.payload["accepted_on"]) == ("NÃO", "55968.49", "2098-08-12")
    assert row.payload["substituted_tse_candidate_id"] is None and row.uf == "XX"


def test_social_networks_drop_personal_contact_links():
    assert sanitize_url("https://www.instagram.com/perfil.ficticio") == "https://www.instagram.com/perfil.ficticio"
    # perfil público de rede conhecida declarado sem esquema: o esquema é completado (dado real de 2024/2026)
    assert sanitize_url("instagram.com/perfil.ficticio") == "https://instagram.com/perfil.ficticio"
    assert sanitize_url("www.facebook.com/perfil.ficticio") == "https://www.facebook.com/perfil.ficticio"
    for blocked in ("https://wa.me/5585999999999", "https://api.whatsapp.com/send?phone=5585", "mailto:a@b.org",
                    "https://example.org/?contato=a@b.org", "wa.me/5585999999999",
                    "instagran.com/erro-de-digitacao", "site-qualquer.com.br/pagina", "@perfil", "Instagram: perfil"):
        assert sanitize_url(blocked) is None
    reasons = {v: social_drop_reason(v) for v in (
        "https://wa.me/5585999999999", "wa.me/5585999999999", "contato@exemplo.org", "(85) 99999-9999",
        "mailto:a@b.org", "@perfil", "instagran.com/erro-de-digitacao", "#NULO", "instagram.com/perfil.ficticio")}
    assert reasons == {
        "https://wa.me/5585999999999": "personal_contact", "wa.me/5585999999999": "personal_contact",
        "contato@exemplo.org": "personal_contact", "(85) 99999-9999": "personal_contact", "mailto:a@b.org": "personal_contact",
        "@perfil": "not_a_public_url", "instagran.com/erro-de-digitacao": "not_a_public_url", "#NULO": "not_a_public_url",
        "instagram.com/perfil.ficticio": None,
    }
    base = {"DT_GERACAO": "01/01/2099", "HH_GERACAO": "10:00:00", "AA_ELEICAO": "2098", "SG_UF": "XX", "CD_TIPO_ELEICAO": "2",
            "NM_TIPO_ELEICAO": "ORDINÁRIA", "CD_ELEICAO": "999619", "DS_ELEICAO": "Fictícia", "SQ_CANDIDATO": "700001"}
    ok = parse_social([(base | {"NR_ORDEM_REDE_SOCIAL": "2", "DS_URL": "https://example.org/p"})[c] for c in SOCIAL_COLUMNS], 2, SOCIAL_COLUMNS, "s.csv")
    assert ok is not None and ok.payload == {"order": 2, "url": "https://example.org/p"}
    old = parse_social([(base | {"NR_ORDEM": "1", "DS_URL": "https://example.org/q"})[c] for c in SOCIAL_COLUMNS_2022], 2, SOCIAL_COLUMNS_2022, "s.csv")
    assert old is not None and old.payload["order"] == 1
    assert parse_social([(base | {"NR_ORDEM_REDE_SOCIAL": "3", "DS_URL": "https://wa.me/55"})[c] for c in SOCIAL_COLUMNS], 2, SOCIAL_COLUMNS, "s.csv") is None
    assert sanitize_text(None) is None
