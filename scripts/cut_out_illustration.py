#!/usr/bin/env python3
"""Cut a species illustration out of its plain background for the species grid.

The grid shows each species as a cut-out plate with a thin halo of plate paper
around it (see website/art/birds). This takes an illustration painted on a
plain white or cream sheet and makes the sheet transparent. Faint washes at the
edge, such as a patch of moss fading out, keep their softness. Then it adds the
paper halo around the drawing.

    python3 scripts/cut_out_illustration.py frog.png website/art/frogs/crinia-signifera.webp

The file name must be the species' scientific name as a slug. A new species
also needs its key in website/art/manifest.json and a line in the folder's
CREDITS.md. Needs numpy, scipy and Pillow.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

PAPER = np.array([240, 236, 229], np.float32)  # #F0ECE5, the halo colour of the plates


def main() -> int:
    parser = argparse.ArgumentParser(description="Cut an illustration out of its plain background, with a paper halo")
    parser.add_argument("src", help="illustration on a plain white or cream background")
    parser.add_argument("dest", help="output .webp (or .png)")
    parser.add_argument("--size", type=int, default=1000, help="long side of the working image in px (default 1000)")
    parser.add_argument("--halo", type=float, default=16, help="halo width in working px (default 16, as the frog plates)")
    parser.add_argument("--quality", type=int, default=80, help="WebP quality (default 80)")
    args = parser.parse_args()

    image = Image.open(args.src).convert("RGB")
    scale = args.size / max(image.size)
    if scale < 1:
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    c = np.asarray(image, np.float32)
    h, w = c.shape[:2]

    # The sheet's colour, from the border.
    border = np.concatenate([c[:12].reshape(-1, 3), c[-12:].reshape(-1, 3), c[:, :12].reshape(-1, 3), c[:, -12:].reshape(-1, 3)])
    sheet = np.median(border, axis=0)
    diff = np.abs(c - sheet).max(axis=2)

    # Paint: fully opaque once clearly off the sheet, fading out with the faint washes.
    paint = np.clip((diff - 3) / 20, 0, 1)

    # The drawing's outline for the halo: close small gaps, fill enclosed glints
    # and pale spots, drop specks. Larger openings, such as between the legs, stay open.
    solid = ndimage.binary_closing(np.pad(diff > 16, 8), np.ones((7, 7), bool))[8:-8, 8:-8]
    gaps, n = ndimage.label(~solid)
    if n:
        sizes = ndimage.sum_labels(np.ones_like(gaps), gaps, np.arange(1, n + 1))
        at_edge = np.unique(np.concatenate([gaps[0], gaps[-1], gaps[:, 0], gaps[:, -1]]))
        small = [i + 1 for i, s in enumerate(sizes) if s < 0.004 * h * w and i + 1 not in at_edge]
        solid |= np.isin(gaps, small)
    parts, n = ndimage.label(solid)
    if n:
        sizes = ndimage.sum_labels(solid, parts, np.arange(1, n + 1))
        solid = np.isin(parts, 1 + np.flatnonzero(sizes >= 0.0005 * h * w))
    if not solid.any():
        print(f"error: found no drawing in {args.src}", file=sys.stderr)
        return 1
    halo = ndimage.gaussian_filter((ndimage.distance_transform_edt(~solid) <= args.halo).astype(np.float32), 3.5)

    # Paint over halo: the sheet's white is taken out of the paint, the halo goes under it.
    a = paint[..., None]
    paint_rgb = np.clip(c - (1 - a) * sheet, 0, None)  # premultiplied
    alpha = paint + halo * (1 - paint)
    rgb = (paint_rgb + halo[..., None] * (1 - a) * PAPER) / np.maximum(alpha, 1e-6)[..., None]

    ys, xs = np.where(alpha > 0.03)
    y0, y1 = max(0, ys.min() - 6), min(h, ys.max() + 7)
    x0, x1 = max(0, xs.min() - 6), min(w, xs.max() + 7)
    out = np.dstack([rgb.clip(0, 255), alpha[..., None] * 255])[y0:y1, x0:x1].round().astype(np.uint8)

    dest = Path(args.dest)
    plate = Image.fromarray(out, "RGBA")
    if dest.suffix.lower() == ".webp":
        plate.save(dest, "WEBP", quality=args.quality, method=6)
    else:
        plate.save(dest)
    print(f"{dest} ({plate.width}x{plate.height}, sheet {sheet.astype(int).tolist()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
