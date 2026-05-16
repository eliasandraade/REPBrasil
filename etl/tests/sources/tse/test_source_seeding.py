import hashlib
from pathlib import Path

from src.sources.tse.candidates import _compute_sha256, _get_file_size, CANDIDATES_SOURCE_NAME
from src.sources.tse.results import RESULTS_SOURCE_NAME
from src.sources.tse.assets import ASSETS_SOURCE_NAME


def test_compute_sha256_returns_hex_string(tmp_path):
    tmp = tmp_path / "test.csv"
    tmp.write_bytes(b"header\nrow1\nrow2\n")
    expected = hashlib.sha256(b"header\nrow1\nrow2\n").hexdigest()
    assert _compute_sha256(tmp) == expected


def test_compute_sha256_missing_file_returns_none():
    assert _compute_sha256(Path("/nonexistent/file.csv")) is None


def test_get_file_size_returns_byte_count(tmp_path):
    tmp = tmp_path / "test.csv"
    tmp.write_bytes(b"hello world")
    assert _get_file_size(tmp) == 11


def test_get_file_size_missing_file_returns_none():
    assert _get_file_size(Path("/nonexistent/file.csv")) is None


def test_candidates_source_name_is_stable():
    assert CANDIDATES_SOURCE_NAME == "TSE Candidatos 2024 — consulta_cand_2024_BRASIL.csv"


def test_results_source_name_is_stable():
    assert RESULTS_SOURCE_NAME == "TSE Resultados Eleitorais 2024 — votacao_candidato_munzona_2024_BRASIL.csv"


def test_assets_source_name_is_stable():
    assert ASSETS_SOURCE_NAME == "TSE Bens Declarados 2024 — bem_candidato_2024_BRASIL.csv"
