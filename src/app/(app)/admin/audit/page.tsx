"use client";
import { useState } from "react";
import { useApp } from "@/components/providers";
import { Chip, ErrorState, ListSkeleton, PageHeader, Badge, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { MODULES } from "@/lib/modules";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";

type Log = { id: number; actor_id: string | null; action: string; table_name: string | null; record_id: string | null; old_data: Rec | null; new_data: Rec | null; created_at: string };
type Rec = Record<string, any>;

const THING: Record<string, string> = {
  family_entities: "profile", bank_accounts: "bank account", investments: "investment", insurance_policies: "insurance policy",
  loans: "loan", vehicles: "vehicle", tax_compliance: "tax item", recurring_obligations: "recurring payment",
  scheduled_transactions: "due item", payments: "payment", documents: "document", entity_permissions: "access permission",
  user_profiles: "user",
};
const SPECIAL: Record<string, string> = {
  "admin.bootstrap": "set up the administrator PIN", "admin.unlocked": "unlocked Admin Mode", "admin.locked": "locked Admin Mode",
  "admin.pin_failed": "entered a wrong admin PIN", "admin.pin_denied_not_admin": "tried to open Admin Mode without admin rights",
  "admin.pin_changed": "changed the admin PIN", "admin.sessions_revoked": "signed out all Admin Mode sessions",
  "settings.updated": "changed app settings", "user.password_reset": "reset a user’s password", "entity.deleted": "removed a profile", "family.joined": "joined a family",
};
const STATUS: Record<string, string> = { paid: "paid", renewed: "renewed", cancelled: "cancelled", overdue: "overdue", awaiting_confirmation: "awaiting bank confirmation", auto_debit_scheduled: "auto-debit scheduled", upcoming: "upcoming", due_today: "due today" };
const HIDDEN = new Set(["id", "updated_at", "created_at", "details", "anchor_day", "resolved_at", "entity_id"]);
const EXTRA_LABELS: Record<string, string> = { status: "status", is_active: "active", archived_at: "archived", role: "role", full_name: "name", categories: "sections", can_view_documents: "document access", receive_notifications: "reminders", due_date: "due date", amount_paise: "amount", next_due_date: "next due date", current_version: "file version" };

function fieldLabel(table: string | null, key: string) {
  const mod = Object.values(MODULES).find((m) => m.table === table);
  const f = mod?.fields.find((x) => x.key === key);
  return (f?.label ?? EXTRA_LABELS[key] ?? key.replace(/_paise$/, "").replace(/_/g, " ")).toLowerCase();
}
function recName(table: string | null, r: Rec | null): string {
  if (!r) return "";
  return r.name || r.title || r.policy_name || r.registration_number || (r.bank_name && `${r.bank_name}${r.account_last4 ? " ••" + r.account_last4 : ""}`) ||
    (r.lender && `${r.lender} loan`) || r.insurer || r.email || (r.amount_paise != null ? formatINR(r.amount_paise) : "") || "";
}
function show(key: string, v: unknown) {
  if (v === null || v === undefined || v === "") return "blank";
  if (key.endsWith("_paise") && typeof v === "number") return formatINR(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v, "short");
  if (key === "status" && typeof v === "string") return STATUS[v] ?? v;
  if (key === "role" && typeof v === "string") return ({ admin: "administrator", family_member: "family member", accountant: "accountant", read_only: "view only" } as Record<string, string>)[v] ?? v;
  if (Array.isArray(v)) return v.length ? `${v.length} selected` : "none";
  if (typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)) return "changed";
  return String(v).length > 40 ? String(v).slice(0, 40) + "…" : String(v);
}

function describe(l: Log, entityName: (id: string) => string): { text: string; details: string[]; tone: string } {
  if (SPECIAL[l.action]) {
    const extra = l.action === "entity.deleted" ? ` “${l.old_data?.name}”` : l.action === "family.joined" ? ` “${l.new_data?.name}”${l.new_data?.left ? ` (left “${l.new_data.left}”)` : ""}` : "";
    return { text: SPECIAL[l.action] + extra, details: [], tone: l.action.includes("fail") || l.action.includes("denied") ? "danger" : "neutral" };
  }
  const rec = l.new_data ?? l.old_data;
  // Hide bookkeeping the app does automatically behind each real change
  if (l.table_name === "recurring_obligations" && rec?.source_type) return { text: "", details: [], tone: "neutral" };
  if (l.table_name === "payments") return { text: "", details: [], tone: "neutral" };
  if (l.table_name === "scheduled_transactions" && !(l.action === "update" && l.new_data?.status !== l.old_data?.status && ["paid", "renewed", "cancelled"].includes(l.new_data?.status))) return { text: "", details: [], tone: "neutral" };
  const thing = THING[l.table_name ?? ""] ?? "record";
  const name = recName(l.table_name, rec);
  const owner = rec?.entity_id && l.table_name !== "family_entities" ? entityName(rec.entity_id) : "";
  const label = `${thing}${name ? ` “${name}”` : ""}${owner && owner !== "—" ? ` for ${owner}` : ""}`;
  const a = /^[aeiou]/.test(thing) ? "an" : "a";
  if (l.action === "insert") return { text: `added ${a} ${label}`, details: [], tone: "ok" };
  if (l.action === "delete") return { text: `deleted ${a} ${label}`, details: [], tone: "danger" };
  const changes: string[] = [];
  const o = l.old_data ?? {}, n = l.new_data ?? {};
  for (const k of Object.keys(n)) {
    if (HIDDEN.has(k) || JSON.stringify(o[k]) === JSON.stringify(n[k])) continue;
    if (k === "archived_at") { changes.push(n[k] ? "archived it" : "restored it"); continue; }
    changes.push(`${fieldLabel(l.table_name, k)}: ${show(k, o[k])} → ${show(k, n[k])}`);
  }
  if (l.table_name === "scheduled_transactions" && n.status && o.status !== n.status) return { text: `marked the ${label.replace(/^due item/, "payment")} as ${STATUS[n.status] ?? n.status}`, details: [], tone: "ok" };
  if (!changes.length) return { text: "", details: [], tone: "neutral" };
  return { text: `updated the ${label}`, details: changes.slice(0, 6), tone: "neutral" };
}

