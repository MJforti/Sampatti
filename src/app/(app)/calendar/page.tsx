"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApp } from "@/components/providers";
import { EventList, type CalEvent } from "@/components/obligations";
import { ErrorState, ListSkeleton, PageHeader, cx } from "@/components/ui";
import { ProfileSelect } from "@/components/profile-select";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { addDays, formatDate, monthMatrix, todayISO } from "@/lib/dates";
import { categoryGroup, STATUS_META, type TxnStatus } from "@/lib/status";
import { Suspense } from "react";

const GROUPS = [["all", "All"], ["insurance", "Insurance"], ["loan", "EMIs"], ["invest", "Investments"], ["vehicle", "Vehicles"], ["tax", "Tax"], ["other", "Other"]] as const;
const STATUS_FILTERS = [["open", "Open"], ["paid", "Paid"], ["all", "All"]] as const;

export default function CalendarPage() { return <Suspense><Calendar /></Suspense>; }

function Calendar() {
  const { tz, selected } = useApp();
  const params = useSearchParams();
  const today = todayISO(tz);
  const [view, setView] = useState<"month" | "week" | "list">((params.get("view") as "list") ?? "month");
  const [cursor, setCursor] = useState(today);
  const [day, setDay] = useState<string>(today);
  const [group, setGroup] = useState<string>("all");
  const [status, setStatus] = useState<string>("open");

  const y = Number(cursor.slice(0, 4)), m = Number(cursor.slice(5, 7)) - 1;
  const weeks = useMemo(() => monthMatrix(y, m), [y, m]);
  const weekStart = useMemo(() => { const d = new Date(cursor + "T00:00:00Z"); return addDays(cursor, -((d.getUTCDay() + 6) % 7)); }, [cursor]);
  const [from, to] = view === "month" ? [weeks[0][0], weeks[weeks.length - 1][6]] : view === "week" ? [weekStart, addDays(weekStart, 6)] : [today, addDays(today, 90)];

  const ev = useQuery(async () => {
    let q = supabase().from("financial_calendar_events").select("*").order("event_date");
    q = view === "list" ? q.lte("event_date", to) : q.gte("event_date", from).lte("event_date", to);
    if (selected) q = q.eq("entity_id", selected);
    return unwrap(await q) as CalEvent[];
  }, [from, to, selected, view]);

  const filtered = (ev.data ?? []).filter((e) =>
    (group === "all" || categoryGroup(e.category) === group) &&
    (status === "all" || (status === "paid" ? ["paid", "renewed"].includes(e.status) : !["paid", "renewed", "cancelled"].includes(e.status))) &&
    (view !== "list" || e.event_date >= today || !["paid", "renewed", "cancelled"].includes(e.status)));
  const byDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of filtered) (map[e.event_date] ??= []).push(e);
    return map;
  }, [filtered]);

  const shift = (n: number) => {
    if (view === "week") setCursor(addDays(cursor, 7 * n));
    else { const d = new Date(Date.UTC(y, m + n, 1)); setCursor(d.toISOString().slice(0, 10)); }
  };
  const title = view === "week" ? `${formatDate(weekStart, "short")} – ${formatDate(addDays(weekStart, 6), "short")}`
    : new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m, 1)));

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Scheduled payments, renewals and deadlines" />
      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-surface-2 mb-2" role="tablist">
        {(["month", "week", "list"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={cx("h-9 rounded-xl text-sm font-medium capitalize", view === v ? "bg-surface shadow-sm text-ink" : "text-ink-3")}>{v}</button>
        ))}
      </div>
      <ProfileSelect />
      <div className="flex gap-2 py-2">
        <select aria-label="Category" className="field !min-h-10 !py-2 flex-1" value={group} onChange={(e) => setGroup(e.target.value)}>
          {GROUPS.map(([k, l]) => <option key={k} value={k}>{k === "all" ? "All categories" : l}</option>)}
        </select>
        <select aria-label="Status" className="field !min-h-10 !py-2 w-32" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{k === "all" ? "Any status" : l}</option>)}
        </select>
      </div>

      {view !== "list" && (
        <div className="flex items-center justify-between my-2">
          <button onClick={() => shift(-1)} className="size-10 grid place-items-center rounded-full active:bg-surface-2" aria-label="Previous"><ChevronLeft /></button>
          <button onClick={() => { setCursor(today); setDay(today); }} className="font-semibold">{title}</button>
          <button onClick={() => shift(1)} className="size-10 grid place-items-center rounded-full active:bg-surface-2" aria-label="Next"><ChevronRight /></button>
        </div>
      )}
      {ev.error && <ErrorState error={ev.error} retry={ev.reload} />}

      {view === "month" && (
        <div className="card p-2">
          <div className="grid grid-cols-7 text-center text-[11px] text-ink-3 pb-1">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i}>{d}</div>)}</div>
          {weeks.map((w, i) => (
            <div key={i} className="grid grid-cols-7">
              {w.map((d) => {
                const items = byDay[d] ?? [];
                const inMonth = Number(d.slice(5, 7)) - 1 === m;
                const overdue = items.some((e) => e.status === "overdue" || e.status === "awaiting_confirmation");
                return (
                  <button key={d} onClick={() => setDay(d)} className={cx("h-12 flex flex-col items-center pt-1 rounded-xl transition-colors", day === d && "bg-accent-soft", !inMonth && "opacity-35")}
                    aria-label={`${formatDate(d)}, ${items.length} items`}>
                    <span className={cx("text-sm num size-7 grid place-items-center rounded-full", d === today && "bg-ink text-bg font-semibold", overdue && d !== today && "text-danger font-semibold")}>{Number(d.slice(8))}</span>
                    <span className="flex gap-0.5 mt-0.5">{items.slice(0, 3).map((e) => <span key={e.id} className="size-1.5 rounded-full" style={{ background: `var(--c-${categoryGroup(e.category)})` }} />)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {view === "month" && (
        <div className="mt-4">
          <div className="text-[15px] font-medium text-ink-2 mb-2 px-1">{formatDate(day)}</div>
          {ev.loading ? <ListSkeleton rows={2} /> : (byDay[day] ?? []).length ? <EventList events={byDay[day]} /> : (
            <>
              <div className="text-sm text-ink-3 px-1 mb-4">Nothing on this day</div>
              <div className="text-[15px] font-medium text-ink-2 mb-2 px-1">Coming up in {title}</div>
              <EventList events={filtered.filter((e) => e.event_date >= (day > today ? day : today) && Number(e.event_date.slice(5, 7)) - 1 === m)} empty="Nothing else this month" />
            </>
          )}
        </div>
      )}
      {view === "week" && (ev.loading ? <ListSkeleton /> : (
        <div className="space-y-3">
          {Array.from({ length: 7 }).map((_, i) => {
            const d = addDays(weekStart, i);
            return <div key={d}><div className={cx("text-sm font-semibold mb-1.5 px-1", d === today && "text-accent")}>{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"))}</div>
              {(byDay[d] ?? []).length ? <EventList events={byDay[d]} /> : <div className="text-sm text-ink-3 px-1 pb-1">—</div>}</div>;
          })}
        </div>
      ))}
      {view === "list" && (ev.loading ? <ListSkeleton /> : (
        <div className="space-y-4">
          {Object.keys(byDay).sort().map((d) => (
            <div key={d}><div className={cx("text-sm font-semibold mb-1.5 px-1", d < today && "text-danger")}>{formatDate(d)}</div><EventList events={byDay[d]} /></div>
          ))}
          {!Object.keys(byDay).length && <EventList events={[]} empty="Nothing scheduled in the next 90 days." />}
        </div>
      ))}
      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
        {GROUPS.slice(1).map(([k, l]) => <span key={k} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: `var(--c-${k})` }} />{l}</span>)}
      </div>
      <p className="mt-3 text-[11px] text-ink-3">Scheduled items are never marked paid automatically. Auto-debits show “{STATUS_META.awaiting_confirmation.label}” after the date until confirmed.</p>
    </div>
  );
}
