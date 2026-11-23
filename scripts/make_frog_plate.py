#!/usr/bin/env python3
"""Make plate-style frog illustrations from openly licensed photos.

The species grid shows birds as hand-cut 1800s plates. Most frogs have no old
plate, so this script makes one from a photo: it cuts the frog out (a rough
outline, refined by OpenCV's GrabCut), paints out wet-skin glints, and renders
it as a hand-coloured lithograph (soft washes, pen detail, hatching in the
shadows, a faded patch of ground, a paper halo).

Every frog is described in scripts/frog_plates.json: the photo's source and
licence, the crop, and the outline. Outlines are drawn by hand in pixels of
the working image (the crop, resized to work_width). The script downloads each
photo once into --cache, writes <key>.webp per frog and CREDITS.md into --out.

    python3 scripts/make_frog_plate.py --out prototype/art/frogs
    python3 scripts/make_frog_plate.py --out prototype/art/frogs --only crinia-signifera

Needs OpenCV, which the other scripts don't, so use a virtual environment:

    python3 -m venv ~/.venvs/soundscape-art
    ~/.venvs/soundscape-art/bin/pip install opencv-python-headless numpy pillow
    ~/.venvs/soundscape-art/bin/python scripts/make_frog_plate.py --out prototype/art/frogs

The output is an adaptation of the photo, so it carries the photo's licence
terms: credit the photographer, and share CC BY-SA sources under CC BY-SA.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

SPEC = Path(__file__).with_name("frog_plates.json")
USER_AGENT = "soundscape-atlas-art/1.0"
PAPER = np.array([229, 236, 240], np.float32)  # BGR of #F0ECE5, the halo colour of the bird cut-outs
INK = np.array([40, 52, 70], np.float32)       # BGR dark sepia
OUT_LICENCE = "CC BY-SA 4.0"


def disk(r: int) -> np.ndarray:
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def f32(a: np.ndarray) -> np.ndarray:
    return a.astype(np.float32)


def fetch(url: str, dest: Path) -> Path:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            dest.write_bytes(response.read())
    return dest


def working_image(photo: Path, crop, width: int) -> np.ndarray:
    """Crop, resize and round-trip through JPEG exactly as the outlines were drawn on."""
    image = Image.open(photo).convert("RGB")
    if crop:
        buffer = io.BytesIO()
        image.crop(tuple(crop)).save(buffer, "JPEG", quality=95)
        image = Image.open(io.BytesIO(buffer.getvalue())).convert("RGB")
    image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG")
    return cv2.imdecode(np.frombuffer(buffer.getvalue(), np.uint8), cv2.IMREAD_COLOR)


def cut_out(img: np.ndarray, poly) -> np.ndarray:
    h, w = img.shape[:2]
    inside = np.zeros((h, w), np.uint8)
    cv2.fillPoly(inside, [np.array(poly, np.int32)], 1)
    gc = np.full((h, w), cv2.GC_BGD, np.uint8)
    gc[cv2.dilate(inside, disk(14)) > 0] = cv2.GC_PR_BGD
    gc[inside > 0] = cv2.GC_PR_FGD
    gc[cv2.erode(inside, disk(22)) > 0] = cv2.GC_FGD
    cv2.grabCut(img, gc, None, np.zeros((1, 65)), np.zeros((1, 65)), 6, cv2.GC_INIT_WITH_MASK)
    mask = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    if n > 1:  # keep the frog, drop stray specks
        mask = np.where(labels == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]), 255, 0).astype(np.uint8)
    mask = cv2.morphologyEx(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, disk(6)), cv2.MORPH_OPEN, disk(3))
    holes = mask.copy()
    cv2.floodFill(holes, None, (0, 0), 255)
    mask = mask | cv2.bitwise_not(holes)
    return np.where(cv2.GaussianBlur(mask, (0, 0), 3.0) > 127, 255, 0).astype(np.uint8)


def lighten(bgr: np.ndarray, lift=26.0, gain=0.88, chroma=0.95, warm=3.0) -> np.ndarray:
    """A gentle, uniform lift that keeps each animal's true colour, like a printed plate."""
    lab = f32(cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB))
    L = lift + lab[..., 0] * gain
    L = np.minimum(L, 232 + (L - 232) * 0.4)
    A = 128 + (lab[..., 1] - 128) * chroma + 1.0
    B = 128 + (lab[..., 2] - 128) * chroma + warm
    return cv2.cvtColor(np.dstack([L, A, B]).clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def render(img: np.ndarray, frog: dict) -> np.ndarray:
    h, w = img.shape[:2]
    rng = np.random.default_rng(11)
    cv2.setRNGSeed(0)  # GrabCut draws on OpenCV's shared random state: reset it so each frog renders the same every run
    mask = cut_out(img, frog["poly"])
    src = img.copy()

    # Things lying across the frog, such as a grass stem: light, greyish, inside the outline.
    paint_out = frog.get("paint_out")
    if paint_out:
        x0, y0, x1, y1 = paint_out["box"]
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.int16)
        chroma = np.abs(lab[..., 1] - 128) + np.abs(lab[..., 2] - 128)
        stray = ((lab[..., 0] > paint_out["min_lightness"]) & (chroma < paint_out["max_chroma"])).astype(np.uint8) * 255
        box = np.zeros_like(stray)
        box[y0:y1, x0:x1] = 255
        inside = np.zeros((h, w), np.uint8)
        cv2.fillPoly(inside, [np.array(frog["poly"], np.int32)], 255)
        stray = cv2.dilate(stray & box & inside, disk(3))
        mask = cv2.morphologyEx(mask | stray, cv2.MORPH_CLOSE, disk(5))  # the stem left a gap in the cut-out
        src = cv2.inpaint(img, cv2.dilate(stray, disk(2)), 9, cv2.INPAINT_TELEA)

    # Wet-skin glints: plates show matte skin.
    lab = cv2.cvtColor(src, cv2.COLOR_BGR2LAB).astype(np.int16)
    chroma = np.abs(lab[..., 1] - 128) + np.abs(lab[..., 2] - 128)
    L = lab[..., 0]
    local = cv2.GaussianBlur(L.astype(np.float32), (0, 0), 6)
    glint = ((L > local + 28) & (L > 120) & (chroma < 60) & (mask > 0)).astype(np.uint8) * 255
    src = cv2.inpaint(src, cv2.dilate(glint, disk(2)), 6, cv2.INPAINT_TELEA)

    # Ground under the feet: ragged, fading out in every direction.
    perch_alpha = np.zeros((h, w), np.float32)
    if frog.get("perch"):
        depth = float(frog.get("perch_depth", 45))
        cols = np.where(mask.max(axis=0) > 0)[0]
        xmin, xmax = cols.min(), cols.max()
        low = np.full(w, -1.0, np.float32)
        for x in cols:
            low[x] = np.where(mask[:, x] > 0)[0].max()
        base = np.interp(np.arange(w), cols, cv2.GaussianBlur(low[cols][None], (0, 0), 25)[0]).astype(np.float32)
        margin = (xmax - xmin) * 0.14
        xx = np.arange(w, dtype=np.float32)
        taper = np.clip(np.minimum(xx - (xmin - margin), (xmax + margin) - xx) / ((xmax - xmin) * 0.22), 0, 1)
        taper = taper * taper * (3 - 2 * taper)
        dy = np.arange(h, dtype=np.float32)[:, None] - base[None, :]
        vert = np.where(dy < -18, 0.0, np.where(dy < 0, (dy + 18) / 18.0, np.exp(-dy / depth)))
        noise = cv2.GaussianBlur(f32(rng.normal(0, 1, (h, w))), (0, 0), 9)
        noise = (noise - noise.mean()) / (noise.std() + 1e-6)
        perch_alpha = np.clip((vert * taper[None, :] * (1.0 + noise * 0.45) - 0.22) * 1.7, 0, 1).astype(np.float32)
        perch_alpha[mask > 0] = 0
        perch_alpha = cv2.GaussianBlur(perch_alpha, (0, 0), 2.0) * 0.9

    # Colour: soft washes, pigment pooling at their edges, a little granulation.
    smooth = cv2.edgePreservingFilter(cv2.bilateralFilter(src, 7, 30, 5), flags=cv2.RECURS_FILTER, sigma_s=25, sigma_r=0.25)
    col = f32(lighten(smooth))
    sl = f32(cv2.cvtColor(smooth, cv2.COLOR_BGR2GRAY))
    grad = cv2.magnitude(cv2.Sobel(sl, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(sl, cv2.CV_32F, 0, 1, ksize=3))
    col *= 1 - 0.18 * np.clip(cv2.GaussianBlur(grad, (0, 0), 1.2) / 90.0, 0, 1)[..., None]
    gran = (cv2.GaussianBlur(f32(rng.normal(0, 1, (h, w))), (0, 0), 3) * 0.05
            + cv2.GaussianBlur(f32(rng.normal(0, 1, (h, w))), (0, 0), 0.8) * 0.03)
    col *= (1 + gran[..., None])

    # Line: pen strokes from the photo's fine dark detail, the outline, hatching in shadow.
    gray = f32(cv2.cvtColor(src, cv2.COLOR_BGR2GRAY))
    detail = gray - cv2.GaussianBlur(gray, (0, 0), 2.2)
    pen = np.clip((-detail - 1.5) / 19.0, 0, 1) ** 1.2
    pen = cv2.medianBlur((pen * 255).astype(np.uint8), 3).astype(np.float32) / 255
    pen = cv2.GaussianBlur(pen, (0, 0), 0.45)
    edge = cv2.GaussianBlur(f32(cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, disk(1))) / 255, (0, 0), 0.8)
    lum = f32(cv2.cvtColor(np.clip(col, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)) / 255
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    hatch = (np.sin((xx * 0.70 + yy * 0.72) * 1.15) > 0.55).astype(np.float32)
    hatch = cv2.GaussianBlur(hatch, (0, 0), 0.5) * np.clip((0.55 - lum) * 2.2, 0, 1) * 0.35
    lines = np.clip(pen * 0.8 + edge * 0.55 + hatch, 0, 1)[..., None]
    body = col * (1 - lines) + INK * lines

    # Paper, ground, frog and halo.
    paper_tex = (cv2.GaussianBlur(f32(rng.normal(0, 1, (h, w))), (0, 0), 2.5) * 4
                 + cv2.GaussianBlur(f32(rng.normal(0, 1, (h, w))), (0, 0), 0.6) * 2)
    paper = PAPER[None, None] + paper_tex[..., None]
    body = body * 0.94 + paper * 0.06
    alpha = cv2.GaussianBlur(mask, (0, 0), 1.1).astype(np.float32) / 255
    rgb = paper.copy()
    if frog.get("perch"):
        ground = f32(lighten(cv2.stylization(src, sigma_s=30, sigma_r=0.35), lift=120, gain=0.5, chroma=0.5))
        glines = np.clip(np.clip(-detail / 30.0, 0, 1) * 0.6, 0, 1)[..., None]
        ground = ground * (1 - glines) + INK * glines
        rgb = rgb * (1 - perch_alpha[..., None]) + ground * perch_alpha[..., None]
    rgb = rgb * (1 - alpha[..., None]) + body * alpha[..., None]
    halo = cv2.GaussianBlur(f32(cv2.dilate(mask, disk(16))) / 255, (0, 0), 3.5)
    a = np.clip(np.maximum.reduce([halo, alpha, np.clip(perch_alpha * 1.6, 0, 1)]), 0, 1)
    ys, xs = np.where(a > 0.03)
    y0, y1 = max(0, ys.min() - 6), min(h, ys.max() + 6)
    x0, x1 = max(0, xs.min() - 6), min(w, xs.max() + 6)
    return np.dstack([rgb.clip(0, 255), a * 255]).astype(np.uint8)[y0:y1, x0:x1]


def write_credits(spec: dict, out_dir: Path) -> None:
    lines = [
        "# Frog illustrations",
        "",
        "Plate-style renderings made by `scripts/make_frog_plate.py` from the photos below,",
        f"shared under {OUT_LICENCE}. Credit the photographers when reusing them.",
        "",
        "| File | Species | Photo | Photographer | Photo licence |",
        "|---|---|---|---|---|",
    ]
    for key, frog in spec.items():
        if key.startswith("_"):
            continue
        s = frog["source"]
        lines.append(f"| {key}.webp | {frog['common_name']} (*{frog['scientific_name']}*) | [{s['site']}]({s['page']}) | {s['author']} | {s['licence']} |")
    (out_dir / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Plate-style frog illustrations from openly licensed photos")
    parser.add_argument("--out", required=True, help="folder for <key>.webp and CREDITS.md")
    parser.add_argument("--cache", default=str(Path.home() / ".cache" / "soundscape-atlas" / "frog-photos"), help="where source photos are kept")
    parser.add_argument("--only", action="append", default=[], metavar="KEY", help="limit to a frog key (repeatable)")
    parser.add_argument("--png", action="store_true", help="write PNG instead of WebP")
    args = parser.parse_args()

    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = Path(args.cache)
    for key, frog in spec.items():
        if key.startswith("_") or (args.only and key not in args.only):
            continue
        url = frog["source"]["url"]
        photo = fetch(url, cache / f"{key}{Path(url.split('?')[0]).suffix.lower() or '.jpg'}")
        plate = render(working_image(photo, frog.get("crop"), int(frog.get("work_width", 1000))), frog)
        dest = out_dir / f"{key}.{'png' if args.png else 'webp'}"
        params = [] if args.png else [cv2.IMWRITE_WEBP_QUALITY, 90]
        if not cv2.imwrite(str(dest), plate, params):
            print(f"error: could not write {dest}", file=sys.stderr)
            return 1
        print(f"{dest} ({plate.shape[1]}x{plate.shape[0]})")
    write_credits(spec, out_dir)
    print(f"{out_dir / 'CREDITS.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
