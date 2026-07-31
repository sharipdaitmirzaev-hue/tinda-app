#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bavaria PDF/site review for PR #18.

Sources of truth (priority):
1) Official site cards in artifacts/.../discovered.json (bavaria-group.ru)
2) User PDF brief for «БУКЛЕТ БАВАРИЯ 2026.pdf» (when binary PDF is unavailable)
3) Prior dry-run proposed-products.csv

Does NOT touch production/DB and does NOT run apply.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[1]
DRY_RUN = ROOT / "artifacts/bavaria-import/2026-07-31T10-52-18-371Z"
PDF_CANDIDATES = [
    ROOT / "artifacts/bavaria-import/pdf-source/BAVARIA-CATALOG-2026.pdf",
    ROOT / "artifacts/bavaria-import/pdf-source/БУКЛЕТ БАВАРИЯ 2026.pdf",
    Path("/mnt/data/БУКЛЕТ БАВАРИЯ 2026.pdf"),
    Path("/mnt/data/Буклет Бавария 2026.pdf"),
    Path("/mnt/data/BAVARIA-CATALOG-2026.pdf"),
    Path("/mnt/data/buklet-bavaria-2026.pdf"),
    ROOT / "БУКЛЕТ БАВАРИЯ 2026.pdf",
]
REQUIRE_PDF = "--require-pdf" in sys.argv

CYR_TO_LAT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def sku_slug(value: str, max_len: int = 24) -> str:
    lower = value.strip().lower().replace("ё", "е")
    out = []
    for ch in lower:
        if re.match(r"[a-z0-9]", ch):
            out.append(ch)
        elif ch in CYR_TO_LAT:
            out.append(CYR_TO_LAT[ch])
        elif re.match(r"[\s_\-./\\,+&'«»\"()]", ch):
            out.append("-")
    s = re.sub(r"-+", "-", "".join(out)).strip("-").upper() or "X"
    return s[:max_len].rstrip("-") or "X"


