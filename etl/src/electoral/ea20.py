from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


EA20Scope = Literal["br", "uf", "mu", "zona"]
EA20Progress = Literal["n", "p", "f"]
EA20YesNo = Literal["s", "n"]

# TSE EA20 2026, seção 2 (código do cargo no nome do arquivo).
EA20_OFFICE_CODES = {
    "presidente": "0001",
    "governador": "0003",
    "senador": "0005",
    "deputado-federal": "0006",
    "deputado-estadual": "0007",
    "deputado-distrital": "0008",
    "prefeito": "0011",
    "vereador": "0013",
}


class EA20Model(BaseModel):
    # O EA20 contém uma árvore extensa de candidatos/partidos. A validação desta
    # camada é deliberadamente focada nos identificadores e nos totais s/e/v;
    # campos adicionais oficiais permanecem disponíveis no JSON bruto.
    model_config = ConfigDict(extra="ignore")


class EA20Sections(EA20Model):
    ts: int = Field(ge=0)
    st: int = Field(ge=0)
    snt: int = Field(ge=0)
    si: int = Field(ge=0)
    sni: int = Field(ge=0)
    sa: int = Field(ge=0)
    sna: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_hierarchy(self) -> "EA20Sections":
        if self.ts != self.st + self.snt:
            raise ValueError("EA20 sections invariant failed: ts must equal st + snt")
        if self.st != self.si + self.sni:
            raise ValueError("EA20 sections invariant failed: st must equal si + sni")
        if self.si != self.sa + self.sna:
            raise ValueError("EA20 sections invariant failed: si must equal sa + sna")
        return self


class EA20Electorate(EA20Model):
    te: int = Field(ge=0)
    est: int = Field(ge=0)
    esnt: int = Field(ge=0)
    esi: int = Field(ge=0)
    esni: int = Field(ge=0)
    esa: int = Field(ge=0)
    esna: int = Field(ge=0)
    c: int = Field(ge=0)
    a: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_hierarchy(self) -> "EA20Electorate":
        if self.te != self.est + self.esnt:
            raise ValueError("EA20 electorate invariant failed: te must equal est + esnt")
        if self.est != self.esi + self.esni:
            raise ValueError("EA20 electorate invariant failed: est must equal esi + esni")
        if self.esi != self.esa + self.esna:
            raise ValueError("EA20 electorate invariant failed: esi must equal esa + esna")
        if self.esi != self.c + self.a:
            raise ValueError("EA20 electorate invariant failed: esi must equal c + a")
        return self


class EA20Votes(EA20Model):
    tv: int = Field(ge=0)
    vvc: int = Field(ge=0)
    vb: int = Field(ge=0)
    tvn: int = Field(ge=0)
    vscv: int = Field(ge=0)

    # Condicionais conforme cargo/tipo de eleição. Não convertem ausência em 0.
    vv: int | None = Field(default=None, ge=0)
    vnom: int | None = Field(default=None, ge=0)
    vl: int | None = Field(default=None, ge=0)
    van: int | None = Field(default=None, ge=0)
    vansj: int | None = Field(default=None, ge=0)
    vn: int | None = Field(default=None, ge=0)
    vnt: int | None = Field(default=None, ge=0)
    vsan: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_hierarchy(self) -> "EA20Votes":
        # Estrutura oficial: tv = vvc + vb + tvn + vscv.
        if self.tv != self.vvc + self.vb + self.tvn + self.vscv:
            raise ValueError("EA20 votes invariant failed: tv must equal vvc + vb + tvn + vscv")

        # As decomposições abaixo usam atributos condicionais. Só validamos
        # quando todos os termos necessários vierem explicitamente da fonte.
        if self.vv is not None and self.van is not None and self.vansj is not None:
            if self.vvc != self.vv + self.van + self.vansj:
                raise ValueError("EA20 votes invariant failed: vvc must equal vv + van + vansj")
        if self.vn is not None and self.vnt is not None and self.tvn != self.vn + self.vnt:
            raise ValueError("EA20 votes invariant failed: tvn must equal vn + vnt")
        if self.vv is not None and self.vnom is not None and self.vl is not None:
            if self.vv != self.vnom + self.vl:
                raise ValueError("EA20 votes invariant failed: vv must equal vnom + vl")

        # A especificação determina que, se vscv > 0, os demais quantitativos
        # de votos ficam zerados, exceto tv.
        if self.vscv > 0:
            observed = [self.vvc, self.vb, self.tvn]
            observed.extend(
                value
                for value in (self.vv, self.vnom, self.vl, self.van, self.vansj, self.vn, self.vnt)
                if value is not None
            )
            if any(value != 0 for value in observed):
                raise ValueError("EA20 votes invariant failed: vscv > 0 requires other vote quantities to be zero")
        return self


