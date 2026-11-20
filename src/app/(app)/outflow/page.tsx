"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { useApp } from "@/components/providers";
import { ProfileSelect } from "@/components/profile-select";
import { MemberAvatar } from "@/components/member-emoji";
import { Button, Chip, ErrorState, ListSkeleton, PageHeader, SectionTitle, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { OUTFLOW_GROUPS as GROUP, outflowGroup as groupOf, monthLabel, outflowSheet, downloadCsv, type OutflowRow as Row } from "@/lib/outflow";


export default function Outflow() {
  const { selected, entities } = useApp();
  const [months, setMonths] = useState<3 | 6 | 12>(12);
  const [focus, setFocus] = useState<string | null>(null);

  const q = useQuery(async () => unwrap(await supabase().rpc("projected_outflows", { p_months: 12 })) as Row[], []);

  const data = useMemo(() => {
    const all = (q.data ?? []).filter((r) => !selected || r.entity_id === selected);
    const monthKeys = [...new Set((q.data ?? []).map((r) => r.month))].sort();
    const start = monthKeys[0] ?? new Date().toISOString().slice(0, 8) + "01";
    const keys: string[] = [];
    const [y, m] = start.split("-").map(Number);
    for (let i = 0; i < months; i++) keys.push(new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 10));
    const rows = all.filter((r) => keys.includes(r.month));
    const byMonth = keys.map((k) => ({ k, v: sumPaise(rows.filter((r) => r.month === k).map((r) => r.amount_paise)) }));
    const byProfile = new Map<string, number>();
    const byGroup = new Map<string, number>();
    for (const r of rows) {
      byProfile.set(r.entity_id, (byProfile.get(r.entity_id) ?? 0) + r.amount_paise);
      const g = groupOf(r.category)[0];
      byGroup.set(g, (byGroup.get(g) ?? 0) + r.amount_paise);
    }
    return { rows, keys, byMonth, total: sumPaise(byMonth.map((x) => x.v)), byProfile: [...byProfile.entries()].sort((a, b) => b[1] - a[1]),
      byGroup: [...byGroup.entries()].sort((a, b) => b[1] - a[1]) };
  }, [q.data, selected, months]);

  const max = Math.max(1, ...data.byMonth.map((x) => x.v));
  const mLabel = monthLabel;
  const focused = data.byMonth.find((x) => x.k === focus);

  const exportCsv = () => {
    const name = (id: string) => entities.find((e) => e.id === id)?.name ?? "Unknown";
    const title = selected ? name(selected) : "Family";
    downloadCsv(`cash-outflow-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${data.keys[0]?.slice(0, 7)}-next-${months}-months`,
      outflowSheet(data.rows, data.keys, name, title));
  };

  return (
    <div>
      <PageHeader title="Cash outflow" subtitle="Money going out, projected from every recurring payment" back="/more" />
      <div className="no-print"><ProfileSelect /></div>
      <p className="hidden print:block text-sm mb-2">{selected ? entities.find((e) => e.id === selected)?.name : "Whole family"} · next {months} months</p>
      <div className="-mx-4 px-4 flex gap-2 py-2 overflow-x-auto no-scrollbar no-print">{([3, 6, 12] as const).map((n) => <Chip key={n} active={months === n} onClick={() => { setMonths(n); setFocus(null); }}>Next {n} months</Chip>)}</div>

      {q.error ? <ErrorState error={q.error} retry={q.reload} /> : q.loading ? <ListSkeleton rows={4} /> : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-2 no-print">
            <Button variant="secondary" onClick={exportCsv} disabled={!data.total}><Download className="size-4" />Excel / CSV</Button>
            <Link href={selected ? `/reports/advisor?profile=${selected}` : "/reports/advisor"} className="inline-flex items-center justify-center gap-2 h-12 px-4 rounded-2xl bg-accent text-accent-ink font-medium text-[15px] whitespace-nowrap"><Printer className="size-4" />Financial report</Link>
          </div>
          <div className="card px-5 pt-5 pb-4">
            <div className="text-sm text-ink-3">{focused ? `In ${mLabel(focused.k, "long")}` : `Total over the next ${months} months`}</div>
            <div className="num text-[40px] leading-[48px] font-medium tracking-tight mt-1">{formatINR(focused ? focused.v : data.total)}</div>
            <div className="text-[13px] text-ink-3">{focused ? <button className="text-accent font-medium h-11 -my-3" onClick={() => setFocus(null)}>Show whole period</button> : `About ${formatINR(Math.round(data.total / months / 100) * 100)} a month on average`}</div>

            {/* Monthly bars: one series, tap a month for its total */}
            <div className="mt-5 flex items-end gap-1 h-32" role="list" aria-label="Outflow by month">
              {data.byMonth.map((x) => (
                <button key={x.k} role="listitem" onClick={() => setFocus(focus === x.k ? null : x.k)} title={`${mLabel(x.k, "long")}: ${formatINR(x.v)}`}
                  aria-label={`${mLabel(x.k, "long")}: ${formatINR(x.v)}`} className="flex-1 h-full flex flex-col justify-end min-w-0">
                  <span className={cx("block w-full rounded-t-[4px] transition-opacity", !focus || focus === x.k ? "opacity-100" : "opacity-35")}
                    style={{ height: `${Math.max(x.v ? 4 : 0, (x.v / max) * 100)}%`, background: "var(--accent)" }} />
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex gap-1 text-[11px] text-ink-3 num">
              {data.byMonth.map((x, i) => <span key={x.k} className="flex-1 text-center truncate">{months === 12 && i % 2 ? "" : mLabel(x.k).slice(0, 3)}</span>)}
            </div>
          </div>

          {!selected && data.byProfile.length > 0 && (
            <>
              <SectionTitle>By profile</SectionTitle>
              <div className="card px-4 py-1">
                {data.byProfile.map(([id, v]) => {
                  const e = entities.find((x) => x.id === id);
                  return (
                    <div key={id} className="py-3 border-b hairline last:border-0">
                      <div className="flex items-center gap-3">
                        {e && <MemberAvatar entity={e} size="sm" />}
                        <span className="flex-1 min-w-0 truncate text-[15px]">{e?.name ?? "Unknown"}</span>
                        <span className="num text-[15px] font-medium">{formatINR(v)}</span>
                      </div>
                      <div className="mt-2 ml-9 h-1.5 rounded bg-surface-2"><div className="h-1.5 rounded" style={{ width: `${(v / data.total) * 100}%`, background: "var(--accent)" }} /></div>
                      <div className="ml-9 mt-1 text-[12px] text-ink-3 num">{Math.round((v / data.total) * 100)}% of the total · {formatINRCompact(Math.round(v / months))} a month</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {data.byGroup.length > 0 && (
            <>
              <SectionTitle>By type</SectionTitle>
              <div className="card px-4">
                {data.byGroup.map(([g, v]) => (
                  <div key={g} className="flex items-baseline justify-between gap-4 py-3 border-b hairline last:border-0">
                    <span className="text-[15px] text-ink-2">{GROUP.find(([k]) => k === g)?.[1]}</span>
                    <span className="num text-[15px]"><span className="text-ink-3 text-[13px] mr-2">{Math.round((v / data.total) * 100)}%</span>{formatINR(v)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.total === 0 && <div className="card mt-3 px-4 py-6 text-center text-sm text-ink-3">No recurring payments found. Add SIPs, loans, insurance premiums or recurring payments to see the projection</div>}
          <p className="mt-4 px-1 text-xs text-ink-3">Projected from each item’s next due date and how often it repeats. This month includes anything still unpaid; overdue items from earlier months aren’t included. EMIs are assumed to continue for the whole period.</p>
        </>
      )}
    </div>
  );
}
