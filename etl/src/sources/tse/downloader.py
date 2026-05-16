import zipfile
from pathlib import Path

import httpx
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

TSE_CANDIDATES_URL = (
    "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2024.zip"
)
RAW_DIR = Path(__file__).parents[5] / "data" / "raw" / "tse"
ZIP_PATH = RAW_DIR / "consulta_cand_2024.zip"
CSV_PATH = RAW_DIR / "consulta_cand_2024_BRASIL.csv"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=30))
def download_candidates_zip() -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    if ZIP_PATH.exists():
        logger.info(f"ZIP já existe em cache: {ZIP_PATH}")
        return ZIP_PATH

    tmp = ZIP_PATH.with_suffix(".tmp")
    logger.info(f"Baixando candidatos TSE 2024 de {TSE_CANDIDATES_URL}")
    try:
        with httpx.stream("GET", TSE_CANDIDATES_URL, follow_redirects=True, timeout=120) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            downloaded = 0
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total:
                        pct = downloaded / total * 100
                        logger.debug(f"Download: {pct:.1f}%")
        tmp.rename(ZIP_PATH)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise

    logger.info(f"Download concluído: {ZIP_PATH}")
    return ZIP_PATH


def extract_candidates_csv() -> Path:
    if CSV_PATH.exists():
        logger.info(f"CSV já extraído: {CSV_PATH}")
        return CSV_PATH

    zip_path = download_candidates_zip()
    logger.info("Extraindo CSV do ZIP...")
    tmp_csv = CSV_PATH.with_suffix(".tmp")
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            names = zf.namelist()
            brasil_csv = next(
                (n for n in names if "BRASIL" in n.upper() and n.endswith(".csv")), None
            )
            if not brasil_csv:
                raise FileNotFoundError(
                    f"CSV BRASIL não encontrado no ZIP. Arquivos: {names}"
                )
            data = zf.read(brasil_csv)
            tmp_csv.write_bytes(data)
        tmp_csv.rename(CSV_PATH)
    except Exception:
        tmp_csv.unlink(missing_ok=True)
        raise

    logger.info(f"CSV extraído: {CSV_PATH}")
    return CSV_PATH
