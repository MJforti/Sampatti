// Estimated amortisation using integer paise and an integer rate (1e-4 %), rounded half-up each month.

export function rateToE4(rate: string | number): bigint {
  const s = String(rate).trim();
  const m = /^(\d+)(?:\.(\d{0,4})\d*)?$/.exec(s);
  if (!m) return 0n;
  return BigInt(m[1]) * 10000n + BigInt((m[2] ?? "").padEnd(4, "0") || "0");
}

export type ScheduleRow = { n: number; date: string; emi: number; interest: number; principal: number; balance: number };

export function amortise(outstandingPaise: number, rate: string | number, emiPaise: number, firstDate: string, maxMonths = 480): { rows: ScheduleRow[]; totalInterest: number; feasible: boolean } {
  const r = rateToE4(rate);
  let bal = BigInt(outstandingPaise);
  const emi = BigInt(emiPaise);
  const rows: ScheduleRow[] = [];
  let totalInterest = 0n;
  const [y, mo, d] = firstDate.split("-").map(Number);
  for (let n = 1; n <= maxMonths && bal > 0n; n++) {
    const interest = (bal * r * 2n + 12_000_000n) / 24_000_000n; // half-up of bal*r/12e6
    if (emi <= interest) return { rows, totalInterest: Number(totalInterest), feasible: false };
    let principal = emi - interest;
    let pay = emi;
    if (principal > bal) { principal = bal; pay = bal + interest; }
    bal -= principal;
    totalInterest += interest;
    const dt = new Date(Date.UTC(y, mo - 1 + (n - 1), 1));
    const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(d, last));
    rows.push({ n, date: dt.toISOString().slice(0, 10), emi: Number(pay), interest: Number(interest), principal: Number(principal), balance: Number(bal) });
  }
  return { rows, totalInterest: Number(totalInterest), feasible: bal === 0n };
}
