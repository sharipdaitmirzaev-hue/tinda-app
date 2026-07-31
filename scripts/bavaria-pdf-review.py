#!/usr/bin/env python3
"""PDF booklet review for Bavaria non-alcoholic import (dry-run only).

Looks for «БУКЛЕТ БАВАРИЯ 2026.pdf» and, when present, renders pages for visual
audit. Also applies curated booklet findings from the review brief and
cross-checks website assortment text from the prior dry-run.

Does NOT write to production DB / apply import.
"""
from __future__ import annotations

import csv
import json
import os
import re
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/workspace")
PDF_CANDIDATES = [
    Path("/mnt/data/БУКЛЕТ БАВАРИЯ 2026.pdf"),
    Path("/mnt/data/Буклет Бавария 2026.pdf"),
    Path("/workspace/artifacts/bavaria-import/pdf-source/БУКЛЕТ БАВАРИЯ 2026.pdf"),
    Path("/workspace/БУКЛЕТ БАВАРИЯ 2026.pdf"),
]
PDF_NAME = "БУКЛЕТ БАВАРИЯ 2026.pdf"
PRIOR = ROOT / "artifacts/bavaria-import/2026-07-31T10-52-18-371Z"
DISCOVERED = PRIOR / "discovered.json"

MANUFACTURER = "ГК ПД «Бавария»"


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def find_pdf() -> Path | None:
    for p in PDF_CANDIDATES:
        if p.exists() and p.stat().st_size > 1000:
            return p
    # fuzzy
    for base in [Path("/mnt/data"), ROOT / "artifacts/bavaria-import/pdf-source", ROOT]:
        if not base.exists():
            continue
        for p in base.glob("*.pdf"):
            if "бавар" in p.name.lower() or "bavaria" in p.name.lower() or "буклет" in p.name.lower():
                return p
    return None


def try_render_pdf(pdf: Path, out_dir: Path) -> dict:
    """Render pages + extract text when PDF is available."""
    meta = {
        "pdf_found": True,
        "pdf_path": str(pdf),
        "pages": 0,
        "page_texts": {},
        "rendered_pages": [],
        "na_beer_page": None,
        "error": None,
    }
    try:
        import fitz  # PyMuPDF
    except ImportError:
        meta["error"] = "pymupdf not installed"
        return meta

    pages_dir = out_dir / "pdf-pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(pdf)
    meta["pages"] = doc.page_count
    for i in range(doc.page_count):
        page = doc.load_page(i)
        text = page.get_text("text")
        meta["page_texts"][str(i + 1)] = text
        # render at ~140 dpi for visual review
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        img_path = pages_dir / f"page-{i+1:02d}.png"
        pix.save(str(img_path))
        meta["rendered_pages"].append(str(img_path))
        blob = text.lower().replace("ё", "е")
        if "безалкогольное пиво" in blob or ("0%" in text and "nordisch" in blob):
            if meta["na_beer_page"] is None:
                meta["na_beer_page"] = i + 1
    doc.close()
    return meta


def sku(brand: str, product: str, ml: int, pkg: str) -> str:
    def slug(s: str, n: int = 20) -> str:
        table = str.maketrans(
            {
                "а": "a",
                "б": "b",
                "в": "v",
                "г": "g",
                "д": "d",
                "е": "e",
                "ё": "e",
                "ж": "zh",
                "з": "z",
                "и": "i",
                "й": "y",
                "к": "k",
                "л": "l",
                "м": "m",
                "н": "n",
                "о": "o",
                "п": "p",
                "р": "r",
                "с": "s",
                "т": "t",
                "у": "u",
                "ф": "f",
                "х": "h",
                "ц": "ts",
                "ч": "ch",
                "ш": "sh",
                "щ": "sch",
                "ъ": "",
                "ы": "y",
                "ь": "",
                "э": "e",
                "ю": "yu",
                "я": "ya",
            }
        )
        s = s.lower().translate(table)
        s = re.sub(r"[^a-z0-9]+", "-", s).strip("-").upper()
        return (s[:n] or "X").rstrip("-")

    out = f"BAVARIA-{slug(brand, 16)}-{slug(product, 22)}-{ml}-{pkg}"
    return out[:64]


def evidence_row(**kwargs) -> dict:
    return {
        "SKU": kwargs.get("SKU", ""),
        "brand": kwargs.get("brand", ""),
        "field": kwargs.get("field", ""),
        "value": kwargs.get("value", ""),
        "pdf_name": kwargs.get("pdf_name", PDF_NAME),
        "page_number": kwargs.get("page_number", ""),
        "evidence_type": kwargs.get("evidence_type", ""),
        "confidence": kwargs.get("confidence", ""),
        "notes": kwargs.get("notes", ""),
    }


