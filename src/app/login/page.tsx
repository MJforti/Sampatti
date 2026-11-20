"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { Splash, useIntro } from "@/components/splash";

export default function Login() {
  const intro = useIntro();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase().auth.getSession().then(({ data }) => data.session && router.replace("/"));
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const sb = supabase();
    if (mode === "signup") {
      const { error } = await sb.rpc("sign_up", { p_email: email, p_password: password, p_full_name: name || null });
      if (error) { setMsg(error.message); setBusy(false); return; }
    }
    const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) { setMsg(error.message === "Invalid login credentials" ? "Email or password is incorrect" : error.message); setBusy(false); return; }
    if (mode === "signup" && code.trim()) {
      const j = await sb.rpc("join_family", { p_code: code });
      if (j.error) { setMsg(`Account created, but: ${j.error.message}. You can add the code later in Settings.`); setBusy(false); setTimeout(() => router.replace("/"), 2500); return; }
    }
    router.replace("/"); router.refresh();
  };

  const signup = mode === "signup";
  if (intro) return <Splash />;
  return (
    <main className="min-h-dvh flex flex-col justify-center px-6 max-w-sm mx-auto safe-top safe-bottom">
      <div className="mb-10">
        <h1 className="text-3xl font-medium tracking-tight">Sampatti</h1>
        <p className="mt-1 text-ink-3">What the family owes, when, and from which account</p>
      </div>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-surface-2 mb-5" role="tablist">
        {(["signin", "signup"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setMsg(null); }}
            className={`h-10 rounded-xl text-sm font-medium transition-colors ${mode === m ? "bg-surface text-ink shadow-sm" : "text-ink-3"}`}>
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-3">
        {signup && (
          <label className="block"><span className="text-sm font-medium text-ink-2">Your name</span>
            <input className="field mt-1.5" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        )}
        <label className="block"><span className="text-sm font-medium text-ink-2">Email</span>
          <input className="field mt-1.5" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block"><span className="text-sm font-medium text-ink-2">Password</span>
          <input className="field mt-1.5" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 8 : undefined}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {signup && <span className="block mt-1 text-xs text-ink-3">At least 8 characters</span>}</label>
        {signup && (
          <label className="block"><span className="text-sm font-medium text-ink-2">Family access code</span>
            <input className="field mt-1.5 mono uppercase tracking-[0.12em]" placeholder="ABCD-2345" autoCapitalize="characters" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
            <span className="block mt-1 text-xs text-ink-3">From your family’s administrator. Gives you access to that family</span></label>
        )}
        {msg && <p className="text-sm text-danger" role="alert">{msg}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>{signup ? "Create account" : "Sign in"}</Button>
      </form>
      <p className="mt-10 text-xs text-ink-3 text-center">
        {signup ? "Without a family code you’ll see nothing until the administrator gives access" : "Forgot your password? Ask the administrator to reset it"}
      </p>
    </main>
  );
}
