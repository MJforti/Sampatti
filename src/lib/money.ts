// All money is integer paise. Parsing and formatting never touch floating point.

/** Parse user input like "45,000", "₹1,23,456.5", "1200.05" into integer paise. Returns null if invalid/empty. */
export function parseRupeesToPaise(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₹,\s]/g, "").trim();
  if (s === "") return null;
  const m = /^(-)?(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const rupees = BigInt(m[2]);
  const paise = BigInt((m[3] ?? "").padEnd(2, "0") || "0");
  const total = rupees * 100n + paise;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(m[1] ? -total : total);
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const tail = digits.slice(-3);
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${head},${tail}`;
}

/** 4500000 -> "₹45,000"; 123456789 -> "₹12,34,567.89" */
export function formatINR(paise: number | string | null | undefined, opts: { showPaise?: boolean } = {}): string {
  if (paise === null || paise === undefined || paise === "") return "—";
  const n = BigInt(typeof paise === "string" ? paise : Math.trunc(paise));
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const rupees = (abs / 100n).toString();
  const p = (abs % 100n).toString().padStart(2, "0");
  const showP = opts.showPaise ?? p !== "00";
  return `${neg ? "-" : ""}₹${groupIndian(rupees)}${showP ? "." + p : ""}`;
}

/** Compact: ₹4.5 L, ₹1.2 Cr — display only. */
export function formatINRCompact(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  const rupees = Math.trunc(paise / 100);
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}₹${trim(abs / 1_00_00_000)} Cr`;
  if (abs >= 1_00_000) return `${sign}₹${trim(abs / 1_00_000)} L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)} K`;
  return `${sign}₹${abs}`;
}
function trim(x: number) {
  return (Math.floor(x * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
}

/** paise -> editable string "45000.50" */
export function paiseToInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const n = BigInt(Math.trunc(paise));
  const abs = n < 0n ? -n : n;
  const p = (abs % 100n).toString().padStart(2, "0");
  return `${n < 0n ? "-" : ""}${abs / 100n}${p === "00" ? "" : "." + p}`;
}

export function sumPaise(values: Array<number | null | undefined>): number {
  return values.reduce<number>((a, v) => a + (v ?? 0), 0);
}
