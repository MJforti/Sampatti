"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { useApp } from "@/components/providers";
import { PageHeader, ListSkeleton } from "@/components/ui";
import { MODULES, MODULE_LIST } from "@/lib/modules";
import { supabase } from "@/lib/supabase/client";

type Hit = { href: string; title: string; sub: string };
const SEARCH_COLS: Record<string, string[]> = {
  investments: ["name", "institution", "reference_number"], insurance: ["insurer", "policy_name", "policy_number"],
  loans: ["lender"], vehicles: ["registration_number", "make_model"], banks: ["bank_name", "nickname", "branch"],
  obligations: ["title"],
};

export default function Search() {
  const { entityName } = useApp();
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  useEffect(() => {
    const t = term.trim().replace(/[%,()*]/g, " ");
    if (t.length < 2) { setHits(null); return; }
    const h = setTimeout(async () => {
      const sb = supabase();
      const res = await Promise.all(MODULE_LIST.map(async (m) => {
        const mod = MODULES[m];
        const { data } = await sb.from(mod.table).select("*").or(SEARCH_COLS[m].map((c) => `${c}.ilike.%${t}%`).join(",")).limit(10);
        return (data ?? []).map((r) => ({ href: `/m/${m}/${r.id}`, title: mod.primary(r), sub: `${mod.singular} · ${entityName(r.entity_id)}` }));
      }));
      const docs = await sb.from("documents").select("id,title,entity_id").ilike("title", `%${t}%`).limit(10);
      setHits([...res.flat(), ...(docs.data ?? []).map((d) => ({ href: "/documents", title: d.title, sub: `Document · ${entityName(d.entity_id)}` }))]);
    }, 250);
    return () => clearTimeout(h);
  }, [term, entityName]);
  return (
    <div>
      <PageHeader title="Search" back="/more" />
      <div className="relative"><SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink-3" />
        <input autoFocus className="field pl-10" placeholder="Policy number, bank, vehicle, fund…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
      <div className="mt-3">
        {term.trim().length >= 2 && hits === null && <ListSkeleton rows={3} />}
        {hits && !hits.length && <p className="text-sm text-ink-3 px-1">No matches.</p>}
        {hits && hits.length > 0 && <div className="card overflow-hidden">{hits.map((h, i) => (
          <Link key={i} href={h.href} className="block px-4 py-3 border-b hairline last:border-0 active:bg-surface-2"><div className="text-[15px] font-medium">{h.title}</div><div className="text-[13px] text-ink-3">{h.sub}</div></Link>))}</div>}
      </div>
    </div>
  );
}
