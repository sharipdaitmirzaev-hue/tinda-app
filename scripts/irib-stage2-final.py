#!/usr/bin/env python3
"""IRIB stage-2 final review: resolve exact/probable/manual, rebuild create-only manifest.

Official site only. No production writes. Does not run apply.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
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
CANVAS = 1000
MAX_SIDE = 1600
LOW_RES_MAX = 400
PROD_BASE = "https://tindamarket.ru"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"


def fetch(url: str, retries: int = 4) -> tuple[int, bytes]:
    last: Exception | None = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url.split("#")[0], headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.status, res.read()
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.1 * (i + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def fetch_json(url: str) -> dict | list:
    status, body = fetch(url)
    if status >= 400:
        raise RuntimeError(f"HTTP {status} for {url}")
    return json.loads(body.decode())


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


def resolve_stage1() -> Path:
    latest = ART / "latest-stage1"
    if latest.exists():
        return latest.resolve()
    dirs = sorted(ART.glob("*-stage1"))
    if not dirs:
        raise SystemExit("No stage1 artifacts found")
    return dirs[-1]


def volume_from_filename(name: str) -> int | None:
    n = urllib.parse.unquote(name).lower()
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
        (r"(?:^|[^0-9])0[,.]5[-_]?l", 500),
        (r"(?:^|[^0-9])33\b", 330),
        (r"(?:^|[^0-9])0?33", 330),
    ]
    for pat, ml in patterns:
        if re.search(pat, n):
            return ml
    return None


def parse_prod_volume_ml(text: str | None) -> int | None:
    if not text:
        return None
    t = text.lower().replace(" ", "")
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*мл", t)
    if m:
        return int(round(float(m.group(1).replace(",", "."))))
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*л", t)
    if m:
        return int(round(float(m.group(1).replace(",", ".")) * 1000))
    return None


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower().replace("ё", "е").replace("-", " ")).strip()


def product_type_from_row(row: dict) -> str:
    line = (row.get("line") or "").upper()
    if line == "SOK":
        return "sok"
    if line == "NEKTAR":
        return "nektar"
    if line == "TARKI-TAU":
        return "tarki-tau"
    if line == "KVAS":
        return "kvas"
    if "TALIH" in line:
        return "talih"
    name = norm(row.get("proposed_name") or row.get("official_name") or "")
    if "нектар" in name:
        return "nektar"
    if "сок" in name:
        return "sok"
    return line.lower() or "other"


def prod_type_from_existing(ex: dict) -> str:
    name = norm(ex.get("name") or "")
    cat = norm(ex.get("category_name") or "")
    if "тарки" in name:
        return "tarki-tau"
    if "нектар" in name or cat == "нектар":
        return "nektar"
    if "сок" in name or cat == "сок":
        return "sok"
    if "квас" in name or cat == "квас":
        return "kvas"
    return "other"


def flavor_tokens(row: dict) -> set[str]:
    flav = norm(row.get("flavor") or "")
    key = norm((row.get("flavor_key") or "").replace("-", " "))
    tokens = set()
    for part in re.split(r"[^\wа-яa-z]+", flav + " " + key, flags=re.I):
        if len(part) >= 4:
            tokens.add(part)
    # common stems
    mapping = {
        "abrikos": "абрикос",
        "abrikosovyy": "абрикос",
        "persikovyy": "персик",
        "vishnevyy": "вишн",
        "yablochnyy": "яблок",
        "ananasovyy": "ананас",
        "apelsinovyy": "апельсин",
        "granatovyy": "гранат",
        "tomatnyy": "томат",
        "vinogradnyy": "виноград",
        "mangovyy": "манго",
    }
    fk = (row.get("flavor_key") or "").lower()
    if fk in mapping:
        tokens.add(mapping[fk])
    return tokens


def flavor_in_name(tokens: set[str], name: str) -> bool:
    n = norm(name)
    return any(t in n for t in tokens)


def flavor_match_strict(row: dict, name: str) -> bool:
    """Exact flavor match: compound flavors require multiple stems."""
    n = norm(name)
    tokens = flavor_tokens(row)
    if not tokens:
        return False
    fk = norm((row.get("flavor_key") or "").replace("-", " "))
    flavor = norm(row.get("flavor") or "")
    # Direct phrase hits
    if flavor and flavor in n:
        return True
    parts = [p for p in re.split(r"\s+", fk) if len(p) >= 4]
    # Map latin flavor_key stems to russian substrings used on labels
    stem_map = {
        "abrikos": "абрикос",
        "abrikosovyy": "абрикос",
        "persik": "персик",
        "persikovyy": "персик",
        "vishnevyy": "вишн",
        "vishnya": "вишн",
        "yablochnyy": "яблок",
        "yablochno": "яблок",
        "ananas": "ананас",
        "ananasovyy": "ананас",
        "apelsin": "апельсин",
        "apelsinovyy": "апельсин",
        "granat": "гранат",
        "granatovyy": "гранат",
        "tomat": "томат",
        "tomatnyy": "томат",
        "vinograd": "виноград",
        "vinogradnyy": "виноград",
        "mango": "манго",
        "mangovyy": "манго",
        "multifrukt": "мультифрукт",
        "multifruktovyy": "мультифрукт",
    }
    stems = []
    for p in parts:
        stems.append(stem_map.get(p, p))
    stems = list(dict.fromkeys(stems))
    if len(stems) >= 2:
        hits = sum(1 for s in stems if s in n)
        return hits >= 2
    if stems:
        return stems[0] in n
    return flavor_in_name(tokens, name)


def package_compatible(a: str, b: str | None) -> bool:
    x = norm(a)
    y = norm(b or "")
    if not y:
        return False
    glass = lambda s: "стекл" in s or "glass" in s
    pet = lambda s: "пэт" in s or "pet" in s or "пластик" in s
    if glass(x) and glass(y):
        return True
    if pet(x) and pet(y):
        return True
    return x == y and bool(x)


def load_production() -> list[dict]:
    snap = ROOT / "tmp/prod-catalog-irib.json"
    if snap.exists():
        data = json.loads(snap.read_text(encoding="utf-8"))
        items = data.get("items") if isinstance(data, dict) else data
        if isinstance(items, list) and items:
            return items
    items: list[dict] = []
    page = 1
    while page <= 80:
        data = fetch_json(f"{PROD_BASE}/api/v1/catalog/products?page={page}&page_size=20")
        assert isinstance(data, dict)
        batch = data.get("items") or []
        items.extend(batch)
        if not batch or len(items) >= int(data.get("total") or 0):
            break
        page += 1
        time.sleep(0.1)
    return items


def match_production(row: dict, existing: list[dict]) -> tuple[str, dict | None, str]:
    """Return (status, existing_or_none, reason).

    status: exact_match | probable_match | new_product
    """
    sku = (row.get("proposed_sku") or "").upper()
    for ex in existing:
        if (ex.get("sku") or "").upper() == sku:
            return "sku_collision", ex, "same_sku"

    ptype = product_type_from_row(row)
    tokens = flavor_tokens(row)
    vol = int(row["volume_ml"]) if str(row.get("volume_ml") or "").isdigit() and int(row["volume_ml"]) > 0 else 0
    pkg = row.get("package_type") or ""

    exact_hit = None
    probable_hit = None
    probable_reason = ""

    for ex in existing:
        ex_sku = (ex.get("sku") or "").upper()
        brand = norm(ex.get("brand") or "")
        name = ex.get("name") or ""
        name_n = norm(name)
        iribish = (
            "ириб" in brand
            or "ириб" in name_n
            or ex_sku.startswith("ZY-IRIB")
            or ex_sku.startswith("IRIB-")
            or "тарки" in name_n
            or "талих" in name_n
        )
        if not iribish:
            continue

        etype = prod_type_from_existing(ex)
        ex_vol = parse_prod_volume_ml(ex.get("volume_text")) or parse_prod_volume_ml(name)
        same_pkg = package_compatible(pkg, ex.get("package_type"))
        flav_ok = flavor_match_strict(row, name) or (
            ptype == "tarki-tau" and ("тарки" in name_n or "tarki" in name_n)
        )
        same_vol = vol > 0 and ex_vol == vol
        type_ok = (ptype == etype) or (ptype == "tarki-tau" and "тарки" in name_n)

        if flav_ok and same_vol and same_pkg and type_ok:
            exact_hit = ex
            break
        if flav_ok and type_ok and (same_vol or same_pkg):
            # same type+flavor but different volume/package → probable sibling, not auto-duplicate
            if not probable_hit:
                probable_hit = ex
                if same_vol and not same_pkg:
                    probable_reason = "same_flavor_volume_diff_package"
                elif same_pkg and not same_vol:
                    probable_reason = "same_flavor_package_diff_volume"
                else:
                    probable_reason = "same_flavor_type_partial"
        elif flav_ok and not type_ok and same_vol and same_pkg:
            # e.g. nectar vs juice at same volume — conflict, not exact
            if not probable_hit:
                probable_hit = ex
                probable_reason = f"type_mismatch_{ptype}_vs_{etype}"
        elif (not flav_ok) and type_ok and same_vol and same_pkg and flavor_in_name(tokens, name):
            # weak token overlap only — keep as probable, never exact
            if not probable_hit:
                probable_hit = ex
                probable_reason = "weak_flavor_token_overlap"

    if exact_hit:
        return "exact_match", exact_hit, "flavor_volume_package_type_match"
    if probable_hit:
        return "probable_match", probable_hit, probable_reason
    return "new_product", None, "no_production_overlap"


def is_bad_media_name(name: str) -> bool:
    n = name.lower()
    bad = [
        "bubble",
        "logo",
        "banner",
        "bg-",
        "_bg",
        "background",
        "product4_bg",
        "product6_bg",
        "ice-cubes",
        "transparent-cool",
        "favicon",
        "sprite",
    ]
    return any(b in n for b in bad)


def process_image(src: Path, dest: Path) -> dict:
    im = Image.open(src)
    im = im.convert("RGBA") if im.mode in ("P", "RGBA") else im.convert("RGB").convert("RGBA")
    w, h = im.size
    scale = min(1.0, MAX_SIDE / max(w, h))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    # Keep low-res sources without inventing detail; still place on canvas for catalog.
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 255))
    fit = min(1.0, (CANVAS * 0.92) / max(im.size))
    nw, nh = max(1, int(im.width * fit)), max(1, int(im.height * fit))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS) if fit < 1.0 else im
    canvas.paste(resized, ((CANVAS - nw) // 2, (CANVAS - nh) // 2), resized if resized.mode == "RGBA" else None)
    out = canvas.convert("RGB")
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "WEBP", quality=90, method=6)
    data = dest.read_bytes()
    return {
        "width": out.width,
        "height": out.height,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "source_width": w,
        "source_height": h,
        "mime": "image/webp",
    }


def contact_sheet(items: list[dict], preview_dir: Path, out_jpg: Path, out_html: Path, title: str):
    cols = 5
    rows_n = max(1, (len(items) + cols - 1) // cols)
    cell_w, cell_h, label_h = 220, 280, 56
    sheet = Image.new("RGB", (cols * cell_w, rows_n * (cell_h + label_h) + 40), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
        font_h = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
    except Exception:
        font = ImageFont.load_default()
        font_h = font
    draw.text((8, 10), f"{title} ({len(items)} SKUs)", fill=(20, 20, 20), font=font_h)
    html = [f"<html><body><h1>{title}</h1><div style='display:flex;flex-wrap:wrap;gap:8px'>"]
    for i, p in enumerate(items):
        r, c = divmod(i, cols)
        x, y = c * cell_w, 40 + r * (cell_h + label_h)
        prev = preview_dir / f"{p['proposed_sku']}.jpg"
        if prev.exists():
            im = Image.open(prev).convert("RGB")
            im.thumbnail((cell_w - 20, cell_h - 20))
            sheet.paste(im, (x + (cell_w - im.width) // 2, y + 8))
        label = p["proposed_sku"].replace("IRIB-", "")[:34]
        draw.text((x + 4, y + cell_h - 4), label, fill=(0, 0, 0), font=font)
        html.append(
            f"<div style='width:200px'><img src='previews/{p['proposed_sku']}.jpg' width='180'/>"
            f"<div style='font:11px monospace'>{p['proposed_sku']}</div>"
            f"<div>{p.get('final_status') or p.get('review_status')}</div></div>"
        )
    html.append("</div></body></html>")
    sheet.save(out_jpg, "JPEG", quality=85)
    out_html.write_text("\n".join(html), encoding="utf-8")


def manual_reason_group(row: dict) -> str:
    reasons = (row.get("review_reason") or "") + ";" + (row.get("notes") or "") + ";" + (row.get("final_reason") or "")
    r = reasons.lower()
    if "title_excerpt_flavor_conflict" in r or "conflict" in r.split(";"):
        return "конфликт с production / данные карточки"
    if "exact_match" in r or "confirmed_duplicate" in r:
        return "конфликт с production"
    if "probable_match" in r or "type_mismatch" in r:
        return "конфликт с production"
    if "category_manual" in r:
        return "неясная категория"
    if "volume_unknown" in r or "unknown" in (row.get("proposed_sku") or "").lower():
        return "нет объёма"
    if "multi_volume" in r or "volume_image_unconfirmed" in r:
        return "несколько вариантов фасовки"
    if "missing_image" in r:
        return "нет изображения"
    if not row.get("package_code"):
        return "нет тары"
    if "unclassified" in r or "неясн" in r:
        return "неясная линейка"
    return "HTML/WP карточка без полного набора данных"


def main():
    stage1 = resolve_stage1()
    out = ART / f"{stamp()}-final"
    src_dir = out / "source-downloads"
    proc = out / "processed"
    prev = out / "previews"
    for d in (out, src_dir, proc, prev):
        d.mkdir(parents=True, exist_ok=True)

    discovered = list(csv.DictReader((stage1 / "discovered-products.csv").open(encoding="utf-8")))
    wp_products = json.loads((stage1 / "wp-products.json").read_text(encoding="utf-8"))
    wp_by_slug = {p["slug"]: p for p in wp_products}
    evidence_src = list(csv.DictReader((stage1 / "source-evidence.csv").open(encoding="utf-8")))
    cat_map_src = list(csv.DictReader((stage1 / "category-mapping.csv").open(encoding="utf-8")))

    print(f"Stage1: {stage1.name} products={len(discovered)}")
    production = load_production()
    print(f"Production catalog (read-only): {len(production)}")

    # ---- Attachment index from WP ----
    attachments_by_slug: dict[str, list[dict]] = {}
    for slug, wp in wp_by_slug.items():
        pid = wp.get("id")
        try:
            atts = fetch_json(f"https://irib.su/wp-json/wp/v2/media?parent={pid}&per_page=40")
            assert isinstance(atts, list)
            attachments_by_slug[slug] = atts
            time.sleep(0.12)
        except Exception as exc:  # noqa: BLE001
            print(f"WARN attachments {slug}: {exc}")
            attachments_by_slug[slug] = []

    (out / "wp-attachments-index.json").write_text(
        json.dumps(
            {
                slug: [
                    {
                        "id": a.get("id"),
                        "source_url": a.get("source_url"),
                        "alt_text": a.get("alt_text"),
                        "caption": BeautifulSoup(
                            (a.get("caption") or {}).get("rendered") or "", "lxml"
                        ).get_text(" ", strip=True),
                        "mime": a.get("mime_type"),
                        "media_details": {
                            "width": (a.get("media_details") or {}).get("width"),
                            "height": (a.get("media_details") or {}).get("height"),
                        },
                    }
                    for a in atts
                ]
                for slug, atts in attachments_by_slug.items()
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    def flavor_filename_score(fname: str, row: dict) -> int:
        """Prefer attachments whose filename matches this SKU flavor; reject clear mismatches."""
        n = urllib.parse.unquote(fname).lower()
        fk = (row.get("flavor_key") or "").lower()
        flavor = norm(row.get("flavor") or "")
        score = 0
        # Positive signals
        positives = [
            fk.replace("-", ""),
            fk.replace("-", "_"),
            *fk.split("-"),
            *re.findall(r"[a-zа-я]{4,}", flavor),
        ]
        # Common filename stems
        stem_aliases = {
            "abrikosovyy": ["abrik", "abrikos", "abrio", "abrioso"],
            "yablochnyy": ["yabl", "yabloch"],
            "yablochno": ["yabl", "abrik", "yablochno"],
            "persikovyy": ["persik"],
            "vishnevyy": ["vishn"],
            "ananasovyy": ["ananas"],
            "apelsinovyy": ["apelsin", "orange"],
            "granatovyy": ["granat"],
            "tomatnyy": ["tomat"],
            "vinogradnyy": ["vinograd"],
            "mangovyy": ["mango"],
            "multifruktovyy": ["multi", "multifrukt"],
            "mango-klubnika": ["mango", "klubnik"],
            "yagodnyy": ["yagod", "lesnye"],
            "persik": ["persik"],
        }
        for key, aliases in stem_aliases.items():
            if key in fk or key in flavor:
                positives.extend(aliases)
        compact = n.replace("-", "").replace("_", "")
        for token in positives:
            if token and len(token) >= 4 and token in compact:
                score += 2
            elif token and len(token) >= 4 and token in n:
                score += 2

        # Penalize compound filenames when proposed flavor is single-fruit
        compound_markers = ["yablochno", "yablabrik", "abrikyabl", "mango-klub", "lesnye"]
        is_compound_flavor = ("yablochno" in fk) or ("-" in fk and len(fk.split("-")) >= 2 and "nektar" not in fk)
        # single apricot should not take apple-apricot asset
        if "abrikos" in fk and "yablochno" not in fk:
            if "yabl" in compact and "abrik" in compact:
                return -100
            if "yablochn" in n and "abrik" in n:
                return -100
        if "yablochnyy" in fk and "abrikos" not in fk and "abrik" in compact:
            return -100

        # Hard reject wrong-flavor assets attached to the same WP parent
        foreign = {
            "mango": ["манго", "mango", "mangovyy"],
            "tarki": ["tarki", "тарки"],
            "mineral": ["mineral"],
        }
        own = " ".join(positives)
        for key, markers in foreign.items():
            if key in own:
                continue
            if any(m in n for m in markers) and score == 0:
                return -100
            if any(m in n for m in markers) and not any(m in own for m in markers):
                if key == "mango" and "mango" not in fk and "манго" not in flavor:
                    return -100
                if key == "tarki":
                    return -100
        if any(m in n for m in compound_markers) and not is_compound_flavor and score < 4:
            score -= 3
        return score

    def pick_attachment_for_volume(slug: str, volume_ml: int, row: dict) -> dict | None:
        candidates = []
        for a in attachments_by_slug.get(slug) or []:
            url = a.get("source_url") or ""
            fname = url.rsplit("/", 1)[-1]
            if not url or is_bad_media_name(fname):
                continue
            v = volume_from_filename(fname)
            if v != volume_ml:
                continue
            flav_score = flavor_filename_score(fname, row)
            if flav_score < 0:
                continue
            w = (a.get("media_details") or {}).get("width") or 0
            h = (a.get("media_details") or {}).get("height") or 0
            candidates.append((flav_score, w * h, url, a))
        if not candidates:
            return None
        # Require at least some flavor signal when multiple volume matches exist
        candidates.sort(reverse=True)
        best = candidates[0]
        volume_matches = [c for c in candidates if c[0] >= 0]
        flavored = [c for c in volume_matches if c[0] > 0]
        chosen = (flavored or volume_matches)[0]
        # If nothing flavor-positive and there are foreign-looking names only — skip
        if chosen[0] == 0 and len(volume_matches) > 1:
            # ambiguous unlabeled volume assets on a multi-flavor gallery
            return None
        return {"source_url": chosen[2], "attachment": chosen[3]}

    # ---- Reclassify each row ----
    exact_table = []
    probable_table = []
    products = []
    image_audit = []
    image_updates = []

    for row in discovered:
        p = dict(row)
        slug = p.get("wp_slug") or ""
        try:
            vol = int(float(p.get("volume_ml") or 0))
        except ValueError:
            vol = 0
        p["volume_ml"] = vol

        # Improve image from attachments when missing / better volume match
        picked = pick_attachment_for_volume(slug, vol, p) if vol else None
        if picked:
            p["source_image_url"] = picked["source_url"]
            p["image_source"] = "wp_attachment_volume_filename"
            p["notes"] = ((p.get("notes") or "") + "; image_from_attachment_filename").strip("; ")
        elif p.get("source_image_url"):
            p["image_source"] = "stage1_featured_or_assigned"
        else:
            p["image_source"] = "missing"

        status, ex, reason = match_production(p, production)
        p["duplicate_status"] = status
        p["match_reason"] = reason
        if ex:
            p["existing_product_id"] = ex.get("id") or ""
            p["existing_sku"] = ex.get("sku") or ""
            p["existing_name"] = ex.get("name") or ""
            p["existing_brand"] = ex.get("brand") or ""
            p["existing_volume"] = ex.get("volume_text") or ""
            p["existing_package"] = ex.get("package_type") or ""
            p["existing_category"] = ex.get("category_name") or ""
            p["existing_image_url"] = ex.get("image_url") or ""
        else:
            for k in [
                "existing_product_id",
                "existing_sku",
                "existing_name",
                "existing_brand",
                "existing_volume",
                "existing_package",
                "existing_category",
                "existing_image_url",
            ]:
                p[k] = ""

        # Download / process image if we have URL
        url = p.get("source_image_url") or ""
        if url:
            fname = urllib.parse.unquote(url.rsplit("/", 1)[-1])
            local = src_dir / f"{p['proposed_sku']}__{fname}"
            try:
                # reuse stage1 download if present
                stage1_candidates = list((stage1 / "source-downloads").glob(f"{p['proposed_sku']}__*")) if (stage1 / "source-downloads").exists() else []
                if stage1_candidates and not picked:
                    shutil.copy2(stage1_candidates[0], local)
                    body = local.read_bytes()
                else:
                    _, body = fetch(url)
                    local.write_bytes(body)
                sha = hashlib.sha256(body).hexdigest()
                im = Image.open(local)
                w, h = im.size
                mime = Image.MIME.get(im.format or "", "application/octet-stream")
                low = max(w, h) <= LOW_RES_MAX
                # shared? only if filename suggests line collage — we never auto-mark shared here
                p["image_match_status"] = "exact_low_res" if low else "exact"
                p["image_width"] = w
                p["image_height"] = h
                p["image_mime"] = mime
                p["source_image_sha256"] = sha
                meta = process_image(local, proc / f"{p['proposed_sku']}.webp")
                p["image_path"] = str((proc / f"{p['proposed_sku']}.webp").relative_to(ROOT))
                p["processed_sha256"] = meta["sha256"]
                im2 = Image.open(proc / f"{p['proposed_sku']}.webp").convert("RGB")
                im2.thumbnail((360, 360))
                im2.save(prev / f"{p['proposed_sku']}.jpg", "JPEG", quality=85)
                image_audit.append(
                    {
                        "sku": p["proposed_sku"],
                        "status": p["image_match_status"],
                        "source_url": url,
                        "image_source": p["image_source"],
                        "source_width": w,
                        "source_height": h,
                        "source_mime": mime,
                        "source_sha256": sha,
                        "processed_path": p["image_path"],
                        "processed_sha256": meta["sha256"],
                        "note": "no source upscale; catalog canvas only",
                    }
                )
            except Exception as exc:  # noqa: BLE001
                p["image_match_status"] = "missing"
                p["source_image_url"] = url
                image_audit.append(
                    {
                        "sku": p["proposed_sku"],
                        "status": "error",
                        "source_url": url,
                        "note": str(exc),
                    }
                )
        else:
            p["image_match_status"] = "missing"
            image_audit.append(
                {
                    "sku": p["proposed_sku"],
                    "status": "missing",
                    "source_url": "",
                    "image_source": "missing",
                    "note": "no volume-matched official attachment/featured image",
                }
            )

        # Final bucket decision
        final_status = "manual"
        final_reason = []
        decision = "keep_manual"

        if p.get("duplicate_status") == "sku_collision":
            final_status = "rejected"
            final_reason.append("sku_collision")
            decision = "confirmed_duplicate"
        elif p.get("duplicate_status") == "exact_match":
            final_status = "rejected"  # not in create manifest; tracked as confirmed duplicate
            final_reason.append("confirmed_duplicate")
            decision = "confirmed_duplicate"
            # image-update candidate if we have official image larger than prod (heuristic)
            if p.get("source_image_url") and p.get("image_match_status") in {"exact", "exact_low_res"}:
                prod_img = p.get("existing_image_url") or ""
                update_note = "exact_duplicate_official_image_available_for_manual_image_update"
                # Prefer update only when official source is not tiny relative to typical prod webp
                # Still separate — never auto-apply.
                sw = int(p.get("image_width") or 0)
                sh = int(p.get("image_height") or 0)
                if max(sw, sh) >= 300:  # only suggest when not extremely tiny
                    image_updates.append(
                        {
                            "proposed_sku": p["proposed_sku"],
                            "existing_product_id": p.get("existing_product_id"),
                            "existing_sku": p.get("existing_sku"),
                            "existing_name": p.get("existing_name"),
                            "existing_image_url": prod_img,
                            "official_source_image_url": p.get("source_image_url"),
                            "official_width": sw,
                            "official_height": sh,
                            "official_image_status": p.get("image_match_status"),
                            "processed_path": p.get("image_path") or "",
                            "action": "image_update_candidate",
                            "apply_now": False,
                            "note": update_note,
                        }
                    )
                else:
                    final_reason.append("official_image_too_low_res_for_update_suggestion")
        elif "title_excerpt_flavor_conflict" in (p.get("notes") or "") or p.get("duplicate_status") == "conflict":
            final_status = "manual"
            final_reason.append("conflict")
            decision = "conflict"
        elif p.get("duplicate_status") == "probable_match":
            if "type_mismatch" in (p.get("match_reason") or ""):
                # juice vs nectar etc. — if volume image confirmed and mapped, can be new
                decision = "keep_manual"
                final_reason.append(p["match_reason"])
                if (
                    vol > 0
                    and p.get("package_code")
                    and p.get("category_status") == "mapped"
                    and p.get("image_match_status") in {"exact", "exact_low_res"}
                    and p.get("image_source") == "wp_attachment_volume_filename"
                ):
                    decision = "new_product"
                    final_status = "approved"
                    final_reason = ["type_differs_from_production_sibling_confirmed_new"]
                else:
                    final_status = "manual"
            elif "diff_volume" in (p.get("match_reason") or "") or "diff_package" in (p.get("match_reason") or ""):
                # Different volume/package from known flavor → potential new SKU
                if (
                    vol > 0
                    and p.get("package_code")
                    and p.get("category_status") == "mapped"
                    and p.get("image_match_status") in {"exact", "exact_low_res"}
                    and (
                        p.get("image_source") == "wp_attachment_volume_filename"
                        or (p.get("volume_confidence") == "high" and p.get("image_match_status") != "missing")
                    )
                ):
                    decision = "new_product"
                    final_status = "approved"
                    final_reason = ["different_volume_or_package_from_production_confirmed"]
                else:
                    decision = "keep_manual"
                    final_status = "manual"
                    final_reason.append(p.get("match_reason") or "probable_needs_confirmation")
            else:
                decision = "keep_manual"
                final_status = "manual"
                final_reason.append(p.get("match_reason") or "probable_match")
        else:
            # new_product path
            decision = "new_product"
            blockers = []
            if not vol:
                blockers.append("volume_unknown")
            if not p.get("package_code"):
                blockers.append("package_unknown")
            if p.get("category_status") != "mapped":
                blockers.append("category_manual")
            if p.get("image_match_status") == "missing":
                blockers.append("missing_image")
            if "multi_volume_image_unassigned" in (p.get("notes") or "") and p.get("image_source") != "wp_attachment_volume_filename":
                blockers.append("multi_volume_unconfirmed")
            if "volume_image_unconfirmed" in (p.get("review_reason") or "") and p.get("image_source") != "wp_attachment_volume_filename":
                # stage1 flag; cleared if attachment matched
                if p.get("image_source") != "wp_attachment_volume_filename":
                    blockers.append("volume_image_unconfirmed")
            if blockers:
                final_status = "manual"
                final_reason.extend(blockers)
                decision = "keep_manual"
            else:
                final_status = "approved"
                final_reason = []

        # Never put confirmed duplicates into approved
        if decision == "confirmed_duplicate":
            final_status = "rejected"

        p["final_status"] = final_status
        p["final_decision"] = decision
        p["final_reason"] = "; ".join(dict.fromkeys(final_reason))
        p["review_status"] = "approved" if final_status == "approved" else ("rejected" if final_status == "rejected" else "manual")
        p["review_reason"] = p["final_reason"]
        products.append(p)

        if p["duplicate_status"] == "exact_match" or decision == "confirmed_duplicate":
            exact_table.append(
                {
                    "proposed_sku": p["proposed_sku"],
                    "production_product_id": p.get("existing_product_id"),
                    "production_sku": p.get("existing_sku"),
                    "production_name": p.get("existing_name"),
                    "production_brand": p.get("existing_brand"),
                    "proposed_flavor": p.get("flavor"),
                    "proposed_volume": p.get("volume_text"),
                    "proposed_package": p.get("package_type"),
                    "proposed_category": p.get("category"),
                    "production_volume": p.get("existing_volume"),
                    "production_package": p.get("existing_package"),
                    "production_category": p.get("existing_category"),
                    "exact_match_reason": p.get("match_reason"),
                    "decision": "confirmed_duplicate_exclude_from_create",
                    "image_update_candidate": "yes"
                    if any(u["proposed_sku"] == p["proposed_sku"] for u in image_updates)
                    else "no",
                    "source_url": p.get("source_url"),
                    "official_image_url": p.get("source_image_url") or "",
                }
            )

        if row.get("duplicate_status") == "probable_match" or p.get("duplicate_status") == "probable_match" or (
            p.get("match_reason") or ""
        ).startswith("type_mismatch") or (
            p.get("match_reason") or ""
        ).startswith("same_flavor"):
            probable_table.append(
                {
                    "proposed_sku": p["proposed_sku"],
                    "brand": p.get("brand"),
                    "line": p.get("line"),
                    "flavor": p.get("flavor"),
                    "volume_ml": p.get("volume_ml"),
                    "volume_text": p.get("volume_text"),
                    "package_type": p.get("package_type"),
                    "carbonation": p.get("carbonation") or "",
                    "sugar_free": "",
                    "category": p.get("category"),
                    "category_status": p.get("category_status"),
                    "image_match_status": p.get("image_match_status"),
                    "image_source": p.get("image_source"),
                    "source_url": p.get("source_url"),
                    "source_image_url": p.get("source_image_url") or "",
                    "existing_sku": p.get("existing_sku"),
                    "existing_name": p.get("existing_name"),
                    "match_reason": p.get("match_reason"),
                    "decision": decision
                    if decision in {"confirmed_duplicate", "new_product", "conflict", "keep_manual"}
                    else "keep_manual",
                    "final_status": final_status,
                    "final_reason": p.get("final_reason"),
                }
            )

    # Deduplicate exact_table by proposed_sku
    exact_by = {r["proposed_sku"]: r for r in exact_table}
    exact_table = sorted(exact_by.values(), key=lambda r: r["proposed_sku"])
    # Deduplicate probable
    prob_by = {r["proposed_sku"]: r for r in probable_table}
    probable_table = sorted(prob_by.values(), key=lambda r: r["proposed_sku"])

    approved = [p for p in products if p["final_status"] == "approved"]
    manual = [p for p in products if p["final_status"] == "manual"]
    rejected = [p for p in products if p["final_status"] == "rejected"]
    confirmed_dups = [p for p in products if p.get("final_decision") == "confirmed_duplicate"]

    # Manual groups
    manual_groups = Counter(manual_reason_group(p) for p in manual)

    def row_out(p: dict) -> dict:
        return {
            "proposed_sku": p.get("proposed_sku") or "",
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
            "image_source": p.get("image_source") or "",
            "image_width": p.get("image_width") or "",
            "image_height": p.get("image_height") or "",
            "image_mime": p.get("image_mime") or "",
            "source_image_sha256": p.get("source_image_sha256") or "",
            "processed_sha256": p.get("processed_sha256") or "",
            "duplicate_status": p.get("duplicate_status") or "",
            "match_reason": p.get("match_reason") or "",
            "existing_product_id": p.get("existing_product_id") or "",
            "existing_sku": p.get("existing_sku") or "",
            "existing_name": p.get("existing_name") or "",
            "final_decision": p.get("final_decision") or "",
            "final_status": p.get("final_status") or "",
            "final_reason": p.get("final_reason") or "",
            "review_status": p.get("review_status") or "",
            "review_reason": p.get("review_reason") or "",
            "confidence": "high"
            if p.get("final_status") == "approved" and p.get("image_match_status") == "exact"
            else ("medium" if p.get("final_status") == "approved" else "low"),
            "notes": p.get("notes") or "",
            "wp_slug": p.get("wp_slug") or "",
            "sales_status": "showcase",
            "price_amount": "",
            "orderable": "false",
            "availability": "on_order",
            "units_per_package": 1,
        }

    fields = list(row_out(products[0]).keys()) if products else []
    write_csv(out / "approved-new-products.csv", [row_out(p) for p in approved], fields)
    write_csv(
        out / "confirmed-duplicates.csv",
        [
            {
                **{k: r[k] for k in r},
            }
            for r in exact_table
        ],
    )
    write_csv(out / "probable-review-final.csv", probable_table)
    write_csv(out / "manual-review-final.csv", [row_out(p) for p in manual], fields)
    write_csv(out / "rejected-products-final.csv", [row_out(p) for p in rejected], fields)
    write_csv(out / "image-audit-final.csv", image_audit)
    write_csv(
        out / "category-mapping-final.csv",
        cat_map_src
        or [
            {
                "note": "see stage1 category-mapping; no new categories created",
            }
        ],
    )
    write_csv(
        out / "source-evidence-final.csv",
        evidence_src
        + [
            {
                "page": "stage2-wp-attachments",
                "url": "https://irib.su/wp-json/wp/v2/media?parent={product_id}",
                "http_status": 200,
                "bytes": "",
                "count": sum(len(v) for v in attachments_by_slug.values()),
            }
        ],
    )
    write_csv(
        out / "manual-reason-groups.csv",
        [{"reason_group": k, "count": v} for k, v in sorted(manual_groups.items(), key=lambda x: (-x[1], x[0]))],
    )

    # Copy processed images for approved from stage1 when still valid
    for p in approved:
        dest = proc / f"{p['proposed_sku']}.webp"
        if not dest.exists():
            src = stage1 / "processed" / f"{p['proposed_sku']}.webp"
            if src.exists():
                shutil.copy2(src, dest)
                p["image_path"] = str(dest.relative_to(ROOT))

    contact_sheet(
        approved,
        prev,
        out / "contact-sheet-final.jpg",
        out / "contact-sheet-final.html",
        "IRIB final approved-new",
    )

    img_dist = Counter(p.get("image_match_status") for p in products)
    cat_dist = Counter(p.get("category") for p in approved if p.get("category"))
    probable_decisions = Counter(r.get("decision") for r in probable_table)

    manifest = {
        "stage": "stage2-final-create-only-manifest",
        "created_at": utc_now(),
        "manufacturer": MANUFACTURER,
        "source_primary": SOURCE,
        "stage1_artifacts": str(stage1.relative_to(ROOT)),
        "scope": {
            "official_site_only": True,
            "third_party_forbidden": True,
            "production_writes": False,
            "apply_run": False,
            "image_updates_apply_run": False,
            "create_only": True,
            "modify_existing_products": False,
        },
        "counts": {
            "discovered": len(products),
            "approved_new": len(approved),
            "confirmed_duplicates": len(confirmed_dups),
            "manual": len(manual),
            "rejected": len(rejected),
            "probable_rows": len(probable_table),
            "probable_decision_counts": dict(probable_decisions),
            "images_exact": img_dist.get("exact", 0),
            "images_exact_low_res": img_dist.get("exact_low_res", 0),
            "images_shared": img_dist.get("shared", 0),
            "images_missing": img_dist.get("missing", 0),
            "image_update_candidates": len(image_updates),
            "production_sku_collisions": sum(1 for p in products if p.get("duplicate_status") == "sku_collision"),
            "exact_matches_final": len(exact_table),
        },
        "manual_reason_groups": dict(manual_groups),
        "category_distribution_approved_new": dict(cat_dist),
        "approved_skus": [p["proposed_sku"] for p in approved],
        "manual_skus": [p["proposed_sku"] for p in manual],
        "rejected_skus": [p["proposed_sku"] for p in rejected],
        "confirmed_duplicate_skus": [p["proposed_sku"] for p in confirmed_dups],
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
            "image_update_mixed_into_create": False,
        },
    }
    (out / "approved-import-manifest-final.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out / "image-update-manifest-separate.json").write_text(
        json.dumps(
            {
                "stage": "image-update-candidates-not-applied",
                "created_at": utc_now(),
                "apply_run": False,
                "note": "Separate from create import. Do not mix with approved-import-manifest-final.json apply.",
                "candidates": image_updates,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (out / "discovered-final.json").write_text(
        json.dumps({"products": products}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # ZY-IRIB / Tarki special sections for report
    zy = [p for p in production if (p.get("sku") or "").upper().startswith("ZY-IRIB")]
    tarki_rows = [p for p in products if p.get("line") == "TARKI-TAU" or "тарки" in norm(p.get("flavor") or "")]

    report = f"""# IRIB final pre-apply report

