"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { useApp } from "@/components/providers";
import { Badge, Button, ErrorState, ListSkeleton, PageHeader } from "@/components/ui";
import { ProfileForm } from "@/components/profile-form";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { formatINR } from "@/lib/money";
import { todayISO, addDays } from "@/lib/dates";
import { OPEN_STATUSES, isInflow } from "@/lib/status";

const TYPE_LABEL: Record<string, string> = { individual: "Individual", huf: "HUF", firm: "Firm", company: "Company", trust: "Trust", other: "Entity" };

export default function Profiles() {
  const { entities, isAdminMode, tz, loading } = useApp();
  const [adding, setAdding] = useState(false);
  const today = todayISO(tz);
  const due = useQuery(async () => unwrap(await supabase().from("financial_calendar_events").select("entity_id, amount_paise, category, event_date")
    .in("status", OPEN_STATUSES).lte("event_date", addDays(today, 30))) as { entity_id: string; amount_paise: number | null; category: string; event_date: string }[], [today]);

  const stats = (id: string) => {
    const rows = (due.data ?? []).filter((r) => r.entity_id === id);
    return { count: rows.length, overdue: rows.filter((r) => r.event_date < today).length, amount: rows.filter((r) => !isInflow(r.category)).reduce((a, r) => a + (r.amount_paise ?? 0), 0) };
  };

  return (
    <div>
      <PageHeader title="Profiles" subtitle="Individuals, HUF and firms"
        action={isAdminMode ? <Button size="sm" variant="admin" onClick={() => setAdding(true)}><Plus className="size-4" />Add</Button> : undefined} />
      {due.error && <ErrorState error={due.error} retry={due.reload} />}
      {loading ? <ListSkeleton rows={6} /> : (
        <div className="card overflow-hidden">
          {entities.map((e) => {
            const s = stats(e.id);
            return (
              <Link key={e.id} href={`/profiles/${e.id}`} className="flex items-center gap-3 px-4 py-4 border-b hairline last:border-0 active:bg-surface-2">
                <span className="size-11 shrink-0 grid place-items-center rounded-full bg-surface-2 font-semibold text-ink-2">{e.name.split(/\s+/).map((w) => w[0]).filter((c) => /[A-Z]/.test(c)).slice(0, 2).join("")}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium truncate">{e.name}</div>
                  <div className="text-[13px] text-ink-3 flex items-center gap-1.5">{TYPE_LABEL[e.entity_type]}{!e.is_active && <Badge tone="muted">Inactive</Badge>}
                    {s.overdue > 0 && <Badge tone="danger">{s.overdue} overdue</Badge>}</div>
                </div>
                <div className="text-right">
                  <div className="num text-[15px] font-semibold">{s.amount ? formatINR(s.amount) : "—"}</div>
                  <div className="text-[12px] text-ink-3">{s.count} due in 30 days</div>
                </div>
                <ChevronRight className="size-4 text-ink-3" />
              </Link>
            );
          })}
        </div>
      )}
      {isAdminMode && <ProfileForm open={adding} onClose={() => setAdding(false)} />}
    </div>
  );
}
