// Shared cash-outflow logic for the Cash outflow page and Reports exports.
import { paiseToInput, sumPaise } from "./money";

export type OutflowRow = { entity_id: string; month: string; category: string; amount_paise: number; items: number };

export const OUTFLOW_GROUPS: [string, string, (c: string) => boolean][] = [
  ["invest", "SIPs & recurring deposits", (c) => c === "sip" || c === "recurring_deposit"],
  ["loan", "Loan EMIs", (c) => c === "loan_emi"],
  ["insurance", "Insurance premiums", (c) => c.startsWith("insurance")],
  ["vehicle", "Vehicle costs", (c) => c.startsWith("vehicle")],
  ["other", "Other payments", () => true],
];
export const outflowGroup = (c: string) => OUTFLOW_GROUPS.find(([, , f]) => f(c))!;

export const monthLabel = (k: string, style: "short" | "long" = "short") =>
  new Intl.DateTimeFormat("en-IN", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" }).format(new Date(k + "T00:00:00Z"));

/** Month keys (YYYY-MM-01) for the next n months, starting at the first month in the data (or this month). */
export function outflowMonths(rows: OutflowRow[], n: number, today = new Date().toISOString().slice(0, 10)): string[] {
  const start = [...rows.map((r) => r.month)].sort()[0] ?? today.slice(0, 8) + "01";
  const [y, m] = start.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 10));
}

/** Spreadsheet rows: month×profile, month×type, then detail. Amounts in rupees as plain numbers. */
export function outflowSheet(rows: OutflowRow[], keys: string[], name: (id: string) => string, title: string): (string | number)[][] {
  const data = rows.filter((r) => keys.includes(r.month));
  const profiles = [...new Set(data.map((r) => r.entity_id))].sort((a, b) => name(a).localeCompare(name(b)));
  const groups = OUTFLOW_GROUPS.filter(([k]) => data.some((r) => outflowGroup(r.category)[0] === k));
  const cell = (f: (r: OutflowRow) => boolean) => paiseToInput(sumPaise(data.filter(f).map((r) => r.amount_paise))) || "0";
  return [
    [`Cash outflow: ${title}`, `Next ${keys.length} months from ${monthLabel(keys[0], "long")}`],
    ["Amounts in ₹. Projected from each recurring payment’s next due date and how often it repeats."],
    [],
    ["Month by profile (₹)", ...profiles.map(name), "Total"],
    ...keys.map((k) => [monthLabel(k, "long"), ...profiles.map((id) => cell((r) => r.month === k && r.entity_id === id)), cell((r) => r.month === k)]),
    ["Total", ...profiles.map((id) => cell((r) => r.entity_id === id)), cell(() => true)],
    [],
    ["Month by type (₹)", ...groups.map(([, l]) => l), "Total"],
    ...keys.map((k) => [monthLabel(k, "long"), ...groups.map(([g]) => cell((r) => r.month === k && outflowGroup(r.category)[0] === g)), cell((r) => r.month === k)]),
    ["Total", ...groups.map(([g]) => cell((r) => outflowGroup(r.category)[0] === g)), cell(() => true)],
    [],
    ["Profile", "Type", "Month", "Payments", "Amount (₹)"],
    ...[...data].sort((a, b) => a.month.localeCompare(b.month) || name(a.entity_id).localeCompare(name(b.entity_id)))
      .map((r) => [name(r.entity_id), outflowGroup(r.category)[1], monthLabel(r.month, "long"), r.items, paiseToInput(r.amount_paise)]),
  ];
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const body = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" })); // BOM so Excel reads ₹ and names
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.csv` });
  a.click(); URL.revokeObjectURL(url);
}
