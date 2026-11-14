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

  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = profile?.full_name?.split(" ")[0];

  return (
    <div>
      <header className="flex items-center justify-between pt-2">
        <div>
          <p className="text-sm text-ink-3">{greet}{first ? `, ${first}` : ""}</p>
          <h1 className="text-[26px] font-semibold tracking-tight">{selected ? entityName(selected) : "Family overview"}</h1>
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
      <SectionTitle action={<Link href="/calendar?view=list" className="text-sm text-accent font-medium">See all</Link>}>Upcoming</SectionTitle>
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
          <div className="card px-4 py-3 mb-2 flex items-baseline justify-between">
            <span className="text-sm text-ink-3">Total to be paid · {inRange.length} item{inRange.length === 1 ? "" : "s"}</span>
            <span className="num text-xl font-semibold">{formatINR(outflow)}</span>
          </div>
          <EventList events={upcoming} empty={range === "custom" ? "Nothing in this range." : "Nothing else due in this period."} />
        </>
      )}

      {/* D. Overview */}
      <SectionTitle action={<Link href="/reports" className="text-sm text-accent font-medium">Reports</Link>}>Financial overview</SectionTitle>
      {summary.error ? <ErrorState error={summary.error} retry={summary.reload} /> : (
        <div className="grid grid-cols-2 gap-2">
          {summary.loading || !summary.data ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[76px]" />) : (
            <>
              <Stat label="Invested" value={summary.data.invested as number} />
              <Stat label="Current value" value={summary.data.current_value as number} note={summary.data.values_verified ? undefined : "Includes estimates"} />
              <Stat label="Loans outstanding" value={summary.data.loans_outstanding as number} />
              <Stat label="Monthly EMIs" value={summary.data.monthly_emi as number} />
              <Stat label="Monthly SIPs" value={summary.data.monthly_sip as number} />
              <Stat label="Due in 30 days" value={summary.data.upcoming_30 as number} />
              <Stat label="Insurance cover" value={summary.data.insurance_cover as number} />
              <Stat label="Est. net worth" value={summary.data.net_worth_estimate as number} note="Investments − loans" />
            </>
          )}
        </div>
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
          <Link href="/m/obligations?new=1" className="card h-12 flex items-center justify-center gap-2 text-sm font-medium text-admin"><Plus className="size-4" />Recurring payment</Link>
          <Link href="/more" className="card h-12 flex items-center justify-center gap-2 text-sm font-medium text-admin"><Plus className="size-4" />Add a record</Link>
        </div>
      )}
      <div className="mt-6 lg:hidden"><AdminToggle /></div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="num text-lg font-semibold mt-0.5" title={formatINR(value)}>{formatINRCompact(value)}</div>
      {note && <div className="text-[11px] text-ink-3">{note}</div>}
    </div>
  );
}
function Quick({ href, icon: Icon, label }: { href: string; icon: typeof Bell; label: string }) {
  return (
    <Link href={href} className="card py-3 flex flex-col items-center gap-1.5 text-[12px] text-ink-2 active:bg-surface-2">
      <Icon className="size-5 text-accent" strokeWidth={1.9} />{label}
    </Link>
  );
}
