import zipfile
from pathlib import Path

import src.sources.tse.downloader as dl
from src.sources.tse.downloader import extract_results_csv


def test_extract_results_csv_finds_brasil_file(tmp_path: Path, monkeypatch) -> None:
    raw_dir = tmp_path / "data" / "raw" / "tse"
    raw_dir.mkdir(parents=True)

    zip_path = raw_dir / "votacao_candidato_munzona_2024.zip"
    csv_name = "votacao_candidato_munzona_2024_BRASIL.csv"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr(csv_name, "SQ_CANDIDATO;NR_TURNO\n123;1\n")

    monkeypatch.setattr(dl, "RESULTS_ZIP_PATH", zip_path)
    monkeypatch.setattr(dl, "RESULTS_CSV_PATH", raw_dir / csv_name)
    monkeypatch.setattr(dl, "download_results_zip", lambda: zip_path)

    result = extract_results_csv()
    assert result.exists()
    assert result.name == csv_name


def test_extract_results_csv_returns_cached_file(tmp_path: Path, monkeypatch) -> None:
    raw_dir = tmp_path / "data" / "raw" / "tse"
    raw_dir.mkdir(parents=True)

    csv_name = "votacao_candidato_munzona_2024_BRASIL.csv"
    existing_csv = raw_dir / csv_name
    existing_csv.write_text("cached")

    monkeypatch.setattr(dl, "RESULTS_CSV_PATH", existing_csv)

    result = extract_results_csv()
    assert result == existing_csv
    assert result.read_text() == "cached"
