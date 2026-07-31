/** Minimal CSV writer (UTF-8, RFC-ish quoting). */
export function to_csv(
  rows: Array<Record<string, string | number | boolean | null | undefined>>,
  columns?: string[],
): string {
  if (!rows.length && !columns?.length) return "";
  const cols =
    columns ||
    Array.from(
      rows.reduce((set, row) => {
        Object.keys(row).forEach((k) => set.add(k));
        return set;
      }, new Set<string>()),
    );
  const escape = (value: unknown) => {
    const s = value == null ? "" : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(cols.map((c) => escape(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}
