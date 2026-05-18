import re
import unicodedata
from typing import Any

_PARTICLES: frozenset[str] = frozenset({
    "de", "da", "do", "dos", "das", "e", "em", "com", "no", "na", "o", "a"
})


def normalize_name(name: str) -> str:
    """Remove acentos, coloca lowercase, remove partículas PT-BR e caracteres não-alfanuméricos."""
    nfd = unicodedata.normalize("NFD", name.lower())
    ascii_only = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    # Remove apostrophes (glue chars) without adding space; hyphens become spaces
    no_apostrophe = re.sub(r"'", "", ascii_only)
    # Replace remaining non-alphanumeric chars (including hyphens) with space
    clean = re.sub(r"[^a-z0-9\s]", " ", no_apostrophe)
    words = [w for w in clean.split() if w and w not in _PARTICLES]
    return " ".join(words)


def build_camara_index(deputies: list[dict[str, Any]]) -> dict[tuple, Any]:
    """
    Constrói dois índices de lookup para o matching:
    - Chave 3-way: (norm_name, uf, party)  -> deputado
    - Chave 2-way: (norm_name, uf)          -> deputado ou "__ambiguous__" se múltiplos
    """
    idx: dict[tuple, Any] = {}

    for dep in deputies:
        norm = normalize_name(dep["nome"])
        uf = dep["siglaUf"]
        party = dep["siglaPartido"]

        key3 = (norm, uf, party)
        key2 = (norm, uf)

        idx[key3] = dep

        if key2 in idx:
            idx[key2] = "__ambiguous__"
        else:
            idx[key2] = dep

    return idx


def match_deputies(
    camara_deputies: list[dict[str, Any]],
    tse_politicians: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Para cada TSE politician, tenta encontrar o deputado correspondente na Câmara.

    Retorna lista de dicts com:
      politician_id, tse_name, tse_ballot_name, tse_state, tse_party,
      camara_id (str|None), camara_name (str|None),
      match_method (str|None), confidence_level (int|None)
    """
    idx = build_camara_index(camara_deputies)

    # Pré-escaneamento: detectar ambiguidade pelo lado TSE (múltiplos TSE com mesmo norm_name+UF)
    _tse_name_uf_count: dict[tuple, int] = {}
    for pol in tse_politicians:
        key = (normalize_name(pol["Name"]), pol["State"])
        _tse_name_uf_count[key] = _tse_name_uf_count.get(key, 0) + 1
    _tse_ambiguous_keys: set[tuple] = {k for k, v in _tse_name_uf_count.items() if v > 1}

    results: list[dict[str, Any]] = []

    for pol in tse_politicians:
        norm_name = normalize_name(pol["Name"])
        norm_ballot = normalize_name(pol["BallotName"])
        uf = pol["State"]
        party = pol["PartyAcronym"]

        camara_id = None
        camara_name = None
        method = None
        confidence = None

        # Nível 1: nome civil 3-way
        dep = idx.get((norm_name, uf, party))
        if dep and dep != "__ambiguous__":
            camara_id = str(dep["id"])
            camara_name = dep["nome"]
            method = "full_3way"
            confidence = 5

        # Nível 2: nome de urna 3-way
        if camara_id is None and norm_ballot:
            dep = idx.get((norm_ballot, uf, party))
            if dep and dep != "__ambiguous__":
                camara_id = str(dep["id"])
                camara_name = dep["nome"]
                method = "ballot_3way"
                confidence = 4

        # Nível 3: nome civil 2-way — conservador
        # Descarta se: (a) múltiplos Câmara deputies com mesmo nome+UF, ou
        #              (b) múltiplos TSE politicians com mesmo nome+UF
        if camara_id is None:
            tse_ambiguous = (norm_name, uf) in _tse_ambiguous_keys
            dep2 = idx.get((norm_name, uf))
            if dep2 == "__ambiguous__" or tse_ambiguous:
                results.append({
                    "politician_id": pol["Id"],
                    "tse_name": pol["Name"],
                    "tse_ballot_name": pol["BallotName"],
                    "tse_state": uf,
                    "tse_party": party,
                    "camara_id": None,
                    "camara_name": None,
                    "match_method": "ambiguous_name_2way",
                    "confidence_level": None,
                })
                continue
            elif dep2 is not None:
                camara_id = str(dep2["id"])
                camara_name = dep2["nome"]
                method = "name_2way"
                confidence = 3

        results.append({
            "politician_id": pol["Id"],
            "tse_name": pol["Name"],
            "tse_ballot_name": pol["BallotName"],
            "tse_state": uf,
            "tse_party": party,
            "camara_id": camara_id,
            "camara_name": camara_name,
            "match_method": method,
            "confidence_level": confidence,
        })

    return results
