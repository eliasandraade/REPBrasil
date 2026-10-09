import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from urnai_ingest.models import EA16Config, EA16Section, SectionAux
from urnai_ingest.planner import plan_aux_requests, plan_urna_artifacts
from urnai_ingest.tse_urls import TSEConfig, election_config_url, section_aux_url, sections_config_url, urna_file_url


FIXTURES = Path(__file__).parents[1] / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_ea16_models_aggregations_and_aux_availability():
    doc = EA16Config.model_validate(load("ea16-sample.json"))
    zone = doc.find_zone("CE", "13935", 50)
    assert [s.ns for s in zone.sec] == ["0029", "0028", "0040", "0030"]
    assert zone.sec[0].nsa == ["0028", "0040"]
    assert zone.sec[0].auxiliary_available is True
    assert zone.sec[1].is_aggregated is True
    assert zone.sec[1].auxiliary_available is False
    assert zone.sec[3].auxiliary_available is False


def test_ea16_rejects_inconsistent_aux_timestamp_and_aggregated_role():
    with pytest.raises(ValidationError):
        EA16Section(ns="0029", da="04/10/2026")
    with pytest.raises(ValidationError):
        EA16Section(ns="0028", nsp="0029", da="04/10/2026", ha="17:30:00")
    with pytest.raises(ValidationError):
        EA16Section(ns="0028", nsp="0029", nsa=["0040"])


def test_planner_only_requests_aux_for_principal_sections_announced_by_ea16():
    cfg = TSEConfig()
    doc = EA16Config.model_validate(load("ea16-sample.json"))
    plan = plan_aux_requests(doc, cfg, uf="ce", municipality="13935", zone=50)
    assert [item.section for item in plan] == [29]
    assert plan[0].url.endswith("/ce/13935/0050/0029/p003220-ce-m13935-z0050-s0029-aux.json")


def test_ea18_preserves_hashes_and_selects_latest_non_rejected_reception():
    doc = SectionAux.model_validate(load("ea18-sample.json"))
    assert len(doc.hashes) == 3
    assert [x.hash for x in doc.usable_receptions()] == ["hash-old", "hash-final"]
    selected = doc.latest_usable_reception()
    assert selected is not None
    assert selected.hash == "hash-final"
    assert [f.nm for f in doc.files_with_suffix(".bu")] == ["urna-final.bu"]


def test_urna_plan_uses_ea18_hash_and_filename_without_guessing_tp_values():
    cfg = TSEConfig()
    doc = SectionAux.model_validate(load("ea18-sample.json"))
    plan = plan_urna_artifacts(doc, cfg, uf="ce", municipality="13935", zone=50, section=29, suffix=".bu")
    assert len(plan) == 1
    assert plan[0].reception_hash == "hash-final"
    assert plan[0].filename == "urna-final.bu"
    assert plan[0].url.endswith("/ce/13935/0050/0029/hash-final/urna-final.bu")


def test_url_builders_are_canonical_and_reject_unsafe_parts():
    cfg = TSEConfig()
    assert election_config_url(cfg) == "https://resultados.tse.jus.br/oficial/ele2026/comum/config/ele-c.json"
    assert sections_config_url(cfg, "CE").endswith("/3220/config/ce/ce-p003220-cs.json")
    assert section_aux_url(cfg, "ce", "13935", 50, 29).endswith("p003220-ce-m13935-z0050-s0029-aux.json")
    assert urna_file_url(cfg, "ce", "13935", 50, 29, "abc_123", "urna.bu").endswith("/abc_123/urna.bu")
    with pytest.raises(ValueError):
        urna_file_url(cfg, "ce", "13935", 50, 29, "../oops", "urna.bu")
    with pytest.raises(ValueError):
        urna_file_url(cfg, "ce", "13935", 50, 29, "abc", "../urna.bu")
