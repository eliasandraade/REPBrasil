import datetime
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class PoliticianSchema(BaseModel):
    """
    Schema de validação para dados de político coletados de fontes externas.
    Usado nos pipelines de transformação antes de persistir no PostgreSQL.
    """

    id: UUID = Field(default_factory=uuid4)
    name: str
    ballot_name: str
    tse_id: str | None = None
    camara_id: str | None = None
    senate_id: str | None = None
    collected_at: datetime.datetime = Field(
        default_factory=lambda: datetime.datetime.now(tz=datetime.UTC)
    )
    source_url: str | None = None

    model_config = {"str_strip_whitespace": True}
