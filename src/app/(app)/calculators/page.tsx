"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Chip, PageHeader, SectionTitle, Row } from "@/components/ui";
import { formatINR } from "@/lib/money";

// All inputs are rupees; results are rounded to whole paise before display. Nothing here is stored.
const p = (rupees: number) => Math.round((Number.isFinite(rupees) ? rupees : 0) * 100);

type Tab = "sip" | "lumpsum" | "loan" | "fd" | "rd" | "goal";
const TABS: [Tab, string][] = [["sip", "SIP"], ["lumpsum", "Lumpsum"], ["loan", "Home loan / EMI"], ["fd", "FD"], ["rd", "RD"], ["goal", "Goal planner"]];

function Field({ label, value, onChange, suffix, step = "any" }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; step?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <div className="relative mt-1.5">
        <input className="field num pr-16" inputMode="decimal" type="number" step={step} min="0" value={value} onChange={(e) => onChange(e.target.value)} />
        {suffix && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-ink-3">{suffix}</span>}
      </div>
    </label>
  );
}
const Inputs = ({ children }: { children: ReactNode }) => <div className="card p-4 grid gap-4">{children}</div>;
function Result({ headline, label, rows }: { headline: number; label: string; rows: [string, ReactNode][] }) {
  return (
    <>
      <SectionTitle>Result</SectionTitle>
      <div className="card px-4 pt-4 pb-1">
        <div className="text-[13px] text-ink-3">{label}</div>
        <div className="num text-[30px] font-medium tracking-tight text-accent">{formatINR(headline)}</div>
        <div className="mt-2">{rows.map(([l, v]) => <Row key={l} label={l} value={v} />)}</div>
      </div>
    </>
  );
}
function Split({ a, b, aLabel, bLabel }: { a: number; b: number; aLabel: string; bLabel: string }) {
  const t = a + b || 1;
  return (
    <div className="card p-4 mt-3">
      <div className="h-2.5 rounded-full overflow-hidden flex bg-surface-2">
        <div className="bg-accent" style={{ width: `${(a / t) * 100}%` }} />
        <div className="bg-ink-3/40" style={{ width: `${(b / t) * 100}%` }} />
      </div>
      <div className="flex justify-between text-[13px] mt-2 text-ink-2">
        <span><span className="inline-block size-2 rounded-full bg-accent mr-1.5" />{aLabel} {Math.round((a / t) * 100)}%</span>
        <span><span className="inline-block size-2 rounded-full bg-ink-3/40 mr-1.5" />{bLabel} {Math.round((b / t) * 100)}%</span>
      </div>
    </div>
  );
}
const n = (s: string) => parseFloat(s) || 0;
const yrs = (y: number) => `${y} year${y === 1 ? "" : "s"}`;

/** Future value of a monthly SIP (paid at the start of each month), with an optional yearly step-up. */
function sipFV(monthly: number, ratePct: number, years: number, stepPct = 0) {
  const r = ratePct / 1200; let fv = 0, invested = 0, amt = monthly;
  for (let m = 0; m < Math.round(years * 12); m++) {
    if (m > 0 && m % 12 === 0) amt *= 1 + stepPct / 100;
    fv = (fv + amt) * (1 + r); invested += amt;
  }
  return { fv, invested };
}

function SipCalc() {
  const [m, setM] = useState("10000"), [r, setR] = useState("12"), [y, setY] = useState("15"), [s, setS] = useState("0");
  const { fv, invested } = sipFV(n(m), n(r), n(y), n(s));
  return (<>
    <Inputs>
      <Field label="Monthly investment" value={m} onChange={setM} suffix="₹" />
      <Field label="Expected return" value={r} onChange={setR} suffix="% a year" />
      <Field label="Duration" value={y} onChange={setY} suffix="years" />
      <Field label="Yearly step-up" value={s} onChange={setS} suffix="%" />
    </Inputs>
    <Result label={`Value after ${yrs(n(y))}`} headline={p(fv)} rows={[["You invest", formatINR(p(invested))], ["Estimated gains", formatINR(p(fv - invested))]]} />
    <Split a={invested} b={fv - invested} aLabel="Invested" bLabel="Gains" />
  </>);
}

