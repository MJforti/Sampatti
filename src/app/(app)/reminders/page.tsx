"use client";
import Link from "next/link";
import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { useApp, friendlyError } from "@/components/providers";
import { EventList, type CalEvent } from "@/components/obligations";
import { Button, Chip, Empty, ErrorState, ListSkeleton, PageHeader, SectionTitle, cx } from "@/components/ui";
import { ProfileSelect } from "@/components/profile-select";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { addDays, todayISO } from "@/lib/dates";
import { OPEN_STATUSES } from "@/lib/status";

type Notif = { id: string; title: string; body: string; data: { url?: string }; read_at: string | null; created_at: string };

export default function Reminders() {
  const { user, tz, selected, refreshUnread, toast, isUltra, showsCategory } = useApp();
  const [tab, setTab] = useState<"inbox" | "open">("inbox");
  const today = todayISO(tz);

  const notifs = useQuery(async () => unwrap(await supabase().from("notifications").select("*")
    .eq("user_id", user!.id).order("created_at", { ascending: false }).limit(100)) as Notif[], [user?.id]);

  const open = useQuery(async () => {
    let q = supabase().from("financial_calendar_events").select("*").in("status", OPEN_STATUSES)
      .lte("event_date", addDays(today, 45)).order("event_date");
    if (selected) q = q.eq("entity_id", selected);
    return unwrap(await q) as CalEvent[];
  }, [selected, today]);

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    const { error } = await supabase().from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    if (error) return toast(friendlyError(error), "error");
    notifs.setData((d) => d?.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)) ?? null);
    refreshUnread();
  };

  const runNow = async () => {
    const { data, error } = await supabase().rpc("run_reminders_now");
    if (error) return toast(friendlyError(error), "error");
    toast(`${data} new reminder${data === 1 ? "" : "s"} generated`);
    notifs.reload(); refreshUnread();
  };

  const unreadIds = (notifs.data ?? []).filter((n) => !n.read_at).map((n) => n.id);
  const overdue = (open.data ?? []).filter((e) => e.event_date < today && showsCategory(e.category));
  const rest = (open.data ?? []).filter((e) => e.event_date >= today && showsCategory(e.category));

  return (
    <div>
      <PageHeader title="Reminders" subtitle="Sent automatically before every deadline"
        action={tab === "inbox" && unreadIds.length > 0 ? <Button size="sm" variant="secondary" onClick={() => markRead(unreadIds)}><CheckCheck className="size-4" />Read all</Button> : undefined} />
      <div className="flex gap-2 mb-3">
        <Chip active={tab === "inbox"} onClick={() => setTab("inbox")}>Notifications{unreadIds.length ? ` · ${unreadIds.length}` : ""}</Chip>
        <Chip active={tab === "open"} onClick={() => setTab("open")}>Open obligations</Chip>
      </div>

      {tab === "inbox" ? (
        notifs.error ? <ErrorState error={notifs.error} retry={notifs.reload} /> : notifs.loading ? <ListSkeleton /> :
        !notifs.data?.length ? <Empty title="No notifications yet" message="Reminders arrive 30, 15, 7, 3 and 1 day before each due date, and on the day." /> : (
          <div className="card overflow-hidden">
            {notifs.data.map((n) => (
              <Link key={n.id} href={n.data?.url ?? "/reminders"} onClick={() => !n.read_at && markRead([n.id])}
                className={cx("block px-4 py-3.5 border-b hairline last:border-0 active:bg-surface-2", !n.read_at && "bg-accent-soft/50")}>
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="mt-2 size-2 rounded-full bg-accent shrink-0" aria-label="Unread" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[15px]">{n.title}</div>
                    <div className="mt-1 text-[13px] text-ink-2 whitespace-pre-line leading-relaxed">{n.body}</div>
                    <div className="mt-1.5 text-[11px] text-ink-3">{new Date(n.created_at).toLocaleString("en-IN", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : (
        <>
          <ProfileSelect />
          {open.error ? <ErrorState error={open.error} retry={open.reload} /> : open.loading ? <ListSkeleton /> : (
            <>
              {overdue.length > 0 && <><SectionTitle>Overdue / needs confirmation</SectionTitle><EventList events={overdue} /></>}
              <SectionTitle>Next 45 days</SectionTitle>
              <EventList events={rest} empty="Nothing due in the next 45 days." />
            </>
          )}
        </>
      )}
      {isUltra && <Button variant="admin" className="w-full mt-6" onClick={runNow}>Run reminder check now</Button>}
    </div>
  );
}
