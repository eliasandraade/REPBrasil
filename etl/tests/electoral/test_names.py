from src.electoral.names import official_case, same_name


def test_particles_are_lowercase_except_the_first_word():
    assert official_case("Juazeiro Do Norte") == "Juazeiro do Norte"
    assert official_case("Mato Grosso Do Sul") == "Mato Grosso do Sul"
    assert official_case("Olho D'Água Das Cunhãs") == "Olho D'Água das Cunhãs"  # apóstrofo: grafia oficial vem do IBGE
    assert official_case("São João Del Rei") == "São João del Rei"
    assert official_case("Andre Fernandes De Moura") == "Andre Fernandes de Moura"
    assert official_case("Dois Irmãos") == "Dois Irmãos"  # "Dois" não é partícula
    assert official_case("De Castro") == "De Castro"  # primeira palavra mantém a maiúscula


def test_upper_case_names_are_capitalized_word_by_word():
    assert official_case("LUIZ INÁCIO LULA DA SILVA") == "Luiz Inácio Lula da Silva"
    assert official_case("NÃO-ME-TOQUE") == "Não-Me-Toque"
    assert official_case("OLHO D'ÁGUA DO BORGES") == "Olho D'Água do Borges"
    assert official_case("GONÇALVES E SILVA") == "Gonçalves e Silva"


def test_mixed_case_keeps_everything_but_the_particles():
    assert official_case("Governador Dix-Sept Rosado") == "Governador Dix-Sept Rosado"
    assert official_case("Herval d'Oeste") == "Herval d'Oeste"
    assert official_case("  Fortaleza  ") == "Fortaleza"
    assert official_case("") == ""
    assert official_case(None) == ""


def test_same_name_ignores_only_letter_case():
    assert same_name("Juazeiro Do Norte", "Juazeiro do Norte")
    assert same_name("Herval D'Oeste", "Herval d'Oeste")
    assert not same_name("Ceara", "Ceará")
    assert not same_name("Embu", "Embu das Artes")
