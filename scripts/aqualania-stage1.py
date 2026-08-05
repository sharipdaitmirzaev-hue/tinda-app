#!/usr/bin/env python3
"""AquAlania stage-1 discover/dry-run: official site only, no production writes."""

from __future__ import annotations

import csv
import hashlib
import html as htmlmod
import json
import re
import shutil
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "artifacts/aqualania-import"
UA = "TINDA-AquAlania-Import/1.0 (+https://tindamarket.ru)"
MANUFACTURER = "ООО «Константа-7»"
BRAND = "AquAlania"
SOURCE_RU = "https://aqualania.ru/product"
SOURCE_EN = "https://aqualania.ru/enproduct"
CANVAS = 1000
MAX_SIDE = 1600

# Production category mapping (IDs verified read-only at stage-1 time)
CATEGORIES = {
    "limonady": {
        "name": "Лимонады",
        "slug": "limonady",
        "id": "a8af36d2-ef7a-49ce-8aea-42fdf99359ae",
    },
    "kola": {
        "name": "Кола",
        "slug": "kola",
        "id": "34bee47b-61c3-4e15-81db-75d58ecf018b",
    },
    "voda-gazirovannaya": {
        "name": "Газированная вода",
        "slug": "voda-gazirovannaya",
        "id": "81730d5f-f669-4ea0-b6af-e0f7d645a8fa",
    },
    "voda-negazirovannaya": {
        "name": "Негазированная вода",
        "slug": "voda-negazirovannaya",
        "id": "977a592b-8d39-4bac-afe4-a7d17687657d",
    },
    "gazirovannye-napitki": {
        "name": "Газированные напитки",
        "slug": "gazirovannye-napitki",
        "id": "a98cf12f-e064-4b67-93ef-0a9fdb47bb71",
    },
}

