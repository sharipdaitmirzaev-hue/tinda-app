#!/usr/bin/env python3
"""AquAlania stage-2 final review: resolve disputed items, rebuild production-ready manifest.

No production writes. Does not run apply.
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "artifacts/aqualania-import"
UA = "TINDA-AquAlania-Import/1.0"
MANUFACTURER = "ООО «Константа-7»"
BRAND = "AquAlania"
SOURCE_RU = "https://aqualania.ru/product"
SOURCE_EN = "https://aqualania.ru/enproduct"
CANVAS = 1000
MAX_SIDE = 1600


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"


def fetch(url: str, timeout: int = 90) -> tuple[int, bytes]:
    req = urllib.request.Request(url.split("#")[0], headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status, res.read()


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


def resolve_stage1() -> Path:
    latest = ART / "latest-stage1"
    if latest.exists():
        return latest.resolve()
    dirs = sorted(ART.glob("*-stage1"))
    if not dirs:
        raise SystemExit("No stage1 artifacts found")
    return dirs[-1]


def process_image(src: Path, dest: Path, *, allow_upscale_canvas: bool = True) -> dict:
    """Process official asset to WebP. Never enlarge small originals (Light)."""
    im = Image.open(src)
    im = im.convert("RGBA") if im.mode in ("P", "RGBA") else im.convert("RGB").convert("RGBA")
    w, h = im.size
    # Downscale only; never enlarge source pixels.
    scale = min(1.0, MAX_SIDE / max(w, h))
    if scale < 1.0:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    low_res = max(w, h) < 400
    if low_res or not allow_upscale_canvas:
        out = im.convert("RGB")
    else:
        canvas = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 255))
        fit = (CANVAS * 0.92) / max(im.size)
        # fit <= 1.0 only (no enlarge)
        fit = min(fit, 1.0)
        nw, nh = max(1, int(im.width * fit)), max(1, int(im.height * fit))
        resized = im.resize((nw, nh), Image.Resampling.LANCZOS) if fit < 1.0 else im
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
    snapshot = ROOT / "tmp/aqualania-prod/products-snapshot.json"
    if snapshot.exists():
        items = json.loads(snapshot.read_text(encoding="utf-8"))
        if isinstance(items, list) and len(items) >= 500:
            print(f"Loaded production snapshot: {len(items)}")
            return items

    # Prefer curl pagination (more reliable than urllib on this host)
    pages_dir = ROOT / "tmp/aqualania-prod/pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    items: list[dict] = []
    page = 1
    while page <= 20:
        dest = pages_dir / f"p{page}.json"
        ok = False
        data = None
        for attempt in range(5):
            if dest.exists() and dest.stat().st_size > 200:
                try:
                    data = json.loads(dest.read_text(encoding="utf-8"))
                    if data.get("items"):
                        ok = True
                        break
                except Exception:
                    pass
            cmd = [
                "curl",
                "-sS",
                "-m",
                "180",
                "-H",
                "Accept: application/json",
                "-H",
                f"User-Agent: {UA}",
                "-o",
                str(dest),
                "-w",
                "%{http_code}",
                f"https://tindamarket.ru/api/v1/catalog/products?page={page}&page_size=20",
            ]
            try:
                code = subprocess.check_output(cmd, text=True).strip()
                if code == "200" and dest.stat().st_size > 100:
                    data = json.loads(dest.read_text(encoding="utf-8"))
                    ok = True
                    break
            except Exception as exc:  # noqa: BLE001
                print(f"prod page {page} attempt {attempt}: {exc}")
            time.sleep(2 * (attempt + 1))
        if not ok or not data:
            print(f"WARN: stopped production dump at page={page}")
            break
        batch = data.get("items") or []
        items.extend(batch)
        print(f"production page {page}: +{len(batch)} so_far={len(items)} total={data.get('total')}")
        if data.get("total") is not None and len(items) >= int(data["total"]):
            break
        if len(batch) < 20:
            break
        page += 1
        time.sleep(0.25)

    if items:
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        snapshot.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    print(f"Loaded production products (read-only): {len(items)}")
    return items


def proposed_name_final(p: dict) -> str:
    flavor = p["flavor"]
    vol = p["volume_text"]
    pkg = p["package_type"]
    if p["line"] == "WATER":
        return f"AquAlania вода минеральная {flavor.lower()}, {vol}, {pkg}"
    if p["line"] == "LIGHT":
        return f"AquAlania Light {flavor} без сахара, {vol}, {pkg}"
    if p["line"] == "CAN":
        if flavor == "Игристое":
            return f"Напиток газированный AquAlania Игристое, {vol}, банка"
        return f"AquAlania {flavor}, {vol}, {pkg}"
    # PREMIUM
    if flavor == "Игристое":
        return f"Напиток газированный AquAlania Игристое, {vol}, стекло"
    return f"AquAlania {flavor}, {vol}, {pkg}"


def contact_sheet_final(items: list[dict], preview_dir: Path, out_html: Path, out_jpg: Path):
    cols = 5
    rows = (len(items) + cols - 1) // cols
    cell_w, cell_h, label_h = 240, 300, 70
    sheet = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h) + 48), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 10)
        font_h = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 13)
    except Exception:
        font = ImageFont.load_default()
        font_h = font
    draw.text(
        (8, 12),
        f"AquAlania FINAL contact sheet ({len(items)} SKUs)",
        fill=(20, 20, 20),
        font=font_h,
    )
    html = [
        "<html><head><meta charset='utf-8'><title>AquAlania final contact sheet</title>",
        "<style>body{font:14px/1.4 system-ui,sans-serif}table{border-collapse:collapse;width:100%}",
        "th,td{border:1px solid #ddd;padding:6px;vertical-align:top}th{background:#f5f5f5}",
        "img{max-width:140px;max-height:180px} .sku{font:12px monospace}</style></head><body>",
        f"<h1>AquAlania final visual audit ({len(items)})</h1>",
        "<table><tr><th>#</th><th>Preview</th><th>SKU / name</th><th>Line / flavor / pack</th>"
        "<th>Source / processed</th><th>Status</th><th>Comment</th></tr>",
    ]
    for i, p in enumerate(items):
        r, c = divmod(i, cols)
        x, y = c * cell_w, 40 + r * (cell_h + label_h)
        prev = preview_dir / f"{p['proposed_sku']}.jpg"
        if prev.exists():
            im = Image.open(prev).convert("RGB")
            im.thumbnail((cell_w - 24, cell_h - 24))
            sheet.paste(im, (x + (cell_w - im.width) // 2, y + 8))
        label = p["proposed_sku"].replace("AQUALANIA-", "")
        draw.text((x + 6, y + cell_h - 2), label[:36], fill=(0, 0, 0), font=font)
        draw.text(
            (x + 6, y + cell_h + 14),
            f"{p.get('image_match_status')} {p.get('image_width')}x{p.get('image_height')}",
            fill=(60, 60, 60),
            font=font,
        )
        img_tag = (
            f"<img src='previews/{p['proposed_sku']}.jpg'/>"
            if prev.exists()
            else "<em>no preview</em>"
        )
        html.append(
            "<tr>"
            f"<td>{i+1}</td><td>{img_tag}</td>"
            f"<td><div class='sku'>{p['proposed_sku']}</div><div>{p['proposed_name']}</div></td>"
            f"<td>{p['line']}<br>{p['flavor']}<br>{p['volume_text']}, {p['package_type']}</td>"
            f"<td><div style='font-size:11px;word-break:break-all'>{p.get('source_image_url') or ''}</div>"
            f"<div class='sku'>{p.get('image_path') or ''}</div>"
            f"<div>{p.get('image_width')}×{p.get('image_height')} {p.get('image_mime')}</div></td>"
            f"<td>{p.get('image_match_status')}<br>review={p.get('review_status')}</td>"
            f"<td>{p.get('notes') or p.get('review_reason') or ''}</td>"
            "</tr>"
        )
    html.append("</table></body></html>")
    sheet.save(out_jpg, "JPEG", quality=85)
    out_html.write_text("\n".join(html), encoding="utf-8")


def main():
    stage1 = resolve_stage1()
    out = ART / f"{stamp()}-final"
    src_dir = out / "source-downloads"
    proc = out / "processed"
    prev = out / "previews"
    for d in (out, src_dir, proc, prev):
        d.mkdir(parents=True, exist_ok=True)

    discovered = json.loads((stage1 / "discovered.json").read_text(encoding="utf-8"))
    products = discovered["products"]

    # Evidence from official pages (refetch for final audit)
    evidence_pages = {}
    for key, url in {
        "product": SOURCE_RU,
        "enproduct": SOURCE_EN,
        "home": "https://aqualania.ru/",
        "sitemap": "https://aqualania.ru/sitemap.xml",
        "robots": "https://aqualania.ru/robots.txt",
    }.items():
        try:
            status, body = fetch(url)
            (out / "raw-html").mkdir(exist_ok=True)
            (out / "raw-html" / f"{key}.html").write_bytes(body)
            evidence_pages[key] = {"url": url, "http_status": status, "bytes": len(body)}
        except Exception as exc:  # noqa: BLE001
            evidence_pages[key] = {"url": url, "http_status": 0, "error": str(exc)}

    image_audit = []
    for p in products:
        sku = p["proposed_sku"]
        url = p.get("source_image_url") or ""
        notes = []

        # --- Igristoe decision ---
        if p["flavor"] == "Игристое":
            notes.append(
                "Официально безалкогольный: RU «Напиток безалкогольный сильногазированный "
                "„Игристое“»; EN «Non alcoholic carbonated drink with Sparkling wine/Champagne "
                "flavor»; на этикетке стекла — «НАПИТОК БЕЗАЛКОГОЛЬНЫЙ СИЛЬНОГАЗИРОВАННЫЙ». "
                "Слова Sparkling wine/Champagne = вкус, не алкогольный статус. "
                "В proposed_name без слова «вино»."
            )
            p["alcohol_status"] = "non_alcoholic_confirmed"
            p["igristoe_decision"] = "approved_non_alcoholic"

        # --- Feijoa image decision ---
        if p["flavor"] == "Фейхоа":
            notes.append(
                "Файл официального asset назван tarhun.png, но на этикетке явно «Фейхоа» "
                "и иллюстрация фейхоа; taruhn.png — отдельный SKU Тархун. "
                "Изображение оставлено как exact (не mismatch)."
            )
            p["feijoa_image_decision"] = "keep_tarhun_png_label_confirms_feijoa"

        if p["line"] == "LIGHT":
            notes.append(
                "Официальный product-page asset — единственный вариант вкуса; "
                "srcset/background/оригиналы большего размера на сайте не найдены "
                "(home jb_* ~282×300 — другой layout/подпись, не заменяют product SKU image). "
                "Без апскейла; exact_low_res; вкус и упаковка читаются."
            )

        p["proposed_name"] = proposed_name_final(p)
        p["notes"] = " ".join(notes).strip()

        # Re-download + process images from stage1 URL (or copy stage1 processed)
        if not url:
            p["image_match_status"] = "missing"
            p["image_path"] = None
            image_audit.append(
                {
                    "sku": sku,
                    "status": "missing",
                    "source_url": "",
                    "note": "No official image URL",
                }
            )
        else:
            fname = urllib.parse.unquote(url.rsplit("/", 1)[-1].split("#")[0])
            local = src_dir / f"{sku}__{fname}"
            try:
                status, data = fetch(url)
                local.write_bytes(data)
                mime = (
                    "image/png"
                    if data[:4] == b"\x89PNG"
                    else "image/jpeg"
                    if data[:2] == b"\xff\xd8"
                    else "application/octet-stream"
                )
                im = Image.open(local)
                w, h = im.size
                low_res = max(w, h) < 400
                meta = process_image(local, proc / f"{sku}.webp")
                Image.open(proc / f"{sku}.webp").convert("RGB").save(
                    prev / f"{sku}.jpg", "JPEG", quality=88
                )
                p["image_match_status"] = "exact_low_res" if low_res else "exact"
                p["image_path"] = str((proc / f"{sku}.webp").relative_to(ROOT))
                p["image_width"] = w
                p["image_height"] = h
                p["image_mime"] = mime
                p["image_sha256"] = hashlib.sha256(data).hexdigest()
                p["processed_sha256"] = meta["sha256"]
                image_audit.append(
                    {
                        "sku": sku,
                        "line": p["line"],
                        "flavor": p["flavor"],
                        "status": p["image_match_status"],
                        "source_url": url.split("#")[0],
                        "source_filename": fname,
                        "source_bytes": len(data),
                        "source_width": w,
                        "source_height": h,
                        "source_mime": mime,
                        "source_sha256": p["image_sha256"],
                        "processed_path": p["image_path"],
                        "processed_sha256": meta["sha256"],
                        "http_status": status,
                        "note": p.get("notes") or "",
                    }
                )
            except Exception as exc:  # noqa: BLE001
                # fallback: copy stage1 processed if present
                stage1_proc = stage1 / "processed" / f"{sku}.webp"
                if stage1_proc.exists():
                    shutil.copy2(stage1_proc, proc / f"{sku}.webp")
                    stage1_prev = stage1 / "previews" / f"{sku}.jpg"
                    if stage1_prev.exists():
                        shutil.copy2(stage1_prev, prev / f"{sku}.jpg")
                    p["image_match_status"] = p.get("image_match_status") or "exact"
                    p["image_path"] = str((proc / f"{sku}.webp").relative_to(ROOT))
                    image_audit.append(
                        {
                            "sku": sku,
                            "status": p["image_match_status"],
                            "source_url": url,
                            "note": f"redownload failed ({exc}); reused stage1 processed",
                        }
                    )
                else:
                    p["image_match_status"] = "missing"
                    p["image_path"] = None
                    image_audit.append(
                        {
                            "sku": sku,
                            "status": "missing",
                            "source_url": url,
                            "note": f"download failed: {exc}",
                        }
                    )

    # Production dedupe
    existing = load_production_products()
    by_sku = {str(x.get("sku") or "").upper(): x for x in existing if x.get("sku")}
    duplicates = []
    for p in products:
        sku_u = p["proposed_sku"].upper()
        if sku_u in by_sku:
            p["duplicate_status"] = "sku_collision"
            duplicates.append(
                {
                    "proposed_sku": p["proposed_sku"],
                    "status": "sku_collision",
                    "existing_sku": by_sku[sku_u].get("sku"),
                    "existing_name": by_sku[sku_u].get("name"),
                    "existing_brand": by_sku[sku_u].get("brand"),
                }
            )
            continue
        hits = []
        for ex in existing:
            name = (ex.get("name") or "").lower()
            brand = (ex.get("brand") or "").lower()
            ex_sku = (ex.get("sku") or "").upper()
            if (
                "aqualania" in brand
                or "аквалания" in brand
                or "aqualania" in name
                or "аквалания" in name
                or ex_sku.startswith("AQUALANIA-")
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

    # Final review
    approved, manual, rejected = [], [], []
    for p in products:
        reasons = []
        if p["duplicate_status"] in {"sku_collision", "exact_match", "conflict", "probable_match"}:
            reasons.append(p["duplicate_status"])
        if p.get("category_status") == "manual":
            reasons.append("category_manual")
        if p.get("image_match_status") == "missing":
            reasons.append("missing_image")
        if p.get("alcohol_status") == "unclear":
            reasons.append("alcohol_unclear")

        # Feijoa / Igristoe / Light are resolved → stay approved when otherwise complete
        complete = (
            p.get("volume_ml")
            and p.get("package_code")
            and p.get("flavor")
            and p.get("category_status") == "mapped"
            and p.get("duplicate_status") == "new_product"
            and p.get("image_match_status") in {"exact", "exact_low_res"}
        )
        if complete and not reasons:
            p["review_status"] = "approved"
            p["review_reason"] = ""
            p["confidence"] = "high" if p["image_match_status"] == "exact" else "medium"
            approved.append(p)
        elif complete and reasons == ["missing_image"]:
            p["review_status"] = "manual"
            p["review_reason"] = "missing_image"
            manual.append(p)
        elif "alcohol_unclear" in reasons:
            p["review_status"] = "manual"
            p["review_reason"] = "; ".join(reasons)
            manual.append(p)
        elif reasons:
            # probable_match / collision → manual (do not auto-apply)
            if any(r in reasons for r in ("sku_collision", "probable_match", "conflict")):
                p["review_status"] = "manual"
            elif "missing_image" in reasons and not p.get("source_image_url"):
                p["review_status"] = "rejected"
            else:
                p["review_status"] = "manual"
            p["review_reason"] = "; ".join(reasons)
            (manual if p["review_status"] == "manual" else rejected).append(p)
        else:
            p["review_status"] = "manual"
            p["review_reason"] = "incomplete"
            manual.append(p)

    contact_sheet_final(products, prev, out / "contact-sheet-final.html", out / "contact-sheet-final.jpg")

    def row(p: dict) -> dict:
        return {
            "proposed_sku": p["proposed_sku"],
            "official_name": p["official_name"],
            "proposed_name": p["proposed_name"],
            "brand": p.get("brand") or BRAND,
            "manufacturer": p.get("manufacturer") or MANUFACTURER,
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
            "category_status": p.get("category_status") or "",
            "source_url": p.get("source_url") or SOURCE_RU,
            "source_image_url": p.get("source_image_url") or "",
            "image_path": p.get("image_path") or "",
            "image_match_status": p.get("image_match_status") or "",
            "image_width": p.get("image_width") or "",
            "image_height": p.get("image_height") or "",
            "image_mime": p.get("image_mime") or "",
            "image_sha256": p.get("image_sha256") or "",
            "duplicate_status": p.get("duplicate_status") or "",
            "confidence": p.get("confidence") or "",
            "review_status": p.get("review_status") or "",
            "review_reason": p.get("review_reason") or "",
            "notes": p.get("notes") or "",
            "alcohol_status": p.get("alcohol_status") or "",
            "sales_status": "showcase",
            "price_amount": "",
            "orderable": "false",
            "availability": "on_order",
            "units_per_package": 1,
            "is_active": "true",
        }

    write_csv(out / "approved-products-final.csv", [row(p) for p in approved])
    write_csv(out / "manual-review-final.csv", [row(p) for p in manual])
    write_csv(out / "rejected-products-final.csv", [row(p) for p in rejected])
    write_csv(out / "image-audit-final.csv", image_audit)
    write_csv(out / "possible-duplicates-final.csv", duplicates)
    write_csv(
        out / "source-evidence-final.csv",
        [
            {
                "page": k,
                "url": v.get("url"),
                "http_status": v.get("http_status"),
                "bytes": v.get("bytes", ""),
                "error": v.get("error", ""),
            }
            for k, v in evidence_pages.items()
        ],
    )

    img_dist = Counter(p.get("image_match_status") for p in products)
    line_dist = Counter(p["line"] for p in products)
    cat_dist = Counter(p["category"] for p in approved)
    light_dims = [
        {
            "sku": p["proposed_sku"],
            "flavor": p["flavor"],
            "width": p.get("image_width"),
            "height": p.get("image_height"),
            "bytes": next((a.get("source_bytes") for a in image_audit if a["sku"] == p["proposed_sku"]), None),
            "status": p.get("image_match_status"),
        }
        for p in products
        if p["line"] == "LIGHT"
    ]

    igristoe = [p for p in products if p["flavor"] == "Игристое"]
    feijoa = [p for p in products if p["flavor"] == "Фейхоа"]

    manifest = {
        "stage": "final-pre-apply",
        "created_at": utc_now(),
        "based_on_stage1": str(stage1.relative_to(ROOT)),
        "manufacturer": MANUFACTURER,
        "brand": BRAND,
        "source_primary": SOURCE_RU,
        "source_en": SOURCE_EN,
        "scope": {
            "official_site_only": True,
            "third_party_forbidden": True,
            "production_writes": False,
            "apply_run": False,
        },
        "decisions": {
            "igristoe": {
                "status": "approved",
                "alcohol": "non_alcoholic_confirmed",
                "evidence": [
                    "RU product title: Напиток безалкогольный сильногазированный «Игристое»",
                    "EN: Non alcoholic carbonated drink with Sparkling wine / Champagne flavor",
                    "Glass label text: НАПИТОК БЕЗАЛКОГОЛЬНЫЙ СИЛЬНОГАЗИРОВАННЫЙ",
                ],
                "naming": "Напиток газированный AquAlania Игристое, … (без слова «вино»)",
                "skus": [p["proposed_sku"] for p in igristoe],
            },
            "feijoa": {
                "status": "approved",
                "image": "exact",
                "asset_filename": "tarhun.png",
                "finding": "Filename misleading; label text/illustration confirm Feijoa. taruhn.png is Tarhun SKU.",
                "sku": feijoa[0]["proposed_sku"] if feijoa else None,
            },
            "light_low_res": {
                "status": "approved_exact_low_res",
                "upscaled": False,
                "dimensions": light_dims,
            },
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
            "production_products_scanned": len(existing),
            "production_sku_collisions": sum(
                1 for p in products if p.get("duplicate_status") == "sku_collision"
            ),
            "probable_matches": sum(
                1 for p in products if p.get("duplicate_status") == "probable_match"
            ),
        },
        "line_distribution": dict(line_dist),
        "category_distribution_approved": dict(cat_dist),
        "approved_skus": [p["proposed_sku"] for p in approved],
        "manual_skus": [p["proposed_sku"] for p in manual],
        "rejected_skus": [p["proposed_sku"] for p in rejected],
        "apply": {
            "sales_status": "showcase",
            "is_active": True,
            "price_amount": None,
            "availability": "on_order",
            "orderable": False,
            "units_per_package": 1,
            "create_only": True,
            "modify_existing_products": False,
            "auto_create_categories": False,
        },
        "checks": {
            "production_db_modified": False,
            "apply_run": False,
            "merge_used": False,
            "existing_products_modified": False,
        },
    }
    (out / "approved-import-manifest-final.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out / "discovered-final.json").write_text(
        json.dumps({"products": products, "pages": evidence_pages}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )

    light_table_lines = [
        "| SKU | Flavor | Size | Bytes | Status |",
        "|-----|--------|-----:|------:|--------|",
    ]
    for d in light_dims:
        light_table_lines.append(
            f"| `{d['sku']}` | {d['flavor']} | {d['width']}×{d['height']} | {d['bytes']} | {d['status']} |"
        )
    light_rows = "\n".join(light_table_lines) if light_dims else "_none_"
    report = f"""# AquAlania FINAL pre-apply report

