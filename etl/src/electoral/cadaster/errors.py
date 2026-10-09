from __future__ import annotations


class CadasterError(RuntimeError):
    """Dado do cadastro inconsistente com o layout/semântica documentados."""


class CadasterMissing(CadasterError):
    """O território é válido, mas o cadastro eleitoral ainda não foi importado.

    Nunca é inferido: a importação de resultados para e responde `cadaster_missing`.
    """

    code = "cadaster_missing"


class TerritoryMissing(CadasterError):
    """Município/UF sem registro territorial (rode `import-territories`)."""

    code = "territory_missing"


class CadasterConflict(CadasterError):
    """Um arquivo oficial novo diverge do cadastro já importado.

    Nunca sobrescreve em silêncio: exige `--supersede` explícito, e a diferença
    fica registrada no lote.
    """

    code = "cadaster_conflict"

    def __init__(self, message: str, diff: dict[str, object]) -> None:
        super().__init__(message)
        self.diff = diff
