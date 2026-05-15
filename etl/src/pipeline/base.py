from abc import ABC, abstractmethod
from typing import Any

from loguru import logger


class BasePipeline(ABC):
    """
    Interface base para todos os pipelines de coleta do REPBrasil.

    Todo pipeline implementa três etapas:
    - collect(): busca dados brutos da fonte
    - transform(): valida e transforma os dados
    - load(): persiste no banco de dados

    Use run() para executar o pipeline completo.
    """

    @property
    def name(self) -> str:
        return self.__class__.__name__

    @abstractmethod
    def collect(self) -> Any:
        """Coleta dados brutos da fonte oficial."""
        ...

    @abstractmethod
    def transform(self, raw: Any) -> Any:
        """Valida e transforma os dados brutos para o schema interno."""
        ...

    @abstractmethod
    def load(self, data: Any) -> None:
        """Persiste os dados transformados no destino (PostgreSQL, Neo4j)."""
        ...

    def run(self) -> None:
        """Executa collect → transform → load com logging."""
        logger.info(f"[{self.name}] Iniciando pipeline")
        try:
            raw = self.collect()
            logger.info(f"[{self.name}] Coleta concluída")
            data = self.transform(raw)
            logger.info(f"[{self.name}] Transformação concluída")
            self.load(data)
            logger.info(f"[{self.name}] Carga concluída")
        except Exception as e:
            logger.error(f"[{self.name}] Erro no pipeline: {e}")
            raise
