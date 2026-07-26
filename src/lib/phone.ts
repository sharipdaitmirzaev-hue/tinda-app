/** Normalize Russian phone to +7XXXXXXXXXX or null if invalid. */
export function normalize_ru_phone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let normalized = digits;

  if (normalized.length === 11 && normalized.startsWith("8")) {
    normalized = `7${normalized.slice(1)}`;
  }
  if (normalized.length === 10 && normalized.startsWith("9")) {
    normalized = `7${normalized}`;
  }

  if (normalized.length === 11 && normalized.startsWith("7")) {
    return `+${normalized}`;
  }

  return null;
}