class EA20Office(EA20Model):
    cd: int | str

    @property
    def code4(self) -> str:
        value = str(self.cd)
        if not value.isdigit() or len(value) > 4:
            raise ValueError("EA20 office code must contain at most four digits")
        return value.zfill(4)


class EA20Result(EA20Model):
    ele: int
    t: Literal["1", "2", 1, 2]
    f: Literal["s", "o"]
    sup: EA20YesNo
    tpabr: EA20Scope
    cdabr: str
    dg: str
    hg: str
    idg: int
    dv: EA20YesNo
    dt: str
    ht: str
    tf: EA20YesNo
    and_: EA20Progress = Field(alias="and")
    md: Literal["e", "s", "n"]
    esae: EA20YesNo
    carg: list[EA20Office] = Field(default_factory=list)
    s: EA20Sections
    e: EA20Electorate
    v: EA20Votes

    @model_validator(mode="after")
    def validate_scope_code(self) -> "EA20Result":
        code = self.cdabr.lower()
        if self.tpabr == "br" and code != "br":
            raise ValueError("EA20 cdabr must be 'br' for national scope")
        if self.tpabr == "uf" and (len(code) != 2 or not code.isalpha()):
            raise ValueError("EA20 cdabr must be a two-letter UF for state scope")
        if self.tpabr == "mu" and (len(code) != 5 or not code.isdigit()):
            raise ValueError("EA20 cdabr must be a five-digit municipality code for municipal scope")
        if self.tpabr == "zona" and (len(code) != 4 or not code.isdigit()):
            raise ValueError("EA20 cdabr must be a four-digit zone code for zone scope")
        return self


@dataclass(frozen=True)
class EA20ZoneExpectation:
    election: int
    zone: int
    office_code: str

    @property
    def zone4(self) -> str:
        return str(self.zone).zfill(4)


def validate_zone_result(document: EA20Result, expected: EA20ZoneExpectation) -> None:
    if document.tpabr != "zona":
        raise ValueError(f"expected EA20 zone scope, got {document.tpabr!r}")
    if document.cdabr != expected.zone4:
        raise ValueError(f"EA20 zone mismatch: expected {expected.zone4}, got {document.cdabr}")
    if document.ele != expected.election:
        raise ValueError(f"EA20 election mismatch: expected {expected.election}, got {document.ele}")
    expected_code = _office4(expected.office_code)
    codes = [office.code4 for office in document.carg]
    if codes.count(expected_code) != 1:
        raise ValueError(f"EA20 office {expected_code}: expected exactly one carg entry, found {codes.count(expected_code)}")


def _digits(value: int | str, width: int, label: str) -> str:
    text = str(value)
    if not text.isdigit():
        raise ValueError(f"{label} must contain digits only")
    if len(text) > width:
        raise ValueError(f"{label} exceeds {width} digits")
    return text.zfill(width)


def _office4(value: int | str) -> str:
    return _digits(value, 4, "office")


def ea20_zone_filename(
    *,
    uf: str,
    municipality_tse_code: int | str,
    zone: int | str,
    office_code: int | str,
    election: int | str,
) -> str:
    """Build only the official EA20 zone *filename* from the 2026 spec.

    The specification documents the filename but not a canonical CDN path here,
    so this function deliberately does not guess a URL.
    """

    uf = uf.lower().strip()
    if len(uf) != 2 or not uf.isascii() or not uf.isalpha():
        raise ValueError("UF must contain exactly two ASCII letters")
    municipality5 = _digits(municipality_tse_code, 5, "municipality")
    zone4 = _digits(zone, 4, "zone")
    office4 = _office4(office_code)
    election6 = _digits(election, 6, "election")
    return f"{uf}{municipality5}-z{zone4}-c{office4}-e{election6}-u.json"
