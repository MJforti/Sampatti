"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useApp, friendlyError } from "@/components/providers";
import { type CalEvent } from "@/components/obligations";
import { Button, Confirm, ErrorState, ListSkeleton, PageHeader, Row, SectionTitle, Sheet, StatusBadge } from "@/components/ui";
import { UploadButtons } from "@/components/doc-list";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { daysBetween, formatDate, relativeDays, todayISO } from "@/lib/dates";
import { formatINR, paiseToInput, parseRupeesToPaise } from "@/lib/money";
import { CATEGORY_LABEL, isInflow } from "@/lib/status";
import { uploadDocument } from "@/lib/documents";

const SOURCE_ROUTE: Record<string, string> = {
  insurance_policies: "insurance", loans: "loans", investments: "investments", vehicles: "vehicles", tax_compliance: "tax", documents: "documents",
};
type Payment = { id: string; paid_on: string; amount_paise: number; reference: string | null; notes: string | null; receipt_document_id: string | null };

export default function TxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tz, isAdminMode, setPinOpen, toast } = useApp();
  const today = todayISO(tz);
  const q = useQuery(async () => {
    const sb = supabase();
    const ev = unwrap(await sb.from("financial_calendar_events").select("*").eq("id", id).maybeSingle()) as CalEvent | null;
    if (!ev) return null;
    const [pay, hist, rem] = await Promise.all([
      sb.from("payments").select("*").eq("scheduled_transaction_id", id).order("created_at", { ascending: false }),
      sb.from("financial_calendar_events").select("*").eq("obligation_id", ev.obligation_id).neq("id", id).order("event_date", { ascending: false }).limit(12),
      sb.from("reminders").select("offset_days, fired_on").eq("scheduled_transaction_id", id).order("fired_on"),
    ]);
    return { ev, payments: (pay.data ?? []) as Payment[], history: (hist.data ?? []) as CalEvent[], reminders: rem.data ?? [] };
  }, [id]);

  const [sheet, setSheet] = useState<null | "paid" | "renewed">(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ paid_on: today, amount: "", reference: "", notes: "", next: "" });
  const [receipt, setReceipt] = useState<File | null>(null);

  if (q.error) return <ErrorState error={q.error} retry={q.reload} />;
  if (q.loading && !q.data) return <ListSkeleton rows={5} />;
  if (!q.data) return <div><PageHeader title="Not found" back="/reminders" /><p className="text-ink-3">This item doesn’t exist or you don’t have access.</p></div>;
  const { ev, payments, history, reminders } = q.data;
  const open = !["paid", "cancelled", "renewed"].includes(ev.status);
  const days = daysBetween(today, ev.event_date);
  const isExpiry = ["vehicle_puc", "vehicle_insurance", "vehicle_fitness", "vehicle_registration", "vehicle_permit", "insurance_renewal", "document_expiry", "vehicle_road_tax", "vehicle_service"].includes(ev.category);

  const act = async (status: string, extra: Record<string, unknown> = {}) => {
    if (!isAdminMode) { setPinOpen(true); return; }
    setBusy(true);
    try {
      let receiptId: string | null = null;
      if (receipt) receiptId = (await uploadDocument(receipt, { entity_id: ev.entity_id, category: "receipt", record_type: "scheduled_transactions", record_id: ev.id, title: `Receipt — ${ev.title}` })).id;
      const { data, error } = await supabase().rpc("resolve_transaction", { p_id: ev.id, p_status: status, p_receipt: receiptId, ...extra });
      if (error) throw error;
      toast(status === "paid" ? "Marked as paid" : status === "renewed" ? "Marked as renewed" : status === "cancelled" ? "Cancelled" : "Updated");
      setSheet(null); setConfirmCancel(false); setReceipt(null);
      q.reload();
      if (data?.next_due_date) toast(`Next due ${formatDate(data.next_due_date)}`);
    } catch (e) { toast(friendlyError(e), "error"); }
    setBusy(false);
  };

  const submitPaid = () => {
    const amt = parseRupeesToPaise(form.amount);
    if (amt === null) return toast("Enter the amount paid", "error");
    act("paid", { p_paid_on: form.paid_on, p_amount: amt, p_reference: form.reference || null, p_notes: form.notes || null, p_next_due: form.next || null });
  };

  return (
    <div>
      <PageHeader title={ev.title} subtitle={`${CATEGORY_LABEL[ev.category] ?? ev.category} · ${ev.entity_name}`} back="/reminders" />
      <div className="card px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-ink-3">{isInflow(ev.category) ? "Expected" : "Amount"}</div>
            <div className="num text-3xl font-semibold tracking-tight">{ev.amount_paise != null ? formatINR(ev.amount_paise) : "—"}</div>
          </div>
          <StatusBadge status={ev.status} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><div className="text-ink-3">Due date</div><div className="font-medium">{formatDate(ev.event_date)}</div></div>
          <div><div className="text-ink-3">{open ? "Remaining" : "Resolved"}</div>
            <div className={open && days < 0 ? "font-semibold text-danger" : open && days <= 3 ? "font-semibold text-warn" : "font-medium"}>{open ? relativeDays(days) : formatDate(ev.paid_on ?? ev.event_date)}</div></div>
        </div>
      </div>

      {ev.status === "awaiting_confirmation" && (
        <div className="card mt-3 px-4 py-3 bg-danger-soft border-danger/20 text-sm text-danger">
          This auto-debit date has passed. Check your bank statement and confirm whether it went through — it is never assumed.
        </div>
      )}

      <div className="card mt-3 px-4">
        <Row label="Responsible" value={ev.entity_name} />
        <Row label="Bank account" value={ev.bank_name ? `${ev.bank_name}${ev.account_last4 ? " ••" + ev.account_last4 : ""}` : "—"} />
        <Row label="Payment mode" value={ev.auto_debit ? "Auto-debit" : "Manual"} />
        <Row label="Category" value={CATEGORY_LABEL[ev.category] ?? ev.category} />
        {ev.instructions && <Row label="Instructions" value={<span className="whitespace-pre-line">{ev.instructions}</span>} />}
        {ev.source_type && ev.source_id && <Row label="Record" value={<Link className="text-accent font-medium" href={ev.source_type === "documents" ? "/documents" : `/m/${SOURCE_ROUTE[ev.source_type]}/${ev.source_id}`}>Open linked record ›</Link>} />}
        {ev.source_type === null && <Row label="Record" value={<Link className="text-accent font-medium" href={`/m/obligations/${ev.obligation_id}`}>Open recurring payment ›</Link>} />}
      </div>

      {open && isAdminMode && (
        <div className="mt-4 grid gap-2">
          {!isExpiry && <Button size="lg" onClick={() => { setForm({ ...form, amount: paiseToInput(ev.amount_paise), paid_on: today }); setSheet("paid"); }}>Mark as paid</Button>}
          {(isExpiry || ev.category.startsWith("insurance")) && <Button size="lg" variant={isExpiry ? "primary" : "secondary"} onClick={() => setSheet("renewed")}>Mark as renewed</Button>}
          {isExpiry && ev.amount_paise != null && <Button variant="secondary" onClick={() => { setForm({ ...form, amount: paiseToInput(ev.amount_paise) }); setSheet("paid"); }}>Record a payment</Button>}
          {ev.auto_debit && ev.status !== "awaiting_confirmation" && days <= 0 && <Button variant="secondary" onClick={() => act("awaiting_confirmation")} loading={busy}>Awaiting bank confirmation</Button>}
          <Button variant="ghost" className="text-danger" onClick={() => setConfirmCancel(true)}>Cancel this occurrence</Button>
        </div>
      )}
      {open && !isAdminMode && <p className="mt-4 text-sm text-ink-3 text-center">Only the administrator can update payment status.</p>}

      {payments.length > 0 && (
        <>
          <SectionTitle>Payment recorded</SectionTitle>
          <div className="card px-4">{payments.map((p) => (
            <div key={p.id}><Row label="Paid on" value={formatDate(p.paid_on)} /><Row label="Amount" value={<span className="num">{formatINR(p.amount_paise)}</span>} />
              {p.reference && <Row label="Reference" value={p.reference} />}{p.notes && <Row label="Notes" value={p.notes} />}
              {p.receipt_document_id && <Row label="Receipt" value={<Link className="text-accent" href="/documents">View in Documents ›</Link>} />}</div>
          ))}</div>
        </>
      )}

      {reminders.length > 0 && (
        <>
          <SectionTitle>Reminders sent</SectionTitle>
          <div className="card px-4 py-3 text-sm text-ink-2">
            {reminders.map((r: { offset_days: number; fired_on: string }, i: number) => (
              <div key={i} className="py-1 flex justify-between"><span>{r.offset_days < 0 ? `${-r.offset_days} days overdue` : r.offset_days === 0 ? "On due date" : `${r.offset_days} days before`}</span><span className="text-ink-3">{formatDate(r.fired_on, "short")}</span></div>
            ))}
          </div>
        </>
      )}

      {history.length > 0 && (
        <>
          <SectionTitle>Other occurrences</SectionTitle>
          <div className="card overflow-hidden">{history.map((h) => (
            <Link key={h.id} href={`/tx/${h.id}`} className="flex items-center justify-between px-4 py-3 border-b hairline last:border-0 text-sm">
              <span>{formatDate(h.event_date)}</span><span className="flex items-center gap-2"><span className="num">{formatINR(h.paid_amount_paise ?? h.amount_paise)}</span><StatusBadge status={h.status} /></span>
            </Link>))}</div>
        </>
      )}

      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet === "paid" ? "Record payment" : "Mark as renewed"}
        footer={<Button size="lg" className="w-full" loading={busy} onClick={() => sheet === "paid" ? submitPaid() : act("renewed", { p_notes: form.notes || null, p_next_due: form.next || null })}>Confirm</Button>}>
        <div className="space-y-4">
          {sheet === "paid" && (<>
            <label className="block"><span className="text-sm font-medium text-ink-2">Payment date</span><input type="date" max={today} className="field mt-1.5" value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} /></label>
            <label className="block"><span className="text-sm font-medium text-ink-2">Amount paid (₹)</span><input inputMode="decimal" className="field mt-1.5 num" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
            <label className="block"><span className="text-sm font-medium text-ink-2">Reference / UTR</span><input className="field mt-1.5" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
          </>)}
          <label className="block"><span className="text-sm font-medium text-ink-2">{sheet === "renewed" || isExpiry ? "New expiry / next due date" : "Next due date (optional)"}</span>
            <input type="date" className="field mt-1.5" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
            <span className="block mt-1 text-xs text-ink-3">{isExpiry ? "Reminders restart for the new date." : "Leave empty to use the regular schedule."}</span></label>
          <label className="block"><span className="text-sm font-medium text-ink-2">Notes</span><textarea rows={2} className="field mt-1.5" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div><span className="text-sm font-medium text-ink-2">Receipt (optional)</span>
            {receipt ? <div className="mt-1.5 text-sm flex justify-between card px-3 py-2"><span className="truncate">{receipt.name}</span><button className="text-danger" onClick={() => setReceipt(null)}>Remove</button></div>
              : <UploadButtons onFile={async (f) => setReceipt(f)} />}</div>
        </div>
      </Sheet>
      <Confirm open={confirmCancel} onClose={() => setConfirmCancel(false)} danger title="Cancel this occurrence?" confirmLabel="Cancel occurrence" loading={busy}
        message="Reminders for this date will stop. For recurring items the next cycle is still scheduled." onConfirm={() => act("cancelled", { p_notes: "Cancelled by administrator" })} />
    </div>
  );
}
