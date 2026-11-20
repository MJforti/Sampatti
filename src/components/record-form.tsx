"use client";
import { useEffect, useMemo, useState } from "react";
import type { Field, ModuleDef } from "@/lib/modules";
import { FREQUENCIES } from "@/lib/modules";
import { paiseToInput, parseRupeesToPaise } from "@/lib/money";
import { supabase } from "@/lib/supabase/client";
import { useApp, friendlyError } from "./providers";
import { Button, Sheet, cx } from "./ui";

type Rec = Record<string, any>;

function getVal(r: Rec, key: string) {
  if (key.startsWith("details.")) return r.details?.[key.slice(8)];
  return r[key];
}

/** Admin-only create/edit sheet for any module. RLS rejects writes unless Admin Mode is unlocked server-side. */
export function RecordForm({ mod, record, open, onClose, onSaved, defaults }: {
  mod: ModuleDef; record?: Rec | null; open: boolean; onClose: () => void; onSaved: (r: Rec) => void; defaults?: Rec;
}) {
  const { adminEntities: entities, banks, vehicles, toast, isAdminMode, setPinOpen, user } = useApp();
  const initial = useMemo(() => {
    const base: Rec = { ...(defaults ?? {}), ...(record ?? {}) };
    const v: Rec = {};
    for (const f of mod.fields) {
      const raw = getVal(base, f.key);
      v[f.key] = f.type === "money" ? paiseToInput(raw) : f.type === "bool" ? (raw ?? (f.key === "is_active")) : f.type === "entities" ? (raw ?? []) : raw ?? "";
    }
    if (!record && mod.key === "insurance") v.status ||= "active";
    return v;
  }, [record, mod, defaults]);
  const [vals, setVals] = useState<Rec>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [lastInit, setLastInit] = useState(initial);
  // Unsaved progress is kept as a draft on this device and in the account (synced across devices),
  // per person, form and record, so leaving midway loses nothing.
  const formKey = `${mod.key}.${record?.id ?? "new"}`;
  const draftKey = user ? `sampatti.draft.${user.id}.${formKey}` : null;
  const [restored, setRestored] = useState(false);
  const takeDraft = (d: Draft | null) => { if (d) { setVals({ ...initial, ...d.v }); setRestored(true); } };
  if (lastInit !== initial) {
    const d = readDraft(draftKey, initial);
    setLastInit(initial); setVals(d ? { ...initial, ...d.v } : initial); setRestored(!!d); setErrors({});
  }
  // On opening: use this device's draft, then the account's if it is newer (e.g. started on another phone)
  useEffect(() => {
    if (!open || !user) return;
    const local = readDraft(draftKey, initial);
    takeDraft(local);
    let live = true;
    supabase().from("form_drafts").select("data, updated_at").eq("form_key", formKey).maybeSingle().then(({ data }) => {
      if (!live || !data) return;
      const remote: Draft = { v: data.data as Rec, at: new Date(data.updated_at).getTime() };
      if (remote.at > (local?.at ?? 0) && differs(remote.v, initial)) {
        takeDraft(remote);
        try { localStorage.setItem(draftKey!, JSON.stringify(remote)); } catch { /* ignore */ }
      }
    });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftKey]);
  // Save as you type: on this device at once, to the account after a short pause
  useEffect(() => {
    if (!draftKey || !open || !differs(vals, initial)) return;
    const at = Date.now();
    try { localStorage.setItem(draftKey, JSON.stringify({ v: vals, at })); } catch { /* ignore */ }
    const t = setTimeout(() => {
      supabase().from("form_drafts").upsert({ form_key: formKey, data: vals, updated_at: new Date(at).toISOString() }).then(() => {});
    }, 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vals]);
  const clearDraft = () => {
    try { if (draftKey) localStorage.removeItem(draftKey); } catch { /* ignore */ }
    if (user) supabase().from("form_drafts").delete().eq("form_key", formKey).then(() => {});
  };
  const discardDraft = () => { clearDraft(); setVals(initial); setRestored(false); };

  const set = (k: string, v: unknown) => setVals((s) => ({ ...s, [k]: v }));
  const visible = mod.fields.filter((f) => !f.showIf || f.showIf(vals));

  const save = async () => {
    if (!isAdminMode) { setPinOpen(true); return; }
    const errs: Record<string, string> = {};
    const row: Rec = {};
    const details: Rec = { ...(record?.details ?? {}) };
    for (const f of mod.fields) {
      const show = !f.showIf || f.showIf(vals);
      let v: unknown = vals[f.key];
      if (!show) v = f.type === "bool" ? false : f.type === "entities" ? [] : null;
      if (f.type === "money") {
        if (v === "" || v == null) v = null;
        else { const p = parseRupeesToPaise(String(v)); if (p === null || p < 0) errs[f.key] = "Enter an amount like 45000 or 45,000.50"; v = p; }
      } else if (f.type === "number" || f.type === "percent") {
        if (v === "" || v == null) v = null;
        else if (!/^\d+(\.\d+)?$/.test(String(v))) errs[f.key] = "Enter a number";
        else v = f.type === "number" && !String(v).includes(".") ? parseInt(String(v), 10) : String(v);
      } else if (typeof v === "string") {
        v = v.trim() === "" ? null : v.trim();
      }
      if (f.key === "account_last4" && v && !/^\d{4}$/.test(String(v))) errs[f.key] = "Exactly 4 digits";
      if (f.key === "ifsc" && v) { v = String(v).toUpperCase(); if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v))) errs[f.key] = "IFSC looks like HDFC0001234"; }
      if (f.key === "registration_number" && v) v = String(v).toUpperCase().replace(/\s+/g, "");
      if (show && f.required && (v === null || v === "" || (Array.isArray(v) && !v.length))) errs[f.key] = "Required";
      if (f.key.startsWith("details.")) { if (v === null) delete details[f.key.slice(8)]; else details[f.key.slice(8)] = v; }
      else row[f.key] = v;
    }
    if (row.outstanding_paise != null && row.principal_paise != null && row.outstanding_paise > row.principal_paise) errs.outstanding_paise = "Cannot exceed the original amount";
    if (mod.fields.some((f) => f.key.startsWith("details."))) row.details = details;
    if (Array.isArray(row.joint_entity_ids)) row.joint_entity_ids = row.joint_entity_ids.filter((x: string) => x !== row.entity_id);
    setErrors(errs);
    if (Object.keys(errs).length) { toast("Please fix the highlighted fields", "error"); return; }
    setBusy(true);
    const sb = supabase();
    const NOT_NULL = ["account_type", "grace_days", "rate_type", "frequency", "status", "invested_paise", "emi_paise", "auto_renew"];
    for (const k of Object.keys(row)) if (row[k] === null && (!record?.id || NOT_NULL.includes(k))) delete row[k]; // let DB defaults apply
    const q = record?.id ? sb.from(mod.table).update(row).eq("id", record.id).select().single() : sb.from(mod.table).insert(row).select().single();
    const { data, error } = await q;
    setBusy(false);
    if (error) { toast(friendlyError(error), "error"); return; }
    clearDraft();
    setRestored(false);
    toast(record?.id ? "Saved" : `${mod.singular} added`);
    onSaved(data);
  };

  let lastSection: string | undefined;
  return (
    <Sheet open={open} onClose={onClose} title={record?.id ? `Edit ${mod.singular.toLowerCase()}` : `Add ${mod.singular.toLowerCase()}`}
      footer={<Button className="w-full" size="lg" onClick={save} loading={busy}>{record?.id ? "Save changes" : `Add ${mod.singular.toLowerCase()}`}</Button>}>
      <div className="space-y-4 pb-4">
        {restored && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-accent-soft px-3 py-2 text-[13px] text-accent">
            <span>Picked up where you left off</span>
            <button type="button" onClick={discardDraft} className="h-9 -my-1 px-2 font-medium underline underline-offset-2">Start over</button>
          </div>
        )}
        {visible.map((f) => {
          const header = f.section && f.section !== lastSection ? f.section : null;
          if (f.section) lastSection = f.section;
          return (
            <div key={f.key}>
              {header && <div className="pt-3 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{header}</div>}
              <FieldInput f={f} value={vals[f.key]} onChange={(v) => set(f.key, v)} error={errors[f.key]}
                entities={entities} banks={banks.filter((b) => !vals.entity_id || b.entity_id === vals.entity_id || f.key !== "bank_account_id")}
                allBanks={banks} vehicles={vehicles} />
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function FieldInput({ f, value, onChange, error, entities, banks, allBanks, vehicles }: {
  f: Field; value: any; onChange: (v: any) => void; error?: string;
  entities: { id: string; name: string; is_active: boolean }[]; banks: { id: string; bank_name: string; account_last4: string | null; nickname: string | null }[];
  allBanks: typeof banks; vehicles: { id: string; registration_number: string }[];
}) {
  const id = `f-${f.key}`;
  const lbl = <label htmlFor={id} className="block text-sm font-medium text-ink-2 mb-1.5">{f.label}{f.required && <span className="text-danger"> *</span>}</label>;
  const cls = cx("field", error && "!border-danger");
  let input;
  switch (f.type) {
    case "textarea": input = <textarea id={id} className={cls} rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />; break;
    case "money": input = (
      <div className="relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">₹</span>
        <input id={id} inputMode="decimal" className={cx(cls, "pl-8 num")} value={value ?? ""} placeholder="0" onChange={(e) => onChange(e.target.value)} /></div>); break;
    case "number": case "percent": input = <input id={id} inputMode="decimal" className={cx(cls, "num")} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />; break;
    case "date": input = <input id={id} type="date" className={cls} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />; break;
    case "bool": return (
      <label className="flex items-center justify-between gap-3 card px-4 py-3">
        <span><span className="text-[15px]">{f.label}</span>{f.help && <span className="block text-xs text-ink-3">{f.help}</span>}</span>
        <input type="checkbox" className="size-6 accent-[var(--accent)]" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      </label>);
    case "select": case "frequency": {
      const opts = f.type === "frequency" ? FREQUENCIES : f.options ?? [];
      input = <select id={id} className={cls} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>; break;
    }
    case "entity": input = <select id={id} className={cls} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select…</option>{entities.filter((e) => e.is_active || e.id === value).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>; break;
    case "bank": input = <select id={id} className={cls} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">None</option>{(banks.length ? banks : allBanks).map((b) => <option key={b.id} value={b.id}>{b.nickname || b.bank_name}{b.account_last4 ? ` ••${b.account_last4}` : ""}</option>)}</select>; break;
    case "vehicle": input = <select id={id} className={cls} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">None</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration_number}</option>)}</select>; break;
    case "entities": return (
      <div>{lbl}<div className="flex flex-wrap gap-2">
        {entities.map((e) => {
          const on = (value as string[]).includes(e.id);
          return <button type="button" key={e.id} onClick={() => onChange(on ? value.filter((x: string) => x !== e.id) : [...value, e.id])}
            className={cx("h-11 px-3.5 rounded-full text-sm border", on ? "bg-accent text-accent-ink border-accent" : "bg-surface border-line text-ink-2")}>{e.name}</button>;
        })}</div></div>);
    default: input = <input id={id} className={cls} value={value ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} autoCapitalize={f.key === "registration_number" || f.key === "ifsc" ? "characters" : undefined} />;
  }
  return (
    <div>{lbl}{input}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : f.help ? <p className="mt-1 text-xs text-ink-3">{f.help}</p> : null}
    </div>
  );
}

type Draft = { v: Rec; at: number };
const differs = (a: Rec, b: Rec) => Object.keys(a).some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

function readDraft(key: string | null, initial: Rec): Draft | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const s = localStorage.getItem(key); if (!s) return null;
    const raw = JSON.parse(s);
    const d: Draft = raw && typeof raw.at === "number" && raw.v ? raw : { v: raw as Rec, at: 0 }; // older drafts were the values alone
    return differs(d.v, initial) ? d : null; // a draft identical to the form isn't worth restoring
  } catch { return null; }
}