**When:** {manifest['created_at']}  
**Output:** `{out.relative_to(ROOT)}`  
**Based on:** `{stage1.relative_to(ROOT)}`  
**Sources:** {SOURCE_RU}, {SOURCE_EN}

## Decisions

### 1. «Игристое»
- **Verdict:** APPROVED (безалкогольный газированный напиток со вкусом «Игристое»)
- RU: «Напиток безалкогольный сильногазированный „Игристое“»
- EN: «Non alcoholic carbonated drink with … flavor» (Sparkling wine / Champagne = flavor wording)
- Этикетка стекла: «НАПИТОК БЕЗАЛКОГОЛЬНЫЙ СИЛЬНОГАЗИРОВАННЫЙ»
- Naming: `Напиток газированный AquAlania Игристое, …` — **без слова «вино»**
- SKUs: {', '.join('`'+s+'`' for s in manifest['decisions']['igristoe']['skus'])}

### 2. Feijoa
- **Verdict:** APPROVED, image **exact**
- Официальный файл `tarhun.png` по этикетке = **Фейхоа** (не Тархун)
- `taruhn.png` = отдельный SKU Тархун
- Неверная фотография не назначалась

### 3. Light low-res
- Оригиналы на product page: **224×200 JPEG**; srcset / CSS background / larger originals **не найдены**
- Home `jb_*` ~282×300 — не заменяют product SKU image (layout/caption)
- Без апскейла; статус `exact_low_res`; импорт разрешён (вкус/упаковка читаются)

