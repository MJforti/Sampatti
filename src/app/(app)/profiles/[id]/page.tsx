"use client";
import Link from "next/link";
import { use, useState } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { useApp } from "@/components/providers";
import { ProfileForm } from "@/components/profile-form";
import { EventList, type CalEvent } from "@/components/obligations";
import { Button, ErrorState, ListSkeleton, PageHeader, Row, SectionTitle } from "@/components/ui";
import { MODULES, MODULE_LIST } from "@/lib/modules";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { formatINR } from "@/lib/money";
import { addDays, todayISO } from "@/lib/dates";
import { OPEN_STATUSES } from "@/lib/status";

export default function ProfileDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { entities, isAdminMode, tz, setSelected } = useApp();
  const e = entities.find((x) => x.id === id);
  const [editing, setEditing] = useState(false);
  const today = todayISO(tz);

  const q = useQuery(async () => {
    const sb = supabase();
    const [summary, ev, ...counts] = await Promise.all([
      sb.rpc("dashboard_summary", { p_entity: id }),
      sb.from("financial_calendar_events").select("*").eq("entity_id", id).in("status", OPEN_STATUSES).lte("event_date", addDays(today, 60)).order("event_date"),
      ...MODULE_LIST.map((m) => {
        let qq = sb.from(MODULES[m].table).select("id", { count: "exact", head: true }).eq("entity_id", id);
        qq = MODULES[m].table === "recurring_obligations" ? qq.is("source_type", null) : qq.is("archived_at", null);
        return qq;
      }),
    ]);
    return { s: unwrap(summary) as Record<string, number>, ev: unwrap(ev) as CalEvent[], counts: counts.map((c) => c.count ?? 0) };
  }, [id, today]);

  if (!e) return <div><PageHeader title="Profile" back="/profiles" /><p className="text-ink-3">Not found or not shared with you.</p></div>;
  return (
    <div>
      <PageHeader title={e.name} back="/profiles" subtitle={e.entity_type.toUpperCase() === "HUF" ? "HUF" : e.entity_type[0].toUpperCase() + e.entity_type.slice(1)}
        action={isAdminMode ? <Button size="sm" variant="admin" onClick={() => setEditing(true)}><Pencil className="size-4" />Edit</Button> : undefined} />
      {q.error && <ErrorState error={q.error} retry={q.reload} />}
      {q.loading || !q.data ? <ListSkeleton rows={4} /> : (
        <>
          <div className="card px-4">
            <Row label="Investments (current)" value={<span className="num">{formatINR(q.data.s.current_value)}</span>} />
            <Row label="Loans outstanding" value={<span className="num">{formatINR(q.data.s.loans_outstanding)}</span>} />
            <Row label="Monthly EMIs" value={<span className="num">{formatINR(q.data.s.monthly_emi)}</span>} />
            <Row label="Monthly SIPs" value={<span className="num">{formatINR(q.data.s.monthly_sip)}</span>} />
            <Row label="Insurance cover" value={<span className="num">{formatINR(q.data.s.insurance_cover)}</span>} />
            <Row label="Est. net worth" value={<span className="num font-semibold">{formatINR(q.data.s.net_worth_estimate)}</span>} />
          </div>
          <SectionTitle action={<Link href="/" onClick={() => setSelected(id)} className="text-sm text-accent font-medium">Open dashboard</Link>}>Due in the next 60 days</SectionTitle>
          <EventList events={q.data.ev} empty="Nothing due." />
          <SectionTitle>Records</SectionTitle>
          <div className="card overflow-hidden">
            {MODULE_LIST.map((m, i) => (
              <Link key={m} href={`/m/${m}`} onClick={() => setSelected(id)} className="flex items-center justify-between px-4 py-3.5 border-b hairline last:border-0 active:bg-surface-2">
                <span>{MODULES[m].title}</span><span className="flex items-center gap-2 text-ink-3 num">{q.data!.counts[i]}<ChevronRight className="size-4" /></span>
              </Link>
            ))}
          </div>
          {(e.email || e.phone || e.notes) && <><SectionTitle>Contact</SectionTitle><div className="card px-4">
            {e.email && <Row label="Email" value={e.email} />}{e.phone && <Row label="Phone" value={e.phone} />}{e.pan_masked && <Row label="PAN" value={e.pan_masked} />}{e.notes && <Row label="Notes" value={e.notes} />}</div></>}
        </>
      )}
      {isAdminMode && <ProfileForm open={editing} onClose={() => { setEditing(false); q.reload(); }} entity={e} />}
    </div>
  );
}