export default function Audit() {
  const { tz, isAdminMode, entityName } = useApp();
  const [tab, setTab] = useState<"audit" | "delivery">("audit");
  const q = useQuery(async () => {
    const sb = supabase();
    const users = unwrap(await sb.from("user_profiles").select("id, full_name, email")) as { id: string; full_name: string | null; email: string }[];
    const who = (id: string | null) => { const u = users.find((x) => x.id === id); return u ? (u.full_name || u.email) : "The system"; };
    if (tab === "audit") {
      const logs = unwrap(await sb.from("administrator_audit_logs").select("*").order("created_at", { ascending: false }).limit(300)) as Log[];
      return { who, logs, delivery: [] as any[] };
    }
    const delivery = unwrap(await sb.from("notification_delivery_logs").select("id, channel, status, attempts, last_error, created_at, notifications(title, user_id)").neq("channel", "in_app").order("created_at", { ascending: false }).limit(200));
    return { who, logs: [] as Log[], delivery: delivery as any[] };
  }, [tab]);

  const when = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: tz, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  if (!isAdminMode) return <div><PageHeader title="Activity" back="/more" /><p className="text-ink-3">Unlock Admin Mode to view activity.</p></div>;

  const rows = (q.data?.logs ?? []).map((l) => ({ l, d: describe(l, entityName) })).filter((x) => x.d.text);
  // group by day
  const days = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = new Date(r.l.created_at).toLocaleDateString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
    days.set(k, [...(days.get(k) ?? []), r]);
  }

  return (
    <div>
      <PageHeader title="Activity" subtitle="Everything changed in the app, and by whom" back="/more" />
      <div className="flex gap-2 mb-3"><Chip active={tab === "audit"} onClick={() => setTab("audit")}>Changes</Chip><Chip active={tab === "delivery"} onClick={() => setTab("delivery")}>Notifications sent</Chip></div>
      {q.error ? <ErrorState error={q.error} retry={q.reload} /> : q.loading || !q.data ? <ListSkeleton /> : tab === "audit" ? (
        rows.length === 0 ? <div className="card px-4 py-6 text-center text-sm text-ink-3">No activity yet</div> :
        [...days.entries()].map(([day, list]) => (
          <div key={day} className="mb-4">
            <div className="text-[15px] font-medium text-ink-2 mb-2 px-1">{day}</div>
            <div className="card overflow-hidden">
              {list.map(({ l, d }) => (
                <div key={l.id} className="flex gap-3 px-4 py-3 border-b hairline last:border-0">
                  <span className={cx("mt-2 size-2 rounded-full shrink-0", d.tone === "ok" ? "bg-ok" : d.tone === "danger" ? "bg-danger" : "bg-ink-3")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] leading-snug"><span className="font-medium">{q.data!.who(l.actor_id)}</span> {d.text}</div>
                    {d.details.length > 0 && <ul className="mt-1 text-[13px] text-ink-2 space-y-0.5">{d.details.map((x, i) => <li key={i}>{x}</li>)}</ul>}
                    <div className="mt-0.5 text-[12px] text-ink-3 num">{when(l.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        q.data.delivery.length === 0 ? <div className="card px-4 py-6 text-center text-sm text-ink-3">No phone notifications sent yet</div> :
        <div className="card overflow-hidden">{q.data.delivery.map((r) => (
          <div key={r.id} className="px-4 py-3 border-b hairline last:border-0">
            <div className="flex justify-between gap-2"><span className="text-[15px] truncate">{r.notifications?.title}</span>
              <Badge tone={r.status === "sent" ? "ok" : r.status === "failed" ? "danger" : "neutral"}>{{ sent: "Delivered", failed: "Failed", skipped: "Skipped", pending: "Waiting", sending: "Sending" }[r.status as string] ?? r.status}</Badge></div>
            <div className="text-[13px] text-ink-3">{r.channel === "push" ? "Phone notification" : r.channel === "email" ? "Email" : r.channel} to {q.data!.who(r.notifications?.user_id)} · {when(r.created_at)}</div>
            {r.status === "failed" && r.last_error && <div className="text-[12px] text-danger mt-0.5">{/subscription/.test(r.last_error) ? "Their phone didn’t accept it — they may need to turn notifications on again" : /VAPID/.test(r.last_error) ? "Phone notifications aren’t set up" : r.last_error}</div>}
          </div>
        ))}</div>
      )}
    </div>
  );
}
