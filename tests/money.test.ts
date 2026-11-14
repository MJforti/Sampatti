import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRupeesToPaise, formatINR, paiseToInput, formatINRCompact } from "../src/lib/money.ts";
import { daysBetween, addDays, todayISO, monthMatrix } from "../src/lib/dates.ts";

test("parse rupees to integer paise without floats", () => {
  assert.equal(parseRupeesToPaise("45,000"), 4500000);
  assert.equal(parseRupeesToPaise("₹1,23,456.5"), 12345650);
  assert.equal(parseRupeesToPaise("0.1"), 10);
  assert.equal(parseRupeesToPaise("1200.05"), 120005);
  assert.equal(parseRupeesToPaise("12.345"), null);
  assert.equal(parseRupeesToPaise("abc"), null);
  assert.equal(parseRupeesToPaise(""), null);
});
test("format INR with Indian grouping", () => {
  assert.equal(formatINR(4500000), "₹45,000");
  assert.equal(formatINR(123456789), "₹12,34,567.89");
  assert.equal(formatINR(-50), "-₹0.50");
  assert.equal(formatINR(null), "Not set");
  assert.equal(paiseToInput(120005), "1200.05");
  assert.equal(formatINRCompact(1234567800), "₹1.23 Cr");
});
test("calendar arithmetic", () => {
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(daysBetween("2026-03-01", "2026-02-27"), -2);
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(todayISO("Asia/Kolkata", new Date("2026-11-14T20:00:00Z")), "2026-11-15");
  assert.equal(monthMatrix(2026, 10)[0][0], "2026-10-26");
});

import { amortise, rateToE4 } from "../src/lib/loan.ts";
test("loan amortisation in integer paise", () => {
  assert.equal(rateToE4("9.5"), 95000n);
  // ₹10,00,000 @ 12% with EMI ₹22,244.45 ≈ 60 months
  const s = amortise(100000000, "12", 2224445, "2026-12-05");
  assert.equal(s.feasible, true);
  assert.equal(s.rows[0].interest, 1000000);
  assert.ok(s.rows.length === 60 || s.rows.length === 61);
  assert.equal(s.rows.at(-1)!.balance, 0);
  assert.equal(amortise(100000000, "12", 1000000, "2026-12-05").feasible, false);
});
