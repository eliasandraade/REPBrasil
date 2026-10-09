from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Phase = Literal["s", "o"]


class TSEModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class EA11ArtifactTemplate(TSEModel):
    tp: str
    dir: str


class EA11Office(TSEModel):
    cd: str
    ds: str
    tp: str


class EA11Scope(TSEModel):
    cd: str
    cp: list[EA11Office] = Field(default_factory=list)


class EA11Election(TSEModel):
    cd: str = Field(pattern=r"^\d+$")
    cdt2: str | None = None
    sqele: str | None = None
    nm: str
    t: str = Field(pattern=r"^\d+$")
    tp: str = Field(pattern=r"^\d+$")
    abr: list[EA11Scope] = Field(default_factory=list)

    @field_validator("cdt2", "sqele", mode="before")
    @classmethod
    def empty_string_is_missing(cls, value):
        return None if value == "" else value

    @property
    def offices(self) -> tuple[EA11Office, ...]:
        return tuple(office for scope in self.abr for office in scope.cp)


class EA11Pleito(TSEModel):
    cd: str = Field(pattern=r"^\d+$")
    cdpr: str | None = None
    c: str
    dt: str
    dtlim: str | None = None
    e: list[EA11Election] = Field(default_factory=list)

    def elections_for_turn(self, turn: int | str) -> list[EA11Election]:
        turn_code = str(turn)
        return [election for election in self.e if election.t == turn_code]


class EA11Config(TSEModel):
    dg: str
    hg: str
    f: Phase
    idg: int | str
    arq: list[EA11ArtifactTemplate] = Field(default_factory=list)
    pl: list[EA11Pleito] = Field(default_factory=list)

    def pleitos_for_cycle(self, cycle: str) -> list[EA11Pleito]:
        return [pleito for pleito in self.pl if pleito.c == cycle]

    def artifact_template(self, artifact_type: str) -> EA11ArtifactTemplate:
        matches = [item for item in self.arq if item.tp == artifact_type]
        if len(matches) != 1:
            raise LookupError(f"EA11 artifact template {artifact_type!r}: expected one match, found {len(matches)}")
        return matches[0]


class EA12Municipality(TSEModel):
    cd: str = Field(pattern=r"^\d{5}$")
    cdi: str = Field(pattern=r"^\d{7}$")
    nm: str
    c: str | None = None
    z: list[str] = Field(default_factory=list)

    @field_validator("z")
    @classmethod
    def validate_zones(cls, zones: list[str]) -> list[str]:
        for zone in zones:
            if len(zone) != 4 or not zone.isdigit():
                raise ValueError("EA12 zones must be four-digit strings")
        return zones


class EA12Scope(TSEModel):
    cd: str = Field(min_length=2, max_length=2)
    ds: str
    mu: list[EA12Municipality] = Field(default_factory=list)


class EA12Config(TSEModel):
    dg: str
    hg: str
    idg: int | str
    f: Phase
    abr: list[EA12Scope] = Field(default_factory=list)

    def find_by_tse_code(self, uf: str, municipality_code: int | str) -> EA12Municipality:
        target_uf = uf.lower()
        target_code = str(municipality_code).zfill(5)
        for scope in self.abr:
            if scope.cd.lower() != target_uf:
                continue
            for municipality in scope.mu:
                if municipality.cd == target_code:
                    return municipality
        raise LookupError(f"municipality {target_uf}/{target_code} not present in EA12")

    def find_by_ibge_code(self, ibge_code: int | str) -> EA12Municipality:
        target = str(ibge_code).zfill(7)
        matches = [municipality for scope in self.abr for municipality in scope.mu if municipality.cdi == target]
        if len(matches) != 1:
            raise LookupError(f"IBGE municipality {target}: expected one EA12 match, found {len(matches)}")
        return matches[0]


