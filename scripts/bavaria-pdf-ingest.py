#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate Bavaria 2026 booklet PDF and extract per-page text + renders.

Fails hard if PDF is missing or invalid. Does not invent catalog data.
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_PAGES = 40
PDF_NAME_CANONICAL = "BAVARIA-CATALOG-2026.pdf"

CANDIDATES = [
    ROOT / "artifacts/bavaria-import/pdf-source/BAVARIA-CATALOG-2026.pdf",
    ROOT / "artifacts/bavaria-import/pdf-source/БУКЛЕТ БАВАРИЯ 2026.pdf",
    Path("/mnt/data/БУКЛЕТ БАВАРИЯ 2026.pdf"),
    Path("/mnt/data/Буклет Бавария 2026.pdf"),
    Path("/mnt/data/BAVARIA-CATALOG-2026.pdf"),
]


def find_pdf() -> Path | None:
    for p in CANDIDATES:
        if p.is_file() and p.stat().st_size > 0:
            return p
    # fuzzy under pdf-source /mnt/data
    for base in [ROOT / "artifacts/bavaria-import/pdf-source", Path("/mnt/data")]:
        if not base.is_dir():
            continue
        for p in sorted(base.glob("*.pdf")):
            name = p.name.lower()
            if p.stat().st_size > 0 and (
                "бавар" in name or "bavaria" in name or "буклет" in name or "catalog" in name
            ):
                return p
    return None


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    pdf = find_pdf()
    out_root = ROOT / "artifacts/bavaria-import"
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%f")[:-3] + "Z"
    out = out_root / f"{ts}-pdf-ingest"
    out.mkdir(parents=True, exist_ok=True)
    pages_dir = out / "pages"
    renders_dir = out / "renders"
    pages_dir.mkdir()
    renders_dir.mkdir()

    report: dict = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "pdf_found": bool(pdf),
        "pdf_path": str(pdf) if pdf else None,
        "expected_pages": EXPECTED_PAGES,
        "ok": False,
        "error": None,
    }

    if not pdf:
        report["error"] = (
            "PDF not found. Copy booklet to "
            f"artifacts/bavaria-import/pdf-source/{PDF_NAME_CANONICAL} "
            "or /mnt/data/БУКЛЕТ БАВАРИЯ 2026.pdf"
        )
        (out / "PDF-INGEST-REPORT.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        (out / "PDF-INGEST-REPORT.md").write_text(
            f"# PDF ingest FAILED\n\n{report['error']}\n", encoding="utf-8"
        )
        latest = out_root / "latest-pdf-ingest"
        if latest.exists() or latest.is_symlink():
            latest.unlink()
        latest.symlink_to(out.name)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    size = pdf.stat().st_size
    report["size_bytes"] = size
    if size <= 0:
        report["error"] = "PDF size is zero"
        (out / "PDF-INGEST-REPORT.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    digest = sha256_file(pdf)
    report["sha256"] = digest

    # Copy canonical name into pdf-source for stable path
    dest = ROOT / "artifacts/bavaria-import/pdf-source" / PDF_NAME_CANONICAL
    dest.parent.mkdir(parents=True, exist_ok=True)
    if pdf.resolve() != dest.resolve():
        dest.write_bytes(pdf.read_bytes())
    report["canonical_path"] = str(dest.relative_to(ROOT))

    try:
        import fitz  # PyMuPDF
    except ImportError:
        report["error"] = "PyMuPDF (fitz) not installed. Run: python3 -m pip install pymupdf"
        (out / "PDF-INGEST-REPORT.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    try:
        doc = fitz.open(pdf)
    except Exception as exc:
        report["error"] = f"PDF failed to open: {exc}"
        (out / "PDF-INGEST-REPORT.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    page_count = doc.page_count
    report["page_count"] = page_count
    if page_count != EXPECTED_PAGES:
        report["error"] = (
            f"Expected {EXPECTED_PAGES} pages, got {page_count}. "
            "Refusing to continue final import with unexpected booklet."
        )
        report["ok"] = False
        # Still extract for debugging, but exit non-zero
        extract_anyway = True
    else:
        extract_anyway = True
        report["ok"] = True

    page_index = []
    if extract_anyway:
        for i in range(page_count):
            page = doc.load_page(i)
            text = page.get_text("text") or ""
            text_path = pages_dir / f"page-{i+1:02d}.txt"
            text_path.write_text(text, encoding="utf-8")

            # Render at ~144 dpi for visual review
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            png_path = renders_dir / f"page-{i+1:02d}.png"
            pix.save(str(png_path))

            page_index.append(
                {
                    "page": i + 1,
                    "text_file": str(text_path.relative_to(ROOT)),
                    "render_file": str(png_path.relative_to(ROOT)),
                    "text_chars": len(text),
                    "text_preview": " ".join(text.split())[:240],
                    "has_extractable_text": len(text.strip()) > 40,
                }
            )

    doc.close()
    report["pages"] = page_index
    (out / "pages-index.json").write_text(
        json.dumps(page_index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out / "PDF-INGEST-REPORT.json").write_text(
        json.dumps({k: v for k, v in report.items() if k != "pages"}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )

    md = [
        "# PDF ingest report",
        "",
        f"- created_at: `{report['created_at']}`",
        f"- pdf_found: **{report['pdf_found']}**",
        f"- path: `{report.get('pdf_path')}`",
        f"- canonical: `{report.get('canonical_path')}`",
        f"- size_bytes: **{report.get('size_bytes')}**",
        f"- sha256: `{report.get('sha256')}`",
        f"- page_count: **{report.get('page_count')}** (expected {EXPECTED_PAGES})",
        f"- ok: **{report.get('ok')}**",
    ]
    if report.get("error"):
        md += ["", f"**Error:** {report['error']}"]
    md += ["", "## Pages", ""]
    for p in page_index:
        md.append(
            f"- p{p['page']:02d}: chars={p['text_chars']} extractable={p['has_extractable_text']} "
            f"— {p['text_preview'][:120]}"
        )
    (out / "PDF-INGEST-REPORT.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    latest = out_root / "latest-pdf-ingest"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    latest.symlink_to(out.name)

    # Convenience pointer for review stage
    (out_root / "pdf-source" / "LAST-INGEST.txt").write_text(str(out) + "\n", encoding="utf-8")

    print(json.dumps({k: v for k, v in report.items() if k != "pages"}, ensure_ascii=False, indent=2))
    return 0 if report.get("ok") else 3


if __name__ == "__main__":
    sys.exit(main())
