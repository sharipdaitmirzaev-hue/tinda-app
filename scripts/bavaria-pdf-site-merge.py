#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge official website dry-run with visual PDF booklet evidence.

Requires:
  artifacts/bavaria-import/pdf-source/BAVARIA-CATALOG-2026.pdf
  latest-pdf-ingest with sha256 + OCR/renders

Does NOT touch production / apply.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "artifacts/bavaria-import/pdf-source/BAVARIA-CATALOG-2026.pdf"
DRY = ROOT / "artifacts/bavaria-import/2026-07-31T10-52-18-371Z"
PREV = ROOT / "artifacts/bavaria-import/latest-pdf-reviewed"
INGEST = ROOT / "artifacts/bavaria-import/latest-pdf-ingest"

CYR = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slug(value: str, max_len: int = 24) -> str:
    out = []
    for ch in value.strip().lower().replace("ё", "е"):
        if re.match(r"[a-z0-9]", ch):
            out.append(ch)
        elif ch in CYR:
            out.append(CYR[ch])
        elif re.match(r"[\s_\-./\\,+&'«»\"()]", ch):
            out.append("-")
    s = re.sub(r"-+", "-", "".join(out)).strip("-").upper() or "X"
    return s[:max_len].rstrip("-") or "X"


def sku(brand: str, product: str, ml: int, pkg: str) -> str:
    vol = str(ml)
    pkg = pkg.upper()
    prefix = "BAVARIA"
    budget = 64 - len(f"{prefix}-{vol}-{pkg}") - 2
    bb = max(4, min(18, budget * 2 // 5))
    pb = max(4, budget - bb)
    return f"{prefix}-{slug(brand, bb)}-{slug(product, pb)}-{vol}-{pkg}"[:64].rstrip("-")


def vol_label(ml: int) -> str:
    if ml % 1000 == 0:
        return f"{ml // 1000} л"
    return f"{ml/1000:.2f}".rstrip("0").rstrip(".").replace(".", ",") + " л"


def pkg_label(code: str) -> str:
    return {"PET": "ПЭТ", "GLASS": "стекло", "CAN": "банка", "KEG": "кег"}[code]


@dataclass
class Row:
    status: str
    proposed_sku: str
    official_name: str
    proposed_name: str
    brand: str
    manufacturer: str
    category: str
    category_reason: str
    volume: str
    package: str
    taste: str
    carbonation: str
    sugar: str
    alcohol_percent: str
    source_url: str
    image_url: str
    local_image_path: str
    duplicate_status: str
    confidence: str
    notes: str
    decision_reason: str
    evidence_summary: str
    image_match: str
    volume_ml: int = 0
    package_code: str = ""
    pdf_page: str = ""
    source_site: str = ""
    source_pdf: str = ""


def make(
    *,
    status: str,
    brand: str,
    category: str,
    taste: str,
    ml: int,
    pkg: str,
    name: str,
    reason: str,
    evidence: str,
    official: str = "",
    url: str = "https://www.bavaria-group.ru",
    image: str = "",
    alcohol: str = "",
    carbonation: str = "",
    sugar: str = "",
    confidence: str = "high",
    image_match: str = "shared-line-image",
    pdf_page: str = "",
    source_site: str = "",
    source_pdf: str = "",
    product_key: str | None = None,
) -> Row:
    code = pkg
    return Row(
        status=status,
        proposed_sku=sku(brand, product_key or taste or name, ml, code),
        official_name=official or name,
        proposed_name=name,
        brand=brand,
        manufacturer="ГК ПД «Бавария»",
        category=category,
        category_reason=reason,
        volume=vol_label(ml) if ml else "",
        package=pkg_label(code) if code != "KEG" else "кег",
        taste=taste,
        carbonation=carbonation,
        sugar=sugar,
        alcohol_percent=alcohol,
        source_url=url,
        image_url=image,
        local_image_path="",
        duplicate_status="new",
        confidence=confidence,
        notes="",
        decision_reason=reason,
        evidence_summary=evidence,
        image_match=image_match,
        volume_ml=ml,
        package_code=code,
        pdf_page=pdf_page,
        source_site=source_site,
        source_pdf=source_pdf,
    )


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_site_urls() -> dict[str, str]:
    disc = json.loads((DRY / "discovered.json").read_text(encoding="utf-8"))
    out = {}
    for p in disc["products"]:
        out[(p.get("official_name") or "").lower()] = p.get("url") or ""
    return out


def build_rows(pdf_sha: str) -> tuple[list[Row], list[dict], list[dict]]:
    urls = load_site_urls()
    rows: list[Row] = []
    evidence: list[dict] = []
    conflicts: list[dict] = []

    def ev(sku_, field, value, page, etype, notes=""):
        evidence.append(
            {
                "sku": sku_,
                "brand": "",
                "field": field,
                "value": value,
                "pdf_name": "BAVARIA-CATALOG-2026.pdf",
                "page_number": page,
                "evidence_type": etype,
                "confidence": "high",
                "notes": notes,
                "pdf_sha256": pdf_sha,
            }
        )

    # -------- NA beer p.11 --------
    na_site = {
        "Светлое": "https://www.bavaria-group.ru/beer-product/svetloe-bezalkogolnoe",
        "Elf": "https://www.bavaria-group.ru/beer-product/elf-bezalkogolnoe",
        "Gallagher": "",  # alcohol twin on site — NA only from PDF
        "Nordisch Bier": "",
    }
    na = [
        ("Светлое", "Svetloe", 450, "GLASS"),
        ("Светлое", "Svetloe", 450, "CAN"),
        ("Elf", "Elf", 450, "GLASS"),
        ("Elf", "Elf", 450, "CAN"),
        ("Gallagher", "Gallagher-NA", 450, "GLASS"),
        ("Gallagher", "Gallagher-NA", 450, "CAN"),
        ("Nordisch Bier", "Nordisch-NA", 450, "CAN"),  # only CAN icon; bottle is product photo
    ]
    for taste, key, ml, pkg in na:
        site_url = na_site.get(taste) or ""
        name = f"Пиво безалкогольное Бавария {taste}, {vol_label(ml)}, {pkg_label(pkg)}"
        r = make(
            status="approved",
            brand="Бавария",
            category="Безалкогольное пиво",
            taste=taste,
            ml=ml,
            pkg=pkg,
            name=name,
            reason="PDF p.11 «Безалкогольное пиво» + штамп 0% Алк.; фасовка по пиктограммам",
            evidence="pdf-image p.11 + site NA cards where present",
            alcohol="0",
            url=site_url or "https://www.bavaria-group.ru",
            pdf_page="11",
            source_site="site NA card" if site_url else "",
            source_pdf="p.11 Безалкогольное пиво, 0% Алк., pack icons",
            product_key=key,
            image_match="exact",
        )
        rows.append(r)
        ev(r.proposed_sku, "non_alcoholic_status", "0% алк.", "11", "pdf-image")
        ev(r.proposed_sku, "package", f"{pkg_label(pkg)} {vol_label(ml)}", "11", "pdf-packaging")

    rows.append(
        make(
            status="manual",
            brand="Бавария",
            category="Безалкогольное пиво",
            taste="Nordisch Bier",
            ml=450,
            pkg="GLASS",
            name="Пиво безалкогольное Бавария Nordisch Bier, 0,45 л, стекло",
            reason="На p.11 есть фото бутылки, но пиктограмма только CAN 0,45 — стекло не утверждаем",
            evidence="pdf-image p.11 bottle photo vs CAN-only icon",
            alcohol="0",
            pdf_page="11",
            confidence="medium",
            product_key="Nordisch-NA",
            source_pdf="p.11 bottle photo without GL icon",
        )
    )

    # Reject alcoholic twins as NA sources + superseded site 1.4 kvass mid volume
    for name, url, key in [
        ("Светлый лагер Gallagher (алкогольная карточка)", "https://www.bavaria-group.ru/beer-product/svetlyj-lager-gallagher", "REJECT-GALLAGHER-ALC"),
        ("Nordisch bier алкогольная карточка сайта", "https://www.bavaria-group.ru/beer-product/nordisch-bier", "REJECT-NORDISCH-ALC"),
        ("Пиво Бавария Elf светлое фильтрованное (алкоголь)", "https://www.bavaria-group.ru/beer-product/pivo-bavaria-elf-svetloe-filtrovannoe", "REJECT-ELF-ALC"),
    ]:
        rows.append(
            make(
                status="rejected",
                brand="Бавария",
                category="—",
                taste=name,
                ml=450,
                pkg="GLASS",
                name=name,
                reason="Алкогольная версия / не источник для NA SKU",
                evidence="site ABV or separate alcoholic product card",
                url=url,
                product_key=key,
            )
        )

    # -------- Premium p.14 --------
    premium_glass = ["Груша", "Гранат", "Апельсин", "Тархун", "Фейхоа", "Вишня", "Виноград"]
    premium_pet = ["Груша", "Тархун", "Гранат", "Фейхоа", "Вишня", "Виноград"]  # no Апельсин in PET visuals
    for taste in premium_glass:
        r = make(
            status="approved",
            brand="Бавария",
            category="Газированные напитки",
            taste=taste,
            ml=500,
            pkg="GLASS",
            name=f"Напиток газированный Бавария Premium {taste}, 0,5 л, стекло",
            reason="PDF p.14: все 7 вкусов показаны в стекле 0,5",
            evidence="pdf-image p.14 glass row",
            carbonation="газированная",
            url="https://www.bavaria-group.ru/beer-product/sladkie-gazirovannye-napitki-premium",
            pdf_page="14",
            source_site="site Premium assortment стекло 0,5",
            source_pdf="p.14 glass row + GL 0,5 icon",
            product_key=f"Premium-{taste}",
        )
        rows.append(r)
    for taste in premium_pet:
        r = make(
            status="approved",
            brand="Бавария",
            category="Газированные напитки",
            taste=taste,
            ml=1200,
            pkg="PET",
            name=f"Напиток газированный Бавария Premium {taste}, 1,2 л, ПЭТ",
            reason="PDF p.14: вкус показан в ПЭТ 1,2",
            evidence="pdf-image p.14 PET row",
            carbonation="газированная",
            url="https://www.bavaria-group.ru/beer-product/sladkie-gazirovannye-napitki-premium",
            pdf_page="14",
            source_site="site Premium assortment ПЭТ 1,2",
            source_pdf="p.14 PET row + PET 1,2 icon",
            product_key=f"Premium-{taste}",
        )
        rows.append(r)
    rows.append(
        make(
            status="rejected",
            brand="Бавария",
            category="Газированные напитки",
            taste="Апельсин",
            ml=1200,
            pkg="PET",
            name="Напиток газированный Бавария Premium Апельсин, 1,2 л, ПЭТ",
            reason="На p.14 Апельсин есть в стекле, но отсутствует в ряду ПЭТ 1,2",
            evidence="pdf-image p.14",
            product_key="Premium-Apelsin",
            pdf_page="14",
        )
    )

    # -------- Regular soda p.15 --------
    # Visual confirmed combos only
    regular = [
        # glass 0.45 shown
        ("Мохито", 450, "GLASS"),
        ("Питахайя", 450, "GLASS"),
        ("Тархун", 450, "GLASS"),
        ("Груша", 450, "GLASS"),
        # pet 0.5 shown
        ("Тархун", 500, "PET"),
        ("Груша", 500, "PET"),
        ("Кола", 500, "PET"),
        # pet 1.5 shown
        ("Апельсин", 1500, "PET"),
        ("Тархун", 1500, "PET"),
        ("Груша", 1500, "PET"),
        ("Питахайя", 1500, "PET"),
        ("Кола", 1500, "PET"),
        ("Мохито", 1500, "PET"),
        ("Яблоко", 1500, "PET"),
    ]
    for taste, ml, pkg in regular:
        rows.append(
            make(
                status="approved",
                brand="Бавария",
                category="Газированные напитки",
                taste=taste,
                ml=ml,
                pkg=pkg,
                name=f"Напиток газированный Бавария {taste}, {vol_label(ml)}, {pkg_label(pkg)}",
                reason="PDF p.15 визуально подтверждённая комбинация вкус×тара",
                evidence="pdf-image p.15 + site assortment where overlapping",
                carbonation="газированная",
                url="https://www.bavaria-group.ru/beer-product/sladkie-gazirovannye-napitki",
                pdf_page="15",
                source_site="site regular soda assortment text",
                source_pdf="p.15 product photos + GL/PET icons",
            )
        )
    # Not shown in glass on p.15 → manual
    for taste in ["Апельсин", "Кола", "Яблоко"]:
        rows.append(
            make(
                status="manual",
                brand="Бавария",
                category="Газированные напитки",
                taste=taste,
                ml=450,
                pkg="GLASS",
                name=f"Напиток газированный Бавария {taste}, 0,45 л, стекло",
                reason="Иконка линии GL 0,45 есть, но конкретный вкус в стекле на p.15 не показан",
                evidence="pdf p.15 line icon vs missing bottle photo",
                carbonation="газированная",
                pdf_page="15",
                confidence="medium",
            )
        )

    # -------- Limnada: keep site matrix (OCR didn't give pack detail beyond brand) --------
    # Use site-confirmed from previous review: 1.5 all 4; 0.5 without pineapple
    for taste in ["Ананас", "Крем-Сода", "Дюшес", "Барбарис"]:
        rows.append(
            make(
                status="approved",
                brand="Лимнада",
                category="Газированные напитки",
                taste=taste,
                ml=1500,
                pkg="PET",
                name=f"Напиток газированный Лимнада {taste}, 1,5 л, ПЭТ",
                reason="Сайт: ассортимент ПЭТ 1,5; бренд «Лимнада» сохранён",
                evidence="site card + PDF brand continuity",
                carbonation="газированная",
                url="https://www.bavaria-group.ru/beer-product/silnogazirovannyj-napitok-limnada",
                source_site="site Limnada 1.5 assortment",
                source_pdf="",
            )
        )
    for taste in ["Крем-Сода", "Дюшес", "Барбарис"]:
        rows.append(
            make(
                status="approved",
                brand="Лимнада",
                category="Газированные напитки",
                taste=taste,
                ml=500,
                pkg="PET",
                name=f"Напиток газированный Лимнада {taste}, 0,5 л, ПЭТ",
                reason="Сайт: ПЭТ 0,5 без Ананас",
                evidence="site card",
                carbonation="газированная",
                url="https://www.bavaria-group.ru/beer-product/silnogazirovannyj-napitok-limnada",
                source_site="site Limnada 0.5 assortment",
                source_pdf="",
            )
        )

    # -------- Dreamix soda p.20 --------
    dreamix_flavors = ["Кола-Цитрус", "Тайга", "Мохито", "Клюква-Апельсин"]
    for taste in dreamix_flavors:
        for ml, pkg in [(330, "CAN"), (500, "PET"), (1500, "PET")]:
            rows.append(
                make(
                    status="approved",
                    brand="Dreamix",
                    category="Газированные напитки",
                    taste=taste,
                    ml=ml,
                    pkg=pkg,
                    name=f"Напиток газированный Dreamix {taste}, {vol_label(ml)}, {pkg_label(pkg)}",
                    reason="PDF p.20: подписанные вкусы + CAN 0,33 / PET 0,5 / PET 1,5",
                    evidence="pdf-image p.20",
                    carbonation="газированная",
                    alcohol="0",
                    url="https://www.bavaria-group.ru/beer-product/bezalkogolnyj-silnogazirovannyj-napitok-dreamix",
                    pdf_page="20",
                    source_site="site Dreamix soda packs without flavor titles",
                    source_pdf="p.20 named flavors + pack icons",
                    image_match="exact",
                )
            )

    # -------- Dreamix tonic p.21 --------
    # Keep SKU taste key "Indian Tonik" for continuity with prior site review; label = Indian Tonic (PDF/site)
    for taste, key in [("Bitter Lemon", "Bitter Lemon"), ("Indian Tonic", "Indian Tonik")]:
        for ml, pkg in [(1000, "PET"), (330, "GLASS"), (330, "CAN")]:
            site_pack = pkg in {"PET", "GLASS"}
            rows.append(
                make(
                    status="approved",
                    brand="Dreamix",
                    category="Тоники",
                    taste=taste,
                    ml=ml,
                    pkg=pkg,
                    name=f"Тоник Dreamix {taste}, {vol_label(ml)}, {pkg_label(pkg)}",
                    reason="PDF p.21: PET 1л / стекло 0,33 / банка 0,33",
                    evidence="pdf-image p.21",
                    carbonation="газированная",
                    alcohol="0",
                    url="https://www.bavaria-group.ru/beer-product/dreamix",
                    pdf_page="21",
                    source_site="site Dreamix Toniс PET 1л + стекло 0,33" if site_pack else "",
                    source_pdf="p.21 PET/GL/CAN icons + product photos",
                    product_key=key,
                    image_match="exact",
                )
            )

    # Supersede unsigned Dreamix soda placeholders from prior manual review
    for i in range(4):
        rows.append(
            make(
                status="rejected",
                brand="Dreamix",
                category="Газированные напитки",
                taste=f"unsigned-{i}",
                ml=1500,
                pkg="PET",
                name=f"Dreamix unsigned img#{i} (superseded by p.20 named flavors)",
                reason="Вкусы подписаны на PDF p.20 — unsigned site placeholders отклонены",
                evidence="pdf p.20 named flavors replace site slider without titles",
                product_key=f"UNSIGNED-{i}",
                pdf_page="20",
            )
        )

    # -------- Rocket Ride p.29 --------
    rocket = [
        ("Classic", "Classical"),
        ("Mango-Apricot", "Манго Абрикос"),
        ("Киви-Яблоко", "Киви Яблоко"),
        ("Дикие Ягоды", "Дикие Ягоды"),
        ("Лайм-Лемонграс", "Лайм Лемонграсс"),
    ]
    for key, taste in rocket:
        for ml, pkg in [(450, "CAN"), (500, "PET")]:
            rows.append(
                make(
                    status="approved",
                    brand="Rocket Ride",
                    category="Энергетические напитки",
                    taste=taste,
                    ml=ml,
                    pkg=pkg,
                    name=f"Напиток энергетический Rocket Ride {taste}, {vol_label(ml)}, {pkg_label(pkg)}",
                    reason="PDF p.29: CAN 0,45 + PET 0,5 для всех 5 вкусов",
                    evidence="pdf-image p.29",
                    url="https://www.bavaria-group.ru/beer-product/vitaminnyj-napitok-rocket-ride",
                    pdf_page="29",
                    source_site="site flavors without packs",
                    source_pdf="p.29 packs + flavor photos",
                    product_key=key,
                    image_match="exact",
                )
            )

    # -------- Mountea p.24 --------
    for taste in ["Персик", "Лесные ягоды", "Лайм-мята"]:
        for ml, pkg in [(1500, "PET"), (500, "PET"), (330, "CAN")]:
            rows.append(
                make(
                    status="approved",
                    brand="MOUNTEA",
                    category="Холодный чай",
                    taste=taste,
                    ml=ml,
                    pkg=pkg,
                    name=f"Холодный чай MOUNTEA {taste}, {vol_label(ml)}, {pkg_label(pkg)}",
                    reason="PDF p.24: 3 вкуса × PET 1,5 / 0,5 / CAN 0,33",
                    evidence="pdf-image p.24",
                    url="https://www.bavaria-group.ru/beer-product/holodnyj-caj-mountea",
                    pdf_page="24",
                    source_site="site Персик/Лесные ягоды; Лайм-мята добавлен из PDF",
                    source_pdf="p.24",
                    image_match="exact",
                )
            )

    # -------- Kvass p.13 --------
    # PDF: PET 2L, 1.42L, CAN 0.45; kegs 30/50 wholesale
    # Site had 2 / 1.4 / 0.45 — conflict 1.42 vs 1.4 vs brief 1.2
    conflicts.append(
        {
            "sku": "BAVARIA-DOBRETSOV-VOLUME",
            "field": "volume_pet_mid",
            "site_value": "1,4 л",
            "pdf_value": "1,42 л",
            "notes": "Используем PDF 1,42 л для approved; site 1,4 близко",
        }
    )
    for taste, ml, pkg in [
        ("Хлебный", 2000, "PET"),
        ("Хлебный", 1420, "PET"),
        ("Хлебный", 450, "CAN"),
        ("Бочковой", 2000, "PET"),
        ("Бочковой", 1420, "PET"),
    ]:
        rows.append(
            make(
                status="approved",
                brand="Добрецовъ",
                category="Квас",
                taste=taste,
                ml=ml,
                pkg=pkg,
                name=f"Квас Добрецовъ {taste}, {vol_label(ml)}, {pkg_label(pkg)}",
                reason="PDF p.13 consumer packs; бренд Добрецовъ; mid PET = 1,42 л",
                evidence="pdf-image p.13",
                url="https://www.bavaria-group.ru/beer-product/kvas-dobretsov",
                pdf_page="13",
                source_site="site PET 2 / ~1.4 + can 0.45",
                source_pdf="p.13 PET 2/1.42 + CAN 0.45; variants Бочковой/Хлебный",
                product_key=taste,
            )
        )
    rows.append(
        make(
            status="rejected",
            brand="Добрецовъ",
            category="Квас",
            taste="(без варианта) 1,4 л",
            ml=1400,
            pkg="PET",
            name="Квас Добрецовъ, 1,4 л, ПЭТ (сайт; superseded)",
            reason="PDF фиксирует mid PET как 1,42 л; generic 1,4 без варианта отклонён",
            evidence="site 1.4 vs pdf 1.42",
            product_key="DOBRETSOV-1400",
            pdf_page="13",
        )
    )
    for ml in (30000, 50000):
        rows.append(
            make(
                status="wholesale",
                brand="Добрецовъ",
                category="Квас",
                taste="Кег",
                ml=ml,
                pkg="KEG",
                name=f"Квас Добрецовъ, кег {ml//1000} л",
                reason="Кеги только wholesale-review",
                evidence="pdf p.13 PET KEG 30 / KEG 50",
                pdf_page="13",
            )
        )

    # -------- Carry forward other high-confidence site SKUs from previous approved --------
    # Waters, Honga, SWIPE, Cola Premium, Retro, Black Rocket, New Orange, Ayva, Avaral, Botanic, etc.
    rebuild_skip_substrings = (
        "SVETLOE",
        "-ELF-",
        "GALLAGHER",
        "NORDISCH",
        "PREMIUM-",
        "-GRUSHA-",
        "-TARHUN-",
        "-PITAHAY",
        "-APELSIN-",
        "-KOLA-1500-",
        "-KOLA-500-",
        "-KOLA-450-",
        "-MOHITO-1500-",
        "-MOHITO-500-",
        "-MOHITO-450-",
        "-YABLOKO-",
        "LIMNADA",
        "DREAMIX-",
        "ROCKETRIDE-",
        "MOUNTEA-PERSIK",
        "MOUNTEA-LESNYE",
        "MOUNTEA-LAYM",
        "DOBRETSOV",
    )
    keep_even_if_matched = (
        "KOLA-PREMIUM",
        "KOLA-SF",
        "NEW-ORANGE",
        "HONG",
        "SWIPE",
        "RETRO",
        "MOHITO-KLUBNIKA",
        "MOHITO-FRESH",
        "TBAU",
        "GORNAYA",
        "KAZBEK",
        "AVARAL",
        "AYVA",
        "BLACK-ROCKET",
        "CHERNYY-CHAY",
        "ZELENYY-CHAY",
        "COLALE",
        "COLA-LE",
        "YUжNAYA",  # noop placeholder
    )
    pdf_brand_pages = {
        "TBAU": "p.32/37/38",
        "ТБАУ": "p.32/37/38",
        "SWIPE": "p.22",
        "Swipe": "p.22",
    }

    prev_approved = PREV / "approved-products.csv"
    if prev_approved.exists():
        with prev_approved.open(encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                sku_ = r.get("proposed_sku") or ""
                if not sku_:
                    continue
                matched_rebuild = any(x in sku_ for x in rebuild_skip_substrings)
                keep = any(x in sku_ for x in keep_even_if_matched)
                if matched_rebuild and not keep:
                    continue
                brand = r.get("brand") or ""
                pdf_note = pdf_brand_pages.get(brand, "")
                rows.append(
                    Row(
                        status="approved",
                        proposed_sku=sku_,
                        official_name=r.get("official_name") or "",
                        proposed_name=r.get("proposed_name") or "",
                        brand=brand,
                        manufacturer=r.get("manufacturer") or "ГК ПД «Бавария»",
                        category=r.get("category") or "",
                        category_reason=r.get("category_reason") or "carried from site-approved",
                        volume=r.get("volume") or "",
                        package=r.get("package") or "",
                        taste=r.get("taste") or "",
                        carbonation=r.get("carbonation") or "",
                        sugar=r.get("sugar") or "",
                        alcohol_percent=r.get("alcohol_percent") or "",
                        source_url=r.get("source_url") or "",
                        image_url=r.get("image_url") or "",
                        local_image_path=r.get("local_image_path") or "",
                        duplicate_status=r.get("duplicate_status") or "new",
                        confidence=r.get("confidence") or "high",
                        notes="carried-forward site-approved after PDF visual merge of soft-drink lines",
                        decision_reason="Previous site-approved SKU retained; not contradicted by PDF",
                        evidence_summary=r.get("evidence_summary") or "site",
                        image_match=r.get("image_match") or "shared-line-image",
                        source_site="site",
                        source_pdf=pdf_note,
                    )
                )

    # Keep TBAU Sport manual from previous review
    rows.append(
        Row(
            status="manual",
            proposed_sku="BAVARIA-TBAU-SPORT-MANUAL",
            official_name="Горная родниковая вода «ТБАУ» Sport",
            proposed_name="Вода питьевая TBAU Sport (фасовки не разложены)",
            brand="TBAU",
            manufacturer="ГК ПД «Бавария»",
            category="Питьевая вода",
            category_reason="Линейка Sport на сайте без точных объёмов",
            volume="",
            package="",
            taste="Sport",
            carbonation="",
            sugar="",
            alcohol_percent="",
            source_url="https://www.bavaria-group.ru/beer-product/zagolovok-produkta-2",
            image_url="",
            local_image_path="",
            duplicate_status="new",
            confidence="low",
            notes="",
            decision_reason="Линейка Sport на сайте без точных объёмов; PDF TBAU pages без отдельной матрицы Sport",
            evidence_summary="site mention only",
            image_match="none",
            source_site="site TBAU Sport mention",
            source_pdf="",
        )
    )

    # Dedup by SKU preferring approved > wholesale > manual > rejected, and newer rebuilds
    rank = {"approved": 3, "wholesale": 2, "manual": 1, "rejected": 0}
    by: dict[str, Row] = {}
    for r in rows:
        if not r.proposed_sku:
            continue
        prev = by.get(r.proposed_sku)
        if prev is None or rank[r.status] > rank[prev.status]:
            by[r.proposed_sku] = r
        elif rank[r.status] == rank[prev.status] and r.pdf_page and not prev.pdf_page:
            by[r.proposed_sku] = r
    final = list(by.values())

    # identity collisions
    ids = defaultdict(list)
    for r in final:
        if r.status != "approved":
            continue
        key = (
            r.brand.lower(),
            (r.taste or "").lower(),
            r.volume_ml or r.volume,
            r.package_code or r.package,
            (r.carbonation or "").lower(),
        )
        ids[key].append(r.proposed_sku)
    for k, skus in ids.items():
        if len(skus) > 1:
            conflicts.append(
                {
                    "sku": ",".join(skus),
                    "field": "identity",
                    "site_value": str(k),
                    "pdf_value": "",
                    "notes": "identity collision among approved",
                }
            )

    return final, evidence, conflicts


def write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main() -> int:
    if not PDF.is_file():
        print("PDF missing", file=sys.stderr)
        return 2
    digest = sha256(PDF)
    ingest_meta = {}
    meta_path = INGEST / "PDF-INGEST-REPORT.json"
    if meta_path.exists():
        ingest_meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if ingest_meta.get("page_count") != 40:
        print("Ingest page_count != 40", ingest_meta, file=sys.stderr)
        return 3

    rows, evidence, conflicts = build_rows(digest)
    approved = [r for r in rows if r.status == "approved"]
    manual = [r for r in rows if r.status == "manual"]
    rejected = [r for r in rows if r.status == "rejected"]
    wholesale = [r for r in rows if r.status == "wholesale"]

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"
    out = ROOT / "artifacts/bavaria-import" / f"{ts}-pdf-reviewed"
    out.mkdir(parents=True, exist_ok=True)

    fields = [
        "proposed_sku", "official_name", "proposed_name", "brand", "manufacturer",
        "category", "category_reason", "volume", "package", "taste", "carbonation",
        "sugar", "alcohol_percent", "source_url", "image_url", "local_image_path",
        "duplicate_status", "confidence", "notes", "decision_reason",
        "evidence_summary", "image_match", "pdf_page", "source_site", "source_pdf",
    ]
    write_csv(out / "approved-products.csv", fields, [asdict(r) for r in approved])
    write_csv(out / "manual-review.csv", fields, [asdict(r) for r in manual])
    write_csv(out / "rejected-products.csv", fields, [asdict(r) for r in rejected])
    write_csv(out / "wholesale-packaging-review.csv", fields, [asdict(r) for r in wholesale])
    write_csv(
        out / "pdf-evidence.csv",
        ["sku", "brand", "field", "value", "pdf_name", "page_number", "evidence_type", "confidence", "notes", "pdf_sha256"],
        evidence,
    )
    write_csv(
        out / "source-conflicts.csv",
        ["sku", "field", "site_value", "pdf_value", "notes"],
        conflicts,
    )
    write_csv(
        out / "website-evidence.csv",
        ["sku", "source_url", "notes"],
        [{"sku": r.proposed_sku, "source_url": r.source_url, "notes": r.source_site} for r in approved if r.source_url],
    )

    cats = Counter(r.category for r in approved)
    both = sum(1 for r in approved if r.source_site and r.source_pdf)
    site_only = sum(1 for r in approved if r.source_site and not r.source_pdf)
    pdf_only = sum(1 for r in approved if r.source_pdf and not r.source_site)

    manifest = {
        "stage": "pdf-reviewed-approved",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "manufacturer": "ГК ПД «Бавария»",
        "source_primary": "https://www.bavaria-group.ru",
        "source_booklet": "BAVARIA-CATALOG-2026.pdf",
        "pdf_file_available": True,
        "pdf_path": str(PDF.relative_to(ROOT)),
        "pdf_sha256": digest,
        "pdf_page_count": 40,
        "pdf_size_bytes": PDF.stat().st_size,
        "approved_count": len(approved),
        "manual_review_count": len(manual),
        "rejected_count": len(rejected),
        "wholesale_count": len(wholesale),
        "confirmed_by_site_only": site_only,
        "confirmed_by_pdf_only": pdf_only,
        "confirmed_by_both": both,
        "non_alcoholic_beer_approved": sum(1 for r in approved if r.category == "Безалкогольное пиво"),
        "category_distribution": dict(cats),
        "categories_to_create": [
            {
                "name": "Безалкогольное пиво",
                "slug": "bezalkogolnoe-pivo",
                "description": "Безалкогольное пиво (≤0,5% об. / 0% алк. по буклету), подтверждённое официальным источником.",
            }
        ],
        "checks": {
            "production_db_modified": False,
            "apply_run": False,
            "merge_used": False,
            "pr2_touched": False,
            "alcohol_in_approved_non_beer": [
                r.proposed_sku
                for r in approved
                if r.category != "Безалкогольное пиво"
                and r.alcohol_percent
                and r.alcohol_percent not in {"0", "0.0", "0,0", "0.5", "0,5"}
            ],
        },
        "apply": {
            "sales_status": "showcase",
            "is_active": True,
            "price_amount": None,
            "availability": "in_stock",
            "note": "apply не запускать без отдельного разрешения",
        },
        "approved_skus": sorted(r.proposed_sku for r in approved),
        "manual_skus": sorted(r.proposed_sku for r in manual),
        "rejected_skus": sorted(r.proposed_sku for r in rejected),
    }
    (out / "approved-import-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    report = f"""# FINAL-PDF-REVIEW-REPORT — сайт + буклет

Дата: {manifest['created_at']}
PR: #18
PDF: `{manifest['pdf_path']}`
SHA-256: `{digest}`
Страниц: **40**
Размер: **{manifest['pdf_size_bytes']}** байт

## Итоги

| Метрика | Значение |
|---------|----------|
| Approved | **{len(approved)}** |
| Manual | **{len(manual)}** |
| Rejected | **{len(rejected)}** |
| Wholesale | **{len(wholesale)}** |
| Подтверждено сайтом (есть site evidence) | **{site_only + both}** |
| Подтверждено PDF (есть pdf evidence) | **{pdf_only + both}** |
| Подтверждено обоими | **{both}** |
| Безалкогольное пиво approved | **{manifest['non_alcoholic_beer_approved']}** |

## Категории approved
"""
    for c, n in sorted(cats.items(), key=lambda x: (-x[1], x[0])):
        report += f"- {c}: {n}\n"

    report += f"""

## Ключевые закрытия manual-review по PDF

- **Безалкогольное пиво p.11**: Светлое / Elf / Gallagher — стекло+банка 0,45; Nordisch — банка 0,45 (пиктограмма); штамп **0% Алк.**
- **Premium p.14**: 7 вкусов в стекле 0,5 (вкл. Виноград); ПЭТ 1,2 без Апельсина, с Виноградом
- **Обычные газированные p.15**: подтверждены показанные вкус×тара; Яблоко 1,5 ПЭТ approved; стекло для Апельсин/Кола/Яблоко — manual
- **Dreamix p.20**: вкусы Кола-Цитрус / Тайга / Мохито / Клюква-Апельсин × CAN 0,33 / PET 0,5 / PET 1,5
- **Dreamix Toniс p.21**: + банка 0,33
- **Rocket Ride p.29**: 5 вкусов × CAN 0,45 / PET 0,5
- **Mountea p.24**: + Лайм-мята; все 3 вкуса × 1,5/0,5/0,33
- **Добрецовъ p.13**: consumer PET/can approved; кеги wholesale; объём mid PET = **1,42 л** (конфликт с сайтом 1,4 зафиксирован)

## Ограничения

- production/БД **не изменялись**
- apply **не запускался**
- PR №2 не трогался

Каталог: `{out.relative_to(ROOT)}/`
"""
    (out / "FINAL-PDF-REVIEW-REPORT.md").write_text(report, encoding="utf-8")

    latest = ROOT / "artifacts/bavaria-import/latest-pdf-reviewed"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    latest.symlink_to(out.name)

    print(json.dumps({
        "out": str(out),
        "pdf_sha256": digest,
        "pages": 40,
        "approved": len(approved),
        "manual": len(manual),
        "rejected": len(rejected),
        "wholesale": len(wholesale),
        "both": both,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
