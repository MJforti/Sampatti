export const DEFAULT_TZ = "Asia/Kolkata";

/** Today's calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayISO(tz = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Pure calendar-day difference b - a for YYYY-MM-DD strings (no timezone drift). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function formatDate(iso: string | null | undefined, style: "long" | "short" = "long"): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC", day: "numeric", month: style === "long" ? "long" : "short", year: "numeric",
  }).format(dt);
}

export function relativeDays(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${-days} days overdue`;
  return `In ${days} days`;
}

export function monthMatrix(year: number, month0: number): string[][] {
  // Monday-first weeks covering the month
  const first = new Date(Date.UTC(year, month0, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month0, 1 - offset));
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: string[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(start.getTime() + (w * 7 + d) * 86_400_000).toISOString().slice(0, 10));
    }
    weeks.push(row);
    if (new Date(start.getTime() + (w * 7 + 7) * 86_400_000).getUTCMonth() !== month0 && w >= 3) break;
  }
  return weeks;
}
