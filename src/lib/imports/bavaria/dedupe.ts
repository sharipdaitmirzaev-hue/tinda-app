import type {
  ExistingCatalogProduct,
  PossibleDuplicate,
  ProposedProduct,
} from "./types";

function norm(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function package_norm(s: string | null | undefined): string {
  const v = norm(s);
  if (/пэт|pet/.test(v)) return "pet";
  if (/стекл|glass/.test(v)) return "glass";
  if (/банк|жб|can|жест/.test(v)) return "can";
  if (/кег|keg/.test(v)) return "keg";
  return v;
}

function volume_norm(s: string | null | undefined): string {
  const v = norm(s).replace(",", ".");
  const m = v.match(/(\d+(?:\.\d+)?)\s*(л|мл)/);
  if (!m) return v;
  const n = Number(m[1]);
  const u = m[2];
  const ml = u === "л" ? Math.round(n * 1000) : Math.round(n);
  return String(ml);
}

/**
 * Possible duplicates only — never auto-update existing rows.
 * Different taste/volume/package/sugar/carbonation are NOT duplicates.
 */
export function find_possible_duplicates(
  proposed: ProposedProduct[],
  existing: ExistingCatalogProduct[],
): { proposed: ProposedProduct[]; duplicates: PossibleDuplicate[] } {
  const duplicates: PossibleDuplicate[] = [];
  const out = proposed.map((p) => ({ ...p }));

  for (const item of out) {
    for (const ex of existing) {
      const same_brand =
        norm(item.brand) &&
        norm(ex.brand) &&
        (norm(item.brand) === norm(ex.brand) ||
          norm(ex.name).includes(norm(item.brand)));
      const same_vol =
        volume_norm(item.volume) &&
        volume_norm(ex.volume_text) &&
        volume_norm(item.volume) === volume_norm(ex.volume_text);
      const same_pkg =
        package_norm(item.package) &&
        package_norm(ex.package_type) &&
        package_norm(item.package) === package_norm(ex.package_type);
      const name_overlap =
        norm(ex.name).includes(norm(item.taste || "")) &&
        Boolean(item.taste) &&
        same_brand &&
        same_vol;

      if (same_brand && same_vol && same_pkg && name_overlap) {
        item.duplicate_status = "possible_duplicate";
        duplicates.push({
          proposed_sku: item.proposed_sku,
          proposed_name: item.proposed_name,
          existing_sku: ex.sku,
          existing_name: ex.name,
          confidence: "medium",
          reason: "Совпадение бренда + вкуса + объёма + тары с существующей карточкой",
        });
        break;
      }

      if (
        same_brand &&
        same_vol &&
        same_pkg &&
        norm(ex.name).includes(norm(item.brand))
      ) {
        // weaker
        item.duplicate_status = "possible_duplicate";
        duplicates.push({
          proposed_sku: item.proposed_sku,
          proposed_name: item.proposed_name,
          existing_sku: ex.sku,
          existing_name: ex.name,
          confidence: "low",
          reason: "Частичное совпадение бренда/объёма/тары — проверить вручную",
        });
        break;
      }
    }
  }

  return { proposed: out, duplicates };
}

export function assert_no_alcohol_in_proposed(proposed: ProposedProduct[]): string[] {
  const bad: string[] = [];
  for (const p of proposed) {
    if (
      p.alcohol_percent !== null &&
      p.alcohol_percent > 0.5 &&
      p.import_status === "proposed"
    ) {
      bad.push(p.proposed_sku);
    }
    if (/пиво(?!\s*безалкогол)/i.test(p.proposed_name) && p.category !== "Безалкогольное пиво") {
      // soft check
    }
  }
  return bad;
}

export function find_sku_collisions(proposed: ProposedProduct[]): string[] {
  const seen = new Map<string, string>();
  const dups: string[] = [];
  for (const p of proposed) {
    if (seen.has(p.proposed_sku)) dups.push(p.proposed_sku);
    else seen.set(p.proposed_sku, p.proposed_name);
  }
  return dups;
}

export function find_identity_collisions(proposed: ProposedProduct[]): string[] {
  const seen = new Map<string, string>();
  const dups: string[] = [];
  for (const p of proposed) {
    const key = [
      norm(p.brand),
      norm(p.taste),
      volume_norm(p.volume),
      package_norm(p.package),
      norm(p.carbonation),
      norm(p.sugar),
    ].join("|");
    if (seen.has(key)) dups.push(`${p.proposed_sku}~~${seen.get(key)}`);
    else seen.set(key, p.proposed_sku);
  }
  return dups;
}
