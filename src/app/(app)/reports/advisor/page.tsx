"use client";
import { Printer } from "lucide-react";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ProfileSelect } from "@/components/profile-select";
import { useApp } from "@/components/providers";
import { Button, ErrorState, ListSkeleton, PageHeader } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { addDays, daysBetween, formatDate, todayISO } from "@/lib/dates";
import { formatINR, sumPaise } from "@/lib/money";
import { INVESTMENT_TYPES, INSURANCE_TYPES, LOAN_TYPES, label } from "@/lib/modules";
import { OPEN_STATUSES, isInflow, CATEGORY_LABEL } from "@/lib/status";
import { outflowGroup, outflowMonths, monthLabel, type OutflowRow } from "@/lib/outflow";
import type { CalEvent } from "@/components/obligations";

type Inv = { entity_id: string; category: string; name: string; invested_paise: number; current_value_paise: number | null; value_is_verified: boolean; value_as_of: string | null; maturity_date: string | null; maturity_amount_paise: number | null; mode: string | null; sip_amount_paise: number | null; next_sip_date: string | null };
type Loan = { entity_id: string; loan_type: string; lender: string; outstanding_paise: number; principal_paise: number; interest_rate: string; emi_paise: number; rate_type: string };
type Pol = { entity_id: string; category: string; insurer: string; policy_name: string | null; sum_assured_paise: number | null; premium_paise: number | null; premium_frequency: string | null; expiry_date: string | null; next_premium_date: string | null; status: string };

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const yearly = (p: Pol) => (p.premium_paise ?? 0) * ({ monthly: 12, quarterly: 4, half_yearly: 2, weekly: 52 } as Record<string, number>)[p.premium_frequency ?? ""] || (p.premium_paise ?? 0);

export default function AdvisorReportPage() { return <Suspense><AdvisorReport /></Suspense>; }

