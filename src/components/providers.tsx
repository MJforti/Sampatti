"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { DEFAULT_TZ } from "@/lib/dates";

export type Family = { id: string; name: string; is_active: boolean; access_code?: string };
export type Entity = { id: string; family_id?: string | null; emoji?: string | null; name: string; entity_type: string; is_active: boolean; email?: string | null; phone?: string | null; notes?: string | null; pan_masked?: string | null; sort_order: number };
export type Bank = { id: string; entity_id: string; bank_name: string; account_last4: string | null; nickname: string | null };
export type Vehicle = { id: string; entity_id: string; registration_number: string };
export type UserProfile = { id: string; email: string; full_name: string | null; role: "admin" | "family_member" | "accountant" | "read_only"; is_active: boolean; linked_entity_id?: string | null };
export type AdminStatus = {
  is_admin: boolean; is_ultra?: boolean; family_id?: string | null; family_name?: string | null; pin_configured: boolean; can_bootstrap: boolean; unlocked: boolean;
  expires_at: string | null; session_minutes: number; locked_until: string | null; attempts_left: number;
};
type Settings = { timezone: string; reminder_offsets: number[]; overdue_repeat_days: number; admin_session_minutes: number; auto_debit_reminder_hours: number; max_pin_attempts: number; lockout_minutes: number; app_url: string | null; pin_set_at: string | null };

type Ctx = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  entities: Entity[];
  families: Family[];
  banks: Bank[];
  vehicles: Vehicle[];
  settings: Settings | null;
  tz: string;
  reloadRefs: () => Promise<void>;
  entityName: (id: string | null | undefined) => string;
  bankLabel: (id: string | null | undefined) => string;
  // profile filter
  selected: string | null;
  setSelected: (id: string | null) => void;
  // admin
  admin: AdminStatus | null;
  isAdminMode: boolean;
  isUltra: boolean;
  canEdit: (entityId: string | null | undefined) => boolean;
  adminEntities: Entity[];
  refreshAdmin: () => Promise<AdminStatus | null>;
  setAdmin: (s: AdminStatus) => void;
  lockAdmin: () => Promise<void>;
  pinOpen: boolean;
  setPinOpen: (v: boolean) => void;
  // toast
  toast: (msg: string, tone?: "ok" | "error") => void;
  unread: number;
  refreshUnread: () => void;
};

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
};

const SELECTED_KEY = "sampatti.selectedProfile"; // UI preference only

