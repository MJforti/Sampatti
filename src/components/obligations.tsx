"use client";
import Link from "next/link";
import { formatINR } from "@/lib/money";
import { daysBetween, formatDate, relativeDays, todayISO } from "@/lib/dates";
import { isInflow, type TxnStatus } from "@/lib/status";
import { StatusBadge, cx } from "./ui";
import { useApp } from "./providers";
import { MemberName } from "./member-emoji";

export type CalEvent = {
  id: string; event_date: string; status: TxnStatus; amount_paise: number | null; entity_id: string; entity_name: string;
  obligation_id: string; title: string; category: string; auto_debit: boolean; bank_account_id: string | null;
  bank_name: string | null; account_last4: string | null; source_type: string | null; source_id: string | null;
  instructions: string | null; paid_on: string | null; paid_amount_paise: number | null;
};

export const EVENT_COLUMNS = "*";


export function EventRow({ e }: { e: CalEvent; compact?: boolean }) {
  const { tz } = useApp();
  const days = daysBetween(todayISO(tz), e.event_date);
  const open = !["paid", "cancelled", "renewed"].includes(e.status);
  const late = open && days < 0;
  const soon = open && days >= 0 && days <= 3;
  const [, m, d] = e.event_date.split("-");
  const mon = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2000, Number(m) - 1, 1)));
  const showBadge = e.status !== "upcoming";
  return (
    <Link href={`/tx/${e.id}`} className="flex items-stretch active:bg-surface-2 transition-colors border-b hairline last:border-0">
      <div className={cx("ledger-margin w-14 shrink-0 flex flex-col items-center justify-center py-3 num", late ? "text-danger" : soon ? "text-warn" : "text-ink-3")}>
        <span className="text-[17px] leading-5 text-ink">{Number(d)}</span>
        <span className="text-[11px] leading-4">{mon}</span>
      </div>
      <div className="min-w-0 flex-1 px-3 py-3">
        <div className="text-[15px] font-medium truncate">{e.title}</div>
        <div className="text-[13px] text-ink-3 truncate">
          <MemberName id={e.entity_id} name={e.entity_name} />{e.bank_name ? ` · ${e.bank_name}${e.account_last4 ? " ••" + e.account_last4 : ""}` : ""}
        </div>
        {showBadge && <div className="mt-1"><StatusBadge status={e.status} /></div>}
      </div>
      <div className="text-right shrink-0 pr-4 py-3 flex flex-col justify-center">
        {e.amount_paise != null && (
          <div className={cx("num text-[15px] font-medium", isInflow(e.category) && "text-ok")}>
            {isInflow(e.category) ? "+" : ""}{formatINR(e.amount_paise)}
          </div>
        )}
        <div className={cx("text-[12px] num", late ? "text-danger font-medium" : soon ? "text-warn font-medium" : "text-ink-3")}>
          {open ? relativeDays(days) : `Paid ${formatDate(e.paid_on ?? e.event_date, "short")}`}
        </div>
      </div>
    </Link>
  );
}

export function EventList({ events, empty }: { events: CalEvent[]; empty?: string }) {
  if (!events.length) return <div className="card px-4 py-6 text-center text-sm text-ink-3">{empty ?? "Nothing here."}</div>;
  return <div className="card overflow-hidden">{events.map((e) => <EventRow key={e.id} e={e} />)}</div>;
}
