import json
from hashlib import sha256
from pathlib import Path

import pytest

from urnai_ingest.acquisition import (
    AcquisitionError,
    AcquisitionNotReady,
    download_planned_artifact,
    persist_acquired_artifact,
    plan_section_artifact,
)
from urnai_ingest.tse_urls import (
    TSEConfig,
    election_config_url,
    municipalities_config_url,
    section_aux_url,
    sections_config_url,
)


FIXTURES = Path(__file__).parents[1] / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeClient:
    def __init__(self, json_by_url, bytes_by_url=None):
        self.json_by_url = json_by_url
        self.bytes_by_url = bytes_by_url or {}
        self.json_calls = []
        self.byte_calls = []

    def get_json(self, url, *, cache_key=None):
        self.json_calls.append((url, cache_key))
        return self.json_by_url[url]

    def get_bytes(self, url, *, cache_key=None):
        self.byte_calls.append((url, cache_key))
        return self.bytes_by_url[url]


def fixture_client(*, requested_section=29, ea16_ready=True):
    cfg = TSEConfig(cycle="ele2099", pleito=3220)
    ea11 = load("ea11-sample.json")
    ea12 = load("ea12-sample.json")
    ea16 = load("ea16-sample.json")
    ea16["cdp"] = 9001
    if not ea16_ready:
        ea16["abr"][0]["mu"][0]["zon"][0]["sec"][0].pop("da", None)
        ea16["abr"][0]["mu"][0]["zon"][0]["sec"][0].pop("ha", None)
    ea18 = load("ea18-sample.json")

    bound = TSEConfig(cycle="ele2099", pleito=9001)
    urls = {
        "ea11": election_config_url(cfg),
        "ea12": municipalities_config_url(bound, 7002),
        "ea16": sections_config_url(bound, "ce"),
        "ea18": section_aux_url(bound, "ce", "13935", 50, 29),
    }
    artifact_url = (
        "https://resultados.tse.jus.br/oficial/ele2099/arquivo-urna/9001/dados/"
        "ce/13935/0050/0029/hash-final/o09001ce1393500500029-bu.dat"
    )
    client = FakeClient(
        {
            urls["ea11"]: ea11,
            urls["ea12"]: ea12,
            urls["ea16"]: ea16,
            urls["ea18"]: ea18,
        },
        {artifact_url: b"synthetic-bu-bytes"},
    )
    return cfg, client, urls, artifact_url


def test_plan_resolves_aggregated_section_to_principal_without_fetching_binary():
    cfg, client, urls, artifact_url = fixture_client(requested_section=28)
    plan = plan_section_artifact(
        client, cfg, uf="ce", municipality="13935", zone=50, section=28, suffix="-bu.dat"
    )
    assert plan.pleito == 9001
    assert plan.state_election == 7002
    assert plan.municipality_ibge == "2304608"
    assert plan.requested_section == 28
    assert plan.principal_section == 29
    assert plan.requested_was_aggregated is True
    assert plan.reception_hash == "hash-final"
    assert plan.filename == "o09001ce1393500500029-bu.dat"
    assert plan.artifact_url == artifact_url
    assert [call[0] for call in client.json_calls] == [urls["ea11"], urls["ea12"], urls["ea16"], urls["ea18"]]
    assert client.byte_calls == []
    assert [item.hash for item in plan.receptions] == ["hash-old", "hash-rejected", "hash-final"]


def test_plan_never_probes_ea18_when_ea16_has_not_announced_auxiliary():
    cfg, client, urls, _ = fixture_client(ea16_ready=False)
    with pytest.raises(AcquisitionNotReady, match="has not announced"):
        plan_section_artifact(client, cfg, uf="ce", municipality="13935", zone=50, section=29)
    assert [call[0] for call in client.json_calls] == [urls["ea11"], urls["ea12"], urls["ea16"]]


def test_plan_rejects_zone_not_declared_by_ea12_before_ea16_request():
    cfg, client, urls, _ = fixture_client()
    with pytest.raises(AcquisitionError, match="not listed"):
        plan_section_artifact(client, cfg, uf="ce", municipality="13935", zone=51, section=29)
    assert [call[0] for call in client.json_calls] == [urls["ea11"], urls["ea12"]]


def test_download_hashes_exact_bytes_and_persistence_writes_manifest(tmp_path):
    cfg, client, _, artifact_url = fixture_client()
    plan = plan_section_artifact(client, cfg, uf="ce", municipality="13935", zone=50, section=29)
    artifact = download_planned_artifact(client, plan)
    assert artifact.body == b"synthetic-bu-bytes"
    assert artifact.sha256 == sha256(b"synthetic-bu-bytes").hexdigest()
    assert artifact.size == len(b"synthetic-bu-bytes")
    assert client.byte_calls[0][0] == artifact_url

    persisted = persist_acquired_artifact(artifact, tmp_path)
    assert persisted.data_path.read_bytes() == b"synthetic-bu-bytes"
    manifest = json.loads(persisted.manifest_path.read_text(encoding="utf-8"))
    assert manifest["sha256"] == artifact.sha256
    assert manifest["municipality_tse"] == "13935"
    assert manifest["municipality_ibge"] == "2304608"
    assert manifest["principal_section"] == 29
    assert manifest["reception_hash"] == "hash-final"
    assert manifest["ea18_url"].endswith("p009001-ce-m13935-z0050-s0029-aux.json")


def test_persistence_is_idempotent_for_same_hash(tmp_path):
    cfg, client, _, _ = fixture_client()
    plan = plan_section_artifact(client, cfg, uf="ce", municipality="13935", zone=50, section=29)
    artifact = download_planned_artifact(client, plan)
    first = persist_acquired_artifact(artifact, tmp_path)
    second = persist_acquired_artifact(artifact, tmp_path)
    assert first == second
    assert first.data_path.read_bytes() == artifact.body
