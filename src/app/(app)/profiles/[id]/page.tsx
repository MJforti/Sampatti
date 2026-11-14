"use client";
import Link from "next/link";
import { use, useState } from "react";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useApp, friendlyError } from "@/components/providers";
import { ProfileForm } from "@/components/profile-form";
import { MemberAvatar, EmojiPicker, canChooseEmoji } from "@/components/member-emoji";
import { EventList, type CalEvent } from "@/components/obligations";
import { Button, ErrorState, ListSkeleton, PageHeader, Row, SectionTitle, Sheet } from "@/components/ui";
import { MODULES, MODULE_LIST } from "@/lib/modules";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { formatINR } from "@/lib/money";
import { addDays, todayISO } from "@/lib/dates";
import { OPEN_STATUSES } from "@/lib/status";

export default function ProfileDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { entities, isAdminMode, tz, setSelected, selected, toast, reloadRefs, profile } = useApp();
  const [picking, setPicking] = useState(false);
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
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
      {(() => {
        const can = canChooseEmoji(e.id, isAdminMode, profile?.linked_entity_id);
        return (
          <div className="flex items-center gap-4 mb-4">
            <MemberAvatar entity={e} size="lg" onClick={can ? () => setPicking(true) : undefined} />
            {can ? <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>{e.emoji ? "Change emoji" : "Choose emoji"}</Button>
              : <span className="text-sm text-ink-3">{e.emoji ? "Their emoji marks their payments and records" : ""}</span>}
          </div>
        );
      })()}
      <EmojiPicker entity={e} open={picking} onClose={() => setPicking(false)} />
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
          <SectionTitle action={<Link href="/" onClick={() => setSelected(id)} className="inline-flex items-center h-11 -my-3 px-1 text-sm text-accent font-medium">Open dashboard</Link>}>Due in the next 60 days</SectionTitle>
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
      {isAdminMode && (
        <Button variant="ghost" className="w-full mt-6 text-danger" onClick={() => { setConfirmName(""); setRemoving(true); }}>
          <Trash2 className="size-4" />Remove profile
        </Button>
      )}
      <Sheet open={removing} onClose={() => setRemoving(false)} title="Remove profile"
        footer={<Button variant="danger" size="lg" className="w-full" loading={busy}
          disabled={confirmName.trim().toLowerCase() !== e.name.trim().toLowerCase()}
          onClick={async () => {
            setBusy(true);
            const sb = supabase();
            const { data: files } = await sb.from("documents").select("storage_path").eq("entity_id", id);
            const { error } = await sb.rpc("delete_entity", { p_entity: id, p_confirm_name: confirmName });
            if (error) { setBusy(false); return toast(friendlyError(error), "error"); }
            if (files?.length) await sb.storage.from("documents").remove(files.map((f: { storage_path: string }) => f.storage_path));
            if (selected === id) setSelected(null);
            await reloadRefs();
            toast(`${e.name} removed`);
            router.replace("/profiles");
          }}>Remove permanently</Button>}>
        <div className="space-y-4 text-[15px]">
          <p className="text-ink-2">This permanently deletes <span className="text-ink font-medium">{e.name}</span> and everything that belongs to it:</p>
          {q.data && <ul className="card px-4 py-2 text-sm">{MODULE_LIST.map((m, i) => q.data!.counts[i] > 0 && (
            <li key={m} className="flex justify-between py-1.5"><span className="text-ink-2">{MODULES[m].title}</span><span className="num">{q.data!.counts[i]}</span></li>))}
            <li className="flex justify-between py-1.5"><span className="text-ink-2">Documents, payments and reminders</span><span>all</span></li></ul>}
          <p className="text-sm text-ink-3">This can’t be undone. To keep the history, edit the profile and switch off <span className="text-ink-2">Active</span> instead.</p>
          <label className="block"><span className="text-sm font-medium text-ink-2">Type <span className="text-ink">{e.name}</span> to confirm</span>
            <input className="field mt-1.5" value={confirmName} onChange={(ev) => setConfirmName(ev.target.value)} autoComplete="off" /></label>
        </div>
      </Sheet>
      {isAdminMode && <ProfileForm open={editing} onClose={() => { setEditing(false); q.reload(); }} entity={e} />}
    </div>
  );
}