class EA16Section(TSEModel):
    ns: str = Field(pattern=r"^\d{4}$")
    nsp: str | None = Field(default=None, pattern=r"^\d{4}$")
    nsa: list[str] = Field(default_factory=list)
    da: str | None = None
    ha: str | None = None

    @field_validator("nsp", "da", "ha", mode="before")
    @classmethod
    def empty_string_is_missing(cls, value):
        return None if value == "" else value

    @model_validator(mode="after")
    def validate_role(self) -> "EA16Section":
        if self.nsp is not None and self.nsa:
            raise ValueError("aggregated section cannot also aggregate other sections")
        if (self.da is None) != (self.ha is None):
            raise ValueError("EA16 auxiliary date/time must appear together")
        if self.nsp is not None and (self.da is not None or self.ha is not None):
            raise ValueError("EA16 auxiliary timestamp is only available for principal sections")
        return self

    @property
    def is_aggregated(self) -> bool:
        return self.nsp is not None

    @property
    def auxiliary_available(self) -> bool:
        return not self.is_aggregated and self.da is not None and self.ha is not None


class EA16Zone(TSEModel):
    cd: str = Field(pattern=r"^\d{4}$")
    sec: list[EA16Section] = Field(default_factory=list)


class EA16Municipality(TSEModel):
    cd: str = Field(pattern=r"^\d{5}$")
    nm: str
    zon: list[EA16Zone] = Field(default_factory=list)


class EA16Scope(TSEModel):
    cd: str = Field(min_length=2, max_length=2)
    ds: str
    mu: list[EA16Municipality] = Field(default_factory=list)


class EA16Config(TSEModel):
    dg: str
    hg: str
    idg: int
    f: Phase
    cdp: int
    abr: list[EA16Scope] = Field(default_factory=list)

    def find_municipality(self, uf: str, municipality_code: str) -> EA16Municipality:
        uf = uf.lower()
        municipality_code = str(municipality_code).zfill(5)
        for scope in self.abr:
            if scope.cd.lower() != uf:
                continue
            for municipality in scope.mu:
                if municipality.cd == municipality_code:
                    return municipality
        raise LookupError(f"municipality {uf}/{municipality_code} not present in EA16")

    def find_zone(self, uf: str, municipality_code: str, zone: int | str) -> EA16Zone:
        zone_code = str(zone).zfill(4)
        municipality = self.find_municipality(uf, municipality_code)
        for item in municipality.zon:
            if item.cd == zone_code:
                return item
        raise LookupError(f"zone {zone_code} not present in EA16 municipality {municipality.cd}")


class UrnaFile(TSEModel):
    nm: str
    tp: str

    def has_suffix(self, suffix: str) -> bool:
        return self.nm.lower().endswith(suffix.lower())


class UrnaReception(TSEModel):
    hash: str
    dr: str | None = None
    hr: str | None = None
    st: str
    arq: list[UrnaFile] = Field(default_factory=list)

    @property
    def received_at(self) -> datetime | None:
        if not self.dr or not self.hr:
            return None
        try:
            return datetime.strptime(f"{self.dr} {self.hr}", "%d/%m/%Y %H:%M:%S")
        except ValueError:
            return None


class SectionAux(TSEModel):
    dg: str
    hg: str
    idg: int
    f: Phase
    st: str
    hashes: list[UrnaReception] = Field(default_factory=list)

    def usable_receptions(self) -> list[UrnaReception]:
        unusable = {"rejeitado", "excluído", "excluido"}
        return [item for item in self.hashes if item.st.strip().casefold() not in unusable]

    def latest_usable_reception(self) -> UrnaReception | None:
        usable = self.usable_receptions()
        if not usable:
            return None
        indexed = list(enumerate(usable))
        indexed.sort(
            key=lambda pair: (
                pair[1].received_at is not None,
                pair[1].received_at or datetime.min,
                pair[0],
            )
        )
        return indexed[-1][1]

    def files_with_suffix(self, suffix: str, *, reception: UrnaReception | None = None) -> list[UrnaFile]:
        selected = reception or self.latest_usable_reception()
        if selected is None:
            return []
        return [item for item in selected.arq if item.has_suffix(suffix)]


SectionConfig = EA16Section
EA18Aux = SectionAux