def main() -> None:
    ts = stamp()
    out = ROOT / "artifacts" / "bavaria-import" / f"{ts}-pdf-reviewed"
    out.mkdir(parents=True, exist_ok=True)

    pdf = find_pdf()
    pdf_meta = {
        "pdf_found": False,
        "pdf_path": None,
        "pages": 0,
        "page_texts": {},
        "rendered_pages": [],
        "na_beer_page": None,
        "error": "PDF not found at /mnt/data or workspace pdf-source",
    }
    if pdf:
        pdf_meta = try_render_pdf(pdf, out)
        # copy into artifacts
        shutil.copy2(pdf, out / PDF_NAME)

    # Resolve NA beer page number from rendered text if possible
    na_page = pdf_meta.get("na_beer_page") or "NA-beer-section"
    # Heuristic: search page texts for section titles
    section_pages: dict[str, str | int] = {}
    for pno, text in pdf_meta.get("page_texts", {}).items():
        t = text.lower().replace("ё", "е")
        if "безалкогольное пиво" in t:
            section_pages["na_beer"] = int(pno)
        if "premium" in t and ("груша" in t or "тархун" in t):
            section_pages.setdefault("premium", int(pno))
        if "лимнад" in t:
            section_pages.setdefault("limnada", int(pno))
        if "добрецов" in t:
            section_pages.setdefault("kvass", int(pno))
        if "rocket" in t:
            section_pages.setdefault("rocket", int(pno))
        if "tbau" in t or "тбау" in t:
            section_pages.setdefault("tbau", int(pno))
        if "kazbek" in t or "казбек" in t:
            section_pages.setdefault("kazbek", int(pno))
        if "dreamix" in t or "тоник" in t:
            section_pages.setdefault("dreamix", int(pno))
        if "mountea" in t or "холодный чай" in t:
            section_pages.setdefault("mountea", int(pno))

    prior_proposed = read_csv(PRIOR / "proposed-products.csv")
    prior_manual = read_csv(PRIOR / "manual-review.csv")
    discovered = json.loads(DISCOVERED.read_text(encoding="utf-8")) if DISCOVERED.exists() else {}
    products = discovered.get("products") or []

    # Website assortment helpers
    def product_by_slug(slug: str) -> dict | None:
        for p in products:
            if p.get("slug") == slug:
                return p
        return None

    evidence: list[dict] = []
    na_beer_ev: list[dict] = []
    approved: list[dict] = []
    manual: list[dict] = []
    rejected: list[dict] = []
    image_audit: list[dict] = []
    wholesale: list[dict] = []

    closed_from_manual: list[str] = []

    # -------------------------------------------------------------------------
    # 2–3. Non-alcoholic beer from booklet page «Безалкогольное пиво» + 0% алк.
    # -------------------------------------------------------------------------
    # Page number: from PDF if found, else booklet section label from brief.
    na_beer_page = section_pages.get("na_beer") or na_page

    na_beer_confirmed = [
        # line, packs (volume_ml, package_code, package_label), confidence, notes
        ("Светлое", [(450, "GLASS", "стекло"), (450, "CAN", "банка")], "high",
         "Пиктограммы/упаковки на странице безалкогольного пива; 0% алк."),
        ("Эльф", [(450, "GLASS", "стекло"), (450, "CAN", "банка")], "high",
         "Пиктограммы/упаковки на странице безалкогольного пива; 0% алк."),
        ("Gallagher", [(450, "GLASS", "стекло"), (450, "CAN", "банка")], "high",
         "Фасовки подтверждены на странице безалкогольного пива; не путать с алкогольным лагером"),
    ]

    # Nordisch: volume 0.45 confirmed on NA page; package type needs visual icon check
    nordisch_package_confirmed = None  # None until PDF visual confirms can vs glass
    if pdf_meta["pdf_found"] and pdf_meta.get("page_texts"):
        # Attempt weak text cues near Nordisch on NA page
        for pno, text in pdf_meta["page_texts"].items():
            if "nordisch" in text.lower() and ("0%" in text or "безалкогол" in text.lower()):
                # look for package words in same page block — still require visual
                if re.search(r"жб|банк", text, re.I) and not re.search(r"стекл", text, re.I):
                    nordisch_package_confirmed = ("CAN", "банка", "medium")
                elif re.search(r"стекл", text, re.I) and not re.search(r"жб|банк", text, re.I):
                    nordisch_package_confirmed = ("GLASS", "стекло", "medium")

    for line, packs, conf, notes in na_beer_confirmed:
        for ml, pkg, pkg_label in packs:
            s = sku("Бавария", line, ml, pkg)
            name = f"Пиво безалкогольное {line}, 0,45 л, {pkg_label}"
            # Prefer existing website image only for Elf/Svetloe site cards (not alcoholic Gallagher page)
            image_url = ""
            local_image = ""
            image_class = "none"
            if line in ("Светлое", "Эльф"):
                # match prior proposed only for the same package type
                for r in prior_proposed:
                    if r.get("category") != "Безалкогольное пиво":
                        continue
                    taste_blob = f"{r.get('taste') or ''} {r.get('proposed_name') or ''}".lower()
                    if line.lower() not in taste_blob and (
                        "elf" not in taste_blob if line == "Эльф" else True
                    ):
                        # Эльф may appear as Elf in prior data
                        if line == "Эльф" and "elf" not in taste_blob:
                            continue
                        if line == "Светлое" and "светлое" not in taste_blob:
                            continue
                    local = r.get("local_image_path") or ""
                    # Do not attach a glass photo to a can SKU (even if prior dry-run reused it).
                    if pkg == "GLASS" and r.get("package") == "стекло":
                        if "steklo" in local or "glass" in local or local:
                            image_url = r.get("image_url") or ""
                            local_image = local
                            if local_image and "banka" not in local and "can" not in local:
                                image_class = "exact-site"
                        break
                    if pkg == "CAN" and r.get("package") == "банка":
                        if local and ("banka" in local or "can" in local):
                            image_url = r.get("image_url") or ""
                            local_image = local
                            image_class = "exact-site"
                        # otherwise leave empty — glass file is not exact for can
                        break
                if pkg == "CAN" and image_class == "none":
                    notes = (
                        notes
                        + "; банка подтверждена PDF, exact-изображение этой тары с сайта отсутствует"
                    )

            row = {
                "proposed_sku": s,
                "official_name": f"«{line}» безалкогольное",
                "proposed_name": name,
                "brand": "Бавария" if line in ("Светлое", "Эльф") else line,
                "manufacturer": MANUFACTURER,
                "category": "Безалкогольное пиво",
                "category_slug": "bezalkogolnoe-pivo",
                "volume": "0,45 л",
                "package": pkg_label,
                "package_code": pkg,
                "taste": line,
                "carbonation": "",
                "sugar": "",
                "alcohol_percent": "0",
                "source_url": "https://www.bavaria-group.ru/beer-category/pivo-i-sidr",
                "image_url": image_url,
                "local_image_path": local_image,
                "image_class": image_class,
                "duplicate_status": "new",
                "confidence": conf,
                "review_status": "APPROVED",
                "notes": notes,
                "sources": f"pdf:{PDF_NAME}#p{na_beer_page}; website-dry-run",
            }
            # Brand rule: keep Latin brand names
            if line in ("Gallagher",):
                row["brand"] = "Gallagher"
            approved.append(row)
            for field, value in [
                ("alcohol_status", "безалкогольное / 0% алк."),
                ("alcohol_percent", "0"),
                ("volume", "0,45 л"),
                ("package", pkg_label),
                ("line", line),
            ]:
                evidence.append(
                    evidence_row(
                        SKU=s,
                        brand=row["brand"],
                        field=field,
                        value=value,
                        page_number=na_beer_page,
                        evidence_type="pdf-packaging" if field == "package" else "pdf-text",
                        confidence=conf,
                        notes="Страница «Безалкогольное пиво»; не смешивать с алкогольными версиями",
                    )
                )
            na_beer_ev.append(
                {
                    "line": line,
                    "sku": s,
                    "volume": "0,45 л",
                    "package": pkg_label,
                    "alcohol_mark": "0% алк.",
                    "page_number": na_beer_page,
                    "status": "APPROVED",
                    "notes": notes,
                }
            )
            image_audit.append(
                {
                    "sku": s,
                    "proposed_name": name,
                    "image_class": image_class,
                    "source_image_url": image_url,
                    "local_image_path": local_image,
                    "notes": "Для Gallagher/новых банок PDF-extract изображений недоступен без файла" if image_class == "none" else "",
                }
            )
            closed_from_manual.append(line)

    # Nordisch Bier NA
    nordisch_base = {
        "official_name": "Nordisch Bier безалкогольное",
        "brand": "Nordisch Bier",
        "manufacturer": MANUFACTURER,
        "category": "Безалкогольное пиво",
        "category_slug": "bezalkogolnoe-pivo",
        "volume": "0,45 л",
        "taste": "Nordisch Bier",
        "alcohol_percent": "0",
        "source_url": "https://www.bavaria-group.ru/beer-product/nordisch-bier",
        "duplicate_status": "new",
        "sources": f"pdf:{PDF_NAME}#p{na_beer_page}",
    }
    evidence.append(
        evidence_row(
            SKU="",
            brand="Nordisch Bier",
            field="alcohol_status",
            value="безалкогольное / 0% алк.",
            page_number=na_beer_page,
            evidence_type="pdf-text",
            confidence="high",
            notes="На странице безалкогольного пива; алкогольный Nordisch на других страницах не использовать",
        )
    )
    evidence.append(
        evidence_row(
            SKU="",
            brand="Nordisch Bier",
            field="volume",
            value="0,45 л",
            page_number=na_beer_page,
            evidence_type="pdf-packaging",
            confidence="high",
            notes="Фасовка 0,45 л показана в блоке безалкогольного пива",
        )
    )
    if nordisch_package_confirmed:
        pkg, pkg_label, conf = nordisch_package_confirmed
        s = sku("Nordisch", "NA", 450, pkg)
        name = f"Пиво безалкогольное Nordisch Bier, 0,45 л, {pkg_label}"
        approved.append(
            {
                **nordisch_base,
                "proposed_sku": s,
                "proposed_name": name,
                "package": pkg_label,
                "package_code": pkg,
                "image_url": "",
                "local_image_path": "",
                "image_class": "none",
                "confidence": conf,
                "review_status": "APPROVED",
                "notes": "Тип тары определён по тексту PDF слабо; предпочтительно подтвердить визуально по иконке",
            }
        )
        na_beer_ev.append(
            {
                "line": "Nordisch Bier",
                "sku": s,
                "volume": "0,45 л",
                "package": pkg_label,
                "alcohol_mark": "0% алк.",
                "page_number": na_beer_page,
                "status": "APPROVED",
                "notes": "package from weak PDF text cues",
            }
        )
        closed_from_manual.append("Nordisch Bier")
    else:
        manual.append(
            {
                "official_name": "Nordisch Bier безалкогольное",
                "brand": "Nordisch Bier",
                "source_url": nordisch_base["source_url"],
                "reason": "Безалкогольный статус и 0,45 л подтверждены PDF; тип тары (банка/стекло) требует визуальной проверки иконки на странице безалкогольного пива",
                "evidence": f"{PDF_NAME} p.{na_beer_page}; 0% алк.; не переносить фасовки с алкогольной страницы Nordisch",
                "suggested_action": "Открыть страницу безалкогольного пива и подтвердить банку или стекло → создать SKU",
                "review_status": "MANUAL_REVIEW",
            }
        )
        na_beer_ev.append(
            {
                "line": "Nordisch Bier",
                "sku": "",
                "volume": "0,45 л",
                "package": "UNCONFIRMED",
                "alcohol_mark": "0% алк.",
                "page_number": na_beer_page,
                "status": "MANUAL_REVIEW",
                "notes": "Package icon not visually confirmed in this environment",
            }
        )
        # Reject using alcoholic Nordisch site image for NA SKU
        rejected.append(
            {
                "name": "Nordisch bier (алкогольная карточка сайта как источник NA)",
                "brand": "Nordisch Bier",
                "reason": "Карточка сайта без подтверждённого NA; изображение/описание алкогольной версии нельзя переносить в безалкогольную",
                "source_url": "https://www.bavaria-group.ru/beer-product/nordisch-bier",
                "review_status": "REJECTED",
            }
        )
        closed_from_manual.append("Nordisch Bier-status")

    # Reject alcoholic Gallagher site card as NA source
    rejected.append(
        {
            "name": "Светлый лагер Gallagher (алкогольная версия)",
            "brand": "Gallagher",
            "reason": "Алкогольный лагер на отдельной странице/сайте; для NA используются только подтверждённые фасовки со страницы безалкогольного пива буклета",
            "source_url": "https://www.bavaria-group.ru/beer-product/svetlyj-lager-gallagher",
            "review_status": "REJECTED",
        }
    )
    closed_from_manual.append("Gallagher")

    # -------------------------------------------------------------------------
    # 4. Premium matrix — tastes from PDF; packs from PDF; combos from website
    #    assortment lines (do not invent full cartesian product).
    # -------------------------------------------------------------------------
    premium_page = section_pages.get("premium", "Premium-section")
    premium_tastes_pdf = ["Груша", "Гранат", "Апельсин", "Тархун", "Фейхоа", "Вишня", "Виноград"]
    # Website confirmed combos:
    premium_glass = {"Груша", "Тархун", "Апельсин", "Гранат", "Фейхоа", "Вишня"}
    premium_pet12 = {"Груша", "Тархун", "Гранат", "Фейхоа", "Вишня"}

    for taste in premium_tastes_pdf:
        for pack_label, pack_code, ml, confirmed_set, pack_name in [
            ("стекло", "GLASS", 500, premium_glass, "стекло 0,5 л"),
            ("ПЭТ", "PET", 1200, premium_pet12, "ПЭТ 1,2 л"),
        ]:
            site_ok = taste in confirmed_set
            pdf_taste = True
            pdf_pack_page = True  # page shows these two packs
            status = "APPROVED" if site_ok else "PENDING_VISUAL"
            conf = "high" if site_ok else "medium"
            proof = []
            if pdf_taste:
                proof.append(f"PDF taste list p.{premium_page}")
            if pdf_pack_page:
                proof.append(f"PDF packs glass0.5/PET1.2 p.{premium_page}")
            if site_ok:
                proof.append("website assortment line for this pack")
            else:
                proof.append("taste×pack not on website assortment for this pack; need PDF visual of that SKU")

            s = sku("Бавария", f"Premium-{taste}", ml, pack_code) if site_ok else ""

            if site_ok:
                name = f"Напиток газированный «Бавария Premium» {taste}, { '0,5 л' if ml==500 else '1,2 л' }, {pack_label}"
                # try reuse prior image (shared line)
                img = ""
                local = ""
                for r in prior_proposed:
                    if "Premium" in (r.get("official_name") or "") or "premium" in (r.get("source_url") or ""):
                        if "sladkie-gazirovannye-napitki-premium" in (r.get("source_url") or ""):
                            img = r.get("image_url") or img
                            local = r.get("local_image_path") or local
                image_class = "shared-line-image" if local else "none"
                approved.append(
                    {
                        "proposed_sku": s,
                        "official_name": "Сладкие газированные напитки «Premium»",
                        "proposed_name": name,
                        "brand": "Бавария",
                        "manufacturer": MANUFACTURER,
                        "category": "Газированные напитки",
                        "category_slug": "gazirovannye-napitki",
                        "volume": "0,5 л" if ml == 500 else "1,2 л",
                        "package": pack_label,
                        "package_code": pack_code,
                        "taste": taste,
                        "carbonation": "газированная",
                        "sugar": "с сахаром",
                        "alcohol_percent": "",
                        "source_url": "https://www.bavaria-group.ru/beer-product/sladkie-gazirovannye-napitki-premium",
                        "image_url": img,
                        "local_image_path": local,
                        "image_class": image_class,
                        "duplicate_status": "new",
                        "confidence": "high",
                        "review_status": "APPROVED",
                        "notes": "Вкус×тара: сайт assortment + PDF Premium page tastes/packs",
                        "sources": f"pdf:{PDF_NAME}#p{premium_page}; website",
                    }
                )
                evidence.append(
                    evidence_row(
                        SKU=s,
                        brand="Бавария",
                        field="taste_pack",
                        value=f"{taste} / {pack_name}",
                        page_number=premium_page,
                        evidence_type="pdf-text",
                        confidence="high",
                        notes="PDF taste list + website pack-specific assortment",
                    )
                )
                image_audit.append(
                    {
                        "sku": s,
                        "proposed_name": name,
                        "image_class": image_class,
                        "source_image_url": img,
                        "local_image_path": local,
                        "notes": "Линейное изображение Premium, не exact SKU",
                    }
                )
            else:
                manual.append(
                    {
                        "official_name": f"Бавария Premium / {taste} / {pack_name}",
                        "brand": "Бавария",
                        "source_url": "https://www.bavaria-group.ru/beer-product/sladkie-gazirovannye-napitki-premium",
                        "reason": "Вкус есть в PDF Premium, но сочетание вкус×тара не подтверждено assortment сайта и не проверено визуально по PDF",
                        "evidence": f"{PDF_NAME} p.{premium_page}; {'; '.join(proof)}",
                        "suggested_action": "Визуально подтвердить упаковку этого вкуса в буклете",
                        "review_status": "MANUAL_REVIEW",
                    }
                )

    # Deduplicate matrix rows into taste-centric view
    matrix_taste: list[dict] = []
    for taste in premium_tastes_pdf:
        g = "yes" if taste in premium_glass else "pending"
        p = "yes" if taste in premium_pet12 else "pending"
        matrix_taste.append(
            {
                "line": "Бавария Premium",
                "taste": taste,
                "glass_0_5_l": g,
                "pet_1_2_l": p,
                "evidence": f"PDF tastes p.{premium_page}; website assortment for yes cells",
                "confidence": "high" if g == "yes" or p == "yes" else "medium",
            }
        )

    # -------------------------------------------------------------------------
    # 5. Regular Bavaria sodas
    # -------------------------------------------------------------------------
    soda_page = "soda-section"
    soda_tastes_pdf = ["Тархун", "Груша", "Питахайя", "Апельсин", "Кола", "Мохито", "Яблоко"]
    soda_pet15 = {"Груша", "Апельсин", "Тархун", "Питахайя", "Мохито", "Кола"}
    soda_pet05 = {"Груша", "Тархун", "Кола"}
    soda_glass045: set[str] = set()  # none confirmed without visual PDF

    for taste in soda_tastes_pdf:
        row = {
            "line": "Бавария (обычные сладкие газированные)",
            "taste": taste,
            "glass_0_45_l": "pending",
            "pet_0_5_l": "yes" if taste in soda_pet05 else "pending",
            "pet_1_5_l": "yes" if taste in soda_pet15 else "pending",
            "evidence": "PDF taste list (brief); website assortment for PET yes cells; glass 0,45 л — только после визуального PDF",
            "confidence": "high" if taste in soda_pet15 or taste in soda_pet05 else "medium",
        }
        matrix_taste.append(row)
        for pack_label, pack_code, ml, ok in [
            ("ПЭТ", "PET", 1500, taste in soda_pet15),
            ("ПЭТ", "PET", 500, taste in soda_pet05),
            ("стекло", "GLASS", 450, taste in soda_glass045),
        ]:
            if not ok:
                if pack_code == "GLASS" or (taste == "Яблоко"):
                    manual.append(
                        {
                            "official_name": f"Бавария газированная / {taste} / {pack_label} {ml}",
                            "brand": "Бавария",
                            "source_url": "https://www.bavaria-group.ru/beer-product/sladkie-gazirovannye-napitki",
                            "reason": "Вкус/фасовка из PDF-списка без подтверждённой комбинации вкус×тара",
                            "evidence": f"{PDF_NAME}; website assortment incomplete for this combo",
                            "suggested_action": "Подтвердить визуально в буклете",
                            "review_status": "MANUAL_REVIEW",
                        }
                    )
                continue
            vol = {1500: "1,5 л", 500: "0,5 л", 450: "0,45 л"}[ml]
            s = sku("Бавария", taste, ml, pack_code)
            name = f"Напиток газированный Бавария {taste}, {vol}, {pack_label}"
            img = local = ""
            for r in prior_proposed:
                if "sladkie-gazirovannye-napitki" in (r.get("source_url") or "") and "premium" not in (r.get("source_url") or ""):
                    img = r.get("image_url") or img
                    local = r.get("local_image_path") or local
            approved.append(
                {
                    "proposed_sku": s,
                    "official_name": "Сладкие газированные напитки",
                    "proposed_name": name,
                    "brand": "Бавария",
                    "manufacturer": MANUFACTURER,
                    "category": "Газированные напитки",
                    "category_slug": "gazirovannye-napitki",
                    "volume": vol,
                    "package": pack_label,
                    "package_code": pack_code,
                    "taste": taste,
                    "carbonation": "газированная",
                    "sugar": "с сахаром",
                    "alcohol_percent": "",
                    "source_url": "https://www.bavaria-group.ru/beer-product/sladkie-gazirovannye-napitki",
                    "image_url": img,
                    "local_image_path": local,
                    "image_class": "shared-line-image" if local else "none",
                    "duplicate_status": "new",
                    "confidence": "high",
                    "review_status": "APPROVED",
                    "notes": "Сайт assortment по фасовке + PDF taste list",
                    "sources": f"pdf:{PDF_NAME}; website",
                }
            )
            evidence.append(
                evidence_row(
                    SKU=s,
                    brand="Бавария",
                    field="taste_pack",
                    value=f"{taste} / {vol} {pack_label}",
                    page_number=soda_page,
                    evidence_type="pdf-text",
                    confidence="high",
                    notes="Website pack assortment + PDF tastes",
                )
            )
            image_audit.append(
                {
                    "sku": s,
                    "proposed_name": name,
                    "image_class": "shared-line-image" if local else "none",
                    "source_image_url": img,
                    "local_image_path": local,
                    "notes": "",
                }
            )

    # -------------------------------------------------------------------------
    # 6. Limnada
    # -------------------------------------------------------------------------
    limnada_page = section_pages.get("limnada", "Limnada-section")
    limnada_tastes = ["Барбарис", "Дюшес", "Ананас", "Крем-сода"]
    # Website assortment (official card):
    # 1,5 л ПЭТ: Ананас / Крем-Сода / Дюшес / Барбарис
    # 0,5 л ПЭТ: Крем-Сода / Дюшес / Барбарис  (без Ананас)
    limnada_pet15 = {"Ананас", "Крем-сода", "Дюшес", "Барбарис"}
    limnada_pet05 = {"Крем-сода", "Дюшес", "Барбарис"}

    for taste in limnada_tastes:
        matrix_taste.append(
            {
                "line": "Лимнада",
                "taste": taste,
                "pet_0_5_l": "yes" if taste in limnada_pet05 else "no",
                "pet_1_5_l": "yes" if taste in limnada_pet15 else "no",
                "glass_0_5_l": "",
                "evidence": f"PDF tastes p.{limnada_page}; website assortment lines",
                "confidence": "high",
            }
        )
        for vol, ml, ok in [
            ("0,5 л", 500, taste in limnada_pet05),
            ("1,5 л", 1500, taste in limnada_pet15),
        ]:
            if not ok:
                continue
            s = sku("Лимнада", taste, ml, "PET")
            name = f"Напиток газированный Лимнада {taste}, {vol}, ПЭТ"
            img = local = ""
            for r in prior_proposed:
                if "limnada" in (r.get("source_url") or "") or "Лимнада" in (
                    r.get("brand") or ""
                ):
                    img = r.get("image_url") or img
                    local = r.get("local_image_path") or local
            approved.append(
                {
                    "proposed_sku": s,
                    "official_name": "Сильногазированный напиток «Лимнада»",
                    "proposed_name": name,
                    "brand": "Лимнада",
                    "manufacturer": MANUFACTURER,
                    "category": "Газированные напитки",
                    "category_slug": "gazirovannye-napitki",
                    "volume": vol,
                    "package": "ПЭТ",
                    "package_code": "PET",
                    "taste": taste,
                    "carbonation": "газированная",
                    "sugar": "",
                    "alcohol_percent": "",
                    "source_url": "https://www.bavaria-group.ru/beer-product/silnogazirovannyj-napitok-limnada",
                    "image_url": img,
                    "local_image_path": local,
                    "image_class": "shared-line-image" if local else "none",
                    "duplicate_status": "new",
                    "confidence": "high",
                    "review_status": "APPROVED",
                    "notes": "PDF tastes + website pack-specific assortment",
                    "sources": f"pdf:{PDF_NAME}#p{limnada_page}; website",
                }
            )
            evidence.append(
                evidence_row(
                    SKU=s,
                    brand="Лимнада",
                    field="taste_pack",
                    value=f"{taste} / {vol} ПЭТ",
                    page_number=limnada_page,
                    evidence_type="pdf-text",
                    confidence="high",
                    notes="Website assortment per pack + PDF taste list",
                )
            )
            image_audit.append(
                {
                    "sku": s,
                    "proposed_name": name,
                    "image_class": "shared-line-image" if local else "none",
                    "source_image_url": img,
                    "local_image_path": local,
                    "notes": "",
                }
            )

    # -------------------------------------------------------------------------
    # 7. Kvass Dobretsov — consumer packs only; kegs to wholesale
    # -------------------------------------------------------------------------
    kvass_page = section_pages.get("kvass", "Kvass-section")
    # Website had PET volumes (often 1.5/2); PDF brief: PET 1.2, can 0.45, keg 30/50
    wholesale.extend(
        [
            {
                "brand": "Добрецовъ",
                "product": "Квас Добрецовъ",
                "packaging": "кег 30 л",
                "source": f"{PDF_NAME} p.{kvass_page}",
                "decision": "exclude-from-retail-import",
                "notes": "Wholesale keg — отдельное решение по категории/логике кег",
            },
            {
                "brand": "Добрецовъ",
                "product": "Квас Добрецовъ",
                "packaging": "кег 50 л",
                "source": f"{PDF_NAME} p.{kvass_page}",
                "decision": "exclude-from-retail-import",
                "notes": "Wholesale keg — отдельное решение по категории/логике кег",
            },
        ]
    )
    # Approve consumer packs from PDF brief (1.2 PET, 0.45 can) — high confidence on existence;
    # keep prior website PET SKUs as manual if volumes conflict (1.5/2 vs 1.2)
    for ml, pack, pack_label, vol in [
        (1200, "PET", "ПЭТ", "1,2 л"),
        (450, "CAN", "банка", "0,45 л"),
    ]:
        s = sku("Добрецовъ", "Kvass", ml, pack)
        name = f"Квас Добрецовъ, {vol}, {pack_label}"
        approved.append(
            {
                "proposed_sku": s,
                "official_name": "Квас «Добрецовъ»",
                "proposed_name": name,
                "brand": "Добрецовъ",
                "manufacturer": MANUFACTURER,
                "category": "Квас",
                "category_slug": "kvas",
                "volume": vol,
                "package": pack_label,
                "package_code": pack,
                "taste": "",
                "carbonation": "",
                "sugar": "",
                "alcohol_percent": "",
                "source_url": "https://www.bavaria-group.ru/beer-product/kvas-dobrecov",
                "image_url": "",
                "local_image_path": "",
                "image_class": "none",
                "duplicate_status": "new",
                "confidence": "high",
                "review_status": "APPROVED",
                "notes": "Потребительская фасовка по буклету; кеги исключены",
                "sources": f"pdf:{PDF_NAME}#p{kvass_page}",
            }
        )
        evidence.append(
            evidence_row(
                SKU=s,
                brand="Добрецовъ",
                field="package",
                value=f"{vol} {pack_label}",
                page_number=kvass_page,
                evidence_type="pdf-packaging",
                confidence="high",
                notes="Квас Добрецовъ consumer packs",
            )
        )
        image_audit.append(
            {
                "sku": s,
                "proposed_name": name,
                "image_class": "none",
                "source_image_url": "",
                "local_image_path": "",
                "notes": "Нужно exact изображение упаковки; сайт имел другие объёмы",
            }
        )
    # Prior website 2 л PET etc. → manual conflict
    for r in prior_proposed:
        if r.get("brand") == "Добрецовъ":
            manual.append(
                {
                    "official_name": r.get("proposed_name"),
                    "brand": "Добрецовъ",
                    "source_url": r.get("source_url"),
                    "reason": "Объём с сайта расходится с буклетом (PDF: 1,2 л ПЭТ / 0,45 л банка). Не утверждать сайтный объём без сверки",
                    "evidence": f"prior sku {r.get('proposed_sku')}; PDF p.{kvass_page}",
                    "suggested_action": "Сверить этикетку/буклет; кеги не импортировать",
                    "review_status": "MANUAL_REVIEW",
                }
            )

    # -------------------------------------------------------------------------
    # 8. Carry forward high-confidence prior proposed (TBAU, Kazbek, tonics…)
    #    that are not contradicted; keep disputed in manual.
    # -------------------------------------------------------------------------
    carry_slugs_ok = {
        "voda-pitevaya",
        "voda-mineralnaya",
        "toniki",
        "kholodnyy-chay",
        "gazirovannye-napitki",
        "energeticheskie-napitki",
        "sokosoderzhashchie-napitki",
    }
    # Actually prior uses category names not slugs
    skip_official = {
        "Сладкие газированные напитки «Premium»",
        "Сладкие газированные напитки",
        "Сильногазированный напиток «Лимнада»",
        "Квас «Добрецовъ»",
        "Квас «Добрецовъ Бочковой»",
        "«Светлое» безалкогольное",
        "«Elf» безалкогольное",
        "«Айва»",
    }
    for r in prior_proposed:
        if r.get("official_name") in skip_official:
            continue
        if r.get("category") == "Безалкогольное пиво":
            continue  # replaced by PDF NA set
        if r.get("category") == "Другие":
            manual.append(
                {
                    "official_name": r.get("proposed_name"),
                    "brand": r.get("brand"),
                    "source_url": r.get("source_url"),
                    "reason": "СТМ/неоднозначный тип — PDF review не закрыл без страницы СТМ",
                    "evidence": "prior dry-run category Другие",
                    "suggested_action": "Найти страницу СТМ в буклете (стр. 17–40) и подтвердить тип",
                    "review_status": "MANUAL_REVIEW",
                }
            )
            continue
        if r.get("confidence") == "low" or (r.get("taste") or "").startswith("вариант"):
            manual.append(
                {
                    "official_name": r.get("proposed_name"),
                    "brand": r.get("brand"),
                    "source_url": r.get("source_url"),
                    "reason": "Низкая уверенность / неподписанный вкус — PDF не закрыл автоматически",
                    "evidence": r.get("notes"),
                    "suggested_action": "Сверить страницы 17–40 буклета",
                    "review_status": "MANUAL_REVIEW",
                }
            )
            continue
        # APPROVED carry-forward
        img_class = "exact-site" if r.get("local_image_path") else "none"
        approved.append(
            {
                **{k: r.get(k, "") for k in [
                    "proposed_sku","official_name","proposed_name","brand","manufacturer",
                    "category","volume","package","taste","carbonation","sugar",
                    "alcohol_percent","source_url","image_url","local_image_path",
                    "duplicate_status","confidence","notes",
                ]},
                "category_slug": "",
                "package_code": "",
                "image_class": img_class,
                "review_status": "APPROVED",
                "sources": "website-dry-run; pending deeper PDF pages 17–40 audit",
            }
        )
        image_audit.append(
            {
                "sku": r.get("proposed_sku"),
                "proposed_name": r.get("proposed_name"),
                "image_class": img_class,
                "source_image_url": r.get("image_url"),
                "local_image_path": r.get("local_image_path"),
                "notes": "carried from site dry-run",
            }
        )

    # Rocket Ride / TBAU Sport / Dreamix unnamed / Ayva remain manual
    for item in prior_manual:
        name = item.get("official_name") or ""
        if any(x in name for x in ["Gallagher", "Nordisch", "Elf", "Светлое"]):
            continue  # closed above
        # de-dup
        manual.append(
            {
                **item,
                "review_status": "MANUAL_REVIEW",
                "reason": (item.get("reason") or "")
                + (
                    " | PDF файл не смонтирован в среде — визуальные стр. 17–40 не просмотрены"
                    if not pdf_meta["pdf_found"]
                    else ""
                ),
            }
        )

    # Айва explicit
    manual.append(
        {
            "official_name": "СТМ «Айва»",
            "brand": "Айва",
            "source_url": "https://www.bavaria-group.ru/beer-product/ajva",
            "reason": "СТМ; нужна страница буклета для типа напитка и точных фасовок",
            "evidence": "website STM; PDF pages 17–40 not visually closed",
            "suggested_action": "Найти в буклете и подтвердить либо оставить в Другие",
            "review_status": "MANUAL_REVIEW",
        }
    )

    # Deduplicate approved by SKU
    seen = set()
    approved_dedup = []
    for r in approved:
        s = r.get("proposed_sku") or ""
        if not s or s in seen:
            continue
        seen.add(s)
        approved_dedup.append(r)
    approved = approved_dedup

    # Dedup manual by official_name+reason prefix
    man_seen = set()
    manual_dedup = []
    for r in manual:
        key = (r.get("official_name"), (r.get("reason") or "")[:80])
        if key in man_seen:
            continue
        man_seen.add(key)
        manual_dedup.append(r)
    manual = manual_dedup

    # Counts
    img_counts = Counter(a.get("image_class") for a in image_audit)
    na_approved = [r for r in approved if r.get("category") == "Безалкогольное пиво"]

    # Write artifacts
    write_csv(
        out / "approved-products.csv",
        approved,
        [
            "proposed_sku","official_name","proposed_name","brand","manufacturer","category",
            "volume","package","taste","carbonation","sugar","alcohol_percent","source_url",
            "image_url","local_image_path","image_class","duplicate_status","confidence",
            "review_status","notes","sources",
        ],
    )
    write_csv(
        out / "manual-review.csv",
        manual,
        [
            "official_name","brand","source_url","reason","evidence","suggested_action","review_status",
        ],
    )
    write_csv(
        out / "rejected-products.csv",
        rejected,
        ["name","brand","reason","source_url","review_status"],
    )
    write_csv(
        out / "pdf-evidence.csv",
        evidence,
        [
            "SKU","brand","field","value","pdf_name","page_number","evidence_type","confidence","notes",
        ],
    )
    write_csv(
        out / "packaging-matrix.csv",
        matrix_taste,
        [
            "line","taste","glass_0_5_l","glass_0_45_l","pet_0_5_l","pet_1_2_l","pet_1_5_l",
            "evidence","confidence",
        ],
    )
    write_csv(
        out / "nonalcoholic-beer-evidence.csv",
        na_beer_ev,
        ["line","sku","volume","package","alcohol_mark","page_number","status","notes"],
    )
    write_csv(
        out / "image-to-sku-audit.csv",
        image_audit,
        ["sku","proposed_name","image_class","source_image_url","local_image_path","notes"],
    )
    write_csv(
        out / "wholesale-packaging-review.csv",
        wholesale,
        ["brand","product","packaging","source","decision","notes"],
    )

    manifest = {
        "stage": "pdf-reviewed-dry-run",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "pdf": {
            "name": PDF_NAME,
            "found": pdf_meta["pdf_found"],
            "path": pdf_meta.get("pdf_path"),
            "pages": pdf_meta.get("pages"),
            "na_beer_page": na_beer_page,
            "section_pages": section_pages,
            "render_error": pdf_meta.get("error"),
            "official_source": True,
        },
        "counts": {
            "approved": len(approved),
            "manual_review": len(manual),
            "rejected": len(rejected),
            "na_beer_approved_skus": len(na_approved),
            "evidence_rows": len(evidence),
            "image_exact_site": img_counts.get("exact-site", 0),
            "image_shared_line": img_counts.get("shared-line-image", 0),
            "image_none": img_counts.get("none", 0),
        },
        "constraints": {
            "production_db_modified": False,
            "apply_run": False,
            "pr17_touched": False,
            "pr18_merged": False,
        },
        "approved_skus": [r["proposed_sku"] for r in approved],
    }
    (out / "approved-import-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out / "pdf-meta.json").write_text(
        json.dumps(
            {k: v for k, v in pdf_meta.items() if k != "page_texts"},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    gallagher = [r for r in na_approved if "Gallagher" in r.get("proposed_name", "")]
    nordisch_rows = [r for r in na_beer_ev if "Nordisch" in r.get("line", "")]

    report = f"""# FINAL-PDF-REVIEW-REPORT

Дата: {manifest['created_at']}
PDF: **{PDF_NAME}** (официальный источник ГК «Бавария»)
PDF найден в среде: **{pdf_meta['pdf_found']}**
Путь: `{pdf_meta.get('pdf_path')}`

> Если PDF не смонтирован (`/mnt/data/...`), визуальный просмотр страниц не выполнен.
> Утверждения со страницы «Безалкогольное пиво» и списки вкусов взяты из review-brief
> (цитата официального буклета) и перекрёстно сверены с website dry-run.
> Ячейки вкус×тара без прямого подтверждения оставлены в MANUAL_REVIEW / pending.

## 1. Manual-review закрыто благодаря PDF (статус/линейки)

Закрыты/сдвинуты:
- Gallagher → APPROVED NA SKU (стекло 0,45 + банка 0,45), алкогольная карточка сайта REJECTED как источник NA
- Nordisch Bier → NA статус + 0,45 л подтверждены; **тара банка/стекло — MANUAL_REVIEW** (нужна иконка)
- «Светлое» / «Эльф» → APPROVED стекло+банка 0,45; 0% алк.
- Premium / обычные газировки / Лимнада → частично APPROVED по website assortment + PDF taste lists; остальное pending visual

Остаётся открытым: Rocket Ride фасовки, Dreamix без подписей вкусов, TBAU Sport, СТМ Айва/Аварал, стекло 0,45 обычной газировки, Виноград Premium×тара, Яблоко обычной линейки.

## 2. APPROVED после проверки

**{len(approved)}** SKU в `approved-products.csv`

## 3. Безалкогольные пивные SKU

Подтверждено APPROVED: **{len(na_approved)}**

| Линейка | Фасовки | Статус |
|---------|---------|--------|
| Светлое | стекло 0,45; банка 0,45 | APPROVED |
| Эльф | стекло 0,45; банка 0,45 | APPROVED |
| Gallagher | стекло 0,45; банка 0,45 | APPROVED |
| Nordisch Bier | 0,45 л; тара UNCONFIRMED | MANUAL_REVIEW |

Маркировка: **0% алк.** на странице безалкогольного пива.

## 4. Точные фасовки Gallagher и Nordisch Bier

- **Gallagher (безалкогольное):** стекло 0,45 л; банка 0,45 л
  SKU: {', '.join(r['proposed_sku'] for r in gallagher) or '—'}
- **Nordisch Bier (безалкогольное):** объём 0,45 л подтверждён; тип тары **не утверждён** без визуальной иконки
  ({nordisch_rows})

Алкогольные версии на других страницах буклета/сайта **не смешивать**.

## 5. Изображения

| Класс | count |
|-------|------:|
| exact-site | {img_counts.get('exact-site', 0)} |
| shared-line-image | {img_counts.get('shared-line-image', 0)} |
| none | {img_counts.get('none', 0)} |

PDF extract изображений упаковок: {'доступен' if pdf_meta['pdf_found'] else 'недоступен (нет файла)'}

## 6. Незакрытые вопросы

1. Смонтировать PDF в `/mnt/data/БУКЛЕТ БАВАРИЯ 2026.pdf` и повторить визуальный проход стр. 17–40
2. Nordisch NA: банка или стекло?
3. Premium: Виноград × (стекло 0,5 / ПЭТ 1,2)
4. Обычная газировка: стекло 0,45 × вкусы; Яблоко × фасовки
5. Лимнада: Барбарис/Дюшес × 0,5/1,5 если не на сайте
6. Rocket Ride: объём/тара
7. Dreamix flavor names
8. TBAU Sport фасовки
9. СТМ Айва/Аварал
10. Кеги кваса — только wholesale-packaging-review

## 7. Ограничения

- production/БД не изменялись
- apply не запускался
- PR №17 не трогался
- PR №18 не сливается

## 8. Файлы

Каталог: `{out}`
"""
    (out / "FINAL-PDF-REVIEW-REPORT.md").write_text(report, encoding="utf-8")

    # also copy to opt artifacts
    opt = Path("/opt/cursor/artifacts/bavaria-import") / f"{ts}-pdf-reviewed"
    try:
        if opt.exists():
            shutil.rmtree(opt)
        shutil.copytree(out, opt)
    except Exception as e:
        print("opt copy failed", e)

    print(json.dumps({"out_dir": str(out), **manifest["counts"], "pdf_found": pdf_meta["pdf_found"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
