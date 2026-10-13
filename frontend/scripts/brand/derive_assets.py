"""Deriva os assets de marca do REPBrasil a partir do quadro oficial de diretrizes do Brand Kit.

NADA aqui desenha, retraça ou recompõe o símbolo, o mapa ou o wordmark: o script só RECORTA as
versões oficiais do quadro `brand-guidelines.png` (Brand Kit Oficial, conferido por SHA-256), separa o
fundo branco do quadro em transparência (matting) e redimensiona. O Brand Kit não traz vetores mestres;
quando o proprietário fornecer SVG/PDF oficiais, eles substituem estes PNGs (ver docs/BRAND.md).

Decisões mecânicas (documentadas em docs/BRAND.md):
- o mapa do Brasil dentro do R é branco opaco (como nas aplicações oficiais sobre fundo escuro); os vãos
  entre as fitas do R e do B são espaço negativo (transparentes);
- versão negativa (fundo escuro) = mesmo símbolo + wordmark e descriptor em branco, como a "assinatura
  clara aprovada" do quadro "Aplicações em fundo";
- monocromia só em azul profundo, preto e branco, a partir das versões monocromáticas oficiais
  (redesenhadas pelo Brand Kit), nunca convertendo a versão colorida;
- assinatura reduzida "[RB] REPBrasil" = símbolo + wordmark do lockup principal na mesma escala e com o
  mesmo espaçamento, wordmark centrado verticalmente no símbolo.

Uso (Python 3.12 + Pillow + NumPy + SciPy), sem argumentos — os caminhos são fixos:
    1. copie `REPBrasil_Brand_Kit_Official/assets/brand-guidelines.png` para `scripts/brand/source/` (ignorado pelo git);
    2. python -I scripts/brand/derive_assets.py
Saída: `public/brand/` (e `public/favicon.ico`). Nenhum caminho vem da linha de comando.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

BOARD_SHA256 = "1884bd876b9bb1866e4f4a3ccdd4b71ed974269bfd781c1de1eee7761444d0c1"
WHITE = np.array([255.0, 255.0, 255.0])
NAVY = (0x0B, 0x2D, 0x5B)

# Caixas (x0, y0, x1, y1 exclusivos) medidas no quadro oficial 1448×1086.
MAIN_SYMBOL = (160, 52, 447, 323)
MAIN_WORDMARK = (481, 117, 1111, 240)
MAIN_DESCRIPTOR = (482, 253, 1114, 290)
MICRO = {32: (1071, 428, 1137, 491), 24: (1221, 435, 1275, 487), 16: (1356, 438, 1405, 484)}
MONO = {"black": (54, 620, 202, 786), "navy": (505, 620, 655, 787)}
MAP_SEED = (120, 150)  # ponto dentro do mapa, em coordenadas do recorte MAIN_SYMBOL
STEM_WIDTH = 74  # largura da haste vertical principal do R no quadro (X da área de proteção)


def matte(rgb: np.ndarray, keep: np.ndarray | None = None) -> np.ndarray:
    """Fundo branco do quadro → alfa. Núcleo opaco intocado; franja antisserrilhada com alfa projetado
    sobre a cor do núcleo mais próximo (sem halo claro nem escurecimento da cor)."""
    a = rgb.astype(float)
    light = (255.0 - a).sum(axis=2) < 40
    transparent = light if keep is None else light & ~keep
    near = ndimage.binary_dilation(transparent, iterations=2)
    core = ~light & ~near
    if keep is not None:
        core |= keep
    _, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
    fg = a[iy, ix]
    diff = WHITE - fg
    denom = np.maximum((diff * diff).sum(axis=2), 1e-6)
    alpha = np.clip(((WHITE - a) * diff).sum(axis=2) / denom, 0.0, 1.0)
    alpha[core] = 1.0
    alpha[transparent] = 0.0
    color = np.where(core[..., None], a, fg)
    out = np.dstack([color, alpha * 255.0]).round().clip(0, 255).astype(np.uint8)
    return out


def map_region(rgb: np.ndarray) -> np.ndarray:
    """Componente branca fechada que contém o mapa (não ligada à borda do recorte)."""
    light = (255 - rgb.astype(int)).sum(axis=2) < 40
    labels, _ = ndimage.label(light)
    region = labels == labels[MAP_SEED[1], MAP_SEED[0]]
    if region[0].any() or region[-1].any() or region[:, 0].any() or region[:, -1].any():
        raise SystemExit("map seed is not inside an enclosed region; board layout changed?")
    return ndimage.binary_dilation(region, iterations=1)


def trim(rgba: np.ndarray) -> np.ndarray:
    return rgba[_bounds(rgba)]


def _bounds(rgba: np.ndarray) -> tuple[slice, slice]:
    ys, xs = np.nonzero(rgba[..., 3] > 0)
    return slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1)


def origin(rgba: np.ndarray, box: tuple[int, int, int, int]) -> tuple[int, int]:
    """Canto superior esquerdo do recorte aparado, em coordenadas do quadro."""
    ys, xs = _bounds(rgba)
    return box[0] + xs.start, box[1] + ys.start


def recolor(rgba: np.ndarray, rgb: tuple[int, int, int]) -> np.ndarray:
    out = rgba.copy()
    out[..., :3] = rgb
    return out


def to_image(rgba: np.ndarray) -> Image.Image:
    return Image.fromarray(rgba, "RGBA")


def resize(img: Image.Image, height: int) -> Image.Image:
    """Redimensiona com alfa pré-multiplicado (sem franjas escuras)."""
    width = max(1, round(img.width * height / img.height))
    return img.convert("RGBa").resize((width, height), Image.LANCZOS).convert("RGBA")


def compose(parts: list[tuple[Image.Image, int, int]], size: tuple[int, int]) -> Image.Image:
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    for img, x, y in parts:
        canvas.alpha_composite(img, (x, y))
    return canvas


def tile(symbol: Image.Image, size: int, fill: float, background: tuple[int, int, int, int]) -> Image.Image:
    """Ícone de app: símbolo centrado ocupando `fill` do lado, sobre fundo opaco (área segura maskable)."""
    scaled = resize(symbol, round(size * fill * symbol.height / max(symbol.width, symbol.height)))
    canvas = Image.new("RGBA", (size, size), background)
    canvas.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return canvas


FRONTEND = Path(__file__).resolve().parents[2]
BOARD = FRONTEND / "scripts" / "brand" / "source" / "brand-guidelines.png"
OUT = FRONTEND / "public" / "brand"


def main() -> int:
    board, out = BOARD, OUT
    if not board.is_file():
        raise SystemExit(f"copie o quadro oficial do Brand Kit para {board.relative_to(FRONTEND)}")
    digest = hashlib.sha256(board.read_bytes()).hexdigest()
    if digest != BOARD_SHA256:
        raise SystemExit(f"unexpected brand board {digest}; expected the official {BOARD_SHA256}")
    out.mkdir(parents=True, exist_ok=True)
    src = np.asarray(Image.open(board).convert("RGB"))

    def crop(box: tuple[int, int, int, int]) -> np.ndarray:
        x0, y0, x1, y1 = box
        return src[y0:y1, x0:x1]

    symbol_rgb = crop(MAIN_SYMBOL)
    symbol_full = matte(symbol_rgb, keep=map_region(symbol_rgb))
    wordmark_full = matte(crop(MAIN_WORDMARK))
    descriptor_full = matte(crop(MAIN_DESCRIPTOR))
    symbol = to_image(trim(symbol_full))
    wordmark = to_image(trim(wordmark_full))
    descriptor = to_image(trim(descriptor_full))
    white = (255, 255, 255)
    wordmark_white = to_image(recolor(np.asarray(wordmark), white))
    descriptor_white = to_image(recolor(np.asarray(descriptor), white))

    # Posições originais do lockup principal (offsets relativos ao símbolo, medidos no quadro).
    sx, sy = origin(symbol_full, MAIN_SYMBOL)
    wx, wy = (v - o for v, o in zip(origin(wordmark_full, MAIN_WORDMARK), (sx, sy), strict=True))
    dx, dy = (v - o for v, o in zip(origin(descriptor_full, MAIN_DESCRIPTOR), (sx, sy), strict=True))
    primary_size = (dx + descriptor.width, symbol.height)
    primary = compose([(symbol, 0, 0), (wordmark, wx, wy), (descriptor, dx, dy)], primary_size)
    primary_negative = compose([(symbol, 0, 0), (wordmark_white, wx, wy), (descriptor_white, dx, dy)], primary_size)
    horizontal_y = (symbol.height - wordmark.height) // 2
    horizontal_size = (wx + wordmark.width, symbol.height)
    horizontal = compose([(symbol, 0, 0), (wordmark, wx, horizontal_y)], horizontal_size)
    horizontal_negative = compose([(symbol, 0, 0), (wordmark_white, wx, horizontal_y)], horizontal_size)

    micro = {size: to_image(trim(matte(crop(box)))) for size, box in MICRO.items()}
    mono_navy = to_image(trim(matte(crop(MONO["navy"]))))
    mono_black = to_image(trim(matte(crop(MONO["black"]))))
    mono_white = to_image(recolor(np.asarray(mono_navy), white))

    files: dict[str, Image.Image] = {
        "symbol.png": symbol,
        "symbol-micro.png": micro[32],
        "wordmark.png": wordmark,
        "wordmark-negative.png": wordmark_white,
        "descriptor.png": descriptor,
        "descriptor-negative.png": descriptor_white,
        "logo-primary.png": primary,
        "logo-primary-negative.png": primary_negative,
        "logo-horizontal.png": horizontal,
        "logo-horizontal-negative.png": horizontal_negative,
        "logo-monochrome-navy.png": mono_navy,
        "logo-monochrome-black.png": mono_black,
        "logo-monochrome-white.png": mono_white,
        "favicon-16.png": tile(micro[16], 16, 1.0, (0, 0, 0, 0)),
        "favicon-32.png": tile(micro[32], 32, 1.0, (0, 0, 0, 0)),
        "icon-192.png": tile(symbol, 192, 0.66, (255, 255, 255, 255)),
        "icon-512.png": tile(symbol, 512, 0.66, (255, 255, 255, 255)),
        # maskable: a diagonal do símbolo (56%) cabe no círculo seguro de 80% do ícone
        "icon-maskable-512.png": tile(symbol, 512, 0.56, (255, 255, 255, 255)),
        "apple-touch-icon.png": tile(symbol, 180, 0.72, (255, 255, 255, 255)),
    }
    for name, img in files.items():
        img.save(out / name, optimize=True)
    # favicon.ico: dentro de brand/ e na raiz pública (onde navegadores o procuram por padrão)
    for ico in (out / "favicon.ico", out.parent / "favicon.ico"):
        tile(micro[16], 16, 1.0, (0, 0, 0, 0)).save(
            ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48)],
        append_images=[tile(micro[24], 24, 1.0, (0, 0, 0, 0)), tile(micro[32], 32, 1.0, (0, 0, 0, 0)),
                       tile(micro[32], 48, 1.0, (0, 0, 0, 0))],
    )

    meta = {
        "source": {"file": "REPBrasil_Brand_Kit_Official/assets/brand-guidelines.png", "sha256": BOARD_SHA256},
        "method": "crop + white-background matting + resize; no redrawing (scripts/brand/derive_assets.py)",
        "clear_space_x_ratio_of_symbol_width": round(STEM_WIDTH / symbol.width, 4),
        "assets": {name: {"width": img.width, "height": img.height} for name, img in files.items()},
        "master_vectors": "missing — owner to provide official SVG/PDF masters (docs/BRAND.md)",
    }
    (out / "assets.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name, img in files.items():
        print(f"{name}: {img.width}x{img.height}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        raise SystemExit("sem argumentos: o quadro vem de scripts/brand/source/ e a saída vai para public/brand/")
    raise SystemExit(main())
