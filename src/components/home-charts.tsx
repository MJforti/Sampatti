"use client";
// Visuals for the home dashboard. Each chart only appears when the database has data for it.
import Link from "next/link";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { formatINR, formatINRCompact, sumPaise } from "@/lib/money";
import { OUTFLOW_GROUPS, outflowGroup, outflowMonths, monthLabel, type OutflowRow } from "@/lib/outflow";
import { INVESTMENT_TYPES, INSURANCE_TYPES, LOAN_TYPES } from "@/lib/modules";
import { SectionTitle } from "./ui";

const label = (list: readonly (readonly [string, string])[], k: string) => list.find(([v]) => v === k)?.[1] ?? k;
// One accent, shown at decreasing strength for each series
const SHADE = [1, 0.7, 0.5, 0.34, 0.22, 0.12];
const accent = (i: number) => `color-mix(in oklab, var(--accent) ${Math.round(SHADE[i % SHADE.length] * 100)}%, transparent)`;

type Inv = { category: string; invested_paise: number; current_value_paise: number | null };
type Loan = { loan_type: string; lender: string; principal_paise: number; outstanding_paise: number };
type Pol = { category: string; sum_assured_paise: number | null; premium_paise: number | null };

export function HomeCharts({ entity, hideOutflow }: { entity: string | null; hideOutflow?: boolean }) {
  const q = useQuery(async () => {
    const sb = supabase();
    const f = <T,>(x: T) => x as any;
    let inv = f(sb.from("investments").select("category, invested_paise, current_value_paise").is("archived_at", null));
    let loans = f(sb.from("loans").select("loan_type, lender, principal_paise, outstanding_paise").is("archived_at", null).gt("outstanding_paise", 0));
    let pols = f(sb.from("insurance_policies").select("category, sum_assured_paise, premium_paise").is("archived_at", null));
    if (entity) { inv = inv.eq("entity_id", entity); loans = loans.eq("entity_id", entity); pols = pols.eq("entity_id", entity); }
    const [a, b, c, d] = await Promise.all([inv, loans, pols, sb.rpc("projected_outflows", { p_months: 12 })]);
    const out = (unwrap(d) as OutflowRow[]).filter((r) => !entity || r.entity_id === entity);
    return { inv: unwrap(a) as Inv[], loans: unwrap(b) as Loan[], pols: unwrap(c) as Pol[], out };
  }, [entity]);
  if (!q.data) return null;
  const { inv, loans, pols, out } = q.data;
  const hasAny = (!hideOutflow && out.some((r) => r.amount_paise > 0)) || inv.some((r) => (r.current_value_paise ?? r.invested_paise) > 0) || loans.length || pols.some((p) => p.sum_assured_paise);
  if (!hasAny) return null;
  return (
    <>
      {!hideOutflow && <OutflowChart rows={out} />}
      <Allocation rows={inv} />
      <Loans rows={loans} />
      <Cover rows={pols} />
    </>
  );
}

function OutflowChart({ rows }: { rows: OutflowRow[] }) {
  const [pick, setPick] = useState<string | null>(null);
  if (!rows.some((r) => r.amount_paise > 0)) return null;
  const months = outflowMonths(rows, 12);
  const groups = OUTFLOW_GROUPS.filter(([k]) => rows.some((r) => outflowGroup(r.category)[0] === k && r.amount_paise > 0));
  const cell = (m: string, g: string) => sumPaise(rows.filter((r) => r.month.slice(0, 10) === m && outflowGroup(r.category)[0] === g).map((r) => r.amount_paise));
  const totals = months.map((m) => groups.reduce((a, [g]) => a + cell(m, g), 0));
  const max = Math.max(...totals, 1);
  const sel = pick ?? months[0];
  const si = months.indexOf(sel);
  return (
    <>
      <SectionTitle action={<Link href="/outflow" className="inline-flex items-center h-11 -my-3 px-1 text-sm text-accent font-medium">Details</Link>}>Cash outflow, next 12 months</SectionTitle>
      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div><div className="text-[13px] text-ink-3">{monthLabel(sel, "long")}</div><div className="num text-[22px] font-medium">{formatINR(totals[si])}</div></div>
          <div className="text-right"><div className="text-[13px] text-ink-3">12 months</div><div className="num text-[15px]">{formatINRCompact(sumPaise(totals))}</div></div>
        </div>
        <div className="mt-4 h-36 flex items-end gap-1" role="img" aria-label="Monthly outflow for the next 12 months">
          {months.map((m, i) => (
            <button key={m} onClick={() => setPick(m)} className="flex-1 h-full flex flex-col justify-end items-stretch group" aria-label={`${monthLabel(m, "long")}: ${formatINR(totals[i])}`}>
              <div className={`flex flex-col-reverse rounded-t-[3px] overflow-hidden transition-opacity ${m === sel ? "" : "opacity-55"}`} style={{ height: `${(totals[i] / max) * 100}%`, minHeight: totals[i] ? 2 : 0 }}>
                {groups.map(([g], gi) => { const v = cell(m, g); return v ? <div key={g} style={{ height: `${(v / totals[i]) * 100}%`, background: accent(gi) }} /> : null; })}
              </div>
            </button>
          ))}
        </div>
        <div className="flex gap-1 mt-1.5">{months.map((m) => <div key={m} className={`flex-1 text-center mono text-[10px] ${m === sel ? "text-ink" : "text-ink-3"}`}>{monthLabel(m)[0]}</div>)}</div>
        <div className="mt-3 grid gap-1.5">
          {groups.map(([g, l], gi) => { const v = cell(sel, g); return (
            <div key={g} className="flex items-center gap-2 text-[13px]"><span className="size-2.5 rounded-sm shrink-0" style={{ background: accent(gi) }} /><span className="flex-1 text-ink-2">{l}</span><span className="num">{formatINR(v)}</span></div>
          ); })}
        </div>
      </div>
    </>
  );
}

