-- Private document bucket. Object path convention: <entity_id>/<uuid>-<filename>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 20971520,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
              'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/csv'])
on conflict (id) do nothing;

create policy "documents read by permission" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (
    public.is_admin() or exists (
      select 1 from public.entity_permissions ep
       where ep.user_id = auth.uid() and ep.can_view_documents
         and ep.entity_id::text = (storage.foldername(name))[1])));

create policy "documents write in admin mode" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.admin_unlocked());
create policy "documents update in admin mode" on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.admin_unlocked());
create policy "documents delete in admin mode" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.admin_unlocked());