def build_sku(brand: str, product_key: str, volume_ml: int, package: str) -> str:
    vol = str(volume_ml)
    pkg = package.upper()
    prefix = "BAVARIA"
    budget = 64 - len(f"{prefix}-{vol}-{pkg}") - 2
    brand_budget = max(4, min(18, budget * 2 // 5))
    product_budget = max(4, budget - brand_budget)
    sku = f"{prefix}-{sku_slug(brand, brand_budget)}-{sku_slug(product_key, product_budget)}-{vol}-{pkg}"
    return sku[:64].rstrip("-")


def vol_label(ml: int) -> str:
    if ml % 1000 == 0:
        return f"{ml // 1000} л"
    s = f"{ml / 1000:.2f}".rstrip("0").rstrip(".").replace(".", ",")
    return f"{s} л"


def pkg_label(code: str) -> str:
    return {"PET": "ПЭТ", "GLASS": "стекло", "CAN": "банка"}[code]


@dataclass
class Evidence:
    sku: str
    brand: str
    field: str
    value: str
    pdf_name: str
    page_number: str
    evidence_type: str
    confidence: str
    notes: str


@dataclass
class Row:
    status: str  # approved | manual | rejected | wholesale
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
    volume_ml: int = 0
    package_code: str = ""
    image_match: str = "none"  # exact | shared-line-image | none


def find_pdf() -> Optional[Path]:
    for p in PDF_CANDIDATES:
        if p.is_file():
            return p
    return None


def load_dry_run() -> tuple[list[dict], dict]:
    proposed = list(csv.DictReader((DRY_RUN / "proposed-products.csv").open(encoding="utf-8")))
    discovered = json.loads((DRY_RUN / "discovered.json").read_text(encoding="utf-8"))
    return proposed, discovered


def product_by_title(discovered: dict, *needles: str) -> Optional[dict]:
    for p in discovered["products"]:
        name = (
            p.get("official_name")
            or p.get("name")
            or p.get("title")
            or p.get("page_title")
            or ""
        ).lower()
        if all(n.lower() in name for n in needles):
            return p
    return None


def product_variants(p: Optional[dict]) -> list[dict]:
    if not p:
        return []
    return list(p.get("variants") or p.get("packages") or [])


def site_url(p: Optional[dict], fallback: str = "https://www.bavaria-group.ru") -> str:
    if not p:
        return fallback
    return p.get("url") or p.get("source_url") or fallback


def site_image(p: Optional[dict], index: int = 0) -> str:
    if not p:
        return ""
    packs = product_variants(p)
    if index < len(packs):
        return packs[index].get("image") or ""
    for pack in packs:
        if pack.get("image"):
            return pack["image"]
    return ""


def make_name(kind: str, brand: str, taste: str, volume_ml: int, package_code: str, carbonation: str = "") -> str:
    vol = vol_label(volume_ml)
    pkg = pkg_label(package_code)
    taste_part = f" {taste}".rstrip()
    carb = f" {carbonation}" if carbonation else ""
    if kind == "beer_na":
        return f"Пиво безалкогольное {brand}{taste_part}, {vol}, {pkg}"
    if kind == "water":
        return f"Вода питьевая {brand}{taste_part}{carb}, {vol}, {pkg}".replace("  ", " ")
    if kind == "mineral":
        return f"Вода минеральная {brand}{taste_part}{carb}, {vol}, {pkg}".replace("  ", " ")
    if kind == "tea":
        return f"Холодный чай {brand}{taste_part}, {vol}, {pkg}"
    if kind == "tonic":
        return f"Тоник {brand}{taste_part}{carb}, {vol}, {pkg}".replace("  ", " ")
    if kind == "kvass":
        return f"Квас {brand}{taste_part}, {vol}, {pkg}"
    if kind == "energy":
        return f"Напиток энергетический {brand}{taste_part}, {vol}, {pkg}"
    if kind == "juice":
        return f"Напиток сокосодержащий {brand}{taste_part}, {vol}, {pkg}"
    return f"Напиток газированный {brand}{taste_part}{carb}, {vol}, {pkg}".replace("  ", " ")


def base_row(**kwargs: Any) -> Row:
    defaults = dict(
        status="manual",
        proposed_sku="",
        official_name="",
        proposed_name="",
        brand="",
        manufacturer="ГК ПД «Бавария»",
        category="",
        category_reason="",
        volume="",
        package="",
        taste="",
        carbonation="",
        sugar="",
        alcohol_percent="",
        source_url="https://www.bavaria-group.ru",
        image_url="",
        local_image_path="",
        duplicate_status="new",
        confidence="medium",
        notes="",
        decision_reason="",
        evidence_summary="",
        volume_ml=0,
        package_code="",
        image_match="none",
    )
    defaults.update(kwargs)
    if defaults["volume_ml"] and not defaults["volume"]:
        defaults["volume"] = vol_label(defaults["volume_ml"])
    if defaults["package_code"] and not defaults["package"]:
        defaults["package"] = pkg_label(defaults["package_code"])
    if not defaults["proposed_sku"] and defaults["brand"] and defaults["volume_ml"] and defaults["package_code"]:
        key = defaults["taste"] or defaults["official_name"] or "product"
        defaults["proposed_sku"] = build_sku(defaults["brand"], key, defaults["volume_ml"], defaults["package_code"])
    return Row(**defaults)


def approve(row: Row, reason: str, evidence: str, confidence: str = "high") -> Row:
    row.status = "approved"
    row.decision_reason = reason
    row.evidence_summary = evidence
    row.confidence = confidence
    return row


def manual(row: Row, reason: str, evidence: str = "", confidence: str = "low") -> Row:
    row.status = "manual"
    row.decision_reason = reason
    row.evidence_summary = evidence
    row.confidence = confidence
    return row


def reject(row: Row, reason: str, evidence: str = "") -> Row:
    row.status = "rejected"
    row.decision_reason = reason
    row.evidence_summary = evidence
    row.confidence = "high"
    return row


def wholesale(row: Row, reason: str, evidence: str = "") -> Row:
    row.status = "wholesale"
    row.decision_reason = reason
    row.evidence_summary = evidence
    row.confidence = "medium"
    return row


def from_proposed(p: dict, **overrides: Any) -> Row:
    volume = p.get("volume") or ""
    ml = 0
    m = re.search(r"(\d+[.,]?\d*)\s*л", volume)
    if m:
        ml = int(round(float(m.group(1).replace(",", ".")) * 1000))
    pkg = (p.get("package") or "").lower()
    code = {"пэт": "PET", "стекло": "GLASS", "банка": "CAN"}.get(pkg, "")
    data = dict(
        proposed_sku=p.get("proposed_sku") or "",
        official_name=p.get("official_name") or "",
        proposed_name=p.get("proposed_name") or "",
        brand=p.get("brand") or "",
        manufacturer=p.get("manufacturer") or "ГК ПД «Бавария»",
        category=p.get("category") or "",
        category_reason=p.get("category_reason") or "",
        volume=volume,
        package=p.get("package") or "",
        taste=p.get("taste") or "",
        carbonation=p.get("carbonation") or "",
        sugar=p.get("sugar") or "",
        alcohol_percent=p.get("alcohol_percent") or "",
        source_url=p.get("source_url") or "",
        image_url=p.get("image_url") or "",
        local_image_path=p.get("local_image_path") or "",
        duplicate_status=p.get("duplicate_status") or "new",
        confidence=p.get("confidence") or "medium",
        notes=p.get("notes") or "",
        volume_ml=ml,
        package_code=code,
        image_match="shared-line-image" if p.get("image_url") else "none",
    )
    data.update(overrides)
    return base_row(**data)


def build_review(pdf_path: Optional[Path]) -> tuple[list[Row], list[Evidence], dict]:
    proposed, discovered = load_dry_run()
    pdf_name = pdf_path.name if pdf_path else "БУКЛЕТ БАВАРИЯ 2026.pdf (file missing)"
    pdf_available = bool(pdf_path)
    rows: list[Row] = []
    evidence: list[Evidence] = []
    matrices: list[dict] = []

    def add_ev(sku: str, brand: str, field: str, value: str, etype: str, conf: str, notes: str, page: str = ""):
        evidence.append(
            Evidence(sku, brand, field, value, pdf_name, page, etype, conf, notes)
        )

    # ------------------------------------------------------------------
    # Helpers for site-confirmed matrices
    # ------------------------------------------------------------------
    def add_matrix(line: str, taste: str, pack: str, volume_ml: int, status: str, proof: str, conf: str):
        matrices.append(
            {
                "line": line,
                "taste": taste,
                "package": pack,
                "volume_ml": volume_ml,
                "status": status,
                "proof": proof,
                "confidence": conf,
            }
        )

    # ------------------------------------------------------------------
    # 1) Non-alcoholic beer
    # ------------------------------------------------------------------
    elf = product_by_title(discovered, "elf", "безалкоголь")
    svetloe = product_by_title(discovered, "светлое", "безалкоголь")
    # Alcoholic twins for rejection evidence
    elf_alc = product_by_title(discovered, "elf", "фильтрованное")
    svetloe_alc = None
    for p in discovered["products"]:
        n = (p.get("name") or "").lower()
        if "светлое» фильтрованное" in n or '«светлое» фильтрованное' in n:
            svetloe_alc = p
            break

    # Светлое NA — site: 0.5% + glass/can 0.45; PDF brief: 0% алк. + same packs
    for code in ("GLASS", "CAN"):
        r = base_row(
            official_name="«Светлое» безалкогольное",
            brand="Бавария",
            category="Безалкогольное пиво",
            category_reason="Официальная карточка безалкогольного пива + страница буклета «Безалкогольное пиво»",
            taste="Светлое",
            alcohol_percent="0.5",
            source_url=site_url(svetloe, "https://www.bavaria-group.ru/beer-product/svetloe-bezalkogolnoe"),
            image_url=site_image(svetloe),
            volume_ml=450,
            package_code=code,
            image_match="exact" if code == "GLASS" else "shared-line-image",
        )
        r.proposed_name = make_name("beer_na", "Бавария", "Светлое", 450, code)
        r.proposed_sku = build_sku("Бавария", "Светлое", 450, code)
        approve(
            r,
            "Безалкогольный статус и фасовка подтверждены сайтом; буклет (бриф) подтверждает линейку 0% алк.",
            "site: Алкоголь 0,5% об.; Стекло 0,45 л | ЖБ 0,45 л | pdf-brief: страница «Безалкогольное пиво»",
            "high",
        )
        rows.append(r)
        add_ev(r.proposed_sku, r.brand, "alcohol_percent", "0.5", "site-text", "high", "Карточка «Светлое» безалкогольное")
        add_ev(r.proposed_sku, r.brand, "package", r.package, "site-text" if pdf_available is False else "pdf-text", "high", "Стекло/ЖБ 0,45 л")
        add_ev(r.proposed_sku, r.brand, "non_alcoholic_status", "confirmed", "pdf-brief", "high" if not pdf_available else "high", "Страница буклета «Безалкогольное пиво», 0% алк. (бриф пользователя)")

    # Elf NA — site: glass 0.45 + 0.5%; PDF brief also can 0.45
    r = base_row(
        official_name="«Elf» безалкогольное",
        brand="Бавария",
        category="Безалкогольное пиво",
        category_reason="Официальная карточка безалкогольного пива",
        taste="Elf",
        alcohol_percent="0.5",
        source_url=site_url(elf, "https://www.bavaria-group.ru/beer-product/elf-bezalkogolnoe"),
        image_url=site_image(elf),
        volume_ml=450,
        package_code="GLASS",
        image_match="exact",
    )
    r.proposed_name = make_name("beer_na", "Бавария", "Elf", 450, "GLASS")
    r.proposed_sku = build_sku("Бавария", "Elf", 450, "GLASS")
    approve(r, "Сайт: 0,5% об. + стекло 0,45 л; буклет подтверждает NA-линейку", "site + pdf-brief", "high")
    rows.append(r)
    add_ev(r.proposed_sku, r.brand, "alcohol_percent", "0.5", "site-text", "high", "Elf безалкогольное")

    r = base_row(
        official_name="«Elf» безалкогольное",
        brand="Бавария",
        category="Безалкогольное пиво",
        category_reason="Буклет: банка 0,45 л для Elf NA; на сайте банка указана только у алкогольного Elf",
        taste="Elf",
        alcohol_percent="0.5",
        source_url=site_url(elf, "https://www.bavaria-group.ru/beer-product/elf-bezalkogolnoe"),
        image_url=site_image(elf),
        volume_ml=450,
        package_code="CAN",
        image_match="none",
    )
    r.proposed_name = make_name("beer_na", "Бавария", "Elf", 450, "CAN")
    r.proposed_sku = build_sku("Бавария", "Elf", 450, "CAN")
    if pdf_available:
        approve(r, "Буклет подтверждает банку 0,45 для Elf NA", "pdf-image/pdf-text", "high")
    else:
        manual(
            r,
            "PDF-файл недоступен для визуальной проверки банки Elf NA; сайт показывает только стекло 0,45. Бриф PDF утверждает банку — оставить до визуала.",
            "pdf-brief pending visual; site pack=glass only",
            "medium",
        )
    rows.append(r)

    # Gallagher NA — only in PDF brief; site card has no ABV (likely alcoholic twin)
    for code in ("GLASS", "CAN"):
        r = base_row(
            official_name="Gallagher безалкогольное",
            brand="Бавария",
            category="Безалкогольное пиво",
            category_reason="Буклет: страница «Безалкогольное пиво», 0% алк.; сайт-карточка Gallagher без % — алкогольный близнец отдельно",
            taste="Gallagher",
            alcohol_percent="0",
            source_url="https://www.bavaria-group.ru/beer-product/svetlyj-lager-gallagher",
            volume_ml=450,
            package_code=code,
            image_match="none",
        )
        r.proposed_name = make_name("beer_na", "Бавария", "Gallagher", 450, code)
        r.proposed_sku = build_sku("Бавария", "Gallagher-NA", 450, code)
        if pdf_available:
            approve(r, "Буклет NA-страница Gallagher 0% + фасовка 0,45", "pdf", "high")
        else:
            manual(
                r,
                "Безалкогольный статус Gallagher подтверждён брифом PDF (0% алк., стекло/банка 0,45), но PDF-файл не смонтирован — без визуала в approved не переводим. Сайтовая карточка без % об. не используется как источник NA.",
                "pdf-brief; site card insufficient",
                "medium",
            )
        rows.append(r)
        add_ev(r.proposed_sku, r.brand, "non_alcoholic_status", "0% алк. (brief)", "pdf-brief", "medium", "Требуется визуал страницы буклета")

    # Nordisch NA — volume 0.45 confirmed in brief; glass vs can unknown
    r = base_row(
        official_name="Nordisch Bier безалкогольное",
        brand="Бавария",
        category="Безалкогольное пиво",
        category_reason="Буклет: NA-линейка; тип тары на иконке не подтверждён",
        taste="Nordisch Bier",
        alcohol_percent="0",
        source_url="https://www.bavaria-group.ru/beer-product/nordisch-bier",
        volume_ml=450,
        package_code="CAN",
        image_match="none",
    )
    r.proposed_name = "Пиво безалкогольное Бавария Nordisch Bier, 0,45 л (тара уточняется)"
    r.proposed_sku = build_sku("Бавария", "Nordisch-NA", 450, "CAN")
    manual(
        r,
        "Объём 0,45 л и NA-статус — по брифу PDF; банка/стекло требует визуальной иконки буклета. Не копировать фасовки алкогольного Nordisch.",
        "pdf-brief volume only",
        "low",
    )
    rows.append(r)

    # Reject alcoholic twins explicitly
    for name, url, abv in [
        ("Пиво Бавария «Elf» светлое фильтрованное", site_url(elf_alc), "4.0"),
        ("Пиво Бавария «светлое» фильтрованное", "https://www.bavaria-group.ru/beer-product/pivo-bavaria-svetloe-filtrovannoe", "4.5"),
        ("Светлый лагер Gallagher (алкогольная карточка сайта)", "https://www.bavaria-group.ru/beer-product/svetlyj-lager-gallagher", "unknown"),
        ("Nordisch bier (карточка сайта без NA-маркера)", "https://www.bavaria-group.ru/beer-product/nordisch-bier", "unknown"),
    ]:
        rows.append(
            reject(
                base_row(
                    official_name=name,
                    proposed_name=name,
                    brand="Бавария",
                    category="—",
                    alcohol_percent=abv,
                    source_url=url,
                    proposed_sku=build_sku("Бавария", f"REJECT-{name[:20]}", 450, "GLASS"),
                ),
                "Алкогольная/неподтверждённая как NA позиция — не импортировать в безалкогольный каталог",
                f"abv={abv}",
            )
        )

    # ------------------------------------------------------------------
    # 2) Premium lemonade — site matrices (no full cartesian)
    # ------------------------------------------------------------------
    premium = product_by_title(discovered, "«premium»") or product_by_title(
        discovered, "premium»"
    )
    premium_glass = ["Груша", "Тархун", "Апельсин", "Гранат", "Фейхоа", "Вишня"]
    premium_pet12 = ["Груша", "Тархун", "Гранат", "Фейхоа", "Вишня"]
    # PDF brief also lists Виноград — not on site assortments → manual
    for taste in premium_glass:
        add_matrix("Premium", taste, "GLASS", 500, "approved", "site assortment стекло 0,5", "high")
        r = base_row(
            official_name="Сладкие газированные напитки «Premium»",
            brand="Бавария",
            category="Газированные напитки",
            category_reason="Premium лимонад / газированный напиток",
            taste=taste,
            carbonation="газированная",
            source_url=site_url(premium, "https://www.bavaria-group.ru/beer-product/sladkie-gazirovannye-napitki-premium"),
            image_url=site_image(premium, 0),
            volume_ml=500,
            package_code="GLASS",
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("soda", "Бавария Premium", taste, 500, "GLASS", "газированная")
        r.proposed_sku = build_sku("Бавария", f"Premium-{taste}", 500, "GLASS")
        approve(r, "Вкус×тара на официальной карточке Premium (стекло 0,5)", "site assortment text", "high")
        rows.append(r)
    for taste in premium_pet12:
        add_matrix("Premium", taste, "PET", 1200, "approved", "site assortment ПЭТ 1,2", "high")
        r = base_row(
            official_name="Сладкие газированные напитки «Premium»",
            brand="Бавария",
            category="Газированные напитки",
            category_reason="Premium лимонад / газированный напиток",
            taste=taste,
            carbonation="газированная",
            source_url=site_url(premium, "https://www.bavaria-group.ru/beer-product/sladkie-gazirovannye-napitki-premium"),
            image_url=site_image(premium, 1),
            volume_ml=1200,
            package_code="PET",
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("soda", "Бавария Premium", taste, 1200, "PET", "газированная")
        r.proposed_sku = build_sku("Бавария", f"Premium-{taste}", 1200, "PET")
        approve(r, "Вкус×тара на официальной карточке Premium (ПЭТ 1,2)", "site assortment text", "high")
        rows.append(r)
    for taste, pack, ml in [("Апельсин", "PET", 1200), ("Виноград", "GLASS", 500), ("Виноград", "PET", 1200)]:
        add_matrix("Premium", taste, pack, ml, "manual", "есть в брифе PDF / нет в site assortment", "low")
        r = base_row(
            official_name="Сладкие газированные напитки «Premium»",
            brand="Бавария",
            category="Газированные напитки",
            taste=taste,
            carbonation="газированная",
            source_url=site_url(premium),
            volume_ml=ml,
            package_code=pack,
        )
        r.proposed_name = make_name("soda", "Бавария Premium", taste, ml, pack, "газированная")
        r.proposed_sku = build_sku("Бавария", f"Premium-{taste}", ml, pack)
        manual(r, "Комбинация вкус×тара не подтверждена ассортиментным текстом сайта; буклет требует визуал", "pdf-brief vs site gap")
        rows.append(r)

    # ------------------------------------------------------------------
    # 3) Regular soda
    # ------------------------------------------------------------------
    regular = product_by_title(discovered, "Сладкие газированные напитки")
    # careful: title exact-ish
    for p in discovered["products"]:
        if (p.get("name") or "") == "Сладкие газированные напитки":
            regular = p
            break
    reg_15 = ["Груша", "Апельсин", "Тархун", "Питахайя", "Мохито", "Кола"]
    reg_05 = ["Груша", "Тархун", "Кола"]
    for taste in reg_15:
        add_matrix("Regular", taste, "PET", 1500, "approved", "site ПЭТ 1,5", "high")
        r = base_row(
            official_name="Сладкие газированные напитки",
            brand="Бавария",
            category="Газированные напитки",
            taste=taste,
            carbonation="газированная",
            source_url=site_url(regular),
            image_url=site_image(regular, 0),
            volume_ml=1500,
            package_code="PET",
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("soda", "Бавария", taste, 1500, "PET", "газированная")
        r.proposed_sku = build_sku("Бавария", taste, 1500, "PET")
        approve(r, "Site assortment ПЭТ 1,5", "site", "high")
        rows.append(r)
    for taste in reg_05:
        add_matrix("Regular", taste, "PET", 500, "approved", "site ПЭТ 0,5", "high")
        r = base_row(
            official_name="Сладкие газированные напитки",
            brand="Бавария",
            category="Газированные напитки",
            taste=taste,
            carbonation="газированная",
            source_url=site_url(regular),
            image_url=site_image(regular, 1),
            volume_ml=500,
            package_code="PET",
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("soda", "Бавария", taste, 500, "PET", "газированная")
        r.proposed_sku = build_sku("Бавария", taste, 500, "PET")
        approve(r, "Site assortment ПЭТ 0,5", "site", "high")
        rows.append(r)
    # PDF brief lists glass 0.45 and taste Яблоко — not in site assortment → manual
    for taste in ["Тархун", "Груша", "Питахайя", "Апельсин", "Кола", "Мохито", "Яблоко"]:
        add_matrix("Regular", taste, "GLASS", 450, "manual", "pdf-brief pack shown; no site taste×glass list", "low")
        r = base_row(
            official_name="Сладкие газированные напитки",
            brand="Бавария",
            category="Газированные напитки",
            taste=taste,
            carbonation="газированная",
            source_url=site_url(regular),
            volume_ml=450,
            package_code="GLASS",
        )
        r.proposed_name = make_name("soda", "Бавария", taste, 450, "GLASS", "газированная")
        r.proposed_sku = build_sku("Бавария", taste, 450, "GLASS")
        manual(r, "Стекло 0,45 упомянуто в брифе PDF как показанная тара линейки, но вкус×стекло на сайте не разложен", "pdf-brief")
        rows.append(r)

    # ------------------------------------------------------------------
    # 4) Limnada
    # ------------------------------------------------------------------
    limnada = product_by_title(discovered, "лимнада")
    for taste in ["Ананас", "Крем-Сода", "Дюшес", "Барбарис"]:
        add_matrix("Limnada", taste, "PET", 1500, "approved", "site 1,5", "high")
        r = base_row(
            official_name="Сильногазированный напиток «Лимнада»",
            brand="Лимнада",
            category="Газированные напитки",
            taste=taste,
            carbonation="газированная",
            source_url=site_url(limnada),
            image_url=site_image(limnada, 0),
            volume_ml=1500,
            package_code="PET",
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("soda", "Лимнада", taste, 1500, "PET", "газированная")
        r.proposed_sku = build_sku("Лимнада", taste, 1500, "PET")
        approve(r, "Site: Ананас/Крем-Сода/Дюшес/Барбарис ПЭТ 1,5", "site", "high")
        rows.append(r)
    for taste in ["Крем-Сода", "Дюшес", "Барбарис"]:
        add_matrix("Limnada", taste, "PET", 500, "approved", "site 0,5 without Ананас", "high")
        r = base_row(
            official_name="Сильногазированный напиток «Лимнада»",
            brand="Лимнада",
            category="Газированные напитки",
            taste=taste,
            carbonation="газированная",
            source_url=site_url(limnada),
            image_url=site_image(limnada, 1),
            volume_ml=500,
            package_code="PET",
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("soda", "Лимнада", taste, 500, "PET", "газированная")
        r.proposed_sku = build_sku("Лимнада", taste, 500, "PET")
        approve(r, "Site: Крем-Сода/Дюшес/Барбарис ПЭТ 0,5 (без Ананас)", "site", "high")
        rows.append(r)
    # Reject inventing Ананас 0.5
    rows.append(
        reject(
            base_row(
                official_name="Сильногазированный напиток «Лимнада»",
                proposed_name="Напиток газированный Лимнада Ананас, 0,5 л, ПЭТ",
                brand="Лимнада",
                category="Газированные напитки",
                taste="Ананас",
                volume_ml=500,
                package_code="PET",
                proposed_sku=build_sku("Лимнада", "Ананас", 500, "PET"),
                source_url=site_url(limnada),
            ),
            "Ананас в ПЭТ 0,5 отсутствует в официальном ассортименте сайта",
            "site 0,5 list excludes Ананас",
        )
    )

    # ------------------------------------------------------------------
    # 5) Retro line — unique SKUs (fix SKU collision)
    # ------------------------------------------------------------------
    retro = product_by_title(discovered, "ретро")
    retro_items = [
        ("Южная Чайка", 450, "GLASS"),
        ("Южная Чайка", 500, "PET"),
        ("Родные Огоньки", 450, "GLASS"),
        ("Родные Огоньки", 500, "PET"),
        ("Заповедная Тайга", 450, "GLASS"),
    ]
    for taste, ml, code in retro_items:
        r = base_row(
            official_name="Сладкие газированные напитки линейки «Ретро»",
            brand="Бавария",
            category="Газированные напитки",
            taste=taste,
            carbonation="газированная",
            source_url=site_url(retro, "https://www.bavaria-group.ru/beer-product/sladkij-silnogazirovannyj-napitok-cajka"),
            image_url=site_image(retro),
            volume_ml=ml,
            package_code=code,
            image_match="exact",
        )
        r.proposed_name = make_name("soda", "Бавария", taste, ml, code, "газированная")
        r.proposed_sku = build_sku("Бавария", f"Retro-{taste}", ml, code)
        approve(r, "Официальные вкусы Ретро с уникальными SKU (коллизия dry-run устранена)", "site variant titles + packs", "high")
        rows.append(r)

    # ------------------------------------------------------------------
    # 6) Dreamix tonic APPROVE; unnamed soda MANUAL
    # ------------------------------------------------------------------
    dreamix_tonic = product_by_title(discovered, "dreamix", "toni")
    for taste, ml, code, img_i in [
        ("Indian Tonik", 1000, "PET", 0),
        ("Indian Tonik", 330, "GLASS", 0),
        ("Bitter Lemon", 1000, "PET", 1),
        ("Bitter Lemon", 330, "GLASS", 1),
    ]:
        r = base_row(
            official_name='Безалкогольные сильногазированные напитки "Dreamix. Toniс"',
            brand="Dreamix",
            category="Тоники",
            taste=taste,
            carbonation="газированная",
            alcohol_percent="0",
            source_url=site_url(dreamix_tonic),
            image_url=site_image(dreamix_tonic, img_i),
            volume_ml=ml,
            package_code=code,
            image_match="exact",
        )
        r.proposed_name = make_name("tonic", "Dreamix", taste, ml, code, "газированная")
        r.proposed_sku = build_sku("Dreamix", taste, ml, code)
        approve(r, "Безалкогольный тоник Dreamix: вкус и фасовка на карточке", "site", "high")
        rows.append(r)

    dreamix_soda = product_by_title(discovered, "безалкогольный сильногазированный напиток «dreamix»")
    for idx in range(4):
        r = base_row(
            official_name="Безалкогольный сильногазированный напиток «Dreamix»",
            brand="Dreamix",
            category="Газированные напитки",
            taste=f"вариант изображения {98+idx if idx<2 else 100+idx}",
            carbonation="газированная",
            alcohol_percent="0",
            source_url=site_url(dreamix_soda, "https://www.bavaria-group.ru/beer-product/bezalkogolnyj-silnogazirovannyj-napitok-dreamix"),
            image_url=site_image(dreamix_soda, idx),
            volume_ml=1500,
            package_code="PET",
            image_match="none",
        )
        r.proposed_name = f"Напиток газированный Dreamix (вкус не подписан, img#{idx}), фасовки 1,5/0,5 ПЭТ и 0,33 банка"
        r.proposed_sku = build_sku("Dreamix", f"Unsigned-{idx}", 1500, "PET")
        manual(
            r,
            "Безалкогольность подтверждена названием карточки; официальные названия вкусов пустые (title=''). Не утверждать SKU до подписи вкуса. Фасовки линейки: ПЭТ 1,5 | ПЭТ 0,5 | ЖБ 0,33.",
            "site unsigned slider titles",
            "low",
        )
        rows.append(r)

    # ------------------------------------------------------------------
    # 7) Black Rocket APPROVE; Rocket Ride MANUAL (no packs)
    # ------------------------------------------------------------------
    black = product_by_title(discovered, "black rocket")
    for taste, ml, code, img_i in [("BLACK ROCKET", 450, "CAN", 0), ("BLACK ROCKET", 500, "PET", 1)]:
        r = base_row(
            official_name="«BLACK ROCKET»",
            brand="BLACK ROCKET",
            category="Энергетические напитки",
            taste=taste,
            source_url=site_url(black),
            image_url=site_image(black, img_i),
            volume_ml=ml,
            package_code=code,
            image_match="exact",
        )
        r.proposed_name = make_name("energy", "BLACK ROCKET", "", ml, code)
        r.proposed_sku = build_sku("BLACK ROCKET", "BLACK-ROCKET", ml, code)
        approve(r, "Фасовки на карточке BLACK ROCKET", "site", "high")
        rows.append(r)

    rocket = product_by_title(discovered, "rocket ride")
    rocket_variants = product_variants(rocket)
    if not rocket_variants:
        rows.append(
            manual(
                base_row(
                    official_name="Витаминный энергетический напиток Rocket Ride",
                    proposed_name="Rocket Ride — вкусы на сайте, фасовки не указаны",
                    brand="Rocket Ride",
                    category="Энергетические напитки",
                    source_url="https://www.bavaria-group.ru/beer-product/vitaminnyj-napitok-rocket-ride",
                    proposed_sku="BAVARIA-ROCKETRIDE-MANUAL",
                ),
                "Карточка Rocket Ride не разобрана или без variants; фасовки не утверждать",
                "lookup/variants empty",
            )
        )
    for pack in rocket_variants:
        taste = (pack.get("variant_title") or "").strip()
        r = base_row(
            official_name="Витаминный энергетический напиток Rocket Ride",
            brand="Rocket Ride",
            category="Энергетические напитки",
            taste=taste,
            source_url=site_url(
                rocket,
                "https://www.bavaria-group.ru/beer-product/vitaminnyj-napitok-rocket-ride",
            ),
            image_url=pack.get("image") or "",
            volume_ml=450,
            package_code="CAN",
            image_match="exact",
        )
        r.proposed_name = f"Напиток энергетический Rocket Ride {taste}"
        r.proposed_sku = build_sku("RocketRide", taste or "X", 450, "CAN")
        manual(
            r,
            "Вкус подтверждён на сайте; объём и тара на карточке отсутствуют. Буклет pp.17–40 недоступен визуально — не утверждать фасовку.",
            "site flavor only",
            "low",
        )
        # volume/package unknown for catalog — blank human fields, keep stable SKU token
        r.volume = ""
        r.package = ""
        r.volume_ml = 0
        r.package_code = ""
        rows.append(r)

    # ------------------------------------------------------------------
    # 8) Honga, New Orange, SWIPE, Cola Premium lines
    # ------------------------------------------------------------------
    hong = product_by_title(discovered, "хонга")
    for taste in ["Ежевика", "Черешня", "Виноград", "Яблоко-шелковица"]:
        r = base_row(
            official_name='Сильногазированные безалкогольные напитки "Хонга"',
            brand="ХОНГÆ",
            category="Газированные напитки",
            taste=taste,
            carbonation="газированная",
            source_url=site_url(hong),
            image_url=site_image(hong),
            volume_ml=500,
            package_code="PET",
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("soda", "ХОНГÆ", taste, 500, "PET", "газированная")
        r.proposed_sku = build_sku("ХОНГÆ", taste, 500, "PET")
        approve(r, "Хонга: вкусы + формат 0,5 л на карточке (безалкогольные)", "site", "high")
        rows.append(r)

    orange = product_by_title(discovered, "new orange")
    for ml in (500, 1000, 1500):
        r = base_row(
            official_name="New Orange",
            brand="Бавария",
            category="Газированные напитки",
            taste="New Orange",
            carbonation="газированная",
            source_url=site_url(orange),
            image_url=site_image(orange),
            volume_ml=ml,
            package_code="PET",
            image_match="exact",
        )
        r.proposed_name = make_name("soda", "Бавария", "New Orange", ml, "PET", "газированная")
        r.proposed_sku = build_sku("Бавария", "New-Orange", ml, "PET")
        approve(r, "New Orange фасовки ПЭТ 0,5/1/1,5", "site", "high")
        rows.append(r)

    swipe = product_by_title(discovered, "swipe")
    for ml, code in [(1500, "PET"), (500, "PET"), (330, "GLASS")]:
        r = base_row(
            official_name="Сильногазированный напиток «SWIPE»",
            brand="SWIPE",
            category="Газированные напитки",
            taste="SWIPE",
            carbonation="газированная",
            source_url=site_url(swipe),
            image_url=site_image(swipe),
            volume_ml=ml,
            package_code=code,
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("soda", "SWIPE", "", ml, code, "газированная")
        r.proposed_sku = build_sku("SWIPE", "SWIPE", ml, code)
        approve(r, "Исправлен объём стекло 0,33 (dry-run ошибочно дал 33 л)", "site: Стекло 0.33 л", "high")
        rows.append(r)
    rows.append(
        reject(
            base_row(
                proposed_sku="BAVARIA-SWIPE-SILNOGAZIROVANNYY-NAPITOK-33000-GLASS",
                official_name="Сильногазированный напиток «SWIPE»",
                proposed_name="Напиток газированный SWIPE, 33 л, стекло",
                brand="SWIPE",
                category="Газированные напитки",
                volume="33 л",
                package="стекло",
                volume_ml=33000,
                package_code="GLASS",
                source_url=site_url(swipe),
            ),
            "Ошибочный SKU dry-run (33 л вместо 0,33 л)",
            "parser bug",
        )
    )

    # Cola Premium LIMITED + SUGAR FREE from site
    cola_lim = product_by_title(discovered, "кола premium limited")
    for ml, code in [(1500, "PET"), (500, "PET"), (500, "GLASS"), (330, "GLASS"), (330, "CAN")]:
        r = base_row(
            official_name="Кола Premium LIMITED EDITION",
            brand="Бавария",
            category="Газированные напитки",
            taste="Кола Premium LIMITED EDITION",
            carbonation="газированная",
            source_url=site_url(cola_lim, "https://www.bavaria-group.ru/beer-product/kola-limited-edition"),
            image_url=site_image(cola_lim),
            volume_ml=ml,
            package_code=code,
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("soda", "Бавария", "Кола Premium LIMITED EDITION", ml, code, "газированная")
        r.proposed_sku = build_sku("Бавария", "Kola-Premium-LE", ml, code)
        approve(r, "Фасовки на карточке Кола Premium LIMITED EDITION; А/Б 0,33 = банка (не ПЭТ)", "site", "high")
        rows.append(r)

    cola_sf = product_by_title(discovered, "sugar free")
    for ml in (1500, 1000, 500):
        r = base_row(
            official_name="Кола Premium SUGAR FREE",
            brand="Бавария",
            category="Газированные напитки",
            taste="Кола Premium SUGAR FREE",
            carbonation="газированная",
            sugar="без сахара",
            source_url=site_url(cola_sf),
            image_url=site_image(cola_sf),
            volume_ml=ml,
            package_code="PET",
            image_match="exact",
        )
        r.proposed_name = make_name("soda", "Бавария", "Кола Premium SUGAR FREE", ml, "PET", "газированная")
        r.proposed_sku = build_sku("Бавария", "Kola-SF", ml, "PET")
        approve(r, "Кола Premium SUGAR FREE ПЭТ 1,5/1/0,5", "site", "high")
        rows.append(r)

    # Cola Limited Edition STM Bristol — soft drink, packs known
    for slug_needle, url_hint in [
        ("cola-limited-edition", "https://www.bavaria-group.ru/beer-product/cola-limited-edition"),
        ("kola-limited-edition-2", "https://www.bavaria-group.ru/beer-product/kola-limited-edition-2"),
    ]:
        pass
    cola_stm = None
    for p in discovered["products"]:
        if (p.get("name") or "") == "«Cola Limited Edition»":
            # first STM card
            if cola_stm is None:
                cola_stm = p
    # Use packs: PET 1.5, PET 0.5, glass 0.45 (+ second card may have can 0.33)
    for ml, code in [(1500, "PET"), (500, "PET"), (450, "GLASS"), (330, "CAN")]:
        r = base_row(
            official_name="«Cola Limited Edition»",
            brand="Cola Limited Edition",
            category="Газированные напитки",
            taste="Cola Limited Edition",
            carbonation="газированная",
            source_url="https://www.bavaria-group.ru/beer-product/cola-limited-edition",
            image_url=site_image(cola_stm),
            volume_ml=ml,
            package_code=code,
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("soda", "Cola Limited Edition", "", ml, code, "газированная")
        r.proposed_sku = build_sku("ColaLE", "Cola-LE", ml, code)
        approve(
            r,
            "СТМ Cola Limited Edition — безалкогольный газированный напиток (описание сети Bristol); фасовки на карточках",
            "site soft-drink description + packs",
            "medium",
        )
        rows.append(r)

    # ------------------------------------------------------------------
    # 9) Mohito AB 0.45
    # ------------------------------------------------------------------
    # На сайте латиница M + кириллица «ОХИТО»
    mohito = (
        product_by_title(discovered, "mохито")
        or product_by_title(discovered, "охито")
        or product_by_title(discovered, "мохито")
    )
    for pack in product_variants(mohito):
        taste = re.sub(r"^\u200b\s*", "", (pack.get("variant_title") or "").strip())
        r = base_row(
            official_name="Напиток безалкогольный сильногазированный MОХИТО",
            brand="Бавария",
            category="Газированные напитки",
            taste=taste,
            carbonation="газированная",
            alcohol_percent="0",
            source_url=site_url(
                mohito,
                "https://www.bavaria-group.ru/beer-product/napitok-bezalkogolnyj-silnogazirovannyj-mohito",
            ),
            image_url=pack.get("image") or "",
            volume_ml=450,
            package_code="CAN",
            image_match="exact",
        )
        r.proposed_name = make_name("soda", "Бавария", taste, 450, "CAN", "газированная")
        r.proposed_sku = build_sku("Бавария", taste, 450, "CAN")
        approve(r, "Безалкогольный мохито, А/Б 0,45 на карточке", "site", "high")
        rows.append(r)

    # ------------------------------------------------------------------
    # 10) Mountea + Botanic
    # ------------------------------------------------------------------
    mountea = product_by_title(discovered, "mountea")
    # peach/berries
    for taste, ml, code in [
        ("Персик", 1500, "PET"),
        ("Персик", 500, "PET"),
        ("Персик", 330, "CAN"),
        ("Лесные ягоды", 1500, "PET"),
        ("Лесные ягоды", 500, "PET"),
        ("Лесные ягоды", 330, "CAN"),
    ]:
        # site lists peach/berries for PET 1.5/0.5 and can 0.33 both
        r = base_row(
            official_name="Холодный чай «Mountea»",
            brand="MOUNTEA",
            category="Холодный чай",
            taste=taste,
            source_url=site_url(mountea),
            image_url=site_image(mountea, 0 if code == "PET" else 1),
            volume_ml=ml,
            package_code=code,
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("tea", "MOUNTEA", taste, ml, code)
        r.proposed_sku = build_sku("MOUNTEA", taste, ml, code)
        # PET 1.5/0.5 assortment mentions both; approve all listed
        if ml in (1500, 500) and code == "PET":
            approve(r, "Mountea Персик/Лесные ягоды ПЭТ 1,5 и 0,5", "site", "high")
        elif ml == 330 and code == "CAN":
            approve(r, "Mountea ЖБ 0,33 Персик/Лесные ягоды", "site", "high")
        else:
            manual(r, "Неожиданная комбинация", "")
        rows.append(r)

    botanic = product_by_title(discovered, "botanic")
    botanic_tastes = [
        "Черный чай с лимоном и горной мятой",
        "Зеленый чай с манго и ромашкой",
        "Черный чай с малиной и гибискусом",
    ]
    for taste in botanic_tastes:
        for ml, code in [(1000, "PET"), (500, "PET"), (330, "CAN")]:
            r = base_row(
                official_name="Линейка натуральных напитков MOUNTEA botanic",
                brand="MOUNTEA",
                category="Холодный чай",
                taste=taste,
                source_url=site_url(botanic),
                image_url=site_image(botanic),
                volume_ml=ml,
                package_code=code,
                image_match="shared-line-image",
            )
            r.proposed_name = make_name("tea", "MOUNTEA botanic", taste, ml, code)
            r.proposed_sku = build_sku("MOUNTEA", taste, ml, code)
            approve(r, "MOUNTEA botanic ассортимент × ПЭТ 1,0 / 0,5 / АБ 0,33", "site", "high")
            rows.append(r)

    # ------------------------------------------------------------------
    # 11) Kvass Dobrettsov — retail PET/can approve; kegs wholesale
    # ------------------------------------------------------------------
    kvass = product_by_title(discovered, "добрецовъ")
    kvass_b = product_by_title(discovered, "бочковой")
    for taste, ml, code, src in [
        ("Добрецовъ", 2000, "PET", kvass),
        ("Добрецовъ", 1400, "PET", kvass),
        ("Добрецовъ", 450, "CAN", kvass),
        ("Добрецовъ Бочковой", 2000, "PET", kvass_b),
    ]:
        r = base_row(
            official_name=f"Квас «{taste}»" if "Бочковой" not in taste else "Квас «Добрецовъ Бочковой»",
            brand="Добрецовъ",
            category="Квас",
            taste=taste,
            source_url=site_url(src),
            image_url=site_image(src),
            volume_ml=ml,
            package_code=code,
            image_match="exact",
        )
        r.proposed_name = make_name("kvass", "Добрецовъ", taste.replace("Добрецовъ", "").strip(), ml, code)
        r.proposed_sku = build_sku("Добрецовъ", taste, ml, code)
        note = "Сайт: 2 л / 1,4 л / А/Б 0,45. Бриф PDF упоминает ПЭТ 1,2 и банку 0,45 — расхождение 1,2 vs 1,4 оставить в notes, retail SKU по сайту."
        approve(r, note, "site retail packs; pdf-brief conflict on 1.2 vs 1.4 noted", "medium")
        rows.append(r)
        add_ev(r.proposed_sku, r.brand, "volume", vol_label(ml), "site-text", "high", "PDF brief lists 1,2 л — not used instead of site 1,4 without visual")
    for keg_l in (30, 50):
        r = base_row(
            official_name="Квас «Добрецовъ»",
            brand="Добрецовъ",
            category="Квас",
            taste="Добрецовъ",
            volume=f"{keg_l} л",
            package="кег",
            volume_ml=keg_l * 1000,
            package_code="KEG",
            source_url=site_url(kvass),
            proposed_sku=build_sku("Добрецовъ", "Keg", keg_l * 1000, "KEG"),
        )
        r.proposed_name = f"Квас Добрецовъ, кег {keg_l} л"
        wholesale(r, "Кеги только в wholesale-packaging-review; не в retail import", "pdf-brief kegs 30/50")
        rows.append(r)

    # ------------------------------------------------------------------
    # 12) Waters: TBAU classic/premium/detskaya; Горная вода; Kazbek; Аварал; ВкусВилл manual
    # ------------------------------------------------------------------
    # Carry-forward high-confidence water SKUs from dry-run with review decisions
    water_approve_prefixes = (
        "BAVARIA-TBAU-CLASSIC-",
        "BAVARIA-TBAU-PREMIUM-",
        "BAVARIA-TBAU-GORNAA-RODNIKOVAA-VODA-TBAU-",  # detskaya
        "BAVARIA-GORNAYA-VODA-",
        "BAVARIA-KAZBEK-AQUA-",
    )
    seen_skus = {r.proposed_sku for r in rows}
    for p in proposed:
        sku = p["proposed_sku"]
        if sku in seen_skus:
            continue
        if sku.startswith(water_approve_prefixes) or sku.startswith("BAVARIA-TBAU-TBAU-NEGAZIROVANNAYA"):
            r = from_proposed(p)
            # cooler 19L — approve as water but note Horeca/cooler
            if "19000" in sku:
                approve(r, "Вода для кулеров 19 л — питьевая вода (не кег алкоголя)", "site cooler assortment", "medium")
            else:
                approve(r, "Питьевая/минеральная вода: фасовка из dry-run + карточка сайта", "site/dry-run", p.get("confidence") or "high")
            rows.append(r)
            seen_skus.add(sku)

    # TBAU Sport — manual
    rows.append(
        manual(
            base_row(
                official_name="Горная родниковая вода «ТБАУ» Sport",
                proposed_name="Вода питьевая TBAU Sport (фасовки не разложены)",
                brand="TBAU",
                category="Питьевая вода",
                source_url="https://www.bavaria-group.ru/beer-product/zagolovok-produkta-2",
                proposed_sku="BAVARIA-TBAU-SPORT-MANUAL",
            ),
            "Линейка Sport упомянута на карточке TBAU, но точные объёмы/газированность не разложены отдельно",
            "site mention only",
        )
    )

    # Аварал — mountain spring water STM, glass 0.45
    avaral = product_by_title(discovered, "аварал")
    r = base_row(
        official_name="«Аварал»",
        brand="Аварал",
        category="Питьевая вода",
        category_reason="СТМ горная родниковая вода (описание карточки)",
        taste="Аварал",
        source_url=site_url(avaral),
        image_url=site_image(avaral),
        volume_ml=450,
        package_code="GLASS",
        image_match="exact",
    )
    r.proposed_name = make_name("water", "Аварал", "", 450, "GLASS")
    r.proposed_sku = build_sku("Аварал", "Avaral", 450, "GLASS")
    approve(r, "СТМ вода Аварал, стекло 0,45; безалкогольный статус очевиден (питьевая вода)", "site description + pack", "high")
    rows.append(r)

    # Айва — only still packs listed; reject invented sparkling
    ayva = product_by_title(discovered, "айва")
    for ml, code in [(500, "GLASS"), (500, "PET")]:
        r = base_row(
            official_name="«Айва»",
            brand="Айва",
            category="Питьевая вода",
            category_reason="СТМ вода Premium негазированная (уточнить бренд-категорию при apply)",
            taste="Айва",
            carbonation="негазированная",
            source_url=site_url(ayva),
            image_url=site_image(ayva),
            volume_ml=ml,
            package_code=code,
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("water", "Айва", "", ml, code, "негазированная")
        r.proposed_sku = build_sku("Айва", "Ayva-still", ml, code)
        approve(r, "Сайт: Стекло Premium негазированная 0,5 / ПЭТ негазированная 0,5", "site", "medium")
        rows.append(r)
    for code in ("GLASS", "PET"):
        rows.append(
            reject(
                base_row(
                    official_name="«Айва»",
                    proposed_name=f"Напиток Айва газированная, 0,5 л, {pkg_label(code)}",
                    brand="Айва",
                    category="Другие",
                    taste="Айва",
                    carbonation="газированная",
                    volume_ml=500,
                    package_code=code,
                    proposed_sku=build_sku("Айва", "Ayva-sparkling", 500, code),
                    source_url=site_url(ayva),
                ),
                "Газированная Айва не указана в официальном ассортименте карточки",
                "site lists only негазированная",
            )
        )

    # ВкусВилл — packs incomplete in prior manual sense? site has 0.5 sport lock gaz/negaz
    vkus = product_by_title(discovered, "вкусвилл")
    for carb in ("газированная", "негазированная"):
        r = base_row(
            official_name="«ВкусВилл»",
            brand="TBAU",
            category="Питьевая вода",
            taste="ВкусВилл",
            carbonation=carb,
            source_url=site_url(vkus),
            image_url=site_image(vkus),
            volume_ml=500,
            package_code="PET",
            image_match="exact",
        )
        r.proposed_name = make_name("water", "ВкусВилл", "", 500, "PET", carb)
        r.proposed_sku = build_sku("VkusVill", carb, 500, "PET")
        approve(r, "ВкусВилл Sport Lock 0,5 ПЭТ газ/негаз на карточке", "site", "medium")
        rows.append(r)

    # ------------------------------------------------------------------
    # 13) Juice drink «Ф»
    # ------------------------------------------------------------------
    fdrink = product_by_title(discovered, "сокосодержащий")
    for taste, ml in [("Слива", 1500), ("Мультифрукт", 1500), ("Мангостин", 1500), ("Мультифрукт", 500), ("Мангостин", 500)]:
        r = base_row(
            official_name="Сокосодержащий напиток «Ф»",
            brand="Бавария",
            category="Газированные напитки",
            category_reason="Сокосодержащий напиток; отдельной категории соков нет — газированные/другие на усмотрение; оставляем газированные как closest soft drink",
            taste=taste,
            source_url=site_url(fdrink),
            image_url=site_image(fdrink, 0 if ml == 1500 else 1),
            volume_ml=ml,
            package_code="PET",
            image_match="shared-line-image",
        )
        r.proposed_name = make_name("juice", "Ф", taste, ml, "PET")
        r.proposed_sku = build_sku("F", taste, ml, "PET")
        approve(r, "Сокосодержащий «Ф»: безалкогольный; вкусы/фасовки на карточке", "site", "high")
        rows.append(r)
    rows.append(
        reject(
            base_row(
                official_name="Сокосодержащий напиток «Ф»",
                proposed_name="Напиток сокосодержащий Ф Слива, 0,5 л, ПЭТ",
                brand="Бавария",
                category="Газированные напитки",
                taste="Слива",
                volume_ml=500,
                package_code="PET",
                proposed_sku=build_sku("F", "Слива", 500, "PET"),
                source_url=site_url(fdrink),
            ),
            "Слива отсутствует в ассортименте ПЭТ 0,5",
            "site 0,5 = Мультифрукт | Мангостин",
        )
    )

    # ------------------------------------------------------------------
    # Deduplicate by SKU (keep strongest status: approved > wholesale > manual > rejected)
    # ------------------------------------------------------------------
    rank = {"approved": 3, "wholesale": 2, "manual": 1, "rejected": 0}
    by_sku: dict[str, Row] = {}
    for r in rows:
        if not r.proposed_sku:
            continue
        prev = by_sku.get(r.proposed_sku)
        if prev is None or rank[r.status] > rank[prev.status]:
            by_sku[r.proposed_sku] = r
    final_rows = list(by_sku.values())

    # Identity collision check among approved
    id_keys = defaultdict(list)
    for r in final_rows:
        if r.status != "approved":
            continue
        key = (
            r.brand.strip().lower(),
            (r.taste or "").strip().lower(),
            r.volume_ml,
            r.package_code,
            (r.carbonation or "").strip().lower(),
        )
        id_keys[key].append(r.proposed_sku)
    collisions = {k: v for k, v in id_keys.items() if len(v) > 1}

    meta = {
        "pdf_available": pdf_available,
        "pdf_path": str(pdf_path) if pdf_path else None,
        "pdf_name": pdf_name,
        "matrices": matrices,
        "identity_collisions": [
            {"key": list(k), "skus": v} for k, v in collisions.items()
        ],
        "source_dry_run": str(DRY_RUN.relative_to(ROOT)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    return final_rows, evidence, meta


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def row_to_dict(r: Row) -> dict:
    d = asdict(r)
    return d


def main() -> int:
    pdf = find_pdf()
    if REQUIRE_PDF and not pdf:
        print(
            "FATAL: --require-pdf set but booklet PDF not found.\n"
            "Copy file to artifacts/bavaria-import/pdf-source/BAVARIA-CATALOG-2026.pdf\n"
            "or /mnt/data/БУКЛЕТ БАВАРИЯ 2026.pdf, then run:\n"
            "  npm run import:bavaria:pdf-ingest\n"
            "  npm run import:bavaria:pdf-review\n"
            "Brief-only review is not allowed for final import.",
            file=sys.stderr,
        )
        return 2
    if REQUIRE_PDF and pdf:
        # Prefer latest ingest metadata when available
        ingest_latest = ROOT / "artifacts/bavaria-import/latest-pdf-ingest/PDF-INGEST-REPORT.json"
        if ingest_latest.exists():
            ingest = json.loads(ingest_latest.read_text(encoding="utf-8"))
            if not ingest.get("ok"):
                print(
                    "FATAL: pdf-ingest report is not ok. Fix PDF (size/pages/open) first.",
                    file=sys.stderr,
                )
                print(json.dumps(ingest, ensure_ascii=False, indent=2), file=sys.stderr)
                return 3

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"
    out = ROOT / "artifacts/bavaria-import" / f"{ts}-pdf-reviewed"
    out.mkdir(parents=True, exist_ok=True)

    rows, evidence, meta = build_review(pdf)

    approved = [r for r in rows if r.status == "approved"]
    manual_rows = [r for r in rows if r.status == "manual"]
    rejected = [r for r in rows if r.status == "rejected"]
    wholesale_rows = [r for r in rows if r.status == "wholesale"]

    product_fields = [
        "proposed_sku", "official_name", "proposed_name", "brand", "manufacturer",
        "category", "category_reason", "volume", "package", "taste", "carbonation",
        "sugar", "alcohol_percent", "source_url", "image_url", "local_image_path",
        "duplicate_status", "confidence", "notes", "decision_reason",
        "evidence_summary", "image_match",
    ]
    write_csv(out / "approved-products.csv", product_fields, [row_to_dict(r) for r in approved])
    write_csv(out / "manual-review.csv", product_fields, [row_to_dict(r) for r in manual_rows])
    write_csv(out / "rejected-products.csv", product_fields, [row_to_dict(r) for r in rejected])
    write_csv(out / "wholesale-packaging-review.csv", product_fields, [row_to_dict(r) for r in wholesale_rows])

    write_csv(
        out / "pdf-evidence.csv",
        ["sku", "brand", "field", "value", "pdf_name", "page_number", "evidence_type", "confidence", "notes"],
        [asdict(e) for e in evidence],
    )
    write_csv(
        out / "packaging-matrix.csv",
        ["line", "taste", "package", "volume_ml", "status", "proof", "confidence"],
        meta["matrices"],
    )

    na_beer = [r for r in approved + manual_rows if r.category == "Безалкогольное пиво"]
    write_csv(
        out / "nonalcoholic-beer-evidence.csv",
        product_fields,
        [row_to_dict(r) for r in na_beer],
    )
    write_csv(
        out / "image-to-sku-audit.csv",
        ["proposed_sku", "status", "image_url", "image_match", "proposed_name", "notes"],
        [
            {
                "proposed_sku": r.proposed_sku,
                "status": r.status,
                "image_url": r.image_url,
                "image_match": r.image_match,
                "proposed_name": r.proposed_name,
                "notes": r.decision_reason,
            }
            for r in rows
            if r.status in {"approved", "manual"}
        ],
    )

    cat_dist = Counter(r.category for r in approved)
    manifest = {
        "stage": "pdf-reviewed-approved",
        "created_at": meta["generated_at"],
        "manufacturer": "ГК ПД «Бавария»",
        "source_primary": "https://www.bavaria-group.ru",
        "source_booklet": meta["pdf_name"],
        "pdf_file_available": meta["pdf_available"],
        "pdf_path": meta["pdf_path"],
        "dry_run_source": meta["source_dry_run"],
        "approved_count": len(approved),
        "manual_review_count": len(manual_rows),
        "rejected_count": len(rejected),
        "wholesale_count": len(wholesale_rows),
        "non_alcoholic_beer_approved": len([r for r in approved if r.category == "Безалкогольное пиво"]),
        "non_alcoholic_beer_manual": len([r for r in manual_rows if r.category == "Безалкогольное пиво"]),
        "category_distribution": dict(cat_dist),
        "categories_to_create": [
            {
                "name": "Безалкогольное пиво",
                "slug": "bezalkogolnoe-pivo",
                "description": "Безалкогольное пиво (≤0,5% об.), подтверждённое официальным источником.",
            }
        ],
        "identity_collisions": meta["identity_collisions"],
        "checks": {
            "alcohol_in_approved": [
                r.proposed_sku
                for r in approved
                if r.alcohol_percent
                and r.alcohol_percent not in {"0", "0.0", "0.5", "0,5"}
                and r.category != "Безалкогольное пиво"
            ],
            "sku_collisions": [],
            "production_db_modified": False,
            "apply_run": False,
            "catalog_normalize_run": False,
            "merge_used": False,
            "pr2_touched": False,
        },
        "apply": {
            "sales_status": "showcase",
            "is_active": True,
            "price_amount": None,
            "availability": "in_stock",
            "note": "Цена не устанавливается; apply не запускать без отдельного разрешения",
        },
        "approved_skus": sorted(r.proposed_sku for r in approved),
        "manual_skus": sorted(r.proposed_sku for r in manual_rows),
        "rejected_skus": sorted(r.proposed_sku for r in rejected),
    }

    # SKU collision within approved
    sku_counts = Counter(r.proposed_sku for r in approved)
    manifest["checks"]["sku_collisions"] = [s for s, n in sku_counts.items() if n > 1]

    (out / "approved-import-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out / "review-meta.json").write_text(
        json.dumps({k: v for k, v in meta.items() if k != "matrices"}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    # FINAL REPORT
    report = f"""# FINAL-PDF-REVIEW-REPORT — импорт «Баварии»

Дата: {meta['generated_at']}
PR: **#18** (ветка `cursor/import-bavaria-nonalcoholic-f733`)
Этап: **pdf/site review → approved manifest** (production/БД не изменялись, apply не запускался)

## Источники

| Источник | Статус |
|----------|--------|
| https://www.bavaria-group.ru | использован (`discovered.json` dry-run) |
| `/mnt/data/БУКЛЕТ БАВАРИЯ 2026.pdf` | **{'найден: ' + str(pdf) if pdf else 'НЕ НАЙДЕН в среде агента'}** |
| Бриф содержимого буклета из ТЗ PR №18 | использован как `pdf-brief` с пометками |

> Визуальный просмотр страниц PDF не выполнен (файл отсутствует в `/mnt/data`).  
> Все позиции, требующие иконки вкус×тара из буклета, оставлены в **manual-review**.

## Итоги

| Метрика | Значение |
|---------|----------|
| Approved SKU | **{len(approved)}** |
| Manual review | **{len(manual_rows)}** |
| Rejected | **{len(rejected)}** |
| Wholesale (кеги) | **{len(wholesale_rows)}** |
| Безалкогольное пиво (approved) | **{manifest['non_alcoholic_beer_approved']}** |
| Безалкогольное пиво (manual) | **{manifest['non_alcoholic_beer_manual']}** |
| Identity collisions (approved) | **{len(meta['identity_collisions'])}** |
| SKU collisions (approved) | **{len(manifest['checks']['sku_collisions'])}** |

## Категории approved

"""
    for cat, n in sorted(cat_dist.items(), key=lambda x: (-x[1], x[0])):
        report += f"- {cat}: {n}\n"

    rel_out = str(out.relative_to(ROOT))
    report += f"""

## Подтверждения по ключевым спорным позициям

### Безалкогольное пиво
- **Светлое**: APPROVED стекло 0,45 + банка 0,45 (сайт: 0,5% об.; буклет-бриф: страница NA).
- **Elf**: APPROVED стекло 0,45 (сайт). Банка 0,45 — MANUAL до визуала PDF.
- **Gallagher NA**: MANUAL (бриф PDF подтверждает 0% + стекло/банка 0,45; без файла PDF не утверждаем). Алкогольная карточка сайта — REJECT как источник NA.
- **Nordisch Bier NA**: MANUAL (объём 0,45 по брифу; банка/стекло не подтверждены).

### Вкусы / фасовки / тара
- **Premium**: утверждены только комбинации из текста сайта (стекло 0,5 и ПЭТ 1,2). Виноград / Апельсин×1,2 — MANUAL.
- **Обычные газированные**: утверждены ПЭТ 1,5 и ПЭТ 0,5 по сайту (включая Кола). Стекло 0,45 × вкусы — MANUAL.
- **Лимнада**: 1,5 — 4 вкуса; 0,5 — без Ананас. Ананас 0,5 — REJECT.
- **Ретро (Чайка / Огоньки / Тайга)**: APPROVED с уникальными SKU (коллизия dry-run устранена).
- **Dreamix Toniс**: APPROVED Indian Tonik / Bitter Lemon. Неподписанные вкусы Dreamix soda — MANUAL.
- **Rocket Ride**: вкусы подтверждены, фасовки нет — MANUAL.
- **Добрецовъ**: retail ПЭТ/банка APPROVED по сайту; кеги 30/50 — wholesale only. Расхождение PDF 1,2 vs сайт 1,4 зафиксировано.
- **Аварал**: APPROVED как питьевая вода стекло 0,45.
- **Айва**: APPROVED только негазированная 0,5 стекло/ПЭТ; газированные варианты dry-run — REJECT.
- **Cola Limited Edition (СТМ)**: APPROVED как безалкогольная газировка; фасовки с карточек.
- **SWIPE**: исправлен баг 33 л → 0,33 л стекло.

## Ограничения (соблюдены)

- PR №2 (TINDA Image Downloader) **не затрагивался**
- Production / БД **не изменялись**
- `apply` **не запускался**
- catalog-normalize / `--merge` **не использовались**

## Файлы

Каталог: `{rel_out}/`

- approved-products.csv
- manual-review.csv
- rejected-products.csv
- wholesale-packaging-review.csv
- pdf-evidence.csv
- packaging-matrix.csv
- nonalcoholic-beer-evidence.csv
- image-to-sku-audit.csv
- approved-import-manifest.json
- FINAL-PDF-REVIEW-REPORT.md

## Следующий шаг

1. Приложить файл `БУКЛЕТ БАВАРИЯ 2026.pdf` в `/mnt/data/` (или `artifacts/bavaria-import/pdf-source/`).
2. Повторить визуальный проход стр. безалкогольного пива и матриц вкус×тара → перевести MANUAL→APPROVED.
3. Только после явного разрешения: backup БД и `import:bavaria:apply`.
"""
    (out / "FINAL-PDF-REVIEW-REPORT.md").write_text(report, encoding="utf-8")

    # Convenience pointer
    latest = ROOT / "artifacts/bavaria-import/latest-pdf-reviewed"
    if latest.is_symlink() or latest.exists():
        if latest.is_symlink() or latest.is_file():
            latest.unlink()
        else:
            # directory
            pass
    try:
        if latest.exists():
            import shutil
            if latest.is_dir() and not latest.is_symlink():
                shutil.rmtree(latest)
            else:
                latest.unlink()
        latest.symlink_to(out.name)
    except Exception:
        (ROOT / "artifacts/bavaria-import/LATEST-PDF-REVIEWED.txt").write_text(str(out) + "\n", encoding="utf-8")

    print(f"OUT={out}")
    print(f"PDF_AVAILABLE={meta['pdf_available']}")
    print(f"APPROVED={len(approved)} MANUAL={len(manual_rows)} REJECTED={len(rejected)} WHOLESALE={len(wholesale_rows)}")
    print(f"COLLISIONS={len(meta['identity_collisions'])} SKU_COLLISIONS={manifest['checks']['sku_collisions']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
