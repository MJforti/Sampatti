"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Bell, CalendarDays, BellRing, Users, Search, Plus, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useApp } from "@/components/providers";
import { ProfileSelect } from "@/components/profile-select";
import { EventList, type CalEvent } from "@/components/obligations";
import { Chip, ErrorState, ListSkeleton, SectionTitle, Skeleton, cx } from "@/components/ui";
import { AdminToggle } from "@/components/shell";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { addDays, daysBetween, todayISO } from "@/lib/dates";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { OPEN_STATUSES, isInflow } from "@/lib/status";

type Summary = Record<string, number | boolean | string>;

export default function Home() {
  const { profile, selected, tz, unread, entityName, isAdminMode } = useApp();
  const today = todayISO(tz);
  const [range, setRange] = useState<7 | 15 | 30 | "custom">(7);
  const [custom, setCustom] = useState({ from: today, to: addDays(today, 60) });

  const events = useQuery(async () => {
    const sb = supabase();
    let q = sb.from("financial_calendar_events").select("*").in("status", OPEN_STATUSES)
      .lte("event_date", addDays(today, 370)).order("event_date").limit(500);
    if (selected) q = q.eq("entity_id", selected);
    return unwrap(await q) as CalEvent[];
  }, [selected, today]);

  const done = useQuery(async () => {
    let q = supabase().from("financial_calendar_events").select("*").in("status", ["paid", "renewed"])
      .gte("paid_on", today.slice(0, 8) + "01").order("paid_on", { ascending: false }).limit(5);
    if (selected) q = q.eq("entity_id", selected);
    return unwrap(await q) as CalEvent[];
  }, [selected, today]);

  const summary = useQuery(async () => unwrap(await supabase().rpc("dashboard_summary", { p_entity: selected })) as Summary, [selected]);

  const all = events.data ?? [];
  const urgent = all.filter((e) => daysBetween(today, e.event_date) <= 3);
  const [from, to] = range === "custom" ? [custom.from, custom.to] : [today, addDays(today, range)];
  const inRange = all.filter((e) => e.event_date >= from && e.event_date <= to);
  const upcoming = range === "custom" ? inRange : inRange.filter((e) => daysBetween(today, e.event_date) > 3);
  const outflow = sumPaise(inRange.filter((e) => !isInflow(e.category)).map((e) => e.amount_paise));
  const overdue = all.filter((e) => e.event_date < today);
  const urgentAmount = sumPaise(urgent.filter((e) => !isInflow(e.category)).map((e) => e.amount_paise));

  const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(today + "T00:00:00Z"));
  // Split the period's outflow by bank account (largest first) for the ledger bar
  const byBank = new Map<string, { label: string; v: number }>();
  for (const e of inRange) {
    if (isInflow(e.category) || !e.amount_paise) continue;
    const k = e.bank_account_id ?? "none";
    const cur = byBank.get(k) ?? { label: e.bank_name ? `${e.bank_name}${e.account_last4 ? " ••" + e.account_last4 : ""}` : "No account linked", v: 0 };
    cur.v += e.amount_paise; byBank.set(k, cur);
  }
  const banks = [...byBank.values()].sort((a, b) => b.v - a.v);
  const SHADES = [1, 0.62, 0.38, 0.22];

  return (
    <div>
      <header className="flex items-center justify-between pt-2">
        <div>
          <p className="text-sm text-ink-3">{monthLabel}</p>
          <h1 className="text-[28px] font-medium tracking-tight">{selected ? entityName(selected) : "Family"}</h1>
        </div>
        <Link href="/reminders" className="relative size-11 grid place-items-center rounded-full bg-surface border hairline" aria-label={`Notifications, ${unread} unread`}>
          <Bell className="size-5" />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 text-[10px] leading-4 bg-danger text-white rounded-full px-1 min-w-4 text-center">{unread}</span>}
        </Link>
      </header>
      <div className="mt-3"><ProfileSelect /></div>

      {/* A. Needs attention */}
      <SectionTitle>Needs attention</SectionTitle>
      {events.error ? <ErrorState error={events.error} retry={events.reload} /> : events.loading ? <ListSkeleton rows={2} /> : urgent.length === 0 ? (
        <div className="card px-4 py-4 flex items-center gap-3">
          <CheckCircle2 className="size-6 text-ok" />
          <div><div className="font-medium">Nothing due in the next 3 days</div><div className="text-sm text-ink-3">No overdue payments{all[0] ? ` · next on ${all[0].event_date.split("-").reverse().join("/")}` : ""}</div></div>
        </div>
      ) : (
        <>
          <div className={cx("card px-4 py-3 mb-2 flex items-center gap-3", overdue.length ? "bg-danger-soft border-danger/20" : "bg-warn-soft border-warn/20")}>
            <AlertTriangle className={cx("size-5 shrink-0", overdue.length ? "text-danger" : "text-warn")} />
            <div className="text-sm">
              <span className="font-semibold">{urgent.length} item{urgent.length > 1 ? "s" : ""}</span>
              {overdue.length > 0 && <span> · {overdue.length} overdue</span>}
              {urgentAmount > 0 && <span> · <span className="num font-semibold">{formatINR(urgentAmount)}</span> needed</span>}
            </div>
          </div>
          <EventList events={urgent} />
        </>
      )}

      {/* C. Upcoming */}
      <SectionTitle action={<Link href="/calendar?view=list" className="inline-flex items-center h-11 -my-3 px-1 text-sm text-accent font-medium">See all</Link>}>Upcoming</SectionTitle>
      <div className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar pb-2">
        {([7, 15, 30] as const).map((d) => <Chip key={d} active={range === d} onClick={() => setRange(d)}>Next {d} days</Chip>)}
        <Chip active={range === "custom"} onClick={() => setRange("custom")}>Custom</Chip>
      </div>
      {range === "custom" && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input type="date" className="field" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
          <input type="date" className="field" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" />
        </div>
      )}
      {!events.loading && !events.error && (
        <>
          <div className="card px-5 pt-5 pb-4 mb-2">
            <div className="text-sm text-ink-3">To be paid {range === "custom" ? "in this range" : `in the next ${range} days`}</div>
            <div className="num text-[40px] leading-[48px] font-medium tracking-tight mt-1">{formatINR(outflow)}</div>
            <div className="text-[13px] text-ink-3">{inRange.length} item{inRange.length === 1 ? "" : "s"}{banks.length ? ` from ${banks.length} account${banks.length === 1 ? "" : "s"}` : ""}</div>
            {banks.length > 0 && outflow > 0 && (
              <>
                <div className="mt-4 flex h-2 gap-[2px] overflow-hidden rounded" role="img" aria-label="Outflow by bank account">
                  {banks.map((b, i) => <div key={b.label} title={`${b.label}: ${formatINR(b.v)}`} style={{ width: `${(b.v / outflow) * 100}%`, background: "var(--accent)", opacity: SHADES[Math.min(i, 3)] }} />)}
                </div>
                <ul className="mt-3 space-y-1.5">
                  {banks.slice(0, 4).map((b, i) => (
                    <li key={b.label} className="flex items-center gap-2 text-[13px]">
                      <span className="size-2 rounded-sm" style={{ background: "var(--accent)", opacity: SHADES[Math.min(i, 3)] }} />
                      <span className="text-ink-2 truncate flex-1">{b.label}</span>
                      <span className="num text-ink">{formatINR(b.v)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <EventList events={upcoming} empty={range === "custom" ? "Nothing in this range." : "Nothing else due in this period."} />
        </>
      )}

      {/* D. Overview */}
      <SectionTitle action={<Link href="/reports" className="inline-flex items-center h-11 -my-3 px-1 text-sm text-accent font-medium">Reports</Link>}>Financial overview</SectionTitle>
      {summary.error ? <ErrorState error={summary.error} retry={summary.reload} /> : (
        summary.loading || !summary.data ? <ListSkeleton rows={2} /> : (
          <div className="card px-4">
            <Line label="Investments, current value" value={summary.data.current_value as number} note={summary.data.values_verified ? undefined : "includes estimates"} />
            <Line label="Invested" value={summary.data.invested as number} />
            <Line label="Loans outstanding" value={summary.data.loans_outstanding as number} />
            <Line label="EMIs per month" value={summary.data.monthly_emi as number} />
            <Line label="SIPs per month" value={summary.data.monthly_sip as number} />
            <Line label="Insurance cover" value={summary.data.insurance_cover as number} />
            <Line label="Estimated net worth" value={summary.data.net_worth_estimate as number} note="investments − loans" strong />
          </div>
        )
      )}

      {/* Completed */}
      <SectionTitle>Completed this month</SectionTitle>
      {done.loading ? <ListSkeleton rows={1} /> : <EventList events={done.data ?? []} empty="No payments recorded yet this month." />}

      {/* F. Quick actions */}
      <SectionTitle>Quick actions</SectionTitle>
      <div className="grid grid-cols-4 gap-2">
        <Quick href="/reminders" icon={BellRing} label="Reminders" />
        <Quick href="/calendar" icon={CalendarDays} label="Calendar" />
        <Quick href="/profiles" icon={Users} label="Profiles" />
        <Quick href="/search" icon={Search} label="Search" />
      </div>
      {isAdminMode && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Link href="/m/obligations?new=1" className="card h-12 flex items-center justify-center gap-2 text-sm font-medium"><Plus className="size-4" />Recurring payment</Link>
          <Link href="/more" className="card h-12 flex items-center justify-center gap-2 text-sm font-medium"><Plus className="size-4" />Add a record</Link>
        </div>
      )}
      <div className="mt-6 lg:hidden"><AdminToggle /></div>
    </div>
  );
}

function Line({ label, value, note, strong }: { label: string; value: number; note?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3 border-b hairline last:border-0">
      <div className="text-[14px] text-ink-2">{label}{note && <span className="text-ink-3"> · {note}</span>}</div>
      <div className={cx("num text-[15px] whitespace-nowrap shrink-0", strong ? "font-medium text-ink" : "text-ink")}>{formatINR(value)}</div>
    </div>
  );
}
function Quick({ href, icon: Icon, label }: { href: string; icon: typeof Bell; label: string }) {
  return (
    <Link href={href} className="card py-3 flex flex-col items-center gap-1.5 text-[12px] text-ink-2 active:bg-surface-2">
      <Icon className="size-[18px] text-ink-2" strokeWidth={1.5} />{label}
    </Link>
  );
}
