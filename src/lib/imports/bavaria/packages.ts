import type { PackageCode, ParsedPackVolume } from "./types";

export function normalize_volume_text(ml: number): string {
  if (ml >= 1000 && ml % 1000 === 0) {
    return `${ml / 1000} л`.replace(".", ",");
  }
  if (ml >= 1000) {
    const liters = ml / 1000;
    const text = Number.isInteger(liters)
      ? String(liters)
      : String(liters).replace(".", ",");
    return `${text} л`;
  }
  if (ml % 10 === 0) {
    return `${String(ml / 1000).replace(".", ",")} л`;
  }
  return `${ml} мл`;
}

export function parse_volume_to_ml(num: string, unit: string): number | null {
  const n = Number(num.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = unit.toLowerCase();
  if (u === "л" || u === "l") return Math.round(n * 1000);
  if (u === "мл" || u === "ml") return Math.round(n);
  return null;
}

function detect_package(chunk: string): PackageCode {
  const s = chunk.toLowerCase();
  if (/жб|жестя|алюмин|банк/.test(s)) return "CAN";
  if (/стекл/.test(s)) return "GLASS";
  if (/кег|keg|бочка/.test(s)) return "KEG";
  if (/пэт|pet|спорт-лок|sport/.test(s)) return "PET";
  if (/бутыл/.test(s)) return "PET";
  return "OTHER";
}

export function package_label(code: PackageCode): string {
  switch (code) {
    case "PET":
      return "ПЭТ";
    case "CAN":
      return "банка";
    case "GLASS":
      return "стекло";
    case "KEG":
      return "кег";
    default:
      return "упаковка";
  }
}

/**
 * Parse "ПЭТ-бутылка 1,5 л | Стекло 0,33 л | ЖБ 0,45 л" style fragments.
 */
export function parse_pack_volumes(text: string): ParsedPackVolume[] {
  const blob = text.replace(/\u00a0/g, " ");
  const parts = blob
    .split(/[|/;]|\/(?=\s)/)
    .map((p) => p.trim())
    .filter(Boolean);

  const found: ParsedPackVolume[] = [];
  const seen = new Set<string>();

  const consider = (chunk: string) => {
    // Avoid \\b — Cyrillic letters are non-word chars in JS regex.
    const re = /(\d+[.,]?\d*)\s*(мл|л|ml|l)(?![а-яa-z])/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk))) {
      const ml = parse_volume_to_ml(m[1], m[2]);
      if (ml === null) continue;
      // Prefer package words near the match.
      const start = Math.max(0, m.index - 40);
      const local = chunk.slice(start, m.index + m[0].length + 10);
      const pkg = detect_package(local) !== "OTHER" ? detect_package(local) : detect_package(chunk);
      const volume_text = normalize_volume_text(ml);
      const key = `${ml}|${pkg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        volume_text,
        volume_ml: ml,
        package: pkg,
        package_label: package_label(pkg),
      });
    }
  };

  if (parts.length) {
    for (const part of parts) consider(part);
  } else {
    consider(blob);
  }

  // Format «Формат 0,5 л» without package → OTHER (caller may default later).
  if (!found.length) {
    consider(blob);
  }

  return found;
}

export function detect_carbonation(text: string): "газированная" | "негазированная" | null {
  const s = text.toLowerCase();
  const has_gaz = /газир|сильн.?газир|с газом/.test(s);
  const has_negaz = /негазир|без газа/.test(s);
  if (has_gaz && has_negaz) return null;
  if (has_negaz) return "негазированная";
  if (has_gaz) return "газированная";
  return null;
}

export function detect_sugar(text: string): "с сахаром" | "без сахара" | null {
  const s = text.toLowerCase();
  if (/sugar\s*free|без сахара|0 калорий|без калорий/.test(s)) return "без сахара";
  if (/с сахаром/.test(s)) return "с сахаром";
  return null;
}

/** Split assortment lists: "Груша / Тархун / Кола" */
export function parse_taste_list(text: string): string[] {
  const m = text.match(
    /ассортимент\s*:\s*([^.|\n]+)|(?:ежевика|черешня|виноград)[^.]{0,80}/i,
  );
  let chunk = m ? m[1] || m[0] : "";
  if (!chunk && /\/|/.test(text)) {
    // Hongae style title: "Ежевика | Черешня | ..."
    if (/ежевика|черешня|виноград|шелковица/i.test(text)) {
      chunk = text;
    }
  }
  if (!chunk) return [];
  return chunk
    .replace(/ассортимент\s*:/i, "")
    .split(/[/|]/)
    .map((t) => t.trim())
    .map((t) => t.replace(/^ассортимент\s*:?\s*/i, ""))
    .map((t) => t.replace(/\s*формат\s*\d+[.,]?\d*\s*л\.?/i, "").trim())
    .filter((t) => t.length >= 2 && t.length <= 40)
    .filter((t) => !/пэт|стекл|бутыл|формат|\d+[.,]?\d*\s*л|\d+\s*мл/i.test(t));
}
