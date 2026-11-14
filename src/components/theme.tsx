"use client";
import { useEffect, useState } from "react";
import { Sun, Moon, Smartphone } from "lucide-react";
import { cx } from "./ui";

export type Theme = "system" | "light" | "dark";
const KEY = "sampatti.theme"; // per-device UI preference

/** Runs before first paint (inlined in <head>) so the saved theme never flashes. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function applyTheme(t: Theme) {
  const el = document.documentElement;
  if (t === "system") el.removeAttribute("data-theme"); else el.setAttribute("data-theme", t);
  try { t === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, t); } catch { /* ignore */ }
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#111314" : "#f6f4ef"));
}

export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => { try { const t = localStorage.getItem(KEY); if (t === "light" || t === "dark") setTheme(t); } catch { /* ignore */ } }, []);
  const opts: [Theme, string, typeof Sun][] = [["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "Match phone", Smartphone]];
  return (
    <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-surface-2" role="radiogroup" aria-label="Appearance">
      {opts.map(([k, label, Icon]) => (
        <button key={k} role="radio" aria-checked={theme === k} onClick={() => { setTheme(k); applyTheme(k); }}
          className={cx("h-11 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 transition-colors", theme === k ? "bg-surface shadow-sm text-ink" : "text-ink-3")}>
          <Icon className="size-4" strokeWidth={1.5} />{label}
        </button>
      ))}
    </div>
  );
}
