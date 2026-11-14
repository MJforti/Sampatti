"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { useApp, friendlyError } from "@/components/providers";
import { Badge, Button, ErrorState, ListSkeleton, PageHeader, Sheet, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";

type U = { id: string; email: string; full_name: string | null; role: string; is_active: boolean };
type P = { id: string; user_id: string; entity_id: string; categories: string[] | null; can_view_documents: boolean; receive_notifications: boolean };
const ROLES = [["admin", "Administrator"], ["family_member", "Family member"], ["accountant", "Accountant"], ["read_only", "Read-only"]];
const MODS = [["investments", "Investments"], ["insurance", "Insurance"], ["loans", "Loans"], ["vehicles", "Vehicles"], ["banks", "Banks"], ["tax", "Tax"], ["obligations", "Payments"], ["documents", "Documents"]];

export default function Users() {
  const { isAdminMode, entities, toast, user: me } = useApp();
  const sb = supabase();
  const q = useQuery(async () => ({
    users: unwrap(await sb.from("user_profiles").select("*").order("created_at")) as U[],
    perms: unwrap(await sb.from("entity_permissions").select("*")) as P[],
  }), []);
  const [edit, setEdit] = useState<U | null>(null);
  const [invite, setInvite] = useState(false);
  const [inv, setInv] = useState({ email: "", full_name: "", role: "family_member" });
  const [busy, setBusy] = useState(false);

  if (!isAdminMode) return <div><PageHeader title="Users" back="/more" /><p className="text-ink-3">Unlock Admin Mode to manage users.</p></div>;
  if (q.error) return <ErrorState error={q.error} retry={q.reload} />;

  const sendInvite = async () => {
    setBusy(true);
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inv) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(j.error ?? "Invite failed", "error");
    toast("Invitation email sent"); setInvite(false); setInv({ email: "", full_name: "", role: "family_member" }); q.reload();
  };
  const setRole = async (u: U, patch: Partial<U>) => {
    const { error } = await sb.from("user_profiles").update(patch).eq("id", u.id);
    if (error) return toast(friendlyError(error), "error");
    toast("Updated"); q.reload(); setEdit({ ...u, ...patch });
  };
  const perm = (u: U, eId: string) => q.data?.perms.find((p) => p.user_id === u.id && p.entity_id === eId);
  const togglePerm = async (u: U, eId: string, patch: Partial<P> | null) => {
    const cur = perm(u, eId);
    const r = patch === null ? await sb.from("entity_permissions").delete().eq("id", cur!.id)
      : cur ? await sb.from("entity_permissions").update(patch).eq("id", cur.id)
      : await sb.from("entity_permissions").insert({ user_id: u.id, entity_id: eId, categories: null, ...patch });
    if (r.error) return toast(friendlyError(r.error), "error");
    q.reload();
  };

  return (
    <div>
      <PageHeader title="Users & access" back="/more" action={<Button size="sm" variant="admin" onClick={() => setInvite(true)}><UserPlus className="size-4" />Invite</Button>} />
      {q.loading || !q.data ? <ListSkeleton /> : (
        <div className="card overflow-hidden">{q.data.users.map((u) => (
          <button key={u.id} onClick={() => setEdit(u)} className="w-full text-left flex items-center gap-3 px-4 py-3.5 border-b hairline last:border-0 active:bg-surface-2">
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{u.full_name || u.email}</div><div className="text-[13px] text-ink-3 truncate">{u.email}</div></div>
            <Badge tone={u.role === "admin" ? "admin" : "neutral"}>{ROLES.find(([k]) => k === u.role)?.[1]}</Badge>
            {!u.is_active && <Badge tone="muted">Disabled</Badge>}
          </button>))}</div>
      )}
      <p className="mt-3 px-1 text-xs text-ink-3">Administrators see everything. Other users see only the profiles and sections granted below — enforced by the database, not just the screen.</p>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.full_name || edit?.email || ""}>
        {edit && (
          <div className="space-y-4">
            <label className="block"><span className="text-sm font-medium text-ink-2">Role</span>
              <select className="field mt-1.5" value={edit.role} disabled={edit.id === me?.id} onChange={(e) => setRole(edit, { role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {edit.id !== me?.id && <Button variant="secondary" className="w-full" onClick={() => setRole(edit, { is_active: !edit.is_active })}>{edit.is_active ? "Disable account" : "Enable account"}</Button>}
            {edit.role !== "admin" && entities.map((e) => {
              const p = perm(edit, e.id);
              return (
                <div key={e.id} className="card px-4 py-3">
                  <label className="flex items-center justify-between"><span className="font-medium">{e.name}</span>
                    <input type="checkbox" className="size-6 accent-[var(--accent)]" checked={!!p} onChange={(ev) => togglePerm(edit, e.id, ev.target.checked ? {} : null)} /></label>
                  {p && (
                    <div className="mt-2">
                      <div className="text-xs text-ink-3 mb-1.5">Sections (none selected = all)</div>
                      <div className="flex flex-wrap gap-1.5">{MODS.map(([k, l]) => {
                        const on = p.categories?.includes(k) ?? false;
                        return <button key={k} onClick={() => { const next = on ? (p.categories ?? []).filter((x) => x !== k) : [...(p.categories ?? []), k]; togglePerm(edit, e.id, { categories: next.length ? next : null }); }}
                          className={cx("h-8 px-2.5 rounded-full text-[13px] border", on ? "bg-accent text-accent-ink border-accent" : "border-line text-ink-2")}>{l}</button>;
                      })}</div>
                      <div className="mt-2 flex gap-4 text-sm">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={p.can_view_documents} onChange={(ev) => togglePerm(edit, e.id, { can_view_documents: ev.target.checked })} />Documents</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={p.receive_notifications} onChange={(ev) => togglePerm(edit, e.id, { receive_notifications: ev.target.checked })} />Reminders</label>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Sheet>
      <Sheet open={invite} onClose={() => setInvite(false)} title="Invite a user" footer={<Button size="lg" className="w-full" loading={busy} onClick={sendInvite}>Send invitation</Button>}>
        <div className="space-y-4">
          <label className="block"><span className="text-sm font-medium text-ink-2">Email</span><input type="email" className="field mt-1.5" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></label>
          <label className="block"><span className="text-sm font-medium text-ink-2">Name</span><input className="field mt-1.5" value={inv.full_name} onChange={(e) => setInv({ ...inv, full_name: e.target.value })} /></label>
          <label className="block"><span className="text-sm font-medium text-ink-2">Role</span><select className="field mt-1.5" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{ROLES.filter(([k]) => k !== "admin").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <p className="text-xs text-ink-3">After they accept, grant access to profiles from their user card.</p>
        </div>
      </Sheet>
    </div>
  );
}
