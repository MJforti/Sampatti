"use client";
import { useState } from "react";
import { useApp } from "@/components/providers";
import { EventList, type CalEvent } from "@/components/obligations";
import { Chip, ErrorState, ListSkeleton, PageHeader, SectionTitle } from "@/components/ui";
import { ProfileSelect } from "@/components/profile-select";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { addDays, todayISO } from "@/lib/dates";
import { formatINR, sumPaise } from "@/lib/money";
import { OPEN_STATUSES, isInflow } from "@/lib/status";

export default function Deductions() {
  const { tz, selected, entityName, showsCategory } = useApp();
  const [days, setDays] = useState(30);
  const today = todayISO(tz);
  const q = useQuery(async () => {
    let qq = supabase().from("financial_calendar_events").select("*").in("status", OPEN_STATUSES).lte("event_date", addDays(today, days)).order("event_date");
    if (selected) qq = qq.eq("entity_id", selected);
    return (unwrap(await qq) as CalEvent[]).filter((e) => !isInflow(e.category) && e.amount_paise && showsCategory(e.category));
  }, [today, days, selected]);

  const groups = new Map<string, CalEvent[]>();
  for (const e of q.data ?? []) {
    const k = e.bank_account_id ?? "none";
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const total = sumPaise((q.data ?? []).map((e) => e.amount_paise));

  return (
    <div>
      <PageHeader title="Bank-wise deductions" subtitle="Expected outflows per account" back="/more" />
      <ProfileSelect />
      <div className="flex gap-2 py-2">{[7, 15, 30].map((d) => <Chip key={d} active={days === d} onClick={() => setDays(d)}>Next {d} days</Chip>)}</div>
      {q.error ? <ErrorState error={q.error} retry={q.reload} /> : q.loading ? <ListSkeleton /> : (
        <>
          <div className="card px-4 py-4 flex justify-between items-baseline"><span className="text-sm text-ink-3">Total expected · {q.data!.length} items</span><span className="num text-2xl font-semibold">{formatINR(total)}</span></div>
          {[...groups.entries()].sort((a, b) => (a[0] === "none" ? 1 : b[0] === "none" ? -1 : 0)).map(([k, list]) => {
            const f = list[0];
            return (
              <div key={k}>
                <SectionTitle action={<span className="num text-sm font-semibold">{formatINR(sumPaise(list.map((e) => e.amount_paise)))}</span>}>
                  {k === "none" ? "No bank account linked" : `${f.bank_name}${f.account_last4 ? " ••" + f.account_last4 : ""}`}
                </SectionTitle>
                {k !== "none" && <div className="px-1 -mt-1 mb-2 text-xs text-ink-3">Holder: {[...new Set(list.map((e) => entityName(e.entity_id)))].join(", ")} · auto-debit {list.filter((e) => e.auto_debit).length} of {list.length}</div>}
                <EventList events={list} />
              </div>
            );
          })}
          {!groups.size && <div className="mt-4"><EventList events={[]} empty="No deductions expected in this period." /></div>}
        </>
      )}
    </div>
  );
}