function Allocation({ rows }: { rows: Inv[] }) {
  const by = new Map<string, { cur: number; inv: number }>();
  for (const r of rows) { const x = by.get(r.category) ?? { cur: 0, inv: 0 }; x.cur += r.current_value_paise ?? r.invested_paise; x.inv += r.invested_paise; by.set(r.category, x); }
  const list = [...by.entries()].filter(([, v]) => v.cur > 0).sort((a, b) => b[1].cur - a[1].cur);
  if (!list.length) return null;
  const total = sumPaise(list.map(([, v]) => v.cur)), invested = sumPaise(list.map(([, v]) => v.inv));
  const top = list.slice(0, 5), rest = list.slice(5);
  const segs = rest.length ? [...top, ["others", { cur: sumPaise(rest.map(([, v]) => v.cur)), inv: sumPaise(rest.map(([, v]) => v.inv)) }] as const] : top;
  const gain = total - invested;
  return (
    <>
      <SectionTitle action={<Link href="/m/investments" className="inline-flex items-center h-11 -my-3 px-1 text-sm text-accent font-medium">Investments</Link>}>Where your money is</SectionTitle>
      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div><div className="text-[13px] text-ink-3">Current value</div><div className="num text-[22px] font-medium">{formatINR(total)}</div></div>
          {invested > 0 && <div className="text-right"><div className="text-[13px] text-ink-3">Gain on {formatINRCompact(invested)}</div>
            <div className={`num text-[15px] ${gain < 0 ? "text-danger" : "text-accent"}`}>{gain >= 0 ? "+" : "−"}{formatINRCompact(Math.abs(gain))} · {(Math.abs(gain) / invested * 100).toFixed(1)}%</div></div>}
        </div>
        <div className="mt-4 h-3 rounded-full overflow-hidden flex bg-surface-2">
          {segs.map(([k, v], i) => <div key={k} style={{ width: `${(v.cur / total) * 100}%`, background: accent(i) }} />)}
        </div>
        <div className="mt-3 grid gap-1.5">
          {segs.map(([k, v], i) => (
            <div key={k} className="flex items-center gap-2 text-[13px]">
              <span className="size-2.5 rounded-sm shrink-0" style={{ background: accent(i) }} />
              <span className="flex-1 text-ink-2 truncate">{k === "others" ? "Others" : label(INVESTMENT_TYPES, k)}</span>
              <span className="mono text-ink-3 w-10 text-right">{Math.round((v.cur / total) * 100)}%</span>
              <span className="num w-24 text-right">{formatINRCompact(v.cur)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Loans({ rows }: { rows: Loan[] }) {
  if (!rows.length) return null;
  const P = sumPaise(rows.map((r) => r.principal_paise)), O = sumPaise(rows.map((r) => r.outstanding_paise));
  return (
    <>
      <SectionTitle action={<Link href="/m/loans" className="inline-flex items-center h-11 -my-3 px-1 text-sm text-accent font-medium">Loans</Link>}>Loans repaid so far</SectionTitle>
      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div><div className="text-[13px] text-ink-3">Still to repay</div><div className="num text-[22px] font-medium">{formatINR(O)}</div></div>
          {P > 0 && <div className="text-right"><div className="text-[13px] text-ink-3">Repaid</div><div className="num text-[15px] text-accent">{Math.max(0, Math.round((1 - O / P) * 100))}%</div></div>}
        </div>
        <div className="mt-3 grid gap-3">
          {rows.sort((a, b) => b.outstanding_paise - a.outstanding_paise).map((r, i) => {
            const paid = r.principal_paise ? Math.min(1, Math.max(0, 1 - r.outstanding_paise / r.principal_paise)) : 0;
            return (
              <div key={i}>
                <div className="flex justify-between text-[13px] gap-2"><span className="text-ink-2 truncate">{label(LOAN_TYPES, r.loan_type)} · {r.lender}</span><span className="num shrink-0">{formatINRCompact(r.outstanding_paise)} left</span></div>
                <div className="mt-1 h-2 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-accent rounded-full" style={{ width: `${paid * 100}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Cover({ rows }: { rows: Pol[] }) {
  const by = new Map<string, number>();
  for (const r of rows) if (r.sum_assured_paise) by.set(r.category, (by.get(r.category) ?? 0) + r.sum_assured_paise);
  const list = [...by.entries()].sort((a, b) => b[1] - a[1]);
  if (!list.length) return null;
  const max = list[0][1];
  const premium = sumPaise(rows.map((r) => r.premium_paise));
  return (
    <>
      <SectionTitle action={<Link href="/m/insurance" className="inline-flex items-center h-11 -my-3 px-1 text-sm text-accent font-medium">Insurance</Link>}>Insurance cover</SectionTitle>
      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div><div className="text-[13px] text-ink-3">Total cover</div><div className="num text-[22px] font-medium">{formatINR(sumPaise(list.map(([, v]) => v)))}</div></div>
          {premium > 0 && <div className="text-right"><div className="text-[13px] text-ink-3">Premiums</div><div className="num text-[15px]">{formatINRCompact(premium)}</div></div>}
        </div>
        <div className="mt-3 grid gap-2.5">
          {list.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-[13px]">
              <span className="text-ink-2 truncate">{label(INSURANCE_TYPES, k)}</span>
              <div className="h-2 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-accent rounded-full" style={{ width: `${(v / max) * 100}%` }} /></div>
              <span className="num w-20 text-right">{formatINRCompact(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
