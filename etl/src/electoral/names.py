"""Grafia de nomes próprios publicados em caixa alta ou capitalizados palavra a palavra.

O TSE publica nomes de pessoas em CAIXA ALTA e nomes de município com toda palavra capitalizada
("Juazeiro Do Norte"). A grafia oficial usa as partículas soltas em minúscula ("Juazeiro do Norte",
"Luiz Inácio Lula da Silva"). Esta regra só mexe nas partículas soltas (e, em nomes em caixa alta,
capitaliza cada palavra); acentos, hífens e apóstrofos ficam como publicados — a grafia oficial de
"d'Oeste"/"D'Oeste" varia por município e vem do IBGE (`sync-official-names`).

Nome não é identidade: território é identificado por código, pessoa por documento/SQ oficial.
"""

from __future__ import annotations

import re

PARTICLES = frozenset({"da", "de", "do", "das", "dos", "e", "del"})
_WORD_START = re.compile(r"(^|[-'’])(\w)")


def _title_word(word: str) -> str:
    """'D'ÁGUA' → "D'Água"; 'NÃO-ME-TOQUE' → 'Não-Me-Toque' (maiúscula após hífen e apóstrofo)."""
    return _WORD_START.sub(lambda m: m.group(1) + m.group(2).upper(), word.lower())


def official_case(name: str | None) -> str:
    """Partículas soltas (da, de, do, das, dos, e, del) em minúscula, exceto na primeira palavra.

    Nome em caixa alta é antes capitalizado palavra a palavra; nome já em caixa mista só tem as
    partículas corrigidas (o resto fica exatamente como publicado).
    """
    words = (name or "").split()
    if not words:
        return ""
    upper = (name or "") == (name or "").upper()
    out = []
    for i, word in enumerate(words):
        if i > 0 and word.lower() in PARTICLES:
            out.append(word.lower())
        else:
            out.append(_title_word(word) if upper else word)
    return " ".join(out)


def same_name(a: str | None, b: str | None) -> bool:
    """Mesmo nome a menos de maiúsculas/minúsculas (acentos e pontuação contam)."""
    return (a or "").strip().casefold() == (b or "").strip().casefold()
