#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Preflight checks before Bavaria production apply (PR #18). Exit 0 only if safe."""

from __future__ import annotations

import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / "artifacts/bavaria-import/latest-pdf-reviewed"
PDF = ROOT / "artifacts/bavaria-import/pdf-source/BAVARIA-CATALOG-2026.pdf"
EXPECTED_SHA = "e93756ed45acecb1335e562aa4f9d455899c0b846fb9bb1bc6b3f33af436da93"
OUT = ROOT / "artifacts/bavaria-import/pre-apply-checks"


def main() -> int:
    issues: list[str] = []
    OUT.mkdir(parents=True, exist_ok=True)

    if not PDF.is_file() or PDF.stat().st_size <= 0:
        issues.append("PDF missing or empty")
    else:
        digest = hashlib.sha256(PDF.read_bytes()).hexdigest()
        if digest != EXPECTED_SHA:
            issues.append(f"PDF sha mismatch: {digest}")

    manifest = json.loads((REVIEW / "approved-import-manifest.json").read_text(encoding="utf-8"))
    rows = list(csv.DictReader((REVIEW / "approved-products.csv").open(encoding="utf-8-sig")))
    manual = list(csv.DictReader((REVIEW / "manual-review.csv").open(encoding="utf-8-sig")))
    rejected = list(csv.DictReader((REVIEW / "rejected-products.csv").open(encoding="utf-8-sig")))
    wholesale = list(
        csv.DictReader((REVIEW / "wholesale-packaging-review.csv").open(encoding="utf-8-sig"))
    )

    if len(rows) != 164:
        issues.append(f"approved count {len(rows)} != 164")
    if len(manifest.get("approved_skus") or []) != 164:
        issues.append("manifest approved_skus != 164")
    if set(r["proposed_sku"] for r in rows) != set(manifest["approved_skus"]):
        issues.append("csv/manifest SKU set mismatch")

    dups = [s for s, n in Counter(r["proposed_sku"] for r in rows).items() if n > 1]
    if dups:
        issues.append(f"SKU collisions: {dups}")

    for r in rows:
        for f in ("proposed_sku", "proposed_name", "brand", "category", "volume", "package", "source_url"):
            if not (r.get(f) or "").strip():
                issues.append(f"{r.get('proposed_sku')}: missing {f}")
        img = (r.get("image_url") or "").strip()
        match = (r.get("image_match") or "").strip()
        if not img and match not in {"shared-line-image", "exact"}:
            issues.append(f"{r.get('proposed_sku')}: no image and image_match={match!r}")

    mset = {r["proposed_sku"] for r in rows}
    for bad in (
        "NORDISCH-NA-450-GLASS",
        "YABLOKO-450-GLASS",
        "SPORT-MANUAL",
    ):
        if any(bad in s for s in mset):
            issues.append(f"forbidden in approved: {bad}")
    if any(s.endswith("APELSIN-450-GLASS") and "PREMIUM" not in s for s in mset):
        issues.append("regular Апельсин стекло 0,45 in approved")
    if any("KOLA-450-GLASS" in s and "PREMIUM" not in s and "SF" not in s for s in mset):
        issues.append("regular Кола стекло 0,45 in approved")
    if any("KEG" in s or "30000" in s or "50000" in s for s in mset):
        issues.append("wholesale keg in approved")

    if mset & {r["proposed_sku"] for r in manual}:
        issues.append("approved ∩ manual non-empty")
    if mset & {r["proposed_sku"] for r in rejected}:
        issues.append("approved ∩ rejected non-empty")
    if mset & {r["proposed_sku"] for r in wholesale}:
        issues.append("approved ∩ wholesale non-empty")

    na = [r for r in rows if r["category"] == "Безалкогольное пиво"]
    if len(na) != 7:
        issues.append(f"NA beer {len(na)} != 7")

    dob = [r for r in rows if "DOBRETSOV" in r["proposed_sku"]]
    if not any("1420" in r["proposed_sku"] or r.get("volume") == "1,42 л" for r in dob):
        issues.append("Dobrecov 1,42 л missing")
    if any("1400" in r["proposed_sku"] or r.get("volume") == "1,4 л" for r in dob):
        issues.append("Dobrecov 1,4 л still approved")

    for r in rows:
        if "SWIPE" in r["proposed_sku"] and (r.get("volume") or "").strip() == "33 л":
            issues.append(f"SWIPE 33 л: {r['proposed_sku']}")

    if manifest.get("pdf_sha256") != EXPECTED_SHA:
        issues.append("manifest pdf_sha256 mismatch")
    if manifest.get("pdf_file_available") is not True:
        issues.append("manifest pdf_file_available != true")

    db_url = bool((__import__("os").environ.get("DATABASE_URL") or "").strip())
    report = {
        "ok": len(issues) == 0,
        "approved": len(rows),
        "manual": len(manual),
        "rejected": len(rejected),
        "wholesale": len(wholesale),
        "na_beer": len(na),
        "sku_collisions": dups,
        "issues": issues,
        "pdf_sha256": EXPECTED_SHA,
        "database_url_set": db_url,
        "apply_ready": len(issues) == 0 and db_url,
        "manifest": str((REVIEW / "approved-import-manifest.json").relative_to(ROOT)),
    }
    (OUT / "STAGE1-MANIFEST-CHECK.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if issues:
        return 2
    if not db_url:
        print(
            "PREFLIGHT WARN: DATABASE_URL unset — backup/apply cannot run in this environment",
            file=sys.stderr,
        )
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
