import zipfile
from pathlib import Path

import pytest

import src.sources.tse.downloader as dl


def test_extract_assets_csv_finds_brasil_file(tmp_path, monkeypatch):
    zip_path = tmp_path / "bem_candidato_2024.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("bem_candidato_2024_BRASIL.csv", "SQ_CANDIDATO;NR_ORDEM_BEM\n")
        zf.writestr("bem_candidato_2024_SP.csv", "other data")

    monkeypatch.setattr(dl, "ASSETS_ZIP_PATH", zip_path)
    csv_out = tmp_path / "bem_candidato_2024_BRASIL.csv"
    monkeypatch.setattr(dl, "ASSETS_CSV_PATH", csv_out)
    monkeypatch.setattr(dl, "download_assets_zip", lambda: zip_path)

    result = dl.extract_assets_csv()

    assert result == csv_out
    assert csv_out.read_text() == "SQ_CANDIDATO;NR_ORDEM_BEM\n"


def test_extract_assets_csv_returns_cached_file(tmp_path, monkeypatch):
    csv_out = tmp_path / "bem_candidato_2024_BRASIL.csv"
    csv_out.write_text("cached")
    monkeypatch.setattr(dl, "ASSETS_CSV_PATH", csv_out)

    download_called = []
    monkeypatch.setattr(dl, "download_assets_zip", lambda: download_called.append(1))

    result = dl.extract_assets_csv()

    assert result == csv_out
    assert download_called == []
