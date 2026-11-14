"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "link">("password");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null);

  // Email links return here with the session (or an error) in the URL hash.
  useEffect(() => {
    const sb = supabase();
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("error_description")) setMsg({ t: h.get("error_description")!.replace(/\+/g, " ") + ". Request a new link.", err: true });
    const go = () => { router.replace("/"); router.refresh(); };
    sb.auth.getSession().then(({ data }) => data.session && go());
    const { data: sub } = sb.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_IN") go(); });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const sb = supabase();
    if (mode === "password") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) setMsg({ t: error.message, err: true });
      else { router.replace("/"); router.refresh(); }
    } else {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/login` } });
      setMsg(error ? { t: error.message, err: true } : { t: "Check your email and open the link on any device." });
    }
    setBusy(false);
  };

  return (
    <main className="min-h-dvh flex flex-col justify-center px-6 max-w-sm mx-auto safe-top safe-bottom">
      <div className="mb-10">
        <h1 className="text-3xl font-medium tracking-tight">Sampatti</h1>
        <p className="mt-1 text-ink-3">What the family owes, when, and from which account</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label className="block"><span className="text-sm font-medium text-ink-2">Email</span>
          <input className="field mt-1.5" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode === "password" && (
          <label className="block"><span className="text-sm font-medium text-ink-2">Password</span>
            <input className="field mt-1.5" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        )}
        {msg && <p className={`text-sm ${msg.err ? "text-danger" : "text-ok"}`} role="status">{msg.t}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>{mode === "password" ? "Sign in" : "Email me a sign-in link"}</Button>
        <button type="button" onClick={() => setMode(mode === "password" ? "link" : "password")} className="w-full h-11 text-sm text-accent font-medium">
          {mode === "password" ? "Sign in with an email link instead" : "Use password instead"}
        </button>
      </form>
      <p className="mt-10 text-xs text-ink-3 text-center">Accounts are created by the family administrator.</p>
    </main>
  );
}
