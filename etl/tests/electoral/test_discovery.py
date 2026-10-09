import json
from pathlib import Path

import pytest

from src.electoral.discovery import (
    DiscoveryError,
    discover_general_elections,
    fetch_election_context,
)
from src.electoral.models import EA11Config, EA12Config
from src.electoral.tse_urls import TSEConfig, municipalities_config_url

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def get_json(self, url, *, cache_key=None):
        self.calls.append((url, cache_key))
        return self.payload


def test_ea11_discovers_codes_instead_of_hardcoding_known_2026_ids():
    document = EA11Config.model_validate(load("ea11-sample.json"))
    context = discover_general_elections(document, cycle="ele2099", turn=1)
    assert context.pleito == 9001
    assert context.federal.code == 7001
    assert context.state.code == 7002
    assert context.municipal is not None and context.municipal.code == 7003
    assert context.federal.offices == (1,)
    assert context.state.offices == (3, 6)
    assert context.federal.second_turn_code == 7004


def test_discovery_requires_unambiguous_federal_and_state_elections():
    raw = load("ea11-sample.json")
    raw["pl"][0]["e"] = [item for item in raw["pl"][0]["e"] if item["tp"] != "1"]
    document = EA11Config.model_validate(raw)
    with pytest.raises(DiscoveryError, match="no general-election pleito"):
        discover_general_elections(document, cycle="ele2099", turn=1)


def test_live_discovery_fetches_only_ea11_and_binds_discovered_pleito():
    client = FakeClient(load("ea11-sample.json"))
    cfg = TSEConfig(cycle="ele2099", pleito=3220)
    context = fetch_election_context(client, cfg, turn=1)
    assert len(client.calls) == 1
    assert client.calls[0][0].endswith("/oficial/ele2099/comum/config/ele-c.json")
    assert client.calls[0][1] == "ea11:oficial:ele2099"
    assert context.with_config(cfg).pleito == 9001


def test_ea12_preserves_leading_zero_zone_and_crosswalk_codes():
    document = EA12Config.model_validate(load("ea12-sample.json"))
    municipality = document.find_by_tse_code("CE", 13935)
    assert municipality.nm == "GENERAL SAMPAIO"
    assert municipality.cdi == "2304608"
    assert municipality.z == ["0050"]
    assert document.find_by_ibge_code(2304608).cd == "13935"


def test_municipality_config_url_uses_discovered_election_and_six_digit_filename():
    cfg = TSEConfig(cycle="ele2099", pleito=9001)
    assert municipalities_config_url(cfg, 7001).endswith("/ele2099/7001/config/mun-e007001-cm.json")


def test_context_plans_each_ea12_source_from_ea11():
    document = EA11Config.model_validate(load("ea11-sample.json"))
    context = discover_general_elections(document, cycle="ele2099", turn=1)
    urls = context.municipality_config_urls(TSEConfig(cycle="ele2099", pleito=3220))
    assert set(urls) == {"federal", "state", "municipal"}
    assert "/7001/config/" in urls["federal"]
    assert "/7002/config/" in urls["state"]
    assert "/7003/config/" in urls["municipal"]
