"use client";
import { Download, Printer } from "lucide-react";
import { useApp } from "@/components/providers";
import { Button, ErrorState, ListSkeleton, PageHeader, SectionTitle } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { addDays, todayISO } from "@/lib/dates";
import { formatINR, paiseToInput, sumPaise } from "@/lib/money";
import { OPEN_STATUSES, isInflow } from "@/lib/status";
import type { CalEvent } from "@/components/obligations";

type S = Record<string, number>;

function csv(name: string, rows: (string | number)[][]) {
  const body = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.csv` });
  a.click(); URL.revokeObjectURL(url);
}

export default function Reports() {
  const { entities, tz } = useApp();
  const today = todayISO(tz);
  const q = useQuery(async () => {
    const sb = supabase();
    const fam = unwrap(await sb.rpc("dashboard_summary", { p_entity: null })) as S;
    const per = await Promise.all(entities.map(async (e) => ({ e, s: unwrap(await sb.rpc("dashboard_summary", { p_entity: e.id })) as S })));
    const ev = unwrap(await sb.from("financial_calendar_events").select("*").in("status", OPEN_STATUSES).lte("event_date", addDays(today, 90))) as CalEvent[];
    const paid = unwrap(await sb.from("financial_calendar_events").select("*").in("status", ["paid"]).gte("paid_on", today.slice(0, 8) + "01")) as CalEvent[];
    return { fam, per, ev: ev.filter((e) => !isInflow(e.category)), paid };
  }, [entities, today]);

  if (q.error) return <ErrorState error={q.error} retry={q.reload} />;
  if (q.loading || !q.data) return <div><PageHeader title="Reports" back="/more" /><ListSkeleton rows={6} /></div>;
  const { fam, per, ev, paid } = q.data;
  const buckets = [30, 60, 90].map((d) => ({ d, v: sumPaise(ev.filter((e) => e.event_date <= addDays(today, d)).map((e) => e.amount_paise)) }));
  const max = Math.max(1, ...buckets.map((b) => b.v));
  const banks = new Map<string, { label: string; v30: number; n: number }>();
  for (const e of ev.filter((x) => x.event_date <= addDays(today, 30))) {
    const k = e.bank_account_id ?? "none";
    const cur = banks.get(k) ?? { label: e.bank_name ? `${e.bank_name}${e.account_last4 ? " ••" + e.account_last4 : ""}` : "No account linked", v30: 0, n: 0 };
    cur.v30 += e.amount_paise ?? 0; cur.n++; banks.set(k, cur);
  }
  const cols = ["current_value", "loans_outstanding", "net_worth_estimate", "monthly_emi", "monthly_sip", "annual_premium", "insurance_cover"] as const;
  const colLabel = { current_value: "Investments", loans_outstanding: "Loans", net_worth_estimate: "Est. net worth", monthly_emi: "EMI / month", monthly_sip: "SIP / month", annual_premium: "Premium / year", insurance_cover: "Cover" };

  const exportAll = () => csv(`sampatti-report-${today}`, [
    ["Profile", ...cols.map((c) => colLabel[c] + " (₹)")],
    ...per.map(({ e, s }) => [e.name, ...cols.map((c) => paiseToInput(s[c]))]),
    ["Family total", ...cols.map((c) => paiseToInput(fam[c]))],
    [], ["Upcoming outflows", "Amount (₹)"], ...buckets.map((b) => [`Next ${b.d} days`, paiseToInput(b.v)]),
    [], ["Bank (next 30 days)", "Items", "Amount (₹)"], ...[...banks.values()].map((b) => [b.label, b.n, paiseToInput(b.v30)]),
    [], ["Upcoming item", "Profile", "Due", "Amount (₹)", "Bank", "Status"], ...ev.sort((a, b) => a.event_date.localeCompare(b.event_date)).map((e) => [e.title, e.entity_name, e.event_date, paiseToInput(e.amount_paise), e.bank_name ?? "", e.status]),
  ]);

  return (
    <div>
      <PageHeader title="Reports" subtitle={`As of ${today.split("-").reverse().join("/")} · values marked (est.) are manual estimates`} back="/more" />
      <div className="grid grid-cols-2 gap-2 no-print">
        <Button variant="secondary" onClick={exportAll}><Download className="size-4" />CSV / Excel</Button>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" />Print / PDF</Button>
      </div>

      <SectionTitle>Family position</SectionTitle>
      <div className="card px-4 py-4 grid grid-cols-2 gap-y-3 gap-x-4">
        {cols.map((c) => <div key={c}><div className="text-[12px] text-ink-3">{colLabel[c]}{c === "current_value" && !fam.values_verified ? " (est.)" : ""}</div><div className="num font-semibold">{formatINR(fam[c])}</div></div>)}
      </div>

      <SectionTitle>Upcoming outflows</SectionTitle>
      <div className="card px-4 py-4 space-y-3">
        {buckets.map((b) => (
          <div key={b.d} title={formatINR(b.v)}>
            <div className="flex justify-between text-sm"><span className="text-ink-2">Next {b.d} days</span><span className="num font-semibold">{formatINR(b.v)}</span></div>
            <div className="mt-1 h-2 rounded bg-surface-2"><div className="h-2 rounded" style={{ width: `${(b.v / max) * 100}%`, background: "var(--accent)" }} /></div>
          </div>
        ))}
      </div>

      <SectionTitle>By profile</SectionTitle>
      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] num">
          <thead className="text-ink-3 text-left"><tr><th className="px-3 py-2 sticky left-0 bg-surface">Profile</th>{cols.map((c) => <th key={c} className="px-3 py-2 whitespace-nowrap text-right">{colLabel[c]}</th>)}</tr></thead>
          <tbody>{per.map(({ e, s }) => <tr key={e.id} className="border-t hairline"><td className="px-3 py-2 sticky left-0 bg-surface whitespace-nowrap font-medium">{e.name}</td>{cols.map((c) => <td key={c} className="px-3 py-2 text-right whitespace-nowrap">{formatINR(s[c])}</td>)}</tr>)}
            <tr className="border-t-2 hairline font-semibold"><td className="px-3 py-2 sticky left-0 bg-surface">Total</td>{cols.map((c) => <td key={c} className="px-3 py-2 text-right whitespace-nowrap">{formatINR(fam[c])}</td>)}</tr></tbody>
        </table>
      </div>

      <SectionTitle>Bank-wise · next 30 days</SectionTitle>
      <div className="card px-4">{[...banks.values()].map((b) => <div key={b.label} className="flex justify-between py-3 border-b hairline last:border-0 text-sm"><span>{b.label} <span className="text-ink-3">· {b.n}</span></span><span className="num font-semibold">{formatINR(b.v30)}</span></div>)}
        {!banks.size && <div className="py-3 text-sm text-ink-3">No deductions expected.</div>}</div>

      <SectionTitle>Completed this month</SectionTitle>
      <div className="card px-4 py-3 flex justify-between text-sm"><span>{paid.length} payment{paid.length === 1 ? "" : "s"} recorded</span><span className="num font-semibold">{formatINR(sumPaise(paid.map((p) => p.paid_amount_paise)))}</span></div>
    </div>
  );
}