CYR = {
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
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"


def fetch(url: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=90) as res:
        return res.status, res.read()


def slug_part(s: str) -> str:
    out = []
    for ch in s.lower().strip():
        if ch in CYR:
            out.append(CYR[ch])
        elif "a" <= ch <= "z" or ch.isdigit():
            out.append(ch.upper())
        else:
            out.append("-")
    return re.sub(r"-+", "-", "".join(out)).strip("-")


def build_sku(line: str, flavor_key: str, volume_ml: int, package_code: str) -> str:
    return f"AQUALANIA-{slug_part(line)}-{slug_part(flavor_key)}-{volume_ml}-{package_code}"


def write_csv(path: Path, rows: list[dict]):
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields: list[str] = []
    for r in rows:
        for k in r:
            if k not in fields:
                fields.append(k)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def parse_product_cards(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    nodes: list[tuple[str, str]] = []
    for el in soup.descendants:
        name = getattr(el, "name", None)
        if name == "img":
            src = el.get("src") or ""
            if "creatium.ru" not in src:
                continue
            url = src.split("#")[0]
            fname = url.rsplit("/", 1)[-1].lower()
            if any(
                x in fname
                for x in [
                    "grusha",
                    "taruhn",
                    "tarhun",
                    "barb",
                    "saperavi",
                    "sliva",
                    "mango_vinograd",
                    "kolka",
                    "limonad",
                    "igristoe",
                    "dinya",
                    "voda_pet",
                    "klubnika",
                    "vishnya",
                    "ananas",
                    "mohito",
                    "apelsin",
                    "yabloko",
                    "mango_marakuya",
                    "jb_",
                ]
            ):
                nodes.append(("img", url))
        elif name in ("strong", "h2", "p"):
            t = htmlmod.unescape(el.get_text(" ", strip=True))
            t = re.sub(r"\s+", " ", t)
            if re.search(
                r"Напиток безалкогольный|Вода минеральная|Премиум лимонады|Горная вода|Light|алюминиевой",
                t,
            ):
                nodes.append(("text", t))

    section = None
    cards: list[dict] = []
    pending_img = None
    for kind, val in nodes:
        if kind == "text":
            if val in {
                "Премиум лимонады",
                "Горная вода из источника",
                'Напитки "Light" без сахара',
                "Напитки в алюминиевой банке",
            }:
                section = val
                continue
            if re.search(r"Напиток безалкогольный|Вода минеральная", val):
                # skip duplicate title without image (Creatium duplicates text nodes)
                if cards and cards[-1]["title"] == val and cards[-1].get("image") and not pending_img:
                    continue
                cards.append({"section": section, "title": val, "image": pending_img})
                pending_img = None
        else:
            pending_img = val

    # dedupe by title keeping first with image
    by_title: dict[str, dict] = {}
    for c in cards:
        key = c["title"]
        if key not in by_title or (not by_title[key].get("image") and c.get("image")):
            by_title[key] = c
    return list(by_title.values())


def normalize_card(card: dict) -> dict | None:
    title = card["title"]
    section = card["section"] or ""
    image = card.get("image")

    # Water: trust filename for carbonation (DOM order on site is swapped)
    if "Вода минеральная" in title:
        still = bool(image and "ne_gaz" in image)
        gaz = bool(image and re.search(r"voda_pet_0_5_gaz", image or "")) and not still
        if still:
            carbonation = "негазированная"
            flavor = "Негазированная"
            flavor_key = "STILL"
            cat = CATEGORIES["voda-negazirovannaya"]
        elif gaz or "Газированная" in title:
            # if filename missing, fall back to title; prefer filename
            if image and "ne_gaz" in image:
                carbonation = "негазированная"
                flavor = "Негазированная"
                flavor_key = "STILL"
                cat = CATEGORIES["voda-negazirovannaya"]
            else:
                carbonation = "газированная"
                flavor = "Газированная"
                flavor_key = "SPARKLING"
                cat = CATEGORIES["voda-gazirovannaya"]
        else:
            carbonation = "негазированная"
            flavor = "Негазированная"
            flavor_key = "STILL"
            cat = CATEGORIES["voda-negazirovannaya"]
        # Correct using filename exclusively when present
        if image:
            if "ne_gaz" in image:
                carbonation, flavor, flavor_key = "негазированная", "Негазированная", "STILL"
                cat = CATEGORIES["voda-negazirovannaya"]
            elif "gaz" in Path(image).name:
                carbonation, flavor, flavor_key = "газированная", "Газированная", "SPARKLING"
                cat = CATEGORIES["voda-gazirovannaya"]
        return {
            "line": "WATER",
            "official_name": f'Вода минеральная природная столовая питьевая «АквАлания» {flavor}',
            "flavor": flavor,
            "flavor_key": flavor_key,
            "volume_ml": 500,
            "volume_text": "0,5 л",
            "package_type": "ПЭТ",
            "package_code": "PET",
            "carbonation": carbonation,
            "sugar_free": False,
            "shelf_life_days": 720,
            "category": cat["name"],
            "category_slug": cat["slug"],
            "category_id": cat["id"],
            "category_status": "mapped",
            "source_image_url": image,
            "section": section,
            "notes": "Water carbonation taken from official filename (site DOM order swaps labels).",
        }

    # Light
    if "лайт" in title.lower() or "light" in title.lower():
        m = re.search(r"со вкусом\s+(.+?)\s*«", title, re.I)
        flavor_raw = (m.group(1) if m else "").strip()
        flavor_map = {
            "клубники": ("Клубника", "KLUBNIKA"),
            "вишни": ("Вишня", "VISHNYA"),
            "ананаса": ("Ананас", "ANANAS"),
            "мохито": ("Мохито", "MOHITO"),
            "апельсина": ("Апельсин", "APELSIN"),
            "яблока": ("Яблоко", "YABLOKO"),
            "манго-маракуйя": ("Манго-Маракуйя", "MANGO-MARAKUYYA"),
        }
        key = flavor_raw.lower()
        flavor, flavor_key = flavor_map.get(key, (flavor_raw.title(), slug_part(flavor_raw)))
        cat = CATEGORIES["gazirovannye-napitki"]
        return {
            "line": "LIGHT",
            "official_name": title,
            "flavor": flavor,
            "flavor_key": flavor_key,
            "volume_ml": 330,
            "volume_text": "0,33 л",
            "package_type": "ПЭТ-банка с алюминиевой крышкой",
            "package_code": "PETCAN",
            "carbonation": "среднегазированная",
            "sugar_free": True,
            "shelf_life_days": 360,
            "category": cat["name"],
            "category_slug": cat["slug"],
            "category_id": cat["id"],
            "category_status": "mapped",
            "source_image_url": image,
            "section": section,
            "notes": "Official Light assets are small (~224px); kept as exact_low_res.",
        }

    # Aluminum can line
    if section and "алюминиевой" in section.lower():
        flavor = None
        flavor_key = None
        if "Дыня" in title and "мята" in title.lower():
            flavor, flavor_key = "Дыня-Мята", "DYNYA-MYATA"
        elif "Игристое" in title:
            flavor, flavor_key = "Игристое", "IGRISTOE"
        elif "Манго" in title and "Виноград" in title:
            flavor, flavor_key = "Манго-Виноград", "MANGO-VINOGRAD"
        elif "Мохито" in title and "клубник" in title.lower():
            flavor, flavor_key = "Мохито клубничный", "MOHITO-KLUBNICHNYY"
        elif "Мохито" in title:
            flavor, flavor_key = "Мохито классический", "MOHITO-CLASSIC"
        if not flavor:
            return None
        cat = CATEGORIES["gazirovannye-napitki"]
        return {
            "line": "CAN",
            "official_name": title,
            "flavor": flavor,
            "flavor_key": flavor_key,
            "volume_ml": 330,
            "volume_text": "0,33 л",
            "package_type": "алюминиевая банка",
            "package_code": "CAN",
            "carbonation": "сильногазированная",
            "sugar_free": False,
            "shelf_life_days": 360,
            "category": cat["name"],
            "category_slug": cat["slug"],
            "category_id": cat["id"],
            "category_status": "mapped",
            "source_image_url": image,
            "section": section,
            "notes": "",
        }

    # Premium glass
    m = re.search(r'"([^"]+)"', title)
    flavor = m.group(1) if m else None
    if not flavor:
        return None
    flavor_key = slug_part(flavor)
    if flavor == "Кола":
        cat = CATEGORIES["kola"]
    else:
        cat = CATEGORIES["limonady"]
    notes = ""
    if flavor == "Фейхоа":
        notes = "Feijoa uses asset filename tarhun.png on official site (DOM title confirms Feijoa)."
    return {
        "line": "PREMIUM",
        "official_name": title,
        "flavor": flavor,
        "flavor_key": flavor_key,
        "volume_ml": 500,
        "volume_text": "0,5 л",
        "package_type": "стекло",
        "package_code": "GLASS",
        "carbonation": "сильногазированная",
        "sugar_free": False,
        "shelf_life_days": 360,
        "category": cat["name"],
        "category_slug": cat["slug"],
        "category_id": cat["id"],
        "category_status": "mapped",
        "source_image_url": image,
        "section": section,
        "notes": notes,
    }


def proposed_name(p: dict) -> str:
    if p["line"] == "WATER":
        return f"AquAlania вода минеральная {p['flavor'].lower()}, {p['volume_text']}, {p['package_type']}"
    if p["line"] == "LIGHT":
        return f"AquAlania Light {p['flavor']} без сахара, {p['volume_text']}, {p['package_type']}"
    if p["line"] == "CAN":
        return f"AquAlania {p['flavor']}, {p['volume_text']}, {p['package_type']}"
    return f"AquAlania {p['flavor']}, {p['volume_text']}, {p['package_type']}"


def process_image(src: Path, dest: Path) -> dict:
    im = Image.open(src)
    im = im.convert("RGBA") if im.mode in ("P", "RGBA") else im.convert("RGB").convert("RGBA")
    # trim near-white margins lightly
    arr_mode = im
    # fit max side
    w, h = im.size
    scale = min(1.0, MAX_SIDE / max(w, h))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    # square canvas
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 255))
    max_side = max(im.size)
    fit = (CANVAS * 0.92) / max_side
    nw, nh = max(1, int(im.width * fit)), max(1, int(im.height * fit))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((CANVAS - nw) // 2, (CANVAS - nh) // 2), resized)
    out = canvas.convert("RGB")
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "WEBP", quality=90, method=6)
    data = dest.read_bytes()
    return {
        "width": out.width,
        "height": out.height,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "mime": "image/webp",
    }


