"use client";
import { useState } from "react";
import { useApp } from "@/components/providers";
import { Chip, ErrorState, ListSkeleton, PageHeader, Badge } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";

export default function Audit() {
  const { tz, isAdminMode } = useApp();
  const [tab, setTab] = useState<"audit" | "delivery">("audit");
  const q = useQuery(async () => {
    const sb = supabase();
    if (tab === "audit") return unwrap(await sb.from("administrator_audit_logs").select("id, actor_id, action, table_name, record_id, created_at").order("created_at", { ascending: false }).limit(200));
    return unwrap(await sb.from("notification_delivery_logs").select("id, channel, status, attempts, last_error, sent_at, created_at, notifications(title, user_id)").order("created_at", { ascending: false }).limit(200));
  }, [tab]);
  const fmt = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
  if (!isAdminMode) return <div><PageHeader title="Audit log" back="/more" /><p className="text-ink-3">Unlock Admin Mode to view.</p></div>;
  return (
    <div>
      <PageHeader title="Audit & delivery" back="/more" />
      <div className="flex gap-2 mb-3"><Chip active={tab === "audit"} onClick={() => setTab("audit")}>Admin actions</Chip><Chip active={tab === "delivery"} onClick={() => setTab("delivery")}>Notification delivery</Chip></div>
      {q.error ? <ErrorState error={q.error} retry={q.reload} /> : q.loading ? <ListSkeleton /> : (
        <div className="card overflow-hidden text-sm">{(q.data as any[]).map((r) => tab === "audit" ? (
          <div key={r.id} className="px-4 py-3 border-b hairline last:border-0"><div className="font-medium">{r.action}{r.table_name ? ` · ${r.table_name}` : ""}</div><div className="text-[12px] text-ink-3">{fmt(r.created_at)}</div></div>
        ) : (
          <div key={r.id} className="px-4 py-3 border-b hairline last:border-0"><div className="flex justify-between gap-2"><span className="font-medium truncate">{r.notifications?.title}</span>
            <Badge tone={r.status === "sent" ? "ok" : r.status === "failed" ? "danger" : "neutral"}>{r.channel} · {r.status}</Badge></div>
            <div className="text-[12px] text-ink-3">{fmt(r.created_at)}{r.attempts ? ` · ${r.attempts} attempt(s)` : ""}{r.last_error ? ` · ${r.last_error}` : ""}</div></div>
        ))}</div>
      )}
    </div>
  );
}