function LumpsumCalc() {
  const [a, setA] = useState("500000"), [r, setR] = useState("12"), [y, setY] = useState("10");
  const fv = n(a) * Math.pow(1 + n(r) / 100, n(y));
  return (<>
    <Inputs>
      <Field label="One-time investment" value={a} onChange={setA} suffix="₹" />
      <Field label="Expected return" value={r} onChange={setR} suffix="% a year" />
      <Field label="Duration" value={y} onChange={setY} suffix="years" />
    </Inputs>
    <Result label={`Value after ${yrs(n(y))}`} headline={p(fv)} rows={[["You invest", formatINR(p(n(a)))], ["Estimated gains", formatINR(p(fv - n(a)))]]} />
    <Split a={n(a)} b={fv - n(a)} aLabel="Invested" bLabel="Gains" />
  </>);
}

function LoanCalc() {
  const [a, setA] = useState("5000000"), [r, setR] = useState("8.5"), [y, setY] = useState("20"), [pre, setPre] = useState("0");
  const P = n(a), i = n(r) / 1200, N = Math.round(n(y) * 12);
  const emi = !N ? 0 : i ? (P * i * Math.pow(1 + i, N)) / (Math.pow(1 + i, N) - 1) : P / N;
  // Amortise month by month, applying the optional extra payment each year
  let bal = P, interest = 0, months = 0; const yearly: { y: number; principal: number; interest: number; bal: number }[] = [];
  let yp = 0, yi = 0;
  while (bal > 0.5 && months < 1200 && emi > 0) {
    const int = bal * i; let prin = Math.min(emi - int, bal);
    if (prin <= 0) break;
    bal -= prin; interest += int; months++; yp += prin; yi += int;
    if (months % 12 === 0 && n(pre) > 0 && bal > 0) { const x = Math.min(n(pre), bal); bal -= x; yp += x; }
    if (months % 12 === 0 || bal <= 0.5) { yearly.push({ y: Math.ceil(months / 12), principal: yp, interest: yi, bal: Math.max(bal, 0) }); yp = 0; yi = 0; }
  }
  const baseInterest = emi * N - P;
  return (<>
    <Inputs>
      <Field label="Loan amount" value={a} onChange={setA} suffix="₹" />
      <Field label="Interest rate" value={r} onChange={setR} suffix="% a year" />
      <Field label="Tenure" value={y} onChange={setY} suffix="years" />
      <Field label="Extra payment each year (optional)" value={pre} onChange={setPre} suffix="₹" />
    </Inputs>
    <Result label="Monthly EMI" headline={p(emi)} rows={[
      ["Total interest", formatINR(p(interest))],
      ["Total paid", formatINR(p(P + interest))],
      ...(n(pre) > 0 ? [["Loan closes in", `${Math.floor(months / 12)} y ${months % 12} m`], ["Interest saved", formatINR(p(baseInterest - interest))]] as [string, string][] : []),
    ]} />
    <Split a={P} b={interest} aLabel="Principal" bLabel="Interest" />
    <SectionTitle>Year by year</SectionTitle>
    <div className="card overflow-hidden text-[13px]">
      <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-2 px-4 py-2 text-ink-3 border-b hairline"><span>Year</span><span className="text-right">Principal</span><span className="text-right">Interest</span><span className="text-right">Balance</span></div>
      {yearly.map((r) => (
        <div key={r.y} className="grid grid-cols-[2.5rem_1fr_1fr_1fr] gap-2 px-4 py-2 border-b hairline last:border-0 num">
          <span className="mono text-ink-3">{r.y}</span><span className="text-right">{formatINR(p(r.principal))}</span><span className="text-right">{formatINR(p(r.interest))}</span><span className="text-right">{formatINR(p(r.bal))}</span>
        </div>
      ))}
    </div>
  </>);
}

