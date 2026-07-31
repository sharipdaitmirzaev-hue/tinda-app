#!/usr/bin/env python3
"""Build Bavaria missing-image inventory enrichment + download official sources (no DB writes)."""

from __future__ import annotations

import csv
import hashlib
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts/bavaria-import/image-completion-2026-07-31"
SRC_DIR = OUT / "source-downloads"
UA = "TINDA-ImageResearch/1.0 (+https://tindamarket.ru; catalog research)"
BASE = "https://www.bavaria-group.ru/files/beer_items"

# SKU -> (candidate_urls, confidence, source_priority, review_status, notes)
# review_status: confirmed | confirmed_needs_crop | pending_pdf_crop | disputed | rejected_wrong_product
MAP: dict[str, tuple[list[str], str, str, str, str]] = {
    # NA beer
    "BAVARIA-BAVARIYA-ELF-450-CAN": (
        [f"{BASE}/55_1740991309.jpg"],
        "medium",
        "official_site",
        "confirmed_needs_crop",
        "Site shows glass; prefer PDF p.11 can crop for unique pack. Glass asset only interim.",
    ),
    "BAVARIA-BAVARIYA-GALLAGHER-NA-450-CAN": (
        [],
        "low",
        "official_pdf",
        "pending_pdf_crop",
        "Reject site Gallagher 4% lager (103_…). Crop NA can from PDF p.11 under 0% stamp.",
    ),
    "BAVARIA-BAVARIYA-GALLAGHER-NA-450-GLASS": (
        [],
        "low",
        "official_pdf",
        "pending_pdf_crop",
        "Reject alcoholic site art. Crop NA bottle from PDF p.11.",
    ),
    "BAVARIA-BAVARIYA-NORDISCH-NA-450-CAN": (
        [],
        "low",
        "official_pdf",
        "pending_pdf_crop",
        "Reject site Nordisch 5% (140_…). PDF p.11 can icon + bottle context.",
    ),
    # Regular soda glass PDF
    "BAVARIA-BAVARIYA-GRUSHA-450-GLASS": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "PDF p.15 glass Груша.",
    ),
    "BAVARIA-BAVARIYA-MOHITO-450-GLASS": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "PDF p.15 glass Мохито.",
    ),
    "BAVARIA-BAVARIYA-PITAHAYYA-450-GLASS": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "PDF p.15 glass Питахайя.",
    ),
    "BAVARIA-BAVARIYA-TARHUN-450-GLASS": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "PDF p.15 glass Тархун.",
    ),
    "BAVARIA-BAVARIYA-KOLA-500-PET": (
        [f"{BASE}/97_1730364236.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop Кола from official 0.5 PET lineup.",
    ),
    "BAVARIA-BAVARIYA-KOLA-1500-PET": (
        [f"{BASE}/95_1730364037.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop Кола from official 1.5 PET lineup.",
    ),
    "BAVARIA-BAVARIYA-YABLOKO-1500-PET": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "Not in site 1.5 group; PDF p.15 Яблоко PET.",
    ),
    # Premium
    "BAVARIA-BAVARIYA-PREMIUM-VISHNYA-500-GLASS": (
        [f"{BASE}/22_1730373939.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop Вишня from Premium glass group.",
    ),
    "BAVARIA-BAVARIYA-PREMIUM-VISHNYA-1200-PET": (
        [f"{BASE}/126_1772458839.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop Вишня from Premium PET 1.2 group.",
    ),
    "BAVARIA-BAVARIYA-PREMIUM-VINOGRAD-500-GLASS": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "Виноград absent from site Premium photos; PDF p.14.",
    ),
    "BAVARIA-BAVARIYA-PREMIUM-VINOGRAD-1200-PET": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "Виноград absent from site PET group; PDF p.14.",
    ),
    # Cola LE
    "BAVARIA-COLALE-COLA-LE-1500-PET": (
        [f"{BASE}/91_1726224649.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 1.5 LIMITED EDITION from official PET pair.",
    ),
    "BAVARIA-COLALE-COLA-LE-500-PET": (
        [f"{BASE}/91_1726224649.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 0.5 LIMITED EDITION from official PET pair.",
    ),
    "BAVARIA-COLALE-COLA-LE-450-GLASS": (
        [f"{BASE}/92_1726224683.png"],
        "low",
        "official_site",
        "disputed",
        "LE page glass asset face reads Cola CLASSIC — do not auto-apply; prefer PDF p.18 if LE-branded.",
    ),
    "BAVARIA-COLALE-COLA-LE-330-CAN": (
        [],
        "low",
        "official_pdf",
        "pending_pdf_crop",
        "No LE can on site; avoid Premium LE can mix-up.",
    ),
    # Dobretsov
    "BAVARIA-DOBRETSOV-HLEBNYY-2000-PET": (
        [f"{BASE}/76_1783510510.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 2L Хлебный from official group.",
    ),
    "BAVARIA-DOBRETSOV-HLEBNYY-1420-PET": (
        [f"{BASE}/76_1783510510.jpg"],
        "medium",
        "official_site",
        "confirmed_needs_crop",
        "Crop mid PET (~1.4L) from official group; confirm volume label.",
    ),
    "BAVARIA-DOBRETSOV-HLEBNYY-450-CAN": (
        [f"{BASE}/76_1783510510.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop can from official Хлебный group.",
    ),
    "BAVARIA-DOBRETSOV-BOCHKOVOY-2000-PET": (
        [f"{BASE}/139_1783501193.png"],
        "high",
        "official_site",
        "confirmed",
        "Official Бочковой PET 2L unique artwork.",
    ),
    "BAVARIA-DOBRETSOV-BOCHKOVOY-1420-PET": (
        [f"{BASE}/139_1783501193.png"],
        "medium",
        "official_site",
        "disputed",
        "Site shows 2L only; reuse 2L art is imperfect for 1.42 — prefer PDF if distinct pack exists.",
    ),
    # Dreamix soda
    "BAVARIA-DREAMIX-KLYUKVA-APELSIN-1500-PET": (
        [f"{BASE}/98_1743082462.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Flavor-unique trio; crop 1.5 PET.",
    ),
    "BAVARIA-DREAMIX-KLYUKVA-APELSIN-500-PET": (
        [f"{BASE}/98_1743082462.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 0.5 PET.",
    ),
    "BAVARIA-DREAMIX-KLYUKVA-APELSIN-330-CAN": (
        [f"{BASE}/98_1743082462.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 0.33 can.",
    ),
    "BAVARIA-DREAMIX-KOLA-TSITRUS-1500-PET": (
        [f"{BASE}/100_1743082523.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Flavor-unique trio; crop 1.5 PET.",
    ),
    "BAVARIA-DREAMIX-KOLA-TSITRUS-500-PET": (
        [f"{BASE}/100_1743082523.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 0.5 PET.",
    ),
    "BAVARIA-DREAMIX-KOLA-TSITRUS-330-CAN": (
        [f"{BASE}/100_1743082523.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 0.33 can.",
    ),
    "BAVARIA-DREAMIX-TAYGA-1500-PET": (
        [f"{BASE}/101_1743082539.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Flavor-unique trio; crop 1.5 PET.",
    ),
    "BAVARIA-DREAMIX-TAYGA-500-PET": (
        [f"{BASE}/101_1743082539.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 0.5 PET.",
    ),
    "BAVARIA-DREAMIX-TAYGA-330-CAN": (
        [f"{BASE}/101_1743082539.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 0.33 can.",
    ),
    "BAVARIA-DREAMIX-MOHITO-1500-PET": (
        [f"{BASE}/102_1743082553.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Flavor-unique trio; crop 1.5 PET.",
    ),
    "BAVARIA-DREAMIX-MOHITO-500-PET": (
        [f"{BASE}/102_1743082553.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 0.5 PET.",
    ),
    "BAVARIA-DREAMIX-MOHITO-330-CAN": (
        [f"{BASE}/102_1743082553.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop 0.33 can.",
    ),
    # Dreamix tonic
    "BAVARIA-DREAMIX-INDIAN-TONIK-1000-PET": (
        [f"{BASE}/127_1775207748.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop PET 1L from Indian Tonic pair.",
    ),
    "BAVARIA-DREAMIX-INDIAN-TONIK-330-GLASS": (
        [f"{BASE}/127_1775207748.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop glass 0.33 from Indian Tonic pair.",
    ),
    "BAVARIA-DREAMIX-INDIAN-TONIK-330-CAN": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "PDF p.21 Indian Tonic can.",
    ),
    "BAVARIA-DREAMIX-BITTER-LEMON-330-CAN": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "PDF p.21 Bitter Lemon can; site 128 is glass+PET only.",
    ),
    # Limnada
    "BAVARIA-LIMNADA-BARBARIS-1500-PET": (
        [f"{BASE}/58_1718608488.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop Барбарис from 1.5 lineup.",
    ),
    "BAVARIA-LIMNADA-BARBARIS-500-PET": (
        [f"{BASE}/68_1718376439.jpg"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop Барбарис from 0.5 lineup.",
    ),
    # Mountea
    "BAVARIA-MOUNTEA-LESNYE-YAGODY-1500-PET": (
        [f"{BASE}/28_1758711718.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop large Лесные ягоды PET.",
    ),
    "BAVARIA-MOUNTEA-LESNYE-YAGODY-500-PET": (
        [f"{BASE}/28_1758711718.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop small Лесные ягоды PET.",
    ),
    "BAVARIA-MOUNTEA-PERSIK-330-CAN": (
        [f"{BASE}/67_1758711780.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop Персик can from official can pair.",
    ),
    "BAVARIA-MOUNTEA-LAYM-MYATA-1500-PET": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "PDF p.24 only; not on site.",
    ),
    "BAVARIA-MOUNTEA-LAYM-MYATA-500-PET": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "PDF p.24 only.",
    ),
    "BAVARIA-MOUNTEA-LAYM-MYATA-330-CAN": (
        [],
        "medium",
        "official_pdf",
        "pending_pdf_crop",
        "PDF p.24 only.",
    ),
    # Rocket Ride
    "BAVARIA-ROCKET-RIDE-CLASSIC-450-CAN": (
        [f"{BASE}/105_1757076183.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Official Classic CAN+PET; crop can.",
    ),
    "BAVARIA-ROCKET-RIDE-CLASSIC-500-PET": (
        [f"{BASE}/105_1757076183.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop PET.",
    ),
    "BAVARIA-ROCKET-RIDE-MANGO-APRICOT-450-CAN": (
        [f"{BASE}/106_1757076512.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop can.",
    ),
    "BAVARIA-ROCKET-RIDE-MANGO-APRICOT-500-PET": (
        [f"{BASE}/106_1757076512.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop PET.",
    ),
    "BAVARIA-ROCKET-RIDE-KIVI-YABLOKO-450-CAN": (
        [f"{BASE}/107_1757076818.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop can.",
    ),
    "BAVARIA-ROCKET-RIDE-KIVI-YABLOKO-500-PET": (
        [f"{BASE}/107_1757076818.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop PET.",
    ),
    "BAVARIA-ROCKET-RIDE-DIKIE-YAGODY-450-CAN": (
        [f"{BASE}/108_1757077083.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop can.",
    ),
    "BAVARIA-ROCKET-RIDE-DIKIE-YAGODY-500-PET": (
        [f"{BASE}/108_1757077083.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop PET.",
    ),
    "BAVARIA-ROCKET-RIDE-LAYM-LEMONGRAS-450-CAN": (
        [f"{BASE}/109_1757077306.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop can.",
    ),
    "BAVARIA-ROCKET-RIDE-LAYM-LEMONGRAS-500-PET": (
        [f"{BASE}/109_1757077306.png"],
        "high",
        "official_site",
        "confirmed_needs_crop",
        "Crop PET.",
    ),
}


def download(url: str, dest: Path) -> dict:
    if dest.exists() and dest.stat().st_size > 100:
        data = dest.read_bytes()
        return {
            "url": url,
            "path": str(dest.relative_to(ROOT)),
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "status": "reused",
        }
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.bavaria-group.ru/"})
    with urllib.request.urlopen(req, timeout=60) as res:
        ctype = res.headers.get("Content-Type", "")
        data = res.read()
    if not ctype.startswith("image/") and not url.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        raise RuntimeError(f"not image: {ctype}")
    if len(data) < 100:
        raise RuntimeError("too small")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return {
        "url": url,
        "path": str(dest.relative_to(ROOT)),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "content_type": ctype,
        "status": "downloaded",
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    SRC_DIR.mkdir(parents=True, exist_ok=True)

    inv = json.loads((OUT / "missing-images-inventory.json").read_text())
    by_sku = {r["sku"]: r for r in inv}

    downloads: dict[str, dict] = {}
    last = 0.0
    for sku, (urls, conf, prio, status, notes) in MAP.items():
        row = by_sku.get(sku)
        if not row:
            continue
        row["candidate_image_urls"] = urls
        row["match_confidence"] = conf
        row["candidate_source_priority"] = prio
        row["review_status"] = status
        row["notes"] = notes
        local_paths = []
        for url in urls:
            fname = url.rstrip("/").split("/")[-1]
            dest = SRC_DIR / fname
            wait = 0.5 - (time.time() - last)
            if wait > 0:
                time.sleep(wait)
            last = time.time()
            try:
                if url not in downloads:
                    downloads[url] = download(url, dest)
                local_paths.append(downloads[url]["path"])
            except Exception as exc:  # noqa: BLE001
                downloads[url] = {"url": url, "status": "error", "error": str(exc)}
        row["downloaded_source_paths"] = local_paths

    # fill any inventory rows not in MAP
    for row in inv:
        if row["sku"] not in MAP:
            row.setdefault("review_status", "pending_source")
            row.setdefault("match_confidence", "low")

    # manuals
    manuals = json.loads((OUT / "manual-positions-inventory.json").read_text())
    manual_decisions = {
        "BAVARIA-BAVARIYA-NORDISCH-NA-450-GLASS": (
            False,
            "keep_manual",
            "PDF p.11 bottle photo vs CAN-only icon; site Nordisch is alcoholic 5%.",
        ),
        "BAVARIA-BAVARIYA-APELSIN-450-GLASS": (
            False,
            "keep_manual",
            "No Апельсин glass packshot on PDF p.15 (only line icon).",
        ),
        "BAVARIA-BAVARIYA-KOLA-450-GLASS": (
            False,
            "keep_manual",
            "No Кола glass packshot on PDF p.15.",
        ),
        "BAVARIA-BAVARIYA-YABLOKO-450-GLASS": (
            False,
            "keep_manual",
            "Яблоко shown as PET 1.5 only on PDF p.15, not glass 0.45.",
        ),
        "BAVARIA-TBAU-SPORT-MANUAL": (
            False,
            "keep_manual",
            "Site/PDF lack Sport volume/pack matrix.",
        ),
    }
    for row in manuals:
        ok, rec, note = manual_decisions[row["sku"]]
        row["unique_pack_confirmed"] = ok
        row["recommendation"] = rec
        row["notes"] = note

    # image-update manifest (dry-run only; no production apply)
    manifest_items = []
    for row in inv:
        if row.get("review_status") not in {"confirmed", "confirmed_needs_crop"}:
            continue
        if not row.get("candidate_image_urls"):
            continue
        manifest_items.append(
            {
                "sku": row["sku"],
                "action": "update_image_only",
                "match_confidence": row["match_confidence"],
                "review_status": row["review_status"],
                "source_priority": row["candidate_source_priority"],
                "source_image_url": row["candidate_image_urls"][0],
                "downloaded_source_path": (row.get("downloaded_source_paths") or [None])[0],
                "local_processed_path": None,
                "requires_crop": row["review_status"] == "confirmed_needs_crop",
                "fields_to_change": ["image_url"],
                "fields_forbidden": [
                    "category_id",
                    "price_amount",
                    "sales_status",
                    "is_active",
                    "name",
                    "sku",
                ],
                "notes": row.get("notes"),
            }
        )

    status_counts: dict[str, int] = {}
    for row in inv:
        status_counts[row.get("review_status") or "unknown"] = (
            status_counts.get(row.get("review_status") or "unknown", 0) + 1
        )

    meta = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "branch": "cursor/bavaria-missing-images-ad60",
        "production_db_modified": False,
        "production_apply_executed": False,
        "prod_without_image": len(inv),
        "manual_keep": sum(1 for m in manuals if m.get("recommendation") == "keep_manual"),
        "manual_promoted": 0,
        "status_counts": status_counts,
        "unique_source_urls_downloaded": sum(
            1 for v in downloads.values() if v.get("status") in {"downloaded", "reused"}
        ),
        "manifest_candidates": len(manifest_items),
        "image_update_manifest": "image-update-manifest.json",
    }

    (OUT / "missing-images-inventory.json").write_text(
        json.dumps(inv, ensure_ascii=False, indent=2) + "\n"
    )
    (OUT / "manual-positions-inventory.json").write_text(
        json.dumps(manuals, ensure_ascii=False, indent=2) + "\n"
    )
    (OUT / "source-download-report.json").write_text(
        json.dumps(downloads, ensure_ascii=False, indent=2) + "\n"
    )
    (OUT / "image-update-manifest.json").write_text(
        json.dumps(
            {
                "mode": "dry-run",
                "kind": "image_update_only",
                "created_at": meta["created_at"],
                "item_count": len(manifest_items),
                "items": manifest_items,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    (OUT / "inventory-meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")

    # refresh CSV
    fields = list(inv[0].keys())
    with open(OUT / "missing-images-inventory.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in inv:
            r = dict(row)
            for k in ("imaged_sibling_skus", "candidate_image_urls", "downloaded_source_paths"):
                if isinstance(r.get(k), list):
                    r[k] = "|".join(r[k])
            w.writerow(r)

    mfields = list(manuals[0].keys())
    with open(OUT / "manual-positions-inventory.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=mfields)
        w.writeheader()
        for row in manuals:
            r = dict(row)
            if isinstance(r.get("candidate_image_urls"), list):
                r["candidate_image_urls"] = "|".join(r["candidate_image_urls"])
            w.writerow(r)

    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
