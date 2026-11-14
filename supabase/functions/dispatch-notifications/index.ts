// Delivers queued email / web-push notifications created by public.generate_reminders().
// Invoked every 10 minutes by pg_cron (see migration 0004). Idempotent: rows are
// claimed atomically (FOR UPDATE SKIP LOCKED) and each (notification, channel) pair
// is unique, so a delivery can never be sent twice by concurrent runs.
//
// Secrets (supabase secrets set ...):
//   DISPATCH_SECRET      shared secret checked against the x-dispatch-secret header
//   RESEND_API_KEY       email provider key (https://resend.com). Optional: without it email rows fail with a clear error.
//   EMAIL_FROM           e.g. "Sampatti <reminders@yourdomain.in>"
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT   web push (npx web-push generate-vapid-keys)
//   APP_URL              optional; defaults to admin_settings.app_url
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

type Claimed = {
  log_id: string;
  channel: "email" | "push" | "whatsapp";
  notification_id: string;
  user_id: string;
  email: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
};

const env = (k: string) => Deno.env.get(k) ?? "";
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

// VAPID keys: function secrets if set, otherwise from Vault via get_push_config().
let pushReady: boolean | null = null;
async function ensurePush() {
  if (pushReady !== null) return pushReady;
  let pub = env("VAPID_PUBLIC_KEY"), priv = env("VAPID_PRIVATE_KEY"), subj = env("VAPID_SUBJECT");
  if (!pub || !priv) {
    const { data } = await supabase.rpc("get_push_config");
    pub = data?.vapid_public ?? ""; priv = data?.vapid_private ?? ""; subj = subj || data?.vapid_subject || "";
  }
  pushReady = !!(pub && priv);
  if (pushReady) webpush.setVapidDetails(subj || "mailto:admin@example.com", pub, priv);
  return pushReady;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

let appUrl: string | null = null;
async function getAppUrl() {
  if (appUrl !== null) return appUrl;
  const { data } = await supabase.from("admin_settings").select("app_url").eq("id", 1).maybeSingle();
  appUrl = env("APP_URL") || data?.app_url || "";
  return appUrl;
}

async function sendEmail(row: Claimed) {
  const key = env("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not configured");
  const base = await getAppUrl();
  const link = base ? `${base}${row.data.url ?? ""}` : "";
  const lines = row.body.split("\n").map((l) => `<div style="margin:2px 0">${escapeHtml(l)}</div>`).join("");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e4e0d7;border-radius:16px;background:#fff">
    <div style="font-size:13px;color:#868b93">Sampatti reminder</div>
    <h2 style="margin:8px 0 16px;font-size:18px;font-weight:500;color:#17191c">${escapeHtml(row.title)}</h2>
    <div style="font-size:14px;color:#4a4f57;line-height:1.5">${lines}</div>
    ${link ? `<a href="${escapeHtml(link)}" style="display:inline-block;margin-top:20px;padding:10px 16px;background:#1d5c4a;color:#fff;border-radius:10px;text-decoration:none">Open in Sampatti</a>` : ""}
  </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": row.log_id },
    body: JSON.stringify({ from: env("EMAIL_FROM"), to: [row.email], subject: row.title, html, text: row.body + (link ? `\n\n${link}` : "") }),
  });
  if (!res.ok) throw new Error(`email ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sendPush(row: Claimed) {
  if (!(await ensurePush())) throw new Error("VAPID keys not configured");
  const { data: subs, error } = await supabase.from("push_subscriptions").select("*").eq("user_id", row.user_id);
  if (error) throw error;
  if (!subs?.length) return "skipped";
  const payload = JSON.stringify({ title: row.title, body: row.body, url: row.data.url ?? "/reminders", tag: row.notification_id });
  let delivered = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
      delivered++;
      await supabase.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failed_count: 0 }).eq("id", s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await supabase.from("push_subscriptions").delete().eq("id", s.id);
      else await supabase.from("push_subscriptions").update({ failed_count: s.failed_count + 1 }).eq("id", s.id);
    }
  }
  if (!delivered) throw new Error("no push subscription accepted the message");
  return "sent";
}

Deno.serve(async (req) => {
  if (!env("DISPATCH_SECRET") || req.headers.get("x-dispatch-secret") !== env("DISPATCH_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const { data, error } = await supabase.rpc("claim_deliveries", { p_limit: 200 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const results = { sent: 0, failed: 0, skipped: 0 };
  for (const row of (data ?? []) as Claimed[]) {
    let status: "sent" | "failed" | "skipped" = "sent";
    let lastError: string | null = null;
    try {
      if (row.channel === "email") await sendEmail(row);
      else if (row.channel === "push") status = (await sendPush(row)) as "sent" | "skipped";
      else { status = "skipped"; lastError = "WhatsApp channel not yet integrated"; }
    } catch (e) {
      status = "failed";
      lastError = String((e as Error).message ?? e).slice(0, 500);
    }
    await supabase.from("notification_delivery_logs").update({
      status, last_error: lastError, sent_at: status === "sent" ? new Date().toISOString() : null,
    }).eq("id", row.log_id);
    results[status]++;
  }
  return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
});