function AdvisorReport() {
  const { entities, selected, setSelected, tz, profile } = useApp();
  const sp = useSearchParams();
  // A link from Cash outflow carries the chosen profile; adopt it as the current selection.
  useEffect(() => {
    const p = sp.get("profile");
    if (p && entities.some((e) => e.id === p) && p !== selected) setSelected(p);
  }, [sp, entities]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = todayISO(tz);

  const q = useQuery(async () => {
    const sb = supabase();
    const scope = <T,>(rows: T[]) => (selected ? rows.filter((r) => (r as { entity_id: string }).entity_id === selected) : rows);
    const [inv, loans, pols, ev, out] = await Promise.all([
      sb.from("investments").select("*").is("archived_at", null),
      sb.from("loans").select("*").is("archived_at", null),
      sb.from("insurance_policies").select("*").is("archived_at", null),
      sb.from("financial_calendar_events").select("*").in("status", OPEN_STATUSES).lte("event_date", addDays(today, 90)).order("event_date"),
      sb.rpc("projected_outflows", { p_months: 12 }),
    ]);
    return {
      inv: scope(unwrap(inv) as Inv[]), loans: scope(unwrap(loans) as Loan[]), pols: scope(unwrap(pols) as Pol[]),
      ev: scope(unwrap(ev) as CalEvent[]), out: scope(unwrap(out) as OutflowRow[]),
    };
  }, [selected, today]);

  if (q.error) return <ErrorState error={q.error} retry={q.reload} />;
  if (q.loading || !q.data) return <div><PageHeader title="Financial report" back="/reports" /><ListSkeleton rows={6} /></div>;
  const { inv, loans, pols, ev, out } = q.data;
  const name = (id: string) => entities.find((e) => e.id === id)?.name ?? "Unknown";
  const scopeName = selected ? name(selected) : "The family";
  const members = selected ? entities.filter((e) => e.id === selected) : entities.filter((e) => e.is_active);

  // ---- Figures --------------------------------------------------------------
  const invested = sumPaise(inv.map((i) => i.invested_paise));
  const current = sumPaise(inv.map((i) => i.current_value_paise ?? i.invested_paise));
  const gain = current - invested;
  const unverified = inv.filter((i) => !i.value_is_verified);
  const debt = sumPaise(loans.map((l) => l.outstanding_paise));
  const emi = sumPaise(loans.filter((l) => l.outstanding_paise > 0).map((l) => l.emi_paise));
  const sip = sumPaise(inv.filter((i) => i.next_sip_date && i.sip_amount_paise).map((i) => i.sip_amount_paise!));
  const netWorth = current - debt;
  const activePols = pols.filter((p) => p.status === "active");
  const lifeCover = sumPaise(activePols.filter((p) => ["life", "term"].includes(p.category)).map((p) => p.sum_assured_paise));
  const healthCover = sumPaise(activePols.filter((p) => p.category === "health").map((p) => p.sum_assured_paise));
  const premiums = sumPaise(activePols.map(yearly));

  const keys = outflowMonths(out, 12, today);
  const outRows = out.filter((r) => keys.includes(r.month));
  const outTotal = sumPaise(outRows.map((r) => r.amount_paise));
  const byMonth = keys.map((k) => ({ k, v: sumPaise(outRows.filter((r) => r.month === k).map((r) => r.amount_paise)) }));
  const peak = [...byMonth].sort((a, b) => b.v - a.v)[0];
  const avg = Math.round(outTotal / 12);
  const byType = new Map<string, number>();
  for (const r of outRows) byType.set(outflowGroup(r.category)[1], (byType.get(outflowGroup(r.category)[1]) ?? 0) + r.amount_paise);

  const alloc = new Map<string, number>();
  for (const i of inv) alloc.set(i.category, (alloc.get(i.category) ?? 0) + (i.current_value_paise ?? i.invested_paise));
  const allocRows = [...alloc.entries()].sort((a, b) => b[1] - a[1]);
  const top = allocRows[0];

  const overdue = ev.filter((e) => e.event_date < today && !isInflow(e.category));
  const unconfirmed = overdue.filter((e) => e.status === "awaiting_confirmation");
  const next30 = ev.filter((e) => e.event_date >= today && e.event_date <= addDays(today, 30) && !isInflow(e.category));
  const due30 = sumPaise(next30.map((e) => e.amount_paise));
  const maturing = inv.filter((i) => i.maturity_date && i.maturity_date >= today && daysBetween(today, i.maturity_date) <= 90);
  const expiring = activePols.filter((p) => p.expiry_date && p.expiry_date >= today && daysBetween(today, p.expiry_date) <= 60);
  const loansByRate = [...loans].filter((l) => l.outstanding_paise > 0).sort((a, b) => Number(b.interest_rate) - Number(a.interest_rate));

  // ---- Recommendations (rule-based, from the data only) -------------------------
  type Rec = { level: "Act now" | "Plan" | "Review"; title: string; body: string };
  const recs: Rec[] = [];
  if (overdue.length) recs.push({ level: "Act now", title: `Clear ${overdue.length} overdue item${overdue.length > 1 ? "s" : ""} (${formatINR(sumPaise(overdue.map((e) => e.amount_paise)))})`,
    body: `${overdue.slice(0, 3).map((e) => `${e.title} for ${e.entity_name}, due ${formatDate(e.event_date, "short")}`).join("; ")}. Late payments can attract penalties, lapse insurance cover and affect credit scores.${unconfirmed.length ? ` ${unconfirmed.length} of these are auto-debits: check the bank statement and confirm them in the app.` : ""}` });
  if (expiring.length) recs.push({ level: "Act now", title: `Renew ${expiring.length} insurance polic${expiring.length > 1 ? "ies" : "y"} expiring within 60 days`,
    body: expiring.map((p) => `${p.policy_name || p.insurer} (${name(p.entity_id)}) on ${formatDate(p.expiry_date, "short")}`).join("; ") + ". Renewing before expiry keeps continuity benefits such as no-claim bonus and waiting periods already served." });
  const costly = loansByRate.filter((l) => Number(l.interest_rate) >= 9);
  if (costly.length) recs.push({ level: "Plan", title: `Prioritise prepaying the ${costly[0].lender} ${label(LOAN_TYPES, costly[0].loan_type).toLowerCase()} at ${costly[0].interest_rate}%`,
    body: `Surplus cash is usually best used against the highest-rate debt first (avalanche method). ${formatINR(costly[0].outstanding_paise)} is outstanding. Compare the post-tax return of your investments with ${costly[0].interest_rate}% before investing extra elsewhere${costly.length > 1 ? `, then move to ${costly.slice(1, 3).map((l) => `${l.lender} at ${l.interest_rate}%`).join(" and ")}` : ""}.` });
  if (debt > 0 && lifeCover < debt) recs.push({ level: "Plan", title: "Life cover is lower than outstanding loans",
    body: `Loans outstanding are ${formatINR(debt)} against ${formatINR(lifeCover)} of life/term cover. A term plan at least equal to outstanding loans (plus future goals) protects the family from inheriting the debt.` });
  if (!healthCover) recs.push({ level: "Plan", title: "No health insurance on record",
    body: "A family-floater health policy is the first line of defence against large medical bills. If cover exists elsewhere (e.g. employer), add it here so renewals are tracked." });
  const noHealth = members.filter((m) => m.entity_type === "individual" && !activePols.some((p) => p.category === "health" && p.entity_id === m.id));
  if (healthCover && noHealth.length) recs.push({ level: "Review", title: `Check health cover for ${noHealth.map((m) => m.name).join(", ")}`,
    body: "No health policy is recorded in their name. If they are covered under a family floater, note the covered members on that policy." });
  if (top && current > 0 && pct(top[1], current) >= 60 && allocRows.length > 1) recs.push({ level: "Review", title: `${pct(top[1], current)}% of investments are in ${label(INVESTMENT_TYPES, top[0]).toLowerCase()}`,
    body: "Heavy concentration in one asset type raises risk. Review the mix against goals and time horizon." });
  if (maturing.length) recs.push({ level: "Plan", title: `Plan reinvestment for ${maturing.length} maturit${maturing.length > 1 ? "ies" : "y"} in the next 90 days`,
    body: maturing.map((i) => `${i.name} (${name(i.entity_id)}) on ${formatDate(i.maturity_date, "short")}${i.maturity_amount_paise ? `, about ${formatINR(i.maturity_amount_paise)}` : ""}`).join("; ") + ". Decide in advance to avoid money sitting idle or auto-renewing at a lower rate." });
  if (peak && avg && peak.v > avg * 1.5) recs.push({ level: "Plan", title: `Keep extra cash ready for ${monthLabel(peak.k, "long")}`,
    body: `Committed outflow that month is ${formatINR(peak.v)}, against a monthly average of ${formatINR(avg)}. Keep the difference in the linked accounts beforehand so auto-debits don’t bounce.` });
  if (unverified.length) recs.push({ level: "Review", title: `Update ${unverified.length} investment value${unverified.length > 1 ? "s" : ""} from statements`,
    body: "These values are manual estimates, so net worth here is approximate. Updating them from the latest statements makes this report reliable." });
  if (!sip && current > 0) recs.push({ level: "Review", title: "No active SIPs",
    body: "Regular monthly investing (SIPs) builds wealth steadily and averages out market ups and downs. Consider whether ongoing investing fits current goals." });
  const order = { "Act now": 0, Plan: 1, Review: 2 } as const;
  recs.sort((a, b) => order[a.level] - order[b.level]);

  const summary = `${scopeName} has an estimated net worth of ${formatINR(netWorth)}: investments worth ${formatINR(current)}${invested ? ` (${gain >= 0 ? "up" : "down"} ${formatINR(Math.abs(gain))}, ${pct(Math.abs(gain), invested)}% on ${formatINR(invested)} invested)` : ""} against ${formatINR(debt)} of loans. Committed outflow over the next 12 months is ${formatINR(outTotal)}, about ${formatINR(avg)} a month, of which EMIs are ${formatINR(emi)} and SIPs ${formatINR(sip)} a month. ${overdue.length ? `${overdue.length} payment${overdue.length > 1 ? "s are" : " is"} overdue and need${overdue.length > 1 ? "" : "s"} attention.` : "Nothing is overdue."}`;

  const T = ({ head, rows, num = [] }: { head: string[]; rows: (string | number)[][]; num?: number[] }) => (
    <table className="w-full text-[13px] border-collapse">
      <thead><tr>{head.map((h, i) => <th key={i} className={`py-1.5 pr-2 text-ink-3 font-medium border-b hairline ${num.includes(i) ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`py-1.5 pr-2 border-b hairline align-top ${num.includes(j) ? "text-right num whitespace-nowrap" : ""}`}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
  const H = ({ n, children }: { n: number; children: string }) => <h2 className="report-h text-[17px] font-medium mt-8 mb-3 pb-1.5 border-b hairline"><span className="text-ink-3 mr-2 num">{n}</span>{children}</h2>;

  return (
    <div>
      <div className="no-print">
        <PageHeader title="Financial report" subtitle="Prepared from your records, ready to save as PDF" back="/reports"
          action={<Button size="sm" onClick={() => window.print()}><Printer className="size-4" />Save PDF</Button>} />
        <ProfileSelect />
        <p className="text-sm text-ink-3 mt-2 mb-4">Report for {selected ? (entities.find((e) => e.id === selected)?.name ?? "this profile") : "the whole family"}. In the print window choose “Save as PDF”.</p>
      </div>

      <article className="report card px-6 py-6">
        <header className="flex items-start justify-between gap-4 pb-4 border-b hairline">
          <div>
            <div className="text-[13px] text-ink-3">Sampatti · Financial review</div>
            <h1 className="text-[26px] font-medium leading-tight mt-1">{selected ? name(selected) : "Family financial report"}</h1>
            <div className="text-[13px] text-ink-3 mt-1">{members.length > 1 ? `${members.length} profiles · ` : ""}Prepared {formatDate(today)}{profile?.full_name ? ` for ${profile.full_name}` : ""}</div>
          </div>
        </header>

        <H n={1}>Summary</H>
        <p className="text-[14px] leading-relaxed text-ink-2">{summary}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[["Net worth (est.)", netWorth], ["Investments", current], ["Loans outstanding", debt], ["12-month outflow", outTotal]].map(([l, v]) => (
            <div key={l as string} className="border hairline rounded-xl px-3 py-2.5"><div className="text-[12px] text-ink-3">{l}</div><div className="num text-[17px] font-medium">{formatINR(v as number)}</div></div>
          ))}
        </div>

        <H n={2}>Recommendations</H>
        {recs.length ? (
          <ol className="space-y-3">{recs.map((r, i) => (
            <li key={i} className="report-avoid flex gap-3">
              <span className={`shrink-0 mt-0.5 text-[11px] font-medium px-2 py-0.5 rounded-full h-fit ${r.level === "Act now" ? "bg-danger-soft text-danger" : r.level === "Plan" ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2"}`}>{r.level}</span>
              <div><div className="text-[14px] font-medium">{r.title}</div><p className="text-[13px] text-ink-2 leading-relaxed mt-0.5">{r.body}</p></div>
            </li>))}</ol>
        ) : <p className="text-[14px] text-ink-2">No issues found in the recorded data. Keep records and statement values up to date.</p>}

        <H n={3}>Due in the next 30 days</H>
        {next30.length ? <T head={["Date", "Item", "Profile", "Account", "Amount"]} num={[4]}
          rows={[...next30.map((e) => [formatDate(e.event_date, "short"), e.title, e.entity_name, e.bank_name ? `${e.bank_name}${e.account_last4 ? " ••" + e.account_last4 : ""}` : "", e.amount_paise != null ? formatINR(e.amount_paise) : ""]),
            ["", "Total", "", "", formatINR(due30)]]} /> : <p className="text-[14px] text-ink-2">Nothing due.</p>}

        <H n={4}>Investments</H>
        {inv.length ? (
          <>
            <T head={["Type", "Value", "Share"]} num={[1, 2]} rows={allocRows.map(([c, v]) => [label(INVESTMENT_TYPES, c), formatINR(v), `${pct(v, current)}%`])} />
            <p className="text-[13px] text-ink-3 mt-2">Invested {formatINR(invested)} · current {formatINR(current)} · {gain >= 0 ? "gain" : "loss"} {formatINR(Math.abs(gain))}{unverified.length ? ` · ${unverified.length} value${unverified.length > 1 ? "s are" : " is"} an estimate` : ""}. Monthly SIPs: {formatINR(sip)}.</p>
          </>
        ) : <p className="text-[14px] text-ink-2">No investments recorded.</p>}

        <H n={5}>Loans</H>
        {loansByRate.length ? (
          <>
            <T head={["Loan", "Profile", "Rate", "Outstanding", "EMI"]} num={[2, 3, 4]}
              rows={loansByRate.map((l) => [`${l.lender} ${label(LOAN_TYPES, l.loan_type).toLowerCase()}`, name(l.entity_id), `${l.interest_rate}% ${l.rate_type}`, formatINR(l.outstanding_paise), formatINR(l.emi_paise)])} />
            <p className="text-[13px] text-ink-3 mt-2">Sorted by interest rate, highest first. Total EMIs {formatINR(emi)} a month ({formatINR(emi * 12)} a year).</p>
          </>
        ) : <p className="text-[14px] text-ink-2">No loans outstanding.</p>}

        <H n={6}>Insurance</H>
        {activePols.length ? (
          <>
            <T head={["Policy", "Profile", "Cover", "Premium / year", "Renews"]} num={[2, 3]}
              rows={activePols.map((p) => [`${p.policy_name || p.insurer} (${label(INSURANCE_TYPES, p.category).toLowerCase()})`, name(p.entity_id), p.sum_assured_paise ? formatINR(p.sum_assured_paise) : "", formatINR(yearly(p)), formatDate(p.expiry_date ?? p.next_premium_date, "short")])} />
            <p className="text-[13px] text-ink-3 mt-2">Life/term cover {formatINR(lifeCover)} · health cover {formatINR(healthCover)} · premiums {formatINR(premiums)} a year.</p>
          </>
        ) : <p className="text-[14px] text-ink-2">No active policies recorded.</p>}

        <H n={7}>Cash outflow, next 12 months</H>
        <T head={["Month", "Outflow"]} num={[1]} rows={[...byMonth.map((x) => [monthLabel(x.k, "long"), formatINR(x.v)]), ["Total", formatINR(outTotal)]]} />
        {byType.size > 0 && <div className="mt-3"><T head={["By type", "Amount", "Share"]} num={[1, 2]} rows={[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, v]) => [t, formatINR(v), `${pct(v, outTotal)}%`])} /></div>}

        {!selected && members.length > 1 && (
          <>
            <H n={8}>By profile</H>
            <T head={["Profile", "Investments", "Loans", "12-month outflow"]} num={[1, 2, 3]}
              rows={members.map((m) => [m.name,
                formatINR(sumPaise(inv.filter((i) => i.entity_id === m.id).map((i) => i.current_value_paise ?? i.invested_paise))),
                formatINR(sumPaise(loans.filter((l) => l.entity_id === m.id).map((l) => l.outstanding_paise))),
                formatINR(sumPaise(outRows.filter((r) => r.entity_id === m.id).map((r) => r.amount_paise)))])} />
          </>
        )}

        <footer className="mt-8 pt-3 border-t hairline text-[11px] text-ink-3 leading-relaxed">
          This report is generated from the records entered in Sampatti on {formatDate(today)}. Values marked as estimates, projected outflows and recommendations are based only on that data and general financial principles. It is not investment, tax or legal advice from a SEBI-registered adviser; please consult a qualified professional before acting on it.
        </footer>
      </article>
    </div>
  );
}
