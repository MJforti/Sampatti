"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useApp, friendlyError } from "@/components/providers";
import { Button, Confirm, PageHeader, SectionTitle, Badge } from "@/components/ui";
import { AdminToggle } from "@/components/shell";
import { enablePush, disablePush, pushState, type PushState } from "@/components/pwa";
import { supabase } from "@/lib/supabase/client";
import { ThemePicker } from "@/components/theme";
import { replayIntroOnLogin } from "@/components/splash";
import { MemberAvatar, EmojiPicker } from "@/components/member-emoji";

const MUTABLE = [["insurance", "Insurance"], ["investments", "Investments & SIPs"], ["loans", "Loans & EMIs"], ["vehicles", "Vehicles"], ["documents", "Document expiry"], ["obligations", "Other payments"]];

export default function Settings() {
  const { user, profile, toast, isAdminMode, isUltra, admin, settings, reloadRefs, refreshUnread } = useApp();
  const router = useRouter();
  const sb = supabase();
  const [prefs, setPrefs] = useState<{ in_app: boolean; email: boolean; push: boolean; muted_categories: string[] } | null>(null);
  const [push, setPush] = useState<PushState>("unsupported");
  const [name, setName] = useState(profile?.full_name ?? "");
  const [pw, setPw] = useState("");
  const [pin, setPin] = useState({ cur: "", next: "" });
  const [app, setApp] = useState({ timezone: "", offsets: "", overdue: "", minutes: "", app_url: "" });

  useEffect(() => {
    if (!user) return;
    sb.from("notification_preferences").select("*").eq("user_id", user.id).maybeSingle().then(({ data }) => setPrefs(data ?? { in_app: true, email: true, push: true, muted_categories: [] }));
    pushState().then(setPush);
  }, [user, sb]);
  useEffect(() => { if (settings) setApp({ timezone: settings.timezone, offsets: settings.reminder_offsets.join(", "), overdue: String(settings.overdue_repeat_days), minutes: String(settings.admin_session_minutes), app_url: settings.app_url ?? "" }); }, [settings]);

  const savePrefs = async (p: NonNullable<typeof prefs>) => {
    setPrefs(p);
    const { error } = await sb.from("notification_preferences").upsert({ user_id: user!.id, ...p });
    if (error) toast(friendlyError(error), "error");
  };
  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    const { error } = await fn();
    if (error) toast(friendlyError(error), "error"); else toast(ok);
  };

  return (
    <div>
      <PageHeader title="Settings" back="/more" />
      <SectionTitle>Account</SectionTitle>
      <div className="card px-4 py-4 space-y-3">
        <div className="text-sm text-ink-3">{user?.email} · <Badge tone={profile?.role === "admin" ? "admin" : "neutral"}>{profile?.role?.replace("_", " ")}</Badge></div>
        <label className="block"><span className="text-sm font-medium text-ink-2">Display name</span>
          <div className="flex gap-2 mt-1.5"><input className="field" value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="secondary" onClick={() => run(() => sb.from("user_profiles").update({ full_name: name || null }).eq("id", user!.id), "Name saved")}>Save</Button></div></label>
        <label className="block"><span className="text-sm font-medium text-ink-2">Set a new password</span>
          <div className="flex gap-2 mt-1.5"><input className="field" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <Button variant="secondary" onClick={() => pw.length < 10 ? toast("Use at least 10 characters", "error") : run(() => sb.auth.updateUser({ password: pw }).then((r) => { setPw(""); return r; }), "Password updated")}>Set</Button></div></label>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={async () => { await sb.auth.signOut({ scope: "others" }); toast("Signed out on other devices"); }}>Sign out others</Button>
          <Button variant="secondary" onClick={async () => { await sb.auth.signOut(); replayIntroOnLogin("Signed out successfully"); router.replace("/login"); }}><LogOut className="size-4" />Sign out</Button>
        </div>
      </div>

      <MyProfileEmoji />

      <SectionTitle>Appearance</SectionTitle>
      <ThemePicker />

      <SectionTitle>Sections</SectionTitle>
      <ModuleSwitches />

      <SectionTitle>Families</SectionTitle>
      <JoinFamily />

      <SectionTitle>Notifications</SectionTitle>
      {prefs && (
        <div className="card px-4 py-2">
          {(["in_app", "push"] as const).map((k) => (
            <label key={k} className="flex items-center justify-between py-3 border-b hairline last:border-0">
              <span>{{ in_app: "In-app", email: "Email", push: "Push on this phone" }[k]}</span>
              <input type="checkbox" className="size-6 accent-[var(--accent)]" checked={prefs[k]} disabled={k === "in_app"} onChange={(e) => savePrefs({ ...prefs, [k]: e.target.checked })} />
            </label>
          ))}
        </div>
      )}
      <div className="card px-4 py-3 mt-2 text-sm">
        {push === "unsupported" && <p className="text-ink-3">Push isn’t supported in this browser. On iPhone, add Sampatti to the Home Screen first (Share → Add to Home Screen). In-app reminders still work.</p>}
        {push === "not-configured" && <p className="text-ink-3">Push is not configured on the server yet. In-app reminders still work.</p>}
        {push === "denied" && <p className="text-ink-3">Notifications are blocked for this site in your browser settings. In-app reminders still work.</p>}
        {push === "default" && <Button className="w-full" onClick={async () => { try { await enablePush(user!.id); setPush("subscribed"); toast("Push enabled on this device"); } catch (e) { toast(friendlyError(e), "error"); } }}>Enable push on this device</Button>}
        {push === "subscribed" && <div className="flex items-center justify-between"><span className="text-ok font-medium">Push active on this device</span><Button size="sm" variant="secondary" onClick={async () => { await disablePush(); setPush("default"); }}>Turn off</Button></div>}
      </div>
      <Button variant="secondary" className="w-full mt-2" onClick={async () => {
        const { data, error } = await sb.rpc("send_test_notification");
        if (error) return toast(friendlyError(error), "error");
        refreshUnread();
        if (!data?.push_queued && "Notification" in window && Notification.permission === "granted") {
          const reg = await navigator.serviceWorker?.getRegistration();
          reg?.showNotification("Test alert", { body: "Reminders are working on this device.", icon: "/icons/icon-192.png", data: { url: "/reminders" } });
        }
        toast(data?.push_queued ? "Test alert sent. Check Reminders and your phone’s notifications" : "Test alert sent. Check Reminders");
      }}>Send a test alert</Button>
      {prefs && (
        <>
          <SectionTitle>Remind me about</SectionTitle>
          <div className="card px-4 py-2">{MUTABLE.map(([k, l]) => (
            <label key={k} className="flex items-center justify-between py-3 border-b hairline last:border-0"><span>{l}</span>
              <input type="checkbox" className="size-6 accent-[var(--accent)]" checked={!prefs.muted_categories.includes(k)}
                onChange={(e) => savePrefs({ ...prefs, muted_categories: e.target.checked ? prefs.muted_categories.filter((x) => x !== k) : [...prefs.muted_categories, k] })} /></label>))}</div>
        </>
      )}

      {admin?.is_admin && (
        <>
          <SectionTitle>Administrator</SectionTitle>
          {!isAdminMode ? <AdminToggle /> : (
            <div className="space-y-2">
              {isUltra && <div className="card px-4 py-4 space-y-3">
                <div className="font-medium">Reminder schedule</div>
                <label className="block"><span className="text-sm text-ink-2">Days before due date</span><input className="field mt-1.5 num" value={app.offsets} onChange={(e) => setApp({ ...app, offsets: e.target.value })} /></label>
                <label className="block"><span className="text-sm text-ink-2">Repeat overdue reminders every (days)</span><input inputMode="numeric" className="field mt-1.5" value={app.overdue} onChange={(e) => setApp({ ...app, overdue: e.target.value })} /></label>
                <label className="block"><span className="text-sm text-ink-2">Timezone</span><input className="field mt-1.5" value={app.timezone} onChange={(e) => setApp({ ...app, timezone: e.target.value })} /></label>
                <label className="block"><span className="text-sm text-ink-2">Admin Mode lasts (minutes)</span><input inputMode="numeric" className="field mt-1.5" value={app.minutes} onChange={(e) => setApp({ ...app, minutes: e.target.value })} /></label>
                <label className="block"><span className="text-sm text-ink-2">App URL (for email links)</span><input className="field mt-1.5" value={app.app_url} onChange={(e) => setApp({ ...app, app_url: e.target.value })} /></label>
                <Button className="w-full" onClick={() => {
                  const offs = app.offsets.split(/[\s,]+/).filter(Boolean).map(Number);
                  if (offs.some((n) => !Number.isInteger(n))) return toast("Days must be whole numbers", "error");
                  run(() => sb.rpc("update_app_settings", { p: { reminder_offsets: offs, overdue_repeat_days: Number(app.overdue), timezone: app.timezone, admin_session_minutes: Number(app.minutes), app_url: app.app_url || null } }).then((r) => { reloadRefs(); return r; }), "Settings saved");
                }}>Save settings</Button>
              </div>}
              <div className="card px-4 py-4 space-y-3">
                <div className="font-medium">Change your admin PIN</div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="field num" inputMode="numeric" type="password" maxLength={4} placeholder="Current" value={pin.cur} onChange={(e) => setPin({ ...pin, cur: e.target.value.replace(/\D/g, "") })} />
                  <input className="field num" inputMode="numeric" type="password" maxLength={4} placeholder="New" value={pin.next} onChange={(e) => setPin({ ...pin, next: e.target.value.replace(/\D/g, "") })} />
                </div>
                <Button variant="admin" className="w-full" onClick={() => run(() => sb.rpc("change_admin_pin", { p_current: pin.cur, p_new: pin.next }).then((r) => { setPin({ cur: "", next: "" }); return r; }), "PIN changed")}>Change PIN</Button>
              </div>
              {isUltra && <Button variant="secondary" className="w-full" onClick={() => run(() => sb.rpc("revoke_admin_sessions", { p_user: null }), "All Admin Mode sessions revoked")}>Revoke all Admin Mode sessions</Button>}
            </div>
          )}
        </>
      )}
      <p className="mt-8 text-center text-xs text-ink-3">Sampatti never stores bank passwords, PINs, OTPs or net-banking credentials.</p>
    </div>
  );
}

