import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { serverClient, serviceClient } from "@/lib/supabase/server";

const Body = z.object({
  email: z.string().email(),
  full_name: z.string().max(120).optional().default(""),
  role: z.enum(["family_member", "accountant", "read_only"]),
});

// Invite a user. Caller must be an administrator with Admin Mode unlocked (checked in the DB).
export async function POST(req: NextRequest) {
  const sb = await serverClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: status } = await sb.rpc("admin_status");
  if (!status?.unlocked) return NextResponse.json({ error: "Unlock Admin Mode first" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid email or role" }, { status: 400 });
  const { email, full_name, role } = parsed.data;

  const admin = serviceClient();
  const origin = req.headers.get("origin") ?? req.nextUrl.origin;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo: `${origin}/auth/callback?next=/settings` });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // Role is applied with the caller's own session so RLS + audit apply.
  const upd = await sb.from("user_profiles").update({ role, full_name: full_name || null }).eq("id", data.user.id);
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 });
  return NextResponse.json({ id: data.user.id });
}
