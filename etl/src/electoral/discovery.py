from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Any

from .http_client import TSEHttpClient
from .models import EA11Config, EA11Election, EA11Pleito
from .tse_urls import TSEConfig, election_config_url, municipalities_config_url

FEDERAL_ELECTION_TYPE = "8"
STATE_ELECTION_TYPE = "1"
MUNICIPAL_ELECTION_TYPE = "3"


class DiscoveryError(RuntimeError):
    pass


@dataclass(frozen=True)
class ElectionRef:
    code: int
    name: str
    turn: int
    election_type: int
    second_turn_code: int | None
    offices: tuple[int, ...]


@dataclass(frozen=True)
class ElectionContext:
    cycle: str
    pleito: int
    election_date: str
    federal: ElectionRef
    state: ElectionRef
    municipal: ElectionRef | None = None

    def with_config(self, cfg: TSEConfig) -> TSEConfig:
        return replace(cfg, cycle=self.cycle, pleito=self.pleito)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    def municipality_config_urls(self, cfg: TSEConfig) -> dict[str, str]:
        bound = self.with_config(cfg)
        result = {
            "federal": municipalities_config_url(bound, self.federal.code),
            "state": municipalities_config_url(bound, self.state.code),
        }
        if self.municipal is not None:
            result["municipal"] = municipalities_config_url(bound, self.municipal.code)
        return result


def _ref(election: EA11Election) -> ElectionRef:
    return ElectionRef(
        code=int(election.cd),
        name=election.nm,
        turn=int(election.t),
        election_type=int(election.tp),
        second_turn_code=int(election.cdt2) if election.cdt2 else None,
        offices=tuple(int(office.cd) for office in election.offices),
    )


def _single(elections: list[EA11Election], election_type: str, label: str) -> EA11Election:
    matches = [election for election in elections if election.tp == election_type]
    if len(matches) != 1:
        raise DiscoveryError(f"{label}: expected one election of type {election_type}, found {len(matches)}")
    return matches[0]


def _context_for_pleito(pleito: EA11Pleito, *, turn: int) -> ElectionContext:
    elections = pleito.elections_for_turn(turn)
    federal = _single(elections, FEDERAL_ELECTION_TYPE, "federal election")
    state = _single(elections, STATE_ELECTION_TYPE, "state election")
    municipal_matches = [election for election in elections if election.tp == MUNICIPAL_ELECTION_TYPE]
    if len(municipal_matches) > 1:
        raise DiscoveryError(f"municipal election: expected at most one type {MUNICIPAL_ELECTION_TYPE}, found {len(municipal_matches)}")
    return ElectionContext(
        cycle=pleito.c,
        pleito=int(pleito.cd),
        election_date=pleito.dt,
        federal=_ref(federal),
        state=_ref(state),
        municipal=_ref(municipal_matches[0]) if municipal_matches else None,
    )


def discover_general_elections(document: EA11Config, *, cycle: str = "ele2026", turn: int = 1) -> ElectionContext:
    candidates: list[ElectionContext] = []
    errors: list[str] = []
    for pleito in document.pleitos_for_cycle(cycle):
        try:
            candidates.append(_context_for_pleito(pleito, turn=turn))
        except DiscoveryError as exc:
            errors.append(f"pleito {pleito.cd}: {exc}")
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        detail = "; ".join(errors) if errors else "cycle not present"
        raise DiscoveryError(f"no general-election pleito found for cycle={cycle!r}, turn={turn}: {detail}")
    codes = ", ".join(str(item.pleito) for item in candidates)
    raise DiscoveryError(f"ambiguous general-election pleito for cycle={cycle!r}, turn={turn}: {codes}")


def fetch_election_context(client: TSEHttpClient, cfg: TSEConfig, *, turn: int = 1) -> ElectionContext:
    payload = client.get_json(election_config_url(cfg), cache_key=f"ea11:{cfg.environment}:{cfg.cycle}")
    document = EA11Config.model_validate(payload)
    return discover_general_elections(document, cycle=cfg.cycle, turn=turn)
