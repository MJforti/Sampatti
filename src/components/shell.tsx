"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Home, BellRing, CalendarDays, Users, LayoutGrid, Lock, ShieldCheck, Delete } from "lucide-react";
import { useApp, type AdminStatus } from "./providers";
import { Button, Sheet, cx } from "./ui";
import { supabase } from "@/lib/supabase/client";
import { LogoutButton } from "./logout";
import { Splash, useIntro } from "./splash";

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/reminders", label: "Reminders", icon: BellRing },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/profiles", label: "Profiles", icon: Users },
  { href: "/more", label: "More", icon: LayoutGrid },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, isAdminMode, admin, lockAdmin, unread } = useApp();
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const intro = useIntro("app");

  if (loading || !user || intro) {
    return <Splash place="app" />;
  }

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop side rail */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r hairline bg-surface px-4 py-6">
        <div className="px-2 text-xl font-medium tracking-tight">Sampatti</div>
        <div className="px-2 text-xs text-ink-3">Family ledger</div>
        <nav className="mt-8 space-y-1">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={cx("flex items-center gap-3 h-11 px-3 rounded-xl text-[15px]", active(t.href) ? "bg-accent-soft text-accent font-semibold" : "text-ink-2 hover:bg-surface-2")}>
              <t.icon className="size-5" strokeWidth={active(t.href) ? 2.2 : 1.8} />{t.label}
              {t.href === "/reminders" && unread > 0 && <span className="ml-auto text-xs bg-danger text-white rounded-full px-1.5 min-w-5 text-center">{unread}</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-1"><AdminToggle /><LogoutButton className="w-full text-ink-2" /></div>
      </aside>

      {isAdminMode && (
        <div className="no-print sticky top-0 z-40 bg-bg/95 backdrop-blur border-b hairline safe-top">
          <div className="mx-auto max-w-3xl flex items-center gap-2 px-4 h-12 text-sm text-ink-2">
            <span className="size-2 rounded-full bg-accent" aria-hidden />
            <span className="font-medium text-ink">{admin?.is_ultra ? "Ultra admin" : `${admin?.family_name ?? "Family"} admin`}</span>
            <AdminCountdown expires={admin!.expires_at!} />
            <button onClick={lockAdmin} className="ml-auto inline-flex items-center gap-1 font-medium h-11 px-3.5 rounded-xl border hairline bg-surface active:bg-surface-2">
              <Lock className="size-3.5" /> Lock
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-3xl px-4 pb-28 lg:pb-12 pt-[max(env(safe-area-inset-top),12px)]">{children}</main>

      {/* Mobile bottom navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t hairline safe-bottom" aria-label="Primary">
        <div className="grid grid-cols-5 h-16">
          {TABS.map((t) => {
            const on = active(t.href);
            return (
              <Link key={t.href} href={t.href} className={cx("relative flex flex-col items-center justify-center gap-0.5 text-[11px]", on ? "text-accent font-semibold" : "text-ink-3")} aria-current={on ? "page" : undefined}>
                <t.icon className="size-[22px]" strokeWidth={on ? 2.2 : 1.8} />
                {t.label}
                {t.href === "/reminders" && unread > 0 && (
                  <span className="absolute top-2 left-1/2 ml-2 text-[10px] leading-4 bg-danger text-white rounded-full px-1 min-w-4 text-center">{unread > 99 ? "99+" : unread}</span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
      <PinSheet />
    </div>
  );
}

function AdminCountdown({ expires }: { expires: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((new Date(expires).getTime() - now) / 1000));
  return <span className="opacity-80 num">· locks in {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

/** Discreet entry point to Admin Mode (only rendered for admin accounts). */
export function AdminToggle({ compact }: { compact?: boolean }) {
  const { admin, isAdminMode, setPinOpen, lockAdmin } = useApp();
  if (!admin?.is_admin && !admin?.can_bootstrap) return null;
  if (isAdminMode) {
    return <Button variant="secondary" size={compact ? "sm" : "md"} className="w-full" onClick={lockAdmin}><Lock className="size-4" /> Lock Admin Mode</Button>;
  }
  return (
    <Button variant="secondary" size={compact ? "sm" : "md"} className="w-full" onClick={() => setPinOpen(true)}>
      <ShieldCheck className="size-4" /> {admin.can_bootstrap ? (admin.is_admin && !admin.is_ultra ? "Set your admin PIN" : "Set up administrator") : "Admin Mode"}
    </Button>
  );
}

function PinSheet() {
  const { pinOpen, setPinOpen, admin, setAdmin, toast } = useApp();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootstrap = !!admin?.can_bootstrap;

  useEffect(() => { if (!pinOpen) { setPin(""); setConfirm(null); setError(null); } }, [pinOpen]);

  const submit = async (value: string) => {
    if (bootstrap && confirm === null) { setConfirm(value); setPin(""); return; }
    if (bootstrap && confirm !== value) { setError("PINs didn’t match. Start again."); setConfirm(null); setPin(""); return; }
    setBusy(true); setError(null);
    const sb = supabase();
    const fn = bootstrap ? "bootstrap_admin" : "verify_admin_pin";
    const { data, error } = await sb.rpc(fn, { p_pin: value });
    if (error) { setError(error.message); setPin(""); setBusy(false); return; }
    let st = data as AdminStatus & { ok?: boolean };
    if (bootstrap) {
      const v = await sb.rpc("verify_admin_pin", { p_pin: value });
      st = v.data;
    }
    setAdmin(st);
    setBusy(false);
    if (st.ok === false) {
      setPin("");
      setError(st.locked_until ? `Too many attempts. Locked until ${new Date(st.locked_until).toLocaleTimeString("en-IN")}.` : `Incorrect PIN. ${st.attempts_left} attempt${st.attempts_left === 1 ? "" : "s"} left.`);
      return;
    }
    toast(bootstrap ? "Administrator set up. Admin Mode unlocked." : "Admin Mode unlocked");
    setPinOpen(false);
  };

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) submit(next);
  };

  const heading = bootstrap ? (confirm === null ? "Create a 4-digit administrator PIN" : "Re-enter the PIN to confirm") : "Enter administrator PIN";
  return (
    <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title={bootstrap ? "Administrator setup" : "Admin Mode"}>
      <div className="text-center">
        <p className="text-[15px] text-ink-2">{heading}</p>
        {admin?.family_name && !admin.is_ultra && <p className="mt-1 text-sm text-ink-3">Admin for {admin.family_name}</p>}
        {admin?.locked_until && !bootstrap && <p className="mt-2 text-sm text-danger">Locked until {new Date(admin.locked_until).toLocaleTimeString("en-IN")}</p>}
        <div className="mt-5 flex justify-center gap-4" aria-label={`${pin.length} of 4 digits entered`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cx("size-4 rounded-full border-2", i < pin.length ? "bg-accent border-accent" : "border-line")} />
          ))}
        </div>
        <p className="mt-3 h-5 text-sm text-danger" role="alert">{error}</p>
        <div className="mt-2 grid grid-cols-3 gap-3 max-w-[300px] mx-auto">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k, i) =>
            k === "" ? <span key={i} /> : (
              <button key={i} disabled={busy}
                onClick={() => (k === "del" ? setPin((p) => p.slice(0, -1)) : press(k))}
                className="h-16 rounded-2xl bg-surface border hairline text-2xl font-medium active:bg-surface-2 disabled:opacity-50 grid place-items-center num"
                aria-label={k === "del" ? "Delete digit" : k}>
                {k === "del" ? <Delete className="size-6" /> : k}
              </button>
            ))}
        </div>
        <p className="mt-5 text-xs text-ink-3">The PIN is verified on the server. Admin Mode locks automatically {admin?.session_minutes ?? 10} minutes after you unlock it.</p>
      </div>
    </Sheet>
  );
}