export function AppProviders({ children }: { children: ReactNode }) {
  const sb = supabase();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selected, setSelectedState] = useState<string | null>(null);
  const [admin, setAdmin] = useState<AdminStatus | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: string }[]>([]);
  const [unread, setUnread] = useState(0);

  const toast = useCallback((msg: string, tone: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);

  const reloadRefs = useCallback(async () => {
    const [e, b, v, s, fam, codes] = await Promise.all([
      sb.from("family_entities").select("*").order("sort_order").order("name"),
      sb.from("bank_accounts").select("id, entity_id, bank_name, account_last4, nickname").is("archived_at", null).order("bank_name"),
      sb.from("vehicles").select("id, entity_id, registration_number").is("archived_at", null),
      sb.rpc("get_app_settings"),
      sb.from("families").select("id, name, is_active").order("name"),
      sb.rpc("family_codes"),
    ]);
    if (fam.data) setFamilies(fam.data.map((f: Family) => ({ ...f, access_code: (codes.data ?? []).find((c: { id: string }) => c.id === f.id)?.access_code })));
    if (e.data) setEntities(e.data);
    if (b.data) setBanks(b.data);
    if (v.data) setVehicles(v.data);
    if (s.data) setSettings(s.data as Settings);
  }, [sb]);

  const refreshAdmin = useCallback(async () => {
    const { data } = await sb.rpc("admin_status");
    if (data) setAdmin(data as AdminStatus);
    return (data as AdminStatus) ?? null;
  }, [sb]);

  const refreshUnread = useCallback(async () => {
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return;
    const { count } = await sb.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", u.user.id).is("read_at", null);
    setUnread(count ?? 0);
  }, [sb]);

  useEffect(() => {
    try { setSelectedState(localStorage.getItem(SELECTED_KEY)); } catch { /* ignore */ }
    const load = async (u: User | null) => {
      setUser(u);
      if (u) {
        const { data } = await sb.from("user_profiles").select("*").eq("id", u.id).maybeSingle();
        setProfile(data);
        await Promise.all([reloadRefs(), refreshAdmin(), refreshUnread()]);
      } else {
        setProfile(null);
      }
      setLoading(false);
    };
    sb.auth.getUser().then(({ data }) => load(data.user));
    const { data: sub } = sb.auth.onAuthStateChange((evt, session) => {
      if (evt === "SIGNED_IN" || evt === "SIGNED_OUT") load(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [sb, reloadRefs, refreshAdmin, refreshUnread]);

  // Realtime: new notifications bump the badge.
  useEffect(() => {
    if (!user) return;
    const ch = sb.channel("notif-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => refreshUnread())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [sb, user, refreshUnread]);

  const isAdminMode = !!admin?.unlocked && !!admin.expires_at && new Date(admin.expires_at) > new Date();

  // Auto-lock: Admin Mode ends at a fixed time after unlocking; the server enforces it, this timer updates the screen.
  useEffect(() => {
    if (!isAdminMode || !admin?.expires_at) return;
    const ms = new Date(admin.expires_at).getTime() - Date.now();
    const t = setTimeout(() => { refreshAdmin().then((s) => { if (s && !s.unlocked) toast("Admin Mode locked. Enter your PIN to continue"); }); }, Math.max(ms, 0) + 500);
    // phones pause timers in the background: re-check as soon as the app is visible again
    const onVisible = () => { if (document.visibilityState === "visible" && new Date(admin.expires_at!) <= new Date()) refreshAdmin(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [isAdminMode, admin?.expires_at, refreshAdmin, sb, toast]);

  const lockAdmin = useCallback(async () => {
    const { data } = await sb.rpc("admin_lock");
    if (data) setAdmin(data as AdminStatus);
    toast("Admin Mode locked");
  }, [sb, toast]);

  const setSelected = useCallback((id: string | null) => {
    setSelectedState(id);
    try { id ? localStorage.setItem(SELECTED_KEY, id) : localStorage.removeItem(SELECTED_KEY); } catch { /* ignore */ }
  }, []);

  const value = useMemo<Ctx>(() => ({
    user, profile, loading, entities, families, banks, vehicles, settings, tz: settings?.timezone ?? DEFAULT_TZ, reloadRefs,
    entityName: (id) => entities.find((e) => e.id === id)?.name ?? "—",
    bankLabel: (id) => {
      const b = banks.find((x) => x.id === id);
      return b ? `${b.nickname || b.bank_name}${b.account_last4 ? " ••" + b.account_last4 : ""}` : "—";
    },
    selected: entities.some((e) => e.id === selected) ? selected : null, setSelected,
    admin, isAdminMode,
    isUltra: isAdminMode && !!admin?.is_ultra,
    canEdit: (id) => isAdminMode && (!!admin?.is_ultra || (!!id && entities.find((e) => e.id === id)?.family_id === admin?.family_id)),
    adminEntities: !isAdminMode ? [] : admin?.is_ultra ? entities : entities.filter((e) => e.family_id === admin?.family_id),
    refreshAdmin, setAdmin, lockAdmin, pinOpen, setPinOpen, toast, unread, refreshUnread,
  }), [user, profile, loading, entities, families, banks, vehicles, settings, reloadRefs, selected, setSelected, admin, isAdminMode, refreshAdmin, lockAdmin, pinOpen, toast, unread, refreshUnread]);

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="fixed top-3 inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none safe-top" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`anim-sheet pointer-events-auto max-w-md w-full rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ${t.tone === "error" ? "bg-danger text-white" : "bg-ink text-bg"}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

/** Turn a PostgREST / RPC error into something a family member can read. */
export function friendlyError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/row-level security|permission denied/i.test(m)) return "You don’t have permission to do that. Unlock Admin Mode and try again.";
  if (/duplicate key/i.test(m)) return "A record with these details already exists.";
  if (/check constraint/i.test(m)) return "Some values are not in the expected format. Please review the form.";
  return m;
}
