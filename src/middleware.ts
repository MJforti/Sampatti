import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth cookie on every request and gates the app behind sign-in.
export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const canonical = process.env.NEXT_PUBLIC_CANONICAL_HOST;
  if (canonical && host !== canonical && host.endsWith(".vercel.app") && !host.includes("-git-")) {
    const to = req.nextUrl.clone(); to.host = canonical; to.protocol = "https"; to.port = "";
    return NextResponse.redirect(to, 308);
  }
  let res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return res;
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await sb.auth.getUser();
  const p = req.nextUrl.pathname;
  if (!data.user && !p.startsWith("/login") && !p.startsWith("/auth") && !p.startsWith("/api")) {
    const to = req.nextUrl.clone(); to.pathname = "/login"; to.search = "";
    return NextResponse.redirect(to);
  }
  return res;
}
export const config = { matcher: ["/((?!_next|icons|sw.js|manifest.webmanifest|favicon.ico|offline.html).*)"] };
