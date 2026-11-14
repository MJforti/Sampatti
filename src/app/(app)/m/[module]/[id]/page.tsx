"use client";
import { notFound, useRouter } from "next/navigation";
import { use, useState } from "react";
import { Pencil, Archive, Trash2, RotateCcw } from "lucide-react";
import { useApp, friendlyError } from "@/components/providers";
import { RecordForm } from "@/components/record-form";
import { EventList, type CalEvent } from "@/components/obligations";
import { RecordDocs } from "@/components/doc-list";
import { Button, Confirm, ErrorState, ListSkeleton, PageHeader, Row, SectionTitle, Badge } from "@/components/ui";
import { FREQUENCIES, MODULES, label, type Field } from "@/lib/modules";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { formatINR } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/dates";
import { amortise } from "@/lib/loan";

const DOC_CAT: Record<string, string> = { insurance: "insurance_policy", loans: "loan_statement", vehicles: "vehicle_rc", investments: "investment_statement", tax: "tax_challan" };

export default function Detail({ params }: { params: Promise<{ module: string; id: string }> }) {
  const { module, id } = use(params);
  const mod = MODULES[module];
  if (!mod) notFound();
  const router = useRouter();
  const { canEdit, entityName, bankLabel, vehicles, toast, reloadRefs, tz } = useApp();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "archive" | "delete" | "restore">(null);
  const [busy, setBusy] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const q = useQuery(async () => {
    const sb = supabase();
    const rec = unwrap(await sb.from(mod.table).select("*").eq("id", id).maybeSingle()) as Record<string, any> | null;
    if (!rec) return null;
    const evq = mod.table === "recurring_obligations"
      ? sb.from("financial_calendar_events").select("*").eq("obligation_id", id)
      : sb.from("financial_calendar_events").select("*").eq("source_id", id);
    const ev = unwrap(await evq.order("event_date", { ascending: false }).limit(30)) as CalEvent[];
    let extra: Record<string, any[]> = {};
    if (mod.table === "bank_accounts") {
      const [inv, ins, ln, obl] = await Promise.all([
        sb.from("investments").select("id,name").eq("bank_account_id", id).is("archived_at", null),
        sb.from("insurance_policies").select("id,policy_name,insurer").eq("bank_account_id", id).is("archived_at", null),
        sb.from("loans").select("id,lender,loan_type").eq("bank_account_id", id).is("archived_at", null),
        sb.from("financial_calendar_events").select("*").eq("bank_account_id", id).in("status", ["upcoming", "due_today", "auto_debit_scheduled", "overdue", "awaiting_confirmation"]).order("event_date").limit(30),
      ]);
      extra = { inv: inv.data ?? [], ins: ins.data ?? [], ln: ln.data ?? [], obl: obl.data ?? [] };
    }
    return { rec, ev, extra };
  }, [mod.table, id]);

  const isAdminMode = canEdit(q.data?.rec?.entity_id);
  if (q.error) return <ErrorState error={q.error} retry={q.reload} />;
  if (q.loading && !q.data) return <ListSkeleton rows={6} />;
  if (!q.data) return <div><PageHeader title="Not found" back={`/m/${module}`} /><p className="text-ink-3">This record doesn’t exist or you don’t have access.</p></div>;
  const { rec: r, ev, extra } = q.data;
  const archived = !!r.archived_at;
  const open = ev.filter((e) => !["paid", "cancelled", "renewed"].includes(e.status)).sort((a, b) => a.event_date.localeCompare(b.event_date));
  const past = ev.filter((e) => ["paid", "cancelled", "renewed"].includes(e.status));

  const doAction = async () => {
    setBusy(true);
    const sb = supabase();
    let error;
    if (confirm === "delete") ({ error } = await sb.from(mod.table).delete().eq("id", id));
    else if (mod.table === "recurring_obligations") ({ error } = await sb.from(mod.table).update({ is_active: confirm === "restore" }).eq("id", id));
    else ({ error } = await sb.from(mod.table).update({ archived_at: confirm === "restore" ? null : new Date().toISOString() }).eq("id", id));
    setBusy(false);
    if (error) return toast(friendlyError(error), "error");
    toast(confirm === "delete" ? "Deleted" : confirm === "restore" ? "Restored" : "Archived — reminders stopped");
    setConfirm(null);
    reloadRefs();
    if (confirm === "delete") router.replace(`/m/${module}`); else q.reload();
  };

  const groups: { title: string; fields: Field[] }[] = [];
  for (const f of mod.fields) {
    if (f.showIf && !f.showIf(r)) continue;
    if (f.section || !groups.length) groups.push({ title: f.section ?? "Details", fields: [] });
    groups[groups.length - 1].fields.push(f);
  }
  const display = (f: Field) => {
    const v = f.key.startsWith("details.") ? r.details?.[f.key.slice(8)] : r[f.key];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return null;
    switch (f.type) {
      case "money": return <span className="num">{formatINR(v)}</span>;
      case "date": return formatDate(v);
      case "bool": return v ? "Yes" : "No";
      case "percent": return `${v}%`;
      case "entity": return entityName(v);
      case "entities": return (v as string[]).map(entityName).join(", ");
      case "bank": return bankLabel(v);
      case "vehicle": return vehicles.find((x) => x.id === v)?.registration_number ?? "—";
      case "frequency": return label(FREQUENCIES, v);
      case "select": return label(f.options ?? [], v);
      case "textarea": return <span className="whitespace-pre-line">{v}</span>;
      default: return String(v);
    }
  };

  const schedule = module === "loans" && r.outstanding_paise > 0 && r.emi_paise > 0
    ? amortise(r.outstanding_paise, r.interest_rate, r.emi_paise, r.next_emi_date ?? todayISO(tz)) : null;

  return (
    <div>
      <PageHeader title={mod.primary(r)} subtitle={`${entityName(r.entity_id)} · ${mod.secondary(r)}`} back={`/m/${module}`} />
      {archived && <Badge tone="muted">Archived</Badge>}

      {module === "investments" && (
        <div className="card px-5 py-4 grid grid-cols-2 gap-3">
          <div><div className="text-sm text-ink-3">Invested</div><div className="num text-xl font-semibold">{formatINR(r.invested_paise)}</div></div>
          <div><div className="text-sm text-ink-3">Current value {r.value_is_verified ? "" : "(est.)"}</div><div className="num text-xl font-semibold">{formatINR(r.current_value_paise)}</div></div>
          {r.current_value_paise != null && <div className="col-span-2 text-sm">
            <span className={r.current_value_paise >= r.invested_paise ? "text-ok" : "text-danger"}>
              {r.current_value_paise >= r.invested_paise ? "▲ " : "▼ "}<span className="num">{formatINR(Math.abs(r.current_value_paise - r.invested_paise))}</span>
              {r.invested_paise > 0 && ` (${(((r.current_value_paise - r.invested_paise) * 10000) / r.invested_paise / 100).toFixed(2)}%)`}</span>
            <span className="text-ink-3">{r.value_as_of ? ` · as of ${formatDate(r.value_as_of, "short")}` : ""}</span></div>}
        </div>
      )}
      {module === "loans" && schedule && (
        <div className="card px-5 py-4 grid grid-cols-2 gap-3">
          <div><div className="text-sm text-ink-3">Outstanding</div><div className="num text-xl font-semibold">{formatINR(r.outstanding_paise)}</div></div>
          <div><div className="text-sm text-ink-3">EMI</div><div className="num text-xl font-semibold">{formatINR(r.emi_paise)}</div></div>
          <div><div className="text-sm text-ink-3">Est. remaining</div><div className="font-medium">{schedule.feasible ? `${schedule.rows.length} months` : "EMI below interest"}</div></div>
          <div><div className="text-sm text-ink-3">Est. closure</div><div className="font-medium">{schedule.feasible ? formatDate(schedule.rows.at(-1)!.date, "short") : "—"}</div></div>
          <div className="col-span-2 text-sm text-ink-3">Annual EMI outflow <span className="num text-ink font-medium">{formatINR(r.emi_paise * 12)}</span> · est. future interest <span className="num text-ink font-medium">{formatINR(schedule.totalInterest)}</span></div>
          <button className="col-span-2 text-left text-sm text-accent font-medium" onClick={() => setShowSchedule(!showSchedule)}>{showSchedule ? "Hide" : "Show"} estimated repayment schedule</button>
          {showSchedule && <div className="col-span-2 max-h-80 overflow-auto -mx-2 text-[13px]">
            <table className="w-full num"><thead className="text-ink-3 text-left sticky top-0 bg-surface"><tr><th className="px-2 py-1">Month</th><th className="px-2">Interest</th><th className="px-2">Principal</th><th className="px-2">Balance</th></tr></thead>
              <tbody>{schedule.rows.map((s) => <tr key={s.n} className="border-t hairline"><td className="px-2 py-1">{formatDate(s.date, "short")}</td><td className="px-2">{formatINR(s.interest)}</td><td className="px-2">{formatINR(s.principal)}</td><td className="px-2">{formatINR(s.balance)}</td></tr>)}</tbody></table>
            <p className="px-2 pt-2 text-[11px] text-ink-3">Estimate at the current rate. Excludes rate changes, moratoriums and prepayments.</p></div>}
        </div>
      )}

      {open.length > 0 && <><SectionTitle>Upcoming</SectionTitle><EventList events={open} /></>}
      {module === "banks" && (
        <>
          <SectionTitle>Expected deductions from this account</SectionTitle>
          <EventList events={extra.obl as CalEvent[]} empty="No scheduled deductions." />
          <SectionTitle>Linked records</SectionTitle>
          <div className="card px-4 py-2 text-sm">
            {[...extra.inv.map((x) => ["Investment", x.name, `/m/investments/${x.id}`]), ...extra.ins.map((x) => ["Insurance", x.policy_name || x.insurer, `/m/insurance/${x.id}`]), ...extra.ln.map((x) => ["Loan", `${x.lender} ${x.loan_type}`, `/m/loans/${x.id}`])]
              .map(([k, n, h]) => <a key={h} href={h} className="flex justify-between py-2.5 border-b hairline last:border-0"><span>{n}</span><span className="text-ink-3">{k} ›</span></a>)}
            {!extra.inv.length && !extra.ins.length && !extra.ln.length && <div className="py-2 text-ink-3">No linked investments, policies or loans.</div>}
          </div>
        </>
      )}

      {groups.map((g) => {
        const rows = g.fields.map((f) => [f, display(f)] as const).filter(([, v]) => v !== null);
        if (!rows.length) return null;
        return <div key={g.title}><SectionTitle>{g.title}</SectionTitle><div className="card px-4">{rows.map(([f, v]) => <Row key={f.key} label={f.label} value={v} />)}</div></div>;
      })}
      {module === "tax" && <p className="mt-2 px-1 text-xs text-ink-3">Statutory dates can change. Always re-verify against the official source before filing.</p>}

      {mod.table !== "recurring_obligations" && mod.table !== "bank_accounts" && (
        <><SectionTitle>Documents</SectionTitle><RecordDocs entityId={r.entity_id} recordType={mod.table} recordId={r.id} category={DOC_CAT[module]} /></>
      )}
      {past.length > 0 && <><SectionTitle>History</SectionTitle><EventList events={past} /></>}

      {isAdminMode && (
        <div className="mt-6 grid gap-2">
          <Button variant="admin" size="lg" onClick={() => setEditing(true)}><Pencil className="size-4" />Edit</Button>
          {archived || (mod.table === "recurring_obligations" && !r.is_active)
            ? <Button variant="secondary" onClick={() => setConfirm("restore")}><RotateCcw className="size-4" />Restore</Button>
            : <Button variant="secondary" onClick={() => setConfirm("archive")}><Archive className="size-4" />{mod.table === "recurring_obligations" ? "Deactivate" : "Archive"}</Button>}
          <Button variant="ghost" className="text-danger" onClick={() => setConfirm("delete")}><Trash2 className="size-4" />Delete permanently</Button>
        </div>
      )}
      {isAdminMode && <RecordForm mod={mod} record={r} open={editing} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reloadRefs(); q.reload(); }} />}
      <Confirm open={confirm !== null} onClose={() => setConfirm(null)} loading={busy} danger={confirm === "delete"}
        title={confirm === "delete" ? "Delete permanently?" : confirm === "restore" ? "Restore this record?" : "Archive this record?"}
        confirmLabel={confirm === "delete" ? "Delete" : confirm === "restore" ? "Restore" : "Archive"}
        message={confirm === "delete" ? "This removes the record and its scheduled reminders. Payment history linked to it is also removed. This cannot be undone — archiving is usually better."
          : confirm === "restore" ? "Reminders will resume for its dates." : "Open reminders for this record will stop. You can restore it later."}
        onConfirm={doAction} />
    </div>
  );
}
