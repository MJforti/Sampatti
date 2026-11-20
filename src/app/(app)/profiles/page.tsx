"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Plus, Copy, RefreshCw, Pencil } from "lucide-react";
import { useApp, friendlyError, type Entity, type Family } from "@/components/providers";
import { Badge, Button, Confirm, ErrorState, ListSkeleton, PageHeader, SectionTitle, Sheet } from "@/components/ui";
import { ProfileForm } from "@/components/profile-form";
import { MemberAvatar } from "@/components/member-emoji";
import { ThemePicker } from "@/components/theme";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { formatINR } from "@/lib/money";
import { todayISO, addDays } from "@/lib/dates";
import { OPEN_STATUSES, isInflow } from "@/lib/status";

const TYPE_LABEL: Record<string, string> = { individual: "Individual", huf: "HUF", firm: "Firm", company: "Company", trust: "Trust", other: "Entity" };

export default function Profiles() {
  const { entities, families, isAdminMode, isUltra, admin, tz, loading, toast, reloadRefs, showsCategory } = useApp();
  const manages = (fid: string | undefined) => isAdminMode && (isUltra || (!!fid && fid === admin?.family_id));
  const [adding, setAdding] = useState<{ familyId: string | null } | null>(null);
  const [famSheet, setFamSheet] = useState<Family | "new" | null>(null);
  const [famName, setFamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [regen, setRegen] = useState<Family | null>(null);
  const today = todayISO(tz);

  const due = useQuery(async () => unwrap(await supabase().from("financial_calendar_events").select("entity_id, amount_paise, category, event_date")
    .in("status", OPEN_STATUSES).lte("event_date", addDays(today, 30))) as { entity_id: string; amount_paise: number | null; category: string; event_date: string }[], [today]);

  const stats = (id: string) => {
    const rows = (due.data ?? []).filter((r) => r.entity_id === id && showsCategory(r.category));
    return { count: rows.length, overdue: rows.filter((r) => r.event_date < today).length, amount: rows.filter((r) => !isInflow(r.category)).reduce((a, r) => a + (r.amount_paise ?? 0), 0) };
  };

  const saveFamily = async () => {
    if (!famName.trim()) return toast("Give the family a name", "error");
    setBusy(true);
    const sb = supabase();
    const { error } = famSheet === "new" ? await sb.from("families").insert({ name: famName.trim() }) : await sb.from("families").update({ name: famName.trim() }).eq("id", (famSheet as Family).id);
    setBusy(false);
    if (error) return toast(friendlyError(error), "error");
    toast(famSheet === "new" ? "Family added" : "Family renamed"); setFamSheet(null); reloadRefs();
  };
  const copy = async (code: string) => { try { await navigator.clipboard.writeText(code); toast("Code copied"); } catch { toast(code); } };

  const groups: { family: Family | null; members: Entity[] }[] = [
    ...families.map((f) => ({ family: f, members: entities.filter((e) => e.family_id === f.id) })),
    { family: null, members: entities.filter((e) => !e.family_id || !families.some((f) => f.id === e.family_id)) },
  ].filter((g) => g.family || g.members.length);

  return (
    <div>
      <PageHeader title="Profiles" subtitle="Families and their members"
        action={isUltra ? <Button size="sm" variant="admin" onClick={() => { setFamName(""); setFamSheet("new"); }}><Plus className="size-4" />Family</Button> : undefined} />
      {due.error && <ErrorState error={due.error} retry={due.reload} />}
      {loading ? <ListSkeleton rows={6} /> : groups.map(({ family, members }) => (
        <section key={family?.id ?? "none"} className="mb-6">
          <div className="flex items-center justify-between gap-2 px-1 mb-2">
            <div className="min-w-0">
              <h2 className="text-[17px] font-medium truncate">{family ? family.name : "Not in a family"}</h2>
              <div className="text-[13px] text-ink-3">{members.length} member{members.length === 1 ? "" : "s"}</div>
            </div>
            {manages(family?.id) && family && (
              <button onClick={() => { setFamName(family.name); setFamSheet(family); }} className="size-11 grid place-items-center rounded-full active:bg-surface-2" aria-label={`Rename ${family.name}`}><Pencil className="size-4 text-ink-2" /></button>
            )}
          </div>

          {manages(family?.id) && family?.access_code && (
            <div className="card px-4 py-3 mb-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink-3">Access code</div>
                <div className="mono text-[20px] tracking-[0.12em]">{family.access_code}</div>
                <div className="text-[12px] text-ink-3">Share it so someone can join this family when they create an account</div>
              </div>
              <button onClick={() => copy(family.access_code!)} className="size-11 grid place-items-center rounded-full active:bg-surface-2" aria-label="Copy code"><Copy className="size-[18px]" /></button>
              <button onClick={() => setRegen(family)} className="size-11 grid place-items-center rounded-full active:bg-surface-2" aria-label="New code"><RefreshCw className="size-[18px]" /></button>
            </div>
          )}

          <div className="card overflow-hidden">
            {members.map((e) => {
              const s = stats(e.id);
              return (
                <Link key={e.id} href={`/profiles/${e.id}`} className="flex items-center gap-3 px-4 py-3.5 border-b hairline last:border-0 active:bg-surface-2 transition-colors">
                  <MemberAvatar entity={e} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium truncate">{e.name}</div>
                    <div className="text-[13px] text-ink-3 flex items-center gap-1.5">{TYPE_LABEL[e.entity_type]}{!e.is_active && <Badge tone="muted">Inactive</Badge>}
                      {s.overdue > 0 && <Badge tone="danger">{s.overdue} overdue</Badge>}</div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[15px] font-medium">{s.amount ? formatINR(s.amount) : "Nothing due"}</div>
                    <div className="text-[12px] text-ink-3">{s.count} due in 30 days</div>
                  </div>
                  <ChevronRight className="size-4 text-ink-3" />
                </Link>
              );
            })}
            {members.length === 0 && <div className="px-4 py-4 text-sm text-ink-3">No members yet</div>}
            {manages(family?.id) && family && (
              <button onClick={() => setAdding({ familyId: family.id })} className="w-full flex items-center gap-2 px-4 h-12 text-[15px] text-accent font-medium border-t hairline active:bg-surface-2">
                <Plus className="size-4" />Add member
              </button>
            )}
          </div>
        </section>
      ))}
      {!loading && !entities.length && !families.length && <div className="card px-4 py-6 text-center text-sm text-ink-3">Nothing shared with you yet. Ask the administrator for a family code, then add it in Settings.</div>}

      <SectionTitle>Appearance</SectionTitle>
      <ThemePicker />

      {isAdminMode && <ProfileForm open={!!adding} onClose={() => setAdding(null)} defaultFamilyId={adding?.familyId ?? null} />}
      <Sheet open={!!famSheet} onClose={() => setFamSheet(null)} title={famSheet === "new" ? "New family" : "Rename family"}
        footer={<Button size="lg" className="w-full" loading={busy} onClick={saveFamily}>Save</Button>}>
        <label className="block"><span className="text-sm font-medium text-ink-2">Family name</span>
          <input className="field mt-1.5" value={famName} onChange={(e) => setFamName(e.target.value)} placeholder="e.g. Jain Family" /></label>
        {famSheet === "new" && <p className="mt-3 text-sm text-ink-3">An access code is created automatically.</p>}
      </Sheet>
      <Confirm open={!!regen} onClose={() => setRegen(null)} title="Create a new code?" confirmLabel="New code" loading={busy}
        message="The old code stops working right away. People who already joined keep their access."
        onConfirm={async () => {
          setBusy(true);
          const { error } = await supabase().rpc("regenerate_family_code", { p_family: regen!.id });
          setBusy(false); setRegen(null);
          if (error) return toast(friendlyError(error), "error");
          toast("New code created"); reloadRefs();
        }} />
    </div>
  );
}
