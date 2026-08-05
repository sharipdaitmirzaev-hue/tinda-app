#!/usr/bin/env python3
"""Daryal stage 2: verify 22 ready SKUs, crop single-pack images, contact sheet,
production collision check (offline snapshot + Bavaria SKUs), approved manifest.

No production apply. Official site darialgroup.ru only.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "artifacts/daryal-import"
SEED = ART / "seed-discover" / "discovered.json"
STAGE1 = ART / "latest-dry-run"
OUT_ROOT = ART  # stamped dir created at runtime
CANVAS = 1000
UA = "TINDA-Daryal-Import/1.0 (+https://tindamarket.ru)"

OFFICIAL = {
    "sparkling": "https://darialgroup.ru/sparkling/",
    "water": "https://darialgroup.ru/water/",
    "still": "https://darialgroup.ru/negazirovannye-napitki/",
    "beer": "https://darialgroup.ru/beer/",
    "products": "https://darialgroup.ru/products/",
    "home": "https://darialgroup.ru/",
}

# Visual L→R mapping from official lineup images (not HTML list order for last glass pair).
GLASS_ORDER = [
    "Кола-апельсин",
    "Апельсин-кориандр",
    "Тархун",
    "Груша",
    "Фейхоа-Шелковица",
    "Гранат",  # image index 5 (HTML list has Мохито before Гранат)
    "Мохито",  # image index 6
]

PET_PAIR_ORDER = [
    # (taste, has_1500)
    ("Кола-апельсин", True),
    ("Апельсин", True),
    ("Тархун", True),
    ("Груша", True),
    ("Мохито", False),  # 0.5 only
]

WATER_ORDER = [
    # L→R on official water packshot
    ("PET", 500),
    ("PET", 1500),
    ("GLASS", 500),
]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"


def fetch(url: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.status, res.read()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def content_mask(im: Image.Image):
    import numpy as np

    arr = np.array(im.convert("RGBA"))
    a = arr[:, :, 3]
    rgb = arr[:, :, :3].astype(int)
    return (a > 15) & ~((rgb[:, :, 0] > 248) & (rgb[:, :, 1] > 248) & (rgb[:, :, 2] > 248))


def islands_x(mask, min_w=25, thr_frac=0.05):
    import numpy as np

    dens = mask.sum(axis=0).astype(float)
    smooth = np.convolve(dens, np.ones(5) / 5, mode="same")
    thr = max(smooth.max() * thr_frac, 1.0)
    out = []
    in_r = False
    s = 0
    for i, v in enumerate(smooth >= thr):
        if v and not in_r:
            in_r = True
            s = i
        elif not v and in_r:
            in_r = False
            if i - s >= min_w:
                out.append((s, i))
    if in_r and len(smooth) - s >= min_w:
        out.append((s, len(smooth) - 1))
    return out


def crop_bottle(im: Image.Image, mask, x0: int, x1: int, pad: int = 8) -> Image.Image:
    import numpy as np

    H, W = mask.shape
    xx0 = max(0, x0 - pad)
    xx1 = min(W, x1 + pad)
    strip = mask[:, xx0:xx1]
    rows = np.where(strip.any(axis=1))[0]
    y0 = max(0, int(rows[0]) - 4)
    y1 = min(H, int(rows[-1]) + 4)
    return im.crop((xx0, y0, xx1, y1))


def split_wide_pair(mask, x0: int, x1: int) -> tuple[tuple[int, int], tuple[int, int]]:
    import numpy as np

    dens = mask[:, x0:x1].sum(axis=0).astype(float)
    smooth = np.convolve(dens, np.ones(5) / 5, mode="same")
    mid0 = int(len(smooth) * 0.25)
    mid1 = int(len(smooth) * 0.75)
    valley = mid0 + int(np.argmin(smooth[mid0:mid1]))
    return (x0, x0 + valley), (x0 + valley, x1)


def to_canvas(crop: Image.Image, size: int = CANVAS) -> Image.Image:
    im = crop.convert("RGBA")
    # trim near-empty margins lightly already done; fit into square
    bg = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    max_side = max(im.size)
    scale = (size * 0.92) / max_side
    nw = max(1, int(im.width * scale))
    nh = max(1, int(im.height * scale))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (size - nw) // 2
    y = (size - nh) // 2
    bg.paste(resized, (x, y), resized)
    return bg.convert("RGB")


def write_csv(path: Path, rows: list[dict]):
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields = list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def parse_sparkling_live(html: str) -> dict:
    # Strip comments for live flavors; keep comment check separately
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    visible = re.sub(r"<!--[\s\S]*?-->", " ", text)
    visible = re.sub(r"<[^>]+>", "\n", visible)

    def flavors_after(label: str, until: str | None = None) -> list[str]:
        m = re.search(label, visible, re.I)
        if not m:
            return []
        chunk = visible[m.end() :]
        if until:
            m2 = re.search(until, chunk, re.I)
            if m2:
                chunk = chunk[: m2.start()]
        return [x.strip() for x in re.findall(r'[“"«]([^”"»]+)[”"»]', chunk)]

    glass = flavors_after(r"СТЕКЛО\s*0[.,]5", r"ПЭТ\s*0[.,]5|Безалкогольные газированные")
    # PET 0.5 block then PET 1.5
    pet05 = flavors_after(r"ПЭТ\s*0[.,]5(?!\s*л\s*и)", r"ПЭТ\s*1[.,]5")
    pet15 = flavors_after(r"ПЭТ\s*1[.,]5", r"Газированные напитки от|Сладкие газированные|В упаковке")
    grapefruit_comment = bool(
        re.search(r"<!--[\s\S]*Грейпфрут-малина", html, re.I)
    ) and not any("грейпфрут" in f.lower() for f in pet05)
    return {
        "glass_05": glass,
        "pet_05": pet05,
        "pet_15": pet15,
        "grapefruit_comment_only": grapefruit_comment,
    }


def parse_water_live(html: str) -> dict:
    text = re.sub(r"<!--[\s\S]*?-->", " ", html)
    text = re.sub(r"<[^>]+>", " ", text)
    packs = ["СТЕКЛО 0,5Л", "ПЭТ 0,5Л", "ПЭТ 1,5Л"]
    has_still = bool(re.search(r"Аква\s*Дарьял.*негазированн|негазированн.*Аква\s*Дарьял", text, re.I | re.S))
    # page has both titles
    has_still = bool(re.search(r"Аква\s*Дарьял»?\s*негазированная|негазированная", text, re.I)) and bool(
        re.search(r"Аква\s*Дарьял", text, re.I)
    )
    has_gaz = bool(re.search(r"Аква\s*Дарьял»?\s*газированная|AQUADARIAL", text, re.I))
    pack_line = bool(re.search(r"СТЕКЛО\s*0[.,]5Л", text, re.I)) and bool(
        re.search(r"ПЭТ\s*0[.,]5Л", text, re.I)
    ) and bool(re.search(r"ПЭТ\s*1[.,]5Л", text, re.I))
    return {
        "still": has_still,
        "gaz": has_gaz,
        "packs_confirmed": pack_line,
        "pack_labels": packs,
    }


def load_collision_universe() -> dict:
    """Offline production collision check: last known catalog snapshot + Bavaria approved SKUs."""
    before_path = (
        ROOT
        / "artifacts/bavaria-import/2026-07-31T12-18-06-212Z-apply/existing-products-before.json"
    )
    manifest_path = ROOT / "artifacts/bavaria-import/latest-pdf-reviewed/approved-import-manifest.json"
    items = []
    if before_path.exists():
        items = json.loads(before_path.read_text(encoding="utf-8"))
    bav_skus = []
    if manifest_path.exists():
        bav_skus = json.loads(manifest_path.read_text(encoding="utf-8")).get("approved_skus") or []
    by_sku = {str(p.get("sku") or "").upper(): p for p in items if p.get("sku")}
    for s in bav_skus:
        by_sku.setdefault(s.upper(), {"sku": s, "name": "(bavaria approved)", "brand": "Бавария"})
    return {
        "source": "offline_snapshot+bavaria_approved",
        "snapshot_path": str(before_path.relative_to(ROOT)) if before_path.exists() else None,
        "snapshot_count": len(items),
        "sku_universe_count": len(by_sku),
        "by_sku": by_sku,
        "live_api_ok": False,
        "live_api_error": "tindamarket.ru TLS/TCP reset from this cloud agent",
        "note": "Live production API unreachable; collision check uses last known snapshot (incl. Bavaria).",
    }


def sku_for(brand: str, product_key: str, volume_ml: int, package: str) -> str:
    # Mirror src/lib/imports/daryal/sku.ts transliteration enough for known keys
    table = {
        "а": "A",
        "б": "B",
        "в": "V",
        "г": "G",
        "д": "D",
        "е": "E",
        "ё": "E",
        "ж": "ZH",
        "з": "Z",
        "и": "I",
        "й": "Y",
        "к": "K",
        "л": "L",
        "м": "M",
        "н": "N",
        "о": "O",
        "п": "P",
        "р": "R",
        "с": "S",
        "т": "T",
        "у": "U",
        "ф": "F",
        "х": "H",
        "ц": "TS",
        "ч": "CH",
        "ш": "SH",
        "щ": "SCH",
        "ъ": "",
        "ы": "Y",
        "ь": "",
        "э": "E",
        "ю": "YU",
        "я": "YA",
        " ": "-",
        "-": "-",
    }

    def slug(s: str) -> str:
        out = []
        for ch in s.lower():
            if ch in table:
                out.append(table[ch])
            elif "a" <= ch <= "z" or ch.isdigit():
                out.append(ch.upper())
            else:
                out.append("-")
        s2 = re.sub(r"-+", "-", "".join(out)).strip("-")
        return s2

    brand_s = slug(brand)
    prod_s = slug(product_key)
    return f"DARYAL-{brand_s}-{prod_s}-{volume_ml}-{package}"


def vol_text(ml: int) -> str:
    if ml == 500:
        return "0,5 л"
    if ml == 1500:
        return "1,5 л"
    return f"{ml} мл"


def pkg_label(code: str) -> str:
    return {"PET": "ПЭТ", "GLASS": "стекло", "CAN": "банка"}.get(code, code)


def main():
    out = ART / f"{stamp()}-stage2"
    src_dir = out / "source-downloads"
    proc = out / "processed"
    prev = out / "previews"
    for d in (out, src_dir, proc, prev):
        d.mkdir(parents=True, exist_ok=True)

    # --- fetch official pages ---
    pages = {}
    for key, url in OFFICIAL.items():
        status, body = fetch(url)
        (out / "raw-html").mkdir(exist_ok=True)
        (out / "raw-html" / f"{key}.html").write_bytes(body)
        pages[key] = {"url": url, "status": status, "html": body.decode("utf-8", "replace")}

    sparkling = parse_sparkling_live(pages["sparkling"]["html"])
    water = parse_water_live(pages["water"]["html"])

    # --- download official images ---
    image_urls = {
        "sparkling-products-glass_1.png": "https://darialgroup.ru/local/templates/sm/images/sparkling/sparkling-products-glass_1.png",
        "sparkling-products-pet.png": "https://darialgroup.ru/local/templates/sm/images/sparkling/sparkling-products-pet.png",
        "water-still.png": "https://darialgroup.ru/upload/iblock/8f4/n00jgc2ona8jrquu4w7akzu1wt69kmic.png",
        "water-gaz.png": "https://darialgroup.ru/upload/iblock/bf7/xo9dzpvdbr2h2jcvredlzqz30wxj15oa.png",
        "frutimix.png": "https://darialgroup.ru/upload/iblock/b81/b81a36e32fb6055b535a0a9b42d3fa6e.png",
    }
    source_meta = {}
    for name, url in image_urls.items():
        status, data = fetch(url)
        path = src_dir / name
        path.write_bytes(data)
        source_meta[name] = {
            "url": url,
            "http_status": status,
            "bytes": len(data),
            "sha256": sha256_bytes(data),
        }

    # --- crop glass ---
    glass_im = Image.open(src_dir / "sparkling-products-glass_1.png")
    gmask = content_mask(glass_im)
    g_islands = islands_x(gmask, min_w=40, thr_frac=0.08)
    assert len(g_islands) == 7, f"expected 7 glass bottles, got {g_islands}"

    crops: dict[str, Path] = {}
    image_audit = []

    for i, taste in enumerate(GLASS_ORDER):
        a, b = g_islands[i]
        crop = crop_bottle(glass_im, gmask, a, b, pad=16)
        sku = sku_for("Дарьял", taste, 500, "GLASS")
        canvas = to_canvas(crop)
        out_path = proc / f"{sku}.webp"
        canvas.save(out_path, "WEBP", quality=90)
        canvas.save(prev / f"{sku}.jpg", "JPEG", quality=90)
        crops[sku] = out_path
        image_audit.append(
            {
                "sku": sku,
                "source": "sparkling-products-glass_1.png",
                "source_url": image_urls["sparkling-products-glass_1.png"],
                "index": i,
                "taste": taste,
                "volume": "0,5 л",
                "package": "стекло",
                "confidence": "high",
                "note": "Crop from official glass lineup; volume/package from /sparkling/ text СТЕКЛО 0.5 Л",
            }
        )

    # --- crop PET ---
    pet_im = Image.open(src_dir / "sparkling-products-pet.png")
    pmask = content_mask(pet_im)
    # Detect raw islands then normalize into 9 bottles: 4 pairs + mohito
    raw = islands_x(pmask, min_w=20, thr_frac=0.05)
    # Merge logic: if island wider than ~130px, split into pair
    bottles: list[tuple[int, int]] = []
    for a, b in raw:
        if (b - a) >= 130:
            left, right = split_wide_pair(pmask, a, b)
            bottles.extend([left, right])
        else:
            bottles.append((a, b))
    # Expect 9: 4×(1.5+0.5) + Mohito 0.5
    assert len(bottles) == 9, f"expected 9 PET bottles, got {len(bottles)} {bottles}"

    def bottle_height(ab: tuple[int, int]) -> int:
        import numpy as np

        a, b = ab
        rows = np.where(pmask[:, a:b].any(axis=1))[0]
        return int(rows[-1] - rows[0]) if len(rows) else 0

    pet_idx = 0
    bi = 0
    for taste, has_1500 in PET_PAIR_ORDER:
        if has_1500:
            pair = bottles[bi : bi + 2]
            bi += 2
            # taller = 1.5 L, shorter = 0.5 L (official lineup pairs)
            ordered = sorted(pair, key=bottle_height, reverse=True)
            assignments = [(ordered[0], 1500), (ordered[1], 500)]
        else:
            assignments = [(bottles[bi], 500)]
            bi += 1
        for a_b, ml in assignments:
            a, b = a_b
            crop = crop_bottle(pet_im, pmask, a, b, pad=6)
            sku = sku_for("Дарьял", taste, ml, "PET")
            canvas = to_canvas(crop)
            out_path = proc / f"{sku}.webp"
            canvas.save(out_path, "WEBP", quality=90)
            canvas.save(prev / f"{sku}.jpg", "JPEG", quality=90)
            crops[sku] = out_path
            image_audit.append(
                {
                    "sku": sku,
                    "source": "sparkling-products-pet.png",
                    "source_url": image_urls["sparkling-products-pet.png"],
                    "index": pet_idx,
                    "taste": taste,
                    "volume": vol_text(ml),
                    "package": "ПЭТ",
                    "confidence": "high",
                    "note": "Crop from official PET lineup; size from relative bottle height + /sparkling/ PET matrix",
                }
            )
            pet_idx += 1
    assert bi == 9, bi

    # --- water crops ---
    for carb, file_key, brand_key in [
        ("негазированная", "water-still.png", "STILL"),
        ("газированная", "water-gaz.png", "GAZ"),
    ]:
        im = Image.open(src_dir / file_key)
        mask = content_mask(im)
        wis = islands_x(mask, min_w=40, thr_frac=0.05)
        assert len(wis) == 3, f"expected 3 water bottles in {file_key}, got {wis}"
        for i, ((pkg, ml), (a, b)) in enumerate(zip(WATER_ORDER, wis)):
            crop = crop_bottle(im, mask, a, b, pad=10)
            sku = f"DARYAL-AKVA-DARYAL-{brand_key}-{ml}-{pkg}"
            canvas = to_canvas(crop)
            out_path = proc / f"{sku}.webp"
            canvas.save(out_path, "WEBP", quality=90)
            canvas.save(prev / f"{sku}.jpg", "JPEG", quality=90)
            crops[sku] = out_path
            image_audit.append(
                {
                    "sku": sku,
                    "source": file_key,
                    "source_url": image_urls[file_key],
                    "index": i,
                    "taste": None,
                    "volume": vol_text(ml),
                    "package": pkg_label(pkg),
                    "confidence": "high",
                    "note": f"Crop from official Aqua Darial {carb} packshot; packs listed on /water/",
                }
            )

    # --- build approved product rows from live verification ---
    expected_glass = [
        "Кола-апельсин",
        "Апельсин-кориандр",
        "Тархун",
        "Груша",
        "Фейхоа-Шелковица",
        "Мохито",
        "Гранат",
    ]
    # HTML list order for verification (set equality, not image order)
    assert set(sparkling["glass_05"]) == set(expected_glass), sparkling["glass_05"]
    assert sparkling["pet_05"] == [
        "Кола-апельсин",
        "Апельсин",
        "Тархун",
        "Груша",
        "Мохито",
    ], sparkling["pet_05"]
    assert sparkling["pet_15"] == [
        "Кола-апельсин",
        "Апельсин",
        "Тархун",
        "Груша",
    ], sparkling["pet_15"]
    assert water["still"] and water["gaz"] and water["packs_confirmed"]

    approved = []
    rejected = []
    manual = []

    def add_soda(taste: str, ml: int, pkg: str, section: str):
        sku = sku_for("Дарьял", taste, ml, pkg)
        name = f"Дарьял {taste} газированная, {vol_text(ml)}, {pkg_label(pkg)}"
        approved.append(
            {
                "proposed_sku": sku,
                "official_name": taste,
                "proposed_name": name,
                "brand": "Дарьял",
                "manufacturer": "ООО ВПБЗ «Дарьял»",
                "category": "Газированные напитки",
                "category_slug": "gazirovannye-napitki",
                "volume": vol_text(ml),
                "package": pkg_label(pkg),
                "package_code": pkg,
                "taste": taste,
                "carbonation": "газированная",
                "alcohol_percent": 0,
                "source_url": OFFICIAL["sparkling"],
                "source_section": section,
                "image_path": str(crops[sku].relative_to(ROOT)),
                "image_sha256": sha256_file(crops[sku]),
                "duplicate_status": "new",
                "confidence": "high",
                "sales_status": "showcase",
                "price_amount": None,
                "orderable": False,
                "create_only": True,
                "verification": {
                    "name_ok": True,
                    "taste_ok": True,
                    "volume_ok": True,
                    "package_ok": True,
                    "image_ok": True,
                    "evidence": f"Live /sparkling/ {section}; single-pack crop from official lineup",
                },
            }
        )

    for taste in sparkling["glass_05"]:
        add_soda(taste, 500, "GLASS", "СТЕКЛО 0.5 Л")
    for taste in sparkling["pet_05"]:
        add_soda(taste, 500, "PET", "ПЭТ 0,5")
    for taste in sparkling["pet_15"]:
        add_soda(taste, 1500, "PET", "ПЭТ 1,5")

    for carb, key in [("негазированная", "STILL"), ("газированная", "GAZ")]:
        for pkg, ml in [("GLASS", 500), ("PET", 500), ("PET", 1500)]:
            sku = f"DARYAL-AKVA-DARYAL-{key}-{ml}-{pkg}"
            name = f"Аква Дарьял {carb}, {vol_text(ml)}, {pkg_label(pkg)}"
            approved.append(
                {
                    "proposed_sku": sku,
                    "official_name": f"Аква Дарьял {carb}",
                    "proposed_name": name,
                    "brand": "Аква Дарьял",
                    "manufacturer": "ООО ВПБЗ «Дарьял»",
                    "category": "Минеральная вода",
                    "category_slug": "voda-mineralnaya",
                    "volume": vol_text(ml),
                    "package": pkg_label(pkg),
                    "package_code": pkg,
                    "taste": None,
                    "carbonation": carb,
                    "alcohol_percent": 0,
                    "source_url": OFFICIAL["water"],
                    "source_section": f"{carb} / {pkg_label(pkg)} {vol_text(ml)}",
                    "image_path": str(crops[sku].relative_to(ROOT)),
                    "image_sha256": sha256_file(crops[sku]),
                    "duplicate_status": "new",
                    "confidence": "high",
                    "sales_status": "showcase",
                    "price_amount": None,
                    "orderable": False,
                    "create_only": True,
                    "verification": {
                        "name_ok": True,
                        "taste_ok": True,
                        "volume_ok": True,
                        "package_ok": True,
                        "image_ok": True,
                        "evidence": "Live /water/ pack list СТЕКЛО 0,5Л / ПЭТ 0,5Л / ПЭТ 1,5Л + official packshot crop",
                    },
                }
            )

    # Manual: Frutimix (both) — do not invent volume/package; exclude from approved
    still_html = pages["still"]["html"]
    still_text = re.sub(r"<[^>]+>", " ", still_html)
    frutimix_tastes = []
    if re.search(r"Мультифрукт", still_text):
        frutimix_tastes.append("Мультифрукт")
    if re.search(r"Красный апельсин", still_text):
        frutimix_tastes.append("Красный апельсин")
    for taste in frutimix_tastes:
        manual.append(
            {
                "official_name": f"Фрутимикс {taste}",
                "brand": "Фрутимикс",
                "source_url": OFFICIAL["still"],
                "reason": "missing_volume_or_package",
                "evidence": (
                    "На /negazirovannye-napitki/ указаны вкусы, но объём и тара не опубликованы. "
                    "Объём/тару не додумываем. В approved не включать."
                ),
                "suggested_action": "confirm volume/package from manufacturer; keep manual",
                "image_note": "Есть общий packshot Фрутимикс, но без читаемого объёма на этикетке в кадре",
            }
        )

    # Rejected
    if sparkling["grapefruit_comment_only"]:
        rejected.append(
            {
                "name": "Грейпфрут-малина",
                "reason": "unclear_or_unconfirmed_sku",
                "evidence": "Вкус только в HTML-комментарии на /sparkling/ — не live assortment",
                "source_url": OFFICIAL["sparkling"],
            }
        )
    rejected.append(
        {
            "name": "Живое пиво /beer/ (все позиции)",
            "reason": "alcoholic_excluded",
            "evidence": "Алкогольная линейка; scope = только безалкогольное",
            "source_url": OFFICIAL["beer"],
        }
    )
    rejected.append(
        {
            "name": "Холодный чай «ФИЕСТА» (малина)",
            "reason": "insufficient_sku_data",
            "evidence": (
                "Упоминание в meta description /negazirovannye-napitki/ и тексте /products/; "
                "отдельной страницы/SKU с объёмом, тарой и подтверждённым изображением в sitemap нет"
            ),
            "source_url": OFFICIAL["still"],
        }
    )
    rejected.append(
        {
            "name": "Сокосодержащие (кроме Фрутимикс manual)",
            "reason": "insufficient_sku_data",
            "evidence": "Пункт меню «Сокосодержащие» закомментирован; отдельных confirmed SKU на сайте нет",
            "source_url": OFFICIAL["products"],
        }
    )

    # --- collisions ---
    universe = load_collision_universe()
    sku_collisions = []
    soft_name_hits = []
    for p in approved:
        sku_u = p["proposed_sku"].upper()
        if sku_u in universe["by_sku"]:
            sku_collisions.append(
                {"proposed_sku": p["proposed_sku"], "existing": universe["by_sku"][sku_u]}
            )
            p["duplicate_status"] = "sku_collision"
        # soft: same taste keywords under other brands — not a blocker
        taste = (p.get("taste") or "").lower()
        brand = (p.get("brand") or "").lower()
        if taste:
            for ex in universe["by_sku"].values():
                en = (ex.get("name") or "").lower()
                eb = (ex.get("brand") or "").lower()
                if taste in en and brand not in eb and "дарьял" not in eb:
                    soft_name_hits.append(
                        {
                            "proposed_sku": p["proposed_sku"],
                            "proposed_name": p["proposed_name"],
                            "existing_sku": ex.get("sku"),
                            "existing_name": ex.get("name"),
                            "existing_brand": ex.get("brand"),
                            "note": "same flavor word, different brand — not a SKU collision",
                        }
                    )
                    break

    assert not sku_collisions, sku_collisions
    assert len(approved) == 22, len(approved)
    assert all(p["proposed_sku"] in crops for p in approved)

    # Categories used
    categories = sorted({(p["category"], p["category_slug"]) for p in approved})

    # Gaps report
    gaps = [
        {
            "id": "cold_tea_fiesta",
            "line": "Холодный чай",
            "status": "gap_not_imported",
            "detail": "ФИЕСТА малина — только meta/описание, нет SKU (название+вкус+объём+тара+image) на официальном сайте",
        },
        {
            "id": "juice_other",
            "line": "Сокосодержащие",
            "status": "gap_not_imported",
            "detail": "Отдельных confirmed SKU нет; меню-ссылка закомментирована",
        },
        {
            "id": "frutimix_multifrukt",
            "line": "Фрутимикс",
            "status": "manual",
            "detail": "Мультифрукт — вкус confirmed, объём/тара отсутствуют; не в approved",
        },
        {
            "id": "frutimix_krasnyy_apelsin",
            "line": "Фрутимикс",
            "status": "manual",
            "detail": "Красный апельсин — вкус confirmed на сайте, объём/тара отсутствуют; не в approved",
        },
        {
            "id": "grapefruit_raspberry_comment",
            "line": "Газированные",
            "status": "rejected",
            "detail": "Грейпфрут-малина только в HTML comment",
        },
        {
            "id": "beer_all",
            "line": "Живое пиво",
            "status": "rejected",
            "detail": "Алкоголь — вне scope",
        },
        {
            "id": "no_pdf_price_photoshoot",
            "line": "Sources",
            "status": "gap_source",
            "detail": "PDF/прайс/официальная фотосъёмка отсутствуют — использован только darialgroup.ru",
        },
    ]

    # Contact sheet
    skus_sorted = sorted(crops.keys())
    cols = 6
    rows_n = (len(skus_sorted) + cols - 1) // cols
    thumb = 180
    pad = 12
    label_h = 36
    sheet_w = cols * (thumb + pad) + pad
    sheet_h = rows_n * (thumb + label_h + pad) + pad + 40
    sheet = Image.new("RGB", (sheet_w, sheet_h), (248, 248, 248))
    draw = ImageDraw.Draw(sheet)
    draw.text((pad, 10), f"Daryal stage2 single-pack contact sheet ({len(skus_sorted)} SKUs)", fill=(20, 20, 20))
    for idx, sku in enumerate(skus_sorted):
        r, c = divmod(idx, cols)
        x = pad + c * (thumb + pad)
        y = 40 + pad + r * (thumb + label_h + pad)
        im = Image.open(crops[sku]).convert("RGB").resize((thumb, thumb), Image.Resampling.LANCZOS)
        sheet.paste(im, (x, y))
        short = sku.replace("DARYAL-", "")
        draw.text((x, y + thumb + 4), short[:42], fill=(40, 40, 40))
    sheet_path = out / "contact-sheet.jpg"
    sheet.save(sheet_path, "JPEG", quality=90)

    # HTML contact sheet
    cards = []
    for p in approved:
        rel = Path(p["image_path"]).name
        cards.append(
            f'<figure><img src="processed/{rel}" alt="{p["proposed_sku"]}" loading="lazy"/>'
            f"<figcaption><code>{p['proposed_sku']}</code><br/>{p['proposed_name']}</figcaption></figure>"
        )
    html = f"""<!doctype html>
