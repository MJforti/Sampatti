"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { useApp, friendlyError } from "@/components/providers";
import { DocRow, UploadButtons, type Doc } from "@/components/doc-list";
import { Chip, Empty, ErrorState, ListSkeleton, PageHeader, Sheet, Button } from "@/components/ui";
import { ProfileSelect } from "@/components/profile-select";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { DOC_CATEGORIES, uploadDocument } from "@/lib/documents";

export default function Documents() {
  const { selected, isAdminMode, adminEntities: entities, toast } = useApp();
  const [cat, setCat] = useState("all");
  const [term, setTerm] = useState("");
  const [pending, setPending] = useState<File | null>(null);
  const [meta, setMeta] = useState({ title: "", category: "other", entity_id: "", expiry_date: "" });
  const [busy, setBusy] = useState(false);

  const q = useQuery(async () => {
    let qq = supabase().from("documents").select("*").is("archived_at", null).order("created_at", { ascending: false }).limit(300);
    if (selected) qq = qq.eq("entity_id", selected);
    return unwrap(await qq) as Doc[];
  }, [selected]);
  const list = (q.data ?? []).filter((d) => (cat === "all" || d.category === cat) && (!term || d.title.toLowerCase().includes(term.toLowerCase())));

  const save = async () => {
    if (!pending || !meta.entity_id) return toast("Choose the profile this document belongs to", "error");
    setBusy(true);
    try { await uploadDocument(pending, { ...meta, title: meta.title || pending.name }); toast("Uploaded"); setPending(null); q.reload(); }
    catch (e) { toast(friendlyError(e), "error"); }
    setBusy(false);
  };

  return (
    <div>
      <PageHeader title="Documents" subtitle="Stored privately; links expire after 5 minutes" back="/more" />
      <ProfileSelect />
      <div className="relative mt-2"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink-3" />
        <input className="field pl-10" placeholder="Search documents" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
      <div className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar py-2">
        <Chip active={cat === "all"} onClick={() => setCat("all")}>All</Chip>
        {DOC_CATEGORIES.filter(([k]) => (q.data ?? []).some((d) => d.category === k)).map(([k, l]) => <Chip key={k} active={cat === k} onClick={() => setCat(k)}>{l}</Chip>)}
      </div>
      {isAdminMode && <UploadButtons onFile={async (f) => { setPending(f); setMeta({ title: f.name.replace(/\.[^.]+$/, ""), category: "other", entity_id: selected ?? "", expiry_date: "" }); }} />}
      <div className="mt-3">
        {q.error ? <ErrorState error={q.error} retry={q.reload} /> : q.loading ? <ListSkeleton /> : !list.length ? <Empty title="No documents" message="Uploaded policies, statements and certificates appear here." />
          : <div className="card overflow-hidden">{list.map((d) => <DocRow key={d.id} d={d} />)}</div>}
      </div>
      <Sheet open={!!pending} onClose={() => setPending(null)} title="Upload document" footer={<Button size="lg" className="w-full" loading={busy} onClick={save}>Upload</Button>}>
        <div className="space-y-4">
          <div className="text-sm text-ink-3 truncate">{pending?.name}</div>
          <label className="block"><span className="text-sm font-medium text-ink-2">Title</span><input className="field mt-1.5" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></label>
          <label className="block"><span className="text-sm font-medium text-ink-2">Profile *</span>
            <select className="field mt-1.5" value={meta.entity_id} onChange={(e) => setMeta({ ...meta, entity_id: e.target.value })}><option value="">Select…</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label className="block"><span className="text-sm font-medium text-ink-2">Category</span>
            <select className="field mt-1.5" value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })}>{DOC_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="block"><span className="text-sm font-medium text-ink-2">Expiry date (optional, sends reminders)</span><input type="date" className="field mt-1.5" value={meta.expiry_date} onChange={(e) => setMeta({ ...meta, expiry_date: e.target.value })} /></label>
        </div>
      </Sheet>
    </div>
  );
}
