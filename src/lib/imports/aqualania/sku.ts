/** Stable AquAlania SKU builder. Latin/digits/hyphens only; order-independent. */

const CYR: Record<string, string> = {
  а: "A",
  б: "B",
  в: "V",
  г: "G",
  д: "D",
  е: "E",
  ё: "E",
  ж: "ZH",
  з: "Z",
  и: "I",
  й: "Y",
  к: "K",
  л: "L",
  м: "M",
  н: "N",
  о: "O",
  п: "P",
  р: "R",
  с: "S",
  т: "T",
  у: "U",
  ф: "F",
  х: "H",
  ц: "TS",
  ч: "CH",
  ш: "SH",
  щ: "SCH",
  ъ: "",
  ы: "Y",
  ь: "",
  э: "E",
  ю: "YU",
  я: "YA",
};

export type AquAlaniaPackageCode = "GLASS" | "PET" | "PETCAN" | "CAN";

export function slug_part(input: string): string {
  const out: string[] = [];
  for (const ch of input.trim().toLowerCase()) {
    if (ch in CYR) out.push(CYR[ch]);
    else if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) out.push(ch.toUpperCase());
    else if (ch === " " || ch === "-" || ch === "_" || ch === "/") out.push("-");
    else out.push("-");
  }
  return out.join("").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function build_aqualania_sku(input: {
  line: string;
  flavor_key: string;
  volume_ml: number;
  package_code: AquAlaniaPackageCode;
}): string {
  const line = slug_part(input.line);
  const flavor = slug_part(input.flavor_key);
  if (!line || !flavor) {
    throw new Error(`Invalid AquAlania SKU parts: line=${input.line} flavor=${input.flavor_key}`);
  }
  return `AQUALANIA-${line}-${flavor}-${input.volume_ml}-${input.package_code}`;
}
