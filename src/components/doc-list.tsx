"use client";
import { useRef, useState } from "react";
import { FileText, Image as ImageIcon, Download, Eye, Camera, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { unwrap, useQuery } from "@/lib/use-query";
import { ACCEPT, DOC_CATEGORIES, signedUrl, uploadDocument } from "@/lib/documents";
import { formatDate } from "@/lib/dates";
import { useApp, friendlyError } from "./providers";
import { Button } from "./ui";

export type Doc = { id: string; entity_id: string; title: string; category: string; storage_path: string; mime_type: string | null; size_bytes: number | null; expiry_date: string | null; created_at: string; current_version: number; record_type: string | null; record_id: string | null };

export function DocRow({ d }: { d: Doc }) {
  const { toast, entityName } = useApp();
  const open = async (download: boolean) => {
    try { const u = await signedUrl(d.storage_path, download ? d.title : undefined); window.open(u, "_blank", "noopener"); }
    catch (e) { toast(friendlyError(e), "error"); }
  };
  const Icon = d.mime_type?.startsWith("image/") ? ImageIcon : FileText;
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b hairline last:border-0">
      <Icon className="size-5 text-ink-3 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] truncate">{d.title}</div>
        <div className="text-[12px] text-ink-3 truncate">
          {DOC_CATEGORIES.find(([k]) => k === d.category)?.[1] ?? d.category} · {entityName(d.entity_id)}
          {d.expiry_date ? ` · expires ${formatDate(d.expiry_date, "short")}` : ""}{d.current_version > 1 ? ` · v${d.current_version}` : ""}
        </div>
      </div>
      <button onClick={() => open(false)} className="size-10 grid place-items-center rounded-full active:bg-surface-2" aria-label="Preview"><Eye className="size-5" /></button>
      <button onClick={() => open(true)} className="size-10 grid place-items-center rounded-full active:bg-surface-2" aria-label="Download"><Download className="size-5" /></button>
    </div>
  );
}

/** Documents attached to one record, with camera / file upload in Admin Mode. */
export function RecordDocs({ entityId, recordType, recordId, category = "other" }: { entityId: string; recordType: string; recordId: string; category?: string }) {
  const { isAdminMode, toast } = useApp();
  const docs = useQuery(async () => unwrap(await supabase().from("documents").select("*").eq("record_type", recordType).eq("record_id", recordId).is("archived_at", null).order("created_at", { ascending: false })) as Doc[], [recordType, recordId]);
  return (
    <div>
      {docs.data && docs.data.length > 0 ? <div className="card overflow-hidden">{docs.data.map((d) => <DocRow key={d.id} d={d} />)}</div>
        : !docs.loading && <div className="card px-4 py-4 text-sm text-ink-3">No documents attached.</div>}
      {isAdminMode && <UploadButtons onFile={async (f) => {
        try { await uploadDocument(f, { entity_id: entityId, record_type: recordType, record_id: recordId, category }); toast("Document uploaded"); docs.reload(); }
        catch (e) { toast(friendlyError(e), "error"); }
      }} />}
    </div>
  );
}

export function UploadButtons({ onFile }: { onFile: (f: File) => Promise<void> }) {
  const cam = useRef<HTMLInputElement>(null), file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setBusy(true); await onFile(f); setBusy(false);
  };
  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={handle} />
      <input ref={file} type="file" accept={ACCEPT} hidden onChange={handle} />
      <Button variant="secondary" onClick={() => cam.current?.click()} loading={busy}><Camera className="size-4" />Camera</Button>
      <Button variant="secondary" onClick={() => file.current?.click()} disabled={busy}><Upload className="size-4" />Choose file</Button>
    </div>
  );
}
