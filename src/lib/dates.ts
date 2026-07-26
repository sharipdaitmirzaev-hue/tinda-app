/** Calendar date YYYY-MM-DD in Europe/Moscow (app locale). */
export function today_date_key(
  time_zone = "Europe/Moscow",
  now: Date = new Date(),
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: time_zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Parse YYYY-MM-DD as UTC midnight date (no local TZ shift). */
export function parse_date_only(yyyy_mm_dd: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyy_mm_dd);
  if (!match) {
    throw new Error("invalid_date");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

export function format_date_only(date: Date): string {
  return date.toISOString().slice(0, 10);
}
