from __future__ import annotations

from dataclasses import dataclass
import re
from urllib.parse import quote


_UF = re.compile(r"^[a-z]{2}$")
_HASH = re.compile(r"^[A-Za-z0-9._~-]+$")
_FILENAME = re.compile(r"^[^/\\]+$")


@dataclass(frozen=True)
class TSEConfig:
    base_url: str = "https://resultados.tse.jus.br"
    environment: str = "oficial"
    cycle: str = "ele2026"
    pleito: int = 3220

    @property
    def pleito6(self) -> str:
        return _digits(self.pleito, 6, "pleito")


def _digits(value: int | str, width: int, label: str) -> str:
    text = str(value)
    if not text.isdigit():
        raise ValueError(f"{label} must contain digits only")
    if len(text) > width:
        raise ValueError(f"{label} exceeds {width} digits")
    return text.zfill(width)


def _uf(value: str) -> str:
    normalized = value.lower().strip()
    if not _UF.fullmatch(normalized):
        raise ValueError("UF must contain exactly two ASCII letters")
    return normalized


def election_config_url(cfg: TSEConfig) -> str:
    return f"{cfg.base_url.rstrip('/')}/{cfg.environment}/{cfg.cycle}/comum/config/ele-c.json"


def municipalities_config_url(cfg: TSEConfig, election: int | str) -> str:
    election6 = _digits(election, 6, "election")
    return (
        f"{cfg.base_url.rstrip('/')}/{cfg.environment}/{cfg.cycle}/{int(election)}/config/"
        f"mun-e{election6}-cm.json"
    )


def sections_config_url(cfg: TSEConfig, uf: str) -> str:
    uf = _uf(uf)
    return (
        f"{cfg.base_url.rstrip('/')}/{cfg.environment}/{cfg.cycle}/arquivo-urna/"
        f"{cfg.pleito}/config/{uf}/{uf}-p{cfg.pleito6}-cs.json"
    )


def section_aux_url(
    cfg: TSEConfig,
    uf: str,
    municipality_tse_code: str,
    zone: int,
    section: int,
) -> str:
    uf = _uf(uf)
    z = _digits(zone, 4, "zone")
    s = _digits(section, 4, "section")
    m = _digits(municipality_tse_code, 5, "municipality")
    filename = f"p{cfg.pleito6}-{uf}-m{m}-z{z}-s{s}-aux.json"
    return (
        f"{cfg.base_url.rstrip('/')}/{cfg.environment}/{cfg.cycle}/arquivo-urna/"
        f"{cfg.pleito}/dados/{uf}/{m}/{z}/{s}/{filename}"
    )


def urna_file_url(
    cfg: TSEConfig,
    uf: str,
    municipality_tse_code: str,
    zone: int,
    section: int,
    reception_hash: str,
    filename: str,
) -> str:
    uf = _uf(uf)
    z = _digits(zone, 4, "zone")
    s = _digits(section, 4, "section")
    m = _digits(municipality_tse_code, 5, "municipality")
    if not _HASH.fullmatch(reception_hash):
        raise ValueError("invalid reception hash")
    if not _FILENAME.fullmatch(filename) or filename in {".", ".."}:
        raise ValueError("invalid urna filename")
    return (
        f"{cfg.base_url.rstrip('/')}/{cfg.environment}/{cfg.cycle}/arquivo-urna/"
        f"{cfg.pleito}/dados/{uf}/{m}/{z}/{s}/{quote(reception_hash, safe='')}/{quote(filename, safe='')}"
    )