**When:** {manifest['created_at']}  
**Output:** `{out.relative_to(ROOT)}`  
**Stage1:** `{stage1.relative_to(ROOT)}`  
**Source:** {SOURCE} only  
**Manufacturer:** {MANUFACTURER}

## Production exact matches (confirmed duplicates)

Count: **{len(exact_table)}** — excluded from create manifest.

See `confirmed-duplicates.csv`.

## Probable matches (final decisions)

Rows: **{len(probable_table)}**  
Decisions: {dict(probable_decisions)}

See `probable-review-final.csv`.

## Manual groups

| Reason group | Count |
|--------------|------:|
{chr(10).join(f"| {k} | {v} |" for k,v in sorted(manual_groups.items(), key=lambda x: (-x[1], x[0])))}

## Final buckets

| Bucket | Count |
|--------|------:|
| Approved NEW (create manifest) | **{len(approved)}** |
| Confirmed duplicates | **{len(confirmed_dups)}** |
| Manual | **{len(manual)}** |
| Rejected | **{len(rejected)}** |
| Images exact | {img_dist.get('exact', 0)} |
| Images exact_low_res | {img_dist.get('exact_low_res', 0)} |
| Images shared | {img_dist.get('shared', 0)} |
| Images missing | {img_dist.get('missing', 0)} |
| Image-update candidates (separate) | **{len(image_updates)}** |

