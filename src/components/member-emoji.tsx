"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useApp, friendlyError, type Entity } from "./providers";
import { Button, Sheet, cx } from "./ui";

const CHOICES = ["🦁", "🐯", "🦚", "🐘", "🦋", "🌸", "🌻", "🌿", "🍀", "🌙", "☀️", "⭐", "🔥", "🌊", "⛰️", "🏡",
  "📚", "🎵", "🎨", "⚽", "🏏", "♟️", "☕", "🍵", "🪔", "🕉️", "💎", "👑", "🚗", "✈️", "🧭", "🏛️"];

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).filter((c) => /[A-Z]/.test(c)).slice(0, 2).join("");
}

/** Member marker: their chosen emoji, or initials until they pick one. */
export function MemberAvatar({ entity, size = "md", onClick }: { entity: Pick<Entity, "name" | "emoji">; size?: "sm" | "md" | "lg"; onClick?: () => void }) {
  const s = { sm: "size-6 text-[14px]", md: "size-10 text-[20px]", lg: "size-16 text-[34px]" }[size];
  const inner = entity.emoji
    ? <span aria-hidden className="leading-none">{entity.emoji}</span>
    : <span className={cx("font-medium text-ink-2", size === "lg" ? "text-[20px]" : size === "sm" ? "text-[10px]" : "text-[14px]")}>{initials(entity.name)}</span>;
  const cls = cx(s, "shrink-0 grid place-items-center rounded-full", entity.emoji ? "bg-accent-soft" : "bg-surface-2");
  return onClick
    ? <button type="button" onClick={onClick} className={cls} aria-label={`Choose emoji for ${entity.name}`}>{inner}</button>
    : <span className={cls}>{inner}</span>;
}

/** Inline marker for lists: "🌸 Shradha Jain" */
export function MemberName({ id, name }: { id: string; name: string }) {
  const { entities } = useApp();
  const e = entities.find((x) => x.id === id);
  return <>{e?.emoji ? <span aria-hidden className="mr-1">{e.emoji}</span> : null}{name}</>;
}

export function canChooseEmoji(entityId: string, isAdminMode: boolean, linked: string | null | undefined) {
  return isAdminMode || linked === entityId;
}

export function EmojiPicker({ entity, open, onClose }: { entity: Entity; open: boolean; onClose: () => void }) {
  const { toast, reloadRefs } = useApp();
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (emoji: string | null) => {
    setBusy(true);
    const { error } = await supabase().rpc("set_member_emoji", { p_entity: entity.id, p_emoji: emoji });
    setBusy(false);
    if (error) return toast(friendlyError(error), "error");
    await reloadRefs(); toast(emoji ? "Emoji saved" : "Emoji removed"); setCustom(""); onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={`Emoji for ${entity.name}`}
      footer={entity.emoji ? <Button variant="secondary" className="w-full" onClick={() => save(null)} loading={busy}>Remove emoji</Button> : undefined}>
      <p className="text-sm text-ink-3 mb-4">Shown next to {entity.name.split(" ")[0]}’s payments, reminders and records, so they’re easy to spot</p>
      <div className="grid grid-cols-6 gap-2">
        {CHOICES.map((e) => (
          <button key={e} type="button" disabled={busy} onClick={() => save(e)} aria-label={`Choose ${e}`}
            className={cx("h-12 rounded-xl text-[24px] grid place-items-center border transition-colors", entity.emoji === e ? "border-accent bg-accent-soft" : "border-line bg-surface active:bg-surface-2")}>{e}</button>
        ))}
      </div>
      <label className="block mt-5"><span className="text-sm font-medium text-ink-2">Or type any emoji</span>
        <div className="flex gap-2 mt-1.5">
          <input className="field text-[22px]" maxLength={8} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom emoji" />
          <Button variant="secondary" disabled={!custom.trim() || /[A-Za-z0-9]/.test(custom)} onClick={() => save(custom.trim())} loading={busy}>Use</Button>
        </div></label>
    </Sheet>
  );
}