function JoinFamily() {
  const { families, toast, reloadRefs, profile } = useApp();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const isAdmin = profile?.role === "admin";
  const mine = isAdmin ? null : families[0] ?? null; // non-admins can only see their own family
  const join = async () => {
    setBusy(true);
    const { data, error } = await supabase().rpc("join_family", { p_code: code });
    setBusy(false); setConfirm(false);
    if (error) return toast(friendlyError(error), "error");
    setCode(""); await reloadRefs();
    toast(data.already ? `You’re already in ${data.family}` : data.left ? `Moved from ${data.left} to ${data.family}` : `You joined ${data.family}`);
  };
  if (isAdmin) return <div className="card px-4 py-3 text-sm text-ink-2">As administrator you can see every family. Manage them on the Profiles page.</div>;
  return (
    <div className="card px-4 py-4 space-y-3">
      <div className="text-sm text-ink-2">{mine ? <>Your family: <span className="text-ink font-medium">{mine.name}</span></> : "You’re not in a family yet"}</div>
      <label className="block"><span className="text-sm font-medium text-ink-2">{mine ? "Switch to another family" : "Join a family with its access code"}</span>
        <div className="flex gap-2 mt-1.5">
          <input className="field mono uppercase tracking-[0.12em]" placeholder="ABCD-2345" autoCapitalize="characters" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button variant="secondary" loading={busy} disabled={!code.trim()} onClick={() => (mine ? setConfirm(true) : join())}>{mine ? "Switch" : "Join"}</Button>
        </div></label>
      <p className="text-xs text-ink-3">You can be in one family at a time.</p>
      <Confirm open={confirm} onClose={() => setConfirm(false)} title="Are you sure?" confirmLabel="Yes, switch family" danger loading={busy}
        message={<div className="space-y-3">
          <p>You’re about to leave <span className="text-ink font-medium">{mine?.name}</span>. You can only be in one family at a time.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>You’ll stop seeing {mine?.name}’s members, records and documents</li>
            <li>You’ll stop getting their payment reminders</li>
            <li>To come back, you’ll need {mine?.name}’s access code again</li>
          </ul>
        </div>} onConfirm={join} />
    </div>
  );
}

