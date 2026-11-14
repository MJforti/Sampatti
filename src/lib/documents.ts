"use client";
import { supabase } from "./supabase/client";

export const DOC_CATEGORIES: [string, string][] = [
  ["insurance_policy", "Insurance policy"], ["mf_statement", "Mutual fund statement"], ["investment_statement", "Investment statement"],
  ["fd_certificate", "FD certificate"], ["loan_agreement", "Loan agreement"], ["loan_statement", "Loan statement"],
  ["vehicle_rc", "Vehicle RC"], ["puc", "PUC certificate"], ["vehicle_insurance", "Vehicle insurance"],
  ["tax_challan", "Tax challan"], ["receipt", "Payment receipt"], ["other", "Other"],
];
export const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.xlsx,.xls,.doc,.docx,.csv";
const MAX = 20 * 1024 * 1024;

function safeName(n: string) {
  return n.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-80);
}

/** Upload to the private bucket and register the document row. Requires Admin Mode (enforced by storage + table RLS). */
export async function uploadDocument(file: File, meta: {
  entity_id: string; title?: string; category?: string; record_type?: string | null; record_id?: string | null; expiry_date?: string | null;
}) {
  if (file.size > MAX) throw new Error("File is larger than 20 MB");
  const sb = supabase();
  const path = `${meta.entity_id}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const up = await sb.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw up.error;
  const { data: u } = await sb.auth.getUser();
  const { data, error } = await sb.from("documents").insert({
    entity_id: meta.entity_id, title: meta.title || file.name, category: meta.category ?? "other",
    record_type: meta.record_type ?? null, record_id: meta.record_id ?? null, expiry_date: meta.expiry_date || null,
    storage_path: path, mime_type: file.type, size_bytes: file.size, uploaded_by: u.user?.id,
  }).select().single();
  if (error) { await sb.storage.from("documents").remove([path]); throw error; }
  await sb.from("document_versions").insert({ document_id: data.id, version: 1, storage_path: path, mime_type: file.type, size_bytes: file.size, uploaded_by: u.user?.id });
  return data;
}

/** Replace a document's file, keeping the previous version. */
export async function uploadNewVersion(doc: { id: string; entity_id: string; current_version: number }, file: File) {
  if (file.size > MAX) throw new Error("File is larger than 20 MB");
  const sb = supabase();
  const path = `${doc.entity_id}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const up = await sb.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
  if (up.error) throw up.error;
  const { data: u } = await sb.auth.getUser();
  const v = doc.current_version + 1;
  const ins = await sb.from("document_versions").insert({ document_id: doc.id, version: v, storage_path: path, mime_type: file.type, size_bytes: file.size, uploaded_by: u.user?.id });
  if (ins.error) throw ins.error;
  const { error } = await sb.from("documents").update({ storage_path: path, current_version: v, mime_type: file.type, size_bytes: file.size }).eq("id", doc.id);
  if (error) throw error;
}

/** Short-lived signed URL (5 minutes); bucket is private. */
export async function signedUrl(path: string, download?: string) {
  const { data, error } = await supabase().storage.from("documents").createSignedUrl(path, 300, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