## Approved-new categories

{chr(10).join(f"- {k}: **{v}**" for k,v in sorted(cat_dist.items())) or '_none_'}

## ZY-IRIB juices/nectars

Production ZY-IRIB SKUs present: **{len(zy)}**.  
Same flavor+volume+glass+type → confirmed duplicate (no create).  
Different volume with attachment-confirmed official photo → eligible as new SKU only when image/category complete.

## Тарки-Тау

Rows: {len(tarki_rows)}  
{chr(10).join(f"- `{p['proposed_sku']}` → {p.get('final_decision')} / {p.get('final_status')} ({p.get('final_reason')})" for p in tarki_rows) or '_none_'}

## Manifests

- Create-only: `{(out / 'approved-import-manifest-final.json').relative_to(ROOT)}`
- Image-update (NOT applied, NOT mixed): `{(out / 'image-update-manifest-separate.json').relative_to(ROOT)}`

## Apply readiness

- create-only, backup + confirmation required, `--merge` forbidden
- existing products never edited by create apply
- **production apply NOT run**
- **image-update NOT run**
"""
    (out / "PRE-APPLY-REPORT.md").write_text(report, encoding="utf-8")

    runbook = f"""# VPS Production Runbook — IRIB final (create-only)

**Do not run until operator explicitly confirms production apply.**