function MyProfileEmoji() {
  const { profile, entities } = useApp();
  const [open, setOpen] = useState(false);
  const me = entities.find((e) => e.id === profile?.linked_entity_id);
  if (!me) return null;
  return (
    <>
      <SectionTitle>Your profile</SectionTitle>
      <div className="card px-4 py-3 flex items-center gap-3">
        <MemberAvatar entity={me} onClick={() => setOpen(true)} />
        <div className="flex-1 min-w-0"><div className="font-medium truncate">{me.name}</div><div className="text-[13px] text-ink-3">Your emoji marks your payments and records</div></div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{me.emoji ? "Change" : "Choose"}</Button>
      </div>
      <EmojiPicker entity={me} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Loans and insurance are off by default; turning one on shows it everywhere and restores its reminders. */
function ModuleSwitches() {
  const { user, hiddenModules, setHiddenModules, toast } = useApp();
  const set = async (m: string, on: boolean) => {
    const next = on ? hiddenModules.filter((x) => x !== m) : [...hiddenModules, m];
    const prev = hiddenModules;
    setHiddenModules(next);
    const { error } = await supabase().from("user_profiles").update({ hidden_modules: next }).eq("id", user!.id);
    if (error) { setHiddenModules(prev); toast(friendlyError(error), "error"); }
  };
  return (
    <>
      <div className="card px-4 py-2">
        {([["loans", "Loans & EMIs"], ["insurance", "Insurance"]] as const).map(([m, l]) => (
          <label key={m} className="flex items-center justify-between py-3 border-b hairline last:border-0">
            <span>{l}</span>
            <input type="checkbox" role="switch" className="size-6 accent-[var(--accent)]" checked={!hiddenModules.includes(m)} onChange={(e) => set(m, e.target.checked)} />
          </label>
        ))}
      </div>
      <p className="mt-2 px-1 text-xs text-ink-3">Turned off, they are hidden from your screens, totals, charts and reports, and you get no reminders for them. Nothing is deleted.</p>
    </>
  );
}