def api_get(url: str, timeout: int = 120) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode())


def load_production_products() -> list[dict]:
    """Read-only production catalog dump (no writes). Prefer local snapshot if present.

    Full catalog pagination against production can be slow/flaky; set
    AQUALANIA_FULL_DEDUP=1 to force a complete dump. Default: snapshot or
    AquAlania-targeted search probes only.
    """
    snapshot = ROOT / "tmp/aqualania-prod/products-snapshot.json"
    if snapshot.exists():
        items = json.loads(snapshot.read_text(encoding="utf-8"))
        if isinstance(items, list) and items:
            print(f"Loaded production products from snapshot (read-only): {len(items)}")
            return items

    import os
    import time

    if os.environ.get("AQUALANIA_FULL_DEDUP") == "1":
        items: list[dict] = []
        page = 1
        page_size = 50
        while page <= 50:
            data = None
            last_err: Exception | None = None
            for attempt in range(5):
                try:
                    data = api_get(
                        f"https://tindamarket.ru/api/v1/catalog/products?page={page}&page_size={page_size}",
                        timeout=180,
                    )
                    break
                except Exception as exc:  # noqa: BLE001
                    last_err = exc
                    time.sleep(2 * (attempt + 1))
            if not data:
                print(f"WARN: production catalog fetch stopped at page={page}: {last_err}")
                break
            batch = data.get("items") or []
            items.extend(batch)
            total = data.get("total")
            print(f"production page {page}: +{len(batch)} (so_far={len(items)} total={total})")
            if total is not None and len(items) >= int(total):
                break
            if len(batch) < page_size:
                break
            page += 1
        print(f"Loaded production products (read-only): {len(items)}")
        return items

    # Fast path: brand/name search only (read-only). Full dump optional via env.
    probes: list[dict] = []
    for q in ("AquAlania", "АквАлания", "aqualania"):
        try:
            data = api_get(
                f"https://tindamarket.ru/api/v1/catalog/products?q={urllib.parse.quote(q)}&page_size=100",
                timeout=60,
            )
            batch = data.get("items") or []
            print(f"production probe q={q!r}: total={data.get('total')} items={len(batch)}")
            probes.extend(batch)
        except Exception as exc:  # noqa: BLE001
            print(f"WARN: production probe q={q!r} failed: {exc}")
    # de-dupe by id/sku
    by_key: dict[str, dict] = {}
    for p in probes:
        key = str(p.get("id") or p.get("sku") or id(p))
        by_key[key] = p
    items = list(by_key.values())
    print(f"Loaded production AquAlania probes (read-only): {len(items)}")
    return items


