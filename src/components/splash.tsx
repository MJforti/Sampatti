"use client";
import { useEffect, useState } from "react";

// Loading screen: the logo's line draws itself, a ledger rule runs across, and the name writes in.
export function Splash() {
  return (
    <div className="splash min-h-dvh grid place-items-center overflow-hidden" role="status" aria-label="Loading Sampatti">
      <div className="flex flex-col items-center">
        <svg viewBox="0 0 192 192" className="splash-tile size-20" aria-hidden>
          <rect width="192" height="192" rx="44" fill="var(--accent)" />
          <polyline className="splash-line" points="60,120 86,94 104,110 130,76" fill="none" stroke="#f4efe6" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
          <circle className="splash-dot" cx="130" cy="74" r="10" fill="#e3a23b" />
        </svg>
        <div className="relative mt-6 w-[min(80vw,320px)]">
          <div className="splash-rule absolute left-1/2 top-full h-px w-[200vw] -translate-x-1/2 bg-[var(--accent)]" />
          <div className="text-center text-[32px] font-medium tracking-tight leading-tight pb-2" aria-hidden>
            {"Sampatti".split("").map((ch, i) => <span key={i} className="splash-letter inline-block" style={{ animationDelay: `${1.1 + i * 0.07}s` }}>{ch}</span>)}
          </div>
        </div>
        <p className="splash-tag mt-3 text-sm text-ink-3">Every rupee, in its place.</p>
      </div>
    </div>
  );
}

/** True while the intro should play: on every launch of the installed app, and once per browser session for each place (login, app open) in a browser tab. */
export function useIntro(place: "login" | "app") {
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem(`sampatti.intro.${place}`) === "1"; sessionStorage.setItem(`sampatti.intro.${place}`, "1"); } catch { /* ignore */ }
    // Opened from the home-screen icon: play on every launch (phones can keep the old session around)
    const installed = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (seen && !installed) { setIntro(false); return; }
    const t = setTimeout(() => setIntro(false), 2600);
    return () => clearTimeout(t);
  }, []);
  return intro;
}

/** After logging out, play the splash again as the login page opens. */
export function replayIntroOnLogin() {
  try { sessionStorage.removeItem("sampatti.intro.login"); } catch { /* ignore */ }
}