{light_rows}

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
| Production scanned | {len(existing)} |
| SKU collisions | {manifest['counts']['production_sku_collisions']} |
| Probable matches | {manifest['counts']['probable_matches']} |

## Lines
{chr(10).join(f'- {k}: **{v}**' for k,v in sorted(line_dist.items()))}

## Approved categories
{chr(10).join(f'- {k}: **{v}**' for k,v in sorted(cat_dist.items())) or '_none_'}

## Manifest
`{(out / 'approved-import-manifest-final.json').relative_to(ROOT)}`

## Apply readiness
- create-only gated in `scripts/import-aqualania.ts`
- **production apply NOT run**
- requires `--i-understand-and-have-backup` + `--backup-path` + `--manifest`
- categories not auto-created; existing products not edited
"""
    (out / "PRE-APPLY-REPORT.md").write_text(report, encoding="utf-8")

    runbook = f"""# VPS Production Runbook — AquAlania FINAL

**Do not run until operator explicitly confirms production apply.**

| | |
|--|--|
| Manifest | `{(out / 'approved-import-manifest-final.json').relative_to(ROOT)}` |
| Approved CSV | `{(out / 'approved-products-final.csv').relative_to(ROOT)}` |
| Approved SKUs | **{len(approved)}** |
| Create-only | yes |
| Auto-create categories | no |

