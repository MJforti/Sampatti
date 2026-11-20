"use client";
import Link from "next/link";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useMemo, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { useApp } from "@/components/providers";
import { ProfileSelect } from "@/components/profile-select";
import { RecordForm } from "@/components/record-form";
import { Button, Chip, Empty, ErrorState, ListSkeleton, PageHeader, Badge } from "@/components/ui";
import { MODULES, INVESTMENT_TYPES, INSURANCE_TYPES, LOAN_TYPES, label } from "@/lib/modules";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { formatINR, sumPaise } from "@/lib/money";
import { daysBetween, formatDate, todayISO } from "@/lib/dates";

const TYPE_OPTS: Record<string, [string, string][]> = { investments: INVESTMENT_TYPES, insurance: INSURANCE_TYPES, loans: LOAN_TYPES };

export default function Page({ params }: { params: Promise<{ module: string }> }) {
  const { module } = use(params);
  if (!MODULES[module]) notFound();
  return <Suspense><ModuleList moduleKey={module} /></Suspense>;
}

function ModuleList({ moduleKey }: { moduleKey: string }) {
  const mod = MODULES[moduleKey];
  const { selected, entityName, isAdminMode, tz, reloadRefs } = useApp();
  const router = useRouter();
  const sp = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const [type, setType] = useState("all");
  const [term, setTerm] = useState("");
  const [adding, setAdding] = useState(sp.get("new") === "1");
  const today = todayISO(tz);

  const rows = useQuery(async () => {
    let q = supabase().from(mod.table).select("*").order(mod.orderBy, { ascending: true, nullsFirst: false });
    if (mod.table === "recurring_obligations") q = q.is("source_type", null);
    else q = showArchived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
    if (selected) q = q.eq("entity_id", selected);
    return unwrap(await q) as Record<string, any>[];
  }, [mod.table, selected, showArchived]);

  const list = useMemo(() => (rows.data ?? []).filter((r) =>
    (type === "all" || r[mod.typeKey!] === type) &&
    (!term || JSON.stringify(r).toLowerCase().includes(term.toLowerCase()))), [rows.data, type, term, mod.typeKey]);
  const total = mod.amountKey ? sumPaise(list.map((r) => r[mod.amountKey!])) : null;

  return (
    <div>
      <PageHeader title={mod.title} back="/more"
        action={isAdminMode ? <Button size="sm" variant="admin" onClick={() => setAdding(true)}><Plus className="size-4" />Add</Button> : undefined} />
      <ProfileSelect />
      <div className="relative mt-2">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink-3" />
        <input className="field pl-10" placeholder={`Search ${mod.title.toLowerCase()}`} value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {TYPE_OPTS[moduleKey] && (
        <div className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar py-2">
          <Chip active={type === "all"} onClick={() => setType("all")}>All</Chip>
          {TYPE_OPTS[moduleKey].filter(([k]) => (rows.data ?? []).some((r) => r[mod.typeKey!] === k)).map(([k, l]) => <Chip key={k} active={type === k} onClick={() => setType(k)}>{l}</Chip>)}
        </div>
      )}
      {total !== null && list.length > 0 && moduleKey !== "vehicles" && (
        <div className="card px-4 py-3 my-2 flex justify-between items-baseline text-sm">
          <span className="text-ink-3">{list.length} record{list.length > 1 ? "s" : ""} · total {moduleKey === "investments" ? "current value" : moduleKey === "loans" ? "monthly EMI" : "amount"}</span>
          <span className="num font-semibold text-base">{formatINR(moduleKey === "investments" ? sumPaise(list.map((r) => r.current_value_paise ?? r.invested_paise)) : total)}</span>
        </div>
      )}
      <div className="mt-2">
        {rows.error ? <ErrorState error={rows.error} retry={rows.reload} /> : rows.loading ? <ListSkeleton /> : !list.length ? (
          <Empty title={showArchived ? "No archived records" : `No ${mod.title.toLowerCase()} yet`}
            message={isAdminMode ? "Add the first one to start receiving reminders." : "Records added by the administrator appear here."}
            action={isAdminMode && !showArchived ? <Button variant="admin" onClick={() => setAdding(true)}><Plus className="size-4" />Add {mod.singular.toLowerCase()}</Button> : undefined} />
        ) : (
          <div className="card overflow-hidden">
            {list.map((r) => {
              const d = mod.dateKey ? r[mod.dateKey] : null;
              const dd = d ? daysBetween(today, d) : null;
              const amt = moduleKey === "investments" ? (r.current_value_paise ?? r.invested_paise) : mod.amountKey ? r[mod.amountKey] : null;
              return (
                <Link key={r.id} href={`/m/${moduleKey}/${r.id}`} className="flex items-center gap-3 px-4 py-3.5 border-b hairline last:border-0 active:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium truncate">{mod.primary(r)}</div>
                    <div className="text-[13px] text-ink-3 truncate">{!selected && `${entityName(r.entity_id)} · `}{mod.secondary(r)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {amt != null && <div className="num text-[15px] font-semibold">{formatINR(amt)}</div>}
                    {d && <div className={`text-[12px] ${dd! < 0 ? "text-danger font-semibold" : dd! <= 7 ? "text-warn font-semibold" : "text-ink-3"}`}>{mod.dateLabel} {formatDate(d, "short")}</div>}
                    {moduleKey === "obligations" && !r.is_active && <Badge tone="muted">Inactive</Badge>}
                  </div>
                  <ChevronRight className="size-4 text-ink-3" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
      {mod.table !== "recurring_obligations" && (
        <button onClick={() => setShowArchived(!showArchived)} className="mt-4 w-full h-11 text-sm text-ink-3">{showArchived ? "Show active records" : "Show archived records"}</button>
      )}
      {isAdminMode && (
        <RecordForm mod={mod} open={adding} onClose={() => setAdding(false)} defaults={selected ? { entity_id: selected } : undefined}
          onSaved={(r) => { setAdding(false); reloadRefs(); router.push(`/m/${moduleKey}/${r.id}`); }} />
      )}
    </div>
  );
}