const COMP: [string, number][] = [["Quarterly", 4], ["Monthly", 12], ["Half-yearly", 2], ["Yearly", 1]];
function FdCalc() {
  const [a, setA] = useState("100000"), [r, setR] = useState("7"), [y, setY] = useState("5"), [c, setC] = useState(4);
  const fv = n(a) * Math.pow(1 + n(r) / 100 / c, c * n(y));
  return (<>
    <Inputs>
      <Field label="Deposit" value={a} onChange={setA} suffix="₹" />
      <Field label="Interest rate" value={r} onChange={setR} suffix="% a year" />
      <Field label="Duration" value={y} onChange={setY} suffix="years" />
      <div><span className="text-sm font-medium text-ink-2">Compounding</span>
        <div className="flex gap-2 mt-1.5 overflow-x-auto">{COMP.map(([l, v]) => <Chip key={l} active={c === v} onClick={() => setC(v)}>{l}</Chip>)}</div></div>
    </Inputs>
    <Result label="Maturity value" headline={p(fv)} rows={[["Deposit", formatINR(p(n(a)))], ["Interest earned", formatINR(p(fv - n(a)))]]} />
  </>);
}

function RdCalc() {
  const [m, setM] = useState("5000"), [r, setR] = useState("7"), [y, setY] = useState("3");
  // Indian banks compound RDs quarterly: each instalment grows for its remaining months
  const N = Math.round(n(y) * 12); let fv = 0;
  for (let k = 0; k < N; k++) fv += n(m) * Math.pow(1 + n(r) / 400, (N - k) / 3);
  const inv = n(m) * N;
  return (<>
    <Inputs>
      <Field label="Monthly deposit" value={m} onChange={setM} suffix="₹" />
      <Field label="Interest rate" value={r} onChange={setR} suffix="% a year" />
      <Field label="Duration" value={y} onChange={setY} suffix="years" />
    </Inputs>
    <Result label="Maturity value" headline={p(fv)} rows={[["You deposit", formatINR(p(inv))], ["Interest earned", formatINR(p(fv - inv))]]} />
  </>);
}

function GoalCalc() {
  const [g, setG] = useState("10000000"), [y, setY] = useState("15"), [r, setR] = useState("12"), [inf, setInf] = useState("6"), [have, setHave] = useState("0");
  const target = n(g) * Math.pow(1 + n(inf) / 100, n(y));
  const fromSavings = n(have) * Math.pow(1 + n(r) / 100, n(y));
  const gap = Math.max(target - fromSavings, 0);
  const unit = sipFV(1, n(r), n(y)).fv;
  const sip = unit ? gap / unit : 0;
  return (<>
    <Inputs>
      <Field label="Goal amount in today's money" value={g} onChange={setG} suffix="₹" />
      <Field label="Years to goal" value={y} onChange={setY} suffix="years" />
      <Field label="Inflation" value={inf} onChange={setInf} suffix="% a year" />
      <Field label="Expected return" value={r} onChange={setR} suffix="% a year" />
      <Field label="Already saved for it" value={have} onChange={setHave} suffix="₹" />
    </Inputs>
    <Result label="Monthly SIP needed" headline={p(sip)} rows={[
      ["Goal at that time", formatINR(p(target))],
      ["Covered by savings", formatINR(p(Math.min(fromSavings, target)))],
      ["Or one-time today", formatINR(p(gap / Math.pow(1 + n(r) / 100, n(y))))],
    ]} />
  </>);
}

export default function Calculators() {
  const [tab, setTab] = useState<Tab>("sip");
  useEffect(() => { const t = new URLSearchParams(location.search).get("tab"); if (TABS.some(([k]) => k === t)) setTab(t as Tab); }, []);
  return (
    <div>
      <PageHeader title="Calculators" subtitle="Estimates only. Actual returns and rates vary." back="/more" />
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">{TABS.map(([k, l]) => <Chip key={k} active={tab === k} onClick={() => setTab(k)}>{l}</Chip>)}</div>
      <div className="mt-4">
        {tab === "sip" && <SipCalc />}{tab === "lumpsum" && <LumpsumCalc />}{tab === "loan" && <LoanCalc />}
        {tab === "fd" && <FdCalc />}{tab === "rd" && <RdCalc />}{tab === "goal" && <GoalCalc />}
      </div>
    </div>
  );
}
