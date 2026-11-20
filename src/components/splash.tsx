"use client";
import { useEffect, useState } from "react";

// Loading screen: the logo's line draws itself, a ledger rule runs across, and the name writes in.
export function Splash({ message, place, greeting }: { message?: string; place?: "login" | "app"; greeting?: string }) {
  // A message left by the previous screen (e.g. "Logged out") for this place
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => {
    if (!place) return;
    try {
      const m = JSON.parse(sessionStorage.getItem(MSG_KEY) ?? "null") as { place: string; text: string } | null;
      if (m?.place === place) { setStored(m.text); sessionStorage.removeItem(MSG_KEY); }
    } catch { /* ignore */ }
  }, [place]);
  const note = message ?? stored ?? greeting;
  const tick = !message && !!stored;
  return (
    <div className="splash min-h-dvh grid place-items-center overflow-hidden" role="status" aria-label="Loading Sampatti">
      <div className="flex flex-col items-center">
        <svg viewBox="0 0 192 192" className="splash-tile size-24" aria-hidden>
          {/* Exact colours from the app icon, in both themes */}
          <rect width="192" height="192" rx="44" fill="#1d5c4a" />
          <polyline className="splash-line" points="60,120 86,94 104,110 130,76" fill="none" stroke="#f6f4ef" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
          <circle className="splash-dot" cx="130" cy="74" r="10" fill="#e3a440" />
        </svg>
        <div className="relative mt-6 w-[min(80vw,320px)]">
          <div className="splash-rule absolute left-1/2 top-full h-px w-[200vw] -translate-x-1/2 bg-[var(--accent)]" />
          <div className="text-center text-[38px] font-medium tracking-tight leading-tight pb-2" aria-hidden>
            {"Sampatti".split("").map((ch, i) => <span key={i} className="splash-letter inline-block" style={{ animationDelay: `${1.1 + i * 0.07}s` }}>{ch}</span>)}
          </div>
        </div>
        <p className="splash-tag mt-3 text-sm text-ink-3">Every rupee, in its place.</p>
        {note && (
          <p className="splash-note mt-6 inline-flex items-center gap-2 rounded-full bg-accent-soft text-accent px-4 h-9 text-sm font-medium" aria-live="polite">
            {tick && <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

const MSG_KEY = "sampatti.intro.msg";
const leaveMessage = (place: "login" | "app", text?: string) => {
  try { text ? sessionStorage.setItem(MSG_KEY, JSON.stringify({ place, text })) : sessionStorage.removeItem(MSG_KEY); } catch { /* ignore */ }
};

/** How long the splash stays up, long enough for the whole animation. */
export const INTRO_MS = 2600;

/** True while the intro should play: on every launch of the installed app, and once per browser session for each place (login, app open) in a browser tab. */
export function useIntro(place: "login" | "app") {
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem(`sampatti.intro.${place}`) === "1"; sessionStorage.setItem(`sampatti.intro.${place}`, "1"); } catch { /* ignore */ }
    // Opened from the home-screen icon: play on every launch (phones can keep the old session around)
    const installed = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (seen && !installed) { setIntro(false); return; }
    const t = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(t);
  }, []);
  return intro;
}

/** Someone just signed in or created an account: play the splash as the app opens. */
export function replayIntroOnAppOpen(message?: string) {
  try { sessionStorage.removeItem("sampatti.intro.app"); } catch { /* ignore */ }
  leaveMessage("app", message);
}

/** After logging out, play the splash again as the login page opens. */
export function replayIntroOnLogin(message?: string) {
  try { sessionStorage.removeItem("sampatti.intro.login"); } catch { /* ignore */ }
  leaveMessage("login", message);
}
