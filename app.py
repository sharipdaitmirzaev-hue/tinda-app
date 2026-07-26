#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TINDA Image Downloader
Скачивание фотографий товаров со страниц каталога METRO.
"""

from __future__ import annotations

import csv
import hashlib
import re
import threading
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse

import requests
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
except ImportError:  # pragma: no cover
    sync_playwright = None
    PlaywrightTimeoutError = Exception


SITE_NAME = "metro"
MIN_IMAGE_SIZE = 250
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
REQUEST_TIMEOUT = 30
CSV_COLUMNS = [
    "site",
    "page",
    "product_name",
    "image_file",
    "image_url",
    "source_page_url",
]

CAPTCHA_MARKERS = [
    "captcha",
    "recaptcha",
    "hcaptcha",
    "cloudflare",
    "подтвердите, что вы не робот",
    "подтвердите что вы не робот",
    "я не робот",
    "access denied",
    "attention required",
]


@dataclass
class ProductImage:
    product_name: str
    image_url: str
    width: int
    height: int


class StopRequested(Exception):
    """Пользователь нажал «Остановить»."""


class CaptchaDetected(Exception):
    """Сайт показал CAPTCHA или антибот-защиту."""


def set_page_param(url: str, page: int) -> str:
    """Подставляет/заменяет параметр page в URL."""
    parsed = urlparse(url.strip())
    query = parse_qs(parsed.query, keep_blank_values=True)
    query["page"] = [str(page)]
    new_query = urlencode(query, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


def sanitize_filename(name: str, max_len: int = 80) -> str:
    """Делает безопасное имя файла из названия товара."""
    name = (name or "").strip()
    name = re.sub(r"[\\/:*?\"<>|\r\n\t]+", "_", name)
    name = re.sub(r"\s+", " ", name).strip(" ._")
    if not name:
        name = "product"
    if len(name) > max_len:
        name = name[:max_len].rstrip(" ._")
    return name


def short_url_hash(url: str, length: int = 8) -> str:
    return hashlib.md5(url.encode("utf-8")).hexdigest()[:length]


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pick_largest_from_srcset(srcset: str, base_url: str) -> Optional[str]:
    """Выбирает URL самого большого изображения из srcset."""
    if not srcset or not srcset.strip():
        return None

    best_url = None
    best_score = -1.0

    for part in srcset.split(","):
        part = part.strip()
        if not part:
            continue
        tokens = part.split()
        if not tokens:
            continue
        candidate = urljoin(base_url, tokens[0])
        score = 0.0
        if len(tokens) >= 2:
            desc = tokens[1].lower()
            if desc.endswith("w"):
                try:
                    score = float(desc[:-1])
                except ValueError:
                    score = 0.0
            elif desc.endswith("x"):
                try:
                    score = float(desc[:-1]) * 1000
                except ValueError:
                    score = 0.0
        if score > best_score:
            best_score = score
            best_url = candidate

    return best_url


def looks_like_svg(url: str) -> bool:
    path = urlparse(url).path.lower()
    return path.endswith(".svg") or ".svg?" in path or "image/svg" in url.lower()


def is_ui_or_non_product_url(url: str) -> bool:
    """Грубый фильтр логотипов, иконок, баннеров по URL."""
    lower = url.lower()
    bad_tokens = [
        "logo",
        "icon",
        "sprite",
        "banner",
        "promo",
        "favicon",
        "avatar",
        "placeholder",
        "stub",
        "badge",
        "payment",
        "social",
        "footer",
        "header",
        "nav-",
        "/nav/",
        "ui/",
        "static/icons",
        "emoji",
        "pixel",
        "tracking",
        "1x1",
    ]
    return any(token in lower for token in bad_tokens)


def extension_from_url_and_content(url: str, content_type: str, data: bytes) -> str:
    path = urlparse(url).path.lower()
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"):
        if path.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext

    ct = (content_type or "").lower()
    if "jpeg" in ct or "jpg" in ct:
        return ".jpg"
    if "png" in ct:
        return ".png"
    if "webp" in ct:
        return ".webp"
    if "gif" in ct:
        return ".gif"

    # Сигнатуры
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    return ".jpg"


def page_has_captcha(page_text: str, page_html: str) -> bool:
    blob = f"{page_text}\n{page_html}".lower()
    # Явные виджеты
    hard_markers = [
        "g-recaptcha",
        "h-captcha",
        "cf-challenge",
        "cf-browser-verification",
        "id=\"captcha\"",
        "class=\"captcha\"",
        "подтвердите, что вы не робот",
        "подтвердите что вы не робот",
    ]
    if any(m in blob for m in hard_markers):
        return True
    # Мягкие маркеры — только если страница почти пустая по товарам
    soft_hits = sum(1 for m in CAPTCHA_MARKERS if m in blob)
    return soft_hits >= 2 and ("product" not in blob and "товар" not in blob)


EXTRACT_PRODUCTS_JS = r"""
({ baseUrl, minSize }) => {
  const MIN = minSize || 250;
  const badUrl = (u) => {
    if (!u) return true;
    const s = String(u).toLowerCase();
    if (s.startsWith("data:")) return true;
    if (s.includes(".svg")) return true;
    const tokens = [
      "logo", "icon", "sprite", "banner", "promo", "favicon",
      "avatar", "placeholder", "stub", "badge", "payment",
      "social", "footer", "header", "emoji", "pixel", "tracking", "1x1"
    ];
    return tokens.some(t => s.includes(t));
  };

  const pickSrcset = (srcset) => {
    if (!srcset) return null;
    let best = null;
    let bestScore = -1;
    for (const part of srcset.split(",")) {
      const bits = part.trim().split(/\s+/);
      if (!bits.length) continue;
      let score = 0;
      if (bits[1]) {
        const d = bits[1].toLowerCase();
        if (d.endsWith("w")) score = parseFloat(d) || 0;
        else if (d.endsWith("x")) score = (parseFloat(d) || 0) * 1000;
      }
      if (score > bestScore) {
        bestScore = score;
        best = bits[0];
      }
    }
    return best;
  };

  const abs = (u) => {
    try { return new URL(u, baseUrl).href; } catch (e) { return null; }
  };

  const header = document.querySelector("header");
  const footer = document.querySelector("footer");
  const inHeaderOrFooter = (el) => {
    if (!el) return false;
    if (header && header.contains(el)) return true;
    if (footer && footer.contains(el)) return true;
    // Часто шапка/подвал без тегов header/footer
    let p = el;
    for (let i = 0; i < 8 && p; i++) {
      const cls = (p.className && String(p.className).toLowerCase()) || "";
      const id = (p.id && String(p.id).toLowerCase()) || "";
      const role = (p.getAttribute && (p.getAttribute("role") || "").toLowerCase()) || "";
      if (
        cls.includes("header") || cls.includes("footer") ||
        cls.includes("navbar") || cls.includes("nav-bar") ||
        id.includes("header") || id.includes("footer") ||
        role === "banner" || role === "contentinfo"
      ) return true;
      p = p.parentElement;
    }
    return false;
  };

  const cardSelectors = [
    '[data-qa="product-card"]',
    '[data-testid="product-card"]',
    ".product-card",
    ".catalog-2-level-product-card",
    'a[href*="/products/"]',
    '[class*="ProductCard"]',
    '[class*="product-card"]',
    '[class*="catalog-item"]',
    'article[class*="product"]',
  ];

  let cards = [];
  for (const sel of cardSelectors) {
    const found = Array.from(document.querySelectorAll(sel));
    if (found.length) {
      cards = found;
      break;
    }
  }

  // Fallback: ссылки на товары, содержащие изображение
  if (!cards.length) {
    cards = Array.from(document.querySelectorAll('a[href*="/products/"]'))
      .filter(a => a.querySelector("img"));
  }

  const results = [];
  const seen = new Set();

  const pushImg = (img, productNameHint) => {
    if (!img || inHeaderOrFooter(img)) return;

    const naturalW = img.naturalWidth || 0;
    const naturalH = img.naturalHeight || 0;
    const attrW = parseInt(img.getAttribute("width") || "0", 10) || 0;
    const attrH = parseInt(img.getAttribute("height") || "0", 10) || 0;
    const w = Math.max(naturalW, attrW);
    const h = Math.max(naturalH, attrH);

    // Если размеры ещё не известны (ленивая загрузка), не отбрасываем сразу —
    // окончательная проверка будет после скачивания.
    if ((naturalW > 0 && naturalH > 0) && (naturalW < MIN || naturalH < MIN)) {
      return;
    }
    if ((attrW > 0 && attrH > 0) && (attrW < MIN || attrH < MIN) && naturalW === 0) {
      return;
    }

    let url = pickSrcset(img.getAttribute("srcset") || img.srcset || "");
    if (!url) {
      url = img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src")
        || img.getAttribute("data-original") || img.getAttribute("data-lazy-src") || "";
    }
    // Иногда большой URL лежит в data-srcset
    if (!url || badUrl(url)) {
      const ds = pickSrcset(img.getAttribute("data-srcset") || "");
      if (ds) url = ds;
    }
    url = abs(url);
    if (!url || badUrl(url)) return;
    if (seen.has(url)) return;
    seen.add(url);

    let name = (productNameHint || img.getAttribute("alt") || img.alt || "").trim();
    if (!name) {
      const card = img.closest('a, article, [class*="product"], [data-qa*="product"]');
      if (card) {
        const t = card.querySelector('[class*="title"], [class*="name"], h2, h3, h4');
        if (t) name = (t.textContent || "").trim();
      }
    }
    if (!name) name = "product";

    results.push({
      product_name: name.slice(0, 300),
      image_url: url,
      width: w,
      height: h,
    });
  };

  if (cards.length) {
    for (const card of cards) {
      if (inHeaderOrFooter(card)) continue;
      const nameEl = card.querySelector(
        '[class*="title"], [class*="name"], [data-qa*="name"], h2, h3, h4, span'
      );
      let hint = "";
      if (nameEl) hint = (nameEl.textContent || "").trim();
      if (!hint) hint = (card.getAttribute("title") || card.getAttribute("aria-label") || "").trim();

      const imgs = Array.from(card.querySelectorAll("img"));
      // Берём самое крупное/первое товарное изображение карточки
      let best = null;
      let bestArea = -1;
      for (const img of imgs) {
        if (inHeaderOrFooter(img)) continue;
        const nw = img.naturalWidth || parseInt(img.getAttribute("width") || "0", 10) || 0;
        const nh = img.naturalHeight || parseInt(img.getAttribute("height") || "0", 10) || 0;
        const area = nw * nh;
        let url = pickSrcset(img.getAttribute("srcset") || img.srcset || "")
          || img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src") || "";
        url = abs(url);
        if (!url || badUrl(url)) continue;
        if (area >= bestArea) {
          bestArea = area;
          best = img;
        }
      }
      if (best) pushImg(best, hint || (best.alt || ""));
    }
  } else {
    // Последний запасной вариант: все крупные img в main
    const root = document.querySelector("main") || document.body;
    for (const img of root.querySelectorAll("img")) {
      pushImg(img, "");
    }
  }

  return results;
}
"""


class MetroDownloader:
    def __init__(
        self,
        catalog_url: str,
        start_page: int,
        end_page: int,
        save_dir: Path,
        log: Callable[[str], None],
        progress: Callable[[int, int], None],
        should_stop: Callable[[], bool],
    ) -> None:
        self.catalog_url = catalog_url.strip()
        self.start_page = start_page
        self.end_page = end_page
        self.save_dir = Path(save_dir)
        self.log = log
        self.progress = progress
        self.should_stop = should_stop

        self.seen_urls: set[str] = set()
        self.seen_hashes: set[str] = set()
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})

        self.site_dir = self.save_dir / "downloads" / SITE_NAME
        self.site_dir.mkdir(parents=True, exist_ok=True)
        self.csv_path = self.site_dir / "products.csv"
        self._ensure_csv()
        self._load_existing_dedup()

    def _ensure_csv(self) -> None:
        if not self.csv_path.exists():
            with self.csv_path.open("w", encoding="utf-8-sig", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
                writer.writeheader()

    def _load_existing_dedup(self) -> None:
        """Подгружает уже сохранённые URL и хеши файлов, чтобы не дублировать."""
        try:
            with self.csv_path.open("r", encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    url = (row.get("image_url") or "").strip()
                    if url:
                        self.seen_urls.add(url)
        except Exception as exc:
            self.log(f"Предупреждение: не удалось прочитать CSV: {exc}")

        try:
            for path in self.site_dir.rglob("*"):
                if path.is_file() and path.suffix.lower() in {
                    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp",
                }:
                    try:
                        self.seen_hashes.add(content_hash(path.read_bytes()))
                    except Exception:
                        continue
        except Exception as exc:
            self.log(f"Предупреждение: не удалось просканировать файлы: {exc}")

        if self.seen_urls or self.seen_hashes:
            self.log(
                f"Загружено для дедупликации: URL={len(self.seen_urls)}, "
                f"файлов={len(self.seen_hashes)}"
            )

    def append_csv(self, row: dict) -> None:
        with self.csv_path.open("a", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
            writer.writerow(row)

    def check_stop(self) -> None:
        if self.should_stop():
            raise StopRequested()

    def slow_scroll(self, page) -> None:
        """Медленная прокрутка для подгрузки lazy-изображений."""
        self.log("Прокрутка страницы для загрузки изображений...")
        try:
            total_height = page.evaluate("() => document.body.scrollHeight") or 0
        except Exception:
            total_height = 3000

        viewport = 800
        position = 0
        step = 400
        while position < total_height + viewport:
            self.check_stop()
            page.evaluate(f"window.scrollTo(0, {position})")
            page.wait_for_timeout(350)
            position += step
            try:
                new_height = page.evaluate("() => document.body.scrollHeight") or total_height
                if new_height > total_height:
                    total_height = new_height
            except Exception:
                pass

        # Вверх и снова вниз — иногда помогает догрузить картинки
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(300)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(800)

    def extract_products(self, page, page_url: str) -> list[ProductImage]:
        raw = page.evaluate(
            EXTRACT_PRODUCTS_JS,
            {"baseUrl": page_url, "minSize": MIN_IMAGE_SIZE},
        )
        products: list[ProductImage] = []
        for item in raw or []:
            url = (item.get("image_url") or "").strip()
            if not url or looks_like_svg(url) or is_ui_or_non_product_url(url):
                continue
            products.append(
                ProductImage(
                    product_name=(item.get("product_name") or "product").strip(),
                    image_url=url,
                    width=int(item.get("width") or 0),
                    height=int(item.get("height") or 0),
                )
            )
        return products

    def download_image(self, image: ProductImage, page_num: int, page_url: str, page_dir: Path) -> bool:
        url = image.image_url
        if url in self.seen_urls:
            self.log(f"  Пропуск дубликата URL: {url}")
            return False
        if looks_like_svg(url) or is_ui_or_non_product_url(url):
            self.log(f"  Пропуск нетоварного изображения: {url}")
            return False

        try:
            resp = self.session.get(url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
        except Exception as exc:
            self.log(f"  Ошибка загрузки {url}: {exc}")
            return False

        content_type = resp.headers.get("Content-Type", "")
        data = resp.content
        if not data:
            self.log(f"  Пустой ответ для {url}")
            return False
        if "svg" in content_type.lower() or data.lstrip().startswith(b"<svg"):
            self.log(f"  Пропуск SVG: {url}")
            return False

        # Фильтр по размеру через Pillow, если доступен; иначе — эвристика по natural size
        width, height = image.width, image.height
        try:
            from io import BytesIO
            from PIL import Image

            with Image.open(BytesIO(data)) as im:
                width, height = im.size
        except Exception:
            pass

        if width and height and (width < MIN_IMAGE_SIZE or height < MIN_IMAGE_SIZE):
            self.log(f"  Пропуск маленького изображения {width}x{height}: {url}")
            return False

        file_hash = content_hash(data)
        if file_hash in self.seen_hashes:
            self.log(f"  Пропуск дубликата содержимого: {url}")
            self.seen_urls.add(url)
            return False

        ext = extension_from_url_and_content(url, content_type, data)
        safe_name = sanitize_filename(image.product_name)
        filename = f"{safe_name}_p{page_num}_{short_url_hash(url)}{ext}"
        filepath = page_dir / filename

        # Если файл уже есть — добавим суффикс
        counter = 1
        while filepath.exists():
            filename = f"{safe_name}_p{page_num}_{short_url_hash(url)}_{counter}{ext}"
            filepath = page_dir / filename
            counter += 1

        try:
            filepath.write_bytes(data)
        except Exception as exc:
            self.log(f"  Ошибка сохранения {filepath}: {exc}")
            return False

        self.seen_urls.add(url)
        self.seen_hashes.add(file_hash)

        rel_image = str(filepath.relative_to(self.site_dir)).replace("\\", "/")
        self.append_csv(
            {
                "site": SITE_NAME,
                "page": page_num,
                "product_name": image.product_name,
                "image_file": rel_image,
                "image_url": url,
                "source_page_url": page_url,
            }
        )
        self.log(f"  Сохранено: {filename}")
        return True

    def run(self) -> None:
        if sync_playwright is None:
            raise RuntimeError(
                "Playwright не установлен. Запустите install.bat или:\n"
                "python -m pip install -r requirements.txt\n"
                "python -m playwright install chromium"
            )

        if not self.catalog_url:
            raise ValueError("Не указана ссылка на каталог.")
        if "metro-cc.ru" not in urlparse(self.catalog_url).netloc:
            raise ValueError("Сейчас поддерживается только сайт METRO (online.metro-cc.ru).")
        if self.start_page < 1 or self.end_page < self.start_page:
            raise ValueError("Некорректный диапазон страниц.")

        total_pages = self.end_page - self.start_page + 1
        saved_total = 0
        self.progress(0, total_pages)

        self.log(f"Папка сохранения: {self.site_dir}")
        self.log(f"CSV: {self.csv_path}")
        self.log(f"Диапазон страниц: {self.start_page}–{self.end_page}")

        with sync_playwright() as p:
            self.log("Запуск Chromium...")
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=USER_AGENT,
                locale="ru-RU",
                viewport={"width": 1400, "height": 900},
            )
            page = context.new_page()
            page.set_default_timeout(60000)

            try:
                for idx, page_num in enumerate(range(self.start_page, self.end_page + 1), start=1):
                    self.check_stop()
                    page_url = set_page_param(self.catalog_url, page_num)
                    self.log(f"Открывается страница {page_num}: {page_url}")

                    try:
                        page.goto(page_url, wait_until="domcontentloaded")
                        page.wait_for_timeout(1500)
                        try:
                            page.wait_for_load_state("networkidle", timeout=15000)
                        except PlaywrightTimeoutError:
                            self.log("  Предупреждение: networkidle не достигнут, продолжаем...")
                    except Exception as exc:
                        self.log(f"Ошибка открытия страницы {page_num}: {exc}")
                        self.progress(idx, total_pages)
                        continue

                    try:
                        text = page.inner_text("body")
                        html = page.content()
                    except Exception:
                        text, html = "", ""

                    if page_has_captcha(text, html):
                        self.log("Обнаружена CAPTCHA или антибот-защита. Работа остановлена.")
                        raise CaptchaDetected(
                            "Сайт показал CAPTCHA или защиту от ботов.\n"
                            "Программа не обходит CAPTCHA. Откройте страницу в браузере "
                            "и повторите попытку позже."
                        )

                    self.slow_scroll(page)
                    self.check_stop()

                    try:
                        products = self.extract_products(page, page_url)
                    except Exception as exc:
                        self.log(f"Ошибка извлечения товаров на странице {page_num}: {exc}")
                        self.progress(idx, total_pages)
                        continue

                    self.log(f"Найдено изображений товаров: {len(products)}")
                    page_dir = self.site_dir / f"page_{page_num}"
                    page_dir.mkdir(parents=True, exist_ok=True)

                    saved_page = 0
                    for product in products:
                        self.check_stop()
                        try:
                            if self.download_image(product, page_num, page_url, page_dir):
                                saved_page += 1
                                saved_total += 1
                        except StopRequested:
                            raise
                        except Exception as exc:
                            self.log(f"  Ошибка обработки изображения: {exc}")

                    self.log(f"Сохранено на странице {page_num}: {saved_page}")
                    self.progress(idx, total_pages)

            except StopRequested:
                self.log("Остановлено пользователем.")
            except CaptchaDetected:
                raise
            finally:
                try:
                    context.close()
                except Exception:
                    pass
                try:
                    browser.close()
                except Exception:
                    pass

        self.log(f"Готово. Всего сохранено файлов: {saved_total}")
        self.log(f"Результаты: {self.site_dir}")


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("TINDA Image Downloader")
        self.geometry("780x620")
        self.minsize(680, 520)

        self.save_dir = tk.StringVar(value=str(Path.cwd()))
        self.url_var = tk.StringVar(
            value="https://online.metro-cc.ru/search?q=напитки&category=napitki-105003&page=1"
        )
        self.start_page_var = tk.StringVar(value="1")
        self.end_page_var = tk.StringVar(value="1")

        self._worker: Optional[threading.Thread] = None
        self._stop_flag = threading.Event()

        self._build_ui()

    def _build_ui(self) -> None:
        pad = {"padx": 10, "pady": 6}
        frm = ttk.Frame(self, padding=10)
        frm.pack(fill=tk.BOTH, expand=True)

        title = ttk.Label(frm, text="TINDA Image Downloader", font=("Segoe UI", 16, "bold"))
        title.pack(anchor=tk.W, pady=(0, 4))
        subtitle = ttk.Label(frm, text="Сайт: METRO (online.metro-cc.ru)")
        subtitle.pack(anchor=tk.W, pady=(0, 10))

        ttk.Label(frm, text="Ссылка на страницу каталога:").pack(anchor=tk.W)
        ttk.Entry(frm, textvariable=self.url_var).pack(fill=tk.X, **pad)

        pages = ttk.Frame(frm)
        pages.pack(fill=tk.X, **pad)
        ttk.Label(pages, text="Начальная страница:").grid(row=0, column=0, sticky=tk.W)
        ttk.Entry(pages, textvariable=self.start_page_var, width=8).grid(
            row=0, column=1, sticky=tk.W, padx=(6, 20)
        )
        ttk.Label(pages, text="Конечная страница:").grid(row=0, column=2, sticky=tk.W)
        ttk.Entry(pages, textvariable=self.end_page_var, width=8).grid(
            row=0, column=3, sticky=tk.W, padx=(6, 0)
        )

        folder_row = ttk.Frame(frm)
        folder_row.pack(fill=tk.X, **pad)
        ttk.Label(folder_row, text="Папка сохранения:").pack(side=tk.LEFT)
        ttk.Entry(folder_row, textvariable=self.save_dir).pack(
            side=tk.LEFT, fill=tk.X, expand=True, padx=6
        )
        ttk.Button(folder_row, text="Выбрать папку…", command=self.choose_folder).pack(side=tk.LEFT)

        buttons = ttk.Frame(frm)
        buttons.pack(fill=tk.X, pady=8)
        self.btn_start = ttk.Button(buttons, text="Скачать фотографии", command=self.start_download)
        self.btn_start.pack(side=tk.LEFT)
        self.btn_stop = ttk.Button(buttons, text="Остановить", command=self.stop_download, state=tk.DISABLED)
        self.btn_stop.pack(side=tk.LEFT, padx=8)

        self.progress = ttk.Progressbar(frm, mode="determinate")
        self.progress.pack(fill=tk.X, pady=(4, 8))
        self.progress_label = ttk.Label(frm, text="Готово к работе")
        self.progress_label.pack(anchor=tk.W)

        ttk.Label(frm, text="Журнал работы:").pack(anchor=tk.W, pady=(10, 0))
        self.log_box = scrolledtext.ScrolledText(frm, height=18, wrap=tk.WORD, state=tk.DISABLED)
        self.log_box.pack(fill=tk.BOTH, expand=True, pady=6)

    def choose_folder(self) -> None:
        path = filedialog.askdirectory(initialdir=self.save_dir.get() or str(Path.cwd()))
        if path:
            self.save_dir.set(path)

    def log(self, message: str) -> None:
        def _append() -> None:
            self.log_box.configure(state=tk.NORMAL)
            self.log_box.insert(tk.END, message + "\n")
            self.log_box.see(tk.END)
            self.log_box.configure(state=tk.DISABLED)

        self.after(0, _append)

    def set_progress(self, current: int, total: int) -> None:
        def _upd() -> None:
            self.progress["maximum"] = max(total, 1)
            self.progress["value"] = current
            self.progress_label.configure(text=f"Страниц обработано: {current} / {total}")

        self.after(0, _upd)

    def start_download(self) -> None:
        if self._worker and self._worker.is_alive():
            messagebox.showinfo("TINDA", "Загрузка уже выполняется.")
            return

        url = self.url_var.get().strip()
        if not url:
            messagebox.showerror("Ошибка", "Укажите ссылку на каталог.")
            return

        try:
            start_page = int(self.start_page_var.get().strip())
            end_page = int(self.end_page_var.get().strip())
        except ValueError:
            messagebox.showerror("Ошибка", "Номера страниц должны быть целыми числами.")
            return

        if start_page < 1 or end_page < start_page:
            messagebox.showerror("Ошибка", "Проверьте диапазон страниц.")
            return

        save_dir = Path(self.save_dir.get().strip() or str(Path.cwd()))
        if not save_dir.exists():
            try:
                save_dir.mkdir(parents=True, exist_ok=True)
            except Exception as exc:
                messagebox.showerror("Ошибка", f"Не удалось создать папку:\n{exc}")
                return

        self._stop_flag.clear()
        self.btn_start.configure(state=tk.DISABLED)
        self.btn_stop.configure(state=tk.NORMAL)
        self.progress["value"] = 0
        self.progress_label.configure(text="Запуск...")
        self.log("=" * 60)
        self.log("Старт загрузки фотографий METRO")

        def worker() -> None:
            try:
                downloader = MetroDownloader(
                    catalog_url=url,
                    start_page=start_page,
                    end_page=end_page,
                    save_dir=save_dir,
                    log=self.log,
                    progress=self.set_progress,
                    should_stop=self._stop_flag.is_set,
                )
                downloader.run()
            except CaptchaDetected as exc:
                msg = str(exc)
                self.log(msg)
                self.after(0, lambda m=msg: messagebox.showwarning("CAPTCHA", m))
            except Exception as exc:
                self.log(f"Критическая ошибка: {exc}")
                self.log(traceback.format_exc())
                self.after(0, lambda e=exc: messagebox.showerror("Ошибка", str(e)))
            finally:
                self.after(0, self._on_finished)

        self._worker = threading.Thread(target=worker, daemon=True)
        self._worker.start()

    def stop_download(self) -> None:
        self._stop_flag.set()
        self.log("Запрошена остановка...")
        self.btn_stop.configure(state=tk.DISABLED)

    def _on_finished(self) -> None:
        self.btn_start.configure(state=tk.NORMAL)
        self.btn_stop.configure(state=tk.DISABLED)
        if self.progress_label.cget("text").startswith("Запуск"):
            self.progress_label.configure(text="Завершено")


def main() -> None:
    # На Windows иногда помогает для DPI
    try:
        from ctypes import windll

        windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass

    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