def contact_sheet(items: list[dict], preview_dir: Path, out_jpg: Path, out_html: Path):
    cols = 5
    rows = (len(items) + cols - 1) // cols
    cell_w, cell_h, label_h = 220, 280, 48
    sheet = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h) + 40), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
        font_h = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
    except Exception:
        font = ImageFont.load_default()
        font_h = font
    draw.text((8, 10), f"AquAlania stage1 contact sheet ({len(items)} SKUs)", fill=(20, 20, 20), font=font_h)
    html = ["<html><body><h1>AquAlania contact sheet</h1><div style='display:flex;flex-wrap:wrap;gap:8px'>"]
    for i, p in enumerate(items):
        r, c = divmod(i, cols)
        x, y = c * cell_w, 40 + r * (cell_h + label_h)
        prev = preview_dir / f"{p['proposed_sku']}.jpg"
        if prev.exists():
            im = Image.open(prev).convert("RGB")
            im.thumbnail((cell_w - 20, cell_h - 20))
            sheet.paste(im, (x + (cell_w - im.width) // 2, y + 8))
        draw.text((x + 6, y + cell_h - 4), p["proposed_sku"].replace("AQUALANIA-", ""), fill=(0, 0, 0), font=font)
        html.append(
            f"<div style='width:200px'><img src='previews/{p['proposed_sku']}.jpg' width='180'/><div style='font:12px monospace'>{p['proposed_sku']}</div></div>"
        )
    html.append("</div></body></html>")
    sheet.save(out_jpg, "JPEG", quality=85)
    out_html.write_text("\n".join(html), encoding="utf-8")


def main():
    out = ART / f"{stamp()}-stage1"
    raw = out / "raw-html"
    src_dir = out / "source-downloads"
    proc = out / "processed"
    prev = out / "previews"
    for d in (out, raw, src_dir, proc, prev):
        d.mkdir(parents=True, exist_ok=True)

    pages = {}
    for key, url in {
        "product": SOURCE_RU,
        "enproduct": SOURCE_EN,
        "home": "https://aqualania.ru/",
        "sitemap": "https://aqualania.ru/sitemap.xml",
        "robots": "https://aqualania.ru/robots.txt",
    }.items():
        status, body = fetch(url)
        (raw / f"{key}.html").write_bytes(body)
        pages[key] = {"url": url, "status": status, "html": body.decode("utf-8", "replace")}

    cards = parse_product_cards(pages["product"]["html"])
    products = []
    for card in cards:
        norm = normalize_card(card)
        if not norm:
            continue
        sku = build_sku(norm["line"], norm["flavor_key"], norm["volume_ml"], norm["package_code"])
        products.append(
            {
                **norm,
                "proposed_sku": sku,
                "proposed_name": proposed_name(norm),
                "brand": BRAND,
                "manufacturer": MANUFACTURER,
                "source_url": SOURCE_RU,
                "en_source_url": SOURCE_EN,
            }
        )

    # Ensure expected 25 unique SKUs
    by_sku = {p["proposed_sku"]: p for p in products}
    products = sorted(by_sku.values(), key=lambda p: p["proposed_sku"])

    # Download + process images
    image_audit = []
    for p in products:
        url = p.get("source_image_url")
        if not url:
            p["image_match_status"] = "missing"
            p["image_path"] = None
            image_audit.append(
                {
                    "sku": p["proposed_sku"],
                    "status": "missing",
                    "source_url": "",
                    "note": "No official image URL found",
                }
            )
            continue
        fname = urllib.parse.unquote(url.rsplit("/", 1)[-1])
        local = src_dir / f"{p['proposed_sku']}__{fname}"
        try:
            status, data = fetch(url)
            local.write_bytes(data)
            mime = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg" if data[:2] == b"\xff\xd8" else "application/octet-stream"
            im = Image.open(local)
            w, h = im.size
            low_res = max(w, h) < 400
            meta = process_image(local, proc / f"{p['proposed_sku']}.webp")
            # preview jpg
            Image.open(proc / f"{p['proposed_sku']}.webp").convert("RGB").save(
                prev / f"{p['proposed_sku']}.jpg", "JPEG", quality=88
            )
            p["image_match_status"] = "exact_low_res" if low_res else "exact"
            p["image_path"] = str((proc / f"{p['proposed_sku']}.webp").relative_to(ROOT))
            p["image_width"] = w
            p["image_height"] = h
            p["image_mime"] = mime
            p["image_sha256"] = hashlib.sha256(data).hexdigest()
            p["processed_sha256"] = meta["sha256"]
            image_audit.append(
                {
                    "sku": p["proposed_sku"],
                    "status": p["image_match_status"],
                    "source_url": url,
                    "source_bytes": len(data),
                    "source_width": w,
                    "source_height": h,
                    "source_mime": mime,
                    "processed_path": p["image_path"],
                    "processed_sha256": meta["sha256"],
                    "http_status": status,
                    "note": p.get("notes") or "",
                }
            )
        except Exception as exc:  # noqa: BLE001
            p["image_match_status"] = "missing"
            p["image_path"] = None
            image_audit.append(
                {
                    "sku": p["proposed_sku"],
                    "status": "missing",
                    "source_url": url,
                    "note": f"download/process failed: {exc}",
                }
            )

    # Production dedupe (read-only)
    existing = load_production_products()
    by_existing_sku = {str(x.get("sku") or "").upper(): x for x in existing if x.get("sku")}
    duplicates = []
    for p in products:
        sku_u = p["proposed_sku"].upper()
        if sku_u in by_existing_sku:
            p["duplicate_status"] = "sku_collision"
            duplicates.append(
                {
                    "proposed_sku": p["proposed_sku"],
                    "status": "sku_collision",
                    "existing_sku": by_existing_sku[sku_u].get("sku"),
                    "existing_name": by_existing_sku[sku_u].get("name"),
                }
            )
            continue
        # Soft brand overlap only (do not treat generic flavor matches as AquAlania dupes)
        hits = []
        for ex in existing:
            name = (ex.get("name") or "").lower()
            brand = (ex.get("brand") or "").lower()
            sku = (ex.get("sku") or "").upper()
            if (
                "aqualania" in brand
                or "аквалания" in brand
                or "аквалания" in name
                or "aqualania" in name
                or sku.startswith("AQUALANIA-")
            ):
                hits.append(ex)
        if hits:
            p["duplicate_status"] = "probable_match"
            for ex in hits[:5]:
                duplicates.append(
                    {
                        "proposed_sku": p["proposed_sku"],
                        "status": "probable_match",
                        "existing_sku": ex.get("sku"),
                        "existing_name": ex.get("name"),
                        "existing_brand": ex.get("brand"),
                    }
                )
        else:
            p["duplicate_status"] = "new_product"

    # Review buckets
    approved, manual, rejected = [], [], []
    for p in products:
        reasons = []
        if p["duplicate_status"] in {"sku_collision", "exact_match", "conflict"}:
            reasons.append(p["duplicate_status"])
        if p["category_status"] == "manual":
            reasons.append("category_manual")
        if p["image_match_status"] == "missing":
            reasons.append("missing_image")
        if p["flavor"] == "Игристое":
            # RU label «Игристое»; EN differs by line (premium: Sparkling wine; can: Champagne)
            en_label = "Sparkling wine" if p["line"] == "PREMIUM" else "Champagne"
            note = f" Flavor label «Игристое» confirmed on RU/EN site (EN: {en_label})."
            p["notes"] = (p.get("notes") or "") + note
        # Light low-res still official exact
        if not p.get("volume_ml") or not p.get("package_code"):
            reasons.append("incomplete_packaging")

        if reasons:
            p["review_status"] = "manual" if "missing_image" not in reasons or p.get("source_image_url") else "rejected"
            if "missing_image" in reasons and not p.get("source_image_url"):
                p["review_status"] = "rejected"
            p["review_reason"] = "; ".join(reasons)
        else:
            p["review_status"] = "approved"
            p["review_reason"] = ""
            p["confidence"] = "high" if p["image_match_status"] == "exact" else "medium"

        # Force approve path for complete SKUs with images (incl low-res Light)
        if (
            p.get("volume_ml")
            and p.get("package_code")
            and p.get("flavor")
            and p.get("source_image_url")
            and p["duplicate_status"] == "new_product"
            and p["category_status"] == "mapped"
            and p["image_match_status"] in {"exact", "exact_low_res"}
        ):
            p["review_status"] = "approved"
            p["review_reason"] = ""
            p["confidence"] = "high" if p["image_match_status"] == "exact" else "medium"

        if p["review_status"] == "approved":
            approved.append(p)
        elif p["review_status"] == "manual":
            manual.append(p)
        else:
            rejected.append(p)

    contact_sheet(products, prev, out / "contact-sheet.jpg", out / "contact-sheet.html")

    # CSVs / manifest
    def row(p: dict) -> dict:
        return {
            "proposed_sku": p["proposed_sku"],
            "official_name": p["official_name"],
            "proposed_name": p["proposed_name"],
            "brand": p["brand"],
            "manufacturer": p["manufacturer"],
            "line": p["line"],
            "flavor": p["flavor"],
            "volume_ml": p["volume_ml"],
            "volume_text": p["volume_text"],
            "package_type": p["package_type"],
            "package_code": p["package_code"],
            "carbonation": p.get("carbonation") or "",
            "sugar_free": str(bool(p.get("sugar_free"))).lower(),
            "shelf_life_days": p.get("shelf_life_days") or "",
            "category": p["category"],
            "category_slug": p["category_slug"],
            "category_id": p.get("category_id") or "",
            "category_status": p["category_status"],
            "source_url": p["source_url"],
            "source_image_url": p.get("source_image_url") or "",
            "image_path": p.get("image_path") or "",
            "image_match_status": p.get("image_match_status") or "",
            "image_width": p.get("image_width") or "",
            "image_height": p.get("image_height") or "",
            "image_mime": p.get("image_mime") or "",
            "duplicate_status": p.get("duplicate_status") or "",
            "confidence": p.get("confidence") or "",
            "review_status": p.get("review_status") or "",
            "review_reason": p.get("review_reason") or "",
            "notes": p.get("notes") or "",
            "sales_status": "showcase",
            "price_amount": "",
            "orderable": "false",
            "availability": "on_order",
            "units_per_package": 1,
        }

    write_csv(out / "discovered-products.csv", [row(p) for p in products])
    write_csv(out / "approved-products.csv", [row(p) for p in approved])
    write_csv(out / "manual-review.csv", [row(p) for p in manual])
    write_csv(out / "rejected-products.csv", [row(p) for p in rejected])
    write_csv(out / "image-audit.csv", image_audit)
    write_csv(out / "possible-duplicates.csv", duplicates)
    write_csv(
        out / "category-mapping.csv",
        [
            {
                "line": line,
                "category": CATEGORIES[slug]["name"],
                "category_slug": slug,
                "category_id": CATEGORIES[slug]["id"],
                "rule": rule,
            }
            for line, slug, rule in [
                ("PREMIUM (non-cola)", "limonady", "premium glass lemonades → limonady"),
                ("PREMIUM Cola", "kola", "cola glass → kola"),
                ("WATER sparkling", "voda-gazirovannaya", "mineral sparkling water"),
                ("WATER still", "voda-negazirovannaya", "mineral still water"),
                ("LIGHT", "gazirovannye-napitki", "sugar-free light line"),
                ("CAN", "gazirovannye-napitki", "aluminum can line"),
            ]
        ],
    )
    write_csv(
        out / "source-evidence.csv",
        [
            {"page": "product", "url": SOURCE_RU, "http_status": pages["product"]["status"], "bytes": len(pages["product"]["html"])},
            {"page": "enproduct", "url": SOURCE_EN, "http_status": pages["enproduct"]["status"], "bytes": len(pages["enproduct"]["html"])},
            {"page": "home", "url": "https://aqualania.ru/", "http_status": pages["home"]["status"], "bytes": len(pages["home"]["html"])},
            {"page": "sitemap", "url": "https://aqualania.ru/sitemap.xml", "http_status": pages["sitemap"]["status"], "bytes": len(pages["sitemap"]["html"])},
            {"page": "robots", "url": "https://aqualania.ru/robots.txt", "http_status": pages["robots"]["status"], "bytes": len(pages["robots"]["html"])},
        ],
    )

    disputed = [
        p
        for p in products
        if p["flavor"] in {"Игристое", "Фейхоа"} or p.get("image_match_status") == "exact_low_res"
    ]
    line_dist = Counter(p["line"] for p in products)
    cat_dist = Counter(p["category"] for p in approved)
    img_dist = Counter(p.get("image_match_status") for p in products)

    manifest = {
        "stage": "stage1-site-discovered-dry-run",
        "created_at": utc_now(),
        "manufacturer": MANUFACTURER,
        "brand": BRAND,
        "source_primary": SOURCE_RU,
        "source_en": SOURCE_EN,
        "pdf_file_available": False,
        "scope": {
            "official_site_only": True,
            "third_party_forbidden": True,
            "production_writes": False,
            "apply_run": False,
        },
        "counts": {
            "discovered": len(products),
            "approved": len(approved),
            "manual": len(manual),
            "rejected": len(rejected),
            "images_exact": img_dist.get("exact", 0),
            "images_exact_low_res": img_dist.get("exact_low_res", 0),
            "images_shared": img_dist.get("shared", 0),
            "images_missing": img_dist.get("missing", 0),
            "production_sku_collisions": sum(1 for p in products if p.get("duplicate_status") == "sku_collision"),
            "probable_matches": sum(1 for p in products if p.get("duplicate_status") == "probable_match"),
        },
        "line_distribution": dict(line_dist),
        "category_distribution_approved": dict(cat_dist),
        "approved_skus": [p["proposed_sku"] for p in approved],
        "manual_skus": [p["proposed_sku"] for p in manual],
        "rejected_skus": [p["proposed_sku"] for p in rejected],
        "categories": [
            {"name": c["name"], "slug": c["slug"], "id": c["id"]}
            for c in [
                CATEGORIES["limonady"],
                CATEGORIES["kola"],
                CATEGORIES["voda-gazirovannaya"],
                CATEGORIES["voda-negazirovannaya"],
                CATEGORIES["gazirovannye-napitki"],
            ]
        ],
        "categories_to_create": [],
        "disputed": [
            {
                "sku": p["proposed_sku"],
                "flavor": p["flavor"],
                "reason": p.get("notes") or p.get("review_reason") or p.get("image_match_status"),
            }
            for p in disputed
        ],
        "apply": {
            "sales_status": "showcase",
            "is_active": True,
            "price_amount": None,
            "availability": "on_order",
            "orderable": False,
            "units_per_package": 1,
            "create_only": True,
            "modify_existing_products": False,
        },
        "checks": {
            "production_db_modified": False,
            "apply_run": False,
            "merge_used": False,
            "existing_products_modified": False,
        },
    }
    (out / "approved-import-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out / "discovered.json").write_text(
        json.dumps({"products": products, "pages": {k: {"url": v["url"], "status": v["status"]} for k, v in pages.items()}}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )

    report = f"""# AquAlania pre-apply / stage-1 dry-run report

**When:** {manifest['created_at']}  
**Output:** `{out.relative_to(ROOT)}`  
**Sources:** {SOURCE_RU}, {SOURCE_EN} (official only)

## Pages researched
- product, enproduct, home, sitemap.xml, robots.txt → **5**

## Counts
| Bucket | Count |
|--------|------:|
| Discovered | **{len(products)}** |
| Approved | **{len(approved)}** |
| Manual | **{len(manual)}** |
| Rejected | **{len(rejected)}** |
| Images exact | {img_dist.get('exact', 0)} |
| Images exact_low_res | {img_dist.get('exact_low_res', 0)} |
| Images missing | {img_dist.get('missing', 0)} |
| Production SKU collisions | {manifest['counts']['production_sku_collisions']} |
| Probable matches | {manifest['counts']['probable_matches']} |

## Lines
{chr(10).join(f"- {k}: **{v}**" for k,v in sorted(line_dist.items()))}

## Approved categories
{chr(10).join(f"- {k}: **{v}**" for k,v in sorted(cat_dist.items())) or '_none_'}

## Disputed / notes
{chr(10).join(f"- `{d['sku']}` — {d['reason']}" for d in manifest['disputed']) or '_none_'}

## Manifest
`{ (out / 'approved-import-manifest.json').relative_to(ROOT) }`

## Apply readiness
- create-only apply implemented in `scripts/import-aqualania.ts`
- **production apply NOT run**
- requires separate confirmation + backup flags
"""
    (out / "PRE-APPLY-REPORT.md").write_text(report, encoding="utf-8")

    runbook = f"""# VPS Production Runbook — AquAlania (draft)

**Do not run until operator explicitly confirms production apply.**

| | |
|--|--|
| Manifest | `{ (out / 'approved-import-manifest.json').relative_to(ROOT) }` |
| Approved SKUs | **{len(approved)}** |
| Working directory | `/opt/tinda/app` or dedicated worktree |

```bash
# backup
STAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP=/opt/tinda/app/backups/tinda-prod-aqualania-$STAMP.sql
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP"
sha256sum "$BACKUP" | tee "$BACKUP.sha256"

npm run import:aqualania:apply -- \\
  --i-understand-and-have-backup \\
  --backup-path="$BACKUP" \\
  --manifest="{ (out / 'approved-import-manifest.json').relative_to(ROOT) }"
```

Forbidden: `--merge`, editing existing products, auto-creating categories, importing manual/rejected.
"""
    (out / "VPS-PRODUCTION-RUNBOOK.md").write_text(runbook, encoding="utf-8")

    # latest symlink
    latest = ART / "latest-stage1"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    latest.symlink_to(out.name)

    (ART / "README.md").write_text(
        f"""# Импорт производителя AquAlania

Источник: только https://aqualania.ru/product (+ /enproduct).  
Производитель: {MANUFACTURER}.

## Stage 1

```bash
npm run import:aqualania:stage1
# or
python3 scripts/aqualania-stage1.py
```

Latest: `latest-stage1/` → `{out.name}`

Apply: `npm run import:aqualania:apply` (gated; not run in stage 1).
""",
        encoding="utf-8",
    )

    print(report)
    print(f"Wrote {out.relative_to(ROOT)}")
    print("APPROVED", len(approved), "MANUAL", len(manual), "REJECTED", len(rejected))


if __name__ == "__main__":
    main()