```bash
STAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP=/opt/tinda/app/backups/tinda-prod-aqualania-$STAMP.sql
pg_dump "$PGURL" --no-owner --format=plain > "$BACKUP"
sha256sum "$BACKUP" | tee "$BACKUP.sha256"

# optional: copy worktree / pull branch cursor/import-aqualania-e6e4

npm run import:aqualania:apply -- \\
  --i-understand-and-have-backup \\
  --backup-path="$BACKUP" \\
  --manifest="{(out / 'approved-import-manifest-final.json').relative_to(ROOT)}"
```

Expected first apply: created={len(approved)}, skipped=0, existing_products_edited=false.  
Expected second apply (idempotent): created=0, skipped={len(approved)}.

Forbidden: `--merge`, editing existing products, importing manual/rejected, auto-creating categories.
"""
    (out / "VPS-PRODUCTION-RUNBOOK.md").write_text(runbook, encoding="utf-8")

    latest = ART / "latest-final"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    latest.symlink_to(out.name)

    readme = ART / "README.md"
    readme.write_text(
        f"""# Импорт производителя AquAlania

Источник: только https://aqualania.ru/product (+ /enproduct).  
Производитель: {MANUFACTURER}.

## Stage 1
```bash
npm run import:aqualania:stage1
```
Latest stage1: `latest-stage1/`

## Final (stage 2)
```bash
python3 scripts/aqualania-stage2-final.py
# or
npm run import:aqualania:final
```
Latest final: `latest-final/` → `{out.name}`

Manifest: `{ (out / 'approved-import-manifest-final.json').relative_to(ROOT) }`

Apply (gated; not run until confirmed):
```bash
npm run import:aqualania:apply -- \\
  --i-understand-and-have-backup \\
  --backup-path="<path>" \\
  --manifest="{ (out / 'approved-import-manifest-final.json').relative_to(ROOT) }"
```
""",
        encoding="utf-8",
    )

    # Also copy approved CSV as approved-products.csv next to final manifest for apply CLI compatibility
    shutil.copy2(out / "approved-products-final.csv", out / "approved-products.csv")
    # Symlink-friendly name expected by apply: approved-import-manifest.json
    (out / "approved-import-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(report)
    print(f"Wrote {out.relative_to(ROOT)}")
    print("APPROVED", len(approved), "MANUAL", len(manual), "REJECTED", len(rejected))


if __name__ == "__main__":
    main()
