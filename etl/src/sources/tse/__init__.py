from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .candidates import TseCandidatesPipeline

__all__ = ["TseCandidatesPipeline"]


def __getattr__(name: str) -> Any:
    if name == "TseCandidatesPipeline":
        from .candidates import TseCandidatesPipeline

        return TseCandidatesPipeline
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
