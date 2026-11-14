"use client";
import Link from "next/link";
import { ChevronRight, ShieldCheck, Landmark, TrendingUp, Car, Receipt, CircleDot } from "lucide-react";
import { formatINR } from "@/lib/money";
import { daysBetween, formatDate, relativeDays, todayISO } from "@/lib/dates";
import { CATEGORY_LABEL, categoryGroup, isInflow, type TxnStatus } from "@/lib/status";
import { StatusBadge, cx } from "./ui";
import { useApp } from "./providers";

export type CalEvent = {
  id: string; event_date: string; status: TxnStatus; amount_paise: number | null; entity_id: string; entity_name: string;
  obligation_id: string; title: string; category: string; auto_debit: boolean; bank_account_id: string | null;
  bank_name: string | null; account_last4: string | null; source_type: string | null; source_id: string | null;
  instructions: string | null; paid_on: string | null; paid_amount_paise: number | null;
};

export const EVENT_COLUMNS = "*";

const ICONS = { insurance: ShieldCheck, loan: Landmark, invest: TrendingUp, vehicle: Car, tax: Receipt, other: CircleDot };

export function EventRow({ e, compact }: { e: CalEvent; compact?: boolean }) {
  const { tz } = useApp();
  const days = daysBetween(todayISO(tz), e.event_date);
  const g = categoryGroup(e.category);
  const Icon = ICONS[g];
  const open = !["paid", "cancelled", "renewed"].includes(e.status);
  const urgent = open && days <= 3;
  return (
    <Link href={`/tx/${e.id}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-2 border-b hairline last:border-0">
      <span className="size-10 shrink-0 grid place-items-center rounded-xl" style={{ background: `color-mix(in srgb, var(--c-${g}) 12%, transparent)`, color: `var(--c-${g})` }}>
        <Icon className="size-5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium truncate">{e.title}</div>
        <div className="text-[13px] text-ink-3 truncate">
          {e.entity_name}{e.bank_name ? ` · ${e.bank_name}${e.account_last4 ? " ••" + e.account_last4 : ""}` : ""}
        </div>
        {!compact && <div className="mt-1 flex items-center gap-1.5 flex-wrap"><StatusBadge status={e.status} />
          <span className="text-[11px] text-ink-3">{CATEGORY_LABEL[e.category] ?? e.category}</span></div>}
      </div>
      <div className="text-right shrink-0">
        {e.amount_paise != null && (
          <div className={cx("num text-[15px] font-semibold", isInflow(e.category) && "text-ok")}>
            {isInflow(e.category) ? "+" : ""}{formatINR(e.amount_paise)}
          </div>
        )}
        <div className={cx("text-[12px] num", open && days < 0 ? "text-danger font-semibold" : urgent ? "text-warn font-semibold" : "text-ink-3")}>
          {open ? relativeDays(days) : formatDate(e.paid_on ?? e.event_date, "short")}
        </div>
      </div>
      <ChevronRight className="size-4 text-ink-3 shrink-0" />
    </Link>
  );
}

export function EventList({ events, empty }: { events: CalEvent[]; empty?: string }) {
  if (!events.length) return <div className="card px-4 py-6 text-center text-sm text-ink-3">{empty ?? "Nothing here."}</div>;
  return <div className="card overflow-hidden">{events.map((e) => <EventRow key={e.id} e={e} />)}</div>;
}