| | |
|--|--|
| Create manifest | `{(out / 'approved-import-manifest-final.json').relative_to(ROOT)}` |
| Approved NEW SKUs | **{len(approved)}** |
| Image-update manifest | `{(out / 'image-update-manifest-separate.json').relative_to(ROOT)}` (**do not apply with create**) |

```bash
STAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP=/opt/tinda/app/backups/tinda-prod-irib-$STAMP.sql
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP"
sha256sum "$BACKUP" | tee "$BACKUP.sha256"

npm run import:irib:apply -- \\
  --i-understand-and-have-backup \\
  --backup-path="$BACKUP" \\
  --manifest="{(out / 'approved-import-manifest-final.json').relative_to(ROOT)}"
```

Forbidden: `--merge`, editing existing products, applying image-update manifest via create apply, importing manual/duplicate/conflict rows.
"""
    (out / "VPS-PRODUCTION-RUNBOOK.md").write_text(runbook, encoding="utf-8")

    latest = ART / "latest-final"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    latest.symlink_to(out.name)

    readme = ART / "README.md"
    readme.write_text(
        f"""# Импорт производителя ИРИБ

Источник: только https://irib.su/  
Производитель: {MANUFACTURER}.

## Stage 1

```bash
npm run import:irib:stage1
```

## Stage 2 final

```bash
python3 scripts/irib-stage2-final.py
```

Latest stage1: `latest-stage1/`  
Latest final: `latest-final/` → `{out.name}`

Apply (gated, create-only): `npm run import:irib:apply` — not run in this stage.
""",
        encoding="utf-8",
    )

    print(report)
    print(f"Wrote {out.relative_to(ROOT)}")
    print(
        "APPROVED_NEW",
        len(approved),
        "DUP",
        len(confirmed_dups),
        "MANUAL",
        len(manual),
        "REJECTED",
        len(rejected),
        "IMG_UPDATES",
        len(image_updates),
    )


if __name__ == "__main__":
    main()
