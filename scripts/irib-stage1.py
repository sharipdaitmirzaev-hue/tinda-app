#!/usr/bin/env python3
"""IRIB (ИРИБ) stage-1 discover/dry-run: official site only, no production writes."""

from __future__ import annotations

import csv
import hashlib
import html as htmlmod
import json
import re
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "artifacts/irib-import"
UA = "TINDA-IRIB-Import/1.0 (+https://tindamarket.ru)"
MANUFACTURER = "ООО «ИРИБ»"
SOURCE = "https://irib.su"
WP_PRODUCTS = "https://irib.su/wp-json/wp/v2/product?per_page=100"
CANVAS = 1000
MAX_SIDE = 1600
LOW_RES_MAX = 400

CATEGORIES = {
    "sok": {"name": "Сок", "slug": "sok", "id": "32a861a6-7c39-4329-b17c-09d3a420f7c2"},
    "nektar": {"name": "Нектар", "slug": "nektar", "id": "46d78cfd-6749-441c-9b27-c7237552cad8"},
    "limonady": {
        "name": "Лимонады",
        "slug": "limonady",
        "id": "a8af36d2-ef7a-49ce-8aea-42fdf99359ae",
    },
    "kola": {"name": "Кола", "slug": "kola", "id": "34bee47b-61c3-4e15-81db-75d58ecf018b"},
    "kholodnyy-chay": {
        "name": "Холодный чай",
        "slug": "kholodnyy-chay",
        "id": "88192b93-0ce7-4b67-b6a5-9cb208a17bbb",
    },
    "kvas": {"name": "Квас", "slug": "kvas", "id": "e1f3f5b4-7b79-4652-8989-82d30cff34a1"},
    "voda-pitevaya": {
        "name": "Питьевая вода",
        "slug": "voda-pitevaya",
        "id": "58b17c1b-ce93-47d6-9e9d-df407b076889",
    },
    "voda-mineralnaya": {
        "name": "Минеральная вода",
        "slug": "voda-mineralnaya",
        "id": "58ba9d27-1100-49af-9644-9bbfe6ea00a2",
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
    "energeticheskie-napitki": {
        "name": "Энергетические напитки",
        "slug": "energeticheskie-napitki",
        "id": "a3f3ce9e-00db-4cb4-961d-54e48343b03d",
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

# Dedicated 3L pages — do not also expand 3L from parent multi-volume pages.
DEDICATED_3L_SLUGS = {
    "yablochnyj-sok-3l",
    "yablochnyj-nektar-3l",
    "yablochno-abrikosovyj-nektar-3l",
    "abrikosovyj-nektar",
}

# Prefer these source pages when SKU collides across WP posts.
SKU_SOURCE_PRIORITY = {
    "profi-sport-energy-so-vkusom-guarana": 10,
    "profi-sport-bcaa-chernika": 10,
    "energy": 5,
    "bacaa": 5,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"


def fetch(url: str, retries: int = 4) -> tuple[int, bytes]:
    last: Exception | None = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.status, res.read()
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.2 * (i + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def fetch_json(url: str) -> tuple[dict | list, dict]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as res:
        body = json.loads(res.read().decode())
        return body, dict(res.headers)


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
    return f"IRIB-{slug_part(line)}-{slug_part(flavor_key)}-{volume_ml}-{package_code}"


def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None):
    if fields is None:
        fields = []
        for r in rows:
            for k in r:
                if k not in fields:
                    fields.append(k)
    if not fields:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def strip_html(s: str) -> str:
    return BeautifulSoup(s or "", "lxml").get_text(" ", strip=True)


def parse_volumes_ml(text: str) -> list[int]:
    """Parse volumes like 0,33/0,5/0,75/3л or 0.5л/1,25л from excerpt/title."""
    if not text:
        return []
    t = text.lower().replace("ё", "е")
    found: list[int] = []

    def add(ml: int):
        if 50 <= ml <= 30000 and ml not in found:
            found.append(ml)

    # Slash lists first (unit often only on the last token): 0,33/0,5/0,75/3л
    for m in re.finditer(
        r"((?:\d+(?:[.,]\d+)?\s*/\s*)+\d+(?:[.,]\d+)?)\s*(мл|ml|л|l)\b",
        t,
        re.I,
    ):
        unit = m.group(2).lower()
        for part in re.split(r"\s*/\s*", m.group(1)):
            num = float(part.replace(",", ".").strip())
            ml = int(round(num if unit in {"мл", "ml"} else num * 1000))
            add(ml)

    # Standalone volume tokens
    for m in re.finditer(r"(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l)\b", t, re.I):
        num = float(m.group(1).replace(",", "."))
        unit = m.group(2).lower()
        ml = int(round(num if unit in {"мл", "ml"} else num * 1000))
        add(ml)

    return found


def volume_from_filename(name: str) -> int | None:
    n = name.lower()
    patterns = [
        (r"(?:^|[^0-9])19\s*l", 19000),
        (r"(?:^|[^0-9])5[-_]?l\b", 5000),
        (r"3l", 3000),
        (r"(?:^|[^0-9])15[-_]?l", 1500),
        (r"(?:^|[^0-9])1[.,]?5[-_]?l", 1500),
        (r"(?:^|[^0-9])125\b", 1250),
        (r"(?:^|[^0-9])1[.,]?25", 1250),
        (r"(?:^|[^0-9])075\b", 750),
        (r"(?:^|[^0-9])0?75\b", 750),
        (r"(?:^|[^0-9])06\b", 600),
        (r"(?:^|[^0-9])0?6[-_]?l", 600),
        (r"(?:^|[^0-9])05\b", 500),
        (r"(?:^|[^0-9])500\b", 500),
        (r"(?:^|[^0-9])0?5[-_]?l", 500),
        (r"(?:^|[^0-9])33\b", 330),
        (r"(?:^|[^0-9])0?33", 330),
    ]
    for pat, ml in patterns:
        if re.search(pat, n):
            return ml
    return None


def volume_text(ml: int) -> str:
    if ml % 1000 == 0:
        return f"{ml // 1000} л"
    if ml >= 1000:
        v = ml / 1000
        s = f"{v:.2f}".rstrip("0").rstrip(".").replace(".", ",")
        return f"{s} л"
    return f"{ml} мл"


def package_label(code: str) -> str:
    return {"GLASS": "стекло", "PET": "ПЭТ", "CAN": "жестяная банка"}.get(code, code)


def map_product_meta(slug: str, title: str, catalogs: list[str], excerpt: str) -> dict:
    """Return brand, line, flavor, package defaults, category, carbonation hints."""
    title_l = title.lower()
    ex_l = excerpt.lower()
    cats = set(catalogs)
    blob = f"{slug} {title_l} {ex_l} {' '.join(cats)}"

    brand = "Ириб"
    line = "IRIB"
    package = "PET"
    category_slug = None
    carbonation = None
    flavor = title
    notes: list[str] = []

    # ---- lines / brands ----
    if slug.startswith("bro-lemon") or "bro lemon" in title_l:
        brand, line, package = "Bro Lemon", "BRO-LEMON", "PET"
        category_slug = "kola" if "cola" in slug or "кола" in title_l else "limonady"
        flavor = re.sub(r"(?i)^bro\s*lemon\s*", "", title).strip() or title
    elif "selesta" in blob or slug in {
        "ananas",
        "granat",
        "grusha",
        "mohito",
        "multifrukt-2",
        "shipovnik",
        "tarhun",
    }:
        brand, line, package = "Selesta", "SELESTA", "GLASS"
        category_slug = "limonady"
        flavor = title.strip("«»\" ")
    elif cats & {"limonadi-v-stekle"} or slug.startswith("mindari") or slug in {
        "limonad-s-ananasom",
        "limonad-mohito",
        "limonad-grusha",
        "limonad-s-shipovnikom",
        "mindari-s-mango",
    }:
        brand, line, package = "Mindari", "MINDARI", "GLASS"
        category_slug = "limonady"
        flavor = re.sub(r"(?i)^лимонад\s*(с\s*)?", "", title).strip(" «»\"") or title
    elif cats & {"limonadi-v-pet"} or "v-pet" in slug:
        brand, line, package = "Ириб", "LIMONAD-PET", "PET"
        category_slug = "kola" if "cola" in slug else "limonady"
        flavor = re.sub(r"(?i)^лимонад\s*|«|»|в\s*пэт", "", title).strip(" «»\"") or title
    elif cats & {"chai-holodnyj"} or slug.startswith("ice-bar"):
        brand, line, package = "Ice Bar", "ICE-BAR", "PET"
        category_slug = "kholodnyy-chay"
        flavor = re.sub(r"(?i)^ice\s*bar\s*", "", title).strip() or title
    elif cats & {"sportivnye-napitki"} or "profi" in slug or slug in {
        "bacaa",
        "energy",
        "isotonic",
        "l_carnitine",
    }:
        brand, line, package = "PROFI SPORT", "PROFI-SPORT", "PET"
        if "energy" in slug or "гуаран" in title_l:
            category_slug = "energeticheskie-napitki"
            flavor = "Energy Гуарана" if "гуаран" in title_l or "energy" in slug else title
        elif "bcaa" in slug or slug == "bacaa":
            category_slug = None  # manual — sports AA drink
            if "черник" in title_l:
                flavor = "BCAA Черника"
            else:
                flavor = "BCAA Апельсин"
            notes.append("category_manual:sports_bcaa")
        elif "isotonic" in slug:
            category_slug = None
            flavor = "Isotonic Гуава"
            notes.append("category_manual:sports_isotonic")
        elif "carnitine" in slug or "l_carnitine" in slug:
            category_slug = None
            flavor = "L-Carnitine"
            notes.append("category_manual:sports_carnitine")
        carbonation = "негазированный"
    elif cats & {"kvas"} or slug == "kvas":
        brand, line, package = "Ириб", "KVAS", "PET"
        category_slug = "kvas"
        flavor = "Янтарный"
    elif cats & {"mineral-water"} or "tarki" in slug:
        brand, line, package = "Тарки-Тау", "TARKI-TAU", "GLASS"
        category_slug = "voda-gazirovannaya"
        flavor = "Тарки-Тау"
        carbonation = "среднегазированная"
    elif "чегери" in title_l or slug == "rodnikovaya-svezhest-3":
        brand, line, package = "Чегери", "CHEGERI", "PET"
        category_slug = "voda-pitevaya"
        flavor = "Негазированная"
        carbonation = "негазированная"
    elif slug == "rodnichok":
        brand, line, package = "Родничок", "RODNICHOK", "PET"
        category_slug = "voda-pitevaya"
        flavor = "Негазированная"
        carbonation = "негазированная"
    elif slug == "rodnikovaya-svezhest-2":
        brand, line, package = "Родниковая свежесть", "RODNIKOVAYA-SVEZHEST", "PET"
        category_slug = "voda-mineralnaya"
        flavor = "Негазированная"
        carbonation = "негазированная"
    elif (
        "talih" in blob
        or "талих" in blob
        or slug.startswith("rodnikovaya")
        or slug == "818"
    ):
        brand, line, package = "Талих", "TALIH", "PET"
        if "sport" in slug or "спорт" in title_l or slug == "818":
            line = "TALIH-SPORT"
            category_slug = "gazirovannye-napitki"
            m = re.search(r"[«\"]([^»\"]+)[»\"]", title)
            flavor = (
                m.group(1)
                if m
                else re.sub(r"(?i)^талих\s*спорт\s*", "", title).strip() or "Классический"
            )
            if flavor.lower() in {"", "талих спорт", "талих"}:
                flavor = "Классический"
        else:
            category_slug = "voda-negazirovannaya"
            flavor = "Негазированная"
            carbonation = "негазированная"
    elif cats & {"gold-grand"} or slug in {
        "ananas-0-6l",
        "grusha-0-6l",
        "multifrukt-0-6l",
        "mohito-0-6l",
        "mohito-0-6l-negazirovannyj",
        "tarhun-3",
    }:
        brand, line, package = "GOLD GRAND", "GOLD-GRAND", "PET"
        category_slug = "limonady"
        flavor = re.sub(r"(?i)негазированн\w*", "", title).strip() or title
        if slug == "mohito-0-6l-negazirovannyj" or "негазир" in blob:
            carbonation = "негазированный"
            flavor = "Мохито негазированный"
        else:
            carbonation = "газированный"
    elif cats & {"cok"} or "сок" in title_l and "нектар" not in title_l:
        brand, line, package = "Ириб", "SOK", "GLASS"
        category_slug = "sok"
        flavor = re.sub(r"(?i)\s*сок.*$", "", title).strip() or title
        if "3л" in title_l or slug.endswith("-3l"):
            package = "PET"  # large format on site is PET family pack imagery
    elif cats & {"nektar"} or "нектар" in title_l:
        brand, line, package = "Ириб", "NEKTAR", "GLASS"
        category_slug = "nektar"
        flavor = re.sub(r"(?i)\s*нектар.*$", "", title).strip() or title
        if "3л" in title_l or slug.endswith("-3l") or slug == "abrikosovyj-nektar":
            package = "PET"
    else:
        notes.append("unclassified_line")

    # Cola override
    if category_slug == "limonady" and ("cola" in slug or re.search(r"\bкола\b", title_l)):
        category_slug = "kola"
        flavor = "Cola"

    flavor_key = slug_part(flavor) or slug_part(slug)
    return {
        "brand": brand,
        "line": line,
        "flavor": flavor,
        "flavor_key": flavor_key,
        "package_code": package,
        "package_type": package_label(package),
        "category_slug": category_slug,
        "carbonation": carbonation,
        "notes": notes,
    }


def resolve_category(category_slug: str | None) -> dict:
    if category_slug and category_slug in CATEGORIES:
        c = CATEGORIES[category_slug]
        return {
            "category": c["name"],
            "category_slug": c["slug"],
            "category_id": c["id"],
            "category_status": "mapped",
        }
    return {
        "category": "",
        "category_slug": "",
        "category_id": "",
        "category_status": "manual",
    }


def load_wp_products() -> list[dict]:
    items, hdrs = fetch_json(WP_PRODUCTS + "&page=1")
    assert isinstance(items, list)
    total_pages = int(hdrs.get("X-WP-TotalPages") or 1)
    for p in range(2, total_pages + 1):
        batch, _ = fetch_json(WP_PRODUCTS + f"&page={p}")
        assert isinstance(batch, list)
        items.extend(batch)
        time.sleep(0.2)
    return items


def load_media(media_id: int, cache: dict[int, dict]) -> dict | None:
    if not media_id:
        return None
    if media_id in cache:
        return cache[media_id]
    try:
        data, _ = fetch_json(f"https://irib.su/wp-json/wp/v2/media/{media_id}")
        assert isinstance(data, dict)
        cache[media_id] = data
        time.sleep(0.08)
        return data
    except Exception as exc:  # noqa: BLE001
        print(f"WARN media {media_id}: {exc}")
        return None


def process_image(src: Path, dest: Path) -> dict:
    im = Image.open(src)
    im = im.convert("RGBA") if im.mode in ("P", "RGBA") else im.convert("RGB").convert("RGBA")
    w, h = im.size
    scale = min(1.0, MAX_SIDE / max(w, h))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 255))
    fit = (CANVAS * 0.92) / max(im.size)
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


def load_production_products() -> list[dict]:
    snapshot = ROOT / "tmp/prod-catalog-irib.json"
    if snapshot.exists():
        data = json.loads(snapshot.read_text(encoding="utf-8"))
        items = data.get("items") if isinstance(data, dict) else data
        if isinstance(items, list) and items:
            print(f"Loaded production products from snapshot (read-only): {len(items)}")
            return items
    items: list[dict] = []
    page = 1
    while page <= 80:
        data, _ = fetch_json(
            f"https://tindamarket.ru/api/v1/catalog/products?page={page}&page_size=20"
        )
        assert isinstance(data, dict)
        batch = data.get("items") or []
        items.extend(batch)
        total = int(data.get("total") or 0)
        print(f"production page {page}: +{len(batch)} (so_far={len(items)}/{total})")
        if not batch or len(items) >= total:
            break
        page += 1
        time.sleep(0.12)
    return items


def parse_prod_volume_ml(text: str | None) -> int | None:
    if not text:
        return None
    return (parse_volumes_ml(text) or [None])[0]


def classify_duplicate(product: dict, existing: list[dict]) -> tuple[str, list[dict]]:
    sku = product["proposed_sku"].upper()
    hits = []
    for ex in existing:
        if (ex.get("sku") or "").upper() == sku:
            return "sku_collision", [ex]
    hints = [
        "ириб",
        "irib",
        "selesta",
        "bro lemon",
        "mindari",
        "миндари",
        "ice bar",
        "gold grand",
        "profi sport",
        "талих",
        "тарки",
        "родничок",
        "чегери",
    ]
    flavor = (product.get("flavor") or "").lower()
    for ex in existing:
        name = (ex.get("name") or "").lower()
        brand = (ex.get("brand") or "").lower()
        ex_sku = (ex.get("sku") or "").upper()
        brand_hit = any(h in brand or h in name for h in hints) or ex_sku.startswith("ZY-IRIB") or ex_sku.startswith(
            "IRIB-"
        )
        if not brand_hit:
            continue
        vol = parse_prod_volume_ml(ex.get("volume_text")) or parse_prod_volume_ml(ex.get("name"))
        pkg = (ex.get("package_type") or "").lower()
        same_vol = vol is not None and vol == product.get("volume_ml")
        same_pkg = False
        pt = (product.get("package_type") or "").lower()
        if "стекл" in pt and ("стекл" in pkg or "glass" in pkg):
            same_pkg = True
        if "пэт" in pt and ("пэт" in pkg or "pet" in pkg or "пластик" in pkg):
            same_pkg = True
        # Avoid cross-brand false positives (Selesta lemonade ≠ Ириб juice).
        prod_brand = (product.get("brand") or "").lower().replace("-", " ")
        name_n = name.replace("-", " ")
        brand_n = brand.replace("-", " ")
        if prod_brand and prod_brand not in {"ириб", "irib"}:
            if prod_brand not in brand_n and prod_brand not in name_n:
                token = prod_brand.split()[0]
                if len(token) >= 4 and token not in name_n and token not in brand_n:
                    continue

        flavor_n = flavor.replace("-", " ")
        flavor_hit = bool(flavor_n) and (
            flavor_n in name_n or (flavor_n.split()[0] in name_n if flavor_n.split() else False)
        )
        fk = (product.get("flavor_key") or "").lower().replace("-", " ")
        if any(part in name_n for part in fk.split() if len(part) >= 4):
            flavor_hit = True
        # Mineral water line match by brand token
        if product.get("line") == "TARKI-TAU" and ("тарки" in name_n or "tarki" in name_n):
            flavor_hit = True

        if flavor_hit and same_vol and same_pkg:
            hits.append(ex)
            return "exact_match", hits
        if flavor_hit and (same_vol or same_pkg):
            hits.append(ex)
    if hits:
        return "probable_match", hits
    return "new_product", []


def contact_sheet(items: list[dict], preview_dir: Path, out_jpg: Path, out_html: Path):
    cols = 5
    rows = max(1, (len(items) + cols - 1) // cols)
    cell_w, cell_h, label_h = 220, 280, 52
    sheet = Image.new("RGB", (cols * cell_w, max(1, rows) * (cell_h + label_h) + 40), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
        font_h = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
    except Exception:
        font = ImageFont.load_default()
        font_h = font
    draw.text((8, 10), f"IRIB stage1 contact sheet ({len(items)} SKUs)", fill=(20, 20, 20), font=font_h)
    html = ["<html><body><h1>IRIB contact sheet</h1><div style='display:flex;flex-wrap:wrap;gap:8px'>"]
    for i, p in enumerate(items):
        r, c = divmod(i, cols)
        x, y = c * cell_w, 40 + r * (cell_h + label_h)
        prev = preview_dir / f"{p['proposed_sku']}.jpg"
        if prev.exists():
            im = Image.open(prev).convert("RGB")
            im.thumbnail((cell_w - 20, cell_h - 20))
            sheet.paste(im, (x + (cell_w - im.width) // 2, y + 8))
        label = p["proposed_sku"].replace("IRIB-", "")
        draw.text((x + 4, y + cell_h - 4), label[:34], fill=(0, 0, 0), font=font)
        html.append(
            f"<div style='width:200px'><img src='previews/{p['proposed_sku']}.jpg' width='180'/>"
            f"<div style='font:11px monospace'>{p['proposed_sku']}</div>"
            f"<div>{p.get('review_status')}</div></div>"
        )
    html.append("</div></body></html>")
    sheet.save(out_jpg, "JPEG", quality=85)
    out_html.write_text("\n".join(html), encoding="utf-8")


def expand_skus(wp_item: dict, media_cache: dict[int, dict]) -> list[dict]:
    slug = wp_item["slug"]
    title = htmlmod.unescape(wp_item["title"]["rendered"])
    excerpt = strip_html(wp_item.get("excerpt", {}).get("rendered", ""))
    content = strip_html(wp_item.get("content", {}).get("rendered", ""))
    catalogs = [c.replace("catalog-", "") for c in wp_item.get("class_list") or [] if c.startswith("catalog-")]
    link = wp_item.get("link") or f"{SOURCE}/product/{slug}/"
    meta = map_product_meta(slug, title, catalogs, excerpt)
    cat = resolve_category(meta["category_slug"])

    media = load_media(int(wp_item.get("featured_media") or 0), media_cache)
    featured_url = (media or {}).get("source_url")
    fname = Path(urllib.parse.urlparse(featured_url).path).name if featured_url else ""
    img_vol = volume_from_filename(fname) if fname else None

    volumes = parse_volumes_ml(excerpt) or parse_volumes_ml(title) or parse_volumes_ml(content)
    # slug volume hints
    slug_vols = parse_volumes_ml(slug.replace("-", " ").replace("0 ", "0,"))
    if not volumes and slug_vols:
        volumes = slug_vols
    if not volumes and re.search(r"0-6l", slug):
        volumes = [600]
    if not volumes and re.search(r"6l", slug) and "sport" not in slug:
        # rodnikovaya-svezhest-6l is 5L per excerpt; don't guess from slug alone
        pass

    # Skip 3L expansion when dedicated page exists
    if slug not in DEDICATED_3L_SLUGS and 3000 in volumes:
        if any(s in DEDICATED_3L_SLUGS for s in DEDICATED_3L_SLUGS):
            # if a dedicated sibling exists for this flavor family, drop 3000 from parent
            if slug in {
                "yablochnyj-sok",
                "yablochnyj-nektar",
                "yablochno-abrikosovyj-nektar",
                "abrikosovyj-sok",
            }:
                volumes = [v for v in volumes if v != 3000]

    conflict_notes = list(meta.get("notes") or [])
    # Title/excerpt flavor conflicts (known site bug)
    if slug == "818":
        if "гранат" in title.lower() and "манго" in excerpt.lower():
            conflict_notes.append("title_excerpt_flavor_conflict")

    rows: list[dict] = []
    if not volumes:
        # Discover as incomplete packaging SKU stub for manual review
        rows.append(
            {
                "slug": slug,
                "official_name": title,
                "source_url": link,
                "excerpt": excerpt,
                "catalogs": catalogs,
                "brand": meta["brand"],
                "line": meta["line"],
                "flavor": meta["flavor"],
                "flavor_key": meta["flavor_key"],
                "volume_ml": 0,
                "volume_text": "",
                "package_code": meta["package_code"],
                "package_type": meta["package_type"],
                "carbonation": meta.get("carbonation"),
                "source_image_url": featured_url,
                "image_volume_ml": img_vol,
                "image_assigned": bool(featured_url),
                "volume_confidence": "none",
                "conflict_notes": conflict_notes + ["volume_unknown"],
                **cat,
            }
        )
        return rows

    for vol in volumes:
        assigned = False
        img_status_hint = "missing"
        source_image = None
        if featured_url:
            if len(volumes) == 1:
                assigned = True
                source_image = featured_url
                img_status_hint = "exact"
            elif img_vol == vol:
                assigned = True
                source_image = featured_url
                img_status_hint = "exact"
            else:
                # Do not reuse one bottle photo for other volumes
                assigned = False
                source_image = None
                img_status_hint = "missing"
                conflict_notes_vol = conflict_notes + ["multi_volume_image_unassigned"]
        else:
            conflict_notes_vol = conflict_notes + ["missing_featured_image"]
            img_status_hint = "missing"

        conf = "high" if (len(volumes) == 1 or img_vol == vol) else "low"
        if len(volumes) == 1:
            conf = "high"
        elif img_vol == vol:
            conf = "high"
        else:
            conf = "low"

        rows.append(
            {
                "slug": slug,
                "official_name": title,
                "source_url": link,
                "excerpt": excerpt,
                "catalogs": catalogs,
                "brand": meta["brand"],
                "line": meta["line"],
                "flavor": meta["flavor"],
                "flavor_key": meta["flavor_key"],
                "volume_ml": vol,
                "volume_text": volume_text(vol),
                "package_code": meta["package_code"],
                "package_type": meta["package_type"],
                "carbonation": meta.get("carbonation"),
                "source_image_url": source_image,
                "image_volume_ml": img_vol,
                "image_assigned": assigned,
                "image_status_hint": img_status_hint,
                "volume_confidence": conf,
                "conflict_notes": (
                    conflict_notes
                    if assigned or len(volumes) == 1
                    else conflict_notes + ["multi_volume_image_unassigned"]
                ),
                **cat,
            }
        )
    return rows


def proposed_name(p: dict) -> str:
    brand = p["brand"]
    flavor = p["flavor"]
    vol = p.get("volume_text") or ""
    pkg = p.get("package_type") or ""
    line = p.get("line") or ""
    if line in {"SOK"}:
        base = f"Сок {brand} {flavor}"
    elif line in {"NEKTAR"}:
        base = f"Нектар {brand} {flavor}"
    elif line == "KVAS":
        base = f"Квас {brand} {flavor}"
    elif line == "TARKI-TAU":
        base = f"Вода {brand} {flavor}"
    elif line.startswith("TALIH"):
        base = f"{brand} {flavor}" if "SPORT" in line else f"Вода {brand}"
    elif line == "ICE-BAR":
        base = f"Ice Bar {flavor}"
    elif line == "PROFI-SPORT":
        base = f"PROFI SPORT {flavor}"
    elif line == "BRO-LEMON":
        base = f"Bro Lemon {flavor}"
    elif line == "SELESTA":
        base = f"Selesta {flavor}"
    elif line == "MINDARI":
        base = f"Mindari {flavor}"
    elif line == "GOLD-GRAND":
        base = f"GOLD GRAND {flavor}"
    else:
        base = f"{brand} {flavor}"
    bits = [base]
    if vol:
        bits.append(vol)
    if pkg:
        bits.append(pkg)
    return ", ".join(bits)


def main():
    out = ART / f"{stamp()}-stage1"
    raw = out / "raw-html"
    src_dir = out / "source-downloads"
    proc = out / "processed"
    prev = out / "previews"
    for d in (out, raw, src_dir, proc, prev):
        d.mkdir(parents=True, exist_ok=True)

    evidence = []
    pages_meta = {}
    for key, url in {
        "home": f"{SOURCE}/",
        "sitemap": f"{SOURCE}/sitemap.xml",
        "robots": f"{SOURCE}/robots.txt",
        "o-kompanii": f"{SOURCE}/o-kompanii/",
        "katalog": f"{SOURCE}/catalog/katalog-produktsii/",
    }.items():
        status, body = fetch(url)
        (raw / f"{key}.html").write_bytes(body)
        pages_meta[key] = {"url": url, "status": status, "bytes": len(body)}
        evidence.append({"page": key, "url": url, "http_status": status, "bytes": len(body)})

    # catalog sections
    catalog_urls = re.findall(r"<loc>(https://irib\.su/catalog/[^<]+)</loc>", (raw / "sitemap.html").read_text("utf-8", "ignore"))
    # sitemap saved as .html but is xml
    sm_text = (raw / "sitemap.html").read_text("utf-8", "ignore")
    catalog_urls = sorted(set(re.findall(r"<loc>(https://irib\.su/catalog/[^<]+)</loc>", sm_text)))
    for url in catalog_urls:
        slug = url.rstrip("/").split("/")[-1]
        status, body = fetch(url)
        (raw / f"catalog__{slug}.html").write_bytes(body)
        pages_meta[f"catalog:{slug}"] = {"url": url, "status": status, "bytes": len(body)}
        evidence.append({"page": f"catalog:{slug}", "url": url, "http_status": status, "bytes": len(body)})
        time.sleep(0.15)

    print("Loading WP products…")
    wp_items = load_wp_products()
    (out / "wp-products.json").write_text(json.dumps(wp_items, ensure_ascii=False, indent=2), encoding="utf-8")
    evidence.append(
        {
            "page": "wp-json/product",
            "url": WP_PRODUCTS,
            "http_status": 200,
            "bytes": (out / "wp-products.json").stat().st_size,
            "count": len(wp_items),
        }
    )

    media_cache: dict[int, dict] = {}
    expanded: list[dict] = []
    for it in wp_items:
        # also save product HTML for evidence
        link = it.get("link") or f"{SOURCE}/product/{it['slug']}/"
        try:
            status, body = fetch(link)
            (raw / f"product__{it['slug']}.html").write_bytes(body)
            evidence.append({"page": f"product:{it['slug']}", "url": link, "http_status": status, "bytes": len(body)})
        except Exception as exc:  # noqa: BLE001
            evidence.append({"page": f"product:{it['slug']}", "url": link, "http_status": 0, "error": str(exc)})
        expanded.extend(expand_skus(it, media_cache))
        time.sleep(0.12)

    # Build product records with SKUs
    products: list[dict] = []
    for row in expanded:
        if not row.get("volume_ml"):
            # placeholder sku for manual incomplete rows
            sku = build_sku(row["line"], row["flavor_key"] or row["slug"], 0, row["package_code"])
            # invalid volume — use MANUAL sentinel volume 0 encoded differently
            sku = f"IRIB-{slug_part(row['line'])}-{slug_part(row['flavor_key'] or row['slug'])}-UNKNOWN-{row['package_code']}"
        else:
            sku = build_sku(row["line"], row["flavor_key"], row["volume_ml"], row["package_code"])
        products.append(
            {
                **row,
                "proposed_sku": sku,
                "proposed_name": proposed_name(row) if row.get("volume_ml") else f"{row['brand']} {row['flavor']}",
                "manufacturer": MANUFACTURER,
                "confidence": "low",
                "review_status": "manual",
                "image_match_status": "missing",
                "duplicate_status": "new_product",
            }
        )

    # Deduplicate by SKU — prefer higher source priority and image-assigned rows
    by_sku: dict[str, dict] = {}
    for p in products:
        sku = p["proposed_sku"]
        prev_p = by_sku.get(sku)
        if not prev_p:
            by_sku[sku] = p
            continue
        score = (1 if p.get("image_assigned") else 0) + SKU_SOURCE_PRIORITY.get(p.get("slug") or "", 0)
        prev_score = (1 if prev_p.get("image_assigned") else 0) + SKU_SOURCE_PRIORITY.get(prev_p.get("slug") or "", 0)
        if score > prev_score:
            by_sku[sku] = p
    products = sorted(by_sku.values(), key=lambda p: p["proposed_sku"])

    print(f"Discovered SKUs: {len(products)}")

    # Images
    image_audit = []
    for p in products:
        url = p.get("source_image_url")
        if not url:
            p["image_match_status"] = "missing"
            p["image_path"] = ""
            image_audit.append(
                {
                    "sku": p["proposed_sku"],
                    "status": "missing",
                    "source_url": "",
                    "note": "No official volume-matched image",
                }
            )
            continue
        fname = urllib.parse.unquote(url.rsplit("/", 1)[-1])
        local = src_dir / f"{p['proposed_sku']}__{fname}"
        try:
            status, body = fetch(url)
            local.write_bytes(body)
            sha = hashlib.sha256(body).hexdigest()
            im = Image.open(local)
            w, h = im.size
            mime = Image.MIME.get(im.format or "", "application/octet-stream")
            low = max(w, h) <= LOW_RES_MAX
            p["image_match_status"] = "exact_low_res" if low else "exact"
            p["image_width"] = w
            p["image_height"] = h
            p["image_mime"] = mime
            p["source_image_sha256"] = sha
            p["source_image_bytes"] = len(body)
            dest = proc / f"{p['proposed_sku']}.webp"
            meta = process_image(local, dest)
            p["image_path"] = str(dest.relative_to(ROOT))
            p["processed_sha256"] = meta["sha256"]
            p["processed_bytes"] = meta["bytes"]
            # preview
            im2 = Image.open(dest).convert("RGB")
            im2.thumbnail((360, 360))
            im2.save(prev / f"{p['proposed_sku']}.jpg", "JPEG", quality=85)
            image_audit.append(
                {
                    "sku": p["proposed_sku"],
                    "status": p["image_match_status"],
                    "source_url": url,
                    "source_width": w,
                    "source_height": h,
                    "source_mime": mime,
                    "source_sha256": sha,
                    "source_bytes": len(body),
                    "processed_path": p["image_path"],
                    "processed_sha256": meta["sha256"],
                    "processed_bytes": meta["bytes"],
                    "note": "official featured media; no upscale of source pixels beyond canvas fit",
                }
            )
        except Exception as exc:  # noqa: BLE001
            p["image_match_status"] = "missing"
            p["image_path"] = ""
            image_audit.append(
                {"sku": p["proposed_sku"], "status": "error", "source_url": url, "note": str(exc)}
            )

    # Production dedupe (read-only)
    existing = load_production_products()
    duplicates = []
    for p in products:
        status, hits = classify_duplicate(p, existing)
        p["duplicate_status"] = status
        for ex in hits:
            duplicates.append(
                {
                    "proposed_sku": p["proposed_sku"],
                    "proposed_name": p["proposed_name"],
                    "duplicate_status": status,
                    "existing_sku": ex.get("sku"),
                    "existing_name": ex.get("name"),
                    "existing_brand": ex.get("brand"),
                    "existing_volume": ex.get("volume_text"),
                    "existing_package": ex.get("package_type"),
                }
            )

    # Review buckets
    approved, manual, rejected = [], [], []
    for p in products:
        reasons = []
        notes = list(p.get("conflict_notes") or [])
        if "title_excerpt_flavor_conflict" in notes:
            reasons.append("title_excerpt_flavor_conflict")
            p["duplicate_status"] = "conflict"
        if not p.get("volume_ml"):
            reasons.append("volume_unknown")
        if p.get("volume_confidence") == "low":
            reasons.append("volume_image_unconfirmed")
        if p["category_status"] == "manual":
            reasons.append("category_manual")
        if p["duplicate_status"] in {"sku_collision", "exact_match", "probable_match", "conflict"}:
            reasons.append(p["duplicate_status"])
        if p["image_match_status"] == "missing":
            reasons.append("missing_image")
        if "multi_volume_image_unassigned" in notes:
            reasons.append("multi_volume_image_unassigned")
        if any(n.startswith("category_manual") for n in notes):
            reasons.append("category_manual")

        can_approve = (
            not reasons
            and p.get("volume_ml")
            and p.get("package_code")
            and p.get("flavor")
            and p.get("source_image_url")
            and p["duplicate_status"] == "new_product"
            and p["category_status"] == "mapped"
            and p["image_match_status"] in {"exact", "exact_low_res"}
            and p.get("volume_confidence") in {"high", "medium"}
        )
        # medium only if single-volume page
        if p.get("volume_confidence") == "medium" and "multi" in str(notes):
            can_approve = False

        if can_approve:
            p["review_status"] = "approved"
            p["review_reason"] = ""
            p["confidence"] = "high" if p["image_match_status"] == "exact" else "medium"
            approved.append(p)
        elif p["image_match_status"] == "missing" and not p.get("source_image_url") and not p.get("volume_ml"):
            p["review_status"] = "rejected"
            p["review_reason"] = "; ".join(reasons) or "incomplete"
            p["confidence"] = "low"
            rejected.append(p)
        else:
            p["review_status"] = "manual" if reasons or p.get("volume_ml") else "rejected"
            if p["review_status"] == "rejected":
                rejected.append(p)
            else:
                p["review_reason"] = "; ".join(dict.fromkeys(reasons)) or "needs_manual_review"
                p["confidence"] = "medium"
                manual.append(p)
            if p["review_status"] == "manual":
                p["review_reason"] = "; ".join(dict.fromkeys(reasons)) or "needs_manual_review"

    # Fix rejected path for missing image with volume known → manual not rejected
    # (already handled: missing_image with volume goes to manual via else)

    contact_sheet(products, prev, out / "contact-sheet.jpg", out / "contact-sheet.html")

    def row(p: dict) -> dict:
        return {
            "proposed_sku": p["proposed_sku"],
            "official_name": p.get("official_name") or "",
            "proposed_name": p.get("proposed_name") or "",
            "brand": p.get("brand") or "",
            "manufacturer": p.get("manufacturer") or MANUFACTURER,
            "line": p.get("line") or "",
            "flavor": p.get("flavor") or "",
            "flavor_key": p.get("flavor_key") or "",
            "volume_ml": p.get("volume_ml") or "",
            "volume_text": p.get("volume_text") or "",
            "package_type": p.get("package_type") or "",
            "package_code": p.get("package_code") or "",
            "carbonation": p.get("carbonation") or "",
            "category": p.get("category") or "",
            "category_slug": p.get("category_slug") or "",
            "category_id": p.get("category_id") or "",
            "category_status": p.get("category_status") or "",
            "source_url": p.get("source_url") or "",
            "source_image_url": p.get("source_image_url") or "",
            "image_path": p.get("image_path") or "",
            "image_match_status": p.get("image_match_status") or "",
            "image_width": p.get("image_width") or "",
            "image_height": p.get("image_height") or "",
            "image_mime": p.get("image_mime") or "",
            "source_image_sha256": p.get("source_image_sha256") or "",
            "processed_sha256": p.get("processed_sha256") or "",
            "duplicate_status": p.get("duplicate_status") or "",
            "confidence": p.get("confidence") or "",
            "review_status": p.get("review_status") or "",
            "review_reason": p.get("review_reason") or "",
            "volume_confidence": p.get("volume_confidence") or "",
            "notes": "; ".join(p.get("conflict_notes") or []),
            "wp_slug": p.get("slug") or "",
            "sales_status": "showcase",
            "price_amount": "",
            "orderable": "false",
            "availability": "on_order",
            "units_per_package": 1,
        }

    product_rows = [row(p) for p in products]
    fieldnames = list(product_rows[0].keys()) if product_rows else []
    write_csv(out / "discovered-products.csv", product_rows, fieldnames)
    write_csv(out / "approved-products.csv", [row(p) for p in approved], fieldnames)
    write_csv(out / "manual-review.csv", [row(p) for p in manual], fieldnames)
    write_csv(out / "rejected-products.csv", [row(p) for p in rejected], fieldnames)
    write_csv(out / "image-audit.csv", image_audit)
    write_csv(out / "possible-duplicates.csv", duplicates)
    write_csv(out / "source-evidence.csv", evidence)
    write_csv(
        out / "category-mapping.csv",
        [
            {
                "source_catalog": src,
                "category": CATEGORIES[slug]["name"] if slug in CATEGORIES else "",
                "category_slug": slug or "",
                "category_id": CATEGORIES[slug]["id"] if slug in CATEGORIES else "",
                "rule": rule,
            }
            for src, slug, rule in [
                ("catalog-cok", "sok", "Соки Ириб → sok"),
                ("catalog-nektar", "nektar", "Нектары Ириб → nektar"),
                ("catalog-limonadi-v-pet", "limonady", "Лимонады ПЭТ → limonady (Cola → kola)"),
                ("catalog-limonadi-v-stekle", "limonady", "Mindari стекло → limonady"),
                ("catalog-gold-grand", "limonady", "GOLD GRAND → limonady"),
                ("Bro Lemon / Selesta", "limonady", "brand lines → limonady"),
                ("catalog-chai-holodnyj", "kholodnyy-chay", "Ice Bar → kholodnyy-chay"),
                ("catalog-kvas", "kvas", "Янтарный квас → kvas"),
                ("catalog-mineral-water", "voda-gazirovannaya", "Тарки-Тау → voda-gazirovannaya"),
                ("Талих still", "voda-negazirovannaya", "plain Талих → voda-negazirovannaya"),
                ("Родничок/Чегери", "voda-pitevaya", "drinking water"),
                ("PROFI SPORT ENERGY", "energeticheskie-napitki", "caffeinated energy"),
                ("PROFI SPORT BCAA/Isotonic/L-Carnitine", "", "category_manual — no sports-drink leaf"),
                ("Талих Спорт flavored", "gazirovannye-napitki", "flavored water drinks"),
            ]
        ],
    )

    line_dist = Counter(p["line"] for p in products)
    cat_dist = Counter(p["category"] for p in approved if p.get("category"))
    img_dist = Counter(p.get("image_match_status") for p in products)
    pages_researched = len([e for e in evidence if e.get("http_status")])

    manifest = {
        "stage": "stage1-site-discovered-dry-run",
        "created_at": utc_now(),
        "manufacturer": MANUFACTURER,
        "source_primary": SOURCE,
        "scope": {
            "official_site_only": True,
            "third_party_forbidden": True,
            "production_writes": False,
            "apply_run": False,
        },
        "counts": {
            "pages_researched": pages_researched,
            "wp_products": len(wp_items),
            "discovered": len(products),
            "approved": len(approved),
            "manual": len(manual),
            "rejected": len(rejected),
            "images_exact": img_dist.get("exact", 0),
            "images_exact_low_res": img_dist.get("exact_low_res", 0),
            "images_missing": img_dist.get("missing", 0),
            "production_sku_collisions": sum(1 for p in products if p.get("duplicate_status") == "sku_collision"),
            "exact_matches": sum(1 for p in products if p.get("duplicate_status") == "exact_match"),
            "probable_matches": sum(1 for p in products if p.get("duplicate_status") == "probable_match"),
        },
        "line_distribution": dict(line_dist),
        "category_distribution_approved": dict(cat_dist),
        "approved_skus": [p["proposed_sku"] for p in approved],
        "manual_skus": [p["proposed_sku"] for p in manual],
        "rejected_skus": [p["proposed_sku"] for p in rejected],
        "categories": [
            {"name": c["name"], "slug": c["slug"], "id": c["id"]} for c in CATEGORIES.values()
        ],
        "categories_to_create": [],
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
        json.dumps({"products": products, "pages": pages_meta}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    report = f"""# IRIB (ИРИБ) pre-apply / stage-1 dry-run report

**When:** {manifest['created_at']}  
**Output:** `{out.relative_to(ROOT)}`  
**Source:** {SOURCE} (official only)  
**Manufacturer:** {MANUFACTURER}

## Pages researched
- home, robots.txt, sitemap.xml, o-kompanii, catalog sections, all WP product pages, wp-json/wp/v2/product
- Evidence rows: **{pages_researched}**
- WP products: **{len(wp_items)}**

## Counts
| Bucket | Count |
|--------|------:|
| Discovered SKUs | **{len(products)}** |
| Approved | **{len(approved)}** |
| Manual | **{len(manual)}** |
| Rejected | **{len(rejected)}** |
| Images exact | {img_dist.get('exact', 0)} |
| Images exact_low_res | {img_dist.get('exact_low_res', 0)} |
| Images missing | {img_dist.get('missing', 0)} |
| Production SKU collisions | {manifest['counts']['production_sku_collisions']} |
| Exact matches | {manifest['counts']['exact_matches']} |
| Probable matches | {manifest['counts']['probable_matches']} |

## Lines
{chr(10).join(f"- {k}: **{v}**" for k,v in sorted(line_dist.items()))}

## Approved categories
{chr(10).join(f"- {k}: **{v}**" for k,v in sorted(cat_dist.items())) or '_none_'}

## Review policy highlights
- Each flavor × volume × package is a separate SKU (`IRIB-{{LINE}}-{{FLAVOR}}-{{VOLUME}}-{{PACKAGE}}`).
- Multi-volume WP excerpts expand to multiple SKUs; image assigned only when filename/single-volume confirms the volume.
- Existing production Ириб / ZY-IRIB-* rows are never modified; collisions go to manual (`exact_match` / `probable_match`).
- No new categories created; sports BCAA/Isotonic/L-Carnitine → `category_manual`.

## Manifest
`{(out / 'approved-import-manifest.json').relative_to(ROOT)}`

## Apply readiness
- create-only apply implemented in `scripts/import-irib.ts`
- **production apply NOT run**
- requires `--i-understand-and-have-backup` + `--backup-path` + `--manifest`
- `--merge` forbidden
"""
    (out / "PRE-APPLY-REPORT.md").write_text(report, encoding="utf-8")

    runbook = f"""# VPS Production Runbook — IRIB (draft)

**Do not run until operator explicitly confirms production apply.**

| | |
|--|--|
| Manifest | `{(out / 'approved-import-manifest.json').relative_to(ROOT)}` |
| Approved SKUs | **{len(approved)}** |

```bash
STAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP=/opt/tinda/app/backups/tinda-prod-irib-$STAMP.sql
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP"
sha256sum "$BACKUP" | tee "$BACKUP.sha256"

npm run import:irib:apply -- \\
  --i-understand-and-have-backup \\
  --backup-path="$BACKUP" \\
  --manifest="{(out / 'approved-import-manifest.json').relative_to(ROOT)}"
```

Forbidden: `--merge`, editing existing products, auto-creating categories, importing manual/rejected.
"""
    (out / "VPS-PRODUCTION-RUNBOOK.md").write_text(runbook, encoding="utf-8")

    latest = ART / "latest-stage1"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    latest.symlink_to(out.name)

    (ART / "README.md").write_text(
        f"""# Импорт производителя ИРИБ

Источник: только https://irib.su/  
Производитель: {MANUFACTURER}.

## Stage 1

```bash
npm run import:irib:stage1
# or
python3 scripts/irib-stage1.py
```

Latest: `latest-stage1/` → `{out.name}`

Apply: `npm run import:irib:apply` (gated; not run in stage 1).
""",
        encoding="utf-8",
    )

    print(report)
    print(f"Wrote {out.relative_to(ROOT)}")
    print("APPROVED", len(approved), "MANUAL", len(manual), "REJECTED", len(rejected))


if __name__ == "__main__":
    main()
