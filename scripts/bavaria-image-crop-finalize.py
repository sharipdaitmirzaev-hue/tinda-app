#!/usr/bin/env python3
"""Finalize Bavaria single-pack crops + image-only dry-run manifest (no production apply).

Reads:
  artifacts/bavaria-import/image-completion-2026-07-31/
  artifacts/bavaria-import/2026-07-31T11-47-10-496Z-pdf-ingest/renders/

Writes:
  processed/{sku}.webp (+ .png)
  contact-sheet.html / contact-sheet.jpg
  updated inventory + image-update-manifest.json
  FINAL-DRY-RUN-REPORT.md
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "artifacts/bavaria-import/image-completion-2026-07-31"
SRC = BASE / "source-downloads"
PDF = ROOT / "artifacts/bavaria-import/2026-07-31T11-47-10-496Z-pdf-ingest/renders"
OUT = BASE / "processed"
PREV = BASE / "previews"
CANVAS = 1000

# ---------------------------------------------------------------------------
# Crop map: sku -> job
# job kinds:
#   single: full image (optional box fractions)
#   index: split source into N equal content columns; take index
#   segs: use natural/equal segments; take index from n_expected
#   box: explicit (x0,y0,x1,y1) fractions of source
# ---------------------------------------------------------------------------

SITE = {
    # Cola LE PET pair (L=1.5, R=0.5) — NOT glass CLASSIC 92
    "BAVARIA-COLALE-COLA-LE-1500-PET": ("segs", "91_1726224649.png", 2, 0, "high", "official_site"),
    "BAVARIA-COLALE-COLA-LE-500-PET": ("segs", "91_1726224649.png", 2, 1, "high", "official_site"),
    # Regular soda 1.5 — 6 bottles; need Кола = index 5
    "BAVARIA-BAVARIYA-KOLA-1500-PET": ("equal", "95_1730364037.jpg", 6, 5, "high", "official_site"),
    # Regular soda 0.5 — Кола = index 2
    "BAVARIA-BAVARIYA-KOLA-500-PET": ("segs", "97_1730364236.jpg", 3, 2, "high", "official_site"),
    # Premium glass — Вишня = index 5
    "BAVARIA-BAVARIYA-PREMIUM-VISHNYA-500-GLASS": ("segs", "22_1730373939.jpg", 6, 5, "high", "official_site"),
    # Premium PET 1.2 — Вишня = index 4
    "BAVARIA-BAVARIYA-PREMIUM-VISHNYA-1200-PET": ("segs", "126_1772458839.png", 5, 4, "high", "official_site"),
    # Limnada Барбарис
    "BAVARIA-LIMNADA-BARBARIS-1500-PET": ("segs", "58_1718608488.jpg", 4, 2, "high", "official_site"),
    "BAVARIA-LIMNADA-BARBARIS-500-PET": ("segs", "68_1718376439.jpg", 3, 2, "high", "official_site"),
    # Dreamix flavor trios: PET1.5, PET0.5, CAN
    "BAVARIA-DREAMIX-KLYUKVA-APELSIN-1500-PET": ("segs", "98_1743082462.jpg", 3, 0, "high", "official_site"),
    "BAVARIA-DREAMIX-KLYUKVA-APELSIN-500-PET": ("segs", "98_1743082462.jpg", 3, 1, "high", "official_site"),
    "BAVARIA-DREAMIX-KLYUKVA-APELSIN-330-CAN": ("segs", "98_1743082462.jpg", 3, 2, "high", "official_site"),
    "BAVARIA-DREAMIX-KOLA-TSITRUS-1500-PET": ("segs", "100_1743082523.jpg", 3, 0, "high", "official_site"),
    "BAVARIA-DREAMIX-KOLA-TSITRUS-500-PET": ("segs", "100_1743082523.jpg", 3, 1, "high", "official_site"),
    "BAVARIA-DREAMIX-KOLA-TSITRUS-330-CAN": ("segs", "100_1743082523.jpg", 3, 2, "high", "official_site"),
    "BAVARIA-DREAMIX-TAYGA-1500-PET": ("segs", "101_1743082539.jpg", 3, 0, "high", "official_site"),
    "BAVARIA-DREAMIX-TAYGA-500-PET": ("segs", "101_1743082539.jpg", 3, 1, "high", "official_site"),
    "BAVARIA-DREAMIX-TAYGA-330-CAN": ("segs", "101_1743082539.jpg", 3, 2, "high", "official_site"),
    "BAVARIA-DREAMIX-MOHITO-1500-PET": ("segs", "102_1743082553.jpg", 3, 0, "high", "official_site"),
    "BAVARIA-DREAMIX-MOHITO-500-PET": ("segs", "102_1743082553.jpg", 3, 1, "high", "official_site"),
    "BAVARIA-DREAMIX-MOHITO-330-CAN": ("segs", "102_1743082553.jpg", 3, 2, "high", "official_site"),
    # Dreamix Indian Tonic glass + PET
    "BAVARIA-DREAMIX-INDIAN-TONIK-330-GLASS": ("equal", "127_1775207748.png", 2, 0, "high", "official_site"),
    "BAVARIA-DREAMIX-INDIAN-TONIK-1000-PET": ("equal", "127_1775207748.png", 2, 1, "high", "official_site"),
    # Dobretsov Хлебный group: large PET, mid PET, can
    "BAVARIA-DOBRETSOV-HLEBNYY-2000-PET": ("segs", "76_1783510510.jpg", 3, 0, "high", "official_site"),
    "BAVARIA-DOBRETSOV-HLEBNYY-1420-PET": ("segs", "76_1783510510.jpg", 3, 1, "medium", "official_site"),
    "BAVARIA-DOBRETSOV-HLEBNYY-450-CAN": ("segs", "76_1783510510.jpg", 3, 2, "high", "official_site"),
    # Бочковой 2L single packshot
    "BAVARIA-DOBRETSOV-BOCHKOVOY-2000-PET": ("single", "139_1783501193.png", None, None, "high", "official_site"),
    # Mountea PET: wild berries large/small = 0,1 (peach 2,3 unused for missing list except can)
    "BAVARIA-MOUNTEA-LESNYE-YAGODY-1500-PET": ("equal", "28_1758711718.png", 4, 0, "high", "official_site"),
    "BAVARIA-MOUNTEA-LESNYE-YAGODY-500-PET": ("equal", "28_1758711718.png", 4, 1, "high", "official_site"),
    # Mountea cans: peach = right
    "BAVARIA-MOUNTEA-PERSIK-330-CAN": ("segs", "67_1758711780.png", 2, 1, "high", "official_site"),
    # Rocket Ride can+PET pairs
    "BAVARIA-ROCKET-RIDE-CLASSIC-450-CAN": ("segs", "105_1757076183.png", 2, 0, "high", "official_site"),
    "BAVARIA-ROCKET-RIDE-CLASSIC-500-PET": ("segs", "105_1757076183.png", 2, 1, "high", "official_site"),
    "BAVARIA-ROCKET-RIDE-MANGO-APRICOT-450-CAN": ("segs", "106_1757076512.png", 2, 0, "high", "official_site"),
    "BAVARIA-ROCKET-RIDE-MANGO-APRICOT-500-PET": ("segs", "106_1757076512.png", 2, 1, "high", "official_site"),
    "BAVARIA-ROCKET-RIDE-KIVI-YABLOKO-450-CAN": ("segs", "107_1757076818.png", 2, 0, "high", "official_site"),
    "BAVARIA-ROCKET-RIDE-KIVI-YABLOKO-500-PET": ("segs", "107_1757076818.png", 2, 1, "high", "official_site"),
    "BAVARIA-ROCKET-RIDE-DIKIE-YAGODY-450-CAN": ("segs", "108_1757077083.png", 2, 0, "high", "official_site"),
    "BAVARIA-ROCKET-RIDE-DIKIE-YAGODY-500-PET": ("segs", "108_1757077083.png", 2, 1, "high", "official_site"),
    "BAVARIA-ROCKET-RIDE-LAYM-LEMONGRAS-450-CAN": ("segs", "109_1757077306.png", 2, 0, "high", "official_site"),
    "BAVARIA-ROCKET-RIDE-LAYM-LEMONGRAS-500-PET": ("segs", "109_1757077306.png", 2, 1, "high", "official_site"),
}

# PDF explicit boxes (fractions). Source file is page-XX.png under PDF/
# Coordinates tuned from grid overlays on 1016×1464 renders.
PDF_BOXES = {
    # p.11 NA beer — Elf can; Gallagher glass+can under 0% stamp (NOT alcoholic site art)
    "BAVARIA-BAVARIYA-ELF-450-CAN": ("box", "page-11.png", (0.50, 0.26, 0.61, 0.49), "medium", "pdf_page_11"),
    "BAVARIA-BAVARIYA-GALLAGHER-NA-450-GLASS": ("box", "page-11.png", (0.69, 0.18, 0.80, 0.49), "medium", "pdf_page_11"),
    "BAVARIA-BAVARIYA-GALLAGHER-NA-450-CAN": ("box", "page-11.png", (0.79, 0.26, 0.91, 0.49), "medium", "pdf_page_11"),
    # Nordisch: bottle shown but SKU is CAN / glass is manual — do NOT apply (no unique can packshot)
    # p.13 Dobretsov — distinct Бочковой 1.42 (leftmost; not 2L)
    "BAVARIA-DOBRETSOV-BOCHKOVOY-1420-PET": ("box", "page-13.png", (0.07, 0.57, 0.23, 0.96), "high", "pdf_page_13"),
    # p.14 Premium Виноград — glass row 7/7, PET row 6/6
    "BAVARIA-BAVARIYA-PREMIUM-VINOGRAD-500-GLASS": ("box", "page-14.png", (0.80, 0.30, 0.96, 0.58), "high", "pdf_page_14"),
    "BAVARIA-BAVARIYA-PREMIUM-VINOGRAD-1200-PET": ("box", "page-14.png", (0.77, 0.58, 0.93, 0.95), "high", "pdf_page_14"),
    # p.15 glass 0.45 mid-row (avoid flavor-name text above)
    "BAVARIA-BAVARIYA-MOHITO-450-GLASS": ("box", "page-15.png", (0.13, 0.47, 0.25, 0.69), "medium", "pdf_page_15"),
    "BAVARIA-BAVARIYA-PITAHAYYA-450-GLASS": ("box", "page-15.png", (0.24, 0.47, 0.36, 0.69), "medium", "pdf_page_15"),
    "BAVARIA-BAVARIYA-TARHUN-450-GLASS": ("box", "page-15.png", (0.35, 0.47, 0.48, 0.69), "medium", "pdf_page_15"),
    "BAVARIA-BAVARIYA-GRUSHA-450-GLASS": ("box", "page-15.png", (0.47, 0.47, 0.60, 0.69), "medium", "pdf_page_15"),
    # p.15 Яблоко 1.5 PET (rightmost bottom)
    "BAVARIA-BAVARIYA-YABLOKO-1500-PET": ("box", "page-15.png", (0.78, 0.68, 0.94, 0.98), "medium", "pdf_page_15"),
    # p.18 Cola LE can 0.33 — glass 0.45 still reads CLASSIC → excluded from apply
    "BAVARIA-COLALE-COLA-LE-330-CAN": ("box", "page-18.png", (0.80, 0.68, 0.90, 0.95), "high", "pdf_page_18"),
    # p.21 Dreamix tonic cans (Bitter Lemon left group can; Indian right group can)
    "BAVARIA-DREAMIX-BITTER-LEMON-330-CAN": ("box", "page-21.png", (0.38, 0.48, 0.50, 0.88), "high", "pdf_page_21"),
    "BAVARIA-DREAMIX-INDIAN-TONIK-330-CAN": ("box", "page-21.png", (0.80, 0.48, 0.93, 0.88), "high", "pdf_page_21"),
    # p.24 Mountea Лайм-мята bottom-right group
    "BAVARIA-MOUNTEA-LAYM-MYATA-1500-PET": ("box", "page-24.png", (0.50, 0.67, 0.63, 0.96), "high", "pdf_page_24"),
    "BAVARIA-MOUNTEA-LAYM-MYATA-500-PET": ("box", "page-24.png", (0.63, 0.73, 0.73, 0.96), "high", "pdf_page_24"),
    "BAVARIA-MOUNTEA-LAYM-MYATA-330-CAN": ("box", "page-24.png", (0.72, 0.78, 0.83, 0.96), "high", "pdf_page_24"),
}

# Explicit exclusions from apply (even if a crop exists for QA)
EXCLUDE_FROM_APPLY = {
    # Nordisch NA can: no unique can packshot (bottle vs CAN icon conflict)
    "BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN": (
        "PDF shows bottle; icon CAN-only — no unique can packshot; alcoholic site art forbidden"
    ),
    # Cola LE glass: site 92 AND PDF p.18 glass face still read CLASSIC — LE not proven
    "BAVARIA-COLALE-COLA-LE-450-GLASS": (
        "Glass face reads CLASSIC on site 92 and PDF p.18 crop — LE correspondence not proven; excluded"
    ),
}

MANUAL_SKUS = {
    "BAVARIA-BAVARIYA-NORDISCH-NA-450-GLASS",
    "BAVARIA-BAVARIYA-APELSIN-450-GLASS",
    "BAVARIA-BAVARIYA-KOLA-450-GLASS",
    "BAVARIA-BAVARIYA-YABLOKO-450-GLASS",
    "BAVARIA-TBAU-SPORT-MANUAL",
}


def load_rgb(path: Path) -> Image.Image:
    im = Image.open(path)
    if im.mode in ("P", "RGBA", "LA"):
        rgba = im.convert("RGBA")
        # Detect dominant corner for composite bg
        corners = [
            rgba.getpixel((2, 2)),
            rgba.getpixel((rgba.width - 3, 2)),
            rgba.getpixel((2, rgba.height - 3)),
            rgba.getpixel((rgba.width - 3, rgba.height - 3)),
        ]
        avg = sum(sum(c[:3]) / 3 for c in corners) / 4
        bg = (0, 0, 0, 255) if avg < 40 else (255, 255, 255, 255)
        # green bg keep as-is for analysis
        base = Image.new("RGBA", rgba.size, bg)
        base.alpha_composite(rgba)
        return base.convert("RGB")
    return im.convert("RGB")


def is_dark_bg(im: Image.Image) -> bool:
    w, h = im.size
    px = im.load()
    corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
    avg = sum(sum(c) / 3 for c in corners) / 4
    return avg < 45


def is_green_bg(im: Image.Image) -> bool:
    w, h = im.size
    px = im.load()
    corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
    return all(c[1] > c[0] + 15 and c[1] > c[2] + 15 and c[1] > 80 for c in corners)


def is_fg(px, x, y, dark: bool, green: bool) -> bool:
    r, g, b = px[x, y]
    if dark:
        return (r + g + b) / 3 > 30
    if green:
        return not (g > r + 15 and g > b + 15 and g > 90)
    return not (r > 232 and g > 232 and b > 232)


def content_bbox(im: Image.Image, dark: bool | None = None, green: bool | None = None):
    if dark is None:
        dark = is_dark_bg(im)
    if green is None:
        green = is_green_bg(im) and not dark
    w, h = im.size
    px = im.load()
    xs, ys = [], []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if is_fg(px, x, y, dark, green):
                xs.append(x)
                ys.append(y)
    if not xs:
        return (0, 0, w, h)
    pad = max(6, int(min(w, h) * 0.015))
    return (
        max(0, min(xs) - pad),
        max(0, min(ys) - pad),
        min(w, max(xs) + pad),
        min(h, max(ys) + pad),
    )


def col_occ(im: Image.Image, dark: bool, green: bool) -> list[int]:
    w, h = im.size
    px = im.load()
    occ = []
    for x in range(w):
        c = 0
        for y in range(0, h, 2):
            if is_fg(px, x, y, dark, green):
                c += 1
        occ.append(c)
    return occ


def find_segments(occ: list[int], n_expected: int | None = None) -> list[tuple[int, int]]:
    w = len(occ)
    mx = max(occ) or 1
    thr = mx * 0.12
    runs = []
    i = 0
    while i < w:
        if occ[i] > thr:
            j = i
            while j < w and occ[j] > thr:
                j += 1
            if j - i > w * 0.03:
                runs.append([i, j])
            i = j
        else:
            i += 1
    merged: list[list[int]] = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < w * 0.012:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    segs = [(a, b) for a, b in merged]
    if n_expected is None:
        return segs
    if len(segs) == n_expected:
        return segs
    # equal split across full content span
    if segs:
        L, R = segs[0][0], segs[-1][1]
    else:
        L, R = 0, w
    step = (R - L) / n_expected
    return [(int(L + i * step), int(L + (i + 1) * step)) for i in range(n_expected)]


def equal_segments(occ: list[int], n: int) -> list[tuple[int, int]]:
    w = len(occ)
    mx = max(occ) or 1
    thr = mx * 0.08
    xs = [i for i, v in enumerate(occ) if v > thr]
    if not xs:
        L, R = 0, w
    else:
        L, R = xs[0], xs[-1] + 1
    step = (R - L) / n
    return [(int(L + i * step), int(L + (i + 1) * step)) for i in range(n)]


def neutralize_catalog_bg(im: Image.Image) -> Image.Image:
    """Turn solid green / peach catalog page backgrounds into white."""
    out = im.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            # bright green page
            if g > r + 18 and g > b + 18 and g > 95 and (r + b) < 300:
                px[x, y] = (255, 255, 255)
                continue
            # peach / beige floral page (Dobretsov)
            if r > 200 and g > 170 and b > 150 and abs(r - g) < 55 and b < g + 10 and (r + g + b) / 3 > 190:
                px[x, y] = (255, 255, 255)
                continue
            # light green leaf watermark
            if r > 210 and g > 220 and b > 210 and g >= r and g >= b and (g - min(r, b)) < 40:
                if (r + g + b) / 3 > 225:
                    px[x, y] = (255, 255, 255)
    return out


def largest_component_bbox(im: Image.Image, dark: bool = False) -> tuple[int, int, int, int]:
    """Keep the largest foreground blob (drops neighbor slivers / stray text)."""
    w, h = im.size
    px = im.load()
    visited = bytearray(w * h)
    best = None
    best_area = 0

    def fg(x, y):
        r, g, b = px[x, y]
        if dark:
            return (r + g + b) / 3 > 30
        return not (r > 245 and g > 245 and b > 245)

    for y0 in range(0, h, 2):
        for x0 in range(0, w, 2):
            idx = y0 * w + x0
            if visited[idx] or not fg(x0, y0):
                continue
            stack = [(x0, y0)]
            visited[idx] = 1
            minx = maxx = x0
            miny = maxy = y0
            area = 0
            while stack:
                x, y = stack.pop()
                area += 1
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
                for nx, ny in ((x - 2, y), (x + 2, y), (x, y - 2), (x, y + 2)):
                    if 0 <= nx < w and 0 <= ny < h:
                        nidx = ny * w + nx
                        if not visited[nidx] and fg(nx, ny):
                            visited[nidx] = 1
                            stack.append((nx, ny))
            # prefer tall product-like blobs near horizontal center
            bw = maxx - minx + 1
            bh = maxy - miny + 1
            if bh < h * 0.25 or bw < w * 0.15:
                continue
            cx = (minx + maxx) / 2
            center_bonus = 1.0 - abs(cx - w / 2) / (w / 2 + 1e-6) * 0.35
            score = area * center_bonus * (bh / max(bw, 1))
            if score > best_area:
                best_area = score
                best = (minx, miny, maxx + 1, maxy + 1)
    if best is None:
        return content_bbox(im, dark=dark, green=False)
    pad = max(4, int(min(w, h) * 0.02))
    return (
        max(0, best[0] - pad),
        max(0, best[1] - pad),
        min(w, best[2] + pad),
        min(h, best[3] + pad),
    )


def crop_pad_save(
    im: Image.Image,
    box,
    out_stem: Path,
    dark: bool | None = None,
    green: bool | None = None,
    isolate: bool = False,
) -> Path:
    x0, y0, x1, y1 = [int(v) for v in box]
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(im.width, x1)
    y1 = min(im.height, y1)
    crop = im.crop((x0, y0, x1, y1))
    if dark is None:
        dark = is_dark_bg(im)
    if green is None:
        green = is_green_bg(im) and not dark

    if isolate or green:
        crop = neutralize_catalog_bg(crop)
        dark = False
        green = False
        # Prefer simple content bbox; component isolation only if it keeps enough pixels
        bb = content_bbox(crop, dark=False, green=False)
        cand = crop.crop(bb)
        try:
            bb2 = largest_component_bbox(cand, dark=False)
            isolated = cand.crop(bb2)
            # reject over-aggressive isolation (tiny / empty remnants)
            if isolated.width >= 40 and isolated.height >= 80 and isolated.width * isolated.height >= 0.25 * cand.width * cand.height:
                crop = isolated
            else:
                crop = cand
        except Exception:
            crop = cand
    else:
        bb = content_bbox(crop, dark=dark, green=green)
        crop = crop.crop(bb)

    cw, ch = crop.size
    scale = min((CANVAS * 0.88) / max(cw, 1), (CANVAS * 0.92) / max(ch, 1))
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    bg = (0, 0, 0) if dark else (255, 255, 255)
    canvas = Image.new("RGB", (CANVAS, CANVAS), bg)
    canvas.paste(crop, ((CANVAS - nw) // 2, (CANVAS - nh) // 2))
    out_stem.parent.mkdir(parents=True, exist_ok=True)
    webp = out_stem.with_suffix(".webp")
    canvas.save(webp, "WEBP", quality=90, method=6)
    return webp


def process_job(sku: str, job: tuple) -> dict:
    kind = job[0]
    if kind == "box":
        _, page, box, conf, source = job
        path = PDF / page
        im = load_rgb(path)
        dark = is_dark_bg(im)
        green = is_green_bg(im) and not dark
        W, H = im.size
        abs_box = (box[0] * W, box[1] * H, box[2] * W, box[3] * H)
        out = crop_pad_save(im, abs_box, OUT / sku, dark=dark, green=green, isolate=True)
        return {
            "sku": sku,
            "source_file": str(path.relative_to(ROOT)),
            "source": source,
            "method": "pdf_box",
            "confidence": conf,
            "local_processed_path": str(out.relative_to(ROOT)),
            "bytes": out.stat().st_size,
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
            "size": list(Image.open(out).size),
            "mime": "image/webp",
        }

    _, fname, n, idx, conf, source = job
    path = SRC / fname
    im = load_rgb(path)
    dark = is_dark_bg(im)
    green = is_green_bg(im) and not dark

    if kind == "single":
        out = crop_pad_save(im, (0, 0, im.width, im.height), OUT / sku, dark=dark, green=green)
        return {
            "sku": sku,
            "source_file": str(path.relative_to(ROOT)),
            "source": source,
            "method": "site_single",
            "confidence": conf,
            "local_processed_path": str(out.relative_to(ROOT)),
            "bytes": out.stat().st_size,
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
            "size": list(Image.open(out).size),
            "mime": "image/webp",
        }

    bb = content_bbox(im, dark=dark, green=green)
    imc = im.crop(bb)
    occ = col_occ(imc, dark, green)
    if kind == "equal":
        segs = equal_segments(occ, n)
    else:
        segs = find_segments(occ, n_expected=n)
    sx0, sx1 = segs[idx]
    pad = max(2, int((sx1 - sx0) * 0.02))
    box = (bb[0] + sx0 + pad, bb[1], bb[0] + sx1 - pad, bb[3])
    out = crop_pad_save(im, box, OUT / sku, dark=dark, green=green)
    return {
        "sku": sku,
        "source_file": str(path.relative_to(ROOT)),
        "source": source,
        "method": f"site_{kind}",
        "confidence": conf,
        "local_processed_path": str(out.relative_to(ROOT)),
        "bytes": out.stat().st_size,
        "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
        "size": list(Image.open(out).size),
        "mime": "image/webp",
    }


def qa_file(path: Path) -> dict:
    ok = True
    notes = []
    try:
        im = Image.open(path)
        im.verify()
        im = Image.open(path)
        w, h = im.size
        mime = Image.MIME.get(im.format or "", mimetypes.guess_type(path.name)[0] or "")
        if path.suffix.lower() == ".webp" and "webp" not in (mime or "").lower():
            mime = "image/webp"
        size = path.stat().st_size
        if size < 5_000:
            ok = False
            notes.append("file_too_small")
        if size > 2_500_000:
            notes.append("file_large")
        if min(w, h) < 400:
            ok = False
            notes.append("dimension_too_small")
        if abs(w - h) > 40:
            notes.append("not_square_canvas")
        return {
            "ok": ok,
            "mime": mime or "image/webp",
            "width": w,
            "height": h,
            "bytes": size,
            "notes": notes,
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "notes": ["unreadable"]}


def build_contact_sheet(results: list[dict], names: dict[str, str]) -> None:
    PREV.mkdir(exist_ok=True)
    # HTML
    cards = []
    for r in sorted(results, key=lambda x: x["sku"]):
        rel = Path(r["local_processed_path"]).name
        # copy small preview
        src = ROOT / r["local_processed_path"]
        thumb = PREV / f"{r['sku']}.jpg"
        im = Image.open(src).convert("RGB")
        im.thumbnail((280, 280), Image.Resampling.LANCZOS)
        im.save(thumb, "JPEG", quality=85)
        name = names.get(r["sku"], "")
        cards.append(
            f'<div class="card"><img src="previews/{r["sku"]}.jpg" alt="{r["sku"]}"/>'
            f"<div><code>{r['sku']}</code><br/>{name}<br/>"
            f"<small>{r['source']} · {r['confidence']} · {r['bytes']} B</small></div></div>"
        )
    html = f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/><title>Bavaria image crops contact sheet</title>
<style>
body{{font-family:system-ui,sans-serif;margin:24px;background:#f6f6f6}}
h1{{font-size:20px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}}
.card{{background:#fff;border:1px solid #ddd;padding:10px;border-radius:6px}}
.card img{{width:100%;height:200px;object-fit:contain;background:#fff}}
code{{font-size:11px}}
</style></head><body>
<h1>Bavaria final crops — {len(results)} images (dry-run, no production apply)</h1>
<div class="grid">{"".join(cards)}</div>
</body></html>"""
    (BASE / "contact-sheet.html").write_text(html, encoding="utf-8")

    # JPG contact sheet (multi-page rows)
    cols = 6
    cell = 220
    rows = (len(results) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 48)), (245, 245, 245))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
    except Exception:
        font = ImageFont.load_default()
    for i, r in enumerate(sorted(results, key=lambda x: x["sku"])):
        rr, cc = divmod(i, cols)
        x, y = cc * cell, rr * (cell + 48)
        im = Image.open(ROOT / r["local_processed_path"]).convert("RGB")
        im.thumbnail((cell - 10, cell - 10), Image.Resampling.LANCZOS)
        sheet.paste(im, (x + (cell - im.width) // 2, y + 4))
        label = r["sku"].replace("BAVARIA-", "")
        draw.text((x + 4, y + cell - 2), label[:34], fill=(20, 20, 20), font=font)
    sheet.save(BASE / "contact-sheet.jpg", "JPEG", quality=88)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    # clean previous processed
    for p in OUT.glob("*"):
        if p.is_file():
            p.unlink()

    inv = json.loads((BASE / "missing-images-inventory.json").read_text())
    names = {r["sku"]: r.get("name", "") for r in inv}

    jobs = {**SITE, **PDF_BOXES}
    results = []
    errors = []
    for sku, job in sorted(jobs.items()):
        try:
            results.append(process_job(sku, job))
            print("OK", sku)
        except Exception as e:
            errors.append({"sku": sku, "error": str(e)})
            print("ERR", sku, e)

    # QA
    qa = {}
    for r in results:
        qa[r["sku"]] = qa_file(ROOT / r["local_processed_path"])
        r["qa"] = qa[r["sku"]]

    # Detect duplicate sha among processed
    by_hash: dict[str, list[str]] = {}
    for r in results:
        by_hash.setdefault(r["sha256"], []).append(r["sku"])
    dup_hashes = {h: skus for h, skus in by_hash.items() if len(skus) > 1}

    apply_results = [
        r
        for r in results
        if r["sku"] not in EXCLUDE_FROM_APPLY
        and r["sku"] not in MANUAL_SKUS
        and r.get("qa", {}).get("ok")
    ]

    # Update inventory rows
    result_by_sku = {r["sku"]: r for r in results}
    for row in inv:
        sku = row["sku"]
        if sku in result_by_sku and sku not in EXCLUDE_FROM_APPLY:
            r = result_by_sku[sku]
            row["review_status"] = "confirmed_ready"
            row["match_confidence"] = r["confidence"]
            row["local_processed_path"] = r["local_processed_path"]
            row["processed_source"] = r["source"]
            row["notes"] = (row.get("notes") or "") + f" | Final crop from {r['source']} ({r['method']})"
        elif sku in EXCLUDE_FROM_APPLY:
            row["review_status"] = "excluded"
            row["match_confidence"] = "low"
            row["local_processed_path"] = None
            row["notes"] = EXCLUDE_FROM_APPLY[sku]
    # Ensure disputed notes
    for row in inv:
        if row["sku"] == "BAVARIA-COLALE-COLA-LE-450-GLASS":
            row["review_status"] = "excluded"
            row["match_confidence"] = "low"
            row["local_processed_path"] = None
            row["notes"] = EXCLUDE_FROM_APPLY[row["sku"]]
        if row["sku"] == "BAVARIA-DOBRETSOV-BOCHKOVOY-1420-PET" and row["sku"] in result_by_sku:
            row["review_status"] = "confirmed_ready"
            row["match_confidence"] = "high"
            row["notes"] = (
                "Distinct 1.42 PET on PDF p.13 (not 2L site art). Included in image-only apply list."
            )
        if row["sku"] in {
            "BAVARIA-BAVARIYA-GALLAGHER-NA-450-GLASS",
            "BAVARIA-BAVARIYA-GALLAGHER-NA-450-CAN",
        } and row["sku"] in result_by_sku:
            row["review_status"] = "confirmed_ready"
            row["notes"] = (
                "PDF p.11 under 0% NA stamp — not alcoholic site art (103_/140_ forbidden)."
            )
        if row["sku"] == "BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN":
            row["review_status"] = "excluded"
            row["local_processed_path"] = None
            row["notes"] = EXCLUDE_FROM_APPLY[row["sku"]]

    # Manifest — image-only confirmed ready
    manifest_items = []
    for r in sorted(apply_results, key=lambda x: x["sku"]):
        inv_row = next(x for x in inv if x["sku"] == r["sku"])
        # preserve original product fields untouched — only image_url
        src_url = None
        if inv_row.get("candidate_image_urls"):
            src_url = inv_row["candidate_image_urls"][0]
        elif r["source"].startswith("pdf_"):
            src_url = f"pdf:{r['source_file']}"
        manifest_items.append(
            {
                "sku": r["sku"],
                "action": "update_image_only",
                "match_confidence": r["confidence"],
                "review_status": "confirmed_ready",
                "source_priority": r["source"],
                "source_image_url": src_url,
                "downloaded_source_path": r["source_file"]
                if r["source"] == "official_site"
                else r["source_file"],
                "local_processed_path": r["local_processed_path"],
                "requires_crop": False,
                "fields_to_change": ["image_url"],
                "fields_forbidden": [
                    "category_id",
                    "price_amount",
                    "sales_status",
                    "is_active",
                    "name",
                    "sku",
                    "orderable",
                    "availability",
                    "category",
                ],
                "processed_sha256": r["sha256"],
                "processed_bytes": r["bytes"],
                "qa_ok": True,
                "notes": inv_row.get("notes"),
            }
        )

    created = datetime.now(timezone.utc).isoformat()
    manifest = {
        "mode": "dry-run",
        "kind": "image_update_only",
        "created_at": created,
        "production_apply_executed": False,
        "item_count": len(manifest_items),
        "fields_changed_per_item": ["image_url"],
        "confirmation_required_before_apply": True,
        "items": manifest_items,
    }

    status_counts: dict[str, int] = {}
    for row in inv:
        k = row.get("review_status") or "unknown"
        status_counts[k] = status_counts.get(k, 0) + 1

    remaining_without = [
        r["sku"]
        for r in inv
        if r.get("review_status") not in {"confirmed_ready"}
    ]

    meta = {
        "created_at": created,
        "branch": "cursor/bavaria-missing-images-ad60",
        "production_db_modified": False,
        "production_apply_executed": False,
        "final_images_ready": len(apply_results),
        "crops_produced_total": len(results),
        "remaining_without_image": len(remaining_without),
        "remaining_skus": remaining_without,
        "excluded": EXCLUDE_FROM_APPLY,
        "manual_keep": len(MANUAL_SKUS),
        "image_only_apply_records": len(manifest_items),
        "fields_changed": ["image_url"],
        "duplicate_processed_hashes": dup_hashes,
        "errors": errors,
        "status_counts": status_counts,
    }

    # Write artifacts
    (BASE / "missing-images-inventory.json").write_text(
        json.dumps(inv, ensure_ascii=False, indent=2) + "\n"
    )
    # CSV refresh
    import csv

    fields = list(inv[0].keys())
    with open(BASE / "missing-images-inventory.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in inv:
            rr = dict(row)
            for k in (
                "imaged_sibling_skus",
                "candidate_image_urls",
                "downloaded_source_paths",
            ):
                if isinstance(rr.get(k), list):
                    rr[k] = "|".join(rr[k])
            w.writerow(rr)

    (BASE / "image-update-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    (BASE / "crop-results.json").write_text(
        json.dumps({"results": results, "errors": errors, "qa_dupes": dup_hashes}, ensure_ascii=False, indent=2)
        + "\n"
    )
    (BASE / "inventory-meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")

    build_contact_sheet(results, names)

    # Report
    disputed = [
        (
            "BAVARIA-COLALE-COLA-LE-450-GLASS",
            EXCLUDE_FROM_APPLY["BAVARIA-COLALE-COLA-LE-450-GLASS"],
        ),
        (
            "BAVARIA-DOBRETSOV-BOCHKOVOY-1420-PET / site 2L-only",
            "Excluded 2L reuse; PDF p.13 distinct 1.42 used",
        ),
        (
            "Gallagher/Nordisch alcoholic site art (103_/140_)",
            "Never used; Gallagher NA from PDF p.11 0% stamp",
        ),
        (
            "BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN",
            EXCLUDE_FROM_APPLY["BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN"],
        ),
    ]
    manual_lines = "\n".join(f"- `{s}`" for s in sorted(MANUAL_SKUS))
    rem_lines = "\n".join(f"- `{s}`" for s in remaining_without)

    report = f"""# Bavaria image completion — FINAL dry-run report

**Branch:** `cursor/bavaria-missing-images-ad60`  
**Date:** {created}  
**Production DB modified:** **no**  
**Production apply:** **not executed** (awaiting explicit confirmation)

---

## Headline numbers

| Metric | Count |
|--------|------:|
| Final single-pack images produced | **{len(results)}** |
| Confirmed image-only apply records | **{len(manifest_items)}** |
| Products remaining without image | **{len(remaining_without)}** |
| Manual positions (not in apply) | **5** |
| Excluded / disputed (not in apply) | **{len(EXCLUDE_FROM_APPLY)}** (+ CLASSIC site asset unused) |
| Fields changed by apply | **`image_url` only** |

---

## Apply confirmation

- Manifest: `image-update-manifest.json`
- Mode: `dry-run` / `image_update_only`
- `item_count`: **{len(manifest_items)}**
- Every item: `fields_to_change = ["image_url"]`
- Forbidden: name, category, price, active, orderable, sales_status, sku
- **Do not run production apply without separate confirmation.**

---

## Status breakdown (58 missing SKUs)

| review_status | Count |
|---------------|------:|
{chr(10).join(f"| `{k}` | {v} |" for k,v in sorted(status_counts.items()))}

---

## Remaining without confirmed image

{rem_lines or "_none_"}

---

## Excluded / disputed

{chr(10).join(f"- **{a}** — {b}" for a,b in disputed)}

### Manual (keep_manual, not in apply)

{manual_lines}

---

## Sources used for final crops

- Official site downloads: `source-downloads/` (23 files)
- PDF renders pages: **11, 13, 14, 15, 18, 21, 24**
  - User-listed 11/14/15/18/21/24 plus **p.13** for distinct Dobretsov Бочковой 1,42

### Key decisions

1. **Cola LE glass**: site `92_…` and PDF p.18 glass both read **CLASSIC** → **excluded** until LE proven.
2. **Cola LE can 0,33**: cropped from PDF p.18 lineup → **included**.
3. **Бочковой 1,42**: site 2L art **not reused**; PDF p.13 distinct smaller PET **included**.
4. **Gallagher NA**: alcoholic site art **forbidden**; PDF p.11 under **0% Алк.** stamp **included**.
5. **Nordisch NA can**: **excluded** — no unique can packshot.
6. All **5 manuals** excluded from apply.

---

## Technical QA

- All apply files open as WEBP, canvas **{CANVAS}×{CANVAS}**
- Duplicate processed SHA-256 groups: **{len(dup_hashes)}**
- Crop errors: **{len(errors)}**
- Contact sheet: `contact-sheet.html`, `contact-sheet.jpg`

---

## Artifacts

| File | Purpose |
|------|---------|
| `processed/*.webp` | Final single-pack images |
| `image-update-manifest.json` | Image-only dry-run apply list |
| `missing-images-inventory.json` | Updated inventory |
| `crop-results.json` | Per-SKU crop metadata + QA |
| `contact-sheet.html` / `.jpg` | Visual review |
| `FINAL-DRY-RUN-REPORT.md` | This report |

---

## Next step

After human review of the contact sheet, explicitly confirm production **image-only** apply.
"""
    (BASE / "FINAL-DRY-RUN-REPORT.md").write_text(report, encoding="utf-8")
    (BASE / "DRY-RUN-REPORT.md").write_text(report, encoding="utf-8")

    print(
        json.dumps(
            {
                "produced": len(results),
                "apply_records": len(manifest_items),
                "remaining": len(remaining_without),
                "errors": len(errors),
                "dupes": len(dup_hashes),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