<html lang="ru"><meta charset="utf-8"/>
<title>Daryal stage2 contact sheet</title>
<style>
body{{font-family:system-ui,sans-serif;background:#f6f6f6;margin:24px}}
h1{{font-size:20px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}}
figure{{margin:0;background:#fff;padding:10px;border-radius:8px}}
img{{width:100%;height:auto;display:block;background:#fff}}
figcaption{{font-size:12px;margin-top:8px;line-height:1.35}}
code{{font-size:10px}}
</style>
<h1>Daryal approved single-pack images ({len(approved)})</h1>
<p>Source: darialgroup.ru only · showcase · price=null · orderable=false · apply not run</p>
<div class="grid">{"".join(cards)}</div>
</html>"""
    (out / "contact-sheet.html").write_text(html, encoding="utf-8")

    # Manifest
    approved_skus = sorted(p["proposed_sku"] for p in approved)
    category_distribution = {}
    for p in approved:
        category_distribution[p["category"]] = category_distribution.get(p["category"], 0) + 1

    manifest = {
        "stage": "stage2-site-verified-approved",
        "created_at": utc_now(),
        "manufacturer": "ООО ВПБЗ «Дарьял»",
        "source_primary": "https://darialgroup.ru",
        "source_booklet": None,
        "pdf_file_available": False,
        "scope_decisions": {
            "non_alcoholic_only": True,
            "beer_excluded": True,
            "alcohol_excluded": True,
            "unclear_alcohol_excluded": True,
            "official_site_only": True,
            "third_party_forbidden_without_approval": True,
            "frutimix_manual_only": True,
            "cold_tea_requires_full_sku_or_gap": True,
        },
        "approved_count": len(approved),
        "manual_review_count": len(manual),
        "rejected_count": len(rejected),
        "images_prepared": len(crops),
        "skus_without_image": 0,
        "category_distribution": category_distribution,
        "categories": [{"name": n, "slug": s} for n, s in categories],
        "categories_to_create": [],
        "checks": {
            "production_db_modified": False,
            "apply_run": False,
            "merge_used": False,
            "existing_products_modified": False,
            "sku_collisions": sku_collisions,
            "live_production_api": {
                "ok": False,
                "error": universe["live_api_error"],
                "fallback": universe["source"],
                "snapshot_count": universe["snapshot_count"],
                "sku_universe_count": universe["sku_universe_count"],
            },
            "soft_same_flavor_other_brand": len(soft_name_hits),
        },
        "apply": {
            "sales_status": "showcase",
            "is_active": True,
            "price_amount": None,
            "orderable": False,
            "create_only": True,
            "modify_existing_products": False,
            "note": (
                "User intent price=0 + orderable=false mapped to showcase + price_amount=null "
                "(catalog schema: 0 is not used as no-price; null = not orderable)."
            ),
        },
        "approved_skus": approved_skus,
        "manual_names": [m["official_name"] for m in manual],
        "gaps": gaps,
        "source_images": source_meta,
        "artifacts": {
            "processed_dir": str((proc).relative_to(ROOT)),
            "contact_sheet_jpg": str(sheet_path.relative_to(ROOT)),
            "contact_sheet_html": str((out / "contact-sheet.html").relative_to(ROOT)),
        },
    }

    # Write outputs
    (out / "approved-import-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out / "approved-products.json").write_text(
        json.dumps(approved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_csv(
        out / "approved-products.csv",
        [
            {
                "proposed_sku": p["proposed_sku"],
                "proposed_name": p["proposed_name"],
                "brand": p["brand"],
                "category": p["category"],
                "category_slug": p["category_slug"],
                "volume": p["volume"],
                "package": p["package"],
                "taste": p["taste"] or "",
                "carbonation": p["carbonation"] or "",
                "source_url": p["source_url"],
                "image_path": p["image_path"],
                "sales_status": p["sales_status"],
                "price_amount": "",
                "orderable": "false",
                "confidence": p["confidence"],
            }
            for p in approved
        ],
    )
    write_csv(out / "manual-review.csv", manual)
    write_csv(out / "rejected-products.csv", rejected)
    write_csv(out / "image-to-sku-audit.csv", image_audit)
    write_csv(out / "gaps-report.csv", gaps)
    write_csv(out / "soft-flavor-overlaps.csv", soft_name_hits[:50])
    (out / "production-collision-check.json").write_text(
        json.dumps(
            {
                **{k: v for k, v in universe.items() if k != "by_sku"},
                "sku_collisions": sku_collisions,
                "daryal_brand_hits_in_snapshot": [
                    {"sku": p.get("sku"), "name": p.get("name"), "brand": p.get("brand")}
                    for p in universe["by_sku"].values()
                    if "дарьял" in f"{p.get('name')} {p.get('brand')} {p.get('sku')}".lower()
                    or "daryal" in f"{p.get('sku')}".lower()
                ],
                "soft_flavor_overlap_count": len(soft_name_hits),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (out / "verification-live.json").write_text(
        json.dumps(
            {
                "fetched_at": utc_now(),
                "sparkling": sparkling,
                "water": water,
                "glass_image_order_note": (
                    "Official glass lineup L→R ends with Гранат then Мохито; "
                    "HTML list order is Мохито then Гранат. Crops mapped by visual identity."
                ),
                "frutimix_tastes": frutimix_tastes,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    skus_without_image = [p["proposed_sku"] for p in approved if p["proposed_sku"] not in crops]

    report = f"""# Daryal stage 2 dry-run report

**When:** {manifest['created_at']}  
**Output:** `{out.relative_to(ROOT)}`  
**Source:** https://darialgroup.ru only (no PDF / no third-party)

## Scope decisions (applied)
- Non-alcoholic only; beer / alcohol / unclear alcohol → rejected
- Official site only
- Cold tea / juice lines → import only with full SKU; else gaps
- Frutimix → manual, not in approved; volume/package not invented

## Dry-run summary

| Bucket | Count |
|--------|------:|
| **approved** | **{len(approved)}** |
| **manual** | **{len(manual)}** |
| **rejected** | **{len(rejected)}** |
| Images prepared | **{len(crops)}** |
| SKUs without image | **{len(skus_without_image)}** |

### approved
{chr(10).join(f"- `{s}`" for s in approved_skus)}

### manual
{chr(10).join(f"- {m['official_name']} — {m['reason']}" for m in manual) or '_none_'}

### rejected
{chr(10).join(f"- {r['name']} — {r['reason']}" for r in rejected)}

## Categories
{chr(10).join(f"- {n} (`{s}`)" for n, s in categories)}

Distribution: {category_distribution}

## Gaps (missing lines + Frutimix)
{chr(10).join(f"- **{g['id']}** [{g['status']}]: {g['detail']}" for g in gaps)}

## Apply policy (NOT executed)
- `sales_status=showcase`
- `price_amount=null` (schema-equivalent of «price=0 / not for sale»)
- `orderable=false`
- create-only; existing products not modified
- **production apply blocked** until explicit confirmation

## Production collision check
- Live API: **unreachable** from this agent (`{universe['live_api_error']}`)
- Fallback: `{universe['source']}` (snapshot={universe['snapshot_count']}, universe={universe['sku_universe_count']})
- SKU collisions: **{len(sku_collisions)}**
- Soft same-flavor other-brand overlaps: {len(soft_name_hits)} (informational only)

## Artifacts
- `approved-import-manifest.json`
- `approved-products.csv` / `.json`
- `manual-review.csv` / `rejected-products.csv` / `gaps-report.csv`
- `processed/*.webp` ({len(crops)} files)
- `contact-sheet.jpg` / `contact-sheet.html`
- `production-collision-check.json`
- `verification-live.json`
"""
    (out / "STAGE2-DRY-RUN-REPORT.md").write_text(report, encoding="utf-8")

    # latest symlink
    latest = ART / "latest-stage2"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    latest.symlink_to(out.name)

    # also copy compact pointer for README
    (ART / "SCOPE-DECISIONS.md").write_text(
        """# Дарьял — зафиксированные решения по scope

1. Импортируем только безалкогольное. Исключено: пиво, алкоголь, неясный алкогольный статус.
2. Источник сейчас: только https://darialgroup.ru (PDF/прайс/фотосъёмки нет; сторонние источники без согласования — нет).
3. Холодный чай / сокосодержащие / прочие линии — только при полном confirmed SKU на сайте; иначе gaps/manual.
4. Фрутимикс (Мультифрукт, Красный апельсин) — manual; объём/тару не додумывать; в approved не включать.
""",
        encoding="utf-8",
    )

    print(report)
    print(f"Wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
