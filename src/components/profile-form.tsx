"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useApp, friendlyError, type Entity } from "./providers";
import { Button, Sheet } from "./ui";

export function ProfileForm({ open, onClose, entity, defaultFamilyId }: { open: boolean; onClose: () => void; entity?: Entity; defaultFamilyId?: string | null }) {
  const { toast, reloadRefs, families } = useApp();
  const blank = { name: "", family_id: defaultFamilyId ?? "", entity_type: "individual", email: "", phone: "", pan_masked: "", notes: "", is_active: true };
  const [v, setV] = useState<Record<string, any>>(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV(entity ? { ...blank, ...Object.fromEntries(Object.entries(entity).map(([k, x]) => [k, x ?? ""])) } : blank); }, [open, entity, defaultFamilyId]); // eslint-disable-line

  const save = async () => {
    if (!v.name.trim()) return toast("Name is required", "error");
    const pan = String(v.pan_masked || "").toUpperCase().trim();
    if (pan && !/^[A-Z0-9X*]{10}$/.test(pan)) return toast("PAN should be 10 characters (you can mask digits with X)", "error");
    setBusy(true);
    const row = { name: v.name.trim(), family_id: v.family_id || null, entity_type: v.entity_type, email: v.email || null, phone: v.phone || null, pan_masked: pan || null, notes: v.notes || null, is_active: !!v.is_active };
    const sb = supabase();
    const { error } = entity ? await sb.from("family_entities").update(row).eq("id", entity.id) : await sb.from("family_entities").insert(row);
    setBusy(false);
    if (error) return toast(friendlyError(error), "error");
    toast(entity ? "Profile updated" : "Profile added");
    await reloadRefs();
    onClose();
  };
  const f = (k: string, label: string, props: Record<string, unknown> = {}) => (
    <label className="block"><span className="text-sm font-medium text-ink-2">{label}</span>
      <input className="field mt-1.5" value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...props} /></label>);
  return (
    <Sheet open={open} onClose={onClose} title={entity ? "Edit profile" : "Add profile"} footer={<Button size="lg" className="w-full" onClick={save} loading={busy}>Save</Button>}>
      <div className="space-y-4">
        {f("name", "Name *")}
        <label className="block"><span className="text-sm font-medium text-ink-2">Family</span>
          <select className="field mt-1.5" value={v.family_id ?? ""} onChange={(e) => setV({ ...v, family_id: e.target.value })}>
            <option value="">Not in a family</option>{families.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
        <label className="block"><span className="text-sm font-medium text-ink-2">Type</span>
          <select className="field mt-1.5" value={v.entity_type} onChange={(e) => setV({ ...v, entity_type: e.target.value })}>
            {[["individual", "Individual"], ["huf", "HUF"], ["firm", "Firm / Partnership"], ["company", "Company"], ["trust", "Trust"], ["other", "Other"]].map(([a, b]) => <option key={a} value={a}>{b}</option>)}
          </select></label>
        {f("email", "Email", { type: "email" })}
        {f("phone", "Phone", { type: "tel", inputMode: "tel" })}
        {f("pan_masked", "PAN (optional, can be masked e.g. ABCPXXXX1F)", { autoCapitalize: "characters", maxLength: 10 })}
        <label className="block"><span className="text-sm font-medium text-ink-2">Notes</span><textarea className="field mt-1.5" rows={2} value={v.notes ?? ""} onChange={(e) => setV({ ...v, notes: e.target.value })} /></label>
        <label className="flex items-center justify-between card px-4 py-3"><span>Active</span><input type="checkbox" className="size-6 accent-[var(--accent)]" checked={!!v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /></label>
      </div>
    </Sheet>
  );
}
