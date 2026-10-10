"""Normalização dos resultados por urna (seção principal) e cargo.

Regras que esta camada garante (qualquer violação falha a importação):

- Métricas estruturais (aptos, comparecimento, abstenções, urna, horários,
  agregadas, local) se repetem em cada linha de voto. São PROPRIEDADES da
  urna/cargo: verificamos que são idênticas e guardamos UMA vez. Nunca somamos.
- Cada votável aparece no máximo uma vez por urna/cargo. Linha repetida não
  vira voto adicional.
- Agregadas (`DS_SECOES_AGREGADAS`) e local são iguais em todos os cargos da
  mesma urna.
- `aptos = comparecimento + abstenções` (definição do leiame), quando os três
  vierem preenchidos.
- Tipos de votável: somente os códigos observados E documentados abaixo. Um
  código novo falha — nenhuma equivalência é inventada.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime

from .parser import BURow


class ConsistencyError(RuntimeError):
    """Inconsistência na fonte que poderia alterar contagem ou identidade."""


# CD_TIPO_VOTAVEL → (vote_kind interno, descrição oficial esperada).
# Códigos observados no arquivo oficial de 2026; descrições do próprio CSV.
# NR_VOTAVEL 95/96 para branco/nulo é documentado no leiame oficial.
VOTE_TYPES: dict[int, tuple[str, str]] = {
    1: ("candidate", "Nominal"),
    2: ("blank", "Branco"),
    3: ("null", "Nulo"),
    4: ("party_legend", "Legenda"),
}
RESERVED_VOTABLE_NUMBERS = {"blank": 95, "null": 96}

# Leiame oficial (CD_MUNICIPIO): abrangência federal = Presidente; estadual =
# Governador, Senador, Deputado Federal, Deputado Estadual, Deputado Distrital.
FEDERAL_OFFICES = frozenset({1})
STATE_OFFICES = frozenset({3, 5, 6, 7, 8})
# Prefeito e Vereador (o Vice-Prefeito é votado na chapa do Prefeito e não tem linha no BU).
MUNICIPAL_OFFICES = frozenset({11, 13})

_URN_FIELDS = (
    "year", "turn", "pleito_code", "election_code", "election_description", "office_name",
    "polling_place_code", "eligible", "turnout", "abstentions", "urn_type_code", "urn_type_description",
    "urn_number", "load_code_1", "load_code_2", "flashcard", "loaded_at", "aggregated_sections",
    "opened_at", "closed_at", "biometric_not_enabled", "bu_received_at", "bu_emitted_at",
    "uf", "municipality_name",
)
_SECTION_FIELDS = ("aggregated_sections", "polling_place_code", "urn_number")


@dataclass(frozen=True)
class VotableKey:
    election_code: int
    office_code: int
    type_code: int
    number: int


@dataclass(frozen=True)
class Votable:
    key: VotableKey
    vote_kind: str
    type_description: str
    name: str | None
    party_number: int | None
    party_acronym: str | None
    party_name: str | None


@dataclass(frozen=True)
class VoteRecord:
    votable: VotableKey
    votes: int
    source_row_hash: str
    line: int


@dataclass
class UrnOfficeResult:
    election_code: int
    municipality_code: int
    zone: int
    section: int
    office_code: int
    structural: dict[str, object]
    votes: list[VoteRecord] = field(default_factory=list)

    @property
    def votes_total(self) -> int:
        return sum(v.votes for v in self.votes)

    def get(self, name: str) -> object:
        return self.structural[name]


@dataclass
class NormalizedZone:
    municipality_code: int
    zone: int
    results: dict[tuple[int, int, int], UrnOfficeResult]  # (section, office, election)
    votables: dict[VotableKey, Votable]
    generated_at: str | None

    @property
    def sections(self) -> list[int]:
        return sorted({k[0] for k in self.results})

    @property
    def offices(self) -> list[int]:
        return sorted({k[1] for k in self.results})

    def section_structure(self, section: int) -> dict[str, object]:
        return next(r.structural for (s, _, _), r in self.results.items() if s == section)

    def eligible_by_scope(self, section: int) -> dict[str, int | None]:
        """Aptos da urna por abrangência (federal/estadual/municipal), sem somar cargos."""
        out: dict[str, set[int | None]] = defaultdict(set)
        for (s, office, _), r in self.results.items():
            if s != section:
                continue
            scope = (
                "federal" if office in FEDERAL_OFFICES
                else "state" if office in STATE_OFFICES
                else "municipal" if office in MUNICIPAL_OFFICES
                else None
            )
            if scope is None:
                raise ConsistencyError(f"section {section}: office {office} has no documented electorate scope")
            out[scope].add(r.structural["eligible"])  # type: ignore[arg-type]
        result: dict[str, int | None] = {}
        for scope, values in out.items():
            if len(values) != 1:
                raise ConsistencyError(f"section {section}: {scope} offices disagree on QT_APTOS {sorted(map(str, values))}")
            result[scope] = next(iter(values))
        return result


def _fmt(value: object) -> str:
    return value.isoformat(sep=" ") if isinstance(value, datetime) else repr(value)


def normalize_zone(rows: Iterable[BURow], *, municipality: int, zone: int) -> NormalizedZone:
    results: dict[tuple[int, int, int], UrnOfficeResult] = {}
    votables: dict[VotableKey, Votable] = {}
    section_struct: dict[int, dict[str, object]] = {}
    parties: dict[int, tuple[str | None, str | None]] = {}
    generated: set[str] = set()

    for row in rows:
        where = f"line {row.line}"
        for name in ("election_code", "section", "office_code", "votable_type_code", "votable_number"):
            if getattr(row, name) is None:
                raise ConsistencyError(f"{where}: required identifier {name} is missing")
        if row.votes is None:
            raise ConsistencyError(f"{where}: QT_VOTOS is missing; a vote row without quantity cannot be imported")
        if row.municipality_code != municipality or row.zone != zone:
            raise ConsistencyError(f"{where}: row outside requested municipality/zone reached normalization")
        if row.generated_date or row.generated_time:
            generated.add(f"{row.generated_date} {row.generated_time}")

        assert row.votable_type_code is not None and row.votable_number is not None
        assert row.section is not None and row.office_code is not None and row.election_code is not None
        if row.votable_type_code not in VOTE_TYPES:
            raise ConsistencyError(
                f"{where}: CD_TIPO_VOTAVEL={row.votable_type_code} ({row.votable_type_description!r}) is not a documented/observed type"
            )
        kind, description = VOTE_TYPES[row.votable_type_code]
        if row.votable_type_description != description:
            raise ConsistencyError(
                f"{where}: CD_TIPO_VOTAVEL={row.votable_type_code} described as {row.votable_type_description!r}, expected {description!r}"
            )
        if kind in RESERVED_VOTABLE_NUMBERS and row.votable_number != RESERVED_VOTABLE_NUMBERS[kind]:
            raise ConsistencyError(f"{where}: {kind} vote with NR_VOTAVEL={row.votable_number}, documented {RESERVED_VOTABLE_NUMBERS[kind]}")
        if kind in {"blank", "null"} and row.party_number is not None:
            raise ConsistencyError(f"{where}: {kind} vote carries a party ({row.party_number})")

        # Partido: mesmo número ⇒ mesma sigla/nome no arquivo.
        if row.party_number is not None:
            seen = parties.setdefault(row.party_number, (row.party_acronym, row.party_name))
            if seen != (row.party_acronym, row.party_name):
                raise ConsistencyError(f"{where}: party {row.party_number} appears as {seen} and {(row.party_acronym, row.party_name)}")

        vkey = VotableKey(row.election_code, row.office_code, row.votable_type_code, row.votable_number)
        votable = Votable(vkey, kind, description, row.votable_name, row.party_number, row.party_acronym, row.party_name)
        previous = votables.setdefault(vkey, votable)
        if previous != votable:
            raise ConsistencyError(f"{where}: votable {vkey} has conflicting attributes ({previous} vs {votable})")

        structural = {name: getattr(row, name) for name in _URN_FIELDS}
        rkey = (row.section, row.office_code, row.election_code)
        result = results.get(rkey)
        if result is None:
            result = results[rkey] = UrnOfficeResult(row.election_code, municipality, zone, row.section, row.office_code, structural)
            e, t, a = structural["eligible"], structural["turnout"], structural["abstentions"]
            if isinstance(e, int) and isinstance(t, int) and isinstance(a, int) and e != t + a:
                raise ConsistencyError(f"{where}: section {row.section} office {row.office_code}: QT_APTOS {e} != comparecimento {t} + abstenções {a}")
        else:
            for name in _URN_FIELDS:
                if result.structural[name] != structural[name]:
                    raise ConsistencyError(
                        f"{where}: section {row.section} office {row.office_code}: repeated structural field {name} "
                        f"changed from {_fmt(result.structural[name])} to {_fmt(structural[name])}"
                    )
        if any(v.votable == vkey for v in result.votes):
            raise ConsistencyError(f"{where}: duplicate votable {vkey} in section {row.section} office {row.office_code}")
        result.votes.append(VoteRecord(vkey, row.votes, row.source_row_hash, row.line))

        sstruct = {name: structural[name] for name in _SECTION_FIELDS}
        prev_s = section_struct.setdefault(row.section, sstruct)
        if prev_s != sstruct:
            raise ConsistencyError(f"{where}: section {row.section}: urn/aggregation/polling place differ between offices ({prev_s} vs {sstruct})")

    if len(generated) > 1:
        raise ConsistencyError(f"multiple generation timestamps in one file: {sorted(generated)}")
    return NormalizedZone(municipality, zone, results, votables, next(iter(generated), None))
