"use client";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Button, Confirm } from "./ui";
import { replayIntroOnLogin } from "./splash";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant="ghost" className={className ?? "w-full text-danger"} onClick={() => setAsk(true)}><LogOut className="size-4" />Log out</Button>
      <Confirm open={ask} onClose={() => setAsk(false)} title="Log out?" confirmLabel="Log out" danger loading={busy}
        message="You’ll need your email and password to sign back in."
        onConfirm={async () => { setBusy(true); await supabase().auth.signOut(); replayIntroOnLogin("Logged out successfully"); router.replace("/login"); router.refresh(); }} />
    </>
  );
}
