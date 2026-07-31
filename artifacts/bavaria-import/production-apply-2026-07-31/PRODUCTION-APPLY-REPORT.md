# Production apply report — Bavaria (PR #18)

**Status: SUCCESS**  
Host: `134.0.116.84` (`tindamarket.ru`)  
Operator confirmation: explicit apply approval in chat  
Code used: worktree `/opt/tinda/bavaria-pr18-worktree` @ `fa822ea` (`cursor/import-bavaria-nonalcoholic-f733`)

---

## Backup (pre-apply)

| Field | Value |
|-------|-------|
| Path | `/opt/tinda/app/backups/tinda-prod-bavaria-20260731-124107.sql` |
| Size | 228 867 bytes |
| SHA-256 | `fc7227bf3cb42deae7d60333ec50e5cb11fb4ab8ddb44dbb02f38bbcb0d9594f` |

---

## Apply #1 (create)

| Field | Value |
|-------|-------|
| Artifact | `artifacts/bavaria-import/2026-07-31T12-50-26-410Z-apply/` |
| Started / finished | `2026-07-31T12:50:26.410Z` → `2026-07-31T12:50:56.544Z` |
| Manifest | `latest-pdf-reviewed/approved-import-manifest.json` |
| PDF SHA-256 | `e93756ed45acecb1335e562aa4f9d455899c0b846fb9bb1bc6b3f33af436da93` |
| Approved input | **164** |
| **Created** | **164** |
| **Skipped** | **0** |
| **Errors** | **0** |
| Existing products edited | **false** |
| Fingerprint mismatches | **[]** |
| Images uploaded | **103** |
| Images missing (no source) | **61** |
| NA beer SKUs created | **7** |
| Catalog total after | **623** |

### Category rename (UUID kept)

| | Before | After |
|--|--------|-------|
| id | `8e8d04e4-d3af-4448-bc58-bde0594dc772` | same |
| name | Солодовые напитки | **Безалкогольное пиво** |
| slug | `solodovye-napitki` | **`non-alcoholic-beer`** |

Existing Barbican in category before rename: **7** SKUs (`ZY-BARBICAN-330-GLASS-001`…`007`).  
`existing_products_modified`: **false** (product rows not edited).

### Created distribution by category

| Category | Count |
|----------|------:|
| Газированные напитки | 80 |
| Питьевая вода | 33 |
| Холодный чай | 18 |
| Энергетические напитки | 12 |
| Безалкогольное пиво | 7 |
| Тоники | 6 |
| Квас | 5 |
| Минеральная вода | 3 |
| **Total** | **164** |

---

## Apply #2 (idempotency)

| Field | Value |
|-------|-------|
| Artifact | `artifacts/bavaria-import/2026-07-31T12-56-19-625Z-apply/` |
| Started / finished | `2026-07-31T12:56:19.626Z` → `2026-07-31T12:56:19.910Z` |
| **Created** | **0** |
| **Skipped** | **164** |
| **Errors** | **0** |
| Existing products edited | **false** |
| Fingerprint mismatches | **[]** |
| Images uploaded | **0** |
| Catalog total after | **623** (unchanged) |

**Verdict: import is idempotent.**

---

## DB post-check (after both applies)

| Check | Result |
|-------|--------|
| Bavaria SKUs | **164** |
| All `showcase` | **164** |
| With `price_amount` | **0** |
| `orderable` | **0** |
| With `image_url` | **106** |
| Manual SKUs leaked | **0** |
| Category `non-alcoholic-beer` / «Безалкогольное пиво» | present |
| Old malt slug/name / `bezalkogolnoe-pivo` | absent |
| In NA beer: Bavaria + Barbican | **7 + 7 = 14** |
| Catalog total | **623** |

---

## Public site checks (`https://tindamarket.ru`)

| Check | Result |
|-------|--------|
| `GET /api/v1/catalog/products?q=BAVARIA` | `total=164` |
| Category «Безалкогольное пиво» / `non-alcoholic-beer` | present |
| Products in NA beer category | `total=14` (7 Bavaria + 7 Barbican) |
| Manual SKUs in catalog search | absent |
| Sample Bavaria image URLs | **HTTP 200** (`image/webp`) after ops fix below |

### Image serving ops note

New files were written into volume `app_tinda_uploads` as `root:root` by the one-shot Docker apply container. Next.js also needed a process restart to serve newly created public files.

Fixed on VPS:

```bash
chown -R 1001:1001 /var/lib/docker/volumes/app_tinda_uploads/_data
cd /opt/tinda/app && docker compose -f docker-compose.production.yml restart app
```

After that, sample Bavaria `/uploads/products/.../*.webp` returned **200**.

---

## What was not imported

- Manual review SKUs (5) — not in DB  
- Rejected / wholesale — not in approved manifest / not created  
- No prices, no `orderable`, create-only (no `--merge`)

---

## Artifacts in this folder

- `apply-result-first.json` — production create apply  
- `apply-result-idempotent.json` — second apply (0/164)  
- `PRODUCTION-APPLY-REPORT.md` — this report  

VPS console logs: `/opt/tinda/app/backups/bavaria-apply-console.log`, `bavaria-apply-idempotent.log`
