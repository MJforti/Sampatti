"use client";
import { useApp } from "./providers";
import { Chip } from "./ui";

/** Horizontal profile switcher: whole family or one individual/entity. */
export function ProfileSelect() {
  const { entities, selected, setSelected } = useApp();
  const active = entities.filter((e) => e.is_active);
  if (active.length <= 1) return null;
  return (
    <div className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar py-1" role="tablist" aria-label="Profile">
      <Chip active={!selected} onClick={() => setSelected(null)}>Family</Chip>
      {active.map((e) => (
        <Chip key={e.id} active={selected === e.id} onClick={() => setSelected(e.id)}>{e.emoji ? <span aria-hidden className="mr-1.5">{e.emoji}</span> : null}{shortName(e.name)}</Chip>
      ))}
    </div>
  );
}
export function shortName(n: string) {
  return n.length > 22 ? n.replace(" and Associates", " & Assoc.").replace("Kumar ", "K. ") : n;
}
