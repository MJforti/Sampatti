"use client";
import { useState } from "react";
import { useApp, friendlyError } from "@/components/providers";
import { Badge, Button, ErrorState, ListSkeleton, PageHeader, Sheet, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";

type U = { id: string; email: string; full_name: string | null; role: string; is_active: boolean; linked_entity_id?: string | null };
type P = { id: string; user_id: string; entity_id: string; categories: string[] | null; can_view_documents: boolean; receive_notifications: boolean };
const ROLES = [["admin", "Ultra admin"], ["family_member", "Family member"], ["accountant", "Accountant"], ["read_only", "Read-only"]];
const MODS = [["investments", "Investments"], ["insurance", "Insurance"], ["loans", "Loans"], ["vehicles", "Vehicles"], ["banks", "Banks"], ["tax", "Tax"], ["obligations", "Payments"], ["documents", "Documents"]];

export default function Users() {
  const { isUltra: isAdminMode, entities, families, toast, user: me, reloadRefs } = useApp();
  const sb = supabase();
  const q = useQuery(async () => ({
    users: unwrap(await sb.from("user_profiles").select("*").order("created_at")) as U[],
    perms: unwrap(await sb.from("entity_permissions").select("*")) as P[],
    members: unwrap(await sb.from("family_memberships").select("user_id, family_id, is_admin")) as { user_id: string; family_id: string; is_admin: boolean }[],
  }), []);
  const [edit, setEdit] = useState<U | null>(null);
  const [newPw, setNewPw] = useState("");

  if (!isAdminMode) return <div><PageHeader title="Users" back="/more" /><p className="text-ink-3">Unlock Admin Mode to manage users.</p></div>;
  if (q.error) return <ErrorState error={q.error} retry={q.reload} />;

  const resetPassword = async (u: U) => {
    if (newPw.length < 8) return toast("Use at least 8 characters", "error");
    const { error } = await sb.rpc("admin_set_password", { p_user: u.id, p_password: newPw });
    if (error) return toast(friendlyError(error), "error");
    toast("Password updated. Share it with them privately"); setNewPw("");
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
      <PageHeader title="Users & access" back="/more" />
      <div className="card px-4 py-3 mb-3 text-sm text-ink-2">To add someone, ask them to open the app and tap <b className="font-medium text-ink">Create account</b>. They appear here; then grant access below.</div>
      {q.loading || !q.data ? <ListSkeleton /> : (
        <div className="card overflow-hidden">{q.data.users.map((u) => (
          <button key={u.id} onClick={() => setEdit(u)} className="w-full text-left flex items-center gap-3 px-4 py-3.5 border-b hairline last:border-0 active:bg-surface-2">
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{u.full_name || u.email}</div><div className="text-[13px] text-ink-3 truncate">{u.email}</div></div>
            <Badge tone={u.role === "admin" ? "admin" : "neutral"}>{q.data!.members.find((x) => x.user_id === u.id && x.is_admin) && u.role !== "admin" ? "Family admin" : ROLES.find(([k]) => k === u.role)?.[1]}</Badge>
            {!u.is_active && <Badge tone="muted">Disabled</Badge>}
          </button>))}</div>
      )}
      <p className="mt-3 px-1 text-xs text-ink-3">The ultra admin sees everything. Family admins manage their own family only. Other users see only the profiles and sections granted below — enforced by the database, not just the screen.</p>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.full_name || edit?.email || ""}>
        {edit && (
          <div className="space-y-4">
            {edit.role !== "admin" && (() => {
              const m = q.data?.members.find((x) => x.user_id === edit.id);
              return (
                <label className="block"><span className="text-sm font-medium text-ink-2">Family admin of</span>
                  <select className="field mt-1.5" value={m?.is_admin ? m.family_id : ""} onChange={async (ev) => {
                    const fid = ev.target.value;
                    const r = fid ? await sb.rpc("set_family_admin", { p_user: edit.id, p_family: fid, p_admin: true })
                      : m ? await sb.rpc("set_family_admin", { p_user: edit.id, p_family: m.family_id, p_admin: false }) : { error: null };
                    if (r.error) return toast(friendlyError(r.error), "error");
                    toast(fid ? "Family admin set. They’ll choose their own PIN" : "Family admin removed"); q.reload(); reloadRefs();
                  }}>
                    <option value="">Not a family admin{m ? ` (member of ${families.find((f) => f.id === m.family_id)?.name ?? "a family"})` : ""}</option>
                    {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  <span className="block mt-1 text-xs text-ink-3">Can add and edit records for that family only. Choosing a family moves them into it</span></label>
              );
            })()}
            <label className="block"><span className="text-sm font-medium text-ink-2">This person is</span>
              <select className="field mt-1.5" value={(edit as U & { linked_entity_id?: string | null }).linked_entity_id ?? ""} onChange={async (ev) => {
                const { error } = await sb.rpc("link_user_profile", { p_user: edit.id, p_entity: ev.target.value || null });
                if (error) return toast(friendlyError(error), "error");
                toast("Linked"); q.reload(); setEdit({ ...edit, linked_entity_id: ev.target.value || null } as U);
              }}>
                <option value="">Not linked to a profile</option>{entities.map((x) => <option key={x.id} value={x.id}>{x.emoji ? x.emoji + " " : ""}{x.name}</option>)}
              </select>
              <span className="block mt-1 text-xs text-ink-3">Lets them choose their own emoji</span></label>
            <label className="block"><span className="text-sm font-medium text-ink-2">Role</span>
              <select className="field mt-1.5" value={edit.role} disabled={edit.id === me?.id} onChange={(e) => setRole(edit, { role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {edit.id !== me?.id && <Button variant="secondary" className="w-full" onClick={() => setRole(edit, { is_active: !edit.is_active })}>{edit.is_active ? "Disable account" : "Enable account"}</Button>}
            <div className="card px-4 py-3">
              <div className="text-sm font-medium mb-2">Reset password</div>
              <div className="flex gap-2"><input className="field" type="text" autoComplete="off" placeholder="New password" value={newPw} onChange={(ev) => setNewPw(ev.target.value)} />
                <Button variant="secondary" onClick={() => resetPassword(edit)}>Set</Button></div>
            </div>
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
                          className={cx("h-10 px-3 rounded-full text-[13px] border", on ? "bg-accent text-accent-ink border-accent" : "border-line text-ink-2")}>{l}</button>;
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
    </div>
  );
}
